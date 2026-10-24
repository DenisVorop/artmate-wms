import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { seedWorkspace } from "../src/seed";
import { WarehouseService } from "../src/warehouse.service";

test("versioned legacy migration preserves all IDs, QR, stock, completed shipments and cached commands across restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "artmate-wms-migration-"));
  const databasePath = join(dir, "db");
  const oldEnv = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = databasePath;
  const legacy = seedWorkspace();
  legacy.entrances = [
    {
      id: "legacy-entrance-v3",
      name: "Прежний вход",
      wall: "north",
      offset: 0,
      width: 1,
      archived: false,
      archivedAt: null,
    },
  ];
  legacy.locations[0].levels = 3;
  legacy.locations.push({
    ...legacy.locations[0],
    id: "legacy-overlap",
    code: "LEGACY-OVERLAP",
    kind: "floor",
    levels: 1,
  });
  legacy.boxes[0].status = "shipped";
  legacy.pallets.find((p: any) => p.id === legacy.boxes[0].palletId).quantity--;
  legacy.shipments.push({
    id: "legacy-shipment",
    code: "LEGACY-SHIP",
    skuId: legacy.boxes[0].skuId,
    boxesRequested: 1,
    status: "shipped",
    boxIds: [legacy.boxes[0].id],
  });
  const replay = {
    requestId: "legacy-replay",
    skuId: "sku-cats",
    boxesTarget: 1,
  };
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(["createTask", replay]))
    .digest("hex");
  const db = new PGlite(databasePath);
  await db.waitReady;
  for (const [table, rows] of Object.entries(legacy)) {
    await db.exec(
      `CREATE TABLE ${table}(id TEXT PRIMARY KEY,payload JSONB NOT NULL)`,
    );
    for (const entity of rows as any[])
      await db.query(`INSERT INTO ${table}(id,payload) VALUES ($1,$2)`, [
        entity.id,
        JSON.stringify(entity),
      ]);
  }
  await db.exec(
    "CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO metadata VALUES ('seeded','1'); CREATE TABLE commands(request_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,response JSONB NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW())",
  );
  await db.query(
    "INSERT INTO commands(request_id,fingerprint,response) VALUES ($1,$2,$3)",
    [replay.requestId, fingerprint, JSON.stringify(legacy)],
  );
  await db.close();
  let warehouse: WarehouseService | null = null;
  try {
    warehouse = new WarehouseService();
    assert.equal((await warehouse.snapshot()).revision, 0);
    await warehouse.updateShift("employee-3", {
      requestId: "legacy-shift-after-v3",
      status: "working",
    });
    const migrated = await warehouse.snapshot();
    assert.deepEqual(migrated.receipts, []);
    assert.equal(migrated.balance.awaitingPlacementUnits, 0);
    assert.equal(
      migrated.balance.totalUnits,
      migrated.pallets
        .filter((p) => p.kind === "raw")
        .reduce((sum, p) => sum + p.quantity, 0) +
        migrated.boxes
          .filter((b) => b.status === "stored")
          .reduce((sum, b) => sum + b.units, 0),
    );
    assert.equal(migrated.aisles.length, 0);
    assert.equal(migrated.entrances.length, 1);
    assert.equal(migrated.entrances[0].id, "legacy-entrance-v3");
    assert.equal(migrated.entrances[0].spaceId, null);
    assert.equal(migrated.warehouse.layoutMode, "rectangle");
    assert.deepEqual(migrated.warehouse.spaces, []);
    assert.ok(migrated.warehouse.width >= 24);
    assert.ok(migrated.warehouse.depth >= 16);
    const overlap = migrated.locations.find((l) => l.id === "legacy-overlap")!;
    assert.equal(overlap.x, legacy.locations[0].x);
    assert.equal(overlap.y, legacy.locations[0].y);
    assert.equal(overlap.rotation, 0);
    assert.equal(overlap.archived, false);
    assert.ok(
      migrated.sections.every(
        (section) =>
          section.rotation === 0 &&
          !section.archived &&
          section.archivedAt === null,
      ),
    );
    for (const key of Object.keys(legacy) as Array<keyof typeof legacy>) {
      const oldIds = (legacy[key] as any[]).map((x) => x.id);
      const newIds = (migrated as any)[key].map((x: any) => x.id);
      for (const id of oldIds)
        assert.ok(newIds.includes(id), `${String(key)} preserves ${id}`);
    }
    assert.equal(
      migrated.pallets.reduce((sum, p) => sum + p.quantity, 0),
      legacy.pallets.reduce((sum: number, p: any) => sum + p.quantity, 0),
    );
    assert.deepEqual(migrated.shipments, legacy.shipments);
    const original = migrated.locations.find(
      (l) => l.id === legacy.locations[0].id,
    )!;
    assert.equal(original.code, legacy.locations[0].code);
    assert.equal(original.level, 1);
    assert.equal(
      migrated.locations.filter((l) => l.sectionId === original.sectionId)
        .length,
      3,
    );
    assert.equal(
      (await warehouse.getLabel("location", original.id)).payload,
      `artmate-wms:location:${original.id}`,
    );
    assert.equal(migrated.pallets[0].widthMm, 1200);
    assert.equal(migrated.pallets[0].depthMm, 800);
    const cached = await warehouse.createTask(replay);
    assert.equal((cached as any).sections, undefined);
    assert.equal((cached as any).revision, undefined);
    assert.equal((await warehouse.snapshot()).revision, migrated.revision);
    assert.equal((await warehouse.snapshot()).tasks.length, 0);
    await warehouse.onModuleDestroy();
    warehouse = new WarehouseService();
    assert.deepEqual(await warehouse.snapshot(), migrated);
  } finally {
    if (warehouse) await warehouse.onModuleDestroy();
    if (oldEnv === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = oldEnv;
    await rm(dir, { recursive: true, force: true });
  }
});

