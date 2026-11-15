"use client";
import Link from "next/link";
import type { MarketplacePlanRowDto } from "@/entities/assembly-plan";
import { Button } from "@/shared/ui";
import {
  boxesLabel,
  dispatchLabel,
  packagedLabel,
  needsAssembly,
  planningStatus,
} from "../lib/planning-view";
import styles from "./assembly-planning.module.css";

const quantity = (value: number | null, digits = 0) =>
  value == null
    ? "—"
    : value.toLocaleString("ru-RU", { maximumFractionDigits: digits });
const providerName = (provider: string) =>
  provider === "ozon" ? "Ozon" : "WB";

export function PlanningRow({
  row,
  previous,
  pending,
  onCreate,
}: {
  row: MarketplacePlanRowDto;
  previous: boolean;
  pending: boolean;
  onCreate: () => Promise<void>;
}) {
  const { state, action, message } = row.advice;
  const complete = row.dataComplete && state !== "review";
  return (
    <section
      className={styles.detail}
      aria-label={`План для товара «${row.skuName}»`}
    >
      <header className={styles.detailHeader}>
        <h2>{row.skuName}</h2>
        <span className={styles.status} data-state={state}>
          {planningStatus[state]}
        </span>
      </header>
      {["review", "raw_shortage", "raw_movement"].includes(state) && (
        <p className={styles.help}>{message}</p>
      )}
      <div className={styles.actions}>
        {!previous && action === "create" && row.canCreate && (
          <Button disabled={pending} onClick={() => void onCreate()}>
            Создать задание на один короб
          </Button>
        )}
        {!previous && action === "receiving" && (
          <Link className={styles.textLink} href="/receiving">
            К приёмке
          </Link>
        )}
        {!previous && action === "movements" && (
          <Link className={styles.textLink} href="/movements">
            К перемещениям
          </Link>
        )}
        {(action === "integrations" || action === "transit") && (
          <Link
            className={styles.textLink}
            href={
              action === "transit"
                ? "/integrations#marketplace-supplies-title"
                : "/integrations"
            }
          >
            Проверить данные
          </Link>
        )}
      </div>
      <dl className={styles.metrics}>
        <Metric
          label="Ближайшая отправка"
          value={complete ? boxesLabel(row.outboundBoxes) : "—"}
        />
        <Metric
          label="Останется после отправки"
          value={
            complete
              ? packagedLabel(row.localAfterDispatchUnits, row.unitsPerBox)
              : "—"
          }
        />
        <Metric
          label="Собрать за месяц"
          value={
            complete
              ? boxesLabel(needsAssembly(row) ? row.recommendedBoxes : 0)
              : "—"
          }
        />
        {complete && row.dispatchShortageUnits > 0 && (
          <Metric
            label="Не хватает к отправке"
            value={packagedLabel(row.dispatchShortageUnits, row.unitsPerBox)}
          />
        )}
        <Metric
          label="Останется после всех отправок"
          value={
            complete
              ? packagedLabel(
                  row.localAfterPlannedDispatchUnits,
                  row.unitsPerBox,
                )
              : "—"
          }
        />
        <Metric
          label="В сборке"
          value={packagedLabel(row.openTaskUnits, row.unitsPerBox)}
        />
        <Metric label="Готовый товар, шт." value={quantity(row.readyUnits)} />
        <Metric
          label="Размечено к отгрузке, шт."
          value={quantity(row.shippingReadyUnits)}
        />
        <Metric
          label="Сырьё для сборки, шт."
          value={quantity(row.rawAvailableUnits)}
        />
      </dl>

      {row.providers.length > 0 && (
        <div
          className={styles.scroll}
          role="region"
          aria-label="План по площадкам"
          tabIndex={0}
        >
          <table className={`${styles.table} ${styles.detailTable}`}>
            <thead>
              <tr>
                <th scope="col">Площадка</th>
                <th scope="col" className={styles.numeric}>
                  К отправке, кор.
                </th>
                <th scope="col" className={styles.numeric}>
                  На площадке, шт.
                </th>
                <th scope="col" className={styles.numeric}>
                  В пути, шт.
                </th>
                <th scope="col" className={styles.numeric}>
                  Прогноз на 30 дней, шт.
                </th>
              </tr>
            </thead>
            <tbody>
              {row.providers.map((source) => (
                <tr key={source.provider}>
                  <th scope="row">
                    {providerName(source.provider)}
                    {source.scenario && <small>Сценарий</small>}
                  </th>
                  <td className={styles.numeric}>
                    {source.dataComplete ? quantity(source.dispatchBoxes) : "—"}
                  </td>
                  <td className={styles.numeric}>
                    {quantity(source.marketplaceUnits)}
                  </td>
                  <td className={styles.numeric}>
                    {quantity(source.inTransitUnits)}
                  </td>
                  <td className={styles.numeric}>
                    {source.salesForecastKnown
                      ? `≈ ${quantity(source.expectedSalesUnits30)}`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {complete && row.weeklyDispatches.length > 0 && (
        <details>
          <summary>
            Отправки по неделям · {boxesLabel(row.monthlyOutboundBoxes)}
          </summary>
          <dl className={styles.weekTotals}>
            {row.weeklyDispatches.map((week) => (
              <div key={week.date}>
                <dt>{dispatchLabel(week.date)}</dt>
                <dd>{boxesLabel(week.boxes)}</dd>
                <dd className={styles.help}>
                  {week.providers
                    .map(
                      (source) =>
                        `${providerName(source.provider)} ${quantity(source.boxes)}`,
                    )
                    .join(" · ")}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {row.weeklySales.length > 0 && (
        <details>
          <summary>Прогноз продаж по неделям</summary>
          <dl className={styles.weekTotals}>
            {row.weeklySales.map((week) => (
              <div key={week.from}>
                <dt>
                  {dispatchLabel(week.from)} — {dispatchLabel(week.to)}
                </dt>
                <dd>
                  {row.salesForecastKnown
                    ? `≈ ${quantity(week.units)} шт.`
                    : "—"}
                </dd>
                <dd className={styles.help}>
                  {week.providers
                    .map(
                      (source) =>
                        `${providerName(source.provider)} ${source.known ? `≈ ${quantity(source.units)}` : "—"}`,
                    )
                    .join(" · ")}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
