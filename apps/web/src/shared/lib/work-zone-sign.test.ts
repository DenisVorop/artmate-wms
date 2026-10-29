import assert from "node:assert/strict";
import { test } from "node:test";
import { workZoneSign } from "./work-zone-sign";
test("zone signs print the purpose without repeating the custom zone name", () => {
  assert.equal(workZoneSign("Сборка · Сборка коробов"), "сборка");
  assert.equal(
    workZoneSign("Размещение · Размещение готовых коробов"),
    "размещение",
  );
  assert.equal(workZoneSign("Приёмка · У входа"), "приёмка");
  assert.equal(workZoneSign("Отгрузка · Основной склад"), "отгрузка");
});
test("renaming a zone does not change its purpose and archive marking remains explicit", () => {
  assert.equal(workZoneSign("Сборка · Столы Дениса"), "сборка");
  assert.equal(workZoneSign("Архив · Сборка · Старый стол"), "сборка (архив)");
});
