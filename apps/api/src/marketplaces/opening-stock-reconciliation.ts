import { BadRequestException, ConflictException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Queryable } from "../database";
import type { WorkspaceDto } from "../dto";
import {
  savePlanningStock,
  outgoingSupplyKeys,
  trackedFinishedUnits,
  type PlanningStockConfirmation,
} from "./planning-stock";
import { loadMarketplaces } from "./storage";

const quantity = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/**
 * Registering physical stock consumes its previous unlocated planning offset.
 * It does not make an approximate count exact or rewrite when/who counted it.
 */
export function openingStockConfirmation(
  previous: PlanningStockConfirmation,
  registeredUnits: number,
): PlanningStockConfirmation {
  if (
    !quantity(registeredUnits) ||
    !quantity(previous.trackedUnitsAtCount) ||
    (previous.units !== null && !quantity(previous.units))
  )
    throw new BadRequestException("Некорректное количество первичного остатка");
  const unlocated =
    previous.units === null
      ? null
      : Math.max(0, previous.units - previous.trackedUnitsAtCount);
  const trackedUnitsAtCount = previous.trackedUnitsAtCount + registeredUnits;
  const units =
    previous.units === null
      ? null
      : previous.units + Math.max(0, registeredUnits - unlocated!);
  if (!quantity(trackedUnitsAtCount) || (units !== null && !quantity(units)))
    throw new BadRequestException(
      "Слишком большое количество первичного остатка",
    );
  return {
    ...previous,
    outboundSupplyKeys: [...previous.outboundSupplyKeys],
    trackedUnitsAtCount,
    units,
    revision: previous.revision + 1,
  };
}

interface ReconciliationEvent {
  source?: string;
  openingStocktakeId?: string;
  skuId?: string;
  registeredUnits?: number;
  complete?: boolean;
}

/**
 * Runs inside the authorized opening-stock approval's existing SQL transaction
 * and warehouse lock. The caller owns auth, physical inventory and its replay.
 * This function changes only planning confirmations and their immutable audit.
 */
export async function reconcileOpeningStock(
  tx: Queryable,
  before: WorkspaceDto,
  after: WorkspaceDto,
  doc: { id: string; code: string },
  actor: { id: string; employee_id: string; name: string },
  completedSkuIds: string[] = [],
): Promise<void> {
  const previousIds = new Set(before.boxes.map((box) => box.id));
  const seen = new Set<string>();
  const registered = new Map<string, number>();
  for (const box of after.boxes) {
    if (
      previousIds.has(box.id) ||
      (box as typeof box & { openingStocktakeId?: string })
        .openingStocktakeId !== doc.id ||
      !["stored", "in_transit"].includes(box.status)
    )
      continue;
    if (
      seen.has(box.id) ||
      !quantity(box.units) ||
      box.units === 0 ||
      !after.skus.some((sku) => sku.id === box.skuId)
    )
      throw new BadRequestException("Некорректные короба первичного остатка");
    seen.add(box.id);
    const total = (registered.get(box.skuId) ?? 0) + box.units;
    if (!quantity(total))
      throw new BadRequestException(
        "Слишком большое количество первичного остатка",
      );
    registered.set(box.skuId, total);
  }
  const completed = new Set(completedSkuIds);
  if (
    completed.size !== completedSkuIds.length ||
    completedSkuIds.some((skuId) => !registered.has(skuId))
  )
    throw new BadRequestException(
      "Полное подтверждение допускается только для готового товара этого первичного остатка",
    );
  if (!registered.size) return;
  const marketplace = await loadMarketplaces(tx);
  const recordedAt = new Date().toISOString();
  for (const [skuId, registeredUnits] of registered) {
    const previous = marketplace.planningStock?.find(
      (entry) => entry.skuId === skuId,
    );
    const complete = completed.has(skuId);
    // Physical stock needs no artificial manual confirmation when none existed.
    if (!previous && !complete) continue;
    const eventId = `opening-stock:${doc.id}:${skuId}`;
    const existing = await tx.query<{ payload: ReconciliationEvent }>(
      "SELECT payload FROM planning_stock_confirmation_events WHERE id=$1",
      [eventId],
    );
    if (existing.rows.length) {
      const event = existing.rows[0].payload;
      if (
        event.source !== "opening_stocktake" ||
        event.openingStocktakeId !== doc.id ||
        event.skuId !== skuId ||
        event.registeredUnits !== registeredUnits ||
        event.complete !== complete
      )
        throw new ConflictException(
          "Первичный остаток уже согласован с планом с другим количеством",
        );
      continue;
    }
    const sku = after.skus.find((item) => item.id === skuId)!;
    const tracked = trackedFinishedUnits(after, skuId);
    if (!quantity(tracked))
      throw new BadRequestException("Некорректное количество готового товара");
    const current: PlanningStockConfirmation = complete
      ? {
          skuId,
          enabled: previous?.enabled ?? true,
          units: tracked,
          trackedUnitsAtCount: tracked,
          accuracy: "exact",
          unitsPerBoxAtCount: sku.unitsPerBox,
          countedAt: recordedAt,
          actorAccountId: actor.id,
          revision: (previous?.revision ?? 0) + 1,
          outboundSupplyKeys: outgoingSupplyKeys(marketplace, skuId),
          note: `Первичный остаток ${doc.code}: весь готовый товар подтверждён по адресам`,
        }
      : openingStockConfirmation(previous!, registeredUnits);
    await savePlanningStock(tx, current);
    await tx.query(
      "INSERT INTO planning_stock_confirmation_events(id,payload) VALUES($1,$2)",
      [
        eventId,
        JSON.stringify({
          requestId: eventId,
          revision: randomUUID(),
          countedAt: recordedAt,
          actorAccountId: actor.id,
          actorEmployeeId: actor.employee_id,
          actorName: actor.name,
          source: "opening_stocktake",
          openingStocktakeId: doc.id,
          openingStocktakeCode: doc.code,
          skuId,
          registeredUnits,
          complete,
          reason: complete
            ? `Первичный остаток ${doc.code}: подтверждён весь готовый товар, ${tracked} шт. по адресам`
            : `Первичный остаток ${doc.code}: ${registeredUnits} шт. зарегистрированы по адресам и исключены из повторного учёта в плане`,
          changes: [{ previous: previous ?? null, current }],
        }),
      ],
    );
  }
}
