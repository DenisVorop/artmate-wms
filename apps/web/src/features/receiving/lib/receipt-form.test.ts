import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPlacement,
  buildReceipt,
  moscowDateTimeInput,
  newSkuSchema,
  palletDefaults,
  placementSchema,
  receiptDateToIso,
  receiptDefaults,
  receiptPalletSchema,
  receiptSchema,
  unknownMass,
} from "./receipt-form";

const existingRow = () => ({ ...palletDefaults(true), skuId: "sku-kittens" });
const receipt = () => ({
  receivedAt: "2024-02-29T12:34",
  pallets: [existingRow()],
});

test("Фактическая дата Москвы явно переводится в ISO независимо от часового пояса браузера", () => {
  assert.equal(
    receiptDateToIso("2024-02-29T12:34"),
    "2024-02-29T09:34:00.000Z",
  );
  assert.equal(
    moscowDateTimeInput(new Date("2024-02-29T21:05:59Z")),
    "2024-03-01T00:05",
  );
  const defaults = receiptDefaults(true, new Date("2024-02-29T09:34:55Z"));
  assert.equal(defaults.receivedAt, "2024-02-29T12:34");
  assert.equal(buildReceipt(defaults).receivedAt, "2024-02-29T09:34:00.000Z");
});

test("Невозможные и будущие даты не нормализуются молча", () => {
  for (const date of [
    "2025-02-29T12:30",
    "2024-02-30T12:30",
    "2024-13-01T12:30",
    "2024-01-01T24:00",
    "",
    "not-a-date",
  ])
    assert.equal(receiptDateToIso(date), null);
  assert.equal(
    receiptSchema.safeParse({
      ...receipt(),
      receivedAt: moscowDateTimeInput(new Date(Date.now() + 6 * 60_000)),
    }).success,
    false,
  );
  assert.equal(receiptSchema.safeParse(receipt()).success, true);
});

test("Новая паллета: 1000 штук, 120×80×75 см, масса неизвестна, нет автоприхода на адрес", () => {
  const row = existingRow();
  assert.deepEqual(
    [row.quantity, row.widthCm, row.depthCm, row.heightCm, row.weightKg],
    [1000, 120, 80, 75, null],
  );
  const dto = buildReceipt(receipt());
  assert.deepEqual(dto.pallets, [
    {
      skuId: "sku-kittens",
      quantity: 1000,
      widthMm: 1200,
      depthMm: 800,
      heightMm: 750,
      weightKg: null,
    },
  ]);
  assert.equal("locationId" in dto, false);
  assert.equal("employeeId" in dto, false);
  assert.equal("newSku" in dto.pallets[0], false);
  assert.match(dto.requestId, /^[0-9a-f-]{36}$/);
});

test("Дробные сантиметры преобразуются в целые миллиметры, масса и оригинальное количество сохраняются", () => {
  const values = receiptSchema.parse({
    ...receipt(),
    pallets: [
      {
        ...existingRow(),
        widthCm: 120.1,
        depthCm: 80.8,
        heightCm: 140.9,
        weightKg: 350.25,
        quantity: 247,
      },
    ],
  });
  assert.deepEqual(buildReceipt(values).pallets[0], {
    skuId: "sku-kittens",
    quantity: 247,
    widthMm: 1201,
    depthMm: 808,
    heightMm: 1409,
    weightKg: 350.25,
  });
  for (const widthCm of [9.9, 1000.1, 120.05, Number.NaN])
    assert.equal(
      receiptPalletSchema.safeParse({ ...existingRow(), widthCm }).success,
      false,
    );
  assert.equal(
    receiptPalletSchema.safeParse({
      ...existingRow(),
      widthCm: 10,
      depthCm: 1000,
    }).success,
    true,
  );
});

test("Каждая строка даёт только existing SKU или newSku; скрытые незаполненные поля не блокируют existing", () => {
  assert.equal(receiptPalletSchema.safeParse(existingRow()).success, true);
  assert.equal(
    receiptPalletSchema.safeParse({ ...existingRow(), skuId: "" }).success,
    false,
  );
  const newRow = {
    ...palletDefaults(false),
    skuId: "ignored",
    newSku: {
      name: "  Котики-2  ",
      barcode: " 4601234567890 ",
      code: "  ",
      unitsPerBox: 20,
    },
  };
  const dto = buildReceipt(
    receiptSchema.parse({ ...receipt(), pallets: [existingRow(), newRow] }),
  );
  assert.equal("newSku" in dto.pallets[0], false);
  assert.equal("skuId" in dto.pallets[1], false);
  assert.deepEqual(dto.pallets[1].newSku, {
    name: "Котики-2",
    barcode: "4601234567890",
    unitsPerBox: 20,
  });
  assert.equal(
    receiptPalletSchema.safeParse(palletDefaults(false)).success,
    false,
  );
});

