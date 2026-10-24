import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  LabelDto,
  LocationDto,
  RackSectionDto,
  WorkspaceDto,
  WorkZoneDto,
} from "@/shared/api/generated/model";
import {
  a4LabelItems,
  a4Sheets,
  readA4Labels,
  type A4LabelItem,
} from "./a4-labels";

function location(
  id: string,
  overrides: Partial<LocationDto> = {},
): LocationDto {
  return {
    id,
    code: id,
    name: `Адрес ${id}`,
    kind: "floor",
    sectionId: null,
    level: 1,
    levels: 1,
    x: 0,
    y: 0,
    width: 1.3,
    depth: 0.9,
    rotation: 0,
    archived: false,
    archivedAt: null,
    blocked: false,
    availableWidthMm: 1300,
    availableDepthMm: 900,
    maxHeightMm: 1800,
    maxBoxes: 18,
    maxWeightKg: null,
    accessSides: 1,
    ...overrides,
  };
}
function section(id: string, archived = false): RackSectionDto {
  return {
    id,
    code: id,
    name: id,
    archived,
    archivedAt: null,
    archivedLocationIds: [],
    rotation: 0,
    x: 0,
    y: 0,
    width: 3,
    depth: 1,
  };
}
function zone(id: string, overrides: Partial<WorkZoneDto> = {}): WorkZoneDto {
  return {
    id,
    code: id,
    name: `Зона ${id}`,
    kind: "assembly",
    locationIds: ["floor"],
    archived: false,
    archivedAt: null,
    ...overrides,
  };
}
function workspace(): WorkspaceDto {
  return {
    revision: 1,
    warehouse: {
      name: "Склад",
      width: 24,
      depth: 16,
      layoutMode: "rectangle",
      spaces: [],
      workZones: [],
      zoneWork: [],
    },
    balance: {
      rawUnits: 0,
      workInProgressUnits: 0,
      boxedUnits: 0,
      totalUnits: 0,
      awaitingPlacementUnits: 0,
      awaitingPlacementPallets: 0,
    },
    locations: [],
    sections: [],
    pallets: [],
    boxes: [],
    tasks: [],
    employees: [],
    receipts: [],
    putawayTasks: [],
    shipments: [],
    activities: [],
    lots: [],
    skus: [],
    movements: [],
    aisles: [],
    entrances: [],
  };
}
function item(id: string, type: A4LabelItem["type"] = "location"): A4LabelItem {
  return {
    id,
    type,
    key: `${type}:${id}`,
    code: `CODE-${id}`,
    title: `Название ${id}`,
    category: type === "location" ? "Место" : "Рабочая зона",
  };
}
function label(value: A4LabelItem): LabelDto {
  const payload = `artmate-wms:${value.type}:${value.id}`;
  return {
    payload,
    code: value.code,
    title: value.title,
    svg: `<svg xmlns="http://www.w3.org/2000/svg"><title>${payload}</title></svg>`,
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("active physical locations include each live rack level and blocked address, but exclude archives and orphan levels", () => {
  const data = workspace();
  data.sections = [section("active"), section("archived", true)];
  data.locations = [
    location("floor"),
    location("closed", { blocked: true }),
    location("L1", { sectionId: "active", level: 1, kind: "rack" }),
    location("L2", { sectionId: "active", level: 2, kind: "rack" }),
    location("old-level", {
      sectionId: "active",
      archived: true,
      kind: "rack",
    }),
    location("parent-archived", { sectionId: "archived", kind: "rack" }),
    location("orphan", { sectionId: "missing", kind: "rack" }),
    location("old-floor", { archived: true }),
  ];
  data.warehouse.workZones = [zone("live"), zone("old", { archived: true })];
  const original = structuredClone(data);
  const values = a4LabelItems(data);
  assert.deepEqual(
    values
      .filter((v) => v.type === "location")
      .map((v) => v.id)
      .sort(),
    ["L1", "L2", "closed", "floor"].sort(),
  );
  assert.deepEqual(
    values.filter((v) => v.type === "work-zone").map((v) => v.id),
    ["live"],
  );
  assert.equal(values.find((v) => v.id === "L2")?.category, "Место · ярус 2");
  assert.equal(
    values.some((v) => v.id === "active"),
    false,
    "a section is not a printable address identity",
  );
  assert.deepEqual(
    data,
    original,
    "selection building must not mutate warehouse data or order",
  );
});

test("zones on the same address remain separate, even when display codes and IDs collide across namespaces", () => {
  const data = workspace();
  data.locations = [location("same", { code: "SAME" })];
  data.warehouse.workZones = [
    zone("same", { code: "SAME" }),
    zone("second", { code: "SAME", kind: "putaway" }),
  ];
  const values = a4LabelItems(data);
  assert.equal(values.length, 3);
  assert.equal(new Set(values.map((v) => v.key)).size, 3);
  assert.ok(values.some((v) => v.key === "location:same"));
  assert.ok(values.some((v) => v.key === "work-zone:same"));
  assert.ok(values.some((v) => v.key === "work-zone:second"));
});

for (const [count, sizes] of [
  [0, []],
  [1, [1]],
  [4, [4]],
  [5, [4, 1]],
  [8, [4, 4]],
  [9, [4, 4, 1]],
] as const) {
  test(`pagination of ${count} labels produces exact sheets without duplicates or trailing blank sheet`, () => {
    const input = Array.from({ length: count }, (_, index) => ({ id: index }));
    const sheets = a4Sheets(input);
    assert.deepEqual(
      sheets.map((s) => s.length),
      sizes,
    );
    assert.deepEqual(sheets.flat(), input);
    assert.equal(input.length, count);
    if (sheets[0]?.length) {
      sheets[0].pop();
      assert.equal(
        input.length,
        count,
        "page slices must not alias the selection array",
      );
    }
  });
}

test("renaming codes or names preserves the actual QR identity, while zone and location payloads remain distinct", async () => {
  const controller = new AbortController();
  const before = item("permanent-id");
  const renamed = { ...before, code: "НОВЫЙ-КОД", title: "Новое название" };
  const otherNamespace = item("permanent-id", "work-zone");
  const first = await readA4Labels(
    [before],
    async () => label(before),
    controller.signal,
  );
  const next = await readA4Labels(
    [renamed, otherNamespace],
    async (type) => label(type === "location" ? renamed : otherNamespace),
    controller.signal,
  );
  assert.equal(first[0].label.payload, next[0].label.payload);
  assert.equal(first[0].label.svg, next[0].label.svg);
  assert.notEqual(next[0].label.payload, next[1].label.payload);
  assert.equal(next[0].label.code, "НОВЫЙ-КОД");
});

test("batch loading uses at most four readers and retains selection order despite out-of-order completion", async () => {
  const items = Array.from({ length: 9 }, (_, index) => item(String(index)));
  const gates = items.map(() => deferred());
  const calls: string[] = [];
  let active = 0,
    maximum = 0;
  const controller = new AbortController();
  const loading = readA4Labels(
    items,
    async (type, id, signal) => {
      assert.equal(type, "location");
      assert.equal(signal, controller.signal);
      calls.push(id);
      active++;
      maximum = Math.max(maximum, active);
      await gates[Number(id)].promise;
      active--;
      return label(items[Number(id)]);
    },
    controller.signal,
  );
  assert.deepEqual(calls, ["0", "1", "2", "3"]);
  gates[3].resolve();
  await tick();
  assert.deepEqual(calls, ["0", "1", "2", "3", "4"]);
  gates.forEach((gate) => gate.resolve());
  const result = await loading;
  assert.equal(maximum, 4);
  assert.equal(active, 0);
  assert.deepEqual(
    calls,
    items.map((value) => value.id),
  );
  assert.deepEqual(
    result.map((value) => value.key),
    items.map((value) => value.key),
  );
});

test("an already cancelled request never starts label reads", async () => {
  const controller = new AbortController();
  controller.abort();
  let reads = 0;
  await assert.rejects(
    readA4Labels(
      [item("1")],
      async () => {
        reads++;
        return label(item("1"));
      },
      controller.signal,
    ),
    (error) => error instanceof Error && error.name === "AbortError",
  );
  assert.equal(reads, 0);
});

test("cancellation after reads start rejects the whole batch even when a reader ignores its signal", async () => {
  const controller = new AbortController();
  const items = Array.from({ length: 9 }, (_, index) => item(String(index)));
  const gate = deferred();
  const calls: string[] = [];
  const loading = readA4Labels(
    items,
    async (_type, id) => {
      calls.push(id);
      await gate.promise;
      return label(items[Number(id)]);
    },
    controller.signal,
  );
  assert.equal(calls.length, 4);
  controller.abort();
  gate.resolve();
  await assert.rejects(
    loading,
    (error) => error instanceof Error && error.name === "AbortError",
  );
  await tick();
  assert.equal(
    calls.length,
    4,
    "no additional work may be scheduled after cancellation",
  );
});

for (const [name, mutate] of [
  [
    "wrong namespace",
    (dto: LabelDto) => ({ ...dto, payload: "artmate-wms:work-zone:1" }),
  ],
  [
    "wrong immutable ID",
    (dto: LabelDto) => ({ ...dto, payload: "artmate-wms:location:other" }),
  ],
  ["renamed code", (dto: LabelDto) => ({ ...dto, code: "CHANGED" })],
  [
    "renamed or archived title",
    (dto: LabelDto) => ({ ...dto, title: `Архив · ${dto.title}` }),
  ],
  ["missing SVG", (dto: LabelDto) => ({ ...dto, svg: "" })],
] as const) {
  test(`mismatch (${name}) rejects the complete batch instead of exposing partial print data`, async () => {
    const items = Array.from({ length: 6 }, (_, index) =>
      item(String(index + 1)),
    );
    let calls = 0;
    await assert.rejects(
      readA4Labels(
        items,
        async (_type, id) => {
          calls++;
          const value = label(items[Number(id) - 1]);
          return id === "1" ? mutate(value) : value;
        },
        new AbortController().signal,
      ),
      /Данные таблички изменились/,
    );
    await tick();
    assert.equal(
      calls,
      4,
      "a failed batch must stop scheduling remaining labels",
    );
  });
}

test("empty selection makes no requests and a failed network read never returns partial labels", async () => {
  let calls = 0;
  assert.deepEqual(
    await readA4Labels(
      [],
      async () => {
        calls++;
        throw new Error("unexpected");
      },
      new AbortController().signal,
    ),
    [],
  );
  assert.equal(calls, 0);
  await assert.rejects(
    readA4Labels(
      [item("1"), item("2")],
      async (_type, id) => {
        if (id === "2") throw new Error("Нет соединения");
        return label(item(id));
      },
      new AbortController().signal,
    ),
    /Нет соединения/,
  );
});
