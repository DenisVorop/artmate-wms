import assert from "node:assert/strict";
import test from "node:test";
import type {
  LocationDto,
  StocktakeRowDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";
import { stocktakeWalk } from "./stocktake-walk";

const row = (id: string) =>
  ({ locationId: id, locationCode: id }) as StocktakeRowDto;
const place = (
  id: string,
  x: number,
  y: number,
  level = 1,
  sectionId: string | null = null,
) =>
  ({
    id,
    x,
    y,
    level,
    sectionId,
    width: 1,
    depth: 1,
    rotation: 0,
    archived: false,
  }) as LocationDto;

test("the walk visits every tier before moving to the next stop and finishes one room at a time", () => {
  const rows = ["F-02", "A-01-02", "B-01", "A-02", "A-01-01", "F-01"].map(row);
  const layout: Pick<WorkspaceDto, "warehouse" | "locations" | "entrances"> = {
    warehouse: {
      name: "Test",
      width: 8,
      depth: 25,
      layoutMode: "spaces",
      workZones: [],
      zoneWork: [],
      spaces: [
        {
          id: "large",
          name: "Large",
          kind: "room",
          x: 0,
          y: 12,
          width: 8,
          depth: 13,
          archived: false,
          archivedAt: null,
        },
        {
          id: "small",
          name: "Small",
          kind: "room",
          x: 0,
          y: 0,
          width: 8,
          depth: 10,
          archived: false,
          archivedAt: null,
        },
      ],
    },
    entrances: [
      {
        id: "door",
        name: "Door",
        spaceId: "small",
        wall: "south",
        offset: 0,
        width: 2,
        archived: false,
        archivedAt: null,
      },
    ],
    locations: [
      place("A-01-01", 1, 8, 1, "section"),
      place("A-01-02", 1, 8, 2, "section"),
      place("A-02", 1, 6),
      place("B-01", 1, 13),
      place("F-01", 1, 15),
      place("F-02", 1, 16),
    ],
  };
  const expected = ["A-01-01", "A-01-02", "A-02", "B-01", "F-01", "F-02"];
  assert.deepEqual(
    stocktakeWalk(rows, layout).map((r) => r.locationId),
    expected,
  );
  assert.deepEqual(
    stocktakeWalk([...rows].reverse(), layout).map((r) => r.locationId),
    expected,
  );
  assert.deepEqual(
    stocktakeWalk(rows, layout, "F-02").map((r) => r.locationId),
    ["F-02", "F-01", "B-01", "A-01-01", "A-01-02", "A-02"],
  );
  assert.equal(rows[0].locationId, "F-02");
});

test("missing map positions keep a natural address order and never drop rows", () => {
  const rows = [row("F-10"), row("F-2")];
  assert.deepEqual(
    stocktakeWalk(rows).map((r) => r.locationId),
    ["F-2", "F-10"],
  );
});
