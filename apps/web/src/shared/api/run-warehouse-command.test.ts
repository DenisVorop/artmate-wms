import { test } from "node:test";
import assert from "node:assert/strict";
import type { WorkspaceDto } from "./generated/model";
import { runWarehouseCommand } from "./run-warehouse-command";

function snapshot(): WorkspaceDto {
  return {
    receipts: [],
    putawayTasks: [],
    balance: {
      rawUnits: 0,
      workInProgressUnits: 0,
      boxedUnits: 0,
      totalUnits: 0,
      awaitingPlacementUnits: 0,
      awaitingPlacementPallets: 0,
    },
    revision: 0,
    warehouse: {
      name: "Тестовый склад",
      width: 26,
      depth: 17,
      layoutMode: "rectangle",
      spaces: [],
    },
    aisles: [],
    entrances: [],
    sections: [],
    movements: [],
    skus: [],
    locations: [],
    lots: [],
    pallets: [],
    boxes: [],
    tasks: [],
    employees: [],
    shipments: [],
    activities: [],
  };
}
function fixture() {
  const before = snapshot();
  const response = snapshot();
  const current = snapshot();
  let cache: unknown = before;
  const calls = { command: 0, cancel: 0, read: 0, set: 0, invalidate: 0 };
  const port = {
    command: async (): Promise<WorkspaceDto> => {
      calls.command++;
      return response;
    },
    cancelRead: async () => {
      calls.cancel++;
    },
    readCurrent: async (): Promise<unknown> => {
      calls.read++;
      return current;
    },
    getCached: () => cache,
    setCached: (value: WorkspaceDto) => {
      calls.set++;
      cache = value;
    },
    invalidate: async () => {
      calls.invalidate++;
    },
  };
  return {
    before,
    response,
    current,
    calls,
    port,
    getCache: () => cache,
    setCache: (value: unknown) => {
      cache = value;
    },
  };
}

// Reproduces a successful POST followed by a failed GET. The caller must close
// its form as success rather than offer a new requestId for the same write.
test("committed command remains successful when the refresh fails", async () => {
  const f = fixture();
  f.port.readCurrent = async () => {
    f.calls.read++;
    throw new Error("network unavailable");
  };
  assert.strictEqual(await runWarehouseCommand(f.port), f.response);
  assert.strictEqual(f.getCache(), f.response);
  assert.equal(f.calls.command, 1);
  assert.equal(f.calls.invalidate, 1);
});

test("refresh failure cannot replace current cache with a replay from v1", async () => {
  const f = fixture();
  const { sections: _sections, movements: _movements, ...legacy } = f.response;
  f.port.command = async () => {
    f.calls.command++;
    return legacy as WorkspaceDto;
  };
  f.port.readCurrent = async () => {
    throw new Error("offline");
  };
  assert.strictEqual(await runWarehouseCommand(f.port), f.before);
  assert.strictEqual(f.getCache(), f.before);
  assert.equal(f.calls.set, 0);
  assert.equal(f.calls.command, 1);
  assert.equal(f.calls.invalidate, 1);
});

test("legacy replay prefers the newest available v2 cache on refresh failure", async () => {
  const f = fixture();
  const { sections: _sections, movements: _movements, ...legacy } = f.response;
  f.port.command = async () => {
    f.calls.command++;
    f.setCache(f.current);
    return legacy as WorkspaceDto;
  };
  f.port.readCurrent = async () => {
    throw new Error("offline");
  };
  assert.strictEqual(await runWarehouseCommand(f.port), f.current);
  assert.strictEqual(f.getCache(), f.current);
  assert.equal(f.calls.set, 0);
});

test("successful refresh supersedes a historical command response", async () => {
  const f = fixture();
  assert.strictEqual(await runWarehouseCommand(f.port), f.current);
  assert.strictEqual(f.getCache(), f.current);
  assert.equal(f.calls.command, 1);
  assert.equal(f.calls.cancel, 2);
  assert.equal(f.calls.invalidate, 0);
});

test("failed mutation rejects without issuing a refresh or changing cache", async () => {
  const f = fixture();
  const error = new Error("target occupied");
  f.port.command = async () => {
    f.calls.command++;
    throw error;
  };
  await assert.rejects(runWarehouseCommand(f.port), (value) => value === error);
  assert.strictEqual(f.getCache(), f.before);
  assert.equal(f.calls.command, 1);
  assert.equal(f.calls.read, 0);
  assert.equal(f.calls.set, 0);
});

test("a missing current snapshot stops the command before any write", async () => {
  const f = fixture();
  f.setCache(undefined);
  await assert.rejects(
    runWarehouseCommand(f.port),
    /Данные склада ещё не загружены/,
  );
  assert.equal(f.calls.command, 0);
});

