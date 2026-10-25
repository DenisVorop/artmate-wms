import { createHash } from "node:crypto";
import * as W from "../dto";
import { MarketplaceState } from "./storage";
import { MarketplacePlanDto, MarketplaceInboundSourceDto } from "./dto";
const day = 86400000;
export function marketplacePlan(
  w: W.WorkspaceDto,
  m: MarketplaceState,
  clock = new Date(),
): MarketplacePlanDto {
  const generatedAt = clock.toISOString(),
    global: string[] = [];
  const enabled = m.connections.filter((c) => c.enabled);
  if (!enabled.length)
    global.push("Подключите и обновите хотя бы один маркетплейс");
  const snapshots = enabled.flatMap((c) => {
    const snapshot = m.snapshots.find((s) => s.provider === c.provider);
    if (!snapshot) {
      global.push(`${c.provider}: нет полной загрузки`);
      return [];
    }
    if (c.syncStatus !== "success")
      global.push(`${c.provider}: последняя загрузка не завершена успешно`);
    if (
      !Number.isFinite(Date.parse(snapshot.asOf)) ||
      clock.getTime() - Date.parse(snapshot.asOf) > day
    )
      global.push(`${c.provider}: данные старше 24 часов`);
    if (
      !snapshot.coverage.catalog ||
      !snapshot.coverage.stocks ||
      !snapshot.coverage.demand
    )
      global.push(`${c.provider}: неполные данные`);
    const missing = snapshot.products.filter(
      (p) =>
        !m.mappings.some(
          (x) => x.provider === c.provider && x.externalId === p.externalId,
        ),
    );
    if (missing.length)
      global.push(`${c.provider}: сопоставьте ${missing.length} карточек`);
    return [snapshot];
  });
  const today = new Date(clock.getTime() + 3 * 3600000)
    .toISOString()
    .slice(0, 10);
  const to = new Date(Date.parse(today) - day).toISOString().slice(0, 10);
  const from = new Date(Date.parse(to) - day * (m.settings.historyDays - 1))
    .toISOString()
    .slice(0, 10);
  const assigned = new Set(
    w.shipments.filter((s) => s.status === "draft").flatMap((s) => s.boxIds),
  );
  const rows = w.skus.map((sku) => {
    const blockers = [...global],
      warnings: string[] = [];
    let ordered = 0,
      marketplaceUnits = 0;
    const mappings = m.mappings.filter(
      (x) =>
        x.skuId === sku.id && enabled.some((c) => c.provider === x.provider),
    );
    if (!mappings.length)
      blockers.push("Тематика не сопоставлена с карточками маркетплейсов");
    for (const snapshot of snapshots) {
      const related = mappings.filter((x) => x.provider === snapshot.provider);
      if (!related.length) continue;
      if (snapshot.from > from || snapshot.to < to)
        blockers.push(`${snapshot.provider}: недостаточно дней истории`);
      warnings.push(
        ...snapshot.warnings.map((v) => `${snapshot.provider}: ${v}`),
      );
      for (const mapping of related) {
        const stocks = snapshot.stocks.filter(
          (x) => x.externalId === mapping.externalId,
        );
        if (!stocks.length || stocks.some((x) => x.availableUnits === null))
          blockers.push(
            `${snapshot.provider}: неизвестен остаток карточки ${mapping.externalId}`,
          );
        marketplaceUnits += stocks.reduce(
          (s, x) => s + (x.availableUnits ?? 0) * mapping.unitsPerItem,
          0,
        );
        const demand = snapshot.demand.filter(
          (x) =>
            x.externalId === mapping.externalId &&
            x.date >= from &&
            x.date <= to,
        );
        ordered += demand.reduce(
          (s, x) =>
            s +
            Math.max(0, x.orderedUnits - x.cancelledUnits) *
              mapping.unitsPerItem,
          0,
        );
        if (stocks.some((x) => x.availableUnits === 0))
          warnings.push(
            "Нулевой остаток мог ограничить продажи; прогноз может быть занижен",
          );
      }
    }
    const averageDailyUnits = ordered / m.settings.historyDays;
    const targetUnits = Math.ceil(
      averageDailyUnits *
        (m.settings.horizonDays + m.settings.safetyDays + m.settings.leadDays),
    );
    const inboundSources: MarketplaceInboundSourceDto[] =
      snapshots.flatMap<MarketplaceInboundSourceDto>((snapshot) => {
        const related = mappings.filter(
          (mapping) => mapping.provider === snapshot.provider,
        );
        if (!related.length) return [];
        if (snapshot.inbound !== undefined) {
          const entries = related.map((mapping) => ({
            mapping,
            value: snapshot.inbound!.find(
              (entry) => entry.externalId === mapping.externalId,
            ),
          }));
          const known = entries.every((entry) => entry.value?.units != null);
          const sourceWarnings = [
            ...new Set(
              entries.flatMap(
                (entry) =>
                  entry.value?.warnings ?? [
                    "Нет подтверждённого количества поставок для карточки",
                  ],
              ),
            ),
          ];
          const supplyIds = new Set(
            entries.flatMap((entry) => entry.value?.supplyIds ?? []),
          );
          return [
            {
              provider: snapshot.provider,
              units: known
                ? entries.reduce(
                    (sum, entry) =>
                      sum + entry.value!.units! * entry.mapping.unitsPerItem,
                    0,
                  )
                : null,
              source:
                snapshot.provider === "wildberries"
                  ? ("wb_supplies" as const)
                  : ("ozon_analytics" as const),
              asOf: snapshot.asOf,
              supplyCount: supplyIds.size,
              warnings: sourceWarnings,
            },
          ];
        }
        // Snapshots saved before supply import retain their original coverage semantics.
        const entries = related.flatMap((mapping) =>
          snapshot.stocks
            .filter((stock) => stock.externalId === mapping.externalId)
            .map((stock) => ({ mapping, stock })),
        );
        const known =
          entries.length > 0 &&
          snapshot.coverage.inbound &&
          related.every((mapping) =>
            entries.some(
              (entry) => entry.mapping.externalId === mapping.externalId,
            ),
          ) &&
          entries.every((entry) => entry.stock.inboundUnits !== null);
        return [
          {
            provider: snapshot.provider,
            units: known
              ? entries.reduce(
                  (sum, entry) =>
                    sum +
                    entry.stock.inboundUnits! * entry.mapping.unitsPerItem,
                  0,
                )
              : null,
            source: known ? ("legacy" as const) : ("unknown" as const),
            asOf: snapshot.asOf,
            supplyCount: 0,
            warnings: known
              ? []
              : ["Обновите данные площадки для загрузки поставок"],
          },
        ];
      });
    const loadedInbound =
      inboundSources.length &&
      inboundSources.every((source) => source.units !== null)
        ? inboundSources.reduce((sum, source) => sum + source.units!, 0)
        : null;
    const inTransitUnits = m.transit[sku.id] ?? loadedInbound;
    const inboundSource =
      m.transit[sku.id] !== undefined
        ? ("manual" as const)
        : loadedInbound !== null
          ? ("api" as const)
          : ("unknown" as const);
    warnings.push(
      ...inboundSources.flatMap((source) =>
        source.warnings.map((warning) => `${source.provider}: ${warning}`),
      ),
    );
    warnings.push(
      m.transit[sku.id] !== undefined
        ? "Товар в пути подтверждён вручную суммарно по маркетплейсам; актуальность проверяет руководитель"
        : loadedInbound !== null
          ? "Товар в пути получен из API"
          : "API не сообщает весь товар в пути",
    );
    if (inTransitUnits === null)
      blockers.push(
        "Подтвердите количество товара в пути на маркетплейсы, в том числе ноль",
      );
    const dataComplete = blockers.length === 0;
    const boxes = w.boxes.filter(
      (b) => b.skuId === sku.id && ["stored", "in_transit"].includes(b.status),
    );
    const shipmentReservedUnits = boxes
      .filter((b) => assigned.has(b.id))
      .reduce((s, b) => s + b.units, 0);
    const readyUnits = boxes
      .filter((b) => !assigned.has(b.id))
      .reduce((s, b) => s + b.units, 0);
    const shippingReadyUnits = boxes
      .filter(
        (b) =>
          !assigned.has(b.id) &&
          b.status === "stored" &&
          w.pallets.some(
            (p) =>
              p.id === b.palletId &&
              p.kind === "finished" &&
              p.status === "stored",
          ) &&
          w.locations.some(
            (l) =>
              l.id === b.locationId &&
              !l.archived &&
              !l.blocked &&
              !w.sections.some((s) => s.id === l.sectionId && s.archived),
          ),
      )
      .reduce((s, b) => s + b.units, 0);
    // The remaining target already includes work in the open box. Never add scannedUnits again.
    const openTaskUnits = w.tasks
      .filter((t) => t.skuId === sku.id && t.status !== "completed")
      .reduce(
        (s, t) =>
          s + Math.max(0, t.boxesTarget - t.boxesCompleted) * t.unitsPerBox,
        0,
      );
    const rawAvailableUnits = w.pallets
      .filter(
        (p) =>
          p.skuId === sku.id &&
          p.kind === "raw" &&
          p.status === "stored" &&
          p.locationId &&
          w.locations.some(
            (l) =>
              l.id === p.locationId &&
              !l.archived &&
              !l.blocked &&
              !w.sections.some((s) => s.id === l.sectionId && s.archived),
          ) &&
          !w.movements.some(
            (x) =>
              x.palletId === p.id &&
              ["planned", "in_transit"].includes(x.status),
          ),
      )
      .reduce(
        (sum, p) =>
          sum +
          Math.max(
            0,
            p.quantity -
              w.tasks
                .filter((t) => t.status !== "completed")
                .flatMap((t) => t.reservations)
                .filter((r) => r.palletId === p.id)
                .reduce((s, r) => s + r.quantity, 0),
          ),
        0,
      );
    // Draft shipments are outgoing supply; including them once avoids manufacturing their replacements twice.
    const shortage = Math.max(
      0,
      targetUnits -
        marketplaceUnits -
        (inTransitUnits ?? 0) -
        readyUnits -
        shipmentReservedUnits -
        openTaskUnits,
    );
    const recommendedBoxes = Math.ceil(shortage / sku.unitsPerBox),
      recommendedUnits = recommendedBoxes * sku.unitsPerBox;
    if (dataComplete && recommendedUnits > rawAvailableUnits)
      blockers.push(
        "Недостаточно свободных размещённых раскрасок для всей рекомендации",
      );
    if (dataComplete && !recommendedBoxes)
      blockers.push("Дополнительная сборка сейчас не требуется");
    if (dataComplete && recommendedBoxes > 1000)
      blockers.push(
        "Рекомендация превышает предел одного задания: 1000 коробов",
      );
    warnings.push(
      "Средний спрос рассчитан по заказам за вычетом отмен; сезонность и дни отсутствия товара не восстановлены",
    );
    const proposalHash = createHash("sha256")
      .update(
        JSON.stringify({
          revision: w.revision,
          skuId: sku.id,
          m,
          from,
          to,
          recommendedBoxes,
        }),
      )
      .digest("hex");
    return {
      dataComplete,
      skuId: sku.id,
      skuName: sku.name,
      unitsPerBox: sku.unitsPerBox,
      averageDailyUnits,
      targetUnits,
      marketplaceUnits,
      inTransitUnits,
      inboundSource,
      inboundSources,
      readyUnits,
      shippingReadyUnits,
      shipmentReservedUnits,
      openTaskUnits,
      rawAvailableUnits,
      recommendedUnits,
      recommendedBoxes,
      canCreate: !blockers.length,
      blockers: [...new Set(blockers)],
      warnings: [...new Set(warnings)],
      proposalHash,
    };
  });
  return { generatedAt, rows, warnings: [...new Set(global)] };
}
