import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as D from "../src/dto";
import { WarehouseService } from "../src/warehouse.service";
import {
  EXTRA_LEVEL_COST_METERS,
  levelCostMeters,
  rankPlacementLocations,
  receiptSourceLocation,
} from "../src/placement-ranking";

const request = () => ({ requestId: randomUUID() });
function location(
  id: string,
  patch: Partial<D.LocationDto> = {},
): D.LocationDto {
  return {
    id,
    code: id,
    name: id,
    kind: "floor",
    sectionId: null,
    x: 1,
    y: 1,
    width: 1.2,
    depth: 0.8,
    rotation: 0,
    level: 1,
    levels: 1,
    availableWidthMm: 1200,
    availableDepthMm: 800,
    maxHeightMm: 2200,
    maxBoxes: 36,
    maxWeightKg: null,
    accessSides: 1,
    blocked: false,
    archived: false,
    archivedAt: null,
    ...patch,
  };
}
function workspace(locations: D.LocationDto[]): D.WorkspaceDto {
  return {
    warehouse: {
      name: "Test warehouse",
      width: 100,
      depth: 30,
      layoutMode: "rectangle",
      spaces: [],
      workZones: [],
      zoneWork: [],
    },
    locations,
    sections: [],
    aisles: [],
    entrances: [],
    pallets: [],
  } as unknown as D.WorkspaceDto;
}

test("receiving source uses the exact pallet binding and never resolves an ambiguous zone through an unrelated address", () => {
  const first = location("receiving-one", { kind: "receiving" });
  const second = location("receiving-two", { kind: "receiving", x: 5 });
  const archived = location("receiving-archived", {
    kind: "receiving",
    archived: true,
  });
  const s = workspace([first, second, archived]);
  assert.equal(receiptSourceLocation(s, "receipt", "pallet"), null);
  s.warehouse.workZones.push({
    id: "zone",
    code: "ZONE",
    name: "Receiving",
    kind: "receiving",
    locationIds: [second.id],
    archived: false,
    archivedAt: null,
  });
  s.warehouse.zoneWork.push({
    employeeId: "worker",
    zoneId: "zone",
    jobKind: "receiving",
    jobId: "other-receipt",
    palletId: "pallet",
    message: "",
  });
  assert.equal(receiptSourceLocation(s, "receipt", "pallet"), null);
  s.warehouse.zoneWork[0].jobId = "receipt";
  assert.equal(receiptSourceLocation(s, "receipt", "pallet"), second.id);
  s.warehouse.workZones[0].locationIds = [first.id, second.id];
  assert.equal(receiptSourceLocation(s, "receipt", "pallet"), null);
  s.warehouse.workZones[0].archived = true;
  s.locations = [second];
  assert.equal(receiptSourceLocation(s, "receipt", "pallet"), null);
  s.warehouse.zoneWork = [];
  assert.equal(receiptSourceLocation(s, "receipt", "pallet"), second.id);
  second.blocked = true;
  assert.equal(receiptSourceLocation(s, "receipt", "pallet"), null);
});

test("unknown routes keep thematic consolidation first, then useful lower levels and best fit", () => {
  const empty = location("A-empty", { maxHeightMm: 1800 });
  const thematic = location("Z-thematic", { kind: "rack", level: 3 });
  const lower = location("B-lower", {
    kind: "rack",
    level: 1,
    maxHeightMm: 2000,
  });
  const s = workspace([empty, thematic, lower]);
  s.pallets.push({
    id: "thematic-pallet",
    kind: "finished",
    skuId: "sku",
    status: "stored",
    locationId: thematic.id,
  } as D.PalletDto);
  const before = structuredClone(s);
  const ranked = rankPlacementLocations(
    s,
    [empty, lower, thematic],
    null,
    "sku",
  );
  assert.equal(ranked.suggestedLocationId, thematic.id);
  assert.equal(ranked.recommendation?.sameSkuPallet, true);
  assert.equal(ranked.recommendation?.routeStatus, "unknown");
  assert.equal(ranked.recommendation?.distanceMeters, null);
  assert.deepEqual(
    ranked.locations.map((l) => l.id),
    [thematic.id, empty.id, lower.id],
  );
  assert.equal(levelCostMeters(thematic), 2 * EXTRA_LEVEL_COST_METERS);
  assert.equal(levelCostMeters(empty), 0);
  assert.deepEqual(s, before, "ranking must not mutate warehouse data");
});

