import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import type * as D from "../src/dto";
import {
  assemblyMetrics,
  DEMO_PACKAGING,
  DEFAULT_PACKAGING,
} from "../src/physical";
import { seedWorkspace } from "../src/seed";
import {
  assemblyAcceptanceError,
  assemblyPressure,
} from "../src/work-automation/assembly-pressure";

function fixture(maxBoxes = 18): D.WorkspaceDto {
  const profile = { ...DEMO_PACKAGING };
  return {
    revision: 0,
    warehouse: {
      workZones: [
        {
          id: "zone",
          code: "WZ-01",
          name: "Сборка",
          kind: "assembly",
          locationIds: ["assembly"],
          archived: false,
        },
      ],
      zoneWork: [],
    },
    sections: [],
    movements: [],
    putawayTasks: [],
    skus: [
      { id: "cats", code: "CAT", name: "Котики", packaging: profile },
      { id: "other", code: "OTHER", name: "Другая", packaging: { ...profile } },
    ],
    locations: [
      {
        id: "assembly",
        code: "PACK-01",
        name: "Общая паллета",
        kind: "assembly",
        archived: false,
        blocked: false,
        sectionId: null,
        availableWidthMm: 1200,
        availableDepthMm: 800,
        maxHeightMm: 2000,
        maxWeightKg: null,
        maxBoxes,
      },
    ],
    pallets: [
      {
        id: "pallet",
        code: "ASM-01",
        kind: "assembly",
        status: "stored",
        skuId: null,
        lotId: null,
        locationId: "assembly",
        returnLocationId: null,
        quantity: 0,
        widthMm: 1200,
        depthMm: 800,
        heightMm: 150,
        weightKg: null,
        packagingSnapshot: { ...profile },
      },
    ],
    boxes: [],
    tasks: [],
  } as unknown as D.WorkspaceDto;
}
function addBoxes(state: D.WorkspaceDto, count: number, skuId = "cats") {
  const profile = state.skus.find((sku) => sku.id === skuId)!.packaging;
  for (let index = 0; index < count; index++) {
    const id = `box-${state.boxes.length}`;
    state.boxes.push({
      id,
      code: id,
      skuId,
      status: "stored",
      palletId: "pallet",
      locationId: "assembly",
      units: 20,
      lotContents: [],
      packedAt: "2026-10-27T10:00:00Z",
      packagingSnapshot: { ...profile },
    });
  }
  const pallet = state.pallets[0];
  pallet.quantity += count;
  Object.assign(
    pallet,
    assemblyMetrics(
      pallet.packagingSnapshot!,
      state.boxes
        .filter((box) => box.status === "stored")
        .map((box) => box.packagingSnapshot),
    ),
  );
}
function task(
  state: D.WorkspaceDto,
  id: string,
  overrides: Partial<D.TaskDto> = {},
) {
  const result: D.TaskDto = {
    id,
    code: id,
    createdAt: "2026-10-27T10:00:00Z",
    skuId: "cats",
    boxesTarget: 10,
    boxesCompleted: 0,
    unitsPerBox: 20,
    status: "active",
    employeeId: `employee-${id}`,
    boxCodeConfirmed: true,
    scannedUnits: 0,
    sourcePalletId: null,
    openBoxCode: `BOX-${id}`,
    reservations: [],
    openBoxContents: [],
    ...overrides,
  };
  state.tasks.push(result);
  return result;
}

test("pressure uses the shared canonical physical pallet and is a read-only calculation", () => {
  const state = fixture();
  addBoxes(state, 4);
  const before = JSON.stringify(state);
  assert.deepEqual(assemblyPressure(state), {
    level: "normal",
    locationId: "assembly",
    palletId: "pallet",
    boxes: 4,
    committedBoxes: 0,
    capacityBoxes: 18,
    message: "На общей паллете сборки есть место",
  });
  assert.equal(assemblyAcceptanceError(state, "cats"), null);
  assert.equal(JSON.stringify(state), before);
});

