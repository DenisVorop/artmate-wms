"use client";
import { useId } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { EmployeeDto } from "@/shared/api/generated/model";
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
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ReportFilterValues>({
    resolver: zodResolver(reportFilterSchema),
    defaultValues: values,
  });

  return (
    <form
      className={styles.filters}
      aria-label="Фильтры отчёта"
      onSubmit={handleSubmit(onApply)}
    >
      <div className={styles.filterFields}>
        <label className="field">
          С даты
          <Input
            type="date"
            {...register("from")}
            aria-invalid={!!errors.from}
            aria-describedby={errors.from ? `${prefix}-from-error` : undefined}
          />
        </label>
        <label className="field">
          По дату
          <Input
            type="date"
            {...register("to")}
            aria-invalid={!!errors.to}
            aria-describedby={errors.to ? `${prefix}-to-error` : undefined}
          />
        </label>
        {isManager && (
          <label className={`field ${styles.employeeField}`}>
            Сотрудник
            <Controller
              name="employeeId"
              control={control}
              render={({ field }) => (
                <Select {...field}>
                  <option value="">Все сотрудники</option>
                  {values.employeeId &&
                    !employees.some(({ id }) => id === values.employeeId) && (
                      <option value={values.employeeId}>
                        Выбранный сотрудник
                      </option>
                    )}
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name}
                    </option>
                  ))}
                </Select>
              )}
            />
          </label>
        )}
        <Button className={styles.apply} type="submit">
          Показать
        </Button>
      </div>
      {errors.from && (
        <p
          id={`${prefix}-from-error`}
          role="alert"
          className={styles.fieldError}
        >
          {errors.from.message}
        </p>
      )}
      {errors.to && (
        <p id={`${prefix}-to-error`} role="alert" className={styles.fieldError}>
          {errors.to.message}
        </p>
      )}
    </form>
  );
}
