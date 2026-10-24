import test from "node:test";
import assert from "node:assert/strict";
import type {
  LocationDto,
  RackSectionDto,
  WarehouseSpaceDto,
} from "@/shared/api/generated/model";
import {
  locationInsideSpace,
  resolveStocktakeScope,
  stocktakeLocations,
} from "./stocktake-scope";

const location = (
  id: string,
  patch: Partial<LocationDto> = {},
): LocationDto => ({
  id,
  code: id,
  name: id,
  archived: false,
  archivedAt: null,
  rotation: 0,
  sectionId: null,
  level: 1,
  availableWidthMm: 1300,
  availableDepthMm: 900,
  maxWeightKg: null,
  accessSides: 1,
  kind: "floor",
  x: 0,
  y: 0,
  width: 1.3,
  depth: 0.9,
  levels: 1,
  maxHeightMm: 1000,
  maxBoxes: 18,
  blocked: false,
  ...patch,
});
const room: WarehouseSpaceDto = {
  id: "room",
  name: "Зал",
  kind: "room",
  archived: false,
  archivedAt: null,
  x: 0,
  y: 0,
  width: 3,
  depth: 2,
};
const section: RackSectionDto = {
  id: "section",
  name: "Секция",
  code: "R-01",
  archived: false,
  archivedAt: null,
  rotation: 0,
  archivedLocationIds: [],
  x: 0,
  y: 0,
  width: 1.3,
  depth: 0.9,
};
test("room scope includes whole rotated footprints and excludes partial overlaps", () => {
  assert.equal(
    locationInsideSpace(location("turn", { x: 2, rotation: 90 }), room),
    true,
  );
  assert.equal(locationInsideSpace(location("overlap", { x: 2 }), room), false);
  assert.equal(
    locationInsideSpace(location("outside", { x: -0.1 }), room),
    false,
  );
});
test("scope resolves only active storage addresses, retaining blocked addresses as countable", () => {
  const rows = [
    location("P-10"),
    location("P-2", { blocked: true }),
    location("archived", { archived: true }),
    location("assembly", { kind: "assembly" }),
  ];
  assert.deepEqual(
    stocktakeLocations(rows).map((item) => item.id),
    ["P-2", "P-10"],
  );
  assert.deepEqual(
    resolveStocktakeScope(
      "locations",
      "",
      ["P-2", "archived", "missing"],
      rows,
      [],
      [],
    ).map((item) => item.id),
    ["P-2"],
  );
});
test("section scope counts distinct levels and never silently falls back for archived containers", () => {
  const rows = [
    location("R-01-01", { kind: "rack", sectionId: "section" }),
    location("R-01-02", { kind: "rack", sectionId: "section", level: 2 }),
    location("other"),
  ];
  assert.equal(
    resolveStocktakeScope("section", "section", [], rows, [section], []).length,
    2,
  );
  assert.deepEqual(
    resolveStocktakeScope(
      "section",
      "section",
      [],
      rows,
      [{ ...section, archived: true }],
      [],
    ),
    [],
  );
  assert.deepEqual(
    resolveStocktakeScope(
      "room",
      "room",
      [],
      rows,
      [],
      [{ ...room, archived: true }],
    ),
    [],
  );
});