test("near full begins at 80 percent and full means the next ordinary box cannot fit", () => {
  const state = fixture(5);
  addBoxes(state, 4);
  assert.equal(assemblyPressure(state).level, "near_full");
  assert.equal(assemblyAcceptanceError(state, "cats"), null);
  addBoxes(state, 1);
  assert.equal(assemblyPressure(state).level, "full");
  assert.match(
    assemblyAcceptanceError(state, "cats")!,
    /вместимость|заполнена/,
  );
});

test("height and profile layers restrict capacity independently of configured box count", () => {
  const state = fixture(100);
  state.locations[0].maxHeightMm = 750;
  addBoxes(state, 12);
  assert.equal(assemblyPressure(state).capacityBoxes, 12);
  assert.equal(assemblyPressure(state).level, "full");
  assert.match(assemblyAcceptanceError(state, "cats")!, /высоте/);
});

test("active and paused confirmed or scanned open boxes reserve one slot each", () => {
  const state = fixture(3);
  addBoxes(state, 1);
  task(state, "one");
  task(state, "two", {
    status: "paused",
    boxCodeConfirmed: false,
    scannedUnits: 4,
  });
  task(state, "queued", { status: "queued" });
  task(state, "completed", { status: "completed", boxesCompleted: 10 });
  task(state, "not-started", { boxCodeConfirmed: false });
  const result = assemblyPressure(state);
  assert.equal(result.boxes, 1);
  assert.equal(result.committedBoxes, 2);
  assert.equal(result.level, "full");
  assert.match(
    assemblyAcceptanceError(state, "cats")!,
    /вместимость|заполнена/,
  );
  // Finalizing/revalidating one's existing box counts that same slot only once.
  assert.equal(assemblyAcceptanceError(state, "cats", "one"), null);
  assert.equal(assemblyAcceptanceError(state, "cats", "two"), null);
});

test("mixed committed profiles change grid and height before any stock is packed", () => {
  const state = fixture(100);
  state.skus[1].packaging = {
    ...DEMO_PACKAGING,
    boxWidthMm: 600,
    boxHeightMm: 500,
    boxesPerLayer: 4,
    maxLayers: 3,
  };
  state.locations[0].maxHeightMm = 1650;
  addBoxes(state, 10);
  task(state, "wide", { skuId: "other" });
  assert.equal(assemblyPressure(state).capacityBoxes, 12);
  assert.equal(assemblyPressure(state).level, "near_full");
  assert.equal(assemblyAcceptanceError(state, "cats"), null);
  task(state, "another");
  assert.equal(assemblyPressure(state).level, "full");
  assert.match(assemblyAcceptanceError(state, "cats")!, /заполнена|высоте/);
});

test("known mass limits total capacity and unknown mass never produces a fake capacity", () => {
  const state = fixture(100);
  state.locations[0].maxWeightKg = 30;
  for (const sku of state.skus)
    sku.packaging = {
      ...sku.packaging,
      palletWeightKg: 20,
      boxWeightKg: sku.id === "cats" ? 2 : 5,
    };
  state.pallets[0].packagingSnapshot = { ...state.skus[0].packaging };
  addBoxes(state, 1);
  task(state, "heavy", { skuId: "other" });
  assert.equal(assemblyPressure(state).capacityBoxes, 3);
  assert.match(assemblyAcceptanceError(state, "other")!, /масса/);
  state.skus[1].packaging.boxWeightKg = null;
  assert.equal(assemblyPressure(state).level, "unavailable");
  assert.equal(assemblyPressure(state).capacityBoxes, null);
  assert.match(assemblyAcceptanceError(state, "cats")!, /масса/);
});

test("missing, blocked, archived or occupied canonical locations are unavailable", () => {
  for (const mutate of [
    (state: D.WorkspaceDto) => {
      state.locations = [];
    },
    (state: D.WorkspaceDto) => {
      state.locations[0].blocked = true;
    },
    (state: D.WorkspaceDto) => {
      state.locations[0].archived = true;
    },
    (state: D.WorkspaceDto) => {
      state.pallets[0].kind = "finished";
      state.pallets[0].skuId = "cats";
    },
    (state: D.WorkspaceDto) => {
      state.locations[0].maxHeightMm = NaN;
    },
    (state: D.WorkspaceDto) => {
      state.pallets[0].packagingSnapshot = null;
    },
  ]) {
    const state = fixture();
    mutate(state);
    assert.equal(assemblyPressure(state).level, "unavailable");
    assert.equal(assemblyPressure(state).capacityBoxes, null);
    assert.ok(assemblyAcceptanceError(state, "cats"));
  }
});

