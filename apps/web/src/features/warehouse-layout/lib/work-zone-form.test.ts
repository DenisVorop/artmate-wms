import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  LocationDto,
  PalletDto,
  WorkZoneDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";
import {
  eligibleZoneLocations,
  toCreateWorkZone,
  toUpdateWorkZone,
  workZoneDefaults,
  workZoneSchema,
  workZoneSchemaFor,
} from "./work-zone-form";
const location = (
  id: string,
  kind: LocationDto["kind"],
  extra: Partial<LocationDto> = {},
): LocationDto => ({
  id,
  code: id,
  name: id,
  kind,
  sectionId: null,
  level: 1,
  levels: 1,
  rotation: 0,
  x: 0,
  y: 0,
  width: 1.3,
  depth: 0.9,
  maxHeightMm: 1800,
  maxBoxes: 18,
  availableWidthMm: 1300,
  availableDepthMm: 900,
  maxWeightKg: null,
  accessSides: 1,
  blocked: false,
  archived: false,
  archivedAt: null,
  ...extra,
});
const zone = (
  id: string,
  kind: WorkZoneDto["kind"],
  locationIds: string[],
): WorkZoneDto => ({
  id,
  code: id,
  name: id,
  kind,
  locationIds,
  archived: false,
  archivedAt: null,
});
const pallet = (
  locationId: string,
  kind: PalletDto["kind"] = "assembly",
): PalletDto => ({
  id: "p",
  code: "p",
  locationId,
  kind,
  status: "stored",
  returnLocationId: null,
  skuId: kind === "assembly" ? null : "sku",
  lotId: null,
  quantity: 0,
  widthMm: 1300,
  depthMm: 900,
  heightMm: 100,
  weightKg: null,
  packagingSnapshot: null,
});
function data(): Pick<
  WorkspaceDto,
  | "locations"
  | "pallets"
  | "warehouse"
  | "movements"
  | "putawayTasks"
  | "addressHolds"
> {
  return {
    locations: [
      location("R", "receiving"),
      location("A", "assembly"),
      location("B", "assembly"),
      location("P", "picking"),
      location("S", "shipping"),
      location("F", "floor"),
      location("X", "assembly", { archived: true }),
      location("Y", "receiving", { blocked: true }),
    ],
    pallets: [],
    movements: [],
    putawayTasks: [],
    warehouse: {
      name: "Склад",
      width: 24,
      depth: 16,
      layoutMode: "rectangle",
      spaces: [],
      workZones: [],
      zoneWork: [],
    },
  };
}
test("zone memberships follow actual address kinds; storage, archived and blocked addresses are not eligible", () => {
  const s = data();
  assert.deepEqual(
    eligibleZoneLocations(s, "receiving").map((l) => l.id),
    ["R"],
  );
  assert.deepEqual(
    eligibleZoneLocations(s, "putaway").map((l) => l.id),
    ["A", "B"],
  );
  assert.deepEqual(
    eligibleZoneLocations(s, "shipping").map((l) => l.id),
    ["P", "S"],
  );
});
test("assembly uses one global mixed-pallet address even if another address sorts earlier; quantity zero still physical", () => {
  const s = data();
  s.pallets = [pallet("B")];
  assert.deepEqual(
    eligibleZoneLocations(s, "assembly").map((l) => l.id),
    ["B"],
  );
  assert.equal(s.pallets[0].quantity, 0);
});
test("assembly reuses active canonical zone before first empty address; archived zones do not bind new work", () => {
  const s = data();
  s.warehouse.workZones = [zone("current", "assembly", ["B"])];
  assert.deepEqual(
    eligibleZoneLocations(s, "assembly").map((l) => l.id),
    ["B"],
  );
  s.warehouse.workZones[0].archived = true;
  assert.deepEqual(
    eligibleZoneLocations(s, "assembly").map((l) => l.id),
    ["A"],
  );
});
test("assembly chooses physically empty address; logical zone membership is not a physical reserve", () => {
  const s = data();
  s.pallets = [pallet("A", "finished")];
  assert.deepEqual(
    eligibleZoneLocations(s, "assembly").map((l) => l.id),
    ["B"],
  );
  s.addressHolds = [{ locationId: "B", kind: "movement" }];
  assert.deepEqual(
    eligibleZoneLocations(s, "assembly").map((l) => l.id),
    ["B"],
  );
});
test("zone mapper keeps auto naming blank, emits only membership fields plus requestId, and never changes geometry/stock", () => {
  const value = {
    kind: "receiving" as const,
    name: "  ",
    code: "",
    locationIds: ["R"],
  };
  const dto = toCreateWorkZone({ ...value, x: 99 } as typeof value);
  assert.equal(dto.name, "");
  assert.equal(dto.code, "");
  assert.equal("x" in dto, false);
  assert.deepEqual(dto.locationIds, ["R"]);
  assert.ok(dto.requestId);
  assert.notEqual(
    toUpdateWorkZone({ ...value, name: "Зона", code: "WZ-01" }).requestId,
    dto.requestId,
  );
});
test("empty, duplicate or excessive membership is rejected; editing preserves a copied selection", () => {
  const z = zone("zone", "assembly", ["A"]);
  const defaults = workZoneDefaults(z);
  defaults.locationIds.push("B");
  assert.deepEqual(z.locationIds, ["A"]);
  assert.equal(
    workZoneSchema.safeParse({ ...defaults, locationIds: [] }).success,
    false,
  );
  assert.equal(
    workZoneSchema.safeParse({ ...defaults, locationIds: ["A", "A"] }).success,
    false,
  );
  assert.equal(
    workZoneSchema.safeParse({
      ...defaults,
      locationIds: Array.from({ length: 201 }, (_, i) => String(i)),
    }).success,
    false,
  );
  assert.equal(
    workZoneSchema.safeParse({ ...defaults, code: "x".repeat(41) }).success,
    false,
  );
});

test("existing zone identity cannot be erased while new identity may be assigned by server", () => {
  const value = {
    kind: "receiving" as const,
    name: "",
    code: "",
    locationIds: ["R"],
  };
  assert.equal(workZoneSchema.safeParse(value).success, true);
  assert.equal(workZoneSchemaFor(true).safeParse(value).success, false);
  assert.throws(() => toUpdateWorkZone(value));
});

test("an unavailable canonical mixed pallet cannot silently redirect a new assembly zone", () => {
  const s = data();
  s.pallets = [pallet("B")];
  s.locations.find((l) => l.id === "B")!.blocked = true;
  assert.deepEqual(eligibleZoneLocations(s, "assembly"), []);
});
