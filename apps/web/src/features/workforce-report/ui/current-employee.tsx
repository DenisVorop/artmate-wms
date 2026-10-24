import Link from "next/link";
import type { EmployeePerformanceDto } from "@/shared/api/generated/model";
import { Badge } from "@/shared/ui";
import {
  formatWorkforceDuration,
  workJobTitle,
  workforceDateTime,
  workforceStatus,
} from "../lib/report-view";
import styles from "./workforce-report.module.css";

export function CurrentEmployee({
  employee,
}: {
  employee: EmployeePerformanceDto;
}) {
  const shift = employee.currentShift;
  return (
    <section
      className={styles.current}
      aria-label={`Сейчас: ${employee.employeeName}`}
    >
      <div className={styles.currentHeader}>
        <h3>
          <span className={styles.liveDot} />
          Сейчас
        </h3>
        <Badge
          tone={
            employee.status === "working"
              ? "success"
              : employee.status === "break"
                ? "warning"
                : "neutral"
          }
        >
          {workforceStatus(employee.status)}
        </Badge>
      </div>
      {shift ? (
        <>
          <div className={styles.currentGrid}>
            <div className={styles.currentValue}>
              <span>Текущая смена начата</span>
              <strong>{workforceDateTime(shift.startedAt)}</strong>
            </div>
            <div className={styles.currentValue}>
              <span>В смене без перерывов · вся смена</span>
              <strong>{formatWorkforceDuration(shift.workingSeconds)}</strong>
            </div>
            <div className={styles.currentValue}>
              <span>Перерывы · вся смена</span>
              <strong>{formatWorkforceDuration(shift.breakSeconds)}</strong>
            </div>
            <div className={styles.currentValue}>
              <span>
                {shift.status === "break"
                  ? "Текущий перерыв с"
                  : "Текущий отрезок смены с"}
              </span>
              <strong>{workforceDateTime(shift.periodStartedAt)}</strong>
            </div>
          </div>
          {shift.origin === "observed_from_migration" && (
            <p className={styles.migrationNote}>
              Смена зафиксирована при включении учёта. Её фактическое начало до
              этого момента неизвестно; прежнее время не восстановлено.
            </p>
          )}
        </>
      ) : (
        <p className={styles.currentEmpty}>Открытой смены нет.</p>
      )}
      <div className={styles.jobs}>
        <h4>Текущие задания</h4>
        {employee.currentJobs.length ? (
          employee.currentJobs.map((job) => (
            <div className={styles.job} key={`${job.kind}:${job.id}`}>
              <div>
                <Link
                  href={
                    job.kind === "assembly"
                      ? "/assembly"
                      : job.kind === "putaway"
                        ? "/putaway"
                        : job.kind === "stocktake"
                          ? `/stocktakes?stocktakeId=${encodeURIComponent(job.id)}`
                          : "/movements"
                  }
                >
                  <strong>
                    {workJobTitle(job.kind)} · {job.code}
                  </strong>
                </Link>
                <p>{job.description}</p>
              </div>
              <Badge tone={job.status === "paused" ? "warning" : "neutral"}>
                {workforceStatus(job.status)}
              </Badge>
            </div>
          ))
        ) : (
          <p className={styles.currentEmpty}>Текущих заданий нет.</p>
        )}
      </div>
      <p className={styles.migrationNote}>
        Состояние и задания показаны на текущий момент, независимо от периода
        отчёта. Время в смене не означает непрерывную активность.
      </p>
    </section>
  );
}
