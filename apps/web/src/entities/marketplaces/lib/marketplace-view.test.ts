import test from "node:test";
import assert from "node:assert/strict";
import {
  marketplaceDate,
  marketplaceNumber,
  providerName,
  syncLabel,
} from "./marketplace-view";
test("missing external figures and timestamps never pretend to be zero or success", () => {
  assert.equal(marketplaceNumber(null), "Нет данных");
  assert.equal(marketplaceNumber(Number.NaN), "Нет данных");
  assert.equal(marketplaceNumber(0), "0");
  assert.equal(marketplaceDate(null), "Ещё не было");
  assert.equal(marketplaceDate("broken"), "Ещё не было");
  assert.equal(syncLabel("never"), "Не проверено");
  assert.equal(syncLabel("partial"), "Неполные данные");
  assert.equal(providerName("ozon"), "Ozon");
});