test("v4 migration keeps a clean v3 plan empty, preserves revision and cached v3 responses across restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "artmate-wms-empty-spaces-"));
  const databasePath = join(dir, "db");
  const oldEnv = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = databasePath;
  const tableNames = [
    "aisles",
    "entrances",
    "sections",
    "movements",
    "skus",
    "locations",
    "lots",
    "pallets",
    "boxes",
    "tasks",
    "employees",
    "shipments",
    "activities",
  ];
  const oldPlan = { name: "Чистый прежний склад", width: 24, depth: 16 };
  const legacy: any = { revision: 5, warehouse: oldPlan };
  for (const table of tableNames) legacy[table] = [];
  const replay = { requestId: "v3-empty-replay", name: "Исторический ответ" };
  const hash = createHash("sha256")
    .update(JSON.stringify(["updateWarehousePlan", replay]))
    .digest("hex");
  const db = new PGlite(databasePath);
  await db.waitReady;
  for (const table of tableNames)
    await db.exec(
      `CREATE TABLE ${table}(id TEXT PRIMARY KEY,payload JSONB NOT NULL)`,
    );
  await db.exec(
    "CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE commands(request_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,response JSONB NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW())",
  );
  for (const [key, value] of [
    ["seeded", "1"],
    ["schema_version", "3"],
    ["workspace_revision", "7"],
    ["warehouse", JSON.stringify(oldPlan)],
  ])
    await db.query("INSERT INTO metadata(key,value) VALUES ($1,$2)", [
      key,
      value,
    ]);
  await db.query(
    "INSERT INTO commands(request_id,fingerprint,response) VALUES ($1,$2,$3)",
    [replay.requestId, hash, JSON.stringify(legacy)],
  );
  await db.close();
  let warehouse: WarehouseService | null = null;
  try {
    warehouse = new WarehouseService();
    const migrated = await warehouse.snapshot();
    assert.equal(migrated.revision, 7);
    assert.deepEqual(migrated.receipts, []);
    assert.deepEqual(migrated.balance, {
      rawUnits: 0,
      workInProgressUnits: 0,
      boxedUnits: 0,
      totalUnits: 0,
      awaitingPlacementUnits: 0,
      awaitingPlacementPallets: 0,
    });
    assert.deepEqual(migrated.warehouse, {
      ...oldPlan,
      layoutMode: "rectangle",
      spaces: [],
      workZones: [],
      zoneWork: [],
    });
    for (const table of tableNames)
      assert.deepEqual((migrated as any)[table], []);
    const cached = await warehouse.updateWarehousePlan(replay);
    assert.equal(cached.revision, 5);
    assert.equal((cached.warehouse as any).layoutMode, undefined);
    assert.deepEqual(await warehouse.snapshot(), migrated);
    let s = await warehouse.updateWarehousePlan({
      requestId: "empty-to-spaces",
      layoutMode: "spaces",
    });
    assert.equal(s.revision, 8);
    assert.deepEqual(s.warehouse.spaces, []);
    assert.equal(s.locations.length, 0);
    assert.equal(s.skus.length, 0);
    s = await warehouse.createSpace({
      requestId: "first-empty-room",
      name: "Первое помещение",
      kind: "room",
      x: 0,
      y: 0,
      width: 10,
      depth: 10,
    });
    const id = s.warehouse.spaces[0].id;
    s = await warehouse.deleteSpace(id, {
      requestId: "delete-last-empty-room",
    });
    assert.equal(s.warehouse.layoutMode, "spaces");
    assert.equal(
      s.warehouse.spaces.filter((space) => !space.archived).length,
      0,
    );
    const saved = s;
    await warehouse.onModuleDestroy();
    warehouse = new WarehouseService();
    assert.deepEqual(await warehouse.snapshot(), saved);
    assert.equal(saved.warehouse.spaces[0].id, id);
    assert.equal(saved.warehouse.spaces[0].archived, true);
    // A truly empty migrated warehouse can create staff and SKU without demo data or locations.
    s = await warehouse.createEmployee({
      requestId: "empty-first-employee",
      name: "Первый Сотрудник",
    });
    const employee = s.employees[0];
    await warehouse.updateShift(employee.id, {
      requestId: "empty-shift",
      status: "working",
    });
    s = await warehouse.createReceipt({
      requestId: "empty-receipt",
      receivedAt: "2026-10-01T00:00:00Z",
      pallets: [
        { newSku: { name: "Первая тема", barcode: "EMPTY-SKU" }, quantity: 25 },
      ],
    });
    const receipt = s.receipts[0],
      pallet = s.pallets[0];
    assert.equal(s.balance.totalUnits, 0);
    assert.equal(s.balance.awaitingPlacementUnits, 25);
    const options = await warehouse.getReceiptPlacementOptions(
      receipt.id,
      pallet.id,
    );
    assert.equal(options.suggestedLocationId, null);
    assert.ok(options.reason);
    assert.equal(
      (await warehouse.getReceiptLabels(receipt.id)).labels[0].quantity,
      25,
    );
    const pending = await warehouse.snapshot();
    await warehouse.onModuleDestroy();
    warehouse = new WarehouseService();
    assert.deepEqual(await warehouse.snapshot(), pending);
    s = await warehouse.createSpace({
      requestId: "empty-new-room",
      name: "Помещение приёмки",
      kind: "room",
      x: 0,
      y: 0,
      width: 10,
      depth: 10,
    });
    s = await warehouse.createLocation({
      requestId: "empty-new-cell",
      code: "FIRST",
      name: "Первое место",
      kind: "floor",
      x: 1,
      y: 1,
      width: 2,
      depth: 2,
      levels: 1,
      maxHeightMm: 2000,
      maxBoxes: 20,
      availableWidthMm: 1400,
      availableDepthMm: 1000,
      accessSides: 1,
    });
    s = await warehouse.placeReceiptPallet(receipt.id, pallet.id, {
      requestId: "empty-place",
      employeeId: employee.id,
      palletCode: pallet.code,
      locationCode: s.locations[0].code,
    });
    assert.equal(s.balance.totalUnits, 25);
    assert.equal(s.balance.awaitingPlacementUnits, 0);
    assert.equal(s.receipts[0].status, "completed");
    const completed = await warehouse.snapshot();
    await warehouse.onModuleDestroy();
    warehouse = new WarehouseService();
    assert.deepEqual(await warehouse.snapshot(), completed);
  } finally {
    if (warehouse) await warehouse.onModuleDestroy();
    if (oldEnv === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = oldEnv;
    await rm(dir, { recursive: true, force: true });
  }
});

