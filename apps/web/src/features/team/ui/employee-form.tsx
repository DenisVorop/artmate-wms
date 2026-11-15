"use client";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input, Modal } from "@/shared/ui";
import {
  employeeDefaults,
  employeeSchema,
  type EmployeeValues,
} from "../lib/employee-form";

type Props = {
  open: boolean;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (values: EmployeeValues) => Promise<void>;
};
export function EmployeeForm({
  open,
  pending,
  error,
  onClose,
  onCreate,
}: Props) {
  const {
    register,
    reset,
    handleSubmit,
    formState: { errors },
  } = useForm<EmployeeValues>({
    resolver: zodResolver(employeeSchema),
    defaultValues: employeeDefaults,
  });
  useEffect(() => {
    if (open) reset(employeeDefaults);
  }, [open, reset]);
  const close = () => {
    if (!pending) onClose();
  };
  return (
    <Modal open={open} onClose={close} title="Добавить сотрудника">
      <form
        className="ops-form"
        onSubmit={handleSubmit(async (values) => {
          try {
            await onCreate(values);
            onClose();
          } catch {
            /* Keep the entered name and server error. */
          }
        })}
      >
        <label className="field">
          Имя сотрудника
          <Input
            autoComplete="name"
            placeholder="Имя и фамилия"
            {...register("name")}
            aria-invalid={!!errors.name}
          />
          {errors.name && (
            <span className="ops-field-error">{errors.name.message}</span>
          )}
        </label>
        <label className="field">
          Должность, необязательно
          <Input
            placeholder="Например, приёмщик"
            {...register("role")}
            aria-invalid={!!errors.role}
          />
          {errors.role && (
            <span className="ops-field-error">{errors.role.message}</span>
          )}
        </label>
        {error && (
          <div className="ops-error" role="alert">
            {error}
          </div>
        )}
        <div className="ops-action-row">
          <Button variant="secondary" onClick={close} disabled={pending}>
            Отмена
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Добавляем…" : "Добавить сотрудника"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