test("Повтор новой тематики остаётся двумя физическими паллетами с одинаковыми метаданными для серверного reuse SKU", () => {
  const row = {
    ...palletDefaults(false),
    newSku: {
      name: "Котики-2",
      barcode: "4601234567890",
      code: "CAT-2",
      unitsPerBox: 20,
    },
  };
  const dto = buildReceipt(
    receiptSchema.parse({
      ...receipt(),
      pallets: [row, { ...structuredClone(row), quantity: 450 }],
    }),
  );
  assert.equal(dto.pallets.length, 2);
  assert.deepEqual(
    dto.pallets.map((item) => item.quantity),
    [1000, 450],
  );
  assert.deepEqual(dto.pallets[0].newSku, dto.pallets[1].newSku);
  assert.equal("skuId" in dto.pallets[1], false);
});

test("В документе 1..100 паллет с целым количеством 1..100000, новые SKU требуют штрихкод и норму короба", () => {
  for (const quantity of [0, -1, 1.5, 100001, Number.NaN])
    assert.equal(
      receiptPalletSchema.safeParse({ ...existingRow(), quantity }).success,
      false,
    );
  for (const quantity of [1, 100000])
    assert.equal(
      receiptPalletSchema.safeParse({ ...existingRow(), quantity }).success,
      true,
    );
  assert.equal(
    receiptSchema.safeParse({ ...receipt(), pallets: [] }).success,
    false,
  );
  assert.equal(
    receiptSchema.safeParse({
      ...receipt(),
      pallets: Array.from({ length: 101 }, existingRow),
    }).success,
    false,
  );
  assert.equal(
    newSkuSchema.safeParse({
      name: "Котики",
      barcode: " ",
      code: "",
      unitsPerBox: 20,
    }).success,
    false,
  );
  assert.equal(
    newSkuSchema.safeParse({
      name: "Котики",
      barcode: "123",
      code: "",
      unitsPerBox: 0,
    }).success,
    false,
  );
});

test("Неизвестная масса переживает повторную регистрацию полей, ноль и нечисло не маскируются", () => {
  for (const blank of [null, undefined, "", "  "])
    assert.equal(unknownMass(unknownMass(blank)), null);
  assert.equal(unknownMass("350.5"), 350.5);
  for (const mass of [0, -1, Number.NaN])
    assert.equal(
      receiptPalletSchema.safeParse({ ...existingRow(), weightKg: mass })
        .success,
      false,
    );
});

test("Подтверждение требует оба скана и сотрудника; QR и читаемые коды передаются без автозамены", () => {
  for (const values of [
    { employeeId: "", palletCode: "PAL-1", locationCode: "LOC-1" },
    { employeeId: "employee", palletCode: " ", locationCode: "LOC-1" },
    { employeeId: "employee", palletCode: "PAL-1", locationCode: "" },
  ])
    assert.equal(placementSchema.safeParse(values).success, false);
  assert.deepEqual(
    placementSchema.parse({
      employeeId: "employee",
      palletCode: " artmate-wms:pallet:abc ",
      locationCode: " RACK-01 ",
    }),
    {
      employeeId: "employee",
      palletCode: "artmate-wms:pallet:abc",
      locationCode: "RACK-01",
    },
  );
});

test("Размещение использует сотрудника сессии, сохраняя введённые сканы; пустая сессия не создаёт команду", () => {
  const values = {
    employeeId: "other",
    palletCode: " PAL-1 ",
    locationCode: " LOC-1 ",
  };
  const dto = buildPlacement(values, "self");
  assert.equal(dto.employeeId, "self");
  assert.equal(dto.palletCode, "PAL-1");
  assert.equal(dto.locationCode, "LOC-1");
  assert.equal(values.employeeId, "other");
  assert.throws(() => buildPlacement(values, ""));
});
