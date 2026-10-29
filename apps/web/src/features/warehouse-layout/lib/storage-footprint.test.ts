import assert from "node:assert/strict";
import { test } from "node:test";
import type { LocationDto, RackSectionDto } from "@/shared/api/generated/model";
import {
  DEFAULT_STORAGE_FOOTPRINT,
  MIN_STORAGE_SIZE_METERS,
  levelProfileSchema,
  locationDefaults,
  locationSchema,
  profileDefaults,
  toCreateLocation,
  toUpdateLocation,
} from "./location-form";
import {
  newSectionSchema,
  sectionDefaults,
  sectionEditSchema,
  toCreateSection,
  toUpdateSection,
} from "./rack-form";
import { aisleSchema, warehousePlanSchema } from "./plan-form";
import { spaceSchema } from "./space-form";

function newLocation() {
  return { ...locationDefaults(), code: "F-01", name: "Напольное место" };
}
function newSection() {
  return {
    ...sectionDefaults(),
    code: "A",
    name: "Секция",
    levels: [{ ...profileDefaults(), code: "A-01", name: "Ярус 1" }],
  };
}

test("новые место и секция рассчитаны на груз 1,2 × 0,9 м на европаллете и до 42 коробов", () => {
  assert.deepEqual(DEFAULT_STORAGE_FOOTPRINT, {
    width: 1.2,
    depth: 0.9,
    rotation: 0,
  });
  assert.equal(MIN_STORAGE_SIZE_METERS, 0.1);
  const location = locationSchema.parse(newLocation());
  const section = newSectionSchema.parse(newSection());
  assert.equal(location.maxBoxes, 42);
  assert.equal(section.levels[0]!.maxBoxes, 42);
  assert.deepEqual([location.width, location.depth], [1.2, 0.9]);
  assert.deepEqual([section.width, section.depth], [1.2, 0.9]);
  assert.deepEqual(
    [location.availableWidthMm, location.availableDepthMm],
    [1200, 900],
  );
  assert.deepEqual(
    [section.levels[0]!.availableWidthMm, section.levels[0]!.availableDepthMm],
    [1200, 900],
  );
});

test("1,2 × 0,8, минимальные 0,1 м и точные дроби проходят мапперы без округления", () => {
  for (const [width, depth] of [
    [1.2, 0.8],
    [0.1, 0.1],
    [0.123456, 0.876543],
  ]) {
    for (const rotation of [0, 90, 180, 270]) {
      const location = locationSchema.parse({
        ...newLocation(),
        width,
        depth,
        rotation,
      });
      const section = newSectionSchema.parse({
        ...newSection(),
        width,
        depth,
        rotation,
      });
      for (const dto of [
        toCreateLocation(location),
        toUpdateLocation(location, false),
        toCreateSection(section),
        toUpdateSection(section),
      ])
        assert.deepEqual(
          [dto.width, dto.depth, dto.rotation],
          [width, depth, rotation],
        );
      assert.deepEqual(
        [location.availableWidthMm, location.availableDepthMm],
        [1200, 900],
      );
    }
  }
});

test("размеры ниже 0,1 м и нечисловые значения не проходят storage формы", () => {
  for (const field of ["width", "depth"] as const) {
    for (const invalid of [0.0999, 0, -1, NaN, Infinity, null]) {
      assert.equal(
        locationSchema.safeParse({ ...newLocation(), [field]: invalid })
          .success,
        false,
      );
      assert.equal(
        newSectionSchema.safeParse({ ...newSection(), [field]: invalid })
          .success,
        false,
      );
      assert.equal(
        sectionEditSchema.safeParse({ ...newSection(), [field]: invalid })
          .success,
        false,
      );
    }
  }
});

test("открытие существующего места и секции сохраняет геометрию и физические ограничения", () => {
  const location: LocationDto = {
    ...newLocation(),
    id: "old-location",
    kind: "floor",
    sectionId: null,
    level: 1,
    levels: 1,
    archived: false,
    archivedAt: null,
    x: 7.2,
    y: 4.6,
    width: 3,
    depth: 1.5,
    rotation: 180,
    availableWidthMm: 1450,
    availableDepthMm: 1050,
    maxHeightMm: 2400,
    maxBoxes: 24,
    maxWeightKg: 350,
  };
  const loaded = locationDefaults(location);
  assert.deepEqual(
    [loaded.x, loaded.y, loaded.width, loaded.depth, loaded.rotation],
    [7.2, 4.6, 3, 1.5, 180],
  );
  assert.deepEqual(
    [
      loaded.availableWidthMm,
      loaded.availableDepthMm,
      loaded.maxHeightMm,
      loaded.maxBoxes,
      loaded.maxWeightKg,
    ],
    [1450, 1050, 2400, 24, 350],
  );
  const section: RackSectionDto = {
    id: "old-section",
    code: "OLD",
    name: "Старая секция",
    archived: false,
    archivedAt: null,
    archivedLocationIds: [],
    x: 10.2,
    y: 6.7,
    width: 4.5,
    depth: 2.3,
    rotation: 270,
  };
  const loadedSection = sectionDefaults(section, [
    { ...location, kind: "rack", sectionId: section.id },
  ]);
  assert.deepEqual(
    [
      loadedSection.x,
      loadedSection.y,
      loadedSection.width,
      loadedSection.depth,
      loadedSection.rotation,
    ],
    [10.2, 6.7, 4.5, 2.3, 270],
  );
  assert.deepEqual(
    [
      loadedSection.levels[0]!.availableWidthMm,
      loadedSection.levels[0]!.availableDepthMm,
    ],
    [1450, 1050],
  );
});

test("минимумы проходов, участков, поля и физических величин не уменьшаются вместе со storage", () => {
  assert.equal(
    aisleSchema.safeParse({
      ...newLocation(),
      name: "Проход",
      width: 0.1,
      depth: 1,
    }).success,
    false,
  );
  assert.equal(
    spaceSchema.safeParse({
      name: "Комната",
      kind: "room",
      x: 0,
      y: 0,
      width: 0.1,
      depth: 1,
    }).success,
    false,
  );
  assert.equal(
    warehousePlanSchema.safeParse({ name: "План", width: 0.1, depth: 1 })
      .success,
    false,
  );
  const profile = { ...profileDefaults(), code: "A-01", name: "Ярус" };
  for (const patch of [
    { maxBoxes: 0 },
    { maxHeightMm: 99 },
    { availableWidthMm: 99 },
    { availableDepthMm: 99 },
  ])
    assert.equal(
      levelProfileSchema.safeParse({ ...profile, ...patch }).success,
      false,
    );
});
