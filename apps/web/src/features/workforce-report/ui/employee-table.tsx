import type {
  EmployeePerformanceDto,
  PerformanceMetricsDto,
} from "@/shared/api/generated/model";
import { number } from "@/shared/lib/format";
import { formatWorkforceDuration, workforceTotals } from "../lib/report-view";
import styles from "./workforce-report.module.css";

function MetricCells({ metrics }: { metrics: PerformanceMetricsDto }) {
  return (
    <>
      <td className={styles.numeric}>{number(metrics.boxesPacked)}</td>
      <td className={styles.numeric}>{number(metrics.unitsPacked)}</td>
      <td className={styles.numeric}>{number(metrics.receiptPalletsPlaced)}</td>
      <td className={styles.numeric}>{number(metrics.putawayBoxesPlaced)}</td>
      <td className={styles.numeric}>
        {number(metrics.movementPalletsPlaced)}
      </td>
      <td className={styles.numeric}>
        {formatWorkforceDuration(metrics.workingSeconds)}
      </td>
      <td className={styles.numeric}>
        {formatWorkforceDuration(metrics.breakSeconds)}
      </td>
    </>
  );
}

export function EmployeeTable({
  employees,
  period,
}: {
  employees: EmployeePerformanceDto[];
  period: string;
}) {
  return (
    <section className={styles.panel} aria-label="Выработка">
      <div className={styles.sectionHeading}>
        <h2>Выработка</h2>
        <span>{period}</span>
      </div>
      <div
        className={styles.tableScroll}
        role="region"
        aria-label="Таблица выработки"
        tabIndex={0}
      >
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Сотрудник</th>
              <th scope="col" className={styles.numeric}>
                Собрано, кор.
              </th>
              <th scope="col" className={styles.numeric}>
                Упаковано, шт.
              </th>
              <th scope="col" className={styles.numeric}>
                Приёмка, пал.
              </th>
              <th scope="col" className={styles.numeric}>
                Размещение, кор.
              </th>
              <th scope="col" className={styles.numeric}>
                Перемещение, пал.
              </th>
              <th scope="col" className={styles.numeric}>
                Без перерывов
              </th>
              <th scope="col" className={styles.numeric}>
                Перерывы
              </th>
            </tr>
          </thead>
          <tbody>
            {employees.map(({ employeeId, employeeName, metrics }) => (
              <tr key={employeeId}>
                <th scope="row">{employeeName}</th>
                <MetricCells metrics={metrics} />
              </tr>
            ))}
            {!employees.length && (
              <tr>
                <td className={styles.empty} colSpan={8}>
                  Сотрудники не найдены
                </td>
              </tr>
            )}
          </tbody>
          {employees.length > 1 && (
            <tfoot>
              <tr>
                <th scope="row">Итого</th>
                <MetricCells metrics={workforceTotals(employees)} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}
