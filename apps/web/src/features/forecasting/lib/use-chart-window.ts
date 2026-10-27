"use client";
import { useState } from "react";
import type { ForecastSourceDto } from "@/entities/forecast";
import {
  chartRangeBounds,
  isValidChartRange,
  presetChartRange,
  type ChartPeriod,
  type ChartRange,
} from "./chart-period";

/** Display-only state: never changes planning settings or triggers an import. */
export function useChartWindow(sources: ForecastSourceDto[]) {
  const [period, setPeriod] = useState<ChartPeriod>("month"),
    [custom, setCustom] = useState<ChartRange>({ from: "", to: "" });
  const bounds = chartRangeBounds(sources),
    range = period === "custom" ? custom : presetChartRange(sources, period),
    valid =
      isValidChartRange(range) &&
      range.from >= bounds.first &&
      range.to <= bounds.last;
  return {
    period,
    range,
    bounds,
    valid,
    selectPeriod(next: ChartPeriod) {
      if (next === "custom" && period !== "custom") setCustom(range);
      setPeriod(next);
    },
    changeDate(field: keyof ChartRange, value: string) {
      setCustom({ ...range, [field]: value });
      setPeriod("custom");
    },
  };
}
