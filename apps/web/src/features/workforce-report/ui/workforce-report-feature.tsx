"use client";
import { ClipboardClock, RefreshCw } from "lucide-react";
import { useSession } from "@/entities/session";
import { useWorkspace } from "@/entities/workspace";
import { Button, EmptyState, ErrorState, LoadingState } from "@/shared/ui";
import { number } from "@/shared/lib/format";
import { useReportState } from "../lib/use-report-state";
import { useReportResults } from "../model/use-report-results";
import {
  hasWorkforceFacts,
  workforceDate,
  workforceDateTime,
  workforceTotals,
  workforceCoverage,
} from "../lib/report-view";
import { ReportFilters } from "./report-filters";
import { ReportMetrics } from "./report-metrics";
import { EmployeeTable } from "./employee-table";
import { CurrentEmployee } from "./current-employee";
import { EmployeeHistory } from "./employee-history";
import styles from "./workforce-report.module.css";

export function WorkforceReportFeature({
  initialEmployeeId,
}: {
  initialEmployeeId?: string;
}) {
  const { user, isManager } = useSession();
  const workspace = useWorkspace();
  const ui = useReportState(
    isManager,
    user?.employeeId ?? "",
    initialEmployeeId,
  );
  const query = useReportResults(ui.filters, isManager, user?.employeeId ?? "");
  const result = query.isPlaceholderData ? undefined : query.data;
  const totals = result ? workforceTotals(result.employees) : undefined;
  const coverage = result
    ? workforceCoverage(result.from, result.to, result.trackingSince)
    : undefined;
  const selected =
    result?.employees.find(
      (employee) => employee.employeeId === ui.selectedEmployeeId,
    ) ?? result?.employees[0];
  return (
    <div className={styles.feature}>
      <header className="page-header">
        <div>
          <p className="eyebrow">КОМАНДА · ФАКТЫ РАБОТЫ</p>
          <h1 className="page-heading">Смены и выработка</h1>
          <p className="page-description">
            Упакованные короба, подтверждённые размещения и время в смене.
          </p>
        </div>
        <div className={styles.headerActions}>
          <Button
            size="sm"
            variant="secondary"
            disabled={query.isFetching}
            aria-busy={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw size={14} />
            Обновить отчёт
          </Button>
        </div>
      </header>
      <ReportFilters
        values={ui.filters}
        employees={workspace.data?.employees ?? []}
        isManager={isManager}
        onApply={ui.apply}
      />
      {workspace.isError && isManager && (
        <div className={`glass-panel ${styles.readError}`} role="alert">
          <p>
            Не удалось обновить список сотрудников. Даты и выбранный сотрудник
            сохранены.
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void workspace.refetch()}
          >
            Обновить список
          </Button>
        </div>
      )}
      {query.isError && result && (
        <div className={`glass-panel ${styles.readError}`} role="alert">
          <p>
            Не удалось обновить отчёт. Показана последняя загруженная версия за
            выбранный период.
          </p>
          <Button
            size="sm"
            variant="secondary"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Повторить загрузку
          </Button>
        </div>
      )}
      {query.isPending || query.isPlaceholderData ? (
        <div className={`glass-panel ${styles.loadingFrame}`}>
          <LoadingState label="Загружаем результаты за выбранный период…" />
        </div>
      ) : !result ? (
        <div className="glass-panel">
          <ErrorState
            message="Не удалось загрузить отчёт. Фильтры сохранены: измените их или повторите загрузку."
            onRetry={() => void query.refetch()}
          />
        </div>
      ) : (
        <>
          <section
            className={`glass-panel ${styles.boundary}`}
            aria-label="Начало учёта смен и выработки"
          >
            <ClipboardClock size={18} />
            <div>
              <p>
                <strong>
                  Учёт ведётся с {workforceDateTime(result.trackingSince)} по
                  Москве.
                </strong>{" "}
                Прежние смены и рабочие события не восстановлены; накопительные
                счётчики до начала учёта в этот отчёт не входят.
              </p>
              {coverage === "before" && (
                <p>
                  <strong>Выбранный период целиком до начала учёта.</strong> За
                  эти даты история недоступна; нули в отчёте не отражают
                  фактическую выработку.
                </p>
              )}
              {coverage === "partial" && (
                <p>
                  <strong>Период частично до начала учёта.</strong> Показаны
                  только факты с момента включения учёта, без восстановления
                  предыдущего времени.
                </p>
              )}
            </div>
          </section>
          <div
            className={styles.sectionHeading}
            style={{ padding: "0", border: "0" }}
          >
            <div>
              <h2>
                {workforceDate(result.from)} — {workforceDate(result.to)}
              </h2>
              <p>
                {isManager && !ui.filters.employeeId
                  ? "Все сотрудники · итоги за выбранный период"
                  : "Выбранный сотрудник · итоги за период"}
              </p>
            </div>
            <span>
              {query.isFetching
                ? "Обновляем…"
                : `Данные на ${workforceDateTime(result.generatedAt)}`}
            </span>
          </div>
          {totals && <ReportMetrics metrics={totals} />}
          {!result.employees.length ? (
            <div className="glass-panel">
              <EmptyState
                title="Сотрудники не найдены"
                description="По выбранному сотруднику нет доступных данных. Выберите другого сотрудника или всех сотрудников."
              />
            </div>
          ) : (
            <>
              <section
                className={`glass-panel ${styles.results}`}
                aria-label="Результаты сотрудников"
              >
                <div className={styles.sectionHeading}>
                  <div>
                    <h2>{isManager ? "По сотрудникам" : "Мой результат"}</h2>
                    <p>
                      Выберите имя, чтобы посмотреть смены и рабочие события.
                    </p>
                  </div>
                  <span>{number(result.employees.length)} в отчёте</span>
                </div>
                <EmployeeTable
                  employees={result.employees}
                  selectedId={selected?.employeeId ?? ""}
                  onSelect={ui.selectEmployee}
                />
                {totals && !hasWorkforceFacts(totals) && (
                  <p className={styles.zero}>
                    {coverage === "before"
                      ? "История за выбранные даты недоступна: период предшествует началу учёта."
                      : "За выбранный период ещё нет учтённых смен или завершённых рабочих операций. Нулевые значения не означают отсутствие работы до начала учёта."}
                  </p>
                )}
              </section>
              {selected && (
                <section
                  id="workforce-employee-detail"
                  className={`glass-panel ${styles.detail}`}
                  aria-label={`Подробности сотрудника: ${selected.employeeName}`}
                >
                  <div className={styles.sectionHeading}>
                    <div>
                      <h2>{selected.employeeName}</h2>
                      <p>Текущее состояние и история за выбранный период</p>
                    </div>
                  </div>
                  <CurrentEmployee employee={selected} />
                </section>
              )}
              {selected && (
                <EmployeeHistory
                  key={selected.employeeId}
                  values={ui.filters}
                  employeeId={selected.employeeId}
                  shiftPage={ui.shiftPage}
                  eventPage={ui.eventPage}
                  onShiftPage={ui.setShiftPage}
                  onEventPage={ui.setEventPage}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
