"use client";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input } from "@/shared/ui";
import { financeSchema, type FinanceValues } from "../lib/forecast-form";
import styles from "./forecasting.module.css";
export function FinanceConnect({
  pending,
  checking,
  configured,
  onSave,
}: {
  pending: boolean;
  checking: boolean;
  configured: boolean;
  onSave: (values: FinanceValues) => Promise<boolean>;
}) {
  const id = useId(),
    form = useForm<FinanceValues>({
      resolver: zodResolver(financeSchema),
      defaultValues: { apiKey: "" },
    });
  return (
    <details className={styles.innerDetails}>
      <summary>
        {configured
          ? "Заменить ключ истории WB"
          : "Подключить старую историю WB"}
      </summary>
      <form
        className={styles.finance}
        noValidate
        onSubmit={form.handleSubmit(async (values) => {
          if (!pending && (await onSave(values))) form.reset({ apiKey: "" });
        })}
      >
        <p className={styles.help}>
          Отдельный персональный ключ только для чтения «Финансы» из этого же
          магазина WB. Проверка магазина может занять несколько минут.
        </p>
        <label className="field">
          Ключ для истории WB
          <Input
            {...form.register("apiKey")}
            type="password"
            autoComplete="new-password"
            autoCapitalize="none"
            spellCheck={false}
            disabled={pending}
            aria-invalid={!!form.formState.errors.apiKey}
            aria-describedby={
              form.formState.errors.apiKey ? `${id}-error` : undefined
            }
          />
          {form.formState.errors.apiKey && (
            <span className={styles.error} id={`${id}-error`}>
              {form.formState.errors.apiKey.message}
            </span>
          )}
        </label>
        <Button
          type="submit"
          variant="secondary"
          disabled={pending}
          aria-busy={checking}
        >
          {checking ? "Проверяем магазин WB…" : "Сохранить ключ истории"}
        </Button>
      </form>
    </details>
  );
}