test("v6 keeps legacy task IDs WIP provenance QR and revisions, recovers a full box and skips unavailable queued sources across restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "artmate-wms-assembly-v6-"));
  const path = join(dir, "db"),
    oldEnv = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = path;
  let warehouse: WarehouseService | null = null;
  try {
    warehouse = new WarehouseService();
    let s = await warehouse.createTask({
      requestId: "legacy-full-task",
      skuId: "sku-cats",
      boxesTarget: 1,
      employeeId: "employee-1",
    });
    const full = s.tasks[0];
    const beforeBlockedIds = s.tasks.map((t) => t.id);
    s = await warehouse.createTask({
      requestId: "legacy-blocked-task",
      skuId: "sku-dinos",
      boxesTarget: 1,
      employeeId: "employee-1",
    });
    const blocked = s.tasks.find((t) => !beforeBlockedIds.includes(t.id))!;
    const previousIds = s.tasks.map((t) => t.id);
    s = await warehouse.createTask({
      requestId: "legacy-next-task",
      skuId: "sku-cats",
      boxesTarget: 1,
      employeeId: "employee-1",
    });
    const next = s.tasks.find((t) => !previousIds.includes(t.id))!;
    const partialIds = s.tasks.map((t) => t.id);
    s = await warehouse.createTask({
      requestId: "legacy-partial-task",
      skuId: "sku-space",
      boxesTarget: 1,
      employeeId: "employee-2",
    });
    const partial = s.tasks.find((t) => !partialIds.includes(t.id))!;
    await warehouse.onModuleDestroy();
    warehouse = null;
    const db = new PGlite(path);
    await db.waitReady;
    // Reproduce a persisted v5 snapshot, with real pre-existing stock already transferred into WIP.
    const fixture = structuredClone(s);
    for (const task of fixture.tasks) {
      delete (task as any).createdAt;
      delete (task as any).boxCodeConfirmed;
      if (task.id === full.id || task.id === partial.id) {
        const count = task.id === full.id ? task.unitsPerBox : 1;
        const r = task.reservations.find((r) => r.quantity > 0)!;
        fixture.pallets.find((p) => p.id === r.palletId)!.quantity -= count;
        r.quantity -= count;
        task.scannedUnits = count;
        task.openBoxContents = [{ lotId: r.lotId, quantity: count }];
        task.sourcePalletId = r.palletId;
        task.status = task.id === full.id ? "active" : "paused";
      }
    }
    const blockedSource = fixture.pallets.find(
      (p) => p.id === blocked.reservations[0].palletId,
    )!;
    fixture.locations.find((l) => l.id === blockedSource.locationId)!.blocked =
      true;
    for (const table of ["tasks", "pallets", "locations"] as const)
      for (const row of fixture[table])
        await db.query(`UPDATE ${table} SET payload=$2 WHERE id=$1`, [
          row.id,
          JSON.stringify(row),
        ]);
    await db.query("UPDATE metadata SET value='5' WHERE key='schema_version'");
    const replay = {
      requestId: "legacy-v5-task-response",
      name: "Cached old plan",
    };
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(["updateWarehousePlan", replay]))
      .digest("hex");
    await db.query(
      "INSERT INTO commands(request_id,fingerprint,response) VALUES($1,$2,$3)",
      [replay.requestId, fingerprint, JSON.stringify(fixture)],
    );
    await db.close();
    warehouse = new WarehouseService();
    const migrated = await warehouse.snapshot();
    assert.equal(migrated.revision, fixture.revision);
    for (const old of fixture.tasks) {
      const task = migrated.tasks.find((t) => t.id === old.id)!;
      assert.deepEqual(task, {
        ...old,
        createdAt: null,
        boxCodeConfirmed: old.scannedUnits > 0,
      });
      assert.equal(
        (await warehouse.getLabel("box", task.openBoxCode)).payload,
        `artmate-wms:box:${task.openBoxCode}`,
      );
    }
    assert.deepEqual(migrated.receipts, fixture.receipts);
    assert.deepEqual(
      migrated.pallets.map((p) => [p.id, p.quantity]),
      fixture.pallets
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((p) => [p.id, p.quantity]),
    );
    await warehouse.updateTaskStatus(full.id, {
      requestId: "pause-legacy-full",
      employeeId: "employee-1",
      status: "paused",
    });
    await assert.rejects(
      warehouse.claimTask(blocked.id, {
        requestId: "blocked-legacy-claim",
        employeeId: "employee-1",
      }),
      /заблокирован/,
    );
    await warehouse.claimTask(full.id, {
      requestId: "resume-legacy-full",
      employeeId: "employee-1",
    });
    const label = await warehouse.getLabel("box", full.openBoxCode),
      balance = migrated.balance.totalUnits;
    const command = {
      requestId: "recover-v5-full-box",
      employeeId: "employee-1",
      boxCode: full.openBoxCode,
    };
    const packed = await warehouse.packTask(full.id, command);
    assert.equal(packed.balance.totalUnits, balance);
    assert.equal(
      packed.tasks.find((t) => t.id === full.id)!.status,
      "completed",
    );
    assert.equal(
      packed.tasks.find((t) => t.id === blocked.id)!.status,
      "queued",
    );
    assert.equal(packed.tasks.find((t) => t.id === next.id)!.status, "active");
    assert.equal(
      packed.tasks.find((t) => t.id === partial.id)!.status,
      "paused",
    );
    assert.deepEqual(await warehouse.getLabel("box", full.openBoxCode), label);
    assert.deepEqual(await warehouse.packTask(full.id, command), packed);
    const work = await warehouse.getWorkHistory({});
    const recovered = work.items.filter(
      (event) => event.requestId === command.requestId,
    );
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].kind, "box_packed");
    assert.equal(recovered[0].units, full.unitsPerBox);
    assert.equal(recovered[0].employeeId, "employee-1");
    assert.equal(
      (await warehouse.getPerformance({ employeeId: "employee-1" }))
        .employees[0].metrics.unitsPacked,
      full.unitsPerBox,
    );
    const cached = await warehouse.updateWarehousePlan(replay);
    assert.ok(
      cached.tasks.every((t) => (t as any).boxCodeConfirmed === undefined),
    );
    assert.equal((await warehouse.snapshot()).revision, packed.revision);
    const saved = await warehouse.snapshot();
    await warehouse.onModuleDestroy();
    warehouse = new WarehouseService();
    assert.deepEqual(await warehouse.snapshot(), saved);
    await warehouse.onModuleDestroy();
    warehouse = null;
    const inspect = new PGlite(path);
    await inspect.waitReady;
    assert.equal(
      (
        await inspect.query<{ value: string }>(
          "SELECT value FROM metadata WHERE key='schema_version'",
        )
      ).rows[0].value,
      "12",
    );
    await inspect.close();
  } finally {
    if (warehouse) await warehouse.onModuleDestroy();
    if (oldEnv === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = oldEnv;
    await rm(dir, { recursive: true, force: true });
  }
});

