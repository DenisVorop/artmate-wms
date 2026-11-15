"use client";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  useForecast,
  useForecastHistory,
  type ForecastHistoryJobDto,
  type ForecastRowDto,
  type ForecastSourceDto,
} from "@/entities/forecast";
import { Badge, Button, Input, Select } from "@/shared/ui";
import { useForecastActions } from "../model/use-forecast-actions";
import { shortDate } from "../lib/chart";
import { useChartWindow } from "../lib/use-chart-window";
import type { ChartPeriod } from "../lib/chart-period";
import { ForecastPolicy } from "./forecast-policy";
import { ForecastChart } from "./forecast-chart";
import { FinanceConnect } from "./finance-connect";
import styles from "./forecasting.module.css";
const name = (provider: string) =>
  provider === "ozon" ? "Ozon" : "Wildberries";
const status = (job: ForecastHistoryJobDto | undefined) =>
  !job
    ? "Загрузка ещё не запущена"
    : job.status === "complete"
      ? "Загрузка завершена"
      : job.status === "running" || job.status === "queued"
        ? "История загружается"
        : job.status === "permission_required"
          ? "Нужен доступ к истории"
          : job.status === "paused"
            ? "Загрузка приостановлена"
            : "Повторим загрузку автоматически";
function ModelComparison({ source }: { source: ForecastSourceDto }) {
  return (
    <details className={styles.innerDetails}>
      <summary>Как проверялись модели</summary>
      <p className={styles.help}>
        Проверяем прогноз на прошлых периодах. Меньшая ошибка означает более
        точный результат.
      </p>
      <ul className={styles.models}>
        {source.candidates.map((candidate) => (
          <li key={candidate.model}>
            <div>
              <strong>{candidate.label}</strong>
              <span>
                {candidate.eligible && candidate.mae !== null
                  ? `Средняя ошибка: ${candidate.mae.toFixed(1)} шт. в день`
                  : (candidate.reason ?? "Пока недостаточно истории")}
              </span>
            </div>
            <small>
              {candidate.folds > 0
                ? `${candidate.folds} проверок`
                : "Ожидаем историю"}
              {candidate.wape !== null
                ? ` · Ошибка ${(candidate.wape * 100).toFixed(0)}%`
                : ""}
            </small>
          </li>
        ))}
      </ul>
    </details>
  );
}
function ForecastSources({
  row,
  preview = false,
}: {
  row: ForecastRowDto;
  preview?: boolean;
}) {
  const window = useChartWindow(row.sources);
  return (
    <>
      <fieldset
        className={styles.chartControls}
        disabled={!window.bounds.first}
      >
        <legend>Период графиков</legend>
        <div className={styles.chartControlFields}>
          <label className="field">
            Показать
            <Select
              aria-label="Период графиков"
              value={window.period}
              onChange={(event) =>
                window.selectPeriod(event.target.value as ChartPeriod)
              }
            >
              <option value="month">Месяц и прогноз</option>
              <option value="quarter">3 месяца и прогноз</option>
              <option value="year">Год и прогноз</option>
              <option value="all">Весь период</option>
              <option value="custom">Выбрать даты</option>
            </Select>
          </label>
          <label className="field">
            С
            <Input
              type="date"
              aria-label="Начало периода графиков"
              value={window.range.from}
              min={window.bounds.first}
              max={window.bounds.last}
              onChange={(event) =>
                window.changeDate("from", event.target.value)
              }
            />
          </label>
          <label className="field">
            По
            <Input
              type="date"
              aria-label="Конец периода графиков"
              value={window.range.to}
              min={window.bounds.first}
              max={window.bounds.last}
              onChange={(event) => window.changeDate("to", event.target.value)}
            />
          </label>
        </div>
        <p className={styles.help}>
          Период меняет только графики. «Месяц», «3 месяца» и «Год» включают
          ближайшие 30 дней прогноза. За прошедшие дни сохранённый прогноз
          показан рядом с фактом.
        </p>
      </fieldset>
      {!window.valid ? (
        <p className={styles.error} role="status">
          {window.bounds.first
            ? "Выберите начало и конец периода в пределах доступных дат. Начало не должно быть позже окончания."
            : "Пока нет данных для графика."}
        </p>
      ) : (
        <div className={styles.sources}>
          {row.sources.map((source, index) => (
            <article
              className={styles.source}
              key={`${source.provider}:${source.metricLabel}:${index}`}
            >
              <header>
                <div>
                  <span className={styles.eyebrow}>
                    {name(source.provider)} · {source.metricLabel}
                  </span>
                  <h3>{source.modelLabel}</h3>
                </div>
              </header>
              <ForecastChart source={source} range={window.range} />
              {!preview && <ModelComparison source={source} />}
            </article>
          ))}
        </div>
      )}
    </>
  );
}
function ForecastContent() {
  const forecast = useForecast(true),
    history = useForecastHistory(true),
    actions = useForecastActions(),
    [selected, setSelected] = useState("");
  const row =
      forecast.data?.rows.find((row) => row.skuId === selected) ??
      forecast.data?.rows[0],
    busy = !!actions.pending;
  return (
    <div className={styles.content}>
      {actions.error && (
        <p role="alert" className={styles.error}>
          {actions.error}
        </p>
      )}
      {actions.notice && (
        <p role="status" className={styles.notice}>
          {actions.notice}
        </p>
      )}
      <section aria-label="Загрузка истории продаж">
        <div className={styles.sectionHeading}>
          <h2>История продаж</h2>
          <span>С начала торговли · обновляется автоматически</span>
        </div>
        {history.isPending ? (
          <p className={styles.help} role="status">
            Проверяем загрузку истории…
          </p>
        ) : history.isError ? (
          <div className={styles.error}>
            Не удалось получить состояние истории.{" "}
            <Button variant="ghost" onClick={() => void history.refetch()}>
              Повторить
            </Button>
          </div>
        ) : (
          history.data && (
            <div className={styles.historyGrid}>
              {history.data.providers.map((provider) => {
                const jobs = history.data.jobs.filter(
                    (job) => job.provider === provider.provider,
                  ),
                  job =
                    jobs.find((job) =>
                      [
                        "running",
                        "queued",
                        "failed",
                        "permission_required",
                        "paused",
                      ].includes(job.status),
                    ) ?? jobs.at(-1),
                  running =
                    job?.status === "queued" || job?.status === "running";
                return (
                  <article
                    className={styles.historyCard}
                    key={provider.provider}
                  >
                    <header>
                      <h3>{name(provider.provider)}</h3>
                      <Badge
                        tone={
                          job?.status === "complete"
                            ? "success"
                            : running
                              ? "neutral"
                              : "warning"
                        }
                      >
                        {status(job)}
                      </Badge>
                    </header>
                    <p>
                      {provider.firstSaleDate
                        ? `Первые продажи: ${shortDate(provider.firstSaleDate)}`
                        : "Первые продажи ещё ищем в архиве"}
                    </p>
                    <span className={styles.help}>
                      {provider.archiveFrom && provider.archiveThrough
                        ? `Архив проверен: ${shortDate(provider.archiveFrom)} — ${shortDate(provider.archiveThrough)}.`
                        : "Загружаем сохранённые продажи по порядку."}
                      {provider.lastSaleDate &&
                        ` Последние загруженные продажи: ${shortDate(provider.lastSaleDate)}.`}
                    </span>
                    {job?.loadedThrough && job.status !== "complete" && (
                      <p className={styles.help}>
                        Обработано до {shortDate(job.loadedThrough)}
                      </p>
                    )}
                    <div>
                      <Button
                        variant="secondary"
                        disabled={busy || running || job?.status === "complete"}
                        onClick={() =>
                          void actions.start(
                            provider.provider,
                            job && job.status !== "complete"
                              ? { from: job.from, to: job.to }
                              : undefined,
                          )
                        }
                      >
                        {running
                          ? "Загружается в фоне"
                          : job?.status === "complete"
                            ? "История загружена"
                            : job?.status === "paused" ||
                                job?.status === "failed"
                              ? "Продолжить загрузку"
                              : "Загрузить историю"}
                      </Button>
                    </div>
                    {provider.provider === "wildberries" && (
                      <FinanceConnect
                        configured={provider.financeConfigured}
                        pending={busy}
                        checking={actions.pending === "finance"}
                        onSave={actions.finance}
                      />
                    )}
                  </article>
                );
              })}
            </div>
          )
        )}
      </section>
      <section aria-label="Прогноз по тематике">
        <p className={styles.help}>
          Прогноз использует всю загруженную историю и текущие продажи. Сезонные
          оценки, точность которых ещё не подтверждена, отмечены как
          предварительные.
        </p>
        <div className={styles.sectionHeading}>
          <h2>Прогноз по тематике</h2>
          {forecast.data?.computing && (
            <span role="status">Уточняем прогноз…</span>
          )}
        </div>
        {forecast.isPending ? (
          <p className={styles.help} role="status">
            Загружаем прогноз…
          </p>
        ) : forecast.isError ? (
          <div className={styles.error}>
            Не удалось получить прогноз.{" "}
            <Button variant="ghost" onClick={() => void forecast.refetch()}>
              Повторить
            </Button>
          </div>
        ) : (
          forecast.data && (
            <>
              {forecast.data.message && (
                <p className={styles.help}>{forecast.data.message}</p>
              )}
              {row ? (
                <>
                  <ForecastProductSelect
                    rows={forecast.data.rows}
                    selected={row.skuId}
                    onSelect={setSelected}
                  />
                  <div className={styles.forecastSummary}>
                    <div>
                      <h3>{row.methodLabel}</h3>
                      <p>{row.message}</p>
                    </div>
                    <Badge
                      tone={
                        row.seasonalityApplied &&
                        row.confidenceLabel !== "Предварительная оценка"
                          ? "success"
                          : "neutral"
                      }
                    >
                      {row.confidenceLabel}
                    </Badge>
                  </div>
                  <ForecastPolicy
                    key={`${row.skuId}:${row.minimumBoxes}:${row.seasonalityEnabled}`}
                    row={row}
                    pending={busy}
                    onSave={(values) => actions.policy(row.skuId, values)}
                  />
                  {row.sources.length > 0 ? (
                    <ForecastSources row={row} />
                  ) : (
                    <p className={styles.help}>
                      График и сравнение появятся после накопления истории.
                    </p>
                  )}
                </>
              ) : (
                <p className={styles.help}>
                  Добавьте тематики и свяжите их с товарами маркетплейсов.
                </p>
              )}
            </>
          )
        )}
      </section>
    </div>
  );
}
function ForecastProductSelect({
  rows,
  selected,
  onSelect,
}: {
  rows: ForecastRowDto[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <label className={`field ${styles.skuSelect}`}>
      Тематика
      <Select
        value={selected}
        onChange={(event) => onSelect(event.target.value)}
      >
        {rows.map((row) => (
          <option key={row.skuId} value={row.skuId}>
            {row.skuName}
          </option>
        ))}
      </Select>
    </label>
  );
}

function ForecastPreview({ rows }: { rows: ForecastRowDto[] }) {
  const [selected, setSelected] = useState("");
  const row = rows.find((item) => item.skuId === selected) ?? rows[0];
  if (!row) return null;
  return (
    <div className={styles.content}>
      <section aria-label="Демонстрационный прогноз продаж">
        <ForecastProductSelect
          rows={rows}
          selected={row.skuId}
          onSelect={setSelected}
        />
        <ForecastSources row={row} preview />
      </section>
    </div>
  );
}

export function ForecastingFeature({
  preview,
}: {
  preview?: ForecastRowDto[];
}) {
  const [open, setOpen] = useState(false);
  if (preview) {
    return (
      <section
        id="planning-forecast"
        className={`glass-panel ${styles.feature} ${styles.preview}`}
        aria-labelledby="planning-forecast-title"
      >
        <h2 id="planning-forecast-title">Графики прогноза</h2>
        <ForecastPreview rows={preview} />
      </section>
    );
  }
  return (
    <details
      className={`glass-panel ${styles.feature}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className={styles.summary}>
        <strong>Прогноз и история</strong>
        <ChevronDown size={18} aria-hidden="true" />
      </summary>
      {open && <ForecastContent />}
    </details>
  );
}
