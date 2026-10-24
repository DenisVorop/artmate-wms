import assert from "node:assert/strict";
import test from "node:test";
import {
  isArchivedStocktake,
  newestStocktake,
  stocktakePages,
  stocktakePreviewPresentation,
  stocktakeCancelDescription,
} from "./stocktake-view";
import type { StocktakePreviewDto } from "@/shared/api/generated/model";
test("review remains active; approved and cancelled histories remain in the archive", () => {
  assert.equal(isArchivedStocktake("review"), false);
  assert.equal(isArchivedStocktake("counting"), false);
  assert.equal(isArchivedStocktake("approved"), true);
  assert.equal(isArchivedStocktake("cancelled"), true);
  assert.equal(stocktakePages(0, 25), 1);
  assert.equal(stocktakePages(26, 25), 2);
});
test("a replay of an older command cannot roll the document back after a newer poll", () => {
  const response = { id: "doc", revision: 2, status: "counting" };
  const current = { id: "doc", revision: 3, status: "approved" };
  assert.equal(newestStocktake(response, current), current);
  assert.equal(newestStocktake(current, response), current);
  assert.equal(
    newestStocktake(response, { ...current, id: "other" }),
    response,
  );
});

test("unmeasured addresses never present inferred raw zero or box writeoffs as real discrepancies", () => {
  const preview: StocktakePreviewDto = {
    revision: 1,
    canApprove: false,
    unitsDelta: -94,
    staleLocationIds: [],
    issues: [
      {
        code: "NOT_COUNTED",
        message: "Ячейка ещё не пересчитана",
        locationIds: ["cell"],
        entityId: null,
      },
    ],
    changes: [
      {
        kind: "raw_count",
        entityId: "p",
        code: "RAW-01",
        fromLocationId: "cell",
        toLocationId: "cell",
        expectedQuantity: 74,
        countedQuantity: 0,
        unitsDelta: -74,
      },
      {
        kind: "box_writeoff",
        entityId: "box",
        code: "BOX-01",
        fromLocationId: "cell",
        toLocationId: null,
        expectedQuantity: 20,
        countedQuantity: 0,
        unitsDelta: -20,
      },
    ],
  };
  const fresh = stocktakePreviewPresentation(
    {
      status: "queued",
      rows: [{ count: null }, { count: null }, { count: null }],
    },
    preview,
  );
  assert.deepEqual(fresh.changes, []);
  assert.equal(fresh.unitsDelta, null);
  assert.equal(fresh.issues[0]?.code, "NOT_COUNTED");
  const partial = stocktakePreviewPresentation(
    {
      status: "counting",
      rows: [{ count: { rawPallets: [], boxCodes: [] } }, { count: null }],
    },
    preview,
  );
  assert.equal(partial.showChanges, false);
  assert.deepEqual(partial.changes, []);
  assert.equal(partial.unitsDelta, null);
  assert.deepEqual(partial.issues, preview.issues);
  const counted = stocktakePreviewPresentation(
    { status: "review", rows: [{ count: { rawPallets: [], boxCodes: [] } }] },
    preview,
  );
  assert.equal(counted.showChanges, true);
  assert.deepEqual(counted.changes, preview.changes);
  assert.equal(counted.unitsDelta, -94);
  const historical = stocktakePreviewPresentation(
    { status: "approved", rows: [{ count: null }] },
    preview,
  );
  assert.equal(historical.showChanges, true);
  assert.deepEqual(historical.changes, preview.changes);
  assert.equal(historical.unitsDelta, -94);
});

test("cancel distinguishes durable facts from unsaved local input in the affected cells", () => {
  assert.match(stocktakeCancelDescription(0), /Сохранённый подсчёт/);
  assert.doesNotMatch(stocktakeCancelDescription(0), /будет потерян/);
  assert.match(
    stocktakeCancelDescription(2),
    /Несохранённый локальный ввод будет потерян/,
  );
  assert.match(
    stocktakeCancelDescription(2),
    /Ячеек с несохранённым вводом: 2/,
  );
});
