import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import type * as D from "../src/dto";
import { seedWorkspace } from "../src/seed";
import { migrateAddressesAndMovements } from "../src/migrations";
import {
  rawAccessMovementIntents,
  rawAccessMovementProblem,
} from "../src/work-automation/raw-access";

function fixture() {
  const w = migrateAddressesAndMovements(seedWorkspace());
  Object.assign(w, {
    pallets: [],
    boxes: [],
    tasks: [],
    movements: [],
    putawayTasks: [],
    locations: [],
    sections: [],
    aisles: [],
    entrances: [],
    lots: [],
  });
  w.warehouse = {
    name: "Test warehouse",
    width: 30,
    depth: 20,
    layoutMode: "rectangle",
    spaces: [],
    zoneWork: [],
    workZones: [],
  };
  const address = (
    id: string,
    x: number,
    level: number,
    patch: Partial<D.LocationDto> = {},
  ) => {
    const result: D.LocationDto = {
      id,
      code: id,
      name: id,
      kind: "rack",
      sectionId: id + "-section",
      x,
      y: 2,
      width: 1.2,
      depth: 0.9,
      rotation: 0,
      level,
      levels: 1,
      availableWidthMm: 1200,
      availableDepthMm: 900,
      maxHeightMm: 800,
      maxWeightKg: null,
      maxBoxes: 18,
      accessSides: 1,
      blocked: false,
      archived: false,
      archivedAt: null,
      ...patch,
    };
    w.locations.push(result);
    if (result.sectionId)
      w.sections.push({
        id: result.sectionId,
        code: result.sectionId,
        name: result.sectionId,
        x,
        y: 2,
        width: 1.2,
        depth: 0.9,
        rotation: 0,
        archived: false,
        archivedAt: null,
        archivedLocationIds: [],
      });
    return result;
  };
  const high = address("HIGH", 2, 3);
  const low = address("LOW", 6, 1);
  const pallet = (
    id = "old-raw",
    skuId = "sku-cats",
    locationId: string | null = high.id,
    receivedAt = "2026-09-01T00:00:00Z",
  ) => {
    const result: D.PalletDto = {
      id,
      code: id,
      kind: "raw",
      skuId,
      lotId: id + "-lot",
      quantity: 1000,
      locationId,
      status: "stored",
      returnLocationId: null,
      packagingSnapshot: null,
      widthMm: 1200,
      depthMm: 800,
      heightMm: 720,
      weightKg: null,
    };
    w.pallets.push(result);
    w.lots.push({
      id: result.lotId!,
      skuId,
      receivedAt,
      name: result.lotId!,
    });
    return result;
  };
  const raw = pallet();
  const movement = (
    id = "AUTO",
    patch: Partial<D.MovementDto> & { autoPurpose?: string } = {},
  ) => {
    const result = {
      id,
      code: id,
      palletId: raw.id,
      fromLocationId: high.id,
      toLocationId: low.id,
      kind: "transfer",
      status: "planned",
      employeeId: null,
      autoPurpose: "accessible_raw",
      keepSourceReserved: false,
      createdAt: "2026-10-30T06:00:00Z",
      takenAt: null,
      completedAt: null,
      ...patch,
    } as D.MovementDto;
    w.movements.push(result);
    return result;
  };
  return { w, address, high, low, pallet, raw, movement };
}
function created(w: D.WorkspaceDto) {
  return rawAccessMovementIntents(w).filter(
    (intent) => intent.kind === "create",
  );
}

test("a newly freed hand-accessible tier creates one real-pallet transfer without changing stock", () => {
  const { w, low, raw, pallet } = fixture();
  const occupant = pallet("occupant", "sku-space", low.id);
  assert.deepEqual(created(w), []);
  occupant.status = "retired";
  occupant.locationId = null;
  const before = structuredClone(w);
  assert.deepEqual(rawAccessMovementIntents(w), [
    { kind: "create", palletId: raw.id, toLocationId: low.id },
  ]);
  assert.deepEqual(w, before);
  assert.equal(rawAccessMovementProblem(w, raw.id, low.id), null);
});

test("different themes come before a FIFO refresh of a theme already represented below", () => {
  const { w, address, pallet, raw } = fixture();
  const youngLow = address("YOUNG-LOW", 10, 1);
  pallet("young-cats", "sku-cats", youngLow.id, "2026-10-01T00:00:00Z");
  const otherHigh = address("OTHER-HIGH", 14, 4);
  const other = pallet("other", "sku-space", otherHigh.id);
  const intents = rawAccessMovementIntents(w, {
    demandSkuIds: [raw.skuId!, other.skuId!],
  });
  assert.equal(intents[0].kind === "create" && intents[0].palletId, other.id);
  other.status = "retired";
  assert.equal(
    created(w)[0].palletId,
    raw.id,
    "oldest lot still needs a picking face",
  );
});

test("current need ranks missing themes before route length, while every batch remains one pallet", () => {
  const { w, address, pallet } = fixture();
  const high = address("OTHER-HIGH", 14, 4);
  const other = pallet("other", "sku-space", high.id);
  const intents = rawAccessMovementIntents(w, { demandSkuIds: [other.skuId!] });
  assert.equal(intents.length, 1);
  assert.equal(intents[0].kind === "create" && intents[0].palletId, other.id);
});

