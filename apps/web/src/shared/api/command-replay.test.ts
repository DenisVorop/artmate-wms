import { test } from "node:test";
import assert from "node:assert/strict";
import { commandFingerprint, fetchReplaySafeCommand } from "./command-replay";
import { apiFetch } from "./transport";

function workspace() {
  return {
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
function ok() {
  return Response.json(workspace());
}
function options(requestId: string, quantity = 1): RequestInit {
  return {
    method: "POST",
    body: JSON.stringify({ requestId, skuId: "sku-sensitive-label", quantity }),
  };
}
function fixture() {
  const entries = new Map<string, string>();
  const sent: Record<string, unknown>[] = [];
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
  };
  const ports = {
    storage: () => storage,
    fingerprint: commandFingerprint,
    fetch: async (_url: string, init: RequestInit): Promise<Response> => {
      sent.push(JSON.parse(String(init.body)));
      return ok();
    },
  };
  return { entries, sent, storage, ports };
}

test("lost POST response retries with the persisted key and commits only once", async () => {
  const f = fixture();
  const committed = new Set<string>();
  let calls = 0;
  f.ports.fetch = async (_url, init) => {
    const body = JSON.parse(String(init.body));
    f.sent.push(body);
    committed.add(body.requestId);
    calls++;
    if (calls === 1) throw new TypeError("response lost after commit");
    return ok();
  };
  await assert.rejects(
    fetchReplaySafeCommand("/api/receipts", options("first"), f.ports),
    /Не удалось получить подтверждение/,
  );
  assert.equal(f.entries.size, 1);
  const storedKey = [...f.entries.keys()][0]!;
  assert.match(storedKey, /:v1:[0-9a-f]{64}$/);
  assert.deepEqual([...f.entries.values()], ["first"]);
  // Recreating the ports models a remount/reload with the same session storage.
  await fetchReplaySafeCommand("/api/receipts", options("new-form-id"), {
    ...f.ports,
  });
  assert.deepEqual(
    f.sent.map((body) => body.requestId),
    ["first", "first"],
  );
  assert.equal(committed.size, 1);
  assert.equal(f.entries.size, 0);
});

test("after success the next identical scan receives its new requestId", async () => {
  const f = fixture();
  await fetchReplaySafeCommand("/api/tasks/1/scan", options("scan-1"), f.ports);
  await fetchReplaySafeCommand("/api/tasks/1/scan", options("scan-2"), f.ports);
  assert.deepEqual(
    f.sent.map((body) => body.requestId),
    ["scan-1", "scan-2"],
  );
  assert.equal(f.entries.size, 0);
});

test("definitive 4xx clears the key and an edited command can use a fresh key", async () => {
  const f = fixture();
  let calls = 0;
  f.ports.fetch = async (_url, init) => {
    f.sent.push(JSON.parse(String(init.body)));
    return ++calls === 1
      ? Response.json({ message: "Недостаточно товара" }, { status: 422 })
      : ok();
  };
  await assert.rejects(
    fetchReplaySafeCommand("/api/tasks", options("rejected", 10), f.ports),
    /Недостаточно товара/,
  );
  assert.equal(f.entries.size, 0);
  await fetchReplaySafeCommand("/api/tasks", options("edited", 2), f.ports);
  assert.deepEqual(
    f.sent.map((body) => body.requestId),
    ["rejected", "edited"],
  );
  assert.equal(f.entries.size, 0);
});

test("5xx retains the canonical key for a later retry", async () => {
  const f = fixture();
  let calls = 0;
  f.ports.fetch = async (_url, init) => {
    f.sent.push(JSON.parse(String(init.body)));
    return ++calls === 1
      ? Response.json({ message: "Недоступно" }, { status: 503 })
      : ok();
  };
  await assert.rejects(
    fetchReplaySafeCommand("/api/tasks", options("retained"), f.ports),
    /Недоступно/,
  );
  assert.equal(f.entries.size, 1);
  await fetchReplaySafeCommand(
    "/api/tasks",
    options("ignored-new-id"),
    f.ports,
  );
  assert.deepEqual(
    f.sent.map((body) => body.requestId),
    ["retained", "retained"],
  );
});

test("malformed JSON and invalid 2xx snapshots retain the key", async () => {
  for (const invalid of ["{broken", "{}", "null"]) {
    const f = fixture();
    let calls = 0;
    f.ports.fetch = async (_url, init) => {
      f.sent.push(JSON.parse(String(init.body)));
      return ++calls === 1 ? new Response(invalid, { status: 200 }) : ok();
    };
    await assert.rejects(
      fetchReplaySafeCommand(
        `/api/test-${invalid}`,
        options("ambiguous"),
        f.ports,
      ),
      /неподтверждённый результат/,
    );
    assert.equal(f.entries.size, 1);
    await fetchReplaySafeCommand(
      `/api/test-${invalid}`,
      options("new"),
      f.ports,
    );
    assert.deepEqual(
      f.sent.map((body) => body.requestId),
      ["ambiguous", "ambiguous"],
    );
  }
});

test("denied storage read or write rejects before a write request is sent", async () => {
  for (const denied of ["getItem", "setItem"] as const) {
    const f = fixture();
    f.storage[denied] = () => {
      throw new Error("SecurityError");
    };
    await assert.rejects(
      fetchReplaySafeCommand(
        "/api/tasks",
        options(`denied-${denied}`),
        f.ports,
      ),
      /Браузер не может сохранить защиту/,
    );
    assert.equal(f.sent.length, 0);
  }
});

test("a second identical command in flight is rejected rather than coalesced", async () => {
  const f = fixture();
  let release!: (response: Response) => void;
  let started!: () => void;
  const didStart = new Promise<void>((resolve) => {
    started = resolve;
  });
  f.ports.fetch = async (_url, init) => {
    f.sent.push(JSON.parse(String(init.body)));
    started();
    return new Promise<Response>((resolve) => {
      release = resolve;
    });
  };
  const first = fetchReplaySafeCommand(
    "/api/scan-concurrent",
    options("scan-first"),
    f.ports,
  );
  await didStart;
  await assert.rejects(
    fetchReplaySafeCommand(
      "/api/scan-concurrent",
      options("scan-second"),
      f.ports,
    ),
    /уже отправляется/,
  );
  assert.equal(f.sent.length, 1);
  release(ok());
  await first;
  assert.equal(f.entries.size, 0);
});

test("fingerprints are independent of requestId and JSON field order", async () => {
  const f = fixture();
  let calls = 0;
  const wireBodies: string[] = [];
  f.ports.fetch = async (_url, init) => {
    wireBodies.push(String(init.body));
    f.sent.push(JSON.parse(String(init.body)));
    if (++calls === 1) throw new Error("lost");
    return ok();
  };
  await assert.rejects(
    fetchReplaySafeCommand("/api/stable", options("stable"), f.ports),
  );
  await fetchReplaySafeCommand(
    "/api/stable",
    {
      method: "post",
      body: JSON.stringify({
        quantity: 1,
        skuId: "sku-sensitive-label",
        requestId: "different",
      }),
    },
    f.ports,
  );
  assert.deepEqual(
    f.sent.map((body) => body.requestId),
    ["stable", "stable"],
  );
  assert.equal(
    wireBodies[0],
    wireBodies[1],
    "server JSON.stringify fingerprint must see the exact same body order",
  );
});

test("legacy successful replay is accepted and clears the pending key", async () => {
  const f = fixture();
  const { sections: _sections, movements: _movements, ...legacy } = workspace();
  f.ports.fetch = async () => Response.json(legacy);
  await fetchReplaySafeCommand("/api/legacy", options("legacy"), f.ports);
  assert.equal(f.entries.size, 0);
});

test("storage cleanup failure retains the key and a retry stays idempotent", async () => {
  const f = fixture();
  const remove = f.storage.removeItem;
  f.storage.removeItem = () => {
    throw new Error("storage denied");
  };
  await assert.rejects(
    fetchReplaySafeCommand("/api/cleanup", options("committed"), f.ports),
    /Сервер выполнил действие/,
  );
  assert.equal(f.entries.size, 1);
  f.storage.removeItem = remove;
  await fetchReplaySafeCommand("/api/cleanup", options("retry"), f.ports);
  assert.deepEqual(
    f.sent.map((body) => body.requestId),
    ["committed", "committed"],
  );
});

test("GET does not access browser command storage", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ payload: "unchanged GET" });
    assert.deepEqual(await apiFetch("/api/read-only"), {
      payload: "unchanged GET",
    });
  } finally {
    globalThis.fetch = original;
  }
});
