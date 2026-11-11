import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WarehouseService } from "../src/warehouse.service";
import { StocktakeService } from "../src/stocktake.service";
import { requestAuth } from "../src/auth-context";
import type * as D from "../src/dto";
const req = () => ({ requestId: randomUUID() });
const as = <T>(role: string, fn: () => T) =>
  requestAuth.run(
    {
      http: true,
      tokenHash: `opening-${role}`,
      csrfToken: `csrf-${role}`,
      origin: "http://127.0.0.1:3080",
    },
    fn,
  );
test("initial stocktake records observed existing stock only on authorized atomic approval with real FIFO dates", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "wms-opening-stock-"));
  const old = process.env.WMS_DATA_DIR;
  process.env.WMS_DATA_DIR = join(dir, "db");
  let warehouse: WarehouseService | undefined;
  try {
    warehouse = new WarehouseService();
    let w = warehouse;
    await w.updateWarehousePlan({ ...req(), width: 200, depth: 200 });
    await w.authTransaction(async (tx) => {
      for (const [id, employeeId, role] of [
        ["manager", "employee-3", "manager"],
        ["one", "employee-1", "employee"],
        ["two", "employee-2", "employee"],
      ]) {
        await tx.query(
          "INSERT INTO auth_accounts(id,employee_id,login,password_hash,role,must_change_password) VALUES($1,$2,$1,'test-only',$3,FALSE)",
          [id, employeeId, role],
        );
        await tx.query(
          "INSERT INTO auth_sessions(id,account_id,token_hash,csrf_token,expires_at) VALUES($1,$1,$2,$3,NOW()+INTERVAL '1 hour')",
          [id, `opening-${id}`, `csrf-${id}`],
        );
      }
    });
    let service = new StocktakeService(w),
      position = 0;
    const location = async () => {
      const code = `OPEN-${position}`;
      const state = await w.createLocation({
        ...req(),
        code,
        name: code,
        kind: "floor",
        x: 40 + position++ * 3,
        y: 40,
        width: 2,
        depth: 2,
        levels: 1,
        maxHeightMm: 2500,
        maxBoxes: 36,
        availableWidthMm: 1200,
        availableDepthMm: 800,
        maxWeightKg: null,
        accessSides: 4,
      });
      return state.locations.find((entry) => entry.code === code)!;
    };
    const create = async (
      ids: string[],
      mode: "opening" | "recount" = "opening",
    ) =>
      as("manager", () =>
        service.createStocktake({ ...req(), mode, locationIds: ids }),
      );
    const claim = (doc: D.StocktakeDto) =>
      as("one", () =>
        service.claimStocktake(doc.id, {
          ...req(),
          expectedRevision: doc.revision,
        }),
      );
    const count = (
      doc: D.StocktakeDto,
      address: D.LocationDto,
      entry: D.OpeningPalletCountDto | null,
    ) =>
      as("one", () =>
        service.countStocktakeLocation(doc.id, address.id, {
          ...req(),
          expectedRevision: doc.revision,
          locationCode: address.code,
          rawPallets: [],
          boxCodes: [],
          openingPallet: entry,
        }),
      );
    const submit = (doc: D.StocktakeDto) =>
      as("one", () =>
        service.submitStocktake(doc.id, {
          ...req(),
          expectedRevision: doc.revision,
        }),
      );
    const cancel = (doc: D.StocktakeDto) =>
      as("manager", () =>
        service.cancelStocktake(doc.id, {
          ...req(),
          expectedRevision: doc.revision,
          reason: "Тестовая отмена документа",
        }),
      );
    const raw: D.OpeningPalletCountDto = {
      kind: "raw",
      skuId: "sku-cats",
      heightMm: 730,
      batches: [{ receivedAt: "2026-10-01T09:00:00Z", quantity: 1000 }],
    };
    const finished: D.OpeningPalletCountDto = {
      kind: "finished",
      skuId: "sku-cats",
      unitsPerBox: 20,
      batches: [
        { receivedAt: "2026-10-02T09:00:00Z", quantity: 2 },
        { receivedAt: "2026-10-20T09:00:00Z", quantity: 1 },
      ],
    };
    const audit = () =>
      w.authTransaction(async (tx) => ({
        ledger: (await tx.query("SELECT * FROM stock_ledger ORDER BY id")).rows,
        workforce: (await tx.query("SELECT * FROM work_events ORDER BY id"))
          .rows,
        histories: (
          await tx.query("SELECT * FROM stocktake_history ORDER BY id")
        ).rows,
        rows: (
          await tx.query(
            "SELECT * FROM stocktake_rows ORDER BY document_id,location_id",
          )
        ).rows,
        commands: (
          await tx.query("SELECT * FROM stocktake_commands ORDER BY request_id")
        ).rows,
        versions: (
          await tx.query(
            "SELECT * FROM stocktake_cell_versions ORDER BY location_id",
          )
        ).rows,
      }));
    await t.test(
      "opening documents require empty active addresses and cannot overlap another active opening document",
      async () => {
        const occupied = (await w.snapshot()).pallets.find(
          (p) => p.status === "stored" && p.locationId,
        )!;
        await assert.rejects(create([occupied.locationId!]), /уже есть|паллет/);
        const address = await location();
        const doc = await create([address.id]);
        assert.equal(doc.mode, "opening");
        await assert.rejects(create([address.id]), /незавершённый/);
        await cancel(doc);
        const fresh = await create([address.id]);
        await cancel(fresh);
      },
    );
    await t.test(
      "invalid or omitted observations reject before count history, including null versus missing and cross-mode data",
      async () => {
        const address = await location();
        let doc = await claim(await create([address.id]));
        const before = await audit();
        for (const entry of [
          { ...raw, heightMm: undefined },
          {
            ...raw,
            batches: [{ receivedAt: "2099-01-01T00:00:00Z", quantity: 1 }],
          },
          { ...finished, weightKg: null },
          { ...raw, injected: true },
        ])
          await assert.rejects(
            count(doc, address, entry as D.OpeningPalletCountDto),
          );
        await assert.rejects(
          as("one", () =>
            service.countStocktakeLocation(doc.id, address.id, {
              ...req(),
              expectedRevision: doc.revision,
              locationCode: address.code,
              rawPallets: [],
              boxCodes: [],
            }),
          ),
          /явно/,
        );
        await assert.rejects(
          as("one", () =>
            service.countStocktakeLocation(doc.id, address.id, {
              ...req(),
              expectedRevision: doc.revision,
              locationCode: address.code,
              rawPallets: [{ palletCode: "known", quantity: 1 }],
              boxCodes: [],
              openingPallet: null,
            }),
          ),
          /нельзя/,
        );
        assert.deepEqual(await audit(), before);
        doc = await count(doc, address, null);
        doc = await submit(doc);
        const empty = await as("manager", () =>
          service.approveStocktake(doc.id, {
            ...req(),
            expectedRevision: doc.revision,
            reason: "Пустое место подтверждено",
          }),
        );
        assert.deepEqual(empty.rows[0].openingResult, {
          palletId: null,
          boxIds: [],
        });
        const recount = await claim(await create([address.id], "recount"));
        await assert.rejects(
          count(recount, address, raw),
          /только в документе/,
        );
        await cancel(recount);
      },
    );
    await t.test(
      "count and GET are stock-free; approval creates dated lots/raw/finished with stable labels and no fictitious production",
      async () => {
        const rawAddress = await location(),
          finishedAddress = await location();
        const before = await w.snapshot();
        const beforeAudit = await audit();
        let doc = await claim(
          await create([rawAddress.id, finishedAddress.id]),
        );
        doc = await count(doc, rawAddress, raw);
        doc = await count(doc, finishedAddress, finished);
        assert.deepEqual(await w.snapshot(), before);
        assert.ok(doc.rows.every((row) => row.openingResult === undefined));
        const viewed = await as("manager", () => service.getStocktake(doc.id));
        assert.deepEqual(
          viewed.preview.changes.map((change) => change.entityId),
          doc.preview.changes.map((change) => change.entityId),
        );
        doc = await submit(doc);
        const approval = {
          ...req(),
          expectedRevision: doc.revision,
          reason: "Подтверждены фактические начальные остатки",
          openingCompleteSkuIds: ["sku-cats"],
        };
        await assert.rejects(
          as("one", () => service.approveStocktake(doc.id, approval)),
          /руководителя/,
        );
        const approved = await as("manager", () =>
          service.approveStocktake(doc.id, approval),
        );
        assert.equal(approved.status, "approved");
        const state = await w.snapshot();
        assert.equal(state.pallets.length, before.pallets.length + 2);
        assert.equal(state.boxes.length, before.boxes.length + 3);
        const additions = state.boxes.filter(
          (box) => box.openingStocktakeId === doc.id,
        );
        assert.ok(
          additions.every(
            (box) =>
              box.packedAt === null &&
              box.registeredAt &&
              box.status === "stored",
          ),
        );
        assert.deepEqual(
          additions
            .map(
              (box) =>
                state.lots.find((lot) => lot.id === box.lotContents[0].lotId)!
                  .receivedAt,
            )
            .sort(),
          [
            "2026-10-02T09:00:00.000Z",
            "2026-10-02T09:00:00.000Z",
            "2026-10-20T09:00:00.000Z",
          ],
        );
        assert.deepEqual(state.receipts, before.receipts);
        assert.deepEqual(state.tasks, before.tasks);
        assert.deepEqual(state.shipments, before.shipments);
        assert.deepEqual((await audit()).workforce, beforeAudit.workforce);
        assert.equal(
          (await audit()).ledger.length,
          beforeAudit.ledger.length + 1,
        );
        assert.equal(
          ((await audit()).ledger.at(-1) as { kind: string }).kind,
          "opening_balance",
        );
        assert.equal((await w.getStockLedger({})).summary.reconciled, true);
        const { boxIds } = approved.rows.find(
          (row) => row.locationId === finishedAddress.id,
        )!.openingResult!;
        assert.equal(boxIds.length, 3);
        for (const id of boxIds) {
          const box = additions.find((item) => item.id === id)!;
          const byId = await w.getLabel("box", id);
          const byCode = await w.getLabel("box", box.code);
          assert.notEqual(box.id, box.code);
          assert.equal(byCode.payload, `artmate-wms:box:${box.code}`);
          assert.deepEqual(byId, { ...byCode, boxId: id });
        }
        const persisted = await audit();
        assert.deepEqual(
          await as("manager", () => service.approveStocktake(doc.id, approval)),
          approved,
        );
        assert.deepEqual(await audit(), persisted);
        await w.onModuleDestroy();
        warehouse = undefined;
        warehouse = new WarehouseService();
        w = warehouse;
        service = new StocktakeService(w);
        assert.deepEqual(
          (await as("manager", () => service.getStocktake(doc.id))).rows.map(
            (row) => row.openingResult,
          ),
          approved.rows.map((row) => row.openingResult),
        );
        assert.deepEqual(await w.snapshot(), state);
        await assert.rejects(create([rawAddress.id]), /уже есть|паллет/);
      },
    );
    await t.test(
      "stale addresses and failed final approval never leak partially generated entities or ledger",
      async () => {
        const address = await location();
        let doc = await claim(await create([address.id]));
        doc = await count(doc, address, raw);
        doc = await submit(doc);
        const before = await w.snapshot(),
          oldAudit = await audit();
        const commit = w.commitOpeningStocktake.bind(w);
        w.commitOpeningStocktake = async (...args) => {
          await commit(...args);
          throw new Error("test final failure");
        };
        try {
          await assert.rejects(
            as("manager", () =>
              service.approveStocktake(doc.id, {
                ...req(),
                expectedRevision: doc.revision,
                reason: "Проверка атомарного утверждения",
              }),
            ),
            /test final failure/,
          );
        } finally {
          w.commitOpeningStocktake = commit;
        }
        assert.deepEqual(await w.snapshot(), before);
        assert.deepEqual(await audit(), oldAudit);
        await w.updateLocation(address.id, { ...req(), maxBoxes: 20 });
        await assert.rejects(
          as("manager", () =>
            service.approveStocktake(doc.id, {
              ...req(),
              expectedRevision: doc.revision,
              reason: "Устаревшая ячейка проверена",
            }),
          ),
          /изменился/,
        );
        doc = await as("manager", () =>
          service.refreshStocktakeLocation(doc.id, address.id, {
            ...req(),
            expectedRevision: doc.revision,
          }),
        );
        assert.equal(doc.rows[0].count, null);
        await cancel(doc);
      },
    );
    await t.test(
      "complete SKU declarations are restricted to approved finished stock, and revoked auth cannot replay",
      async () => {
        const address = await location();
        let doc = await claim(await create([address.id]));
        doc = await count(doc, address, raw);
        doc = await submit(doc);
        for (const openingCompleteSkuIds of [
          ["sku-cats"],
          ["missing"],
          ["sku-cats", "sku-cats"],
        ])
          await assert.rejects(
            as("manager", () =>
              service.approveStocktake(doc.id, {
                ...req(),
                expectedRevision: doc.revision,
                reason: "Проверка полного готового запаса",
                openingCompleteSkuIds,
              }),
            ),
            /готовых коробов/,
          );
        await assert.rejects(
          as("manager", () =>
            service.cancelStocktake(doc.id, {
              ...req(),
              expectedRevision: doc.revision,
              reason: "Проверка отмены документа",
              openingCompleteSkuIds: [],
            }),
          ),
          /только при утверждении/,
        );
        const cancelBody = {
          ...req(),
          expectedRevision: doc.revision,
          reason: "Документ отменён руководителем",
        };
        await as("manager", () => service.cancelStocktake(doc.id, cancelBody));
        await w.authTransaction((tx) =>
          tx.query("DELETE FROM auth_sessions WHERE account_id='manager'"),
        );
        await assert.rejects(
          as("manager", () => service.cancelStocktake(doc.id, cancelBody)),
          /Сессия/,
        );
      },
    );
  } finally {
    await warehouse?.onModuleDestroy();
    if (old === undefined) delete process.env.WMS_DATA_DIR;
    else process.env.WMS_DATA_DIR = old;
    await rm(dir, { recursive: true, force: true });
  }
});
