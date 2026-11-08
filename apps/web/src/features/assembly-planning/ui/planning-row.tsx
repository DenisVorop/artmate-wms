"use client";
import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Boxes } from "lucide-react";
import type { MarketplacePlanRowDto } from "@/entities/assembly-plan";
import { Badge, Button, Input } from "@/shared/ui";
import { transitSchema, type TransitValues } from "../lib/planning-form";
import { boxesLabel, packagedLabel, dispatchLabel } from "../lib/planning-view";
import type { StockConfirmationValues } from "../lib/planning-form";
import { PlanningStock } from "./planning-stock";
import styles from "./assembly-planning.module.css";
const number = (value: number | null, digits = 0) =>
  value == null
    ? "Не уточнено"
    : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(
        value,
      );
const status = {
  ready: "Можно собирать",
  covered: "Запаса достаточно",
  raw_shortage: "Не хватает сырья",
  review: "Нужна проверка",
};
export function PlanningRow({
  row,
  currentRow = row,
  previous = false,
  pending,
  onCreate,
  onTransit,
  onStock,
}: {
  row: MarketplacePlanRowDto;
  currentRow?: MarketplacePlanRowDto;
  previous?: boolean;
  pending: boolean;
  onCreate: () => Promise<void>;
  onTransit: (units: number) => Promise<boolean>;
  onStock: (values: StockConfirmationValues) => Promise<boolean>;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(false),
    [manual, setManual] = useState(false);
  const form = useForm<TransitValues>({
    resolver: zodResolver(transitSchema),
    defaultValues:
      currentRow.inTransitUnits == null
        ? {}
        : { inTransitUnits: currentRow.inTransitUnits },
  });
  const transitDirty = form.formState.isDirty;
  const resetTransit = form.reset;
  useEffect(() => {
    if (!transitDirty)
      resetTransit(
        currentRow.inTransitUnits == null
          ? {}
          : { inTransitUnits: currentRow.inTransitUnits },
      );
  }, [currentRow.inTransitUnits, transitDirty, resetTransit]);
  const { state, action, message } = row.advice;
  const needsAssembly =
    row.dataComplete && (state === "ready" || state === "raw_shortage");
  return (
    <article className={`glass-panel ${styles.row}`}>
      <div className={styles.rowMain}>
        <div className={styles.title}>
          <h2>{row.skuName}</h2>
          <Badge
            tone={
              previous
                ? "neutral"
                : state === "ready"
                  ? "success"
                  : state === "covered"
                    ? "neutral"
                    : "warning"
            }
          >
            {previous && row.dataComplete
              ? "Сохранённый расчёт"
              : status[state]}
          </Badge>
        </div>
        <div className={styles.quantities}>
          <div className={styles.quantity}>
            <span>Ожидаем продать за 30 дней</span>
            <strong>
              {row.salesForecastKnown
                ? `≈ ${number(row.expectedSalesUnits30)} шт.`
                : "Нужны данные"}
            </strong>
            <span>
              {row.providers.some((source) => source.scenario)
                ? "Предварительная оценка"
                : "Прогноз по этой тематике"}
            </span>
          </div>
          <div className={styles.quantity}>
            <span>Ближайшая отправка</span>
            <strong>
              {row.dataComplete ? boxesLabel(row.outboundBoxes) : "Уточнить"}
            </strong>
            <span>WB и Ozon</span>
          </div>
          <div className={styles.quantity}>
            <span>Останется у нас</span>
            <strong>
              {row.dataComplete
                ? packagedLabel(row.localAfterDispatchUnits, row.unitsPerBox)
                : "Уточнить"}
            </strong>
            <span>
              {row.dataComplete && row.dispatchShortageUnits > 0
                ? `Для отправки не хватает ${packagedLabel(row.dispatchShortageUnits, row.unitsPerBox)}`
                : "После отгрузки"}
            </span>
          </div>
          <div className={styles.quantity}>
            <span>Собрать на месяц</span>
            <strong
              className={needsAssembly ? styles.quantityAccent : undefined}
            >
              {needsAssembly
                ? boxesLabel(row.recommendedBoxes)
                : state === "covered"
                  ? boxesLabel(0)
                  : "Расчёт ожидает проверки"}
            </strong>
            {needsAssembly && (
              <span>
                {number(row.recommendedUnits)} шт. · по{" "}
                {number(row.unitsPerBox)} в коробе
              </span>
            )}
          </div>
        </div>
        <div className={styles.rowAction}>
          {!previous && action === "create" && (
            <Button
              disabled={pending || !row.canCreate}
              onClick={() => void onCreate()}
            >
              <Boxes size={16} />
              Создать задание на один короб
            </Button>
          )}
          {!previous && action === "receiving" && (
            <Link className="button button--secondary" href="/receiving">
              Открыть приёмку
            </Link>
          )}
          {action === "integrations" && (
            <Link className="button button--ghost" href="/integrations">
              Проверить данные
            </Link>
          )}
          {action === "transit" && (
            <Button
              variant="secondary"
              aria-expanded={expanded && manual}
              aria-controls={`${id}-details`}
              onClick={() => {
                setExpanded(true);
                setManual(true);
              }}
            >
              Уточнить поставки
            </Button>
          )}
        </div>
      </div>
      {(state === "review" || state === "raw_shortage") && (
        <p className={styles.reason}>{message}</p>
      )}
      <details
        className={styles.detail}
        id={`${id}-details`}
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary>Подробнее</summary>
        <h3 className={styles.forecastHeading}>
          Сколько ожидаем продать по неделям
        </h3>
        <div className={styles.weeklyPlan}>
          {row.weeklySales.map((week) => (
            <div className={styles.quantity} key={week.from}>
              <span>
                {dispatchLabel(week.from)} — {dispatchLabel(week.to)}
              </span>
              <strong>
                {row.salesForecastKnown
                  ? `≈ ${number(week.units)} шт.`
                  : "Нужны данные"}
              </strong>
              {week.providers.map((source) => (
                <span key={source.provider}>
                  {source.provider === "ozon" ? "Ozon" : "WB"}:{" "}
                  {source.known
                    ? `≈ ${number(source.units)} шт.`
                    : "нет прогноза"}
                </span>
              ))}
            </div>
          ))}
        </div>
        <dl className={styles.metrics}>
          <Metric
            label="Отправки за месяц"
            value={
              row.dataComplete
                ? boxesLabel(row.monthlyOutboundBoxes)
                : "Не уточнено"
            }
          />
          <Metric
            label="Останется после всех отправок"
            value={
              row.dataComplete
                ? packagedLabel(
                    row.localAfterPlannedDispatchUnits,
                    row.unitsPerBox,
                  )
                : "Не уточнено"
            }
          />
          <Metric
            label="В сборке уже учтено"
            value={packagedLabel(row.openTaskUnits, row.unitsPerBox)}
          />
        </dl>
        {row.dataComplete && (
          <div className={styles.weeklyPlan}>
            {row.weeklyDispatches.map((week) => (
              <div className={styles.quantity} key={week.date}>
                <span>{dispatchLabel(week.date)}</span>
                <strong>{boxesLabel(week.boxes)}</strong>
                <span>
                  {week.providers
                    .map(
                      (source) =>
                        `${source.provider === "ozon" ? "Ozon" : "WB"}: ${source.boxes}`,
                    )
                    .join(" · ")}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className={styles.providers}>
          {row.providers.map((source) => (
            <div className={styles.provider} key={source.provider}>
              <div className={styles.providerHeading}>
                <strong>
                  {source.provider === "ozon" ? "Ozon" : "Wildberries"}
                </strong>
                <span>
                  {source.dataComplete
                    ? boxesLabel(source.dispatchBoxes) + " к отправке"
                    : "Нужно уточнить данные"}
                </span>
              </div>
              <p className={styles.help}>
                {source.methodLabel}
                {source.scenario ? " · Сценарий" : ""} ·{" "}
                {source.confidenceLabel}
              </p>
              <dl className={styles.metrics}>
                <Metric
                  label="Ожидаем за 30 дней, шт."
                  value={
                    source.salesForecastKnown
                      ? `≈ ${number(source.expectedSalesUnits30)}`
                      : "Нужны данные"
                  }
                />
                <Metric
                  label="Заказов в день"
                  value={
                    source.dataComplete
                      ? number(source.averageDailyUnits, 1)
                      : "Не уточнено"
                  }
                />
                <Metric
                  label="На маркетплейсе, шт."
                  value={number(source.marketplaceUnits)}
                />
                <Metric
                  label="В пути, шт."
                  value={number(source.inTransitUnits)}
                />
              </dl>
            </div>
          ))}
        </div>
        <dl className={styles.metrics}>
          <Metric
            label="Заказов в день"
            value={
              row.dataComplete
                ? number(row.averageDailyUnits, 1)
                : "Не уточнено"
            }
          />
          <Metric
            label="На маркетплейсах, шт."
            value={
              row.dataComplete ? number(row.marketplaceUnits) : "Не уточнено"
            }
          />
          <Metric label="В пути, шт." value={number(row.inTransitUnits)} />
          <Metric
            label="Готовых у нас, шт."
            value={
              row.stockEstimated ? "Нужно уточнить" : number(row.readyUnits)
            }
          />
          <Metric
            label="Размечено для отгрузки, шт."
            value={number(row.shippingReadyUnits)}
          />
          <Metric label="Уже в сборке, шт." value={number(row.openTaskUnits)} />
          <Metric
            label="Сырья для сборки, шт."
            value={number(row.rawAvailableUnits)}
          />
        </dl>
        <p className={styles.help}>
          Показана потребность маркетплейсов, а не созданная поставка. Готовый
          товар и текущие задания уже учтены. Неразмеченные короба нужно
          привязать к адресам перед отгрузкой через WMS.
        </p>
        <PlanningStock row={currentRow} pending={pending} onSave={onStock} />
        <Link
          className={styles.textLink}
          href="/integrations#marketplace-supplies-title"
        >
          Посмотреть поставки →
        </Link>
        <details
          className={styles.manual}
          open={manual}
          onToggle={(event) => setManual(event.currentTarget.open)}
        >
          <summary>Уточнить товар в пути</summary>
          <form
            noValidate
            className={styles.transit}
            onSubmit={form.handleSubmit(async (values) => {
              if (!pending && (await onTransit(values.inTransitUnits)))
                form.reset(values);
            })}
          >
            <label className="field" htmlFor={`${id}-transit`}>
              Товар в пути на маркетплейсы, шт.
              <Input
                id={`${id}-transit`}
                type="number"
                min={0}
                max={100000000}
                {...form.register("inTransitUnits", { valueAsNumber: true })}
                disabled={pending}
                placeholder="Укажите количество"
                aria-invalid={!!form.formState.errors.inTransitUnits}
                aria-describedby={
                  form.formState.errors.inTransitUnits
                    ? `${id}-error`
                    : `${id}-help`
                }
              />
            </label>
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              disabled={
                pending ||
                (row.inTransitUnits != null && !form.formState.isDirty)
              }
            >
              Сохранить количество
            </Button>
            {form.formState.errors.inTransitUnits && (
              <span id={`${id}-error`} className={styles.error} role="alert">
                {form.formState.errors.inTransitUnits.message}
              </span>
            )}
          </form>
          <p className={styles.help} id={`${id}-help`}>
            Укажите весь отправленный товар, который ещё не приняли
            маркетплейсы. Уточнение заменит автоматическое количество до
            следующего обновления данных.
          </p>
        </details>
      </details>
    </article>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metric}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