test("a slightly longer ground route beats a high tier, while a sufficiently longer ground route loses", () => {
  const source = location("source", { kind: "assembly", x: 1, y: 10 });
  const tier = location("tier", { kind: "rack", level: 2, x: 5, y: 10 });
  const ground = location("ground", { x: 10, y: 10 });
  const distant = location("distant", { x: 70, y: 10 });
  const s = workspace([source, tier, ground, distant]);
  const nearby = rankPlacementLocations(s, [tier, ground], source.id);
  assert.equal(nearby.suggestedLocationId, ground.id);
  assert.equal(nearby.recommendation?.levelPenaltyMeters, 0);
  assert.notEqual(nearby.recommendation?.distanceMeters, null);
  const far = rankPlacementLocations(s, [tier, distant], source.id);
  assert.equal(far.suggestedLocationId, tier.id);
  assert.equal(far.recommendation?.levelPenaltyMeters, EXTRA_LEVEL_COST_METERS);
  assert(
    far.recommendation!.distanceMeters! < EXTRA_LEVEL_COST_METERS,
    "distance must exclude the soft handling penalty",
  );
});

test("compatible finished stock fills the fuller pallet before a nearby fragmented one", () => {
  const source = location("source", { kind: "assembly", x: 1, y: 10 });
  const nearby = location("A-08-01", { kind: "rack", x: 5, y: 10 });
  const established = location("F-05", { x: 25, y: 10 });
  const s = workspace([source, nearby, established]);
  s.pallets = [
    {
      id: "new-small",
      kind: "finished",
      skuId: "cats",
      status: "stored",
      locationId: nearby.id,
      quantity: 2,
    },
    {
      id: "existing-large",
      kind: "finished",
      skuId: "cats",
      status: "stored",
      locationId: established.id,
      quantity: 29,
    },
  ] as D.PalletDto[];
  const before = structuredClone(s);
  const ranked = rankPlacementLocations(
    s,
    [nearby, established],
    source.id,
    "cats",
  );
  assert.equal(ranked.suggestedLocationId, established.id);
  assert.ok(
    ranked.rows[0].route.distanceMeters! > ranked.rows[1].route.distanceMeters!,
  );
  assert.deepEqual(s, before);
});

