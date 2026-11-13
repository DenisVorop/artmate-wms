import { isBoxOnHand } from "./box-stock";
import { randomUUID } from "node:crypto";
import * as D from "./dto";
import { Queryable } from "./database";

export async function initializeStockLedger(tx: Queryable) {
  await tx.query(
    `CREATE TABLE IF NOT EXISTS stock_ledger (id TEXT PRIMARY KEY, revision BIGINT NOT NULL, request_id TEXT, kind TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL, payload JSONB NOT NULL)`,
  );
  await tx.query(
    `CREATE INDEX IF NOT EXISTS stock_ledger_created_idx ON stock_ledger(created_at DESC, revision DESC, id DESC)`,
  );
  await tx.query(
    `CREATE OR REPLACE FUNCTION reject_stock_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'stock_ledger is immutable'; END; $$`,
  );
  await tx.query(
    `DROP TRIGGER IF EXISTS stock_ledger_immutable ON stock_ledger`,
  );
  await tx.query(
    `CREATE TRIGGER stock_ledger_immutable BEFORE UPDATE OR DELETE ON stock_ledger FOR EACH ROW EXECUTE FUNCTION reject_stock_ledger_mutation()`,
  );
}
export function stockPositions(s: D.WorkspaceDto): D.StockLedgerLineDto[] {
  const positions: D.StockLedgerLineDto[] = [];
  const add = (
    skuId: string,
    lotId: string,
    quantity: number,
    stage: string,
    containerType: string,
    containerId: string,
    containerCode: string,
    palletId: string | null,
    locationId: string | null,
  ) => {
    if (!quantity) return;
    const sku = s.skus.find((x) => x.id === skuId),
      lot = s.lots.find((x) => x.id === lotId);
    if (!sku || !lot)
      throw new Error("Неизвестная тематика или партия в складском остатке");
    positions.push({
      skuId,
      skuCode: sku.code,
      skuName: sku.name,
      lotId,
      lotName: lot.name,
      receivedAt: lot.receivedAt,
      stage,
      containerType,
      containerId,
      containerCode,
      palletId,
      palletCode: s.pallets.find((x) => x.id === palletId)?.code ?? null,
      locationId,
      locationCode: s.locations.find((x) => x.id === locationId)?.code ?? null,
      quantityDelta: quantity,
    });
  };
  for (const p of s.pallets)
    if (
      p.kind === "raw" &&
      ["stored", "in_transit"].includes(p.status) &&
      p.quantity > 0
    ) {
      if (!p.skuId || !p.lotId)
        throw new Error("У сырьевой паллеты с остатком отсутствует партия");
      add(
        p.skuId,
        p.lotId,
        p.quantity,
        "raw",
        "pallet",
        p.id,
        p.code,
        p.id,
        p.locationId,
      );
    }
  for (const t of s.tasks)
    for (const part of t.openBoxContents)
      add(
        t.skuId,
        part.lotId,
        part.quantity,
        "wip",
        "task",
        t.id,
        t.code,
        null,
        null,
      );
  for (const b of s.boxes)
    if (isBoxOnHand(b.status))
      for (const part of b.lotContents)
        add(
          b.skuId,
          part.lotId,
          part.quantity,
          "boxed",
          "box",
          b.id,
          b.code,
          b.palletId,
          b.locationId,
        );
  const grouped = new Map<string, D.StockLedgerLineDto>();
  for (const p of positions) {
    const key = positionKey(p),
      previous = grouped.get(key);
    if (previous) previous.quantityDelta += p.quantityDelta;
    else grouped.set(key, p);
  }
  return [...grouped.values()];
}
const positionKey = (p: D.StockLedgerLineDto) =>
  JSON.stringify([
    p.stage,
    p.containerType,
    p.containerId,
    p.skuId,
    p.lotId,
    p.palletId,
    p.locationId,
  ]);
