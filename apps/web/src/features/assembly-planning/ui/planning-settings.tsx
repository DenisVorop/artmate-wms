"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { MarketplaceSettingsDto } from "@/entities/assembly-plan";
import { Button, Input } from "@/shared/ui";
import { planningSchema, type PlanningValues } from "../lib/planning-form";
import styles from "./assembly-planning.module.css";
const fields = [
  { name: "historyDays", label: "История, дней", min: 7, max: 89 },
  { name: "horizonDays", label: "Запас, дней", min: 1, max: 90 },
  { name: "safetyDays", label: "Страховой запас, дней", min: 0, max: 60 },
  { name: "leadDays", label: "Доставка, дней", min: 0, max: 60 },
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
    defaultValues: settings,
  });
  return (
    <section
      className={`glass-panel ${styles.settings}`}
      aria-labelledby="planning-settings-title"
    >
      <div className={styles.heading}>
        <div>
          <h2 id="planning-settings-title">Правила запаса</h2>
          <p>
            Сначала проверьте продажи и соответствия товаров. Изменения
            пересчитывают рекомендации.
          </p>
        </div>
      </div>
      <form
        noValidate
        className={styles.fields}
        onSubmit={form.handleSubmit(async (values) => {
          if (!pending && (await onSave(values))) form.reset(values);
        })}
      >
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
          Пересчитать
        </Button>
      </form>
    </section>
  );
}
