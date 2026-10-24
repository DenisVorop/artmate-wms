import { randomUUID } from "node:crypto";
import { DEMO_PACKAGING } from "./physical";
import { WorkspaceDto } from "./dto";
/** Additive V2 data migration: keep IDs, codes, inventory and provenance unchanged. */
export function migrateAddressesAndMovements(state: any): WorkspaceDto {
  state.sections ??= [];
  state.movements ??= [];
  for (const sku of state.skus)
    sku.packaging ??= structuredClone(DEMO_PACKAGING);
  const locations = [...state.locations];
  for (const location of locations) {
    const oldLevels = Math.max(1, location.levels ?? 1);
    location.level = location.level ?? 1;
    location.levels = 1;
    location.availableWidthMm ??= 1400;
    location.availableDepthMm ??= 1000;
    location.maxWeightKg ??= null;
    location.accessSides ??= location.kind === "picking" ? 4 : 1;
    location.sectionId ??= null;
    if (location.kind === "rack" && !location.sectionId) {
      const section = {
        id: `section-${location.id}`,
        code: `SEC-${location.code}`,
        name: location.name,
        x: location.x,
        y: location.y,
        width: location.width,
        depth: location.depth,
      };
      state.sections.push(section);
      location.sectionId = section.id;
      for (let level = 2; level <= oldLevels; level++) {
        let code = `${location.code}-L${level}`;
        let suffix = 1;
        while (
          state.locations.some(
            (l: any) => l.code.toLowerCase() === code.toLowerCase(),
          )
        )
          code = `${location.code}-L${level}-M${suffix++}`;
        state.locations.push({
          ...location,
          id: randomUUID(),
          code,
          name: `${location.name} · Ярус ${level}`,
          level,
        });
      }
    }
  }
  for (const pallet of state.pallets) {
    pallet.widthMm ??= 1200;
    pallet.depthMm ??= 800;
    pallet.weightKg ??= null;
    pallet.status ??= "stored";
    pallet.returnLocationId ??= null;
    pallet.packagingSnapshot ??=
      pallet.kind === "finished" ? structuredClone(DEMO_PACKAGING) : null;
  }
  for (const box of state.boxes)
    box.packagingSnapshot ??= structuredClone(DEMO_PACKAGING);
  if (!state.locations.some((l: any) => l.kind === "picking"))
    state.locations.push({
      id: "loc-picking",
      code: "PICK-01",
      name: "Демо · Четырёхсторонний отбор",
      kind: "picking",
      x: 20,
      y: 10,
      width: 3,
      depth: 2,
      levels: 1,
      sectionId: null,
      level: 1,
      availableWidthMm: 1400,
      availableDepthMm: 1000,
      maxWeightKg: null,
      accessSides: 4,
      maxHeightMm: 2500,
      maxBoxes: 36,
      blocked: false,
    });
  return state;
}

/** Version 3 only adds plan metadata and archive defaults; existing footprints stay put. */
export function migratePlanBuilder(state: any): WorkspaceDto {
  state.aisles ??= [];
  state.entrances ??= [];
  for (const section of state.sections) {
    section.rotation ??= 0;
    section.archived ??= false;
    section.archivedAt ??= null;
    section.archivedLocationIds ??= [];
  }
  for (const location of state.locations) {
    location.rotation ??= location.sectionId
      ? (state.sections.find((s: any) => s.id === location.sectionId)
          ?.rotation ?? 0)
      : 0;
    location.archived ??= false;
    location.archivedAt ??= null;
  }
  for (const entity of [...state.aisles, ...state.entrances]) {
    entity.archived ??= false;
    entity.archivedAt ??= null;
  }
  let right = 22,
    bottom = 14;
  for (const rect of [
    ...state.sections,
    ...state.locations.filter((l: any) => !l.sectionId),
    ...state.aisles,
  ].filter((r: any) => !r.archived)) {
    const rotated = rect.rotation === 90 || rect.rotation === 270;
    const r = rect.x + (rotated ? rect.depth : rect.width),
      b = rect.y + (rotated ? rect.width : rect.depth);
    if (Number.isFinite(r)) right = Math.max(right, r);
    if (Number.isFinite(b)) bottom = Math.max(bottom, b);
  }
  state.warehouse ??= {
    name: "Склад Artmate",
    width: Math.ceil(Math.max(24, right + 2)),
    depth: Math.ceil(Math.max(16, bottom + 2)),
  };
  return state;
}

/** V4 adds spaces mode without replacing the rectangle or seeding user geometry. */
export function migrateSpaces(state: any): WorkspaceDto {
  state.warehouse.layoutMode ??= "rectangle";
  state.warehouse.spaces ??= [];
  for (const entrance of state.entrances)
    if (entrance.spaceId === undefined) entrance.spaceId = null;
  return state;
}