test("actual putaway take releases pressure immediately while carried boxes stay in warehouse accounting", () => {
  const state = fixture(2);
  addBoxes(state, 2);
  assert.equal(assemblyPressure(state).level, "full");
  state.boxes[0].status = "in_transit";
  state.boxes[0].palletId = null;
  state.boxes[0].locationId = null;
  state.pallets[0].quantity--;
  assert.equal(state.boxes.length, 2);
  assert.equal(assemblyPressure(state).boxes, 1);
  assert.equal(assemblyPressure(state).level, "normal");
  assert.equal(assemblyAcceptanceError(state, "cats"), null);
});

test("an empty configured zone can accept its first box without creating a pallet", () => {
  const state = fixture();
  state.pallets = [];
  const before = JSON.stringify(state);
  assert.equal(assemblyPressure(state).level, "normal");
  assert.equal(assemblyPressure(state).palletId, null);
  assert.equal(assemblyAcceptanceError(state, "cats"), null);
  assert.equal(JSON.stringify(state), before);
});

test("unconfigured seed fields and absent SKU profiles do not invent dimensions or capacity", () => {
  const state = seedWorkspace();
  state.warehouse ??= { workZones: [], zoneWork: [] };
  state.warehouse.workZones ??= [];
  state.warehouse.zoneWork ??= [];
  state.sections ??= [];
  state.movements ??= [];
  state.putawayTasks ??= [];
  const result = assemblyPressure(state);
  assert.equal(result.level, "unavailable");
  assert.equal(result.capacityBoxes, null);
  assert.ok(assemblyAcceptanceError(state, state.skus[0].id));
});

test("specific oversized SKU is rejected even if an ordinary box still fits", () => {
  const state = fixture();
  state.skus[1].packaging = {
    ...DEMO_PACKAGING,
    palletWidthMm: 2000,
    palletDepthMm: 1200,
    boxWidthMm: 1200,
    boxDepthMm: 900,
    boxesPerLayer: 1,
    maxLayers: 1,
  };
  assert.equal(assemblyPressure(state).level, "normal");
  assert.match(assemblyAcceptanceError(state, "other")!, /габариты груза/);
  assert.equal(assemblyAcceptanceError(state, "cats"), null);
});

test("an archived section or another movement reservation makes its assembly address unavailable", () => {
  const state = fixture();
  state.locations[0].sectionId = "section";
  state.sections = [{ id: "section", archived: true }] as D.RackSectionDto[];
  assert.equal(assemblyPressure(state).level, "unavailable");
  state.sections[0].archived = false;
  state.movements = [
    { id: "movement", status: "planned", toLocationId: "assembly" },
  ] as D.MovementDto[];
  assert.match(
    assemblyAcceptanceError(state, "cats")!,
    /зарезервирован перемещением/,
  );
  assert.equal(assemblyPressure(state).level, "unavailable");
});

test("reserved open boxes alone ask to wait instead of putting away nonexistent finished boxes", () => {
  const state = fixture(1);
  task(state, "reserved");
  const result = assemblyPressure(state);
  assert.equal(result.boxes, 0);
  assert.equal(result.committedBoxes, 1);
  assert.equal(result.level, "full");
  assert.match(result.message, /Дождитесь свободного места/);
  assert.doesNotMatch(result.message, /[Рр]азместите/);
  assert.match(assemblyAcceptanceError(state, "cats")!, /Дождитесь/);
  assert.equal(assemblyAcceptanceError(state, "cats", "reserved"), null);
});

test("an empty accumulator validates the candidate's actual new base even with an older small-base open box", () => {
  const state = fixture();
  state.pallets = [];
  task(state, "old-small-base");
  state.skus[1].packaging = { ...DEMO_PACKAGING, palletWidthMm: 2000 };
  assert.match(assemblyAcceptanceError(state, "other")!, /ширине|глубине/);
  assert.equal(assemblyAcceptanceError(state, "cats", "old-small-base"), null);
});

