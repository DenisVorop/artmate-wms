"use client";
import Link from "next/link";
import { Play, Pause, LogOut, ArrowUpRight, Clock3 } from "lucide-react";
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
const jobRoute = (kind: string) =>
  kind === "assembly"
    ? "/assembly"
    : kind === "putaway"
      ? "/putaway"
      : "/movements";
const jobLabel = (kind: string, status: string) => {
  const task =
    kind === "assembly"
      ? "Сборка"
      : kind === "putaway"
        ? "Размещение"
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
export function EmployeeCard({
  employee: e,
  performance,
  metricDay,
  data,
  pending,
  created,
  onShift,
}: {
  employee: EmployeeDto;
  performance?: EmployeePerformanceDto;
  metricDay?: string;
  data: WorkspaceDto;
  pending: boolean;
  created: boolean;
  onShift: (id: string, status: "working" | "break" | "off") => void;
}) {
  const blocker = shiftStopBlocker(data, e.id);
  const impact = shiftStopImpact(data, e.id);
  const shift = performance?.currentShift;
  const metrics = performance?.metrics;
  return (
    <article
      className={`glass-panel ops-panel ${created ? styles.created : ""}`}
    >
      <div className="ops-team-head">
        <div className="ops-avatar">{e.initials}</div>
        <div className={styles.person}>
          <h2>{e.name}</h2>
          <span className="ops-description">{e.role}</span>
        </div>
        <Badge
          tone={
            e.status === "working"
              ? "success"
              : e.status === "break"
                ? "warning"
                : "neutral"
          }
        >
          {e.status === "working"
            ? "На смене"
            : e.status === "break"
              ? "Перерыв"
              : "Вне смены"}
        </Badge>
      </div>
      {shift && (
        <div className={styles.shiftTime}>
          <Clock3 size={14} />
          <span>
            {shift.origin === "observed_from_migration"
              ? "Учёт смены с "
              : "Смена с "}
            {timestamp(shift.startedAt)}
            {shift.status === "break" && (
              <> · перерыв с {timestamp(shift.periodStartedAt)}</>
            )}
          </span>
          <span>
            Без перерывов {shiftDuration(shift.workingSeconds)} · перерывы{" "}
            {shiftDuration(shift.breakSeconds)}
          </span>
        </div>
      )}
      <div className={styles.currentWork}>
        <span className="ops-description">Сейчас</span>
        {performance ? (
          performance.currentJobs.length ? (
            <ul className={styles.jobs}>
              {performance.currentJobs.map((job) => (
                <li key={`${job.kind}/${job.id}`}>
                  <Link href={jobRoute(job.kind)}>
                    {job.code}
                    <ArrowUpRight size={12} />
                  </Link>
                  <span>
                    {jobLabel(job.kind, job.status)} · {job.description}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="ops-description">Нет текущих заданий</span>
          )
        ) : (
          <span className="ops-description">Занятость загружается…</span>
        )}
      </div>
      <p className={styles.metricPeriod}>
        {metricDay
          ? `Работа за ${new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow" }).format(new Date(`${metricDay}T00:00:00Z`))} · МСК`
          : "Показатели загружаются…"}
      </p>
      <div className="ops-team-stat">
        <div>
          <strong>{metrics ? number(metrics.boxesPacked) : "—"}</strong>
          <span>коробов закрыто</span>
        </div>
        <div>
          <strong>{metrics ? number(metrics.unitsPacked) : "—"}</strong>
          <span>раскрасок в них</span>
        </div>
      </div>
      <dl className={styles.placementMetrics}>
        <div>
          <dt>Паллет принято</dt>
          <dd>{metrics ? number(metrics.receiptPalletsPlaced) : "—"}</dd>
        </div>
        <div>
          <dt>Коробов размещено</dt>
          <dd>{metrics ? number(metrics.putawayBoxesPlaced) : "—"}</dd>
        </div>
        <div>
          <dt>Паллет перемещено</dt>
          <dd>{metrics ? number(metrics.movementPalletsPlaced) : "—"}</dd>
        </div>
      </dl>
      {e.status !== "off" && (blocker || impact) && (
        <p className={blocker ? styles.blocker : styles.impact}>
          {blocker || impact}
        </p>
      )}
      <div className="ops-action-row">
        {e.status !== "working" && (
          <Button
            size="sm"
            onClick={() => onShift(e.id, "working")}
            disabled={pending}
          >
            <Play size={14} />
            {e.status === "break" ? "Продолжить смену" : "Начать смену"}
          </Button>
        )}
        {e.status === "working" && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onShift(e.id, "break")}
            disabled={pending || !!blocker}
          >
            <Pause size={14} />
            Перерыв
          </Button>
        )}
        {e.status !== "off" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onShift(e.id, "off")}
            disabled={pending || !!blocker}
          >
            <LogOut size={14} />
            Завершить смену
          </Button>
        )}
      </div>
      <Link
        className={styles.historyLink}
        href={`/performance?employeeId=${encodeURIComponent(e.id)}`}
      >
        История смен и выработка
        <ArrowUpRight size={14} />
      </Link>
    </article>
  );
}
