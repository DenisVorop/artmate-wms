"use client";
import type { ReactNode } from "react";
import type {
  ShiftHistoryDto,
  WorkEventDto,
} from "@/shared/api/generated/model";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/shared/ui";
import { number } from "@/shared/lib/format";
import {
  formatWorkforceDuration,
  workEventTitle,
  workforceDateTime,
  workforceStatus,
} from "../lib/report-view";
import { useEmployeeHistory } from "../model/use-report-results";
import type { ReportFilterValues } from "../lib/report-filter";
import { HistoryPagination } from "./history-pagination";
import styles from "./workforce-report.module.css";

function ShiftItem({ shift }: { shift: ShiftHistoryDto }) {
  const observed = shift.origin === "observed_from_migration";
  return (
    <li className={styles.historyItem}>
      <div className={styles.historyTitle}>
        <strong>
          {workforceDateTime(shift.startedAt)} →{" "}
          {shift.endedAt ? workforceDateTime(shift.endedAt) : "Смена открыта"}
        </strong>
        <Badge tone={shift.endedAt ? "neutral" : "success"}>
          {shift.endedAt ? "Завершена" : "Открыта"}
        </Badge>
      </div>
      <div className={styles.historyMeta}>
        <span>
          В смене без перерывов:{" "}
          <b>{formatWorkforceDuration(shift.workingSeconds)}</b>
        </span>
        <span>
          Перерывы: <b>{formatWorkforceDuration(shift.breakSeconds)}</b>
        </span>
      </div>
      <p className={styles.historyNote}>
        {observed
          ? "Зафиксирована при включении учёта. Начало до границы истории неизвестно."
          : `Начало смены: ${shift.startedByName ?? "Автор не указан"}.`}
        {shift.endedAt
          ? ` Завершение: ${shift.endedByName ?? "Автор не указан"}.`
          : ""}
      </p>
      <details className={styles.intervals}>
        <summary>Отрезки смены · {shift.intervals.length}</summary>
        <ul>
          {shift.intervals.map((interval) => (
            <li key={interval.id}>
              {workforceStatus(interval.status)} ·{" "}
              {workforceDateTime(interval.startedAt)} →{" "}
              {interval.endedAt
                ? workforceDateTime(interval.endedAt)
                : "Продолжается"}{" "}
              · {formatWorkforceDuration(interval.durationSeconds)} в периоде.{" "}
              {interval.actorName
                ? `Изменение: ${interval.actorName}.`
                : "Автор не указан."}
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

function EventItem({ event }: { event: WorkEventDto }) {
  return (
    <li className={styles.historyItem}>
      <div className={styles.historyTitle}>
        <strong>{workEventTitle(event.kind)}</strong>
        <span>{workforceDateTime(event.occurredAt)}</span>
      </div>
      <div className={styles.historyMeta}>
        <span>
          Объект: <b>{event.referenceCode}</b>
        </span>
        <span>
          Операций: <b>{number(event.quantity)}</b>
        </span>
        {event.kind === "box_packed" && (
          <span className={styles.eventUnits}>
            В коробе: {number(event.units)} раскрасок
          </span>
        )}
      </div>
      {!event.shiftId && (
        <p className={styles.historyNote}>
          Событие сохранено без привязки к смене.
        </p>
      )}
    </li>
  );
}

function HistoryFrame({
  title,
  description,
  query,
  children,
  empty,
  page,
  onPage,
}: {
  title: string;
  description: string;
  query: {
    data?: { total: number; page: number; pageSize: number; items: unknown[] };
    isPlaceholderData: boolean;
    isPending: boolean;
    isError: boolean;
    isFetching: boolean;
    refetch: () => unknown;
  };
  children: ReactNode;
  empty: string;
  page: number;
  onPage: (page: number) => void;
}) {
  const result = query.isPlaceholderData ? undefined : query.data;
  return (
    <section
      className={`glass-panel ${styles.history}`}
      aria-label={title}
      aria-busy={query.isFetching}
    >
      <div className={styles.sectionHeading}>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {query.isFetching && result && <span role="status">Обновляем…</span>}
      </div>
      {query.isError && result && (
        <div role="alert" className={styles.readError}>
          <p>
            Не удалось обновить историю. Показана последняя загруженная версия
            за этот период.
          </p>
          <Button
            size="sm"
            variant="secondary"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Повторить
          </Button>
        </div>
      )}
      {query.isPending || query.isPlaceholderData ? (
        <LoadingState label="Загружаем историю…" />
      ) : !result ? (
        <ErrorState
          message="Не удалось загрузить историю. Период сохранён."
          onRetry={() => void query.refetch()}
        />
      ) : result.items.length ? (
        children
      ) : (
        <EmptyState
          title={result.total ? "На этой странице нет записей" : empty}
          description={
            result.total
              ? "Список изменился. Откройте первую страницу."
              : "За выбранные даты фактов не зафиксировано."
          }
          action={
            page > 1 ? (
              <Button variant="secondary" onClick={() => onPage(1)}>
                На первую страницу
              </Button>
            ) : undefined
          }
        />
      )}
      {result && (
        <HistoryPagination
          page={result.page}
          pageSize={result.pageSize}
          total={result.total}
          pending={query.isFetching}
          onPage={onPage}
          label={`Страницы: ${title.toLowerCase()}`}
        />
      )}
    </section>
  );
}

export function EmployeeHistory({
  values,
  employeeId,
  shiftPage,
  eventPage,
  onShiftPage,
  onEventPage,
}: {
  values: ReportFilterValues;
  employeeId: string;
  shiftPage: number;
  eventPage: number;
  onShiftPage: (page: number) => void;
  onEventPage: (page: number) => void;
}) {
  const { shifts, events } = useEmployeeHistory(
    values,
    employeeId,
    shiftPage,
    eventPage,
  );
  const shiftResult = shifts.isPlaceholderData ? undefined : shifts.data;
  const eventResult = events.isPlaceholderData ? undefined : events.data;
  return (
    <div className={styles.historyGrid}>
      <HistoryFrame
        title="История смен"
        description="Время учитывается только в пределах выбранного периода. Начало и конец смены показаны полностью, по Москве."
        query={shifts}
        empty="Смен за этот период нет"
        page={shiftPage}
        onPage={onShiftPage}
      >
        <ul className={styles.historyList}>
          {shiftResult?.items.map((shift) => (
            <ShiftItem key={shift.id} shift={shift} />
          ))}
        </ul>
      </HistoryFrame>
      <HistoryFrame
        title="Рабочие события"
        description="Упаковка и подтверждённые размещения. Сканы подготовки в выработку не входят."
        query={events}
        empty="Рабочих событий за этот период нет"
        page={eventPage}
        onPage={onEventPage}
      >
        <ul className={styles.historyList}>
          {eventResult?.items.map((event) => (
            <EventItem key={event.id} event={event} />
          ))}
        </ul>
      </HistoryFrame>
    </div>
  );
}