test("legacy different base profiles cannot reserve incompatible boxes in either first-finisher order", () => {
  for (const firstSku of ["cats", "other"]) {
    const state = fixture();
    state.pallets = [];
    state.locations[0].availableWidthMm = 2200;
    state.locations[0].availableDepthMm = 1200;
    state.skus[1].packaging = {
      ...DEMO_PACKAGING,
      palletWidthMm: 2000,
      palletDepthMm: 1200,
      boxWidthMm: 1200,
      boxDepthMm: 900,
      boxesPerLayer: 1,
      maxLayers: 3,
    };
    assert.equal(
      assemblyMetrics(
        state.skus[1].packaging,
        state.skus.map((sku) => sku.packaging),
      ).error,
      null,
    );
    task(state, "first", { skuId: firstSku });
    const candidateSku = firstSku === "cats" ? "other" : "cats";
    assert.ok(assemblyAcceptanceError(state, candidateSku));
    assert.equal(state.pallets.length, 0);
  }
});

test("pressure accounts for real42-box load, its overhang and remaining height without rewriting snapshots", () => {
  const state = fixture(42);
  const profile = {
    ...DEMO_PACKAGING,
    boxWidthMm: 450,
    boxDepthMm: 350,
    boxHeightMm: 200,
    loadWidthMm: 1200,
    loadDepthMm: 900,
    boxesPerLayer: 6,
    maxLayers: 7,
  };
  for (const sku of state.skus) sku.packaging = { ...profile };
  state.pallets[0].packagingSnapshot = { ...profile };
  state.locations[0].availableDepthMm = 900;
  state.locations[0].maxHeightMm = 2200;
  assert.equal(assemblyPressure(state).capacityBoxes, 42);
  assert.equal(assemblyAcceptanceError(state, "cats"), null);
  addBoxes(state, 41);
  const before = JSON.stringify(state);
  assert.equal(assemblyPressure(state).level, "near_full");
  assert.equal(assemblyPressure(state).capacityBoxes, 42);
  assert.equal(assemblyAcceptanceError(state, "cats"), null);
  assert.equal(JSON.stringify(state), before);
  assert.equal(state.pallets[0].widthMm, 1200);
  assert.equal(state.pallets[0].depthMm, 900);
  assert.equal(state.pallets[0].heightMm, 1550);
  addBoxes(state, 1);
  assert.equal(assemblyPressure(state).level, "full");
  assert.match(assemblyAcceptanceError(state, "cats")!, /заполнена/);
});
test("an empty875mm address fits the wood but cannot start a900mm loaded accumulator", () => {
  const state = fixture(42);
  const p = {
    ...DEMO_PACKAGING,
    boxWidthMm: 450,
    boxDepthMm: 350,
    boxHeightMm: 200,
    loadWidthMm: 1200,
    loadDepthMm: 900,
    boxesPerLayer: 6,
    maxLayers: 7,
  };
  for (const sku of state.skus) sku.packaging = { ...p };
  state.pallets[0].packagingSnapshot = { ...p };
  state.locations[0].availableWidthMm = 875;
  state.locations[0].availableDepthMm = 1250;
  state.locations[0].maxHeightMm = 2200;
  const pressure = assemblyPressure(state);
  assert.equal(pressure.level, "full");
  assert.equal(pressure.capacityBoxes, 0);
  assert.match(pressure.message, /ширине и глубине/);
  assert.doesNotMatch(pressure.message, /начатыми коробами/);
  assert.match(assemblyAcceptanceError(state, "cats")!, /ширине и глубине/);
});

test("a retained empty legacy pallet uses measured current SKU packing without rewriting its old snapshot", () => {
  const state = fixture(42);
  state.locations[0].availableDepthMm = 900;
  state.locations[0].maxHeightMm = 2200;
  state.skus[0].packaging = { ...DEFAULT_PACKAGING };
  const original = JSON.stringify(state.pallets[0]);
  assert.equal(assemblyPressure(state).capacityBoxes, 42);
  assert.equal(assemblyPressure(state).level, "normal");
  assert.equal(assemblyAcceptanceError(state, "cats"), null);
  assert.equal(JSON.stringify(state.pallets[0]), original);
  assert.equal(state.pallets[0].packagingSnapshot!.boxHeightMm, 300);
});
