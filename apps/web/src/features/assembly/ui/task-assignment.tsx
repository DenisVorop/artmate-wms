"use client";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type {
  EmployeeDto,
  TaskDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";
import { Button, Select } from "@/shared/ui";
import { assignmentSchema, type AssignmentValues } from "../lib/assembly-form";
import { assignmentBlocked } from "../lib/assembly-queue";
import styles from "./assembly.module.css";
export function TaskAssignment({
  task,
  employees,
  pending,
  onAssign,
}: {
  task: TaskDto;
  employees: EmployeeDto[];
  pending: boolean;
  onAssign: (values: AssignmentValues) => Promise<WorkspaceDto | undefined>;
}) {
  const form = useForm<AssignmentValues>({
    resolver: zodResolver(assignmentSchema),
    defaultValues: { employeeId: task.employeeId ?? "" },
  });
  const { isDirty } = form.formState;
  const { reset } = form;
  // Polling updates the server label, but never overwrites an unsaved administrator choice.
  useEffect(() => {
    if (!isDirty) reset({ employeeId: task.employeeId ?? "" });
  }, [task.employeeId, isDirty, reset]);
  const reason = assignmentBlocked(task);
  return (
    <section className={styles.assignment}>
      <h3>Назначение · {task.code}</h3>
      <p className={styles.help}>
        Сейчас:{" "}
        {employees.find((employee) => employee.id === task.employeeId)?.name ??
          "свободная очередь"}
        . Сотруднику вне смены можно запланировать задание.
      </p>
      <form
        noValidate
        onSubmit={form.handleSubmit(async (values) => {
          if (pending || reason) return;
          const result = await onAssign(values);
          if (result)
            reset({
              employeeId:
                result.tasks.find((item) => item.id === task.id)?.employeeId ??
                "",
            });
        })}
        aria-busy={pending}
      >
        <label className="field">
          Назначить сотрудника
          <Select
            {...form.register("employeeId")}
            disabled={pending || !!reason}
          >
            <option value="">В свободную очередь</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}
                {employee.status === "working" ? " · на смене" : " · вне смены"}
              </option>
            ))}
          </Select>
        </label>
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          disabled={pending || !!reason || !isDirty}
          aria-busy={pending}
        >
          Сохранить назначение
        </Button>
      </form>
      {reason && <p className={styles.help}>{reason}</p>}
    </section>
  );
}
