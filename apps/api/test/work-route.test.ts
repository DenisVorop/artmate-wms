import "reflect-metadata";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app";
import { WarehouseService } from "../src/warehouse.service";
import { workRoute } from "../src/work-route";
import { warehouseOperations } from "../src/auth-policy";
import { authorizeWarehouse } from "../src/auth-policy";
import type * as D from "../src/dto";
let app: Awaited<ReturnType<typeof createApp>>,
  base: string,
  warehouse: WarehouseService,
  initial: D.WorkspaceDto;
const origin = "http://127.0.0.1:3080";
type Browser = {
  cookie: string;
  csrf: string;
  employeeId: string;
  accountId: string;
};
let manager: Browser, worker: Browser;
const req = () => ({ requestId: randomUUID() });
async function call(
  method: string,
  path: string,
  body?: unknown,
  browser?: Browser,
) {
  const result = await fetch(`${base}/api/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "X-WMS-Request": "1",
      ...(browser
        ? { Cookie: browser.cookie, "X-WMS-CSRF": browser.csrf }
        : {}),
    },
    ...(method !== "GET" ? { body: JSON.stringify(body ?? {}) } : {}),
  });
  return {
    status: result.status,
    body: await result.json(),
    cookie: result.headers.get("set-cookie"),
    headers: result.headers,
  };
}
function browser(r: Awaited<ReturnType<typeof call>>): Browser {
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return {
    cookie: r.cookie!.split(";")[0],
    csrf: r.body.csrfToken,
    employeeId: r.body.user.employeeId,
    accountId: r.body.user.id,
  };
}
before(async () => {
  process.env.NODE_ENV = "test";
  delete process.env.DATABASE_URL;
  process.env.WMS_DATA_DIR = "memory://";
  process.env.WEB_ORIGIN = origin;
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
  warehouse = app.get(WarehouseService);
  initial = await warehouse.snapshot();
});
after(async () => {
  await app?.close();
});
function fixture() {
  const s = structuredClone(initial);
  s.revision = 73;
  const raw = s.pallets.find((p) => p.kind === "raw" && p.status === "stored")!;
  const task: D.TaskDto = {
    id: "task",
    code: "TASK",
    skuId: raw.skuId!,
    createdAt: null,
    employeeId: "owner",
    status: "active",
    scannedUnits: 0,
    sourcePalletId: null,
    boxCodeConfirmed: false,
    boxesTarget: 1,
    boxesCompleted: 0,
    unitsPerBox: 20,
    openBoxCode: "BOX",
    openBoxContents: [],
    reservations: [{ palletId: raw.id, lotId: raw.lotId!, quantity: 20 }],
  };
  s.tasks.push(task);
  return { s, raw, task };
}
test("route source follows the next remaining FIFO reservation, never a client source; calculation is read-only", () => {
  const { s, raw, task } = fixture();
  const second = s.pallets.find((p) => p.kind === "raw" && p.id !== raw.id)!;
  task.reservations.unshift({
    palletId: second.id,
    lotId: second.lotId!,
    quantity: 0,
  });
  const before = structuredClone(s);
  const r = workRoute(
    s,
    { kind: "assembly", id: task.id },
    { role: "employee", employeeId: "owner" },
  );
  assert.equal(r.sourceLocationId, raw.locationId);
  assert.equal(r.revision, 73);
  assert.ok(r.targetLocationId);
  assert.deepEqual(s, before);
  task.reservations[0] = {
    palletId: second.id,
    lotId: second.lotId!,
    quantity: 10,
  };
  second.skuId = task.skuId;
  assert.equal(
    workRoute(s, { kind: "assembly", id: task.id }).sourceLocationId,
    second.locationId,
  );
});
test("worker ownership covers every job and completed jobs never retain route points", () => {
  const { s, task } = fixture();
  assert.throws(
    () =>
      workRoute(
        s,
        { kind: "assembly", id: task.id },
        { role: "employee", employeeId: "other" },
      ),
    /другому/,
  );
  task.status = "queued";
  task.employeeId = null;
  assert.doesNotThrow(() =>
    workRoute(
      s,
      { kind: "assembly", id: task.id },
      { role: "employee", employeeId: "other" },
    ),
  );
  task.status = "completed";
  const done = workRoute(s, { kind: "assembly", id: task.id });
  assert.equal(done.status, "unknown");
  assert.deepEqual(done.points, []);
});
test("receipt route validates membership and foreign claim; ambiguous receiving start stays unknown", () => {
  const { s, raw } = fixture();
  raw.status = "awaiting_placement";
  raw.locationId = null;
  const receipt: D.ReceiptDto = {
    id: "receipt",
    code: "RCV",
    status: "pending",
    receivedAt: "2026-10-25T08:00:00Z",
    createdAt: "2026-10-25T08:00:00Z",
    completedAt: null,
    pallets: [
      {
        palletId: raw.id,
        skuId: raw.skuId!,
        quantity: raw.quantity,
        locationId: null,
        placedAt: null,
        placedByEmployeeId: null,
      },
    ],
  };
  s.receipts.push(receipt);
  const query: D.WorkRouteQueryDto = {
    kind: "receiving",
    id: receipt.id,
    palletId: raw.id,
  };
  assert.throws(
    () => workRoute(s, { ...query, palletId: "alien" }),
    /не принадлежит/,
  );
  const origin = s.locations.find((l) => l.kind === "receiving")!;
  s.warehouse.workZones.push({
    id: "zone",
    code: "Z",
    name: "Приёмка",
    kind: "receiving",
    locationIds: [origin.id],
    archived: false,
    archivedAt: null,
  });
  s.warehouse.zoneWork.push({
    employeeId: "owner",
    zoneId: "zone",
    jobKind: "receiving",
    jobId: receipt.id,
    palletId: raw.id,
    message: "",
  });
  assert.throws(
    () => workRoute(s, query, { role: "employee", employeeId: "other" }),
    /другим/,
  );
  assert.equal(workRoute(s, query).sourceLocationId, origin.id);
  s.locations.push({ ...origin, id: "second-receiving", x: 0 });
  s.warehouse.workZones[0].locationIds.push("second-receiving");
  const r = workRoute(s, query);
  assert.equal(r.sourceLocationId, null);
  assert.equal(r.status, "unknown");
  assert.deepEqual(r.points, []);
});
test("claimed and carried putaway routes preserve reserved destination regardless of current ranking", () => {
  const { s } = fixture();
  const box = s.boxes[0];
  const source = s.locations.find((l) => l.kind === "assembly")!;
  const target = s.locations.find(
    (l) => l.kind === "rack" && l.id !== box.locationId,
  )!;
  const task: D.PutawayTaskDto = {
    id: "put",
    code: "PUT",
    boxId: box.id,
    skuId: box.skuId,
    employeeId: "owner",
    fromPalletId: box.palletId!,
    fromLocationId: source.id,
    toLocationId: target.id,
    status: "claimed",
    createdAt: "",
    claimedAt: "",
    takenAt: null,
    completedAt: null,
  };
  s.putawayTasks.push(task);
  for (const status of ["claimed", "in_transit"]) {
    task.status = status;
    const r = workRoute(
      s,
      { kind: "putaway", id: task.id },
      { role: "employee", employeeId: "owner" },
    );
    assert.equal(r.sourceLocationId, source.id);
    assert.equal(r.targetLocationId, target.id);
  }
  assert.throws(
    () =>
      workRoute(
        s,
        { kind: "putaway", id: task.id },
        { role: "employee", employeeId: "other" },
      ),
    /другому/,
  );
});
test("movement displays its original source in both phases and rejects another owner", () => {
  const { s, raw } = fixture();
  const m = {
    id: "move",
    employeeId: "owner",
    fromLocationId: raw.locationId!,
    toLocationId: "loc-assembly",
    status: "planned",
  } as D.MovementDto;
  s.movements.push(m);
  for (const status of ["planned", "in_transit"]) {
    m.status = status;
    const r = workRoute(
      s,
      { kind: "movement", id: m.id },
      { role: "employee", employeeId: "owner" },
    );
    assert.equal(r.sourceLocationId, m.fromLocationId);
    assert.equal(r.targetLocationId, m.toLocationId);
  }
  assert.throws(
    () =>
      workRoute(
        s,
        { kind: "movement", id: m.id },
        { role: "employee", employeeId: "other" },
      ),
    /другому/,
  );
});
test("shipping uses unscanned physical box and exact bound zone; ambiguous destination never picks the first", () => {
  const { s } = fixture();
  const box = s.boxes[0],
    another = s.boxes[1];
  const target = s.locations.find((l) => l.kind === "shipping")!;
  const zone: D.WorkZoneDto = {
    id: "ship-zone",
    code: "OUT",
    name: "Отгрузка",
    kind: "shipping",
    locationIds: [target.id],
    archived: false,
    archivedAt: null,
  };
  s.warehouse.workZones.push(zone);
  const shipment: D.ShipmentDto = {
    id: "ship",
    code: "SHIP",
    employeeId: "owner",
    workZoneId: zone.id,
    scannedBoxIds: [box.id],
    boxIds: [box.id, another.id],
    status: "draft",
    skuId: box.skuId,
    boxesRequested: 2,
  };
  s.shipments.push(shipment);
  s.warehouse.zoneWork.push({
    employeeId: "owner",
    zoneId: zone.id,
    jobKind: "shipping",
    jobId: shipment.id,
    palletId: null,
    message: "",
  });
  const q: D.WorkRouteQueryDto = { kind: "shipping", id: shipment.id };
  assert.equal(workRoute(s, q).sourceLocationId, another.locationId);
  assert.equal(workRoute(s, q).targetLocationId, target.id);
  assert.throws(() => workRoute(s, { ...q, boxId: "alien" }), /не принадлежит/);
  assert.throws(
    () => workRoute(s, q, { role: "employee", employeeId: "other" }),
    /другому/,
  );
  assert.deepEqual(workRoute(s, { ...q, boxId: box.id }).points, []);
  s.locations.push({ ...target, id: "other-shipping", x: 0 });
  zone.locationIds.push("other-shipping");
  assert.equal(workRoute(s, q).targetLocationId, null);
  assert.equal(workRoute(s, q).status, "unknown");
});
test("HTTP route is default-deny, strict and session-fresh; worker sees only eligible jobs, GET leaves state unchanged", async () => {
  const path = "work-route?kind=assembly&id=task";
  assert.equal((await call("GET", path)).status, 401);
  assert.ok(warehouseOperations.has("getWorkRoute"));
  await assert.rejects(
    () =>
      authorizeWarehouse(
        { query: async () => ({ rows: [] }) },
        "getFutureRoute",
      ),
    /не разрешена/,
  );
  manager = browser(
    await call("POST", "auth/setup", {
      name: "Route manager",
      login: "route-manager",
      password: "Route-manager-Password1",
    }),
  );
  const workerId = initial.employees[0].id;
  assert.equal(
    (
      await call(
        "POST",
        "auth/accounts",
        {
          employeeId: workerId,
          login: "route-worker",
          role: "employee",
          password: "Temporary-route-123",
        },
        manager,
      )
    ).status,
    200,
  );
  const temp = browser(
    await call("POST", "auth/login", {
      login: "route-worker",
      password: "Temporary-route-123",
    }),
  );
  assert.equal((await call("GET", path, undefined, temp)).status, 403);
  worker = browser(
    await call(
      "POST",
      "auth/change-password",
      {
        currentPassword: "Temporary-route-123",
        newPassword: "Changed-route-Password1",
      },
      temp,
    ),
  );
  const ownState = await warehouse.createTask({
    ...req(),
    employeeId: worker.employeeId,
    skuId: "sku-cats",
    boxesTarget: 1,
  });
  const own = ownState.tasks.at(-1)!;
  const freeState = await warehouse.createTask({
    ...req(),
    skuId: "sku-cats",
    boxesTarget: 1,
  });
  const free = freeState.tasks.at(-1)!;
  const otherState = await warehouse.createTask({
    ...req(),
    employeeId: manager.employeeId,
    skuId: "sku-cats",
    boxesTarget: 1,
  });
  const other = otherState.tasks.at(-1)!;
  const before = await warehouse.snapshot();
  const r = await call(
    "GET",
    `work-route?kind=assembly&id=${own.id}`,
    undefined,
    worker,
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.revision, before.revision);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal(
    (
      await call(
        "GET",
        `work-route?kind=assembly&id=${free.id}`,
        undefined,
        worker,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        "GET",
        `work-route?kind=assembly&id=${other.id}`,
        undefined,
        worker,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        "GET",
        `work-route?kind=assembly&id=${other.id}`,
        undefined,
        manager,
      )
    ).status,
    200,
  );
  for (const query of [
    "kind=no&id=x",
    "kind=receiving&id=x",
    "kind=assembly&id=x&palletId=x",
    "kind=movement&id=x&boxId=x",
    "kind=assembly&id=x&sourceLocationId=loc-1",
    "kind=assembly&id=x&id=y",
    `kind=assembly&id=${"a".repeat(161)}`,
    "kind=assembly&id=",
  ]) {
    assert.equal(
      (await call("GET", `work-route?${query}`, undefined, worker)).status,
      400,
      query,
    );
  }
  assert.deepEqual(await warehouse.snapshot(), before);
  assert.equal(
    (
      await call(
        "POST",
        `auth/accounts/${worker.accountId}`,
        { blocked: true },
        manager,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        "GET",
        `work-route?kind=assembly&id=${own.id}`,
        undefined,
        worker,
      )
    ).status,
    401,
  );
});
