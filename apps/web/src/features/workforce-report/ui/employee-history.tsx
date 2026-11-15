"use client";
import { useState, type ReactNode } from "react";
import type {
  GetPerformanceParams,
  ShiftHistoryDto,
  WorkEventDto,
} from "@/shared/api/generated/model";
import { Button, ErrorState, LoadingState, Modal } from "@/shared/ui";
import { number } from "@/shared/lib/format";
import {
  formatWorkforceDuration,
  workEventTitle,
  workforceDateTime,
  workforceStatus,
} from "../lib/report-view";
import { useEmployeeHistory } from "../model/use-employee-history";
import { HistoryPagination } from "./history-pagination";
import styles from "./workforce-report.module.css";

function ShiftDetails({
  shift,
  onClose,
}: {
  shift?: ShiftHistoryDto;
  onClose: () => void;
}) {
  return (
    <Modal
      open={!!shift}
      onClose={onClose}
      title={shift ? `Смена · ${shift.employeeName}` : "Смена"}
    >
      {shift && (
        <div className={styles.details}>
          <dl className={styles.shiftFacts}>
            <div>
              <dt>
                {shift.origin === "observed_from_migration"
                  ? "Учёт с"
                  : "Начало"}
              </dt>
              <dd>{workforceDateTime(shift.startedAt)}</dd>
            </div>
            <div>
              <dt>Открыл смену</dt>
              <dd>{shift.startedByName ?? "—"}</dd>
            </div>
            <div>
              <dt>Окончание</dt>
              <dd>{workforceDateTime(shift.endedAt)}</dd>
            </div>
            <div>
              <dt>Закрыл смену</dt>
              <dd>{shift.endedByName ?? "—"}</dd>
            </div>
          </dl>
          <div
            className={styles.tableScroll}
            role="region"
            aria-label="Периоды смены"
            tabIndex={0}
          >
            <table className={`${styles.table} ${styles.intervals}`}>
              <thead>
                <tr>
                  <th scope="col">Период</th>
                  <th scope="col">Начало</th>
                  <th scope="col">Окончание</th>
                  <th scope="col" className={styles.numeric}>
                    Время
                  </th>
                  <th scope="col">Кто изменил</th>
                </tr>
              </thead>
              <tbody>
                {shift.intervals.map((interval) => (
                  <tr key={interval.id}>
                    <th scope="row">{workforceStatus(interval.status)}</th>
                    <td>{workforceDateTime(interval.startedAt)}</td>
                    <td>
                      {interval.endedAt
                        ? workforceDateTime(interval.endedAt)
                        : "Продолжается"}
                    </td>
                    <td className={styles.numeric}>
                      {formatWorkforceDuration(interval.durationSeconds)}
                    </td>
                    <td>{interval.actorName ?? "—"}</td>
                  </tr>
                ))}
                {!shift.intervals.length && (
                  <tr>
                    <td className={styles.empty} colSpan={5}>
                      Нет записей за выбранные даты
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ShiftTable({ shifts }: { shifts: ShiftHistoryDto[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = shifts.find((shift) => shift.id === selectedId);

  return (
    <>
      <div
        className={styles.tableScroll}
        role="region"
        aria-label="Таблица смен"
        tabIndex={0}
      >
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Сотрудник</th>
              <th scope="col">Начало</th>
              <th scope="col">Окончание</th>
              <th scope="col" className={styles.numeric}>
                Без перерывов
              </th>
              <th scope="col" className={styles.numeric}>
                Перерывы
              </th>
            </tr>
          </thead>
          <tbody>
            {shifts.map((shift) => (
              <tr key={shift.id}>
                <th scope="row">{shift.employeeName}</th>
                <td>
                  <button
                    type="button"
                    className={styles.detailLink}
                    aria-haspopup="dialog"
                    aria-label={`Смена ${shift.employeeName} от ${workforceDateTime(shift.startedAt)}`}
                    onClick={() => setSelectedId(shift.id)}
                  >
                    {workforceDateTime(shift.startedAt)}
                  </button>
                  {shift.origin === "observed_from_migration" && (
                    <small>С начала учёта</small>
                  )}
                </td>
                <td>
                  {shift.endedAt ? workforceDateTime(shift.endedAt) : "Открыта"}
                </td>
                <td className={styles.numeric}>
                  {formatWorkforceDuration(shift.workingSeconds)}
                </td>
                <td className={styles.numeric}>
                  {formatWorkforceDuration(shift.breakSeconds)}
                </td>
              </tr>
            ))}
            {!shifts.length && (
              <tr>
                <td className={styles.empty} colSpan={5}>
                  Смен за выбранные даты нет
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <ShiftDetails shift={selected} onClose={() => setSelectedId(null)} />
    </>
  );
}

function EventTable({ events }: { events: WorkEventDto[] }) {
  return (
    <div
      className={styles.tableScroll}
      role="region"
      aria-label="Таблица операций"
      tabIndex={0}
    >
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Дата и время</th>
            <th scope="col">Сотрудник</th>
            <th scope="col">Операция</th>
            <th scope="col">Код</th>
            <th scope="col" className={styles.numeric}>
              Кол-во
            </th>
            <th scope="col" className={styles.numeric}>
              В коробе, шт.
            </th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td>{workforceDateTime(event.occurredAt)}</td>
              <th scope="row">{event.employeeName}</th>
              <td>
                {workEventTitle(event.kind)}
                {!event.shiftId && <small>Без привязки к смене</small>}
              </td>
              <td className={styles.code}>{event.referenceCode}</td>
              <td className={styles.numeric}>{number(event.quantity)}</td>
              <td className={styles.numeric}>
                {event.kind === "box_packed" ? number(event.units) : "—"}
              </td>
            </tr>
          ))}
          {!events.length && (
            <tr>
              <td className={styles.empty} colSpan={6}>
                Операций за выбранные даты нет
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

type HistoryQuery<T> = {
  data?: { total: number; page: number; pageSize: number; items: T[] };
  isPlaceholderData: boolean;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => unknown;
};

function HistoryPanel<T>({
  title,
  note,
  query,
  children,
  onPage,
}: {
  title: string;
  note: string;
  query: HistoryQuery<T>;
  children: (items: T[]) => ReactNode;
  onPage: (page: number) => void;
}) {
  const result = query.isPlaceholderData ? undefined : query.data;
  return (
    <section className={styles.panel} aria-label={title}>
      <div className={styles.sectionHeading}>
        <h2>{title}</h2>
        <span>{note}</span>
      </div>
      {query.isError && result && (
        <div role="alert" className={styles.readError}>
          <span>Не удалось обновить записи. Показаны последние данные.</span>
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
        <LoadingState label="Загружаем записи…" />
      ) : !result ? (
        <ErrorState
          message="Не удалось загрузить записи."
          onRetry={() => void query.refetch()}
        />
      ) : (
        <>
          {children(result.items)}
          <HistoryPagination
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
            pending={query.isFetching}
            onPage={onPage}
            label={`Страницы раздела «${title}»`}
          />
        </>
      )}
    </section>
  );
}

export function EmployeeHistory({
  params,
  shiftPage,
  eventPage,
  onShiftPage,
  onEventPage,
}: {
  params: GetPerformanceParams;
  shiftPage: number;
  eventPage: number;
  onShiftPage: (page: number) => void;
  onEventPage: (page: number) => void;
}) {
  const { shifts, events } = useEmployeeHistory(params, shiftPage, eventPage);
  return (
    <>
      <HistoryPanel
        title="Смены"
        note="МСК · длительность за выбранные даты"
        query={shifts}
        onPage={onShiftPage}
      >
        {(items) => <ShiftTable shifts={items} />}
      </HistoryPanel>
      <HistoryPanel
        title="Операции"
        note="МСК"
        query={events}
        onPage={onEventPage}
      >
        {(items) => <EventTable events={items} />}
      </HistoryPanel>
    </>
  );
}
