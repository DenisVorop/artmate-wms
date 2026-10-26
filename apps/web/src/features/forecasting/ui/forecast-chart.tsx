"use client";
import { useId } from "react";
import type { ForecastSourceDto } from "@/entities/forecast";
import { forecastChart, shortDate } from "../lib/chart";
import styles from "./forecasting.module.css";
export function ForecastChart({ source }: { source: ForecastSourceDto }) {
  const id = useId(),
    chart = forecastChart(source.points);
  return (
    <figure className={styles.chart}>
      <figcaption>
        <span className={styles.legendActual}>Факт</span>
        <span className={styles.legendForecast}>Прогноз</span>
        <span>шт. в день</span>
      </figcaption>
      {chart.hasData ? (
        <svg
          viewBox={`0 0 ${chart.width} ${chart.height}`}
          role="img"
          aria-labelledby={id}
        >
          <title id={id}>
            {source.metricLabel}: фактические значения и прогноз по дням
          </title>
          <line
            x1="12"
            y1="188"
            x2="628"
            y2="188"
            className={styles.gridLine}
          />
          {chart.actual && (
            <path d={chart.actual} className={styles.actualLine} />
          )}{" "}
          {chart.predicted && (
            <path d={chart.predicted} className={styles.predictedLine} />
          )}
        </svg>
      ) : (
        <p className={styles.help}>График появится после загрузки истории.</p>
      )}
      <div className={styles.chartDates}>
        <span>{shortDate(source.points[0]?.date ?? null)}</span>
        <span>{shortDate(source.points.at(-1)?.date ?? null)}</span>
      </div>
    </figure>
  );
}
