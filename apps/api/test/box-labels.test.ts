import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WarehouseService } from "../src/warehouse.service";
import { BoxLabelService } from "../src/box-label.service";
import { requestAuth, RequestAuthContext } from "../src/auth-context";
import * as D from "../src/dto";
const req = () => ({ requestId: randomUUID() });
const origin = "http://127.0.0.1:3080";
const context = (id: string): RequestAuthContext => ({
  http: true,
  tokenHash: `labels-${id}`,
  csrfToken: `csrf-${id}`,
  origin,
});
const as = <T>(id: string, fn: () => T) => requestAuth.run(context(id), fn);
async function accounts(w: WarehouseService) {
  await w.authTransaction(async (tx) => {
    for (const [id, employee, role] of [
      ["manager", "employee-3", "manager"],
      ["one", "employee-1", "employee"],
      ["two", "employee-2", "employee"],
    ]) {
      await tx.query(
        "INSERT INTO auth_accounts(id,employee_id,login,password_hash,role,must_change_password) VALUES($1,$2,$1,'test-only',$3,FALSE)",
        [id, employee, role],
      );
      await tx.query(
        "INSERT INTO auth_sessions(id,account_id,token_hash,csrf_token,expires_at) VALUES($1,$1,$2,$3,NOW()+INTERVAL '1 hour')",
        [id, `labels-${id}`, `csrf-${id}`],
      );
    }
  });
}
async function task(w: WarehouseService, employeeId: string, boxesTarget = 1) {
  const before = await w.snapshot();
  const state = await w.createTask({
    ...req(),
    skuId: "sku-cats",
    boxesTarget,
    employeeId,
  });
  const t = state.tasks.find((t) => !before.tasks.some((x) => x.id === t.id))!;
  await w.claimTask(t.id, { ...req(), employeeId });
  return t;
}
const scan = (
  w: WarehouseService,
  t: D.TaskDto,
  kind: D.ScanTaskDto["kind"],
  value: string,
  requestId = randomUUID(),
) => w.scanTask(t.id, { requestId, employeeId: t.employeeId!, kind, value });
async function source(w: WarehouseService, t: D.TaskDto) {
  const state = await w.snapshot(),
    current = state.tasks.find((x) => x.id === t.id)!;
  const r = current.reservations.find((r) => r.quantity > 0)!;
  return scan(
    w,
    current,
    "source",
    state.pallets.find((p) => p.id === r.palletId)!.code,
  );
}
test("preprinted labels issue without inventory; actor/working/source checks, atomic race, permanent binding, mixed FIFO, idempotency and restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wms-label-pool-"));
  const old = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = join(dir, "db");
  let w: WarehouseService | undefined;
  try {
    w = new WarehouseService();
    await w.snapshot();
    await accounts(w);
    let service = new BoxLabelService(w);
    const before = await w.snapshot(),
      body = { ...req(), count: 1000 };
    await assert.rejects(
      as("one", () => service.createBoxLabelBatch(body)),
      /руководителя/,
    );
    for (const count of [0, 1001, 2.5])
      await assert.rejects(
        as("manager", () => service.createBoxLabelBatch({ ...req(), count })),
        /1000/,
      );
    const batch = await as("manager", () => service.createBoxLabelBatch(body));
    assert.equal(batch.count, 1000);
    assert.equal(batch.freeCount, 1000);
    assert.deepEqual(await w.snapshot(), before);
    assert.deepEqual(
      await as("manager", () => service.createBoxLabelBatch(body)),
      batch,
    );
    await assert.rejects(
      as("manager", () => service.createBoxLabelBatch({ ...body, count: 3 })),
      /requestId/,
    );
    await assert.rejects(
      w.updateWarehousePlan({ ...body, name: "not allowed" }),
      /requestId/,
    );
    const page = await as("manager", () =>
      service.getBoxLabelBatchLabels(batch.id, {
        pageSize: 100,
        status: "free",
      }),
    );
    assert.equal(page.items.length, 100);
    assert.equal(page.total, 1000);
    assert.equal(new Set(page.items.map((l) => l.code)).size, 100);
    assert.match(page.items[0].svg, /<svg/);
    assert.equal(
      page.items[0].payload,
      `artmate-wms:box:${page.items[0].code}`,
    );
    assert.equal(
      (
        await as("manager", () =>
          service.getBoxLabelBatchLabels(batch.id, { page: 10, pageSize: 100 }),
        )
      ).items.length,
      100,
    );
    await assert.rejects(
      as("one", () => service.getBoxLabelBatches({})),
      /руководителя/,
    );
    const first = await task(w, "employee-1", 2),
      second = await task(w, "employee-2");
    const label = page.items[0],
      spare = page.items[1];
    const beforeBad = await w.snapshot();
    await assert.rejects(
      as("one", () =>
        scan(w!, first, "box", "artmate-wms:box:BOX-PRE-UNKNOWN"),
      ),
      /не зарегистрирована/,
    );
    assert.deepEqual(await w.snapshot(), beforeBad);

    await assert.rejects(
      as("one", () => scan(w!, first, "box", label.payload)),
      /исходную паллету/,
    );
    assert.deepEqual(await w.snapshot(), beforeBad);
    assert.equal(
      (await as("manager", () => service.getBoxLabelBatch(batch.id))).freeCount,
      1000,
    );
    await source(w, first);
    await source(w, second);
    await assert.rejects(
      as("two", () => scan(w!, first, "box", label.code)),
      /себя|сотрудник|вошедш|исполнител|назначен/,
    );
    const race = await Promise.allSettled([
      as("one", () => scan(w!, first, "box", label.payload)),
      as("two", () => scan(w!, second, "box", label.code)),
    ]);
    assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
    const state = await w.snapshot(),
      owner = state.tasks.find((t) => t.openBoxCode === label.code)!;
    const loser = owner.id === first.id ? second : first,
      ownerAuth = owner.employeeId === "employee-1" ? "one" : "two";
    // Resume with the already bound label and fresh request IDs is harmless.
    await w.updateTaskStatus(owner.id, {
      ...req(),
      employeeId: owner.employeeId!,
      status: "paused",
    });
    await assert.rejects(
      scan(w, owner, "box", label.code),
      /актив|приостанов|возьмите/,
    );
    await w.claimTask(owner.id, { ...req(), employeeId: owner.employeeId! });
    const confirmed = await as(ownerAuth, () =>
      scan(w!, owner, "box", label.code),
    );
    const replayBody = {
      ...req(),
      employeeId: owner.employeeId!,
      kind: "box" as const,
      value: label.payload,
    };
    const replay = await as(ownerAuth, () => w!.scanTask(owner.id, replayBody));
    assert.deepEqual(
      await as(ownerAuth, () => w!.scanTask(owner.id, replayBody)),
      replay,
    );
    await assert.rejects(scan(w, owner, "box", spare.code), /текущий короб/);
    const beforeUnits = await w.snapshot();
    const sku = beforeUnits.skus.find((s) => s.id === owner.skuId)!;
    for (let i = 0; i < owner.unitsPerBox; i++) {
      await source(w, owner);
      await as(ownerAuth, () => scan(w!, owner, "barcode", sku.barcode));
    }
    const packed = await w.snapshot(),
      box = packed.boxes.find((b) => b.code === label.code)!;
    assert.ok(box);
    assert.equal(box.units, owner.unitsPerBox);
    assert.equal(
      confirmed.tasks.find((t) => t.id === owner.id)!.boxCodeConfirmed,
      true,
    );
    const assigned = await as("manager", () =>
      service.getBoxLabelBatchLabels(batch.id, { status: "assigned" }),
    );
    assert.equal(assigned.total, 1);
    assert.equal(assigned.items[0].boxId, box.id);
    await assert.rejects(scan(w, loser, "box", label.code), /другим коробом/);
    assert.equal(
      (
        await as("manager", () =>
          service.getBoxLabelBatchLabels(batch.id, { status: "free" }),
        )
      ).total,
      999,
    );
    // Complete the remaining task box with a new label; old remainder + newer FIFO lot mix.
    if (owner.boxesTarget === 2) {
      await source(w, owner);
      await scan(w, owner, "box", spare.code);
      for (let i = 0; i < owner.unitsPerBox; i++) {
        await source(w, owner);
        await scan(w, owner, "barcode", sku.barcode);
      }
      const mixed = (await w.snapshot()).boxes.find(
        (b) => b.code === spare.code,
      )!;
      assert.deepEqual(
        mixed.lotContents.map((c) => c.quantity),
        [10, 10],
      );
    }
    await w.authTransaction((tx) =>
      tx.query("UPDATE auth_accounts SET blocked=TRUE WHERE id='manager'"),
    );
    await assert.rejects(
      as("manager", () => service.createBoxLabelBatch(body)),
      /Сессия|Войдите/,
    );
    await w.authTransaction((tx) =>
      tx.query("UPDATE auth_accounts SET blocked=FALSE WHERE id='manager'"),
    );
    const prior = await w.snapshot();
    await w.onModuleDestroy();
    w = undefined;
    w = new WarehouseService();
    service = new BoxLabelService(w);
    assert.deepEqual(await w.snapshot(), prior);
    assert.equal(
      (await as("manager", () => service.getBoxLabelBatch(batch.id))).count,
      1000,
    );
    assert.deepEqual(
      await as("manager", () => service.createBoxLabelBatch(body)),
      batch,
    );
    assert.equal(
      (await as("manager", () => service.getBoxLabelBatches({}))).total,
      1,
    );
  } finally {
    await w?.onModuleDestroy();
    await rm(dir, { recursive: true, force: true });
    if (old === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = old;
  }
});

