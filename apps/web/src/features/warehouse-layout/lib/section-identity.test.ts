import assert from "node:assert/strict";
import { test } from "node:test";
import { generateSectionIdentity } from "./section-identity";

test("Пустой план начинает с первой секции, а дыры заполняются раньше максимального номера", () => {
  assert.deepEqual(generateSectionIdentity([], []), {
    code: "R-01",
    name: "Секция 1",
  });
  assert.deepEqual(
    generateSectionIdentity(
      [
        { code: "R-03", name: "Секция 3" },
        { code: "R-01", name: "Секция 1" },
      ],
      [],
    ),
    { code: "R-02", name: "Секция 2" },
  );
});

test("Код, имя и будущий адрес независимо блокируют номер после trim/lower нормализации", () => {
  const sections = [
    { code: "  r-01 ", name: "Другой стеллаж" },
    { code: "CUSTOM", name: " сЕкЦиЯ 2  " },
  ];
  const locations = [{ code: "  r-03-20 " }];
  assert.deepEqual(generateSectionIdentity(sections, locations), {
    code: "R-04",
    name: "Секция 4",
  });
});

test("Все архивные записи сохраняют свои коды и имена, даже если активных секций нет", () => {
  const sections = [
    { code: "R-01", name: "Архивная", archived: true },
    { code: "CUSTOM", name: "Секция 3", archived: true },
  ];
  const locations = [{ code: "R-02-06", archived: true }];
  assert.deepEqual(generateSectionIdentity(sections, locations), {
    code: "R-04",
    name: "Секция 4",
  });
});

test("Любой из двадцати будущих ярусов занятого номера резервируется заранее", () => {
  for (let level = 1; level <= 20; level++) {
    const result = generateSectionIdentity(
      [],
      [{ code: `R-01-${String(level).padStart(2, "0")}` }],
    );
    assert.deepEqual(
      result,
      { code: "R-02", name: "Секция 2" },
      `Конфликт будущего яруса ${level}`,
    );
  }
  assert.deepEqual(generateSectionIdentity([], [{ code: "R-01-21" }]), {
    code: "R-01",
    name: "Секция 1",
  });
});

test("Коды секций и адресов не пересекаются даже в консервативных перекрёстных случаях", () => {
  assert.deepEqual(generateSectionIdentity([], [{ code: " R-01 " }]), {
    code: "R-02",
    name: "Секция 2",
  });
  assert.deepEqual(
    generateSectionIdentity(
      [{ code: " r-01-09 ", name: "Чужой код секции" }],
      [],
    ),
    { code: "R-02", name: "Секция 2" },
  );
});

test("Номер растёт после 99 и проверяет будущие адреса трёхзначных секций", () => {
  const sections = Array.from({ length: 99 }, (_, index) => ({
    code: `R-${String(index + 1).padStart(2, "0")}`,
    name: `Секция ${index + 1}`,
  }));
  assert.deepEqual(generateSectionIdentity(sections, []), {
    code: "R-100",
    name: "Секция 100",
  });
  assert.deepEqual(generateSectionIdentity(sections, [{ code: "r-100-20" }]), {
    code: "R-101",
    name: "Секция 101",
  });
});

test("Подсказка не изменяет входные записи, а следующий вызов учитывает только явно добавленную секцию", () => {
  const sections = [{ code: "CUSTOM", name: "Стеллаж у входа" }];
  const locations = [{ code: "FLOOR-01" }];
  const original = structuredClone({ sections, locations });
  const first = generateSectionIdentity(sections, locations);
  assert.deepEqual({ sections, locations }, original);
  assert.deepEqual(generateSectionIdentity(sections, locations), first);
  assert.deepEqual(generateSectionIdentity([...sections, first], locations), {
    code: "R-02",
    name: "Секция 2",
  });
});
