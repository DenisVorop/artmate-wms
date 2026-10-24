"use client";
import { useSession } from "@/entities/session";
import { Users, Play, Pause, LogOut, UserPlus } from "lucide-react";
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
              ? "Сотрудники, текущие задания и накопленный результат сборки."
              : "Ваша смена, текущее задание и результат сборки."}
          </p>
        </div>
        <div className={styles.actions}>
          <Badge>
            <Users size={14} />{" "}
            {employees.filter((e) => e.status === "working").length} на смене
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
          Сотрудник добавлен вне смены. Нажмите «Начать смену» в его карточке,
          чтобы назначать приёмку и задания.
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
      <div className="ops-employee-grid">
        {employees.map((e) => {
          const task = data.tasks.find(
            (t) => t.employeeId === e.id && t.status === "active",
          );
          return (
            <article
              className={`glass-panel ops-panel ${ui.createdEmployeeId === e.id ? styles.created : ""}`}
              key={e.id}
            >
              <div className="ops-team-head">
                <div className="ops-avatar">{e.initials}</div>
                <div>
                  <h2 style={{ marginBottom: 5 }}>{e.name}</h2>
                  <span className="ops-description">{e.role}</span>
                </div>
                <div style={{ marginLeft: "auto" }}>
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
              </div>
              <div className="ops-source">
                <span className="ops-description">Текущее задание</span>
                <span>{task ? task.code : "Нет активного"}</span>
              </div>
              <div className="ops-team-stat">
                <div>
                  <strong>{e.boxesToday}</strong>
                  <span>коробов собрано</span>
                </div>
                <div>
                  <strong>{e.unitsToday}</strong>
                  <span>раскрасок упаковано</span>
                </div>
              </div>
              <div className="ops-action-row">
                {e.status !== "working" && (
                  <Button
                    size="sm"
                    onClick={() =>
                      void c.setShift(e.id, "working").catch(() => {})
                    }
                    disabled={c.pending}
                  >
                    <Play size={14} />
                    Начать смену
                  </Button>
                )}
                {e.status === "working" && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      void c.setShift(e.id, "break").catch(() => {})
                    }
                    disabled={c.pending}
                  >
                    <Pause size={14} />
                    Перерыв
                  </Button>
                )}
                {e.status !== "off" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void c.setShift(e.id, "off").catch(() => {})}
                    disabled={c.pending}
                  >
                    <LogOut size={14} />
                    Завершить
                  </Button>
                )}
              </div>
            </article>
          );
        })}
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
