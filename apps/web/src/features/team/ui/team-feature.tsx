"use client";
import type { ReactNode } from "react";
import { Search, UserPlus } from "lucide-react";
import { useWorkforceReport } from "@/entities/workforce";
import { useWorkspace } from "@/entities/workspace";
import type { EmployeeDto, WorkspaceDto } from "@/shared/api/generated/model";
import {
  Button,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  Select,
} from "@/shared/ui";
import { useShift } from "../model/use-shift";
import { useTeamState } from "../lib/use-team-state";
import { EmployeeDetails, ShiftStatus, shiftLabels } from "./employee-card";
import { EmployeeForm } from "./employee-form";
import styles from "./team.module.css";

export function TeamFeature({
  employeeAccess,
  otherAccounts,
}: {
  employeeAccess: (employee: EmployeeDto, data: WorkspaceDto) => ReactNode;
  otherAccounts: (data: WorkspaceDto) => ReactNode;
}) {
  const { data, isPending, isError, refetch } = useWorkspace();
  const performance = useWorkforceReport({});
  const commands = useShift();
  const ui = useTeamState();

  if (isPending) return <LoadingState />;
  if (!data) return <ErrorState onRetry={() => void refetch()} />;

  const selected = data.employees.find(
    (employee) => employee.id === ui.selectedId,
  );
  const reports = new Map(
    performance.data?.employees.map((row) => [row.employeeId, row]),
  );
  const search = ui.search.trim().toLocaleLowerCase("ru-RU");
  const employees = data.employees.filter(
    ({ name, role, status }) =>
      (!ui.status || status === ui.status) &&
      (!search ||
        [name, role].some((value) =>
          value.toLocaleLowerCase("ru-RU").includes(search),
        )),
  );

  return (
    <section className={styles.feature}>
      <div className="page-header">
        <h1 className="page-heading">Команда</h1>
        <Button
          disabled={commands.pending}
          onClick={() => {
            commands.clearError();
            ui.setCreateOpen(true);
          }}
        >
          <UserPlus size={16} aria-hidden="true" />
          Добавить сотрудника
        </Button>
      </div>

      <div
        className={styles.filters}
        role="group"
        aria-label="Фильтры сотрудников"
      >
        <label className="field">
          Поиск
          <span className={styles.search}>
            <Search size={16} aria-hidden="true" />
            <Input
              type="search"
              value={ui.search}
              placeholder="Имя или должность"
              onChange={(event) => ui.setSearch(event.target.value)}
            />
          </span>
        </label>
        <label className="field">
          Статус смены
          <Select
            value={ui.status}
            onChange={(event) => ui.setStatus(event.target.value)}
          >
            <option value="">Все статусы</option>
            {Object.entries(shiftLabels).map(([status, label]) => (
              <option key={status} value={status}>
                {label}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <div
        className={styles.tableScroll}
        role="region"
        aria-label="Список сотрудников"
        tabIndex={0}
      >
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Сотрудник</th>
              <th scope="col">Должность</th>
              <th scope="col">Статус смены</th>
              <th scope="col" className={styles.numeric}>
                Текущие задания
              </th>
            </tr>
          </thead>
          <tbody>
            {employees.map((employee) => (
              <tr key={employee.id}>
                <th scope="row">
                  <button
                    className={styles.employeeName}
                    type="button"
                    aria-haspopup="dialog"
                    onClick={() => {
                      commands.clearError();
                      ui.setSelectedId(employee.id);
                    }}
                  >
                    {employee.name}
                  </button>
                </th>
                <td>{employee.role || "—"}</td>
                <td>
                  <ShiftStatus status={employee.status} />
                </td>
                <td className={styles.numeric}>
                  {reports.get(employee.id)?.currentJobs.length ?? "—"}
                </td>
              </tr>
            ))}
            {employees.length === 0 && (
              <tr>
                <td colSpan={4} className={styles.empty}>
                  {data.employees.length
                    ? "Сотрудники не найдены"
                    : "Сотрудников пока нет"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {(isError || performance.isError) && (
        <p className={styles.muted} role="status">
          {isError
            ? "Не удалось обновить команду."
            : "Не удалось обновить данные по заданиям."}{" "}
          <button
            className={styles.employeeName}
            type="button"
            onClick={() => void (isError ? refetch() : performance.refetch())}
          >
            Повторить
          </button>
        </p>
      )}
      {otherAccounts(data)}
      <EmployeeForm
        open={ui.createOpen}
        pending={commands.pending}
        error={commands.error}
        onClose={() => ui.setCreateOpen(false)}
        onCreate={async (values) => {
          const beforeIds = new Set(data.employees.map(({ id }) => id));
          const updated = await commands.create(values);
          const created = updated.employees.find(
            ({ id }) => !beforeIds.has(id),
          );
          if (created) {
            ui.setSearch("");
            ui.setStatus("");
            ui.setSelectedId(created.id);
          }
        }}
      />
      <Modal
        open={!!selected}
        onClose={() => {
          if (!commands.pending) ui.setSelectedId(null);
        }}
        title={selected?.name ?? "Сотрудник"}
      >
        {selected && (
          <div className={styles.details}>
            <EmployeeDetails
              employee={selected}
              performance={reports.get(selected.id)}
              metricDay={performance.data?.from}
              data={data}
              pending={commands.pending}
              error={commands.error}
              onShift={(status) =>
                void commands.setShift(selected.id, status).catch(() => {})
              }
            />
            {employeeAccess(selected, data)}
          </div>
        )}
      </Modal>
    </section>
  );
}
