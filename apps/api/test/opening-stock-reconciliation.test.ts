import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Queryable } from "../src/database";
import type { BoxDto, WorkspaceDto } from "../src/dto";
import {
  openingStockConfirmation,
  reconcileOpeningStock,
} from "../src/marketplaces/opening-stock-reconciliation";
import {
  savePlanningStock,
  trackedFinishedUnits,
  type PlanningStockConfirmation,
} from "../src/marketplaces/planning-stock";
import {
  initializeMarketplaceStorage,
  loadMarketplaces,
  put,
} from "../src/marketplaces/storage";

const actor = {
  id: "opening-manager",
  employee_id: "manager-employee",
  name: "Руководитель",
};
function confirmation(
  skuId: string,
  units: number | null = 1000,
): PlanningStockConfirmation {
  return {
    skuId,
    units,
    trackedUnitsAtCount: 0,
    accuracy: "exact",
    enabled: true,
    note: "Предыдущий пересчёт",
    countedAt: "2026-10-01T10:00:00.000Z",
    actorAccountId: "original-counter",
    unitsPerBoxAtCount: 20,
    outboundSupplyKeys: ["old-supply"],
    revision: 1,
  };
}
function box(id: string, skuId: string, units: number, docId?: string): BoxDto {
  return {
    id,
    skuId,
    units,
    status: "stored",
    openingStocktakeId: docId,
    packedAt: null,
    registeredAt: "2026-10-27T10:00:00.000Z",
  } as unknown as BoxDto;
}
function workspace(boxes: BoxDto[], skuIds: string[]): WorkspaceDto {
  return {
    boxes,
    skus: skuIds.map((id) => ({
      id,
      name: id,
      unitsPerBox: id === "markers" ? 8 : 20,
    })),
    pallets: [{ id: "raw", kind: "raw", quantity: 1000 }],
  } as unknown as WorkspaceDto;
}

test("partial registration consumes the planning offset once, preserving original count provenance and uncertainty", () => {
  const previous = confirmation("cats");
  for (const [registered, units, tracked] of [
    [200, 1000, 200],
    [1000, 1000, 1000],
    [1200, 1200, 1200],
  ]) {
    const result = openingStockConfirmation(previous, registered);
    assert.equal(result.units, units);
    assert.equal(result.trackedUnitsAtCount, tracked);
    assert.equal(
      Math.max(0, result.units! - result.trackedUnitsAtCount) + registered,
      Math.max(previous.units!, registered),
    );
    assert.deepEqual(
      {
        ...result,
        units: previous.units,
        trackedUnitsAtCount: previous.trackedUnitsAtCount,
        revision: previous.revision,
      },
      previous,
    );
  }
  const first = openingStockConfirmation(previous, 200);
  const second = openingStockConfirmation(first, 300);
  assert.equal(second.units, 1000);
  assert.equal(second.trackedUnitsAtCount, 500);
  assert.equal(second.revision, 3);
  const approximate = {
    ...confirmation("markers", 300),
    accuracy: "approximate" as const,
    enabled: false,
  };
  const registered = openingStockConfirmation(approximate, 80);
  assert.equal(registered.units, 300);
  assert.equal(registered.trackedUnitsAtCount, 80);
  assert.equal(registered.accuracy, "approximate");
  assert.equal(registered.enabled, false);
  assert.equal(registered.countedAt, approximate.countedAt);
  assert.equal(registered.actorAccountId, approximate.actorAccountId);
  assert.deepEqual(previous, confirmation("cats"));
});

test("zero and unknown counts stay honest and invalid quantities are rejected", () => {
  const zero = openingStockConfirmation(confirmation("cats", 0), 400);
  assert.equal(zero.units, 400);
  assert.equal(zero.trackedUnitsAtCount, 400);
  const unknown = openingStockConfirmation(
    { ...confirmation("cats", null), trackedUnitsAtCount: 10 },
    80,
  );
  assert.equal(unknown.units, null);
  assert.equal(unknown.trackedUnitsAtCount, 90);
  for (const units of [-1, NaN, Infinity, 1.5])
    assert.throws(() => openingStockConfirmation(confirmation("cats"), units));
  assert.throws(() =>
    openingStockConfirmation(
      { ...confirmation("cats"), trackedUnitsAtCount: Number.MAX_SAFE_INTEGER },
      1,
    ),
  );
});

