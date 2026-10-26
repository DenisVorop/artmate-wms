"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { MarketplaceSettingsDto } from "@/entities/assembly-plan";
import { Button, Input, Select } from "@/shared/ui";
import { planningSchema, type PlanningValues } from "../lib/planning-form";
import styles from "./assembly-planning.module.css";
const fields = [
  { name: "historyDays", label: "Продажи за, дней", min: 7, max: 89 },
  {
    name: "horizonDays",
    label: "Запас на маркетплейсах, дней",
    min: 1,
    max: 90,
  },
  { name: "safetyDays", label: "Дополнительный запас, дней", min: 0, max: 60 },
  { name: "leadDays", label: "Доставка до складов, дней", min: 0, max: 60 },
] as const;
export function PlanningSettings({
  settings,
  pending,
  onSave,
}: {
  settings: MarketplaceSettingsDto;
  pending: boolean;
  onSave: (values: PlanningValues) => Promise<boolean>;
}) {
  const form = useForm<PlanningValues>({
    resolver: zodResolver(planningSchema),
    defaultValues: {
      ...settings,
      dispatchWeekday: settings.dispatchWeekday ?? 6,
    },
  });
  return (
    <details className={`glass-panel ${styles.settings}`}>
      <summary className={styles.settingsSummary}>
        <span>
          На маркетплейсах — запас на{" "}
          <strong>{settings.horizonDays} дней</strong>
        </span>
        <span className={styles.settingsAction}>Настроить</span>
      </summary>
      <form
        noValidate
        className={styles.fields}
        onSubmit={form.handleSubmit(async (values) => {
          if (!pending && (await onSave(values))) form.reset(values);
        })}
      >
        <label className="field">
          День отгрузки
          <Select
            {...form.register("dispatchWeekday", { valueAsNumber: true })}
            disabled={pending}
          >
            {[
              [1, "Понедельник"],
              [2, "Вторник"],
              [3, "Среда"],
              [4, "Четверг"],
              [5, "Пятница"],
              [6, "Суббота"],
              [0, "Воскресенье"],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        {fields.map((field) => (
          <label key={field.name} className="field">
            {field.label}
            <Input
              type="number"
              min={field.min}
              max={field.max}
              {...form.register(field.name, { valueAsNumber: true })}
              disabled={pending}
              aria-invalid={!!form.formState.errors[field.name]}
            />
            {form.formState.errors[field.name] && (
              <span className={styles.error}>
                {form.formState.errors[field.name]?.message}
              </span>
            )}
          </label>
        ))}
        <Button type="submit" disabled={pending || !form.formState.isDirty}>
          Сохранить настройки
        </Button>
      </form>
      <p className={styles.help}>
        Период запаса относится к маркетплейсам. Сборка впрок идёт отдельной
        очередью, без фиксированного запаса своего склада.
      </p>
    </details>
  );
}
