import { test } from "node:test";
import assert from "node:assert/strict";
import type { WorkspaceDto } from "../src/dto";
import { workRouteLayoutKey } from "../src/route-layout-key";
const geometry = () =>
  ({
    warehouse: {
      layoutMode: "spaces",
      width: 30,
      depth: 20,
      spaces: [
        {
          id: "r",
          kind: "room",
          x: 1,
          y: 2,
          width: 8,
          depth: 7,
          archived: false,
        },
      ],
      name: "Склад",
      workZones: [],
      zoneWork: [],
    },
    locations: [
      {
        id: "l",
        kind: "rack",
        sectionId: "s",
        level: 1,
        x: 2,
        y: 3,
        width: 2,
        depth: 1,
        rotation: 90,
        archived: false,
        blocked: false,
      },
    ],
    sections: [
      {
        id: "s",
        x: 2,
        y: 3,
        width: 2,
        depth: 1,
        rotation: 90,
        archived: false,
      },
    ],
    aisles: [
      { id: "a", x: 1, y: 5, width: 8, depth: 1, rotation: 0, archived: false },
    ],
    entrances: [
      {
        id: "e",
        spaceId: "r",
        wall: "south",
        offset: 2,
        width: 1,
        archived: false,
      },
    ],
    revision: 10,
    pallets: [],
  }) as unknown as WorkspaceDto;
test("layout identity matches a fixed server/browser SHA256 vector", async () => {
  assert.equal(
    await workRouteLayoutKey(geometry()),
    "d1c4fb797a95580d1798032848e76bcbc37e0c179f5f2f28b0ede31001649dcc",
  );
});
test("inventory revision, labels and row order preserve route identity; geometry invalidates it", async () => {
  const s = geometry(),
    original = await workRouteLayoutKey(s);
  s.revision++;
  s.locations[0].name = "Переименовано";
  s.warehouse.name = "Другое имя";
  assert.equal(await workRouteLayoutKey(s), original);
  s.locations.push({ ...s.locations[0], id: "z", level: 2 });
  const two = await workRouteLayoutKey(s);
  s.locations.reverse();
  assert.equal(await workRouteLayoutKey(s), two);
  s.sections[0].rotation = 0;
  assert.notEqual(await workRouteLayoutKey(s), two);
  s.sections[0].rotation = 90;
  s.entrances[0].archived = true;
  assert.notEqual(await workRouteLayoutKey(s), two);
});
