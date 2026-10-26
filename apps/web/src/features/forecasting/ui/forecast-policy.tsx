"use client";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ForecastRowDto } from "@/entities/forecast";
import { Button, Input } from "@/shared/ui";
import {
  forecastPolicySchema,
  type ForecastPolicyValues,
} from "../lib/forecast-form";
import styles from "./forecasting.module.css";
export function ForecastPolicy({
  row,
  pending,
  onSave,
}: {
  row: ForecastRowDto;
  pending: boolean;
  onSave: (values: ForecastPolicyValues) => Promise<boolean>;
}) {
  const id = useId(),
    form = useForm<ForecastPolicyValues>({
      resolver: zodResolver(forecastPolicySchema),
      defaultValues: {
        minimumBoxes: row.minimumBoxes,
        seasonalityEnabled: row.seasonalityEnabled,
      },
    });
  return (
    <form
      className={styles.policy}
      noValidate
      onSubmit={form.handleSubmit(async (values) => {
        if (!pending && (await onSave(values))) form.reset(values);
      })}
    >
      <label className="field">
        Минимальный запас, коробов
        <Input
          type="number"
          min={0}
          max={1000}
          {...form.register("minimumBoxes", { valueAsNumber: true })}
          disabled={pending}
          aria-invalid={!!form.formState.errors.minimumBoxes}
          aria-describedby={`${id}-minimum-help`}
        />
        <span
          id={`${id}-minimum-help`}
          className={
            form.formState.errors.minimumBoxes ? styles.error : styles.help
          }
        >
          {form.formState.errors.minimumBoxes?.message ??
            "Нижняя граница общего запаса, включая маркетплейсы и товар в пути."}
        </span>
      </label>
      <label className={styles.checkbox}>
        <input
          type="checkbox"
          {...form.register("seasonalityEnabled")}
          disabled={pending}
        />
        <span>
          Учитывать сезонность
          <small>Когда история подтверждает точность прогноза</small>
        </span>
      </label>
      <Button
        type="submit"
        variant="secondary"
        disabled={pending || !form.formState.isDirty}
      >
        Сохранить
      </Button>
    </form>
  );
}
