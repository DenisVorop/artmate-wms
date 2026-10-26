import type { ForecastPlanContext } from "../forecasting/forecast-storage";
import { planningBacklog } from "./planning-backlog";
import { baselineForecastSource } from "../forecasting/forecast-projection";
import {
  dispatchSchedule,
  preparationSchedule,
  PREPARATION_DAYS,
  UNIFIED_PLAN_VERSION,
  forecastQuantity,
  unifiedStockPlan,
} from "./unified-plan";
import { outgoingSupplyKeys } from "./planning-stock";
import { createHash } from "node:crypto";
import * as W from "../dto";
import { MarketplaceState } from "./storage";
import {
  MarketplacePlanDto,
  MarketplaceInboundSourceDto,
  MarketplacePlanAdviceDto,
  MarketplaceProviderPlanDto,
  MarketplaceWeeklyDispatchDto,
  MarketplaceWeeklySalesDto,
} from "./dto";
const day = 86400000;
export function marketplacePlan(
  w: W.WorkspaceDto,
  m: MarketplaceState,
  clock = new Date(),
  forecast?: ForecastPlanContext,
): MarketplacePlanDto {
  const generatedAt = clock.toISOString(),
    global: string[] = [];
  const enabled = m.connections.filter((c) => c.enabled);
  let globalAdviceMessage: string | null = enabled.length
    ? null
    : "Подключите маркетплейс и загрузите продажи.";
  if (!enabled.length)
    global.push("Подключите и обновите хотя бы один маркетплейс");
  const snapshots = enabled.flatMap((c) => {
    const snapshot = m.snapshots.find((s) => s.provider === c.provider);
    if (!snapshot) {
      global.push(`${c.provider}: нет полной загрузки`);
      globalAdviceMessage ??= "Загрузите данные маркетплейсов.";
      return [];
    }
    const refreshingPrevious =
      c.syncStatus === "running" &&
      c.syncMode === "automatic" &&
      c.lastSuccessVersion === c.version;
    if (c.syncStatus !== "success" && !refreshingPrevious) {
      global.push(`${c.provider}: последняя загрузка не завершена успешно`);
      globalAdviceMessage ??= "Обновите данные маркетплейсов.";
    }
    if (
      !Number.isFinite(Date.parse(snapshot.asOf)) ||
      clock.getTime() - Date.parse(snapshot.asOf) > day
    ) {
      global.push(`${c.provider}: данные старше 24 часов`);
      globalAdviceMessage ??= "Обновите данные маркетплейсов.";
    }
    if (
      !snapshot.coverage.catalog ||
      !snapshot.coverage.stocks ||
      !snapshot.coverage.demand
    ) {
      global.push(`${c.provider}: неполные данные`);
      globalAdviceMessage ??= "Обновите данные маркетплейсов.";
    }
    const missing = snapshot.products.filter(
      (p) =>
        !m.mappings.some(
          (x) => x.provider === c.provider && x.externalId === p.externalId,
        ),
    );
    if (missing.length) {
      global.push(`${c.provider}: сопоставьте ${missing.length} карточек`);
      globalAdviceMessage ??=
        "Свяжите товары маркетплейсов с тематиками склада.";
    }
    return [snapshot];
  });
  const today = new Date(clock.getTime() + 3 * 3600000)
    .toISOString()
    .slice(0, 10);
  const to = new Date(Date.parse(today) - day).toISOString().slice(0, 10);
  const from = new Date(Date.parse(to) - day * (m.settings.historyDays - 1))
    .toISOString()
    .slice(0, 10);
  const schedule = dispatchSchedule(clock, m.settings.dispatchWeekday ?? 6),
    preparation = preparationSchedule(schedule.today, schedule.dispatchDate),
    forecastDays = Math.max(
      PREPARATION_DAYS,
      (Date.parse(preparation.dates.at(-1)!) - Date.parse(schedule.today)) /
        day +
        m.settings.leadDays +
        m.settings.horizonDays +
        m.settings.safetyDays,
    );
  const assigned = new Set(
    w.shipments.filter((s) => s.status === "draft").flatMap((s) => s.boxIds),
  );
  const rows = w.skus
    .filter(
      (sku) =>
        (m.planningStock ?? []).find((s) => s.skuId === sku.id)?.enabled !==
        false,
    )
    .map((sku) => {
      const blockers = [...global],
        warnings: string[] = [];
      let reviewMessage = globalAdviceMessage;
      let marketplaceUnits = 0;
      const mappings = m.mappings.filter(
        (x) =>
          x.skuId === sku.id && enabled.some((c) => c.provider === x.provider),
      );
      if (!mappings.length) {
        blockers.push("Тематика не сопоставлена с карточками маркетплейсов");
        reviewMessage ??= "Свяжите товар маркетплейса с тематикой склада.";
      }
      for (const snapshot of snapshots) {
        const related = mappings.filter(
          (x) => x.provider === snapshot.provider,
        );
        if (!related.length) continue;
        if (snapshot.from > from || snapshot.to < to) {
          blockers.push(`${snapshot.provider}: недостаточно дней истории`);
          reviewMessage ??= "Загрузите продажи за весь расчётный период.";
        }
        warnings.push(
          ...snapshot.warnings.map((v) => `${snapshot.provider}: ${v}`),
        );
        for (const mapping of related) {
          const stocks = snapshot.stocks.filter(
            (x) => x.externalId === mapping.externalId,
          );
          if (!stocks.length || stocks.some((x) => x.availableUnits === null)) {
            blockers.push(
              `${snapshot.provider}: неизвестен остаток карточки ${mapping.externalId}`,
            );
            reviewMessage ??= "Обновите остатки товара на маркетплейсах.";
          }
          marketplaceUnits += stocks.reduce(
            (s, x) => s + (x.availableUnits ?? 0) * mapping.unitsPerItem,
            0,
          );
          if (stocks.some((x) => x.availableUnits === 0))
            warnings.push(
              "Нулевой остаток мог ограничить продажи; прогноз может быть занижен",
            );
        }
      }
      const goal = forecast?.goals[sku.id];
      const minimumUnits =
        (forecast?.minimumBoxes[sku.id] ?? 0) * sku.unitsPerBox;
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
      const providerNames = [
        ...new Set(mappings.map((mapping) => mapping.provider)),
      ];
      const manual = m.transit[sku.id];
      const unallocatedTransit =
        manual !== undefined && manual > 0 && providerNames.length > 1;
      if (unallocatedTransit) {
        blockers.push("Суммарный товар в пути не распределён между площадками");
        reviewMessage ??= "Уточните товар в пути отдельно по WB и Ozon.";
      }
      const sourceInput = {
        asOf: to,
        settings: m.settings,
        snapshots,
        mappings: m.mappings,
        skus: w.skus,
        policies: w.skus.map((item) => ({
          skuId: item.id,
          minimumBoxes: forecast?.minimumBoxes[item.id] ?? 0,
          seasonalityEnabled: forecast?.seasonalityEnabled?.[item.id] ?? true,
        })),
      };
      const weeklyDispatches: MarketplaceWeeklyDispatchDto[] =
        preparation.dates.map((date) => ({
          date,
          boxes: 0,
          units: 0,
          providers: [],
        }));
      const weeklySales: MarketplaceWeeklySalesDto[] = Array.from(
        { length: Math.ceil(PREPARATION_DAYS / 7) },
        (_, index) => ({
          from: new Date(Date.parse(schedule.today) + index * 7 * day)
            .toISOString()
            .slice(0, 10),
          to: new Date(
            Date.parse(schedule.today) +
              Math.min(PREPARATION_DAYS - 1, index * 7 + 6) * day,
          )
            .toISOString()
            .slice(0, 10),
          units: 0,
          providers: [],
        }),
      );
      const providers: MarketplaceProviderPlanDto[] = providerNames.map(
        (provider) => {
          const snapshot = snapshots.find((item) => item.provider === provider);
          const related = mappings.filter((item) => item.provider === provider);
          const candidate = goal?.sources?.find(
            (item) => item.provider === provider,
          );
          const values = new Map(
            candidate?.dailyForecast.map((point) => [point.date, point.units]),
          );
          const completeForecast = Array.from(
            { length: forecastDays },
            (_, index) =>
              new Date(Date.parse(schedule.today) + index * day)
                .toISOString()
                .slice(0, 10),
          ).every((date) => {
            const value = values.get(date);
            return value !== undefined && Number.isFinite(value) && value >= 0;
          });
          const cached = completeForecast ? candidate : undefined;
          const fallback = related.map((mapping) =>
            baselineForecastSource(
              sourceInput,
              provider,
              mapping.externalId,
              forecastDays,
            ),
          );
          const source = cached ?? {
            provider,
            dailyForecast:
              fallback[0]?.dailyForecast.map((point, index) => ({
                date: point.date,
                units: fallback.reduce(
                  (sum, item) => sum + (item.dailyForecast[index]?.units ?? 0),
                  0,
                ),
              })) ?? [],
            methodLabel: fallback.some((item) => item.scenario)
              ? "Сценарий роста к Новому году"
              : "Текущий спрос",
            confidenceLabel: "Предварительная оценка",
            scenario: fallback.some((item) => item.scenario),
            salesForecastKnown:
              fallback.length > 0 &&
              fallback.every(
                (item, index) =>
                  item.salesForecastKnown ??
                  !!snapshot?.demand.some(
                    (record) =>
                      record.externalId === related[index]?.externalId &&
                      record.date >=
                        new Date(Date.parse(to) - 13 * day)
                          .toISOString()
                          .slice(0, 10) &&
                      record.date <= to,
                  ),
              ),
          };
          const observedDemand = related.every((mapping) =>
            snapshot?.demand.some(
              (record) =>
                record.externalId === mapping.externalId &&
                record.date >=
                  new Date(Date.parse(to) - 13 * day)
                    .toISOString()
                    .slice(0, 10) &&
                record.date <= to,
            ),
          );
          const salesForecastKnown =
            !!snapshot?.coverage.demand &&
            snapshot.to >= to &&
            Number.isFinite(Date.parse(snapshot.asOf)) &&
            clock.getTime() - Date.parse(snapshot.asOf) <= day &&
            (source.salesForecastKnown ?? observedDemand);
          const expectedSalesUnits30 = forecastQuantity(
            source,
            schedule.today,
            PREPARATION_DAYS,
          );
          for (const week of weeklySales) {
            const units = forecastQuantity(
              source,
              week.from,
              (Date.parse(week.to) - Date.parse(week.from)) / day + 1,
            );
            week.units += units;
            week.providers.push({ provider, units, known: salesForecastKnown });
          }
          const periodDays =
            schedule.waitDays +
            m.settings.leadDays +
            m.settings.horizonDays +
            m.settings.safetyDays;
          const target = Math.max(
            0,
            Math.ceil(
              forecastQuantity(source, schedule.today, periodDays) - 1e-9,
            ),
          );

          const stocks = related.map((mapping) => ({
            mapping,
            entries:
              snapshot?.stocks.filter(
                (item) => item.externalId === mapping.externalId,
              ) ?? [],
          }));
          const stockKnown = stocks.every(
            (item) =>
              item.entries.length > 0 &&
              item.entries.every((entry) => entry.availableUnits !== null),
          );
          const stockUnits = stockKnown
            ? stocks.reduce(
                (sum, item) =>
                  sum +
                  item.entries.reduce(
                    (total, entry) =>
                      total + entry.availableUnits! * item.mapping.unitsPerItem,
                    0,
                  ),
                0,
              )
            : null;
          const inbound = unallocatedTransit
            ? null
            : manual !== undefined
              ? manual
              : (inboundSources.find((item) => item.provider === provider)
                  ?.units ?? null);
          const providerBlock =
            global.some((reason) => reason.startsWith(`${provider}:`)) ||
            !snapshot ||
            (!!snapshot && (snapshot.from > from || snapshot.to < to));
          const complete =
            !providerBlock &&
            stockKnown &&
            inbound !== null &&
            salesForecastKnown;
          const dispatchBoxes = Math.ceil(
            Math.max(0, target - (stockUnits ?? 0) - (inbound ?? 0)) /
              sku.unitsPerBox,
          );
          let previousBoxes = 0;
          for (const week of weeklyDispatches) {
            const daysToCover =
              (Date.parse(week.date) - Date.parse(schedule.today)) / day +
              m.settings.leadDays +
              m.settings.horizonDays +
              m.settings.safetyDays;
            const cumulativeTarget = Math.max(
              0,
              Math.ceil(
                forecastQuantity(source, schedule.today, daysToCover) - 1e-9,
              ),
            );
            // Current marketplace stock and already sent inbound are a single
            // initial position, not a deduction to repeat on each weekly leg.
            const cumulativeBoxes = Math.ceil(
              Math.max(
                0,
                cumulativeTarget - (stockUnits ?? 0) - (inbound ?? 0),
              ) / sku.unitsPerBox,
            );
            const boxes = Math.max(0, cumulativeBoxes - previousBoxes);
            const units = boxes * sku.unitsPerBox;
            week.providers.push({ provider, boxes, units });
            week.boxes += boxes;
            week.units += units;
            previousBoxes = cumulativeBoxes;
          }
          return {
            provider,
            expectedSalesUnits30,
            salesForecastKnown,
            averageDailyUnits: source.dailyForecast.length
              ? source.dailyForecast.reduce(
                  (sum, point) => sum + point.units,
                  0,
                ) / source.dailyForecast.length
              : 0,
            targetUnits: target,
            marketplaceUnits: stockUnits,
            inTransitUnits: inbound,
            dispatchBoxes,
            dispatchUnits: dispatchBoxes * sku.unitsPerBox,
            dataComplete: complete,
            methodLabel: source.methodLabel,
            confidenceLabel: source.confidenceLabel,
            scenario: source.scenario,
          };
        },
      );
      if (providers.some((provider) => !provider.salesForecastKnown)) {
        blockers.push(
          "Недостаточно подтверждённой истории продаж для прогноза тематики",
        );
        reviewMessage ??=
          "Недостаточно истории продаж для прогноза этой тематики.";
      }
      const monthlyOutboundUnits = weeklyDispatches.reduce(
        (sum, week) => sum + week.units,
        0,
      );
      const averageDailyUnits = providers.reduce(
        (sum, provider) => sum + provider.averageDailyUnits,
        0,
      );
      const targetUnits = Math.max(
        minimumUnits,
        providers.reduce((sum, provider) => sum + provider.targetUnits, 0),
      );
      let dataComplete = blockers.length === 0;

      const boxes = w.boxes.filter(
        (b) =>
          b.skuId === sku.id && ["stored", "in_transit"].includes(b.status),
      );
      const shipmentReservedUnits = boxes
        .filter((b) => assigned.has(b.id))
        .reduce((s, b) => s + b.units, 0);
      if (shipmentReservedUnits > 0 && monthlyOutboundUnits > 0) {
        blockers.push(
          "Неизвестно, к какой площадке относятся зарезервированные короба",
        );
        reviewMessage ??=
          "Уточните, к какой отправке относятся зарезервированные короба.";
      }
      const trackedReadyUnits = boxes
        .filter((b) => !assigned.has(b.id))
        .reduce((s, b) => s + b.units, 0);
      const stock = (m.planningStock ?? []).find((s) => s.skuId === sku.id),
        stockConfirmedAt = stock?.countedAt ?? null,
        stockEstimated =
          !!stock && (stock.accuracy === "approximate" || stock.units === null);
      const opening =
        stock?.units !== null && stock?.units !== undefined
          ? stock.units - stock.trackedUnitsAtCount
          : 0;
      const unregisteredUnits = Math.max(0, opening);
      let stockReviewMessage: string | null = null;
      if (stock) {
        if (stock.units === null)
          stockReviewMessage =
            "Подтвердите точное количество готового товара у нас.";
        else if (stock.accuracy === "approximate")
          stockReviewMessage =
            "Остаток указан примерно. Подтвердите точное количество перед сборкой.";
        else if (opening < 0)
          stockReviewMessage =
            "Подтверждённый остаток меньше уже учтённых коробов. Нужен пересчёт.";
        else if (stock.unitsPerBoxAtCount !== sku.unitsPerBox)
          stockReviewMessage =
            "Изменилось количество в коробе. Подтвердите готовый остаток заново.";
        else if (
          unregisteredUnits > 0 &&
          (!Number.isFinite(Date.parse(stock.countedAt)) ||
            clock.getTime() - Date.parse(stock.countedAt) >= 7 * day ||
            Date.parse(stock.countedAt) > clock.getTime() + 60000)
        )
          stockReviewMessage =
            "Готовый остаток подтверждён более недели назад. Пересчитайте его перед сборкой.";
        else if (
          unregisteredUnits > 0 &&
          outgoingSupplyKeys(m, sku.id).some(
            (key) => !stock.outboundSupplyKeys.includes(key),
          )
        )
          stockReviewMessage =
            "После пересчёта появилась новая поставка. Уточните, сколько готового товара осталось у нас.";
        if (stockReviewMessage) blockers.push(stockReviewMessage);
        if (unregisteredUnits > 0)
          warnings.push(
            "В расчёте есть готовый товар без адресов и QR. После внешней отправки или списания подтвердите остаток заново.",
          );
      }
      dataComplete = blockers.length === 0;
      const readyUnits = trackedReadyUnits + unregisteredUnits;
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
      const unified = unifiedStockPlan({
        providers,
        ownUnits: readyUnits + shipmentReservedUnits,
        reservedUnits: shipmentReservedUnits,
        openTaskUnits,
        unitsPerBox: sku.unitsPerBox,
        monthlyOutboundUnits,
      });
      const { recommendedBoxes, recommendedUnits } = unified;
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
        goal?.message ??
          "Средний спрос рассчитан по заказам за вычетом отмен; сезонность и дни отсутствия товара не восстановлены",
      );
      const canCreate = !blockers.length;
      // Presentation follows the same blockers; it never replaces missing quantities
      // or grants permission to create a task.
      const advice: MarketplacePlanAdviceDto = stockReviewMessage
        ? { state: "review", message: stockReviewMessage, action: "none" }
        : reviewMessage
          ? { state: "review", message: reviewMessage, action: "integrations" }
          : inTransitUnits === null
            ? {
                state: "review",
                message: "Проверьте количество товара в пути.",
                action: "transit",
              }
            : dataComplete && recommendedUnits > rawAvailableUnits
              ? {
                  state: "raw_shortage",
                  message: `Примите и разместите товар: не хватает ${recommendedUnits - rawAvailableUnits} шт.`,
                  action: "receiving",
                }
              : canCreate
                ? {
                    state: "ready",
                    message: "Можно передать в сборку.",
                    action: "create",
                  }
                : dataComplete && recommendedBoxes === 0
                  ? {
                      state: "covered",
                      message: "Запаса и текущей сборки достаточно.",
                      action: "none",
                    }
                  : {
                      state: "review",
                      message: "Рекомендация требует проверки руководителем.",
                      action: "none",
                    };
      const proposalHash = createHash("sha256")
        .update(
          JSON.stringify({
            revision: w.revision,
            skuId: sku.id,
            m: {
              ...m,
              connections: m.connections.map(
                ({ historyLease: _historyLease, ...connection }) => connection,
              ),
            },
            from,
            to,
            recommendedBoxes,
            dispatchDate: schedule.dispatchDate,
            planningVersion: UNIFIED_PLAN_VERSION,
            preparationThrough: preparation.through,
            weeklyDispatches,
            providers,
            forecast: forecast
              ? { key: forecast.key, goal: goal ?? null, minimumUnits }
              : null,
          }),
        )
        .digest("hex");
      return {
        advice,
        dataComplete,
        skuId: sku.id,
        skuName: sku.name,
        unitsPerBox: sku.unitsPerBox,
        ...unified,
        weeklyDispatches,
        expectedSalesUnits30: providers.reduce(
          (sum, provider) => sum + provider.expectedSalesUnits30,
          0,
        ),
        salesForecastKnown:
          providers.length > 0 &&
          providers.every((provider) => provider.salesForecastKnown),
        weeklySales,
        backlogRank: null as number | null,
        backlogCanCreate: false,
        backlogBoxes: 0,
        backlogUnits: 0,
        backlogCapacityKnown: false,
        backlogReason: "Проверяем свободные места хранения.",
        providers,
        averageDailyUnits,
        targetUnits,
        marketplaceUnits,
        inTransitUnits,
        inboundSource,
        inboundSources,
        readyUnits,
        unregisteredUnits,
        stockConfirmedAt,
        stockEstimated,
        shippingReadyUnits,
        shipmentReservedUnits,
        openTaskUnits,
        rawAvailableUnits,
        recommendedUnits,
        recommendedBoxes,
        canCreate,
        blockers: [...new Set(blockers)],
        warnings: [...new Set(warnings)],
        proposalHash,
      };
    });
  const backlogMessage = planningBacklog(
    w,
    rows,
    forecast?.minimumBoxes ?? {},
    m.planningStock ?? [],
  );
  for (const row of rows)
    row.proposalHash = createHash("sha256")
      .update(
        JSON.stringify({
          base: row.proposalHash,
          backlogRank: row.backlogRank,
          backlogBoxes: row.backlogBoxes,
          backlogCanCreate: row.backlogCanCreate,
          backlogCapacityKnown: row.backlogCapacityKnown,
        }),
      )
      .digest("hex");
  return {
    backlogMessage,
    preparationDays: PREPARATION_DAYS,
    preparationThrough: preparation.through,
    generatedAt,
    dispatchDate: schedule.dispatchDate,
    leadDays: m.settings.leadDays,
    horizonDays: m.settings.horizonDays,
    safetyDays: m.settings.safetyDays,
    rows,
    warnings: [...new Set(global)],
  };
}