test("schema13 adds only registry tables and preserves warehouse, auth, ledger, workforce, stocktakes and replay", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wms-label-migration-"));
  const previous = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = join(dir, "db");
  let w: WarehouseService | undefined;
  try {
    w = new WarehouseService();
    const command = { ...req(), name: "До этикеток" },
      cached = await w.updateWarehousePlan(command);
    await accounts(w);
    const original = await w.snapshot();
    await w.onModuleDestroy();
    w = undefined;
    const { PGlite } = await import("@electric-sql/pglite");
    const db = new PGlite(process.env.WMS_DATA_DIR);
    await db.waitReady;
    await db.exec(
      "DROP TABLE box_label_commands; DROP TABLE preprinted_box_labels; DROP TABLE box_label_batches; UPDATE metadata SET value='12' WHERE key='schema_version'",
    );
    const tables = (
      await db.query<{ tablename: string }>(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'metadata' ORDER BY tablename",
      )
    ).rows.map((r) => r.tablename);
    const snapshots = new Map<string, unknown>();
    for (const t of tables)
      snapshots.set(t, (await db.query(`SELECT * FROM ${t} ORDER BY 1`)).rows);
    const meta = (
      await db.query(
        "SELECT * FROM metadata WHERE key<>'schema_version' ORDER BY key",
      )
    ).rows;
    await db.close();
    w = new WarehouseService();
    assert.deepEqual(await w.snapshot(), original);
    assert.deepEqual(await w.updateWarehousePlan(command), cached);
    await w.authTransaction(async (tx) => {
      for (const t of tables)
        assert.deepEqual(
          (await tx.query(`SELECT * FROM ${t} ORDER BY 1`)).rows,
          snapshots.get(t),
          t,
        );
      assert.deepEqual(
        (
          await tx.query(
            "SELECT * FROM metadata WHERE key<>'schema_version' ORDER BY key",
          )
        ).rows,
        meta,
      );
      assert.equal(
        (
          await tx.query<{ value: string }>(
            "SELECT value FROM metadata WHERE key='schema_version'",
          )
        ).rows[0].value,
        "14",
      );
    });
  } finally {
    await w?.onModuleDestroy();
    await rm(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = previous;
  }
});

