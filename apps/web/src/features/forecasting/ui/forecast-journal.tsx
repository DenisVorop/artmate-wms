"use client";
import {
  useForecastJournal,
  useForecastJournalRun,
  type ForecastJournalComparedRowDto,
} from "@/entities/forecast";
import { Button, Select, Badge } from "@/shared/ui";
import { useJournalSelection } from "../lib/use-journal-selection";
import {
  journalChart,
  journalDate,
  journalQuantity as qty,
  journalStatus,
} from "../lib/journal-presentation";
import { shortDate } from "../lib/chart";
import { ForecastChart } from "./forecast-chart";
import styles from "./forecasting.module.css";
function Comparison({ row }: { row: ForecastJournalComparedRowDto }) {
  const from = row.points[0]?.date,
    to = row.points.at(-1)?.date;
  return (
    <article className={styles.source}>
      <header>
        <div>
          <span className={styles.eyebrow}>
            Заказы за вычетом отмен · {row.skuName}
          </span>
          <h3>{row.provider === "ozon" ? "Ozon" : "Wildberries"}</h3>
        </div>
        <Badge tone={row.scoredDays ? "success" : "neutral"}>
          {row.scoredDays
            ? `${row.scoredDays} дн. для сравнения`
            : "Ожидаем фактические продажи"}
        </Badge>
      </header>
      {row.scoredDays > 0 ? (
        <div className={styles.journalMetrics}>
          <span>
            <small>Прогноз за сравниваемые дни</small>
            <strong>{qty(row.comparablePredicted)} шт.</strong>
          </span>
          <span>
            <small>Факт за те же дни</small>
            <strong>{qty(row.actual)} шт.</strong>
          </span>
          <span>
            <small>Средняя ошибка за день</small>
            <strong>{row.mae === null ? "—" : `${qty(row.mae)} шт.`}</strong>
          </span>
          <span>
            <small>Ошибка относительно продаж</small>
            <strong>
              {row.wape === null ? "—" : `${qty(row.wape * 100)}%`}
            </strong>
          </span>
        </div>
      ) : (
        <p className={styles.help}>
          Сравнение появится после завершённых дней продаж. День публикации не
          входит в оценку.
        </p>
      )}
      {from && to && (
        <ForecastChart source={journalChart(row)} range={{ from, to }} />
      )}
      <p className={styles.help}>
        График показывает весь сохранённый период. Оценка выше учитывает только
        сопоставимые завершённые дни.{" "}
        {row.unknownDays > 0 && `Нет данных за ${row.unknownDays} дн. `}
        {row.stockoutDays > 0 &&
          `Из оценки исключено ${row.stockoutDays} дн. без товара. `}
        {row.scenario &&
          "Это предварительный сценарий запуска или сезонного спроса."}
      </p>
      <details className={styles.innerDetails}>
        <summary>Количество по дням и поправка</summary>
        <div className={styles.journalTableWrap}>
          <table className={styles.journalTable}>
            <caption className={styles.srOnly}>
              Сохранённый прогноз и фактические продажи по дням
            </caption>
            <thead>
              <tr>
                <th scope="col">Дата</th>
                <th scope="col">Прогноз</th>
                <th scope="col">Факт</th>
                <th scope="col">Поправка</th>
                <th scope="col">Статус</th>
              </tr>
            </thead>
            <tbody>
              {row.points.map((point) => (
                <tr key={point.date}>
                  <th scope="row">{shortDate(point.date)}</th>
                  <td>{qty(point.predicted)}</td>
                  <td>{point.actual === null ? "—" : qty(point.actual)}</td>
                  <td>
                    {Math.abs(point.factor - 1) < 0.0001
                      ? "Без поправки"
                      : `×${qty(point.factor, 3)}`}
                  </td>
                  <td>{journalStatus(point.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </article>
  );
}
export function ForecastJournal({
  preferredSkuId,
}: {
  preferredSkuId?: string;
}) {
  const list = useForecastJournal(true),
    runs = list.data?.pages.flatMap((page) => page.runs) ?? [];
  // Resolve the run first, then choose a product from its immutable contents.
  const selection = useJournalSelection(runs);
  const detail = useForecastJournalRun(selection.runId, !!runs.length);
  const rows = detail.data?.rows ?? [];
  const skus = [
    ...new Map(
      rows.map((row) => [row.skuId, { id: row.skuId, name: row.skuName }]),
    ).values(),
  ];
  const skuId = skus.some((sku) => sku.id === selection.selectedSku)
    ? selection.selectedSku
    : skus.some((sku) => sku.id === preferredSkuId)
      ? preferredSkuId!
      : (skus[0]?.id ?? "");
  return (
    <section aria-label="История прогнозов">
      <div className={styles.sectionHeading}>
        <h2>История прогнозов</h2>
        <span>Сохраняется автоматически при каждом новом расчёте</span>
      </div>
      <p className={styles.help}>
        Выберите прошлый расчёт, чтобы проверить, сколько ожидали продать и
        сколько продали. Сохранённые прогнозы не меняются при обновлении модели.
      </p>
      {list.isPending ? (
        <p className={styles.help} role="status">
          Загружаем сохранённые прогнозы…
        </p>
      ) : list.isError ? (
        <div className={styles.error}>
          Не удалось загрузить историю.{" "}
          <Button variant="ghost" onClick={() => void list.refetch()}>
            Повторить
          </Button>
        </div>
      ) : !runs.length ? (
        <p className={styles.help}>
          Первый прогноз сохранится после следующего фонового расчёта. Старые
          расчёты задним числом не восстанавливаются.
        </p>
      ) : (
        <>
          <div className={styles.journalControls}>
            <label className="field">
              Расчёт от
              <Select
                aria-label="Дата сохранённого прогноза"
                value={selection.runId}
                onChange={(event) => selection.selectRun(event.target.value)}
              >
                {runs.map((run) => (
                  <option key={run.id} value={run.id}>
                    {journalDate(run.publishedAt)}
                  </option>
                ))}
              </Select>
            </label>
            <label className="field">
              Тематика
              <Select
                aria-label="Тематика сохранённого прогноза"
                value={skuId}
                disabled={!skus.length}
                onChange={(event) => selection.selectSku(event.target.value)}
              >
                {skus.map((sku) => (
                  <option key={sku.id} value={sku.id}>
                    {sku.name}
                  </option>
                ))}
              </Select>
            </label>
            {list.hasNextPage && (
              <Button
                variant="secondary"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage
                  ? "Загружаем…"
                  : "Более ранние расчёты"}
              </Button>
            )}
          </div>
          {detail.isPending ? (
            <p className={styles.help} role="status">
              Загружаем расчёт…
            </p>
          ) : detail.isError ? (
            <div className={styles.error}>
              Не удалось открыть расчёт.{" "}
              <Button variant="ghost" onClick={() => void detail.refetch()}>
                Повторить
              </Button>
            </div>
          ) : (
            detail.data && (
              <>
                <p className={styles.help}>
                  Расчёт опубликован {journalDate(detail.data.publishedAt)}.
                  Проверяем продажи по {shortDate(detail.data.evaluatedAsOf)}{" "}
                  включительно.
                </p>
                <div className={styles.journalSources}>
                  {rows
                    .filter((row) => row.skuId === skuId)
                    .map((row) => (
                      <Comparison key={row.id} row={row} />
                    ))}
                </div>
              </>
            )
          )}
        </>
      )}
      <p className={styles.help}>
        Автокоррекция следующих прогнозов применяется только после накопления
        как минимум 35 сопоставимых дней и проверки улучшения на последующих
        периодах. Исходный прогноз и применённая поправка сохраняются отдельно.
      </p>
    </section>
  );
}