test("an invalid refresh response uses the committed v2 result and schedules recovery", async () => {
  const f = fixture();
  f.port.readCurrent = async () => ({ sections: [] });
  assert.strictEqual(await runWarehouseCommand(f.port), f.response);
  assert.equal(f.calls.command, 1);
  assert.equal(f.calls.invalidate, 1);
});

// V2 has valid inventory arrays but no warehouse boundary/aisles/entrances.
test("a v2 replay cannot replace the constructor's current v3 state", async () => {
  const f = fixture();
  const {
    warehouse: _room,
    aisles: _aisles,
    entrances: _entrances,
    ...v2
  } = f.response;
  f.port.command = async () => v2 as WorkspaceDto;
  f.port.readCurrent = async () => {
    throw new Error("offline");
  };
  assert.strictEqual(await runWarehouseCommand(f.port), f.before);
  assert.strictEqual(f.getCache(), f.before);
  assert.equal(f.calls.set, 0);
});

test("a same-schema historical replay cannot overwrite a newer cache when GET fails", async () => {
  const f = fixture();
  f.before.revision = 8;
  f.response.revision = 3;
  f.port.readCurrent = async () => {
    throw new Error("offline");
  };
  assert.strictEqual(await runWarehouseCommand(f.port), f.before);
  assert.strictEqual(f.getCache(), f.before);
  assert.equal(f.calls.set, 0);
});
test("a confirmed newer command is shown if its following refresh fails", async () => {
  const f = fixture();
  f.before.revision = 8;
  f.response.revision = 9;
  f.port.readCurrent = async () => {
    throw new Error("offline");
  };
  assert.strictEqual(await runWarehouseCommand(f.port), f.response);
  assert.strictEqual(f.getCache(), f.response);
});
test("a delayed successful read cannot roll cache back past the command revision", async () => {
  const f = fixture();
  f.before.revision = 8;
  f.response.revision = 10;
  f.current.revision = 9;
  assert.strictEqual(await runWarehouseCommand(f.port), f.response);
  assert.strictEqual(f.getCache(), f.response);
});
test("a delayed read and replay preserve an independently newer cached revision", async () => {
  const f = fixture();
  f.before.revision = 12;
  f.response.revision = 10;
  f.current.revision = 11;
  assert.strictEqual(await runWarehouseCommand(f.port), f.before);
  assert.strictEqual(f.getCache(), f.before);
});

test("a v3 rectangular response cannot erase drawn rooms when its refresh fails", async () => {
  const f = fixture();
  f.before.warehouse.layoutMode = "spaces";
  const {
    layoutMode: _mode,
    spaces: _spaces,
    ...legacyPlan
  } = f.response.warehouse;
  f.port.command = async () =>
    ({ ...f.response, warehouse: legacyPlan }) as WorkspaceDto;
  f.port.readCurrent = async () => {
    throw new Error("offline");
  };
  assert.strictEqual(await runWarehouseCommand(f.port), f.before);
  assert.strictEqual(f.getCache(), f.before);
  assert.equal(f.calls.set, 0);
});

// Pre-receiving command replays must not remove pending receipts or their balance.
test("a v4 replay cannot erase receiving documents when its refresh fails", async () => {
  const f = fixture();
  f.before.balance.awaitingPlacementUnits = 1000;
  f.before.balance.awaitingPlacementPallets = 1;
  const { receipts: _receipts, balance: _balance, ...v4 } = f.response;
  f.port.command = async () => v4 as WorkspaceDto;
  f.port.readCurrent = async () => {
    throw new Error("offline");
  };
  assert.strictEqual(await runWarehouseCommand(f.port), f.before);
  assert.strictEqual(f.getCache(), f.before);
  assert.equal(f.calls.set, 0);
});

test("invalid balance data cannot replace the current workspace", async () => {
  const f = fixture();
  f.response.balance.totalUnits = -1;
  f.current.balance.awaitingPlacementUnits = Number.NaN;
  assert.strictEqual(await runWarehouseCommand(f.port), f.before);
  assert.equal(f.calls.set, 0);
});