test("opening reconciliation is atomic, immutable, document-scoped and isolates unrelated marketplace configuration", async (t) => {
  const db = new PGlite("memory://");
  const sql = db as unknown as Queryable;
  const transaction = <T>(fn: (tx: Queryable) => Promise<T>) =>
    db.transaction((tx) => fn(tx as unknown as Queryable));
  try {
    await initializeMarketplaceStorage(sql);
    await put(sql, "marketplace_connections", "ozon", {
      provider: "ozon",
      enabled: true,
      encrypted: "test-encrypted-key-unchanged",
      version: 7,
    });
    await put(sql, "marketplace_settings", "settings", {
      historyDays: 89,
      horizonDays: 56,
    });
    await put(sql, "marketplace_mappings", "markers-card", {
      provider: "ozon",
      externalId: "markers-card",
      skuId: "markers",
      unitsPerItem: 1,
    });
    await put(sql, "marketplace_snapshots", "ozon", {
      provider: "ozon",
      supplies: [
        {
          id: "current-supply",
          calculation: "included",
          statusCode: "IN_TRANSIT",
          items: [{ externalId: "markers-card", plannedUnits: 80 }],
        },
      ],
    });
    const beforeConfiguration = await loadMarketplaces(sql);
    const initial = confirmation("cats");
    await savePlanningStock(sql, initial);
    const before = workspace([], ["cats"]);
    const after = workspace(
      [box("registered", "cats", 200, "doc-1")],
      ["cats"],
    );
    const doc = { id: "doc-1", code: "OPEN-001" };
    const entry = async (skuId: string) =>
      (await loadMarketplaces(sql)).planningStock!.find(
        (item) => item.skuId === skuId,
      );
    const events = async () =>
      (
        await sql.query<{ id: string; payload: any }>(
          "SELECT id,payload FROM planning_stock_confirmation_events ORDER BY id",
        )
      ).rows;

    await t.test(
      "failed approval rolls back confirmation and event together; retry/replay cannot consume twice",
      async () => {
        await assert.rejects(
          transaction(async (tx) => {
            await reconcileOpeningStock(tx, before, after, doc, actor);
            throw new Error("approval-failed-after-reconciliation");
          }),
          /approval-failed/,
        );
        assert.deepEqual(await entry("cats"), initial);
        assert.equal((await events()).length, 0);
        await transaction((tx) =>
          reconcileOpeningStock(tx, before, after, doc, actor),
        );
        const first = await entry("cats");
        assert.equal(first!.trackedUnitsAtCount, 200);
        assert.equal(first!.units, 1000);
        assert.equal(first!.actorAccountId, "original-counter");
        assert.equal(first!.countedAt, initial.countedAt);
        assert.equal(
          trackedFinishedUnits(after, "cats") +
            first!.units! -
            first!.trackedUnitsAtCount,
          1000,
        );
        await transaction((tx) =>
          reconcileOpeningStock(tx, before, after, doc, actor),
        );
        assert.deepEqual(await entry("cats"), first);
        assert.equal((await events()).length, 1);
        const event = (await events())[0];
        assert.equal(event.id, "opening-stock:doc-1:cats");
        assert.equal(event.payload.actorAccountId, actor.id);
        assert.equal(event.payload.actorEmployeeId, actor.employee_id);
        assert.equal(event.payload.source, "opening_stocktake");
        assert.equal(event.payload.openingStocktakeId, doc.id);
        assert.equal(event.payload.complete, false);
        assert.deepEqual(event.payload.changes[0].previous, initial);
        await assert.rejects(
          sql.query(
            "UPDATE planning_stock_confirmation_events SET payload='{}'::jsonb WHERE id=$1",
            [event.id],
          ),
          /immutable/,
        );
        await assert.rejects(
          transaction((tx) =>
            reconcileOpeningStock(tx, before, after, doc, actor, ["cats"]),
          ),
          /другим количеством/,
        );
        assert.deepEqual(await entry("cats"), first);
      },
    );

    await t.test(
      "subsequent documents count only newly registered boxes of their own origin",
      async () => {
        const secondAfter = workspace(
          [
            ...after.boxes,
            box("second", "cats", 300, "doc-2"),
            box("unrelated-document", "cats", 400, "other-document"),
            box("ordinary-assembled", "cats", 20),
          ],
          ["cats"],
        );
        const snapshots = JSON.stringify([after, secondAfter]);
        await transaction((tx) =>
          reconcileOpeningStock(
            tx,
            after,
            secondAfter,
            { id: "doc-2", code: "OPEN-002" },
            actor,
          ),
        );
        const current = (await entry("cats"))!;
        assert.equal(current.units, 1000);
        assert.equal(current.trackedUnitsAtCount, 500);
        assert.equal(current.revision, 3);
        assert.equal((await events()).length, 2);
        assert.equal(JSON.stringify([after, secondAfter]), snapshots);
      },
    );

    await t.test(
      "partial approximate markers remain approximate; explicit full confirmation replaces 300 with actual 280",
      async () => {
        await savePlanningStock(sql, {
          ...confirmation("markers", 300),
          accuracy: "approximate",
          unitsPerBoxAtCount: 4,
        });
        const markerBefore = workspace([], ["markers"]);
        const partial = workspace(
          [box("markers-80", "markers", 80, "markers-partial")],
          ["markers"],
        );
        await transaction((tx) =>
          reconcileOpeningStock(
            tx,
            markerBefore,
            partial,
            { id: "markers-partial", code: "OPEN-M1" },
            actor,
          ),
        );
        const approximate = (await entry("markers"))!;
        assert.equal(approximate.units, 300);
        assert.equal(approximate.trackedUnitsAtCount, 80);
        assert.equal(approximate.accuracy, "approximate");
        assert.equal(approximate.unitsPerBoxAtCount, 4);
        assert.equal(approximate.countedAt, initial.countedAt);
        const complete = workspace(
          [
            ...partial.boxes,
            box("markers-200", "markers", 200, "markers-complete"),
          ],
          ["markers"],
        );
        await transaction((tx) =>
          reconcileOpeningStock(
            tx,
            partial,
            complete,
            { id: "markers-complete", code: "OPEN-M2" },
            actor,
            ["markers"],
          ),
        );
        const exact = (await entry("markers"))!;
        assert.equal(exact.units, 280);
        assert.equal(exact.trackedUnitsAtCount, 280);
        assert.equal(exact.accuracy, "exact");
        assert.equal(exact.unitsPerBoxAtCount, 8);
        assert.equal(exact.actorAccountId, actor.id);
        assert.notEqual(exact.countedAt, initial.countedAt);
        assert.match(exact.note, /весь готовый товар/);
        assert.equal(exact.outboundSupplyKeys.length, 1);
        assert.match(exact.outboundSupplyKeys[0], /^ozon:current-supply:/);
      },
    );

    await t.test(
      "full declaration creates an exact confirmation if absent and preserves an existing disabled policy",
      async () => {
        const noneBefore = workspace(
          [box("existing-no-count", "new", 20)],
          ["new"],
        );
        const newAfter = workspace(
          [...noneBefore.boxes, box("new-80", "new", 80, "new-doc")],
          ["new"],
        );
        await transaction((tx) =>
          reconcileOpeningStock(
            tx,
            noneBefore,
            newAfter,
            { id: "new-doc", code: "OPEN-N" },
            actor,
            ["new"],
          ),
        );
        const exact = (await entry("new"))!;
        assert.equal(exact.units, 100);
        assert.equal(exact.trackedUnitsAtCount, 100);
        assert.equal(exact.enabled, true);
        assert.equal(exact.accuracy, "exact");
        const disabled = {
          ...confirmation("disabled", 300),
          enabled: false,
          accuracy: "approximate" as const,
        };
        await savePlanningStock(sql, disabled);
        await transaction((tx) =>
          reconcileOpeningStock(
            tx,
            workspace([], ["disabled"]),
            workspace(
              [box("disabled-40", "disabled", 40, "disabled-doc")],
              ["disabled"],
            ),
            { id: "disabled-doc", code: "OPEN-D" },
            actor,
            ["disabled"],
          ),
        );
        assert.equal((await entry("disabled"))!.enabled, false);
        assert.equal((await entry("disabled"))!.units, 40);
      },
    );

    await t.test(
      "foreign/duplicate complete declarations fail; raw-only and unrelated boxes do not alter planning",
      async () => {
        const original = await events();
        const previous = await entry("cats");
        for (const completed of [["other"], ["cats", "cats"]])
          await assert.rejects(
            transaction((tx) =>
              reconcileOpeningStock(tx, before, after, doc, actor, completed),
            ),
            /готового товара/,
          );
        await transaction((tx) =>
          reconcileOpeningStock(
            tx,
            before,
            workspace(
              [box("foreign-origin", "cats", 100, "foreign")],
              ["cats"],
            ),
            { id: "raw-only", code: "OPEN-R" },
            actor,
          ),
        );
        assert.deepEqual(await entry("cats"), previous);
        assert.deepEqual(await events(), original);
        const now = await loadMarketplaces(sql);
        for (const field of [
          "connections",
          "snapshots",
          "mappings",
          "settings",
          "transit",
          "resolutions",
        ] as const)
          assert.deepEqual(now[field], beforeConfiguration[field]);
      },
    );
  } finally {
    await db.close();
  }
});