test("v7 queues legacy assembly boxes without merging physical pallets, preserves cache and skips active moves across restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "artmate-wms-putaway-v7-")),
    path = join(dir, "db"),
    oldEnv = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = path;
  let warehouse: WarehouseService | null = null;
  try {
    warehouse = new WarehouseService();
    const baseline = await warehouse.snapshot();
    await warehouse.onModuleDestroy();
    warehouse = null;
    const legacy = structuredClone(baseline),
      first = legacy.pallets.find((p) => p.id === "pallet-finished-0")!,
      second = legacy.pallets.find((p) => p.id === "pallet-finished-1")!;
    first.locationId = "loc-assembly";
    second.locationId = "loc-assembly-2";
    for (const box of legacy.boxes) {
      if (box.palletId === first.id) box.locationId = first.locationId;
      if (box.palletId === second.id) box.locationId = second.locationId;
    }
    const empty = {
      ...structuredClone(first),
      id: "legacy-empty-finished",
      code: "LEGACY-EMPTY-FG",
      locationId: "loc-10",
      quantity: 0,
    };
    legacy.pallets.push(empty);
    const destination = {
      ...structuredClone(
        legacy.locations.find((l) => l.id === "loc-receiving")!,
      ),
      id: "legacy-move-storage",
      code: "LEGACY-MOVE",
      kind: "floor",
      x: 20,
      y: 0,
      width: 3,
      depth: 1,
    };
    legacy.locations.push(destination);
    legacy.movements.push({
      id: "legacy-active-move",
      code: "LEGACY-ACTIVE",
      palletId: second.id,
      fromLocationId: second.locationId,
      toLocationId: destination.id,
      kind: "transfer",
      status: "planned",
      employeeId: "employee-2",
      keepSourceReserved: false,
      createdAt: "2026-10-20T00:00:00Z",
      takenAt: null,
      completedAt: null,
    });
    const replay = {
        requestId: "cached-v6-putaway-migration",
        name: "Old plan response",
      },
      hash = createHash("sha256")
        .update(JSON.stringify(["updateWarehousePlan", replay]))
        .digest("hex");
    const cached: any = structuredClone(legacy);
    delete cached.putawayTasks;
    const db = new PGlite(path);
    await db.waitReady;
    for (const table of ["pallets", "boxes", "locations", "movements"] as const)
      for (const row of legacy[table])
        await db.query(
          `INSERT INTO ${table}(id,payload) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload`,
          [row.id, JSON.stringify(row)],
        );
    await db.query("UPDATE metadata SET value='6' WHERE key='schema_version'");
    await db.query(
      "INSERT INTO commands(request_id,fingerprint,response) VALUES($1,$2,$3)",
      [replay.requestId, hash, JSON.stringify(cached)],
    );
    await db.close();
    warehouse = new WarehouseService();
    let migrated = await warehouse.snapshot();
    assert.equal(migrated.revision, baseline.revision);
    assert.ok(!migrated.pallets.some((p) => p.kind === "assembly"));
    for (const p of legacy.pallets)
      assert.deepEqual(
        migrated.pallets.find((x) => x.id === p.id),
        p,
      );
    assert.deepEqual(migrated.boxes, legacy.boxes);
    const boxes = legacy.boxes.filter((b) => b.palletId === first.id);
    assert.equal(migrated.putawayTasks.length, boxes.length);
    for (const box of boxes) {
      const t = migrated.putawayTasks.find((t) => t.boxId === box.id)!;
      assert.equal(t.createdAt, box.packedAt);
      assert.equal(t.fromPalletId, first.id);
      assert.equal(t.status, "queued");
    }
    assert.ok(!migrated.putawayTasks.some((t) => t.fromPalletId === second.id));
    assert.equal(migrated.balance.totalUnits, baseline.balance.totalUnits);
    assert.equal(
      ((await warehouse.updateWarehousePlan(replay)) as any).putawayTasks,
      undefined,
    );
    const saved = await warehouse.snapshot();
    await warehouse.onModuleDestroy();
    warehouse = new WarehouseService();
    assert.deepEqual(await warehouse.snapshot(), saved);
    const task = migrated.putawayTasks[0];
    await assert.rejects(
      warehouse.createMovement({
        requestId: "legacy-source-forbidden",
        palletId: first.id,
        toLocationId: "loc-picking",
        kind: "lower",
        employeeId: "employee-3",
      }),
      /второстепенные задания/,
    );
    await assert.rejects(
      warehouse.createShipment({
        requestId: "legacy-source-not-ready",
        skuId: first.skuId!,
        boxesRequested: 1,
      }),
      /Недостаточно/,
    );
    migrated = await warehouse.claimPutawayTask(task.id, {
      requestId: "legacy-empty-target-claim",
      employeeId: "employee-3",
    });
    assert.equal(
      migrated.putawayTasks.find((t) => t.id === task.id)!.toLocationId,
      empty.locationId,
    );
    await assert.rejects(
      warehouse.retireEmptyPallet(empty.id, {
        requestId: "reserved-empty-retire",
        palletCode: empty.code,
        locationCode: migrated.locations.find((l) => l.id === empty.locationId)!
          .code,
      }),
      /зарезервирована/,
    );
    await assert.rejects(
      warehouse.updateLocation(empty.locationId!, {
        requestId: "reserved-empty-shrink",
        maxBoxes: 0,
      }),
      /вместимость/,
    );
    await warehouse.releasePutawayTask(task.id, {
      requestId: "legacy-release",
      employeeId: "employee-3",
    });
    // Existing planned movement was deliberately not converted. Its boxes get tasks only on a later confirmed arrival back to assembly.
    await warehouse.takeMovement("legacy-active-move", {
      requestId: "legacy-move-take",
      palletCode: second.code,
      locationCode: legacy.locations.find((l) => l.id === second.locationId)!
        .code,
    });
    await warehouse.placeMovement("legacy-active-move", {
      requestId: "legacy-move-place",
      palletCode: second.code,
      locationCode: destination.code,
    });
    let s = await warehouse.createMovement({
      requestId: "legacy-back-to-assembly",
      palletId: second.id,
      toLocationId: "loc-assembly-2",
      kind: "transfer",
      employeeId: "employee-2",
    });
    const movement = s.movements.find(
      (m) => m.palletId === second.id && m.status === "planned",
    )!;
    await warehouse.takeMovement(movement.id, {
      requestId: "legacy-return-take",
      palletCode: second.code,
      locationCode: destination.code,
    });
    s = await warehouse.placeMovement(movement.id, {
      requestId: "legacy-return-place",
      palletCode: second.code,
      locationCode: legacy.locations.find((l) => l.id === "loc-assembly-2")!
        .code,
    });
    assert.equal(
      s.putawayTasks.filter((t) => t.fromPalletId === second.id).length,
      legacy.boxes.filter((b) => b.palletId === second.id).length,
    );
    assert.equal(s.balance.totalUnits, baseline.balance.totalUnits);
    const final = await warehouse.snapshot();
    await warehouse.onModuleDestroy();
    warehouse = new WarehouseService();
    assert.deepEqual(await warehouse.snapshot(), final);
  } finally {
    if (warehouse) await warehouse.onModuleDestroy();
    if (oldEnv === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = oldEnv;
    await rm(dir, { recursive: true, force: true });
  }
});