function currentTask(): WorkspaceDto["tasks"][number] {
  return {
    id: "task-current",
    code: "TASK-CURRENT",
    skuId: "sku-cats",
    boxesTarget: 1,
    boxesCompleted: 0,
    unitsPerBox: 20,
    status: "active",
    employeeId: "actor",
    scannedUnits: 3,
    sourcePalletId: "raw",
    openBoxCode: "BOX-CURRENT",
    reservations: [],
    openBoxContents: [],
    createdAt: null,
    boxCodeConfirmed: true,
  };
}
test("a v5 replay cannot erase confirmed box state when refreshing fails", async () => {
  const f = fixture();
  f.before.tasks = [currentTask()];
  const {
    createdAt: _created,
    boxCodeConfirmed: _confirmed,
    ...legacyTask
  } = currentTask();
  f.port.command = async () =>
    ({ ...f.response, tasks: [legacyTask] }) as WorkspaceDto;
  f.port.readCurrent = async () => {
    throw new Error("offline");
  };
  assert.strictEqual(await runWarehouseCommand(f.port), f.before);
  assert.equal(f.calls.set, 0);
  assert.equal((f.getCache() as WorkspaceDto).tasks[0].boxCodeConfirmed, true);
});
test("invalid assembly step data cannot replace the current workspace", async () => {
  const f = fixture();
  f.response.tasks = [{ ...currentTask(), createdAt: "not-a-date" }];
  f.current.tasks = [
    { ...currentTask(), boxCodeConfirmed: null as unknown as boolean },
  ];
  assert.strictEqual(await runWarehouseCommand(f.port), f.before);
  assert.equal(f.calls.set, 0);
});

test("a v6 replay cannot remove pending putaway tasks when refresh fails", async () => {
  const f = fixture();
  f.before.putawayTasks = [
    {
      id: "putaway",
      code: "PUT-1",
      boxId: "box",
      skuId: "sku",
      status: "claimed",
      employeeId: "actor",
      fromPalletId: "assembly",
      fromLocationId: "assembly-address",
      toLocationId: "rack",
      createdAt: "2026-10-23T00:00:00Z",
      claimedAt: "2026-10-23T00:00:00Z",
      takenAt: null,
      completedAt: null,
    },
  ];
  const { putawayTasks: _queue, ...legacy } = f.response;
  f.port.command = async () => legacy as WorkspaceDto;
  f.port.readCurrent = async () => {
    throw new Error("offline");
  };
  assert.strictEqual(await runWarehouseCommand(f.port), f.before);
  assert.equal(f.calls.set, 0);
  assert.equal((f.getCache() as WorkspaceDto).putawayTasks.length, 1);
});

test("scope change after first cancel prevents the warehouse write", async () => {
  const f = fixture();
  let valid = true;
  f.port.cancelRead = async () => {
    f.calls.cancel++;
    valid = false;
  };
  await assert.rejects(
    runWarehouseCommand({ ...f.port, isScopeCurrent: () => valid }),
    (error) =>
      error instanceof Error && "status" in error && error.status === 409,
  );
  assert.equal(f.calls.command, 0);
  assert.equal(f.calls.set, 0);
});
test("scope change after committed response cannot merge an old manager result after cancelRead", async () => {
  const f = fixture();
  let valid = true;
  f.response.revision = 100;
  const worker = { ...snapshot(), revision: 1 };
  f.port.cancelRead = async () => {
    f.calls.cancel++;
    if (f.calls.cancel === 2) {
      valid = false;
      f.setCache(worker);
    }
  };
  await assert.rejects(
    runWarehouseCommand({ ...f.port, isScopeCurrent: () => valid }),
    /Сессия изменилась/,
  );
  assert.strictEqual(f.getCache(), worker);
  assert.equal(f.calls.set, 0);
  assert.equal(f.calls.read, 0);
  assert.equal(f.calls.invalidate, 0);
});
test("scope change during readCurrent cannot be swallowed as an offline refresh fallback", async () => {
  const f = fixture();
  let valid = true;
  f.response.revision = 100;
  const worker = { ...snapshot(), revision: 1 };
  f.port.readCurrent = async () => {
    valid = false;
    f.setCache(worker);
    throw new Error("old request interrupted");
  };
  await assert.rejects(
    runWarehouseCommand({ ...f.port, isScopeCurrent: () => valid }),
    /Сессия изменилась/,
  );
  assert.strictEqual(f.getCache(), worker);
  assert.equal(f.calls.set, 0);
  assert.equal(f.calls.invalidate, 0);
});
test("a new user read cannot lose to a higher-revision old command response", async () => {
  const f = fixture();
  let valid = true;
  f.response.revision = 100;
  const worker = { ...snapshot(), revision: 1 };
  f.port.readCurrent = async () => {
    valid = false;
    f.setCache(worker);
    return worker;
  };
  await assert.rejects(
    runWarehouseCommand({ ...f.port, isScopeCurrent: () => valid }),
    /Сессия изменилась/,
  );
  assert.strictEqual(f.getCache(), worker);
  assert.equal(f.calls.set, 0);
});
test("scope change during invalidate prevents returning the old commit as a new-user result", async () => {
  const f = fixture();
  let valid = true;
  f.port.readCurrent = async () => {
    throw new Error("offline");
  };
  f.port.invalidate = async () => {
    valid = false;
    f.setCache(undefined);
  };
  await assert.rejects(
    runWarehouseCommand({ ...f.port, isScopeCurrent: () => valid }),
    /Сессия изменилась/,
  );
  assert.equal(f.getCache(), undefined);
});
