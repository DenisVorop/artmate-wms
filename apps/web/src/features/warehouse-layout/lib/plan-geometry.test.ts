import assert from "node:assert/strict";
import { test } from "node:test";
import { EntranceDtoWall } from "@/shared/api/generated/model";
import {
  entranceCenter,
  findSuggestedPosition,
  nearestEntrancePosition,
  rectanglesOverlap,
  rotatedFootprint,
  snapAndClampPosition,
  wallSegments,
} from "./plan-geometry";

test("Поворот 90/270 меняет footprint, поворот 180 сохраняет габариты", () => {
  assert.deepEqual(rotatedFootprint({ width: 4, depth: 2, rotation: 90 }), {
    width: 2,
    depth: 4,
  });
  assert.deepEqual(rotatedFootprint({ width: 4, depth: 2, rotation: 270 }), {
    width: 2,
    depth: 4,
  });
  assert.deepEqual(rotatedFootprint({ width: 4, depth: 2, rotation: 180 }), {
    width: 4,
    depth: 2,
  });
});

test("Перетаскивание привязывается к 0,1 м и ограничено настоящим помещением с учётом поворота", () => {
  const rectangle = { width: 4, depth: 2, rotation: 90 };
  assert.deepEqual(
    snapAndClampPosition({ x: 30, y: 20 }, rectangle, { width: 10, depth: 7 }),
    { x: 8, y: 3 },
  );
  assert.deepEqual(
    snapAndClampPosition({ x: -2, y: 1.3 }, rectangle, { width: 10, depth: 7 }),
    { x: 0, y: 1.3 },
  );
  assert.deepEqual(
    snapAndClampPosition({ x: 10, y: 9 }, rectangle, {
      width: 10.2,
      depth: 7.2,
    }),
    { x: 8.2, y: 3.2 },
  );
});

test("Прилегание допустимо, но реальное пересечение повёрнутых footprints обнаруживается", () => {
  const rack = { x: 0, y: 0, width: 4, depth: 2, rotation: 90 };
  assert.equal(
    rectanglesOverlap(rack, { x: 2, y: 0, width: 3, depth: 1, rotation: 0 }),
    false,
  );
  assert.equal(
    rectanglesOverlap(rack, {
      x: 1.5,
      y: 3.5,
      width: 3,
      depth: 1,
      rotation: 0,
    }),
    true,
  );
  assert.deepEqual(
    findSuggestedPosition({ width: 3, depth: 2 }, [rack], {
      width: 1,
      depth: 1,
      rotation: 0,
    }),
    { x: 2, y: 0 },
  );
  assert.equal(
    findSuggestedPosition(
      { width: 2, depth: 2 },
      [{ x: 0, y: 0, width: 2, depth: 2, rotation: 0 }],
      { width: 1, depth: 1, rotation: 0 },
    ),
    null,
  );
});

test("Вход выбирает ближайшую подходящую стену и остаётся целиком в её границах", () => {
  const bounds = { width: 10, depth: 6 };
  assert.deepEqual(nearestEntrancePosition({ x: 9.9, y: 5.8 }, 2, bounds), {
    wall: EntranceDtoWall.east,
    spaceId: null,
    offset: 4,
  });
  assert.deepEqual(nearestEntrancePosition({ x: -2, y: 0.1 }, 2, bounds), {
    wall: EntranceDtoWall.north,
    spaceId: null,
    offset: 0,
  });
  assert.deepEqual(
    nearestEntrancePosition({ x: 10, y: 1 }, 8, { width: 10, depth: 2 }),
    { wall: EntranceDtoWall.north, offset: 2, spaceId: null },
  );
  assert.deepEqual(
    entranceCenter(
      { wall: EntranceDtoWall.south, offset: 3, width: 2 },
      bounds,
    ),
    { x: 4, y: 6 },
  );
});

test("Стена имеет настоящий разрыв для каждого входа, включая соприкасающиеся проёмы", () => {
  const north = wallSegments({ width: 10, depth: 6 }, [
    { wall: EntranceDtoWall.north, offset: 2, width: 2 },
    { wall: EntranceDtoWall.north, offset: 4, width: 1 },
  ]).filter((segment) => segment.wall === EntranceDtoWall.north);
  assert.deepEqual(north, [
    { wall: EntranceDtoWall.north, start: 0, end: 2 },
    { wall: EntranceDtoWall.north, start: 5, end: 10 },
  ]);
});
