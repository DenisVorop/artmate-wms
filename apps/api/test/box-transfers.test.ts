import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createApp } from "../src/app";
import { WarehouseService } from "../src/warehouse.service";
import { cookieName } from "../src/auth.controller";
import { hashToken, randomToken } from "../src/auth-storage";
import { putawayPlacementError } from "../src/physical";
import type { WorkspaceDto } from "../src/dto";

const req = () => ({ requestId: randomUUID() });
const origin = "http://127.0.0.1:3080";

test("manager creates two reserved box transfers; a zoned worker scans source, box and destination without changing quantity or lot history", async () => {
  const previous = {
    WMS_DATA_DIR: process.env.WMS_DATA_DIR,
    NODE_ENV: process.env.NODE_ENV,
    WEB_ORIGIN: process.env.WEB_ORIGIN,
  };
  Object.assign(process.env, {
    WMS_DATA_DIR: "memory://",
    NODE_ENV: "test",
    WEB_ORIGIN: origin,
  });
  const app = await createApp();
  try {
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl(),
      w = app.get(WarehouseService);
    let state = await w.snapshot();
    const target = state.locations.find((l) => l.id === "loc-7")!;
    await w.updateLocation(target.id, { ...req(), maxBoxes: 18 });
    const boxIds: string[] = [];
    for (let index = 0; index < 2; index++) {
      const oldTasks = new Set(state.tasks.map((t) => t.id));
      state = await w.createTask({
        ...req(),
        skuId: "sku-space",
        boxesTarget: 1,
      });
      const task = state.tasks.find((t) => !oldTasks.has(t.id))!;
      const source = state.pallets.find(
        (p) => p.id === task.reservations[0].palletId,
      )!;
      await w.claimTask(task.id, { ...req(), employeeId: "employee-1" });
      await w.scanTask(task.id, {
        ...req(),
        employeeId: "employee-1",
        kind: "source",
        value: source.code,
      });
      await w.scanTask(task.id, {
        ...req(),
        employeeId: "employee-1",
        kind: "box",
        value: task.openBoxCode,
      });
      for (let n = 0; n < 20; n++)
        state = await w.scanTask(task.id, {
          ...req(),
          employeeId: "employee-1",
          kind: "barcode",
          value: "4601234000028",
        });
      const box = state.boxes.find((b) => b.code === task.openBoxCode)!;
      boxIds.push(box.id);
      const putaway = state.putawayTasks.find((t) => t.boxId === box.id)!;
      state = await w.claimPutawayTask(putaway.id, {
        ...req(),
        employeeId: "employee-1",
      });
      const claimed = state.putawayTasks.find((t) => t.id === putaway.id)!;
      await w.takePutawayBox(putaway.id, {
        ...req(),
        employeeId: "employee-1",
        boxCode: box.code,
      });
      state = await w.placePutawayBox(putaway.id, {
        ...req(),
        employeeId: "employee-1",
        locationCode: state.locations.find(
          (l) => l.id === claimed.toLocationId,
        )!.code,
      });
    }
    assert.equal(
      new Set(
        boxIds.map((id) => state.boxes.find((b) => b.id === id)!.locationId),
      ).size,
      1,
    );
    const sourceId = state.boxes.find((b) => b.id === boxIds[0])!.locationId!;
    const source = state.locations.find((l) => l.id === sourceId)!;
    await w.updateLocation(target.id, {
      ...req(),
      blocked: false,
      maxBoxes: 19,
    });
    state = await w.createWorkZone({
      ...req(),
      code: "TRANSFER-ZONE",
      name: "Размещение",
      kind: "putaway",
      locationIds: ["loc-assembly"],
    });
    const zone = state.warehouse.workZones.find(
      (z) => z.code === "TRANSFER-ZONE",
    )!;
    const identities = {
      manager: { token: randomToken(), csrf: randomToken() },
      worker: { token: randomToken(), csrf: randomToken() },
    };
    await w.authTransaction(async (tx) => {
      for (const role of ["manager", "worker"] as const) {
        await tx.query(
          "INSERT INTO auth_accounts(id,employee_id,login,password_hash,role,must_change_password) VALUES($1,$2,$1,'test-only',$3,FALSE)",
          [
            role,
            role === "manager" ? "employee-3" : "employee-1",
            role === "manager" ? "manager" : "employee",
          ],
        );
        await tx.query(
          "INSERT INTO auth_sessions(id,account_id,token_hash,csrf_token,expires_at) VALUES($1,$1,$2,$3,NOW()+INTERVAL '1 hour')",
          [role, hashToken(identities[role].token), identities[role].csrf],
        );
      }
    });
    async function call(
      path: string,
      body?: unknown,
      role: keyof typeof identities | null = "worker",
      method = "POST",
      headers: Record<string, string> = {},
    ) {
      const identity = role ? identities[role] : undefined;
      const r = await fetch(`${base}/api${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          "X-WMS-Request": "1",
          ...(identity
            ? {
                Cookie: `${cookieName()}=${identity.token}`,
                "X-WMS-CSRF": identity.csrf,
              }
            : {}),
          ...headers,
        },
        ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
      });
      return { status: r.status, body: await r.json() };
    }
    const body = { ...req(), boxIds, toLocationId: target.id, zoneId: zone.id };
    assert.equal((await call("/box-transfers", body, null)).status, 401);
    assert.equal((await call("/box-transfers", body)).status, 403);
    assert.equal(
      (
        await call("/box-transfers", body, "manager", "POST", {
          "X-WMS-CSRF": "",
        })
      ).status,
      403,
    );
    assert.equal(
      (await call("/box-transfers", { ...body, unknown: true }, "manager"))
        .status,
      400,
    );
    const before = await w.snapshot();
    const overflow = await call("/box-transfers", body, "manager");
    assert.equal(overflow.status, 400, JSON.stringify(overflow.body));
    assert.deepEqual(await w.snapshot(), before);
    await w.updateLocation(target.id, { ...req(), maxBoxes: 20 });
    const initial = await w.snapshot();
    const created = await call("/box-transfers", body, "manager");
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const transfers = created.body.putawayTasks.filter(
      (t: any) => t.transferZoneId === zone.id,
    );
    assert.equal(transfers.length, 2);
    assert.ok(
      transfers.every(
        (t: any) =>
          t.status === "queued" &&
          t.employeeId === null &&
          t.toLocationId === target.id,
      ),
    );
    assert.deepEqual(created.body.boxes, initial.boxes);
    assert.deepEqual(created.body.pallets, initial.pallets);
    assert.deepEqual(
      (await call("/box-transfers", body, "manager")).body,
      created.body,
    );
    assert.match(
      putawayPlacementError(
        created.body,
        created.body.locations.find((l: any) => l.id === target.id),
        created.body.boxes.find((b: any) => b.id === boxIds[0]),
      )!,
      /вместимость/,
    );
    await assert.rejects(
      w.createShipment({ ...req(), skuId: "sku-space", boxesRequested: 19 }),
      /короб/,
    );
    const scanZone = async (intent: "show-offer" | "take-job", id?: string) =>
      call("/work-zones/start", {
        ...req(),
        employeeId: "employee-1",
        zoneCode: `artmate-wms:work-zone:${zone.id}`,
        intent,
        ...(id ? { expectedJobId: id } : {}),
      });
    let offered = await scanZone("show-offer");
    assert.equal(offered.status, 200, JSON.stringify(offered.body));
    assert.equal(
      offered.body.zoneOffers.filter((o: any) => o.zoneId === zone.id).length,
      2,
    );
    for (const task of transfers) {
      const taken = await scanZone("take-job", task.id);
      assert.equal(taken.status, 200, JSON.stringify(taken.body));
      const box = created.body.boxes.find((b: any) => b.id === task.boxId);
      const takeBody = {
        ...req(),
        employeeId: "employee-1",
        boxCode: box.code,
        locationCode: "WRONG",
      };
      assert.equal(
        (await call(`/putaway-tasks/${task.id}/take`, takeBody)).status,
        400,
      );
      assert.equal(
        (
          await call(`/putaway-tasks/${task.id}/take-box`, {
            ...req(),
            employeeId: "employee-1",
            boxCode: box.code,
          })
        ).status,
        400,
      );
      const carried = await call(`/putaway-tasks/${task.id}/take`, {
        ...takeBody,
        ...req(),
        locationCode: source.code,
      });
      assert.equal(carried.status, 200, JSON.stringify(carried.body));
      assert.equal(carried.body.balance.totalUnits, initial.balance.totalUnits);
      assert.equal(
        carried.body.boxes.find((b: any) => b.id === box.id).status,
        "in_transit",
      );
      assert.equal(
        (
          await call(`/putaway-tasks/${task.id}/place-box`, {
            ...req(),
            employeeId: "employee-1",
            locationCode: source.code,
          })
        ).status,
        400,
      );
      const place = {
        ...req(),
        employeeId: "employee-1",
        locationCode: target.code,
      };
      const placed = await call(`/putaway-tasks/${task.id}/place-box`, place);
      assert.equal(placed.status, 200, JSON.stringify(placed.body));
      assert.equal(
        placed.body.boxes.find((b: any) => b.id === box.id).locationId,
        target.id,
      );
      assert.equal(placed.body.balance.totalUnits, initial.balance.totalUnits);
      assert.deepEqual(
        (await call(`/putaway-tasks/${task.id}/place-box`, place)).body,
        placed.body,
      );
      assert.deepEqual(
        placed.body.boxes.find((b: any) => b.id === box.id).lotContents,
        box.lotContents,
      );
      offered = await scanZone("show-offer");
      assert.equal(offered.status, 200, JSON.stringify(offered.body));
    }
    state = await w.snapshot();
    assert.equal(
      state.pallets.find(
        (p) => p.locationId === target.id && p.kind === "finished",
      )!.quantity,
      20,
    );
    assert.ok(
      transfers.every(
        (t: any) =>
          state.putawayTasks.find((p) => p.id === t.id)!.status === "completed",
      ),
    );
    const ledger = await call("/stock-ledger", undefined, "manager", "GET");
    assert.equal(ledger.status, 200);
    assert.equal(ledger.body.summary.reconciled, true);
  } finally {
    await app.close();
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});
