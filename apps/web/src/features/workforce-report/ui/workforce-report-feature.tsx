"use client";
import { useSession } from "@/entities/session";
import { useWorkspace } from "@/entities/workspace";
import { useWorkforceReport } from "@/entities/workforce";
import { Button, ErrorState, LoadingState } from "@/shared/ui";
import { useReportState } from "../lib/use-report-state";
import { reportQuery } from "../lib/report-filter";
import {
  workforceDate,
  workforceDateTime,
  workforceCoverage,
} from "../lib/report-view";
import { ReportFilters } from "./report-filters";
import { EmployeeTable } from "./employee-table";
import { EmployeeHistory } from "./employee-history";
import styles from "./workforce-report.module.css";

export function WorkforceReportFeature({
  initialEmployeeId,
}: {
  initialEmployeeId?: string;
}) {
  const { user, isManager } = useSession();
  const workspace = useWorkspace();
  const ownEmployeeId = user?.employeeId ?? "";
  const ui = useReportState(isManager, ownEmployeeId, initialEmployeeId);
  const params = reportQuery(ui.filters, isManager, ownEmployeeId);
  const query = useWorkforceReport(params, isManager || !!ownEmployeeId);
  const result = query.isPlaceholderData ? undefined : query.data;
  const coverage =
    result && workforceCoverage(result.from, result.to, result.trackingSince);

  return (
    <div className={styles.feature}>
      <header className="page-header">
        <h1 className="page-heading">Смены и выработка</h1>
      </header>
      <ReportFilters
        values={ui.filters}
        employees={workspace.data?.employees ?? []}
        isManager={isManager}
        onApply={ui.apply}
      />
      {workspace.isError && isManager && (
        <div className={styles.readError} role="alert">
          <span>Не удалось обновить список сотрудников.</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void workspace.refetch()}
          >
            Повторить
          </Button>
        </div>
      )}
      {query.isError && result && (
        <div className={styles.readError} role="alert">
          <span>Не удалось обновить отчёт. Показаны последние данные.</span>
          <Button
            variant="secondary"
            size="sm"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Повторить
          </Button>
        </div>
      )}
      {query.isPending || query.isPlaceholderData ? (
        <LoadingState label="Загружаем отчёт…" />
      ) : !result ? (
        <ErrorState
          message="Не удалось загрузить отчёт."
          onRetry={() => void query.refetch()}
        />
      ) : coverage === "before" ? (
        <p className={styles.notice}>
          За этот период данных нет. Учёт начался{" "}
          {workforceDateTime(result.trackingSince)} (МСК).
        </p>
      ) : (
        <>
          {coverage === "partial" && (
            <p className={styles.notice}>
              Учёт за этот период начинается{" "}
              {workforceDateTime(result.trackingSince)} (МСК).
            </p>
          )}
          <EmployeeTable
            employees={result.employees}
            period={
              result.from === result.to
                ? workforceDate(result.from)
                : `${workforceDate(result.from)} — ${workforceDate(result.to)}`
            }
          />
          <EmployeeHistory
            params={params}
            shiftPage={ui.shiftPage}
            eventPage={ui.eventPage}
            onShiftPage={ui.setShiftPage}
            onEventPage={ui.setEventPage}
          />
        </>
      )}
    </div>
  );
}