export function stockDifference(
  before: D.StockLedgerLineDto[],
  after: D.StockLedgerLineDto[],
) {
  const old = new Map(before.map((p) => [positionKey(p), p])),
    next = new Map(after.map((p) => [positionKey(p), p]));
  const lines: D.StockLedgerLineDto[] = [];
  for (const key of new Set([...old.keys(), ...next.keys()])) {
    const a = old.get(key),
      b = next.get(key),
      quantityDelta = (b?.quantityDelta ?? 0) - (a?.quantityDelta ?? 0);
    if (quantityDelta)
      lines.push({ ...(quantityDelta < 0 ? a : b)!, quantityDelta });
  }
  return lines.sort((a, b) => positionKey(a).localeCompare(positionKey(b)));
}
export function ledgerEvent(
  s: D.WorkspaceDto,
  lines: D.StockLedgerLineDto[],
  operation?: string,
  body?: D.CommandDto,
  actorOverride?: string,
): D.StockLedgerEventDto {
  const [op, id] = (operation ?? "").split("/");
  const actor =
    actorOverride ??
    (body && "employeeId" in body && typeof body.employeeId === "string"
      ? body.employeeId
      : null);
  let kind = "opening_balance",
    referenceType: string | null = null,
    reference: { id: string; code?: string } | undefined;
  if (op === "adjustStock") {
    kind = "adjustment";
    const b = body as D.AdjustStockDto;
    referenceType = b.kind === "raw_count" ? "pallet" : "box";
    reference = (b.kind === "raw_count" ? s.pallets : s.boxes).find(
      (x) => x.id === b.targetId,
    );
  } else if (op === "approveStocktake") {
    kind = "adjustment";
  } else if (op === "approveOpeningStocktake") {
    kind = "opening_balance";
  } else if (op === "placeReceiptPallet") {
    kind = "receipt_placement";
    referenceType = "receipt";
    reference = s.receipts.find((x) => x.id === id);
  } else if (["scanTask", "packTask"].includes(op)) {
    kind = "assembly";
    referenceType = "task";
    reference = s.tasks.find((x) => x.id === id);
  } else if (
    [
      "takePutawayTask",
      "takeAnyPutawayBox",
      "placePutawayTask",
      "takePutawayBox",
      "placePutawayBox",
    ].includes(op)
  ) {
    kind = "putaway";
    referenceType = "putaway_task";
    reference =
      op === "takeAnyPutawayBox"
        ? s.putawayTasks.find(
            (x) =>
              x.status === "in_transit" &&
              x.employeeId === (body as D.TakePutawayBoxDto).employeeId,
          )
        : s.putawayTasks.find((x) => x.id === id);
  } else if (["takeMovement", "placeMovement"].includes(op)) {
    kind = "movement";
    referenceType = "movement";
    reference = s.movements.find((x) => x.id === id);
  } else if (
    ["scanShipmentWork", "shipShipment", "finishShipmentWork"].includes(op)
  ) {
    kind = op === "scanShipmentWork" ? "shipment_pick" : "shipment";
    referenceType = "shipment";
    reference = s.shipments.find((x) => x.id === id);
  } else if (operation)
    throw new Error(
      `Операция ${op} изменила остаток без вида складского события`,
    );
  return {
    id: randomUUID(),
    revision: s.revision,
    requestId: body?.requestId ?? null,
    kind,
    createdAt: new Date().toISOString(),
    employeeId: actor,
    employeeName: s.employees.find((x) => x.id === actor)?.name ?? null,
    reason:
      op === "adjustStock"
        ? (body as D.AdjustStockDto).reason.trim()
        : !operation
          ? "Остатки на момент подключения журнала"
          : null,
    referenceType,
    referenceId: reference?.id ?? null,
    referenceCode: reference?.code ?? null,
    unitsDelta: lines.reduce((sum, l) => sum + l.quantityDelta, 0),
    lines,
  };
}
export async function appendStockEvent(
  tx: Queryable,
  event: D.StockLedgerEventDto,
) {
  await tx.query(
    "INSERT INTO stock_ledger(id,revision,request_id,kind,created_at,payload) VALUES ($1,$2,$3,$4,$5,$6)",
    [
      event.id,
      event.revision,
      event.requestId,
      event.kind,
      event.createdAt,
      JSON.stringify(event),
    ],
  );
}

export async function reconcileStockPositions(
  tx: Queryable,
  positions: D.StockLedgerLineDto[],
): Promise<boolean> {
  const rows = await tx.query<{
    identity: (string | null)[];
    quantity: string;
  }>(
    `SELECT jsonb_build_array(l->>'stage',l->>'containerType',l->>'containerId',l->>'skuId',l->>'lotId',l->>'palletId',l->>'locationId') AS identity, SUM((l->>'quantityDelta')::bigint) AS quantity FROM stock_ledger CROSS JOIN LATERAL jsonb_array_elements(payload->'lines') l GROUP BY identity HAVING SUM((l->>'quantityDelta')::bigint)<>0`,
  );
  const actual = new Map(
    positions.map((p) => [positionKey(p), p.quantityDelta]),
  );
  if (actual.size !== rows.rows.length) return false;
  return rows.rows.every(
    (row) => actual.get(JSON.stringify(row.identity)) === Number(row.quantity),
  );
}