test("oldest raw already accessible on either hand tier or the floor suppresses duplicate lowering", () => {
  for (const mode of ["tier-one", "tier-two", "floor"] as const) {
    const { w, address, pallet } = fixture();
    const low = address("OLD-LOW", 10, mode === "tier-two" ? 2 : 1, {
      ...(mode === "floor" ? { kind: "floor", sectionId: null } : {}),
    });
    pallet("same-date-low", "sku-cats", low.id);
    assert.deepEqual(rawAccessMovementIntents(w), [], mode);
  }
});

test("only the oldest known lot may move; missing dates and older in-transit stock never cause a younger bypass", () => {
  for (const mode of [
    "older",
    "unknown-date",
    "missing-lot",
    "in-transit",
  ] as const) {
    const { w, address, pallet, raw } = fixture();
    const high = address("OLDER-HIGH", 10, 3);
    const older = pallet("older", "sku-cats", high.id, "2026-08-01T00:00:00Z");
    if (mode === "older") {
      const intents = created(w);
      assert.equal(intents.length, 1);
      assert.equal(intents[0].palletId, older.id);
      assert.match(rawAccessMovementProblem(w, raw.id, "LOW")!, /самая старая/);
      continue;
    }
    if (mode === "unknown-date")
      w.lots.find((lot) => lot.id === older.lotId)!.receivedAt = "unknown";
    if (mode === "missing-lot")
      w.lots = w.lots.filter((lot) => lot.id !== older.lotId);
    if (mode === "in-transit") {
      older.status = "in_transit";
      older.locationId = null;
    }
    assert.deepEqual(created(w), [], mode);
  }
});

test("FIFO date comparison respects actual instants rather than timezone-string ordering", () => {
  const { w, address, pallet, raw } = fixture();
  w.lots.find((lot) => lot.id === raw.lotId)!.receivedAt =
    "2026-09-01T00:30:00+03:00";
  const high = address("NEWER-HIGH", 10, 3);
  pallet("newer", "sku-cats", high.id, "2026-08-31T23:00:00Z");
  assert.equal(created(w)[0].palletId, raw.id);
});

test("occupied, reserved, held, blocked, archived and physically unsuitable destinations do not create work", () => {
  for (const mode of [
    "occupied-empty",
    "held",
    "move",
    "putaway",
    "blocked",
    "archived",
    "section-archived",
    "section-missing",
    "height",
    "width",
    "weight",
    "counting",
  ] as const) {
    const { w, low, pallet } = fixture();
    if (mode === "occupied-empty")
      pallet("empty", "sku-space", low.id).quantity = 0;
    if (mode === "held")
      pallet("hold", "sku-space", null).returnLocationId = low.id;
    if (mode === "move")
      w.movements.push({
        id: "reserved",
        status: "planned",
        toLocationId: low.id,
      } as D.MovementDto);
    if (mode === "putaway")
      w.putawayTasks.push({
        id: "reserved",
        status: "claimed",
        toLocationId: low.id,
      } as D.PutawayTaskDto);
    if (mode === "blocked") low.blocked = true;
    if (mode === "archived") low.archived = true;
    if (mode === "section-archived")
      w.sections.find((section) => section.id === low.sectionId)!.archived =
        true;
    if (mode === "section-missing")
      w.sections = w.sections.filter((section) => section.id !== low.sectionId);
    if (mode === "height") low.maxHeightMm = 700;
    if (mode === "width") low.availableWidthMm = 700;
    if (mode === "weight") low.maxWeightKg = 100;
    const intents = rawAccessMovementIntents(w, {
      blockedLocationIds: mode === "counting" ? new Set([low.id]) : undefined,
    });
    assert.deepEqual(intents, [], mode);
  }
});

test("source guards preserve manual or taken assembly, physical work and valid lot identity", () => {
  for (const mode of [
    "reserved",
    "manual-task",
    "moving",
    "putaway",
    "blocked",
    "archived",
    "bad-size",
    "wrong-lot",
    "finished",
    "empty",
    "floor",
    "second-tier",
    "counting",
  ] as const) {
    const { w, raw, high } = fixture();
    if (mode === "reserved" || mode === "manual-task")
      w.tasks.push({
        id: "task",
        skuId: raw.skuId,
        status: mode === "reserved" ? "active" : "queued",
        reservations:
          mode === "reserved"
            ? [{ palletId: raw.id, lotId: raw.lotId, quantity: 1 }]
            : [],
      } as D.TaskDto);
    if (mode === "moving")
      w.movements.push({
        id: "other",
        palletId: raw.id,
        status: "planned",
        toLocationId: "elsewhere",
      } as D.MovementDto);
    if (mode === "putaway")
      w.putawayTasks.push({
        id: "other",
        status: "queued",
        fromLocationId: high.id,
      } as D.PutawayTaskDto);
    if (mode === "blocked") high.blocked = true;
    if (mode === "archived") high.archived = true;
    if (mode === "bad-size") raw.heightMm = NaN;
    if (mode === "wrong-lot") w.lots[0].skuId = "sku-space";
    if (mode === "finished") raw.kind = "finished";
    if (mode === "empty") raw.quantity = 0;
    if (mode === "floor") high.kind = "floor";
    if (mode === "second-tier") high.level = 2;
    const intents = rawAccessMovementIntents(w, {
      blockedLocationIds: mode === "counting" ? new Set([high.id]) : undefined,
    });
    assert.deepEqual(intents, [], mode);
  }
});

