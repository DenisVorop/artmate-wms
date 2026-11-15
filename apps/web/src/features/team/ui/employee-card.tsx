"use client";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type {
  EmployeeDto,
  EmployeePerformanceDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";
import { Badge, Button } from "@/shared/ui";
import { number } from "@/shared/lib/format";
import {
  shiftStopBlocker,
  shiftStopImpact,
  shiftDuration,
} from "../lib/shift-impact";
import styles from "./team.module.css";
const timestamp = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
const jobRoute = (kind: string, id: string) =>
  kind === "assembly"
    ? "/assembly"
    : kind === "putaway"
      ? "/putaway"
      : kind === "stocktake"
        ? `/stocktakes?stocktakeId=${encodeURIComponent(id)}`
        : "/movements";
const jobLabel = (kind: string, status: string) => {
  const task =
    kind === "assembly"
      ? "Сборка"
      : kind === "putaway"
        ? "Размещение"
        : kind === "stocktake"
          ? "Инвентаризация"
          : "Перемещение";
  const state =
    status === "paused"
      ? "на паузе"
      : status === "planned"
        ? "ожидает забора"
        : status === "claimed"
          ? "задание взято"
          : status === "in_transit"
            ? "в пути"
            : "в работе";
  return `${task} · ${state}`;
};
export const shiftLabels = {
  working: "На смене",
  break: "Перерыв",
  off: "Вне смены",
} satisfies Record<EmployeeDto["status"], string>;

export function ShiftStatus({ status }: { status: EmployeeDto["status"] }) {
  const tone =
    status === "working"
      ? "success"
      : status === "break"
        ? "warning"
        : "neutral";
  return <Badge tone={tone}>{shiftLabels[status]}</Badge>;
}

export function EmployeeDetails({
  employee,
  performance,
  metricDay,
  data,
  pending,
  error,
  onShift,
}: {
  employee: EmployeeDto;
  performance?: EmployeePerformanceDto;
  metricDay?: string;
  data: WorkspaceDto;
  pending: boolean;
  error: string | null;
  onShift: (status: "working" | "break" | "off") => void;
}) {
  const blocker = shiftStopBlocker(data, employee.id);
  const impact = shiftStopImpact(data, employee.id);
  const shift = performance?.currentShift;
  const metrics = performance?.metrics;
  const metricsDate =
    metricDay &&
    new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
    }).format(new Date(`${metricDay}T00:00:00Z`));

  return (
    <>
      <section className={styles.detailSection} aria-label="Смена">
        <div className={styles.shiftHeader}>
          {employee.role && <span>{employee.role}</span>}
          <ShiftStatus status={employee.status} />
        </div>
        {shift && (
          <div className={styles.shiftTime}>
            <p>
              {shift.origin === "observed_from_migration"
                ? "Учёт смены с "
                : "Смена с "}
              {timestamp(shift.startedAt)}
              {shift.status === "break" && (
                <> · перерыв с {timestamp(shift.periodStartedAt)}</>
              )}
            </p>
            <p>
              Без перерывов {shiftDuration(shift.workingSeconds)} · перерывы{" "}
              {shiftDuration(shift.breakSeconds)}
            </p>
          </div>
        )}
        {employee.status !== "off" && (blocker || impact) && (
          <p className={blocker ? styles.blocker : styles.muted}>
            {blocker || impact}
          </p>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.shiftActions}>
          {employee.status !== "working" && (
            <Button
              size="sm"
              onClick={() => onShift("working")}
              disabled={pending}
            >
              {employee.status === "break"
                ? "Продолжить смену"
                : "Начать смену"}
            </Button>
          )}
          {employee.status === "working" && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onShift("break")}
              disabled={pending || !!blocker}
            >
              Перерыв
            </Button>
          )}
          {employee.status !== "off" && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onShift("off")}
              disabled={pending || !!blocker}
            >
              Завершить смену
            </Button>
          )}
        </div>
      </section>
      {!!performance?.currentJobs.length && (
        <section className={styles.detailSection} aria-label="Текущие задания">
          <h3>Текущие задания</h3>
          <ul className={styles.jobs}>
            {performance.currentJobs.map((job) => (
              <li key={`${job.kind}/${job.id}`}>
                <Link href={jobRoute(job.kind, job.id)}>
                  {job.code}
                  <ArrowUpRight size={12} aria-hidden="true" />
                </Link>
                <span>
                  {jobLabel(job.kind, job.status)} · {job.description}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className={styles.detailSection} aria-label="Выработка">
        {metrics && (
          <>
            <h3>Выработка{metricsDate && ` за ${metricsDate}`}</h3>
            <dl className={styles.metrics}>
              <div>
                <dt>Коробов собрано</dt>
                <dd>{number(metrics.boxesPacked)}</dd>
              </div>
              <div>
                <dt>Товаров упаковано</dt>
                <dd>{number(metrics.unitsPacked)}</dd>
              </div>
              <div>
                <dt>Паллет принято</dt>
                <dd>{number(metrics.receiptPalletsPlaced)}</dd>
              </div>
              <div>
                <dt>Коробов размещено</dt>
                <dd>{number(metrics.putawayBoxesPlaced)}</dd>
              </div>
              <div>
                <dt>Паллет перемещено</dt>
                <dd>{number(metrics.movementPalletsPlaced)}</dd>
              </div>
            </dl>
          </>
        )}
        <Link
          className={styles.historyLink}
          href={`/performance?employeeId=${encodeURIComponent(employee.id)}`}
        >
          История смен и выработка
          <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
      </section>
    </>
  );
}