test("putaway preserves thematic priority, physical capacity and fixed destinations under competing claims", async () => {
  // A dedicated in-memory database is mandatory: this test must never connect to live PostgreSQL.
  process.env.WMS_DATA_DIR = "memory://";
  delete process.env.DATABASE_URL;
  const w = new WarehouseService();
  try {
    let s = await w.updateWarehousePlan({
      ...request(),
      width: 100,
      depth: 100,
    });
    const sku = s.skus.find((x) => x.id === "sku-space")!;
    const raw = s.pallets.find((p) => p.kind === "raw" && p.skuId === sku.id)!;
    const existing = s.pallets.find(
      (p) => p.kind === "finished" && p.skuId === sku.id,
    )!;
    const thematic = s.locations.find((l) => l.id === existing.locationId)!;
    const source = s.locations.find((l) => l.id === "loc-assembly")!;
    s = await w.createSpace({
      ...request(),
      name: "Main room",
      kind: "room",
      x: 0,
      y: 0,
      width: 100,
      depth: 15.1,
    });
    const mainRoom = s.warehouse.spaces[0];
    await w.createSpace({
      ...request(),
      name: "Storage room",
      kind: "room",
      x: 0,
      y: 15.1,
      width: 100,
      depth: 84.9,
    });
    s = await w.createEntrance({
      ...request(),
      name: "Storage door",
      spaceId: mainRoom.id,
      wall: "south",
      offset: source.x,
      width: 2,
    });
    const door = s.entrances.at(-1)!;
    const actor = "employee-1",
      second = "employee-2";
    const createFloor = async (code: string, x: number, y: number) => {
      const result = await w.createLocation({
        ...request(),
        code,
        name: code,
        kind: "floor",
        x,
        y,
        width: 1.2,
        depth: 0.8,
        levels: 1,
        maxHeightMm: 2200,
        maxBoxes: 1,
        availableWidthMm: 1200,
        availableDepthMm: 800,
      });
      return result.locations.find((l) => l.code === code)!;
    };
    const near = await createFloor(
      "NEAR",
      source.x,
      source.y + source.depth + 0.2,
    );
    s = await w.createTask({
      ...request(),
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
      await w.claimTask(assembly.id, { ...request(), employeeId: actor });
      await w.scanTask(assembly.id, {
        ...request(),
        employeeId: actor,
        kind: "source",
        value: raw.code,
      });
      await w.scanTask(assembly.id, {
        ...request(),
        employeeId: actor,
        kind: "box",
        value: current.openBoxCode,
      });
      for (let unit = 0; unit < sku.unitsPerBox; unit++)
        s = await w.scanTask(assembly.id, {
          ...request(),
          employeeId: actor,
          kind: "barcode",
          value: sku.barcode,
        });
    }
    const tasks = s.putawayTasks.filter((t) => t.skuId === sku.id);
    assert.equal(tasks.length, 2);
    const beforeOptions = await w.snapshot();
    const priority = await w.getPutawayPlacementOptions(tasks[0].id);
    assert.equal(
      priority.suggestedLocationId,
      thematic.id,
      "existing same-SKU pallet must outrank an adjacent empty floor address",
    );
    assert.equal(priority.recommendation?.sameSkuPallet, true);
    assert.deepEqual(await w.snapshot(), beforeOptions);
    await w.updateLocation(thematic.id, {
      ...request(),
      maxBoxes: existing.quantity,
    });
    const withoutCapacity = await w.getPutawayPlacementOptions(tasks[0].id);
    assert(!withoutCapacity.locations.some((l) => l.id === thematic.id));
    assert.equal(withoutCapacity.suggestedLocationId, near.id);

    const claims = await Promise.all([
      w.claimPutawayTask(tasks[0].id, { ...request(), employeeId: actor }),
      w.claimPutawayTask(tasks[1].id, { ...request(), employeeId: second }),
    ]);
    assert.equal(claims.length, 2);
    s = await w.snapshot();
    const claimed = tasks.map(
      (t) => s.putawayTasks.find((x) => x.id === t.id)!,
    );
    assert.equal(
      new Set(claimed.map((t) => t.toLocationId)).size,
      2,
      "a one-box destination must not be overbooked by competing claims",
    );
    const held = claimed.find((t) => t.toLocationId === near.id)!;
    assert(held);
    await createFloor("CLOSER", source.x + 1.4, source.y + source.depth + 0.1);
    const fixedBefore = await w.snapshot();
    const fixed = await w.getPutawayPlacementOptions(held.id);
    assert.equal(fixed.suggestedLocationId, held.toLocationId);
    assert.equal(fixed.recommendation?.locationId, held.toLocationId);
    assert.deepEqual(await w.snapshot(), fixedBefore);
    await w.deleteEntrance(door.id, request());
    const disconnectedBefore = await w.snapshot();
    const disconnected = await w.getPutawayPlacementOptions(held.id);
    assert.equal(
      disconnected.suggestedLocationId,
      held.toLocationId,
      "removing a drawn route must not replace an already reserved target",
    );
    assert.equal(disconnected.recommendation, null);
    assert.match(disconnected.reason ?? "", /путь|проход|проём/);
    assert.deepEqual(await w.snapshot(), disconnectedBefore);
    const box = s.boxes.find((b) => b.id === held.boxId)!;
    await w.takePutawayBox(held.id, {
      ...request(),
      employeeId: held.employeeId!,
      boxCode: box.code,
    });
    const carriedBefore = await w.snapshot();
    const carried = await w.getPutawayPlacementOptions(held.id);
    assert.equal(carried.suggestedLocationId, near.id);
    assert.equal(carried.recommendation, null);
    assert.deepEqual(await w.snapshot(), carriedBefore);
    await w.placePutawayBox(held.id, {
      ...request(),
      employeeId: held.employeeId!,
      locationCode: near.code,
    });
    assert.equal((await w.getStockLedger()).summary.reconciled, true);

    // A missing drawn connection changes recommendations, not physical placement eligibility.
    const manual = await createFloor("MANUAL-SEPARATE", 75, 20);
    s = await w.createReceipt({
      ...request(),
      receivedAt: new Date().toISOString(),
      pallets: [{ skuId: sku.id, quantity: 10 }],
    });
    const receipt = s.receipts.at(-1)!;
    const inbound = s.pallets.find(
      (p) => p.id === receipt.pallets[0].palletId,
    )!;
    const receiving = s.locations.find((l) => l.kind === "receiving")!;
    assert.equal(
      rankPlacementLocations(s, [manual], receiving.id).rows[0].route.status,
      "unreachable",
    );
    const receiptBefore = await w.snapshot();
    const options = await w.getReceiptPlacementOptions(receipt.id, inbound.id);
    assert(options.locations.some((l) => l.id === manual.id));
    assert.notEqual(options.suggestedLocationId, manual.id);
    assert.deepEqual(await w.snapshot(), receiptBefore);
    s = await w.placeReceiptPallet(receipt.id, inbound.id, {
      ...request(),
      employeeId: "employee-3",
      palletCode: inbound.code,
      locationCode: manual.code,
    });
    assert.equal(
      s.pallets.find((p) => p.id === inbound.id)!.locationId,
      manual.id,
    );
    assert.equal(s.balance.totalUnits, receiptBefore.balance.totalUnits + 10);
    assert.equal((await w.getStockLedger()).summary.reconciled, true);
  } finally {
    await w.onModuleDestroy();
  }
});

test("raw receipt keeps low tiers diverse while preserving oldest-lot access", () => {
  const low = location("low-candidate", { kind: "rack", level: 1 });
  const high = location("high-candidate", { kind: "rack", level: 3 });
  const occupiedLow = location("occupied-low", {
    kind: "rack",
    level: 2,
    x: 5,
  });
  const occupiedHigh = location("occupied-high", {
    kind: "rack",
    level: 4,
    x: 5,
  });
  const s = workspace([low, high, occupiedLow, occupiedHigh]);
  s.lots = [
    {
      id: "old",
      skuId: "theme",
      receivedAt: "2026-09-01T00:00:00Z",
      name: "old",
    },
    {
      id: "new",
      skuId: "theme",
      receivedAt: "2026-10-01T00:00:00Z",
      name: "new",
    },
    {
      id: "older",
      skuId: "theme",
      receivedAt: "2026-08-01T00:00:00Z",
      name: "older",
    },
  ];
  s.movements = [];
  const incoming = {
    id: "incoming",
    kind: "raw",
    skuId: "theme",
    lotId: "new",
  };
  const rank = () =>
    rankPlacementLocations(s, [high, low], null, undefined, incoming);
  assert.equal(
    rank().suggestedLocationId,
    low.id,
    "first raw pallet must be accessible",
  );
  s.pallets.push({
    id: "stock",
    kind: "raw",
    skuId: "theme",
    lotId: "old",
    status: "stored",
    locationId: occupiedLow.id,
    quantity: 100,
  } as D.PalletDto);
  assert.equal(
    rank().suggestedLocationId,
    high.id,
    "duplicate theme must not fill another low slot",
  );
  s.pallets[0].locationId = occupiedHigh.id;
  assert.equal(
    rank().suggestedLocationId,
    high.id,
    "newer lot must leave low slot for older high stock",
  );
  incoming.lotId = "older";
  assert.equal(
    rank().suggestedLocationId,
    low.id,
    "older arriving lot needs low access even if a younger pallet is low",
  );
  incoming.lotId = "old";
  s.pallets[0].locationId = occupiedLow.id;
  assert.equal(
    rank().suggestedLocationId,
    high.id,
    "same-age accessible stock already covers the theme",
  );
  occupiedLow.blocked = true;
  assert.equal(
    rank().suggestedLocationId,
    low.id,
    "blocked stock does not cover hand-accessible stock",
  );
  occupiedLow.blocked = false;
  s.pallets[0].lotId = "missing";
  assert.equal(
    rank().suggestedLocationId,
    low.id,
    "unknown dates do not invent a seniority-based policy",
  );
});

test("a pending descent covers the raw theme and finished consolidation keeps its priority", () => {
  const low = location("low", { kind: "rack", level: 1 });
  const high = location("high", { kind: "rack", level: 3 });
  const target = location("reserved-low", { kind: "rack", level: 2, x: 5 });
  const s = workspace([low, high, target]);
  s.lots = [
    {
      id: "lot",
      skuId: "theme",
      receivedAt: "2026-10-01T00:00:00Z",
      name: "lot",
    },
  ];
  s.pallets.push({
    id: "stock",
    kind: "raw",
    skuId: "theme",
    lotId: "lot",
    status: "stored",
    locationId: high.id,
    quantity: 100,
  } as D.PalletDto);
  s.movements = [
    {
      id: "move",
      palletId: "stock",
      fromLocationId: high.id,
      toLocationId: target.id,
      status: "planned",
    } as D.MovementDto,
  ];
  const incoming = {
    id: "incoming",
    kind: "raw",
    skuId: "theme",
    lotId: "lot",
  };
  const before = structuredClone(s);
  assert.equal(
    rankPlacementLocations(s, [low, high], null, undefined, incoming)
      .suggestedLocationId,
    high.id,
  );
  assert.deepEqual(s, before, "ranking must remain read-only");
  s.pallets = [
    {
      id: "finished",
      kind: "finished",
      skuId: "theme",
      status: "stored",
      locationId: high.id,
    } as D.PalletDto,
  ];
  assert.equal(
    rankPlacementLocations(s, [low, high], null, "theme").suggestedLocationId,
    high.id,
  );
});
