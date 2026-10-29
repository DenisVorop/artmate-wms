import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { WarehouseService } from "../src/warehouse.service";
import { createApp } from "../src/app";
import { requestAuth } from "../src/auth-context";
import { cookieName } from "../src/auth.controller";
import { hashToken, randomToken } from "../src/auth-storage";
import type { WorkspaceDto } from "../src/dto";
const req = () => ({ requestId: randomUUID() });
const origin = "http://127.0.0.1:3080";
async function highPallet(w: WarehouseService) {
  let s = await w.snapshot();
  const raw = s.pallets.find((p) => p.id === "pallet-raw-0")!;
  const low = s.locations.find((l) => l.id === raw.locationId)!;
  for (const level of [2, 3])
    s = await w.createRackLevel(low.sectionId!, {
      ...req(),
      code: `TEST-HIGH-${level}`,
      name: `Ярус ${level}`,
      maxHeightMm: 2200,
      maxBoxes: 42,
      availableWidthMm: 2000,
      availableDepthMm: 2000,
    });
  const high = s.locations.find(
    (l) => l.sectionId === low.sectionId && l.level === 3,
  )!;
  s = await w.createMovement({
    ...req(),
    palletId: raw.id,
    toLocationId: high.id,
    kind: "transfer",
    employeeId: "employee-3",
  });
  const move = s.movements.find(
    (m) => m.palletId === raw.id && m.status === "planned",
  )!;
  await w.takeMovement(move.id, {
    ...req(),
    palletCode: raw.code,
    locationCode: low.code,
  });
  await w.placeMovement(move.id, {
    ...req(),
    palletCode: raw.code,
    locationCode: high.code,
  });
  return { raw, high, low };
}
async function totals(w: WarehouseService) {
  return w.authTransaction(async (tx) => ({
    ledger: (
      await tx.query<{ n: string }>("SELECT COUNT(*) AS n FROM stock_ledger")
    ).rows[0].n,
    work: (
      await tx.query<{ n: string }>("SELECT COUNT(*) AS n FROM work_events")
    ).rows[0].n,
  }));
}
async function createAutomatic(
  w: WarehouseService,
  palletId: string,
  toLocationId: string,
) {
  await w.authTransaction(async (tx) => {
    const state = await w.stocktakeState(tx);
    await w.applyAutomaticMovements(tx, state, [
      { kind: "create", palletId, toLocationId },
    ]);
  });
  return (await w.snapshot()).movements.find(
    (m) => m.autoPurpose === "accessible_raw" && m.status === "planned",
  )!;
}
test("automatic pallet work reserves only an address, claims atomically, and counts work only after real placement", async () => {
  const oldDir = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = "memory://";
  const w = new WarehouseService();
  try {
    const { raw, high, low } = await highPallet(w),
      before = await w.snapshot(),
      counts = await totals(w);
    const move = await createAutomatic(w, raw.id, low.id);
    let s = await w.snapshot();
    assert.equal(move.employeeId, null);
    assert.equal(move.kind, "transfer");
    assert.equal(move.keepSourceReserved, false);
    assert.deepEqual(s.pallets, before.pallets);
    assert.deepEqual(s.boxes, before.boxes);
    assert.deepEqual(s.tasks, before.tasks);
    assert.deepEqual(s.balance, before.balance);
    assert.deepEqual(await totals(w), counts);
    await assert.rejects(
      w.takeMovement(move.id, {
        ...req(),
        palletCode: raw.code,
        locationCode: high.code,
      }),
      /возьмите/,
    );
    // A younger batch remains in the warehouse, but cannot bypass the older one in movement.
    await assert.rejects(
      w.createTask({ ...req(), skuId: raw.skuId!, boxesTarget: 1 }),
      /Недостаточно/,
    );
    const claim = { ...req(), employeeId: "employee-1" };
    const raced = await Promise.allSettled([
      w.claimMovement(move.id, claim),
      w.claimMovement(move.id, { ...req(), employeeId: "employee-2" }),
    ]);
    assert.equal(raced.filter((r) => r.status === "fulfilled").length, 1);
    s = await w.snapshot();
    assert.equal(
      s.movements.find((m) => m.id === move.id)!.employeeId,
      "employee-1",
    );
    const claimed = await w.claimMovement(move.id, claim);
    assert.equal(
      claimed.movements.find((m) => m.id === move.id)!.employeeId,
      "employee-1",
    );
    assert.deepEqual(await totals(w), counts);
    await assert.rejects(
      w.createTask({ ...req(), skuId: raw.skuId!, boxesTarget: 1 }),
      /Недостаточно/,
    );
    const otherTask = await w.createTask({
      ...req(),
      skuId: "sku-space",
      boxesTarget: 1,
    });
    const task = otherTask.tasks.find((t) => t.skuId === "sku-space")!;
    await assert.rejects(
      w.claimTask(task.id, { ...req(), employeeId: "employee-1" }),
      /перемещение/,
    );
    await w.takeMovement(move.id, {
      ...req(),
      palletCode: raw.code,
      locationCode: high.code,
    });
    s = await w.snapshot();
    assert.equal(s.pallets.find((p) => p.id === raw.id)!.status, "in_transit");
    assert.equal(s.pallets.find((p) => p.id === raw.id)!.locationId, null);
    assert.equal((await totals(w)).work, counts.work);
    const place = { ...req(), palletCode: raw.code, locationCode: low.code };
    const placed = await w.placeMovement(move.id, place);
    assert.equal(
      placed.pallets.find((p) => p.id === raw.id)!.locationId,
      low.id,
    );
    assert.equal(
      placed.pallets.find((p) => p.id === raw.id)!.quantity,
      raw.quantity,
    );
    assert.equal(Number((await totals(w)).work), Number(counts.work) + 1);
    await w.placeMovement(move.id, place);
    assert.equal(Number((await totals(w)).work), Number(counts.work) + 1);
    const resumed = await w.createTask({
      ...req(),
      skuId: raw.skuId!,
      boxesTarget: 1,
    });
    const resumedTask = resumed.tasks.find((t) => t.skuId === raw.skuId)!;
    assert.equal(resumedTask.reservations[0].palletId, raw.id);
  } finally {
    await w.onModuleDestroy();
    if (oldDir === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = oldDir;
  }
});

test("automatic moves revalidate count locks, preserve cancelled history and reject HTTP scheduler use", async () => {
  const oldDir = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = "memory://";
  const w = new WarehouseService();
  try {
    const { raw, high, low } = await highPallet(w);
    const setCount = async (id: string | null) =>
      w.authTransaction(async (tx) => {
        if (!id) {
          await tx.query(
            "DELETE FROM stocktake_rows WHERE document_id='test-count'",
          );
          await tx.query("DELETE FROM stocktakes WHERE id='test-count'");
          return;
        }
        await tx.query(
          "INSERT INTO stocktakes(id,payload) VALUES('test-count',$1)",
          [JSON.stringify({ status: "active", mode: "recount" })],
        );
        await tx.query(
          "INSERT INTO stocktake_rows(document_id,location_id,payload) VALUES('test-count',$1,'{}')",
          [id],
        );
      });
    await setCount(high.id);
    await assert.rejects(createAutomatic(w, raw.id, low.id), /инвентаризац/);
    await setCount(null);
    const move = await createAutomatic(w, raw.id, low.id);
    await setCount(low.id);
    const before = await w.snapshot();
    await assert.rejects(
      w.claimMovement(move.id, { ...req(), employeeId: "employee-1" }),
      /инвентаризац/,
    );
    assert.deepEqual(await w.snapshot(), before);
    await setCount(null);
    await w.authTransaction(async (tx) => {
      const state = await w.stocktakeState(tx);
      await w.applyAutomaticMovements(tx, state, [
        {
          kind: "cancel",
          movementId: move.id,
          reason: "Потребность изменилась",
        },
      ]);
    });
    let s = await w.snapshot();
    assert.equal(
      s.movements.find((m) => m.id === move.id)!.status,
      "cancelled",
    );
    assert.equal(s.pallets.find((p) => p.id === raw.id)!.locationId, high.id);
    const replacement = await createAutomatic(w, raw.id, low.id);
    assert.notEqual(replacement.id, move.id);
    await w.claimMovement(replacement.id, {
      ...req(),
      employeeId: "employee-1",
    });
    await assert.rejects(
      w.authTransaction(async (tx) => {
        const state = await w.stocktakeState(tx);
        await w.applyAutomaticMovements(tx, state, [
          {
            kind: "cancel",
            movementId: replacement.id,
            reason: "Нельзя менять взятое",
          },
        ]);
      }),
      /свободное/,
    );
    await assert.rejects(
      requestAuth.run(
        { http: true, tokenHash: null, csrfToken: null, origin },
        () =>
          w.authTransaction(async (tx) => {
            const state = await w.stocktakeState(tx);
            await w.applyAutomaticMovements(tx, state, []);
          }),
      ),
      /планировщиком/,
    );
    s = await w.snapshot();
    assert.equal(
      s.movements.find((m) => m.id === replacement.id)!.employeeId,
      "employee-1",
    );
  } finally {
    await w.onModuleDestroy();
    if (oldDir === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = oldDir;
  }
});

test("free pallet movement HTTP claim enforces actor, fresh auth, CSRF, DTOs and hides another employee's assignment", async () => {
  const original = {
    WMS_DATA_DIR: process.env.WMS_DATA_DIR,
    WEB_ORIGIN: process.env.WEB_ORIGIN,
    NODE_ENV: process.env.NODE_ENV,
  };
  process.env.WMS_DATA_DIR = "memory://";
  process.env.WEB_ORIGIN = origin;
  process.env.NODE_ENV = "test";
  const app = await createApp();
  try {
    await app.listen(0, "127.0.0.1");
    const w = app.get(WarehouseService),
      base = await app.getUrl();
    const { raw, high, low } = await highPallet(w);
    const move = await createAutomatic(w, raw.id, low.id);
    const people = {
      first: {
        employeeId: "employee-1",
        token: randomToken(),
        csrf: randomToken(),
      },
      second: {
        employeeId: "employee-2",
        token: randomToken(),
        csrf: randomToken(),
      },
      manager: {
        employeeId: "employee-3",
        token: randomToken(),
        csrf: randomToken(),
      },
    };
    await w.authTransaction(async (tx) => {
      for (const [id, person] of Object.entries(people)) {
        await tx.query(
          "INSERT INTO auth_accounts(id,employee_id,login,password_hash,role,must_change_password) VALUES($1,$2,$1,'test-only',$3,FALSE)",
          [id, person.employeeId, id === "manager" ? "manager" : "employee"],
        );
        await tx.query(
          "INSERT INTO auth_sessions(id,account_id,token_hash,csrf_token,expires_at) VALUES($1,$1,$2,$3,NOW()+INTERVAL '1 hour')",
          [id, hashToken(person.token), person.csrf],
        );
      }
    });
    const call = async (
      method: string,
      path: string,
      body?: unknown,
      who?: keyof typeof people,
      headers: Record<string, string> = {},
    ) => {
      const person = who ? people[who] : undefined;
      const r = await fetch(base + "/api/" + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          "X-WMS-Request": "1",
          ...(person
            ? {
                Cookie: `${cookieName()}=${person.token}`,
                "X-WMS-CSRF": person.csrf,
              }
            : {}),
          ...headers,
        },
        ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
      });
      return { status: r.status, body: await r.json() };
    };
    const path = `movements/${move.id}/claim`,
      claim = { ...req(), employeeId: people.first.employeeId };
    assert.equal((await call("POST", path, claim)).status, 401);
    assert.equal(
      (await call("POST", path, claim, "first", { "X-WMS-CSRF": "" })).status,
      403,
    );
    assert.equal(
      (
        await call("POST", path, claim, "first", {
          Origin: "https://evil.invalid",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          "POST",
          path,
          { ...claim, employeeId: people.second.employeeId },
          "first",
        )
      ).status,
      403,
    );
    // The outer actor guard rejects missing/null identities before DTO parsing.
    for (const body of [
      { requestId: randomUUID() },
      { ...claim, employeeId: null },
    ])
      assert.equal((await call("POST", path, body, "first")).status, 403);
    assert.equal(
      (await call("POST", path, { ...claim, unexpected: true }, "first"))
        .status,
      400,
    );
    const visible = (await call("GET", "workspace", undefined, "first"))
      .body as WorkspaceDto;
    assert.ok(visible.movements.some((m) => m.id === move.id));
    assert.equal(
      (
        await call(
          "GET",
          `work-route?kind=movement&id=${move.id}`,
          undefined,
          "first",
        )
      ).status,
      200,
    );
    assert.equal(
      (await call("POST", `movements/${move.id}/cancel`, req(), "first"))
        .status,
      403,
    );
    assert.equal(
      (
        await call(
          "POST",
          `movements/${move.id}/take`,
          { ...req(), palletCode: raw.code, locationCode: high.code },
          "first",
        )
      ).status,
      403,
    );
    const accepted = await call("POST", path, claim, "first");
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal((await call("POST", path, claim, "first")).status, 200);
    assert.equal(
      (
        await call(
          "POST",
          path,
          { ...req(), employeeId: people.second.employeeId },
          "second",
        )
      ).status,
      403,
    );
    const foreign = (await call("GET", "workspace", undefined, "second"))
      .body as WorkspaceDto;
    assert.ok(!foreign.movements.some((m) => m.id === move.id));
    assert.ok(foreign.addressHolds?.some((h) => h.locationId === low.id));
    assert.equal(
      (
        await call(
          "GET",
          `work-route?kind=movement&id=${move.id}`,
          undefined,
          "second",
        )
      ).status,
      403,
    );
    await w.updateShift(people.first.employeeId, { ...req(), status: "break" });
    assert.equal((await call("POST", path, claim, "first")).status, 403);
    await w.updateShift(people.first.employeeId, {
      ...req(),
      status: "working",
    });
    await w.authTransaction((tx) =>
      tx.query("DELETE FROM auth_sessions WHERE account_id='first'"),
    );
    assert.equal((await call("POST", path, claim, "first")).status, 401);
  } finally {
    await app.close();
    for (const [key, value] of Object.entries(original))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});

test("claim requires a working employee without work in progress and rechecks counting before take", async () => {
  const oldDir = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = "memory://";
  const w = new WarehouseService();
  try {
    const { raw, high, low } = await highPallet(w);
    let move = await createAutomatic(w, raw.id, low.id);
    const before = await w.snapshot();
    await assert.rejects(
      w.claimMovement(move.id, { ...req(), employeeId: "employee-4" }),
      /смене/,
    );
    assert.deepEqual(await w.snapshot(), before);
    const withTask = await w.createTask({
      ...req(),
      skuId: "sku-space",
      boxesTarget: 1,
    });
    const task = withTask.tasks.find((t) => t.skuId === "sku-space")!;
    await w.claimTask(task.id, { ...req(), employeeId: "employee-1" });
    await assert.rejects(
      w.claimMovement(move.id, { ...req(), employeeId: "employee-1" }),
      /текущее задание/,
    );
    await w.updateTaskStatus(task.id, {
      ...req(),
      employeeId: "employee-1",
      status: "paused",
    });
    // A clean paused assignment is safe; a partially filled box is not.
    await w.claimMovement(move.id, { ...req(), employeeId: "employee-1" });
    await w.cancelMovement(move.id, req());
    move = await createAutomatic(w, raw.id, low.id);
    await w.claimTask(task.id, { ...req(), employeeId: "employee-1" });
    const s = await w.snapshot();
    const source = s.pallets.find(
      (p) => p.id === task.reservations[0].palletId,
    )!;
    const scan = (kind: "source" | "box" | "barcode", value: string) =>
      w.scanTask(task.id, { ...req(), employeeId: "employee-1", kind, value });
    await scan("source", source.code);
    await scan("box", task.openBoxCode);
    await scan("barcode", s.skus.find((sku) => sku.id === task.skuId)!.barcode);
    await w.updateTaskStatus(task.id, {
      ...req(),
      employeeId: "employee-1",
      status: "paused",
    });
    await assert.rejects(
      w.claimMovement(move.id, { ...req(), employeeId: "employee-1" }),
      /текущее задание/,
    );
    await w.claimMovement(move.id, { ...req(), employeeId: "employee-2" });
    // Existing geometry guards prevent blocking a reserved target at all.
    await assert.rejects(
      w.updateLocation(low.id, { ...req(), blocked: true }),
      /зарезервированный/,
    );
    const blocked = await w.snapshot();
    await w.authTransaction(async (tx) => {
      await tx.query(
        "INSERT INTO stocktakes(id,payload) VALUES('late-count',$1)",
        [JSON.stringify({ status: "active", mode: "recount" })],
      );
      await tx.query(
        "INSERT INTO stocktake_rows(document_id,location_id,payload) VALUES('late-count',$1,'{}')",
        [high.id],
      );
    });
    await assert.rejects(
      w.takeMovement(move.id, {
        ...req(),
        palletCode: raw.code,
        locationCode: high.code,
      }),
      /инвентаризац/,
    );
    assert.deepEqual(await w.snapshot(), blocked);
    assert.equal(
      blocked.pallets.find((p) => p.id === raw.id)!.locationId,
      high.id,
    );
    await w.authTransaction(async (tx) => {
      await tx.query(
        "DELETE FROM stocktake_rows WHERE document_id='late-count'",
      );
      await tx.query("DELETE FROM stocktakes WHERE id='late-count'");
    });
    await w.takeMovement(move.id, {
      ...req(),
      palletCode: raw.code,
      locationCode: high.code,
    });
    await w.placeMovement(move.id, {
      ...req(),
      palletCode: raw.code,
      locationCode: low.code,
    });
    assert.equal(
      (await w.snapshot()).movements.find((m) => m.id === move.id)!.status,
      "completed",
    );
  } finally {
    await w.onModuleDestroy();
    if (oldDir === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = oldDir;
  }
});
