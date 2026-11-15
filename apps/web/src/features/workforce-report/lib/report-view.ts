import { moscowDay } from "@/entities/workforce";
import type {
  EmployeePerformanceDto,
  PerformanceMetricsDto,
} from "@/shared/api/generated/model";

export function formatWorkforceDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds > 0 && seconds < 60) return "<1 мин";
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours} ч${rest ? ` ${rest} мин` : ""}` : `${minutes} мин`;
}

export function workforceDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function workforceDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value.length === 10 ? `${value}T00:00:00+03:00` : value));
}

export function workforceStatus(status: string): string {
  return (
    (
      {
        working: "В смене",
        break: "На перерыве",
        off: "Вне смены",
        closed: "Завершена",
        open: "Открыта",
        active: "В работе",
        in_progress: "В работе",
        planned: "Запланировано",
        counting: "Подсчёт",
        pending: "Ожидает",
        queued: "В очереди",
        assigned: "Назначено",
        claimed: "Взято",
        in_transit: "В пути",
        paused: "Приостановлено",
        completed: "Завершено",
        cancelled: "Отменено",
      } as Record<string, string>
    )[status] ?? status
  );
}

export function workEventTitle(kind: string): string {
  return (
    (
      {
        box_packed: "Упакован короб",
        receipt_pallet_placed: "Размещена входящая паллета",
        putaway_box_placed: "Размещён готовый короб",
        movement_pallet_placed: "Перемещена паллета",
      } as Record<string, string>
    )[kind] ?? "Рабочая операция"
  );
}

export function workforcePages(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
export function workforceTotals(
  employees: EmployeePerformanceDto[],
): PerformanceMetricsDto {
  return employees.reduce(
    (total, employee) => ({
      boxesPacked: total.boxesPacked + employee.metrics.boxesPacked,
      unitsPacked: total.unitsPacked + employee.metrics.unitsPacked,
      receiptPalletsPlaced:
        total.receiptPalletsPlaced + employee.metrics.receiptPalletsPlaced,
      putawayBoxesPlaced:
        total.putawayBoxesPlaced + employee.metrics.putawayBoxesPlaced,
      movementPalletsPlaced:
        total.movementPalletsPlaced + employee.metrics.movementPalletsPlaced,
      workingSeconds: total.workingSeconds + employee.metrics.workingSeconds,
      breakSeconds: total.breakSeconds + employee.metrics.breakSeconds,
    }),
    {
      boxesPacked: 0,
      unitsPacked: 0,
      receiptPalletsPlaced: 0,
      putawayBoxesPlaced: 0,
      movementPalletsPlaced: 0,
      workingSeconds: 0,
      breakSeconds: 0,
    },
  );
}

export function workforceCoverage(
  from: string,
  to: string,
  trackingSince: string,
): "before" | "partial" | "covered" {
  const startDay = moscowDay(new Date(trackingSince));
  if (to < startDay) return "before";
  return from <= startDay &&
    new Date(trackingSince).getTime() >
      new Date(`${from}T00:00:00+03:00`).getTime()
    ? "partial"
    : "covered";
}
