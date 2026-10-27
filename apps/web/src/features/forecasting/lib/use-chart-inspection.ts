"use client";
import { useState, type KeyboardEvent, type PointerEvent } from "react";
import type { forecastChart } from "./chart";

type Geometry = ReturnType<typeof forecastChart>;
/** A date, rather than an array index, prevents a stale tooltip after range changes. */
export function useChartInspection(chart: Geometry) {
  const [activeDate, setActiveDate] = useState<string | null>(null),
    [keyboard, setKeyboard] = useState(false);
  const point = chart.points.find((point) => point.date === activeDate);
  function inspectPointer(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !chart.points.length) return;
    const x = ((event.clientX - rect.left) / rect.width) * chart.width;
    const nearest = chart.points.reduce((nearest, point) =>
      Math.abs(point.x - x) < Math.abs(nearest.x - x) ? point : nearest,
    );
    setKeyboard(false);
    setActiveDate(nearest.date);
  }
  return {
    point,
    keyboard,
    handlers: {
      onPointerMove: inspectPointer,
      onPointerDown(event: PointerEvent<SVGSVGElement>) {
        event.currentTarget.focus();
        inspectPointer(event);
      },
      onPointerLeave(event: PointerEvent<SVGSVGElement>) {
        if (event.pointerType !== "touch") setActiveDate(null);
      },
      onFocus() {
        setKeyboard(true);
        const latestActual = chart.points.findLast(
          (point) => point.actual !== null,
        );
        setActiveDate(latestActual?.date ?? chart.points[0]?.date ?? null);
      },
      onBlur() {
        setActiveDate(null);
        setKeyboard(false);
      },
      onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
        if (event.key === "Escape") {
          setActiveDate(null);
          return;
        }
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        if (!chart.points.length) return;
        const current = Math.max(
            0,
            chart.points.findIndex((point) => point.date === activeDate),
          ),
          next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? chart.points.length - 1
                : Math.max(
                    0,
                    Math.min(
                      chart.points.length - 1,
                      current + (event.key === "ArrowRight" ? 1 : -1),
                    ),
                  );
        setKeyboard(true);
        setActiveDate(chart.points[next].date);
      },
    },
  };
}