test(
  "independent PostgreSQL service instances atomically bind a single free label",
  { skip: !process.env.WMS_LABEL_TEST_DATABASE_URL },
  async () => {
    const { Client } = await import("pg");
    const url = process.env.WMS_LABEL_TEST_DATABASE_URL!,
      database = new Client({ connectionString: url }).database ?? "";
    assert.ok(
      database.endsWith("_test") && database !== "artmate_wms",
      "Label concurrency tests require an isolated _test database",
    );
    const oldDir = process.env.WMS_DATA_DIR,
      oldUrl = process.env.DATABASE_URL;
    delete process.env.WMS_DATA_DIR;
    process.env.DATABASE_URL = url;
    let one: WarehouseService | undefined, two: WarehouseService | undefined;
    try {
      one = new WarehouseService();
      await one.snapshot();
      two = new WarehouseService();
      await two.snapshot();
      const accountId = randomUUID();
      await one.authTransaction(async (tx) => {
        const employee = (await one!.stocktakeState(tx)).employees.find(
          (e) => e.id === "employee-3",
        )!;
        const existing = (
          await tx.query<{ id: string }>(
            "SELECT id FROM auth_accounts WHERE employee_id=$1",
            [employee.id],
          )
        ).rows[0];
        if (existing)
          throw new Error(
            "Use a fresh isolated _test database for the label concurrency fixture",
          );
        await tx.query(
          "INSERT INTO auth_accounts(id,employee_id,login,password_hash,role,must_change_password) VALUES($1,$2,$1,'test-only','manager',FALSE)",
          [accountId, employee.id],
        );
        await tx.query(
          "INSERT INTO auth_sessions(id,account_id,token_hash,csrf_token,expires_at) VALUES($1,$1,'labels-pg','csrf-pg',NOW()+INTERVAL '1 hour')",
          [accountId],
        );
      });
      const service = new BoxLabelService(one),
        batch = await as("pg", () =>
          service.createBoxLabelBatch({ ...req(), count: 1 }),
        ),
        labels = await as("pg", () =>
          service.getBoxLabelBatchLabels(batch.id, {}),
        );
      const first = await task(one, "employee-1"),
        second = await task(two, "employee-2");
      await source(one, first);
      await source(two, second);
      const results = await Promise.allSettled([
        scan(one, first, "box", labels.items[0].code),
        scan(two, second, "box", labels.items[0].payload),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(results.filter((r) => r.status === "rejected").length, 1);
      const state = await one.snapshot();
      assert.equal(
        state.tasks.filter((t) => t.openBoxCode === labels.items[0].code)
          .length,
        1,
      );
      assert.equal(
        (await as("pg", () => service.getBoxLabelBatch(batch.id)))
          .assignedCount,
        1,
      );
    } finally {
      await one?.onModuleDestroy();
      await two?.onModuleDestroy();
      if (oldDir === undefined) delete process.env.WMS_DATA_DIR;
      else process.env.WMS_DATA_DIR = oldDir;
      if (oldUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = oldUrl;
    }
  },
);

test("HTTP blank-label endpoints enforce manager permissions, CSRF, strict DTO and bounded query paging", async () => {
  const previous = process.env.WMS_DATA_DIR,
    previousOrigin = process.env.WEB_ORIGIN,
    previousNode = process.env.NODE_ENV;
  process.env.WMS_DATA_DIR = "memory://";
  process.env.WEB_ORIGIN = origin;
  process.env.NODE_ENV = "test";
  const { createApp } = await import("../src/app"),
    { hashToken } = await import("../src/auth-storage"),
    { cookieName } = await import("../src/auth.controller");
  const app = await createApp();
  try {
    const w = app.get(WarehouseService);
    await accounts(w);
    const managerToken = "M".repeat(43),
      workerToken = "W".repeat(43);
    await w.authTransaction(async (tx) => {
      await tx.query(
        "UPDATE auth_sessions SET token_hash=$1 WHERE id='manager'",
        [hashToken(managerToken)],
      );
      await tx.query("UPDATE auth_sessions SET token_hash=$1 WHERE id='one'", [
        hashToken(workerToken),
      ]);
    });
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    const call = async (
      path: string,
      body?: unknown,
      actor: "manager" | "worker" | "anonymous" = "manager",
      extra: Record<string, string> = {},
    ) => {
      const response = await fetch(`${base}/api/box-label-batches${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          ...(actor === "anonymous"
            ? {}
            : {
                Cookie: `${cookieName()}=${actor === "manager" ? managerToken : workerToken}`,
                "X-WMS-CSRF": actor === "manager" ? "csrf-manager" : "csrf-one",
              }),
          ...extra,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    };
    const body = { ...req(), count: 3 };
    assert.equal((await call("", undefined, "anonymous")).status, 401);
    assert.equal((await call("", body, "worker")).status, 403);
    assert.equal(
      (await call("", body, "manager", { "X-WMS-CSRF": "wrong" })).status,
      403,
    );
    for (const invalid of [
      { ...body, count: 1001 },
      { ...body, count: null },
      { ...body, count: 1.5 },
      { ...body, count: "3" },
      { ...body, employeeId: "spoof" },
    ])
      assert.equal((await call("", invalid)).status, 400);
    const created = await call("", body);
    assert.equal(created.status, 200);
    assert.equal(created.body.count, 3);
    assert.equal((await call("", body)).body.id, created.body.id);
    for (const path of [
      "",
      `/${created.body.id}`,
      `/${created.body.id}/labels`,
    ])
      assert.equal((await call(path, undefined, "worker")).status, 403);
    const page = await call(
      `/${created.body.id}/labels?pageSize=2&status=free`,
    );
    assert.equal(page.status, 200);
    assert.equal(page.body.items.length, 2);
    assert.equal(page.body.total, 3);
    for (const query of ["pageSize=101", "page=0", "status=wrong", "unknown=1"])
      assert.equal(
        (await call(`/${created.body.id}/labels?${query}`)).status,
        400,
      );
    assert.equal((await call("/missing")).status, 404);
    assert.equal(
      (await call("", body, "manager", { Origin: "http://evil.invalid" }))
        .status,
      403,
    );
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = previous;
    if (previousOrigin === undefined) delete process.env.WEB_ORIGIN;
    else process.env.WEB_ORIGIN = previousOrigin;
    if (previousNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNode;
  }
});

test("preprinted mixed FIFO box rolls back final capacity failure including registry, ledger and workforce, then closes once on retry", async () => {
  const previous = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = "memory://";
  let w: WarehouseService | undefined;
  try {
    w = new WarehouseService();
    await w.snapshot();
    await accounts(w);
    const service = new BoxLabelService(w);
    const batch = await as("manager", () =>
      service.createBoxLabelBatch({ ...req(), count: 2 }),
    );
    const labels = (
      await as("manager", () =>
        service.getBoxLabelBatchLabels(batch.id, { status: "free" }),
      )
    ).items;
    const t = await task(w, "employee-1", 2),
      barcode = (await w.snapshot()).skus.find(
        (s) => s.id === t.skuId,
      )!.barcode;
    await source(w, t);
    await as("one", () => scan(w!, t, "box", labels[0].payload));
    for (let i = 0; i < 20; i++)
      await as("one", () => scan(w!, t, "barcode", barcode));
    const firstState = await w.snapshot(),
      firstBox = firstState.boxes.find((b) => b.code === labels[0].code)!;
    assert.deepEqual(
      firstBox.lotContents.map((c) => c.quantity),
      [20],
    );
    const accumulator = firstState.pallets.find(
      (p) => p.id === firstBox.palletId,
    )!;
    await w.updateLocation(accumulator.locationId!, { ...req(), maxBoxes: 1 });
    await source(w, t);
    await as("one", () => scan(w!, t, "box", labels[1].code));
    for (let i = 0; i < 19; i++) {
      await source(w, t);
      await as("one", () => scan(w!, t, "barcode", barcode));
    }
    const before = await w.snapshot(),
      current = before.tasks.find((x) => x.id === t.id)!;
    assert.equal(current.scannedUnits, 19);
    assert.deepEqual(
      current.openBoxContents.map((c) => c.quantity),
      [10, 9],
    );
    const persisted = () =>
      w!.authTransaction(async (tx) => ({
        ledger: (await tx.query("SELECT * FROM stock_ledger ORDER BY id")).rows,
        work: (await tx.query("SELECT * FROM work_events ORDER BY id")).rows,
        labels: (
          await tx.query("SELECT * FROM preprinted_box_labels ORDER BY id")
        ).rows,
        commands: (await tx.query("SELECT * FROM commands ORDER BY request_id"))
          .rows,
      }));
    const prior = await persisted(),
      final = {
        ...req(),
        employeeId: t.employeeId!,
        kind: "barcode" as const,
        value: barcode,
      };
    await assert.rejects(
      as("one", () => w!.scanTask(t.id, final)),
      /вместимость|заполнена/,
    );
    assert.deepEqual(await w.snapshot(), before);
    assert.deepEqual(await persisted(), prior);
    const assigned = await as("manager", () =>
      service.getBoxLabelBatchLabels(batch.id, { status: "assigned" }),
    );
    assert.equal(assigned.total, 2);
    assert.equal(
      assigned.items.find((l) => l.code === labels[1].code)!.boxId,
      null,
    );
    await w.updateLocation(accumulator.locationId!, { ...req(), maxBoxes: 2 });
    const beforeSuccess = await persisted(),
      closed = await as("one", () => w!.scanTask(t.id, final));
    const second = closed.boxes.find((b) => b.code === labels[1].code)!;
    assert.deepEqual(
      second.lotContents.map((c) => c.quantity),
      [10, 10],
    );
    assert.equal(closed.balance.totalUnits, before.balance.totalUnits);
    assert.equal(closed.tasks.find((x) => x.id === t.id)!.status, "completed");
    assert.equal(
      closed.boxes.filter((b) => b.code === labels[1].code).length,
      1,
    );
    const afterSuccess = await persisted();
    assert.equal(afterSuccess.work.length, beforeSuccess.work.length + 1);
    assert.equal(
      (
        await as("manager", () =>
          service.getBoxLabelBatchLabels(batch.id, { status: "assigned" }),
        )
      ).items.find((l) => l.code === labels[1].code)!.boxId,
      second.id,
    );
    assert.deepEqual(await as("one", () => w!.scanTask(t.id, final)), closed);
    assert.deepEqual(await persisted(), afterSuccess);
  } finally {
    await w?.onModuleDestroy();
    if (previous === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = previous;
  }
});
