import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ValidationPipe } from "@nestjs/common";
import { WarehouseService } from "../src/warehouse.service";
import * as D from "../src/dto";
const req = () => ({ requestId: randomUUID() });

test("one box scan and one address scan persist carry across restart, advance the same zone and record one placement", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wms-two-scan-putaway-"));
  process.env.WMS_DATA_DIR = dir;
  let w = new WarehouseService();
  try {
    let s = await w.snapshot();
    const actor = s.employees.find((e) => e.status === "working")!.id;
    const raw = s.pallets.find(
      (p) => p.kind === "raw" && p.quantity > 100 && p.skuId !== "sku-cats",
    )!;
    const sku = s.skus.find((x) => x.id === raw.skuId)!;
    s = await w.createTask({
      ...req(),
      skuId: sku.id,
      boxesTarget: 2,
      employeeId: actor,
    });
    const assemblies = s.tasks
      .filter((t) => t.skuId === sku.id && t.status === "queued")
      .slice(-2);
    assert.equal(assemblies.length, 2);
    for (const assembly of assemblies) {
      const current = assembly;
      await w.claimTask(assembly.id, { ...req(), employeeId: actor });
      await w.scanTask(assembly.id, {
        ...req(),
        employeeId: actor,
        kind: "source",
        value: raw.code,
      });
      await w.scanTask(assembly.id, {
        ...req(),
        employeeId: actor,
        kind: "box",
        value: current.openBoxCode,
      });
      for (let j = 0; j < sku.unitsPerBox; j++)
        s = await w.scanTask(assembly.id, {
          ...req(),
          employeeId: actor,
          kind: "barcode",
          value: sku.barcode,
        });
    }
    const boxes = s.boxes.filter((box) =>
      s.putawayTasks.some((t) => t.boxId === box.id),
    );
    assert.equal(boxes.length, 2);
    s = await w.createWorkZone({
      ...req(),
      code: "",
      name: "",
      kind: "putaway",
      locationIds: [boxes[0].locationId!],
    });
    const zone = s.warehouse.workZones.at(-1)!;
    const zoneBody = {
      ...req(),
      employeeId: actor,
      zoneCode: `artmate-wms:work-zone:${zone.id}`,
    };
    s = await w.startZoneWork(zoneBody);
    const binding = () =>
      s.warehouse.zoneWork.find((x) => x.employeeId === actor)!;
    assert.equal(binding().jobId, null);
    assert(
      s.putawayTasks.every((t) => t.status === "queued" && !t.toLocationId),
    );
    const ordered = [...s.putawayTasks].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    const previous = ordered[0];
    const first = ordered[1];
    s = await w.claimPutawayTask(previous.id, { ...req(), employeeId: actor });
    const box = s.boxes.find((b) => b.id === first.boxId)!;
    const total = s.balance.totalUnits;
    const beforeWrong = await w.snapshot();
    await assert.rejects(
      w.takeAnyPutawayBox({ ...req(), employeeId: actor, boxCode: "UNKNOWN" }),
    );
    assert.deepEqual(await w.snapshot(), beforeWrong);
    const take = {
      ...req(),
      employeeId: actor,
      boxCode: `artmate-wms:box:${box.code}`,
    };
    s = await w.takeAnyPutawayBox(take);
    const target = s.locations.find(
      (l) =>
        l.id === s.putawayTasks.find((t) => t.id === first.id)!.toLocationId,
    )!;
    assert.equal(
      s.putawayTasks.find((t) => t.id === previous.id)!.status,
      "queued",
    );
    assert.equal(
      s.putawayTasks.find((t) => t.id === previous.id)!.toLocationId,
      null,
    );
    assert.equal(
      s.putawayTasks.find((t) => t.id === first.id)!.status,
      "in_transit",
    );
    assert.equal(s.boxes.find((b) => b.id === box.id)!.locationId, null);
    assert.equal(s.balance.totalUnits, total);
    const takenState = structuredClone(s);
    await w.onModuleDestroy();
    w = new WarehouseService();
    s = await w.snapshot();
    assert.equal(
      s.putawayTasks.find((t) => t.id === first.id)!.status,
      "in_transit",
    );
    s = await w.startZoneWork({ ...zoneBody, ...req() });
    assert.equal(binding().jobId, first.id);
    assert.deepEqual(await w.takeAnyPutawayBox(take), takenState);
    const place = {
      ...req(),
      employeeId: actor,
      locationCode: `artmate-wms:location:${target.id}`,
    };
    s = await w.placePutawayBox(first.id, place);
    assert.equal(
      s.putawayTasks.find((t) => t.id === first.id)!.status,
      "completed",
    );
    assert.equal(s.boxes.find((b) => b.id === box.id)!.locationId, target.id);
    assert.equal(s.balance.totalUnits, total);
    assert.equal(binding().jobId, null);
    assert.equal(binding().jobKind, null);
    assert.equal(
      s.putawayTasks.find((t) => t.id === previous.id)!.status,
      "queued",
    );
    assert.deepEqual(await w.placePutawayBox(first.id, place), s);
    const events = (await w.getWorkHistory({ pageSize: 100 })).items.filter(
      (e) => e.kind === "putaway_box_placed",
    );
    assert.equal(events.length, 1);
    const ledger = await w.getStockLedger({ pageSize: 100 });
    assert.equal(ledger.summary.reconciled, true);
    const changes = ledger.items.filter(
      (e) => e.requestId === take.requestId || e.requestId === place.requestId,
    );
    assert.equal(changes.length, 2);
    assert(changes.every((e) => e.kind === "putaway" && e.unitsDelta === 0));
    const afterPlace = await w.snapshot();
    await assert.rejects(w.takeAnyPutawayBox({ ...take, ...req() }));
    assert.deepEqual(await w.snapshot(), afterPlace);
    const other = s.employees.find(
      (e) => e.status === "working" && e.id !== actor,
    )!.id;
    await w.startZoneWork({ ...zoneBody, ...req(), employeeId: other });
    const remaining = s.boxes.find((b) => b.id === previous.boxId)!;
    const results = await Promise.allSettled(
      [actor, other].map((employeeId) =>
        w.takeAnyPutawayBox({ ...req(), employeeId, boxCode: remaining.code }),
      ),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    assert.equal(
      (await w.snapshot()).putawayTasks.filter((t) => t.status === "in_transit")
        .length,
      1,
    );
  } finally {
    await w.onModuleDestroy();
    await rm(dir, { recursive: true, force: true });
  }
});

test("single-scan DTOs require their scan and reject obsolete or extra scan fields", async () => {
  const checked = (type: new () => unknown, body: unknown) =>
    new ValidationPipe({
      expectedType: type,
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }).transform(body, { type: "body" });
  const body = { ...req(), employeeId: "employee" };
  await assert.rejects(checked(D.TakePutawayBoxDto, body));
  await assert.rejects(checked(D.PlacePutawayBoxDto, body));
  await checked(D.TakePutawayBoxDto, { ...body, boxCode: "BOX-1" });
  await checked(D.PlacePutawayBoxDto, { ...body, locationCode: "A-1" });
  await assert.rejects(
    checked(D.TakePutawayBoxDto, {
      ...body,
      boxCode: "BOX-1",
      locationCode: "A-1",
    }),
  );
  await assert.rejects(
    checked(D.PlacePutawayBoxDto, {
      ...body,
      boxCode: "BOX-1",
      locationCode: "A-1",
    }),
  );
});
