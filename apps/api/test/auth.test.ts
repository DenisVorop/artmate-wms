import "reflect-metadata";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app";
import { WarehouseService } from "../src/warehouse.service";
import * as D from "../src/dto";
import { Client } from "pg";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
let fixtureDir: string | undefined;
type Browser = {
  cookie: string;
  csrf: string;
  user: D.AuthUserDto;
  password: string;
};
let app: Awaited<ReturnType<typeof createApp>>,
  base: string,
  w: WarehouseService,
  manager: Browser,
  worker: Browser,
  otherManager: Browser;
let beforeSetup: D.WorkspaceDto;
const origin = "http://127.0.0.1:3080";
const req = () => ({ requestId: randomUUID() });
async function call(
  method: string,
  path: string,
  body?: unknown,
  browser?: Browser,
  headers: Record<string, string> = {},
) {
  const response = await fetch(`${base}/api/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "X-WMS-Request": "1",
      ...(browser
        ? { Cookie: browser.cookie, "X-WMS-CSRF": browser.csrf }
        : {}),
      ...headers,
    },
    ...(method !== "GET" ? { body: JSON.stringify(body ?? {}) } : {}),
  });
  return {
    status: response.status,
    body: await response.json(),
    cookie: response.headers.get("set-cookie"),
    headers: response.headers,
  };
}
function browser(
  result: Awaited<ReturnType<typeof call>>,
  password: string,
): Browser {
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return {
    cookie: result.cookie!.split(";")[0],
    csrf: result.body.csrfToken,
    user: result.body.user,
    password,
  };
}
before(async () => {
  process.env.NODE_ENV = "test";
  process.env.WEB_ORIGIN = origin;
  const url = process.env.WMS_AUTH_TEST_DATABASE_URL;
  if (url) {
    const database = new Client({ connectionString: url }).database ?? "";
    if (!database.endsWith("_test") || database === "artmate_wms")
      throw new Error("Auth tests require separate _test database");
    process.env.DATABASE_URL = url;
    delete process.env.WMS_DATA_DIR;
  } else {
    fixtureDir = await mkdtemp(join(tmpdir(), "wms-auth-http-"));
    process.env.WMS_DATA_DIR = join(fixtureDir, "db");
  }
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
  w = app.get(WarehouseService);
  beforeSetup = await w.snapshot();
});
after(async () => {
  await app?.close();
  if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
});
test("default deny covers warehouse reads labels and writes; public setup state has no secrets and no-store headers", async () => {
  for (const path of [
    "workspace",
    "stock-ledger",
    "labels/pallet/pallet-cats-old",
  ])
    assert.equal((await call("GET", path)).status, 401);
  assert.equal(
    (
      await call("POST", "tasks", {
        ...req(),
        skuId: "sku-cats",
        boxesTarget: 1,
      })
    ).status,
    401,
  );
  const state = await call("GET", "auth/session");
  assert.deepEqual(state.body, {
    needsSetup: true,
    user: null,
    csrfToken: null,
    expiresAt: null,
  });
  assert.equal(state.headers.get("cache-control"), "no-store");
});
test("bootstrap requires explicit Origin JSON request marker, strict DTO and one atomic race winner", async () => {
  const password = "First-manager-Password1";
  const body = { name: "Первый руководитель", login: "manager", password };
  assert.equal(
    (
      await call("POST", "auth/setup", body, undefined, {
        Origin: "https://evil.invalid",
      })
    ).status,
    403,
  );
  assert.equal(
    (await call("POST", "auth/setup", body, undefined, { "X-WMS-Request": "" }))
      .status,
    403,
  );
  assert.equal(
    (await call("POST", "auth/setup", { ...body, password: "short" })).status,
    400,
  );
  assert.equal(
    (await call("POST", "auth/setup", { ...body, role: "manager" })).status,
    400,
  );
  const results = await Promise.all([
    call("POST", "auth/setup", body),
    call("POST", "auth/setup", { ...body, login: "manager-two" }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  manager = browser(results.find((r) => r.status === 200)!, password);
  assert.match(results.find((r) => r.status === 200)!.cookie!, /HttpOnly/);
  assert.match(
    results.find((r) => r.status === 200)!.cookie!,
    /SameSite=Strict/,
  );
  const state = await w.snapshot();
  assert.equal(state.revision, beforeSetup.revision + 1);
  assert.equal(state.employees.length, beforeSetup.employees.length + 1);
  assert.equal(manager.user.mustChangePassword, false);
  assert.equal((await call("POST", "auth/setup", body)).status, 409);
});
test("CSRF and Origin are independently required, last manager cannot be disabled and self password reset is rejected", async () => {
  const own = `employees/${manager.user.employeeId}/shift`,
    body = { ...req(), status: "working" };
  assert.equal(
    (await call("POST", own, body, manager, { "X-WMS-CSRF": "wrong" })).status,
    403,
  );
  assert.equal(
    (await call("POST", own, body, manager, { Origin: "https://evil.invalid" }))
      .status,
    403,
  );
  assert.equal((await call("POST", own, body, manager)).status, 200);
  assert.equal(
    (
      await call(
        "POST",
        `auth/accounts/${manager.user.id}`,
        { blocked: true },
        manager,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await call(
        "POST",
        `auth/accounts/${manager.user.id}`,
        { role: "employee" },
        manager,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await call(
        "POST",
        `auth/accounts/${manager.user.id}/password`,
        { password: "Another-secret-123" },
        manager,
      )
    ).status,
    400,
  );
});
test("temporary worker account requires password change, session rotates and responses never expose credentials", async () => {
  const own = (await w.snapshot()).employees.find(
    (e) => e.id !== manager.user.employeeId,
  )!;
  const password = "Temporary-worker-123";
  const created = await call(
    "POST",
    "auth/accounts",
    { employeeId: own.id, login: "worker", role: "employee", password },
    manager,
  );
  assert.equal(created.status, 200);
  const temp = browser(
    await call("POST", "auth/login", { login: "worker", password }),
    password,
  );
  assert.equal(temp.user.mustChangePassword, true);
  assert.equal((await call("GET", "workspace", undefined, temp)).status, 403);
  const fresh = "Changed-worker-Password1";
  worker = browser(
    await call(
      "POST",
      "auth/change-password",
      { currentPassword: password, newPassword: fresh },
      temp,
    ),
    fresh,
  );
  assert.equal(worker.user.mustChangePassword, false);
  assert.notEqual(worker.cookie, temp.cookie);
  assert.notEqual(worker.csrf, temp.csrf);
  assert.equal((await call("GET", "workspace", undefined, temp)).status, 401);
  const accounts = await call("GET", "auth/accounts", undefined, manager);
  assert.equal(accounts.status, 200);
  for (const text of [
    JSON.stringify(created.body),
    JSON.stringify(accounts.body),
    JSON.stringify((await call("GET", "workspace", undefined, manager)).body),
  ]) {
    assert.doesNotMatch(text, /password_hash|token_hash|csrf_token|scrypt\$/);
    assert.equal(text.includes(password), false);
  }
});
test("worker sees projected stock and only own staff/tasks; management and spoofed actor writes are denied", async () => {
  const state = await call("GET", "workspace", undefined, worker);
  assert.equal(state.status, 200);
  assert.deepEqual(
    state.body.employees.map((e: D.EmployeeDto) => e.id),
    [worker.user.employeeId],
  );
  assert.deepEqual(state.body.shipments, []);
  assert.deepEqual(state.body.activities, []);
  assert.ok(Array.isArray(state.body.addressHolds));
  assert.equal(
    (await call("GET", "stock-ledger", undefined, worker)).status,
    403,
  );
  assert.equal(
    (await call("GET", "auth/accounts", undefined, worker)).status,
    403,
  );
  assert.equal(
    (
      await call(
        "POST",
        "tasks",
        { ...req(), skuId: "sku-cats", boxesTarget: 1 },
        worker,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        "POST",
        `employees/${manager.user.employeeId}/shift`,
        { ...req(), status: "off" },
        worker,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        "POST",
        `employees/${worker.user.employeeId}/shift`,
        { ...req(), status: "working" },
        worker,
      )
    ).status,
    200,
  );
  const s = await w.snapshot(),
    raw = s.pallets.find((p) => p.kind === "raw" && p.quantity > 0)!;
  assert.equal(
    (
      await call(
        "POST",
        "stock-adjustments",
        {
          ...req(),
          kind: "raw_count",
          targetId: raw.id,
          employeeId: worker.user.employeeId,
          expectedLocationId: raw.locationId,
          expectedQuantity: raw.quantity,
          countedQuantity: raw.quantity - 1,
          reason: "Чужое авторство",
        },
        manager,
      )
    ).status,
    403,
  );
});
test("workforce HTTP permissions scope workers to self, manager shift actor differs from subject and strict query bounds are enforced", async () => {
  for (const path of ["performance", "shifts", "work-events"]) {
    assert.equal((await call("GET", path)).status, 401);
    assert.equal(
      (
        await call(
          "GET",
          `${path}?employeeId=${manager.user.employeeId}`,
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
          `${path}?employeeId=${worker.user.employeeId}`,
          undefined,
          worker,
        )
      ).status,
      200,
    );
  }
  const report = await call("GET", "performance", undefined, worker);
  assert.deepEqual(
    report.body.employees.map((e: D.EmployeePerformanceDto) => e.employeeId),
    [worker.user.employeeId],
  );
  assert.equal(
    (await call("GET", "performance", undefined, manager)).body.employees
      .length,
    (await w.snapshot()).employees.length,
  );
  for (const query of [
    "from=2026-02-31",
    "from=2026-10-25&to=2026-10-24",
    "from=2024-01-01&to=2025-01-01",
    "from=2026-10-24T00:00:00Z",
    "employeeId=",
  ])
    assert.equal(
      (await call("GET", `performance?${query}`, undefined, manager)).status,
      400,
    );
  for (const query of ["page=0", "page=NaN", "pageSize=101", "extra=yes"])
    assert.equal(
      (await call("GET", `shifts?${query}`, undefined, manager)).status,
      400,
    );
  assert.equal(
    (
      await call(
        "POST",
        `employees/${worker.user.employeeId}/shift`,
        { ...req(), status: "break" },
        manager,
      )
    ).status,
    200,
  );
  const history = await call(
    "GET",
    `shifts?employeeId=${worker.user.employeeId}`,
    undefined,
    manager,
  );
  assert.equal(history.status, 200);
  const current = history.body.items.find(
    (s: D.ShiftHistoryDto) => s.endedAt === null,
  ) as D.ShiftHistoryDto;
  assert.equal(current.employeeId, worker.user.employeeId);
  assert.equal(
    current.intervals.at(-1)!.actorEmployeeId,
    manager.user.employeeId,
  );
  assert.equal(
    (
      await call(
        "POST",
        `employees/${worker.user.employeeId}/shift`,
        { ...req(), status: "working" },
        manager,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        "POST",
        `employees/${worker.user.employeeId}/shift`,
        { ...req(), status: "off" },
        manager,
      )
    ).status,
    200,
  );
  const ended = await call(
    "GET",
    `shifts?employeeId=${worker.user.employeeId}`,
    undefined,
    manager,
  );
  assert.equal(
    ended.body.items.find((s: D.ShiftHistoryDto) => s.id === current.id)
      .endedByEmployeeId,
    manager.user.employeeId,
  );
  assert.equal(
    (
      await call(
        "POST",
        `employees/${worker.user.employeeId}/shift`,
        { ...req(), status: "working" },
        manager,
      )
    ).status,
    200,
  );
  const explicit = await call(
    "GET",
    `shifts?employeeId=${worker.user.employeeId}`,
    undefined,
    manager,
  );
  assert.equal(
    explicit.body.items.find((s: D.ShiftHistoryDto) => s.endedAt === null)
      .startedByEmployeeId,
    manager.user.employeeId,
  );
});

test("second manager has an independent fingerprint namespace; fresh role changes revoke all sessions and worker replay stays projected", async () => {
  const s = await w.snapshot(),
    employee = s.employees.find(
      (e) =>
        e.id !== manager.user.employeeId && e.id !== worker.user.employeeId,
    )!;
  const password = "Temporary-manager-123";
  assert.equal(
    (
      await call(
        "POST",
        "auth/accounts",
        {
          employeeId: employee.id,
          login: "second-manager",
          role: "manager",
          password,
        },
        manager,
      )
    ).status,
    200,
  );
  const temp = browser(
      await call("POST", "auth/login", { login: "second-manager", password }),
      password,
    ),
    fresh = "Changed-manager-Password2";
  otherManager = browser(
    await call(
      "POST",
      "auth/change-password",
      { currentPassword: password, newPassword: fresh },
      temp,
    ),
    fresh,
  );
  const ownShift = { ...req(), status: "working" };
  const original = await call(
    "POST",
    `employees/${manager.user.employeeId}/shift`,
    ownShift,
    manager,
  );
  assert.equal(original.status, 200);
  const plan = { ...req(), name: "Проверка общего requestId" };
  assert.equal((await call("POST", "warehouse", plan, manager)).status, 200);
  assert.equal(
    (await call("POST", "warehouse", plan, otherManager)).status,
    409,
  );
  assert.equal(
    (
      await call(
        "POST",
        `auth/accounts/${manager.user.id}`,
        { role: "employee" },
        otherManager,
      )
    ).status,
    200,
  );
  assert.equal(
    (await call("GET", "workspace", undefined, manager)).status,
    401,
  );
  const downgraded = browser(
    await call("POST", "auth/login", {
      login: manager.user.login,
      password: manager.password,
    }),
    manager.password,
  );
  const replay = await call(
    "POST",
    `employees/${manager.user.employeeId}/shift`,
    ownShift,
    downgraded,
  );
  assert.equal(replay.status, 200);
  assert.deepEqual(
    replay.body.employees.map((e: D.EmployeeDto) => e.id),
    [manager.user.employeeId],
  );
  assert.deepEqual(replay.body.activities, []);
  assert.equal(
    (
      await call(
        "POST",
        `auth/accounts/${manager.user.id}`,
        { role: "manager" },
        otherManager,
      )
    ).status,
    200,
  );
  manager = browser(
    await call("POST", "auth/login", {
      login: manager.user.login,
      password: manager.password,
    }),
    manager.password,
  );
});
test("block reset and revoke apply to existing sessions immediately; self revoke clears cookie", async () => {
  assert.equal(
    (
      await call(
        "POST",
        `auth/accounts/${worker.user.id}`,
        { blocked: true },
        manager,
      )
    ).status,
    200,
  );
  assert.equal((await call("GET", "workspace", undefined, worker)).status, 401);
  assert.equal(
    (
      await call("POST", "auth/login", {
        login: worker.user.login,
        password: worker.password,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await call(
        "POST",
        `auth/accounts/${worker.user.id}`,
        { blocked: false },
        manager,
      )
    ).status,
    200,
  );
  worker = browser(
    await call("POST", "auth/login", {
      login: worker.user.login,
      password: worker.password,
    }),
    worker.password,
  );
  const old = worker;
  assert.equal(
    (
      await call(
        "POST",
        `auth/accounts/${worker.user.id}/password`,
        { password: "Reset-worker-Password1" },
        manager,
      )
    ).status,
    200,
  );
  assert.equal((await call("GET", "workspace", undefined, old)).status, 401);
  const temp = browser(
    await call("POST", "auth/login", {
      login: worker.user.login,
      password: "Reset-worker-Password1",
    }),
    "Reset-worker-Password1",
  );
  assert.equal((await call("GET", "workspace", undefined, temp)).status, 403);
  worker = browser(
    await call(
      "POST",
      "auth/change-password",
      { currentPassword: temp.password, newPassword: "Final-worker-Password1" },
      temp,
    ),
    "Final-worker-Password1",
  );
  const revoked = await call(
    "POST",
    `auth/accounts/${otherManager.user.id}/revoke-sessions`,
    {},
    otherManager,
  );
  assert.equal(revoked.status, 200);
  assert.match(revoked.cookie!, /Max-Age=0/);
  assert.equal(
    (await call("GET", "workspace", undefined, otherManager)).status,
    401,
  );
});
test("login throttling persists by login before hashing; no unbounded public signup or invalid optional null role", async () => {
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await call("POST", "auth/login", {
          login: "absent-account",
          password: "incorrect",
        })
      ).status,
      401,
    );
  assert.equal(
    (
      await call("POST", "auth/login", {
        login: "absent-account",
        password: "incorrect",
      })
    ).status,
    429,
  );
  assert.equal(
    (
      await call(
        "POST",
        `auth/accounts/${worker.user.id}`,
        { role: null },
        manager,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        "POST",
        `auth/accounts/${worker.user.id}`,
        { blocked: null },
        manager,
      )
    ).status,
    400,
  );
});

test("real worker receiving assembly putaway movement shipping cycle binds every author to logged-in employee and preserves anonymous foreign holds", async () => {
  let result = await call(
    "POST",
    "warehouse",
    { ...req(), width: 100, depth: 100 },
    manager,
  );
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const location = async (code: string, kind: string, x: number) => {
    const r = await call(
      "POST",
      "locations",
      {
        ...req(),
        code,
        name: code,
        kind,
        x,
        y: 30,
        width: 2,
        depth: 2,
        levels: 1,
        maxHeightMm: 2500,
        maxBoxes: 36,
        availableWidthMm: 1400,
        availableDepthMm: 1000,
        accessSides: 4,
      },
      manager,
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.locations.find(
      (l: D.LocationDto) => l.code === code,
    ) as D.LocationDto;
  };
  const rawLoc = await location("AUTH-RAW", "floor", 30),
    dest = await location("AUTH-SHIP", "shipping", 33),
    foreignTarget = await location("AUTH-HOLD", "floor", 36);
  const barcode = `AUTH-CYCLE-${randomUUID()}`;
  result = await call(
    "POST",
    "receipts",
    {
      ...req(),
      receivedAt: "2026-10-01T10:00:00Z",
      pallets: [
        {
          newSku: { name: "Тест входа", barcode, unitsPerBox: 2 },
          quantity: 2,
          widthMm: 1200,
          depthMm: 800,
          heightMm: 500,
        },
      ],
    },
    manager,
  );
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const doc = result.body.receipts.find((r: D.ReceiptDto) =>
    r.pallets.some(
      (p) =>
        result.body.skus.find((s: D.SkuDto) => s.id === p.skuId)?.barcode ===
        barcode,
    ),
  ) as D.ReceiptDto;
  const raw = result.body.pallets.find(
    (p: D.PalletDto) => p.id === doc.pallets[0].palletId,
  ) as D.PalletDto;
  const placeRequest = {
    ...req(),
    employeeId: worker.user.employeeId,
    palletCode: raw.code,
    locationCode: rawLoc.code,
  };
  assert.equal(
    (
      await call(
        "POST",
        `receipts/${doc.id}/pallets/${raw.id}/place`,
        placeRequest,
        worker,
      )
    ).status,
    200,
  );
  result = await call(
    "POST",
    "tasks",
    {
      ...req(),
      skuId: raw.skuId,
      boxesTarget: 1,
      employeeId: worker.user.employeeId,
    },
    manager,
  );
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const task = result.body.tasks.find(
    (t: D.TaskDto) => t.skuId === raw.skuId,
  ) as D.TaskDto;
  assert.equal(
    result.body.activities[0].actorEmployeeId,
    manager.user.employeeId,
  );
  assert.equal(
    (
      await call(
        "POST",
        `tasks/${task.id}/claim`,
        { ...req(), employeeId: manager.user.employeeId },
        manager,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        "POST",
        `tasks/${task.id}/claim`,
        { ...req(), employeeId: worker.user.employeeId },
        worker,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        "POST",
        `tasks/${task.id}/status`,
        { ...req(), employeeId: worker.user.employeeId, status: "paused" },
        worker,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        "POST",
        `tasks/${task.id}/status`,
        { ...req(), employeeId: worker.user.employeeId, status: "active" },
        worker,
      )
    ).status,
    200,
  );
  for (const [kind, value] of [
    ["source", raw.code],
    ["box", task.openBoxCode],
    ["barcode", barcode],
    ["barcode", barcode],
  ]) {
    result = await call(
      "POST",
      `tasks/${task.id}/scan`,
      { ...req(), employeeId: worker.user.employeeId, kind, value },
      worker,
    );
    assert.equal(result.status, 200, JSON.stringify(result.body));
  }
  let full = await w.snapshot();
  const box = full.boxes.find((b) => b.code === task.openBoxCode)!,
    put = full.putawayTasks.find((t) => t.boxId === box.id)!;
  result = await call(
    "POST",
    `putaway-tasks/${put.id}/claim`,
    { ...req(), employeeId: worker.user.employeeId },
    worker,
  );
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const current = result.body.putawayTasks.find(
    (t: D.PutawayTaskDto) => t.id === put.id,
  ) as D.PutawayTaskDto;
  const from = full.locations.find((l) => l.id === current.fromLocationId)!,
    to = full.locations.find((l) => l.id === current.toLocationId)!;
  assert.equal(
    (
      await call(
        "POST",
        `putaway-tasks/${put.id}/take`,
        {
          ...req(),
          employeeId: worker.user.employeeId,
          boxCode: box.code,
          locationCode: from.code,
        },
        worker,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        "POST",
        `putaway-tasks/${put.id}/place`,
        {
          ...req(),
          employeeId: worker.user.employeeId,
          boxCode: box.code,
          locationCode: to.code,
        },
        worker,
      )
    ).status,
    200,
  );
  full = await w.snapshot();
  const finished = full.pallets.find(
    (p) => p.id === full.boxes.find((b) => b.id === box.id)!.palletId,
  )!;
  const movement = async () => {
    const r = await call(
      "POST",
      "movements",
      {
        ...req(),
        palletId: finished.id,
        toLocationId: dest.id,
        kind: "transfer",
        employeeId: worker.user.employeeId,
      },
      manager,
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.activities[0].actorEmployeeId, manager.user.employeeId);
    return r.body.movements.find(
      (m: D.MovementDto) =>
        m.palletId === finished.id && m.status === "planned",
    ) as D.MovementDto;
  };
  let move = await movement();
  assert.equal(
    (await call("POST", `movements/${move.id}/cancel`, req(), manager)).status,
    200,
  );
  move = await movement();
  assert.equal(
    (
      await call(
        "POST",
        `movements/${move.id}/take`,
        { ...req(), palletCode: finished.code, locationCode: to.code },
        manager,
      )
    ).status,
    403,
  );
  const takeRequest = {
    ...req(),
    palletCode: finished.code,
    locationCode: to.code,
  };
  assert.equal(
    (await call("POST", `movements/${move.id}/take`, takeRequest, worker))
      .status,
    200,
  );
  assert.equal(
    (
      await call(
        "POST",
        `movements/${move.id}/place`,
        { ...req(), palletCode: finished.code, locationCode: dest.code },
        worker,
      )
    ).status,
    200,
  );
  const candidate = (await w.snapshot()).pallets.find(
    (p) => p.kind === "raw" && p.quantity > 0 && p.status === "stored",
  )!;
  result = await call(
    "POST",
    "movements",
    {
      ...req(),
      palletId: candidate.id,
      toLocationId: foreignTarget.id,
      kind: "transfer",
      employeeId: manager.user.employeeId,
    },
    manager,
  );
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const foreign = result.body.movements.find(
    (m: D.MovementDto) => m.palletId === candidate.id && m.status === "planned",
  ) as D.MovementDto;
  const incoming = await call(
    "POST",
    "receipts",
    {
      ...req(),
      receivedAt: "2026-10-01T11:00:00Z",
      pallets: [
        {
          skuId: raw.skuId,
          quantity: 1,
          widthMm: 1200,
          depthMm: 800,
          heightMm: 500,
        },
      ],
    },
    manager,
  );
  assert.equal(incoming.status, 200);
  const pending = incoming.body.receipts.find(
    (r: D.ReceiptDto) =>
      r.status === "awaiting_placement" &&
      r.pallets.some((p) => p.skuId === raw.skuId),
  ) as D.ReceiptDto;
  const options = await call(
    "GET",
    `receipts/${pending.id}/pallets/${pending.pallets[0].palletId}/placement-options`,
    undefined,
    worker,
  );
  assert.equal(options.status, 200);
  assert.equal(
    options.body.locations.some(
      (l: D.LocationDto) => l.id === foreignTarget.id,
    ),
    false,
  );
  const projected = await call("GET", "workspace", undefined, worker);
  assert.equal(
    projected.body.movements.some((m: D.MovementDto) => m.id === foreign.id),
    false,
  );
  assert.equal(
    projected.body.addressHolds.some(
      (h: D.AddressHoldDto) =>
        h.locationId === foreignTarget.id && h.kind === "movement",
    ),
    true,
  );
  assert.equal(
    (await call("POST", `movements/${foreign.id}/cancel`, req(), worker))
      .status,
    403,
  );
  assert.equal(
    (await call("POST", `movements/${foreign.id}/cancel`, req(), manager))
      .status,
    200,
  );
  result = await call(
    "POST",
    "shipments",
    { ...req(), skuId: raw.skuId, boxesRequested: 1 },
    manager,
  );
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const shipment = result.body.shipments.find(
    (s: D.ShipmentDto) => s.skuId === raw.skuId,
  ) as D.ShipmentDto;
  const shipRequest = req();
  assert.equal(
    (await call("POST", `shipments/${shipment.id}/ship`, shipRequest, worker))
      .status,
    403,
  );
  assert.equal(
    (await call("POST", `shipments/${shipment.id}/ship`, shipRequest, manager))
      .status,
    200,
  );
  assert.equal(
    (
      await call(
        "POST",
        `pallets/${raw.id}/retire`,
        { ...req(), palletCode: raw.code, locationCode: rawLoc.code },
        worker,
      )
    ).status,
    200,
  );
  const events = await w.getStockLedger({ pageSize: 100 });
  assert.equal(events.summary.reconciled, true);
  assert.equal(
    events.items.find((e) => e.requestId === placeRequest.requestId)!
      .employeeId,
    worker.user.employeeId,
  );
  assert.equal(
    events.items.find((e) => e.requestId === takeRequest.requestId)!.employeeId,
    worker.user.employeeId,
  );
  assert.equal(
    events.items.find((e) => e.requestId === shipRequest.requestId)!.employeeId,
    manager.user.employeeId,
  );
});

test("session expiry and fresh DB role are checked for reads; revocation between guard and cached replay cannot return old state", async () => {
  const ownHash = manager.cookie.split("=")[1];
  const { hashToken } = await import("../src/auth-storage");
  await w.authTransaction((tx) =>
    tx.query("UPDATE auth_accounts SET role='employee' WHERE id=$1", [
      manager.user.id,
    ]),
  );
  assert.equal(
    (await call("GET", "stock-ledger", undefined, manager)).status,
    403,
  );
  const projected = await call("GET", "workspace", undefined, manager);
  assert.equal(projected.status, 200);
  assert.equal(projected.body.employees.length, 1);
  await w.authTransaction((tx) =>
    tx.query("UPDATE auth_accounts SET role='manager' WHERE id=$1", [
      manager.user.id,
    ]),
  );
  const command = { ...req(), name: "Replayed after revoke" };
  assert.equal((await call("POST", "warehouse", command, manager)).status, 200);
  const original = w.updateWarehousePlan.bind(w),
    before = await w.snapshot();
  w.updateWarehousePlan = async (body) => {
    await w.authTransaction((tx) =>
      tx.query("DELETE FROM auth_sessions WHERE token_hash=$1", [
        hashToken(ownHash),
      ]),
    );
    return original(body);
  };
  try {
    assert.equal(
      (await call("POST", "warehouse", command, manager)).status,
      401,
    );
    assert.deepEqual(await w.snapshot(), before);
  } finally {
    w.updateWarehousePlan = original;
  }
  manager = browser(
    await call("POST", "auth/login", {
      login: manager.user.login,
      password: manager.password,
    }),
    manager.password,
  );
  const workerHash = hashToken(worker.cookie.split("=")[1]);
  await w.authTransaction((tx) =>
    tx.query(
      "UPDATE auth_sessions SET expires_at=NOW()-INTERVAL '1 second' WHERE token_hash=$1",
      [workerHash],
    ),
  );
  assert.equal((await call("GET", "workspace", undefined, worker)).status, 401);
});

test("session cookie and persisted login throttle survive API restart with the same SQL database", async () => {
  const original = await call("GET", "auth/session", undefined, manager);
  assert.equal(original.status, 200);
  await app.close();
  app = await createApp();
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
  w = app.get(WarehouseService);
  const restored = await call("GET", "auth/session", undefined, manager);
  assert.deepEqual(restored.body, original.body);
  assert.equal(
    (await call("GET", "workspace", undefined, manager)).status,
    200,
  );
  assert.equal(
    (
      await call("POST", "auth/login", {
        login: "absent-account",
        password: "incorrect",
      })
    ).status,
    429,
  );
});

test("persisted auth and warehouse command responses contain no raw session token or password; per-IP budget rejects even a valid login", async () => {
  const { hashToken } = await import("../src/auth-storage");
  const token = manager.cookie.split("=")[1];
  const storage = await w.authTransaction(async (tx) => ({
    sessions: (
      await tx.query<{ token_hash: string }>(
        "SELECT token_hash FROM auth_sessions",
      )
    ).rows,
    accounts: (
      await tx.query<{ password_hash: string }>(
        "SELECT password_hash FROM auth_accounts",
      )
    ).rows,
    commands: (
      await tx.query<{ response: unknown }>("SELECT response FROM commands")
    ).rows,
    audit: (await tx.query("SELECT * FROM auth_events")).rows,
  }));
  assert.equal(
    storage.sessions.some((s) => s.token_hash === hashToken(token)),
    true,
  );
  assert.equal(
    storage.sessions.some((s) => s.token_hash === token),
    false,
  );
  assert.equal(
    storage.accounts.every((a) =>
      /^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(a.password_hash),
    ),
    true,
  );
  const publicData = JSON.stringify({
    commands: storage.commands,
    audit: storage.audit,
    workspace: await w.snapshot(),
  });
  for (const value of [
    token,
    manager.csrf,
    manager.password,
    worker.password,
    "password_hash",
    "token_hash",
    "scrypt$",
  ])
    assert.equal(publicData.includes(value), false);
  const key = `ip:${hashToken("127.0.0.1")}`;
  const before = await w.authTransaction((tx) =>
    tx.query<{ attempts: number }>(
      "SELECT attempts FROM auth_login_limits WHERE key=$1",
      [key],
    ),
  );
  assert.equal(before.rows.length, 1);
  await w.authTransaction((tx) =>
    tx.query("UPDATE auth_login_limits SET attempts=30 WHERE key=$1", [key]),
  );
  assert.equal(
    (
      await call("POST", "auth/login", {
        login: manager.user.login,
        password: manager.password,
      })
    ).status,
    429,
  );
  await w.authTransaction((tx) =>
    tx.query("UPDATE auth_login_limits SET attempts=$2 WHERE key=$1", [
      key,
      before.rows[0].attempts,
    ]),
  );
  assert.equal(
    (
      await call(
        "POST",
        "auth/login",
        { login: manager.user.login, password: manager.password },
        undefined,
        { Origin: "" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        "POST",
        "auth/login",
        { login: manager.user.login, password: manager.password },
        undefined,
        { "Content-Type": "text/plain" },
      )
    ).status,
    403,
  );
});
