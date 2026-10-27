"use client";
import { useId } from "react";
import type { ForecastSourceDto } from "@/entities/forecast";
import { chartTotals, forecastChart, shortDate } from "../lib/chart";
import { filterChartPoints, type ChartRange } from "../lib/chart-period";
import { useChartInspection } from "../lib/use-chart-inspection";
import styles from "./forecasting.module.css";
const quantity = (value: number, digits = 0) =>
  value.toLocaleString("ru-RU", { maximumFractionDigits: digits });
export function ForecastChart({
  source,
  range,
}: {
  source: ForecastSourceDto;
  range: ChartRange;
}) {
  const id = useId(),
    points = filterChartPoints(source.points, range),
    chart = forecastChart(points, range),
    totals = chartTotals(points),
    actualPoints = chart.points.filter((point) => point.actualY !== null),
    predictedPoints = chart.points.filter((point) => point.predictedY !== null),
    inspection = useChartInspection(chart),
    point = inspection.point;
  const pointDescription = point
    ? `${shortDate(point.date)}. Факт: ${point.actual === null ? "нет данных" : `${quantity(point.actual, 2)} шт.`}. Прогноз: ${point.predicted === null ? "нет данных" : `около ${quantity(point.predicted, 2)} шт.`}.`
    : "";
  return (
    <figure className={styles.chart}>
      <div className={styles.chartTotals}>
        <span>
          <small>Факт · {totals.actualDays} дн.</small>
          <strong>
            {totals.actual === null
              ? "Нет данных"
              : `${quantity(totals.actual)} шт.`}
          </strong>
        </span>
        <span className={styles.forecastTotal}>
          <small>Прогноз · {totals.predictedDays} дн.</small>
          <strong>
            {totals.predicted === null
              ? "Нет данных"
              : `≈ ${quantity(totals.predicted)} шт.`}
          </strong>
        </span>
      </div>
      <figcaption>
        <span className={styles.legendActual}>Факт</span>
        <span className={styles.legendForecast}>Прогноз</span>
        <span>шт. в день</span>
      </figcaption>
      {chart.hasData ? (
        <div className={styles.chartGrid}>
          <div className={styles.chartYAxis} aria-hidden="true">
            {chart.ticks.map((tick, index) => (
              <span
                key={index}
                style={{ top: `${(tick.y / chart.height) * 100}%` }}
              >
                {quantity(tick.value, 1)}
              </span>
            ))}
          </div>
          <div className={styles.chartPlot}>
            <svg
              viewBox={`0 0 ${chart.width} ${chart.height}`}
              preserveAspectRatio="none"
              role="group"
              tabIndex={0}
              aria-labelledby={`${id}-title`}
              aria-describedby={`${id}-instructions`}
              aria-roledescription="интерактивный график"
              {...inspection.handlers}
            >
              <title id={`${id}-title`}>
                {source.provider === "ozon" ? "Ozon" : "Wildberries"}:{" "}
                {source.metricLabel}, факт и прогноз по дням
              </title>
              {chart.forecastStartX !== null && (
                <rect
                  x={chart.forecastStartX}
                  y={chart.pad}
                  width={Math.max(
                    0,
                    chart.width - chart.pad - chart.forecastStartX,
                  )}
                  height={chart.height - chart.pad * 2}
                  className={styles.forecastArea}
                />
              )}
              {chart.ticks.map((tick, index) => (
                <line
                  key={index}
                  x1={chart.pad}
                  y1={tick.y}
                  x2={chart.width - chart.pad}
                  y2={tick.y}
                  className={styles.gridLine}
                />
              ))}
              {chart.forecastStartX !== null && (
                <line
                  x1={chart.forecastStartX}
                  y1={chart.pad}
                  x2={chart.forecastStartX}
                  y2={chart.height - chart.pad}
                  className={styles.forecastBoundary}
                />
              )}
              {chart.actual && (
                <path d={chart.actual} className={styles.actualLine} />
              )}
              {chart.predicted && (
                <path d={chart.predicted} className={styles.predictedLine} />
              )}
              {point && (
                <>
                  <line
                    x1={point.x}
                    x2={point.x}
                    y1={chart.pad}
                    y2={chart.height - chart.pad}
                    className={styles.chartCrosshair}
                  />
                </>
              )}
            </svg>
            {actualPoints.length === 1 && (
              <span
                aria-hidden="true"
                className={styles.actualPoint}
                style={{
                  left: `${(actualPoints[0].x / chart.width) * 100}%`,
                  top: `${(actualPoints[0].actualY! / chart.height) * 100}%`,
                }}
              />
            )}
            {predictedPoints.length === 1 && (
              <span
                aria-hidden="true"
                className={styles.forecastPoint}
                style={{
                  left: `${(predictedPoints[0].x / chart.width) * 100}%`,
                  top: `${(predictedPoints[0].predictedY! / chart.height) * 100}%`,
                }}
              />
            )}
            {point?.actualY != null && (
              <span
                aria-hidden="true"
                className={styles.actualPoint}
                style={{
                  left: `${(point.x / chart.width) * 100}%`,
                  top: `${(point.actualY / chart.height) * 100}%`,
                }}
              />
            )}
            {point?.predictedY != null && (
              <span
                aria-hidden="true"
                className={styles.forecastPoint}
                style={{
                  left: `${(point.x / chart.width) * 100}%`,
                  top: `${(point.predictedY / chart.height) * 100}%`,
                }}
              />
            )}
            {point && (
              <div
                className={styles.chartTooltip}
                role="tooltip"
                style={point.x > chart.width / 2 ? { left: 8 } : { right: 8 }}
              >
                <strong>{shortDate(point.date)}</strong>
                <span>
                  <span>Факт</span>
                  <b>
                    {point.actual === null
                      ? "Нет данных"
                      : `${quantity(point.actual, 2)} шт.`}
                  </b>
                </span>
                <span>
                  <span>Прогноз</span>
                  <b className={styles.forecastTotal}>
                    {point.predicted === null
                      ? "Нет данных"
                      : `≈ ${quantity(point.predicted, 2)} шт.`}
                  </b>
                </span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <p className={styles.chartEmpty}>В этом периоде нет данных.</p>
      )}
      <div className={styles.chartDates}>
        <span>{shortDate(range.from || null)}</span>
        <span>{shortDate(range.to || null)}</span>
      </div>
      {totals.flatForecast && (
        <p className={styles.chartNote}>
          Одинаковая оценка по дням: ≈ {quantity(totals.dailyForecast!, 2)} шт.
        </p>
      )}
      <span id={`${id}-instructions`} className={styles.srOnly}>
        Наведите указатель или коснитесь графика. С клавиатуры: стрелки влево и
        вправо выбирают день, Home и End — границы, Escape скрывает подсказку.
      </span>
      <span className={styles.srOnly} aria-live="polite">
        {inspection.keyboard ? pointDescription : ""}
      </span>
    </figure>
  );
}
