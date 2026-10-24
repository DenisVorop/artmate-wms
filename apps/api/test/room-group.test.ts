import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { ValidationPipe } from "@nestjs/common";
import { WarehouseService } from "../src/warehouse.service";
import { WarehouseController } from "../src/app";
import { ResizeSpaceDto, UpdateSpaceDto } from "../src/dto";
const req = () => ({ requestId: randomUUID() });
async function isolated(run: (w: WarehouseService) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "artmate-wms-group-")),
    path = join(dir, "db"),
    previous = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = path;
  let w: WarehouseService | undefined;
  try {
    const db = new PGlite(path);
    await db.waitReady;
    await db.exec(
      "CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
    );
    for (const [key, value] of [
      ["seeded", "1"],
      ["schema_version", "7"],
      ["workspace_revision", "4"],
      [
        "warehouse",
        JSON.stringify({
          name: "Изолированная схема",
          layoutMode: "rectangle",
          width: 80,
          depth: 80,
          spaces: [],
        }),
      ],
    ])
      await db.query("INSERT INTO metadata VALUES($1,$2)", [key, value]);
    await db.close();
    w = new WarehouseService();
    await run(w);
  } finally {
    await w?.onModuleDestroy();
    if (previous === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
}
const floor = (code: string, x: number, y: number, extra = {}) => ({
  ...req(),
  code,
  name: code,
  kind: "floor",
  x,
  y,
  width: 2,
  depth: 2,
  levels: 1,
  maxHeightMm: 2000,
  maxBoxes: 36,
  availableWidthMm: 1400,
  availableDepthMm: 1000,
  accessSides: 1,
  ...extra,
});
async function move(
  w: WarehouseService,
  id: string,
  body: Record<string, unknown>,
) {
  const dto = await new ValidationPipe({
    expectedType: UpdateSpaceDto,
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }).transform({ ...req(), ...body }, { type: "body" });
  return new WarehouseController(w).updateSpace(id, dto);
}

test("HTTP group translate+shrink cannot silently assign an old member to the neighboring room", async () =>
  isolated(async (w) => {
    let s = await w.createSpace({
      ...req(),
      name: "Исходное помещение",
      kind: "room",
      x: 20,
      y: 20,
      width: 10,
      depth: 10,
    });
    const room = s.warehouse.spaces[0];
    s = await w.createSpace({
      ...req(),
      name: "Сосед",
      kind: "room",
      x: 30,
      y: 20,
      width: 10,
      depth: 10,
    });
    s = await w.createLocation(
      floor("EDGE-MEMBER", 28, 22, { width: 1, depth: 1 }),
    );
    const before = await w.snapshot(),
      request = req();
    await assert.rejects(
      move(w, room.id, { ...request, x: 22, width: 7 }),
      /тот же участок/,
    );
    assert.deepEqual(await w.snapshot(), before);
    // The exact failed key remains free, proving no command or partial geometry was committed.
    s = await move(w, room.id, { ...request, x: 18, width: 12 });
    assert.equal(s.revision, before.revision + 1);
    assert.equal(s.locations.find((l) => l.code === "EDGE-MEMBER")!.x, 26);
    assert.equal(s.warehouse.spaces.find((r) => r.name === "Сосед")!.x, 30);
  }));

test("HTTP group move rejects new outside collisions and selects only OLD fully rotated footprints with epsilon tolerance", async () =>
  isolated(async (w) => {
    let s = await w.createSpace({
      ...req(),
      name: "Редактируемая область",
      kind: "room",
      x: 20,
      y: 20,
      width: 10,
      depth: 10,
    });
    const room = s.warehouse.spaces[0];
    // Rectangle mode permits legacy objects outside the drawn region; they must not be captured or overwritten.
    await w.updateWarehousePlan({ ...req(), layoutMode: "rectangle" });
    await w.createLocation(floor("INSIDE", 22, 22));
    await w.createLocation(floor("OUTSIDE", 35, 22));
    await w.createLocation(floor("PARTIAL", 29, 26));
    await w.createLocation(
      floor("ROTATED-IN", 29.5000000005, 21.123456789123, {
        width: 4,
        depth: 0.5,
        rotation: 90,
      }),
    );
    await w.createLocation(
      floor("ROTATED-OUT", 28, 29, { width: 0.5, depth: 4, rotation: 90 }),
    );
    const before = await w.snapshot();
    await assert.rejects(move(w, room.id, { x: 33 }), /пересекается/);
    assert.deepEqual(await w.snapshot(), before);
    s = await move(w, room.id, { x: 40 });
    assert.equal(s.locations.find((l) => l.code === "INSIDE")!.x, 42);
    assert.equal(s.locations.find((l) => l.code === "OUTSIDE")!.x, 35);
    assert.equal(s.locations.find((l) => l.code === "PARTIAL")!.x, 29);
    assert.equal(
      s.locations.find((l) => l.code === "ROTATED-IN")!.x,
      49.5000000005,
    );
    assert.equal(
      s.locations.find((l) => l.code === "ROTATED-IN")!.y,
      21.123456789123,
    );
    assert.equal(s.locations.find((l) => l.code === "ROTATED-OUT")!.x, 28);
  }));

async function resize(
  w: WarehouseService,
  id: string,
  body: Record<string, unknown>,
) {
  const dto = await new ValidationPipe({
    expectedType: ResizeSpaceDto,
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }).transform({ ...req(), ...body }, { type: "body" });
  return new WarehouseController(w).resizeSpace(id, dto);
}
test("boundary resize is strict, rejects lost old members and doors, and leaves object positions intact", async () =>
  isolated(async (w) => {
    let s = await w.createSpace({
      ...req(),
      name: "Resize",
      kind: "room",
      x: 20,
      y: 20,
      width: 10,
      depth: 10,
    });
    const room = s.warehouse.spaces[0];
    await w.createLocation(
      floor("RESIZE-ROTATED", 27, 22.123456789123, {
        width: 4,
        depth: 0.5,
        rotation: 90,
      }),
    );
    s = await w.createEntrance({
      ...req(),
      spaceId: room.id,
      name: "Resize door",
      wall: "north",
      offset: 8,
      width: 1,
    });
    const before = await w.snapshot();
    for (const field of ["x", "y", "width", "depth"])
      for (const value of [undefined, null, NaN, Infinity, "1", true]) {
        const body: Record<string, unknown> = {
          x: 20,
          y: 20,
          width: 10,
          depth: 10,
          [field]: value,
        };
        if (value === undefined) delete body[field];
        await assert.rejects(
          resize(w, room.id, body),
          (e: any) => e.getStatus() === 400,
        );
      }
    for (const bad of [
      { x: -0.1 },
      { y: -0.1 },
      { width: 0.49 },
      { depth: 0.49 },
      { width: 1000.1 },
      { depth: 1000.1 },
      { name: "injected" },
    ])
      await assert.rejects(
        resize(w, room.id, { x: 20, y: 20, width: 10, depth: 10, ...bad }),
      );
    // The object fits a narrower room; the bound north-wall opening does not.
    await assert.rejects(
      resize(w, room.id, { x: 20, y: 20, width: 8, depth: 10 }),
      /Вход выходит/,
    );
    assert.deepEqual(await w.snapshot(), before);
    const request = req();
    await assert.rejects(
      resize(w, room.id, { ...request, x: 30, y: 20, width: 10, depth: 10 }),
      /том же участке/,
    );
    assert.deepEqual(await w.snapshot(), before);
    s = await resize(w, room.id, {
      ...request,
      x: 19,
      y: 19,
      width: 12,
      depth: 12,
    });
    assert.deepEqual(s.locations, before.locations);
    assert.deepEqual(s.entrances, before.entrances);
    assert.equal(s.locations[0].y, 22.123456789123);
    await assert.rejects(
      resize(w, room.id, { x: 79.75, y: 19, width: 0.5, depth: 12 }),
      /том же участке|границы/,
    );
  }));
test("boundary resize enforces same old owner even in rectangle mode and accepts the exact minimum for an empty archived-safe room", async () =>
  isolated(async (w) => {
    let s = await w.createSpace({
      ...req(),
      name: "Origin",
      kind: "room",
      x: 20,
      y: 20,
      width: 10,
      depth: 10,
    });
    const room = s.warehouse.spaces[0];
    await w.updateWarehousePlan({ ...req(), layoutMode: "rectangle" });
    await w.createLocation(floor("OWNED", 28, 22, { width: 1, depth: 1 }));
    const before = await w.snapshot();
    await assert.rejects(
      resize(w, room.id, { x: 30, y: 20, width: 10, depth: 10 }),
      /том же участке/,
    );
    assert.deepEqual(await w.snapshot(), before);
    await w.deleteLocation(before.locations[0].id, req());
    s = await resize(w, room.id, { x: 0, y: 0, width: 0.5, depth: 0.5 });
    assert.equal(s.warehouse.spaces[0].width, 0.5);
    assert.equal(s.locations[0].x, 28);
    await w.deleteSpace(room.id, req());
    await assert.rejects(
      resize(w, room.id, { x: 0, y: 0, width: 1, depth: 1 }),
      /архиве/,
    );
  }));
