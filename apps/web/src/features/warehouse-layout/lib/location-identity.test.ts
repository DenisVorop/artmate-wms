import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LocationDtoKind,
  type LocationDto,
} from "@/shared/api/generated/model";
import { generateLocationIdentity } from "./location-identity";
import { locationDefaults } from "./location-form";

test("Общий ряд мест начинается с 1 и заполняет пропуски независимо от числа существующих записей", () => {
  assert.deepEqual(generateLocationIdentity([], []), {
    code: "P-01",
    name: "Место 1",
  });
  assert.deepEqual(
    generateLocationIdentity(
      [],
      [
        { code: "P-01", name: "Приёмка" },
        { code: "P-03", name: "Отбор" },
      ],
    ),
    { code: "P-02", name: "Место 2" },
  );
});

test("Код и имя мест, а также код и имя секций блокируют номер после trim/lower", () => {
  const sections = [
    { code: " p-01 ", name: "Стеллаж" },
    { code: "CUSTOM", name: " мЕсТо 4 " },
  ];
  const locations = [
    { code: "OTHER", name: " меСтО 2  " },
    { code: " P-03 ", name: "Сборка" },
  ];
  assert.deepEqual(generateLocationIdentity(sections, locations), {
    code: "P-05",
    name: "Место 5",
  });
});

test("Архивные записи разных типов сохраняют занятость идентичности в общем ряду", () => {
  const sections = [
    { code: "P-01", name: "Старый адрес секции", archived: true },
  ];
  const locations = [
    { code: "P-02", name: "Приёмка", kind: "receiving", archived: true },
    { code: "CUSTOM", name: "Место 3", kind: "floor", archived: true },
  ];
  assert.deepEqual(generateLocationIdentity(sections, locations), {
    code: "P-04",
    name: "Место 4",
  });
});

test("Проверяется точное совпадение: дочерний код или похожее название не занимают другой адрес", () => {
  assert.deepEqual(
    generateLocationIdentity(
      [{ code: "P-01-01", name: "Место 10" }],
      [{ code: "P-010", name: "Место 100" }],
    ),
    { code: "P-01", name: "Место 1" },
  );
});

test("После 99 номер продолжает расти и учитывает конфликты между типами объектов", () => {
  const locations = Array.from({ length: 99 }, (_, index) => ({
    code: `P-${String(index + 1).padStart(2, "0")}`,
    name: `Адрес ${index + 1}`,
  }));
  assert.deepEqual(generateLocationIdentity([], locations), {
    code: "P-100",
    name: "Место 100",
  });
  assert.deepEqual(
    generateLocationIdentity([{ code: "OTHER", name: "Место 100" }], locations),
    { code: "P-101", name: "Место 101" },
  );
});

test("Генерация не резервирует и не меняет вход: следующий свободный номер появляется после явного сохранения", () => {
  const sections = [{ code: "R-01", name: "Секция 1" }];
  const locations = [{ code: "FLOOR", name: "Старое место" }];
  const snapshot = structuredClone({ sections, locations });
  const first = generateLocationIdentity(sections, locations);
  assert.deepEqual(generateLocationIdentity(sections, locations), first);
  assert.deepEqual({ sections, locations }, snapshot);
  assert.deepEqual(generateLocationIdentity(sections, [...locations, first]), {
    code: "P-02",
    name: "Место 2",
  });
});

test("Новая форма получает suggestion и положение, прежние вызовы defaults остаются совместимыми", () => {
  assert.equal(locationDefaults().code, "");
  assert.equal(locationDefaults().name, "");
  const identity = generateLocationIdentity([], []);
  const values = locationDefaults(undefined, { x: 4.27, y: 3.81 }, identity);
  assert.equal(values.code, identity.code);
  assert.equal(values.name, identity.name);
  assert.equal(values.x, 4.27);
  assert.equal(values.y, 3.81);
  assert.equal(values.width, 1.3);
  assert.equal(values.depth, 0.9);
  assert.equal(values.maxHeightMm, 1800);
  assert.equal(values.maxBoxes, 18);
});

test("Редактирование existing места и яруса никогда не подменяет вручную заданные код/имя или геометрию", () => {
  const location: LocationDto = {
    ...locationDefaults(),
    id: "address",
    code: "MANUAL-A",
    name: "Полка у входа",
    kind: LocationDtoKind.rack,
    sectionId: "section",
    level: 2,
    levels: 1,
    archived: false,
    archivedAt: null,
    x: 1.37,
    y: 2.26,
    width: 4.8,
    depth: 0.83,
  };
  const result = locationDefaults(
    location,
    { x: 99, y: 99 },
    { code: "P-01", name: "Место 1" },
  );
  assert.equal(result.code, "MANUAL-A");
  assert.equal(result.name, "Полка у входа");
  assert.equal(result.x, 1.37);
  assert.equal(result.y, 2.26);
  assert.equal(result.width, 4.8);
  assert.equal(result.depth, 0.83);
});
