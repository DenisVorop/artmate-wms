"use client";
import Link from "next/link";
import { useWorkforceReport } from "@/entities/workforce";
import { EmployeeCard } from "./employee-card";
import { useSession } from "@/entities/session";
import { Users, UserPlus, ArrowUpRight } from "lucide-react";
import { useWorkspace } from "@/entities/workspace";
import {
  Badge,
  Button,
  LoadingState,
  ErrorState,
  EmptyState,
} from "@/shared/ui";
import { useShift } from "../model/use-shift";
import { useTeamState } from "../lib/use-team-state";
import { EmployeeForm } from "./employee-form";
import styles from "./team.module.css";
export function TeamFeature() {
  const { user, isManager } = useSession();
  const { data, isPending, isError, refetch } = useWorkspace();
  const performance = useWorkforceReport({});
  const c = useShift();
  const ui = useTeamState();
  if (isPending) return <LoadingState />;
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />;
  const employees = data.employees.filter(
    (employee) => isManager || employee.id === user?.employeeId,
  );
  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">ЛЮДИ И РЕЗУЛЬТАТЫ</p>
          <h1 className="page-heading">
            {isManager ? "Команда" : "Моя смена"}
          </h1>
          <p className="page-description">
            {isManager
              ? "Смены, текущая занятость и выполненная работа за сегодня по московскому времени."
              : "Ваша смена, текущие задания и выполненная работа за сегодня по московскому времени."}
          </p>
        </div>
        <div className={styles.actions}>
          <Link href="/performance" className="button button--secondary">
            <ArrowUpRight size={16} />
            Смены и выработка
          </Link>
          <Badge>
            <Users size={14} />{" "}
            {employees.filter((e) => e.status !== "off").length} на смене
          </Badge>
          {isManager && (
            <Button
              onClick={() => {
                c.clearError();
                ui.setCreateOpen(true);
              }}
              disabled={c.pending}
            >
              <UserPlus size={16} />
              Добавить сотрудника
            </Button>
          )}
        </div>
      </div>
      {c.error && !ui.createOpen && (
        <div className="ops-error" role="alert">
          {c.error}
        </div>
      )}
      {data.employees.some(
        (employee) =>
          employee.id === ui.createdEmployeeId && employee.status === "off",
      ) && (
        <div className={styles.notice} role="status">
          Сотрудник добавлен вне смены. Сотрудник может начать свою смену после
          входа; руководитель также может открыть её в карточке.
        </div>
      )}
      {isManager && employees.length === 0 && (
        <section className="glass-panel">
          <EmptyState
            title="Добавьте первого сотрудника"
            description="После добавления откройте смену. Тогда сотрудник сможет размещать паллеты и выполнять задания."
            action={
              <Button
                onClick={() => {
                  c.clearError();
                  ui.setCreateOpen(true);
                }}
              >
                <UserPlus size={16} />
                Добавить сотрудника
              </Button>
            }
          />
        </section>
      )}
      {performance.isError && (
        <div className={styles.notice} role="status">
          Не удалось обновить выработку.{" "}
          {performance.data
            ? "Показаны последние полученные показатели."
            : "Количество выполненной работы пока недоступно."}{" "}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void performance.refetch()}
          >
            Повторить загрузку
          </Button>
        </div>
      )}
      <div className="ops-employee-grid">
        {employees.map((employee) => (
          <EmployeeCard
            key={employee.id}
            employee={employee}
            performance={performance.data?.employees.find(
              (row) => row.employeeId === employee.id,
            )}
            metricDay={performance.data?.from}
            data={data}
            pending={c.pending}
            created={ui.createdEmployeeId === employee.id}
            onShift={(id, status) =>
              void c.setShift(id, status).catch(() => {})
            }
          />
        ))}
      </div>
      {isManager && (
        <EmployeeForm
          open={ui.createOpen}
          pending={c.pending}
          error={c.error}
          onClose={() => ui.setCreateOpen(false)}
          onCreate={async (values) => {
            const beforeIds = new Set(
              data.employees.map((employee) => employee.id),
            );
            const updated = await c.create(values);
            const created =
              updated.employees.find(
                (employee) => !beforeIds.has(employee.id),
              ) ??
              updated.employees.find(
                (employee) =>
                  employee.name.toLocaleLowerCase("ru-RU") ===
                  values.name.trim().toLocaleLowerCase("ru-RU"),
              );
            ui.setCreatedEmployeeId(created?.id ?? null);
          }}
        />
      )}
    </>
  );
}
