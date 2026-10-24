import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ledgerFilterDefaults,
  ledgerFilterSchema,
  ledgerPageCount,
  ledgerQuery,
  ledgerResultRange,
} from "./ledger-filter";
test("Пустые фильтры не отправляют фиктивных kind/SKU/actor, пагинация остаётся серверной", () => {
  assert.deepEqual(ledgerQuery(ledgerFilterDefaults(), 3), {
    page: 3,
    pageSize: 25,
  });
  const values = ledgerFilterSchema.parse({
    ...ledgerFilterDefaults(),
    kind: "shipment",
    skuId: " sku ",
    employeeId: " actor ",
    search: "  BOX-001  ",
    pageSize: 50,
  });
  assert.deepEqual(ledgerQuery(values, 2), {
    page: 2,
    pageSize: 50,
    kind: "shipment",
    skuId: "sku",
    employeeId: "actor",
    search: "BOX-001",
  });
});
test("Даты фильтра включают полный день Москвы и явно переводятся в ISO, включая високосный день", () => {
  const values = ledgerFilterSchema.parse({
    ...ledgerFilterDefaults(),
    from: "2024-02-29",
    to: "2024-02-29",
  });
  assert.deepEqual(ledgerQuery(values, 1), {
    page: 1,
    pageSize: 25,
    from: "2024-02-28T21:00:00.000Z",
    to: "2024-02-29T20:59:59.999Z",
  });
  const fromOnly = ledgerQuery(
    { ...ledgerFilterDefaults(), from: "2025-01-01" },
    1,
  );
  assert.equal(fromOnly.from, "2024-12-31T21:00:00.000Z");
  assert.equal("to" in fromOnly, false);
});
test("Невозможная дата, обратный период и неизвестная операция не запускают запрос", () => {
  for (const from of [
    "2025-02-29",
    "2024-02-30",
    "2024-13-01",
    "2024-2-01",
    "2024-01-01T00:00",
  ])
    assert.equal(
      ledgerFilterSchema.safeParse({ ...ledgerFilterDefaults(), from }).success,
      false,
    );
  const reversed = ledgerFilterSchema.safeParse({
    ...ledgerFilterDefaults(),
    from: "2025-01-02",
    to: "2025-01-01",
  });
  assert.equal(reversed.success, false);
  if (!reversed.success)
    assert.deepEqual(reversed.error.issues[0].path, ["to"]);
  assert.equal(
    ledgerFilterSchema.safeParse({
      ...ledgerFilterDefaults(),
      kind: "fake_operation",
    }).success,
    false,
  );
});
test("Размер страницы ограничен доступными вариантами до100, поиск не превращает пробелы в запрос", () => {
  for (const pageSize of [25, 50, 100])
    assert.equal(
      ledgerFilterSchema.safeParse({ ...ledgerFilterDefaults(), pageSize })
        .success,
      true,
    );
  for (const pageSize of [0, 26, 101, Infinity])
    assert.equal(
      ledgerFilterSchema.safeParse({ ...ledgerFilterDefaults(), pageSize })
        .success,
      false,
    );
  assert.equal(
    "search" in ledgerQuery({ ...ledgerFilterDefaults(), search: "  " }, 1),
    false,
  );
});
test("Диапазон страницы не обещает строк в пустом результате или за его границей", () => {
  assert.equal(ledgerPageCount(0, 25), 1);
  assert.equal(ledgerPageCount(26, 25), 2);
  assert.equal(ledgerPageCount(100, 100), 1);
  assert.deepEqual(ledgerResultRange(1, 25, 0), { from: 0, to: 0 });
  assert.deepEqual(ledgerResultRange(1, 25, 26), { from: 1, to: 25 });
  assert.deepEqual(ledgerResultRange(2, 25, 26), { from: 26, to: 26 });
  assert.deepEqual(ledgerResultRange(3, 25, 50), { from: 0, to: 0 });
});