test("manual incoming oldest stock provides a future lower picking face and prevents a duplicate", () => {
  const { w, address, pallet, movement } = fixture();
  const otherHigh = address("OTHER-HIGH", 10, 3);
  const sameLot = pallet("second-old", "sku-cats", otherHigh.id);
  movement("MANUAL", { autoPurpose: undefined, employeeId: "employee-1" });
  assert.deepEqual(rawAccessMovementIntents(w), []);
  assert.match(rawAccessMovementProblem(w, sameLot.id, "LOW")!, /уже доступна/);
});

test("a valid free automatic movement keeps its identity across demand changes; stale work is cancelled and replanned", () => {
  const { w, address, pallet, low, movement } = fixture();
  const move = movement();
  const otherHigh = address("OTHER-HIGH", 10, 3);
  const other = pallet("other", "sku-space", otherHigh.id);
  assert.deepEqual(
    rawAccessMovementIntents(w, { demandSkuIds: [other.skuId!] }),
    [],
  );
  assert.equal(
    rawAccessMovementProblem(w, move.palletId, move.toLocationId, move.id),
    null,
  );
  low.blocked = true;
  const alternative = address("ALTERNATIVE", 14, 2);
  const intents = rawAccessMovementIntents(w);
  assert.equal(intents[0].kind, "cancel");
  assert.equal(intents[0].kind === "cancel" && intents[0].movementId, move.id);
  assert.equal(
    intents[1].kind === "create" && intents[1].toLocationId,
    alternative.id,
  );
});

test("claimed and in-transit automatic work remains untouched and consumes the sole automatic movement slot", () => {
  for (const status of ["planned", "in_transit"]) {
    const { w, address, pallet, movement, low } = fixture();
    movement("TAKEN", { status, employeeId: "employee-1" });
    low.blocked = true;
    const otherHigh = address("OTHER-HIGH", 10, 3);
    pallet("other", "sku-space", otherHigh.id);
    address("ALTERNATIVE", 14, 1);
    assert.deepEqual(rawAccessMovementIntents(w), [], status);
  }
});

test("legacy duplicate free work is reduced without cancelling human work or creating another pending movement", () => {
  const { w, movement } = fixture();
  const first = movement("FIRST");
  const duplicate = movement("DUPLICATE", {
    createdAt: "2026-10-30T07:00:00Z",
  });
  const intents = rawAccessMovementIntents(w);
  assert.equal(intents.length, 1);
  assert.equal(
    intents[0].kind === "cancel" && intents[0].movementId,
    duplicate.id,
  );
  first.employeeId = "employee-1";
  const claimed = rawAccessMovementIntents(w);
  assert.equal(claimed.length, 1);
  assert.equal(
    claimed[0].kind === "cancel" && claimed[0].movementId,
    duplicate.id,
  );
});

test("routing excludes unknown and disconnected paths and ranks a usable second tier over a distant first tier", () => {
  const { w, low, address } = fixture();
  const second = address("SECOND", 4, 2);
  low.x = 25;
  w.sections.find((section) => section.id === low.sectionId)!.x = 25;
  assert.equal(created(w)[0].toLocationId, second.id);
  w.warehouse.layoutMode = "spaces";
  w.warehouse.spaces = [];
  assert.deepEqual(created(w), [], "unknown geometry cannot schedule a move");
  w.warehouse.layoutMode = "rectangle";
  low.x = 8;
  w.sections.find((section) => section.id === low.sectionId)!.x = 8;
  w.locations = w.locations.filter((location) => location.id !== second.id);
  w.sections = w.sections.filter((section) => section.id !== second.sectionId);
  w.aisles = [
    {
      id: "left",
      name: "left",
      x: 3.2,
      y: 1,
      width: 1,
      depth: 5,
      rotation: 0,
      archived: false,
      archivedAt: null,
    },
    {
      id: "right",
      name: "right",
      x: 6.9,
      y: 1,
      width: 1,
      depth: 5,
      rotation: 0,
      archived: false,
      archivedAt: null,
    },
  ];
  assert.deepEqual(
    created(w),
    [],
    "disconnected aisles cannot schedule a move",
  );
});

test("an outdated source address cancels a free task even when the pallet is now at another eligible upper tier", () => {
  const { w, address, raw, movement } = fixture();
  const move = movement();
  const source = address("NEW-SOURCE", 10, 4);
  raw.locationId = source.id;
  const intents = rawAccessMovementIntents(w);
  assert.equal(intents[0].kind === "cancel" && intents[0].movementId, move.id);
  assert.match(
    intents[0].kind === "cancel" ? intents[0].reason : "",
    /исходном адресе/,
  );
});
