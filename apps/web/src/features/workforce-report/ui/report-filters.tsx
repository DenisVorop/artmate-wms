"use client";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { EmployeeDto } from "@/shared/api/generated/model";
import { workforcePeriod } from "@/entities/workforce";
import { Button, Input, Select } from "@/shared/ui";
import {
  reportFilterSchema,
  type ReportFilterValues,
} from "../lib/report-filter";
import styles from "./workforce-report.module.css";

export function ReportFilters({
  values,
  employees,
  isManager,
  onApply,
}: {
  values: ReportFilterValues;
  employees: EmployeeDto[];
  isManager: boolean;
  onApply: (values: ReportFilterValues) => void;
}) {
  const prefix = useId();
  const {
    register,
    handleSubmit,
    getValues,
    reset,
    formState: { errors, isDirty },
  } = useForm<ReportFilterValues>({
    resolver: zodResolver(reportFilterSchema),
    defaultValues: values,
  });
  const apply = (next: ReportFilterValues) => {
    onApply(next);
    reset(next);
  };
  const preset = (days: 1 | 7 | 30) => {
    const next = reportFilterSchema.parse({
      ...getValues(),
      ...workforcePeriod(days),
    });
    apply(next);
  };
  return (
    <form
      className={`glass-panel ${styles.filters}`}
      onSubmit={handleSubmit(apply)}
    >
      <div className={styles.filterTop}>
        <div>
          <h2>Период отчёта</h2>
          <p>Даты включительно · московское время</p>
        </div>
        <div className={styles.presets} aria-label="Быстрый выбор периода">
          <Button variant="secondary" size="sm" onClick={() => preset(1)}>
            Сегодня
          </Button>
          <Button variant="secondary" size="sm" onClick={() => preset(7)}>
            7 дней
          </Button>
          <Button variant="secondary" size="sm" onClick={() => preset(30)}>
            30 дней
          </Button>
        </div>
      </div>
      <div className={styles.filterFields}>
        <label className="field" htmlFor={`${prefix}-from`}>
          С даты
          <Input
            id={`${prefix}-from`}
            type="date"
            {...register("from")}
            aria-invalid={!!errors.from}
            aria-describedby={errors.from ? `${prefix}-from-error` : undefined}
          />
          {errors.from && (
            <span
              id={`${prefix}-from-error`}
              role="alert"
              className={styles.fieldError}
            >
              {errors.from.message}
            </span>
          )}
        </label>
        <label className="field" htmlFor={`${prefix}-to`}>
          По дату
          <Input
            id={`${prefix}-to`}
            type="date"
            {...register("to")}
            aria-invalid={!!errors.to}
            aria-describedby={errors.to ? `${prefix}-to-error` : undefined}
          />
          {errors.to && (
            <span
              id={`${prefix}-to-error`}
              role="alert"
              className={styles.fieldError}
            >
              {errors.to.message}
            </span>
          )}
        </label>
        {isManager && (
          <label className="field" htmlFor={`${prefix}-employee`}>
            Сотрудник
            <Select id={`${prefix}-employee`} {...register("employeeId")}>
              <option value="">Все сотрудники</option>
              {values.employeeId &&
                !employees.some(
                  (employee) => employee.id === values.employeeId,
                ) && (
                  <option value={values.employeeId}>Выбранный сотрудник</option>
                )}
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name}
                </option>
              ))}
            </Select>
          </label>
        )}
        <Button className={styles.apply} type="submit">
          Применить
        </Button>
      </div>
      {isDirty && (
        <p className={styles.draftNote} role="status">
          Фильтры изменены. Нажмите «Применить», чтобы обновить результаты.
        </p>
      )}
    </form>
  );
}
