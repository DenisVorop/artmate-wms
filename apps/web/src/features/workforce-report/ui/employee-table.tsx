import { ChevronRight } from "lucide-react";
import type { EmployeePerformanceDto } from "@/shared/api/generated/model";
import { number } from "@/shared/lib/format";
import { formatWorkforceDuration, workforceStatus } from "../lib/report-view";
import styles from "./workforce-report.module.css";

export function EmployeeTable({
  employees,
  selectedId,
  onSelect,
}: {
  employees: EmployeePerformanceDto[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <caption className={styles.screenReader}>
          Результаты сотрудников за выбранный период. Нажмите на имя, чтобы
          открыть смены и события.
        </caption>
        <thead>
          <tr>
            <th scope="col">Сотрудник</th>
            <th scope="col">Короба</th>
            <th scope="col">Раскраски</th>
            <th scope="col">Приёмка, паллет</th>
            <th scope="col">Размещение, коробов</th>
            <th scope="col">Перемещение, паллет</th>
            <th scope="col">В смене без перерывов</th>
            <th scope="col">Перерывы</th>
          </tr>
        </thead>
        <tbody>
          {employees.map((employee) => (
            <tr
              key={employee.employeeId}
              className={
                selectedId === employee.employeeId
                  ? styles.selectedRow
                  : undefined
              }
            >
              <th scope="row">
                <button
                  type="button"
                  className={styles.employeeButton}
                  aria-expanded={selectedId === employee.employeeId}
                  aria-controls="workforce-employee-detail"
                  onClick={() => onSelect(employee.employeeId)}
                >
                  <span className={styles.employeeName}>
                    {employee.employeeName}
                    <small>Сейчас: {workforceStatus(employee.status)}</small>
                  </span>
                  <ChevronRight size={14} />
                </button>
              </th>
              <td>{number(employee.metrics.boxesPacked)}</td>
              <td>{number(employee.metrics.unitsPacked)}</td>
              <td>{number(employee.metrics.receiptPalletsPlaced)}</td>
              <td>{number(employee.metrics.putawayBoxesPlaced)}</td>
              <td>{number(employee.metrics.movementPalletsPlaced)}</td>
              <td>
                {formatWorkforceDuration(employee.metrics.workingSeconds)}
              </td>
              <td>{formatWorkforceDuration(employee.metrics.breakSeconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
