"use client";
import { useEffect, useId } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input } from "@/shared/ui";
import {
  passwordChangeSchema,
  type PasswordChangeValues,
} from "../lib/auth-form";
import { useAuthActions } from "../model/use-auth-actions";
import styles from "./auth.module.css";
export function PasswordChangeForm({
  required = false,
  onDone,
  onBusyChange,
}: {
  required?: boolean;
  onDone?: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const actions = useAuthActions();
  const id = useId();
  useEffect(() => {
    onBusyChange?.(actions.pending);
  }, [actions.pending, onBusyChange]);
  const form = useForm<PasswordChangeValues>({
    resolver: zodResolver(passwordChangeSchema),
    defaultValues: { currentPassword: "", newPassword: "", repeatPassword: "" },
  });
  return (
    <form
      noValidate
      className={styles.form}
      aria-busy={actions.pending}
      onSubmit={form.handleSubmit(async (values) => {
        if (actions.pending) return;
        if (await actions.change(values)) {
          form.reset();
          onDone?.();
        }
      })}
    >
      <fieldset disabled={actions.pending} className={styles.fieldset}>
        {(
          [
            [
              "currentPassword",
              required ? "Временный пароль" : "Текущий пароль",
              "current-password",
            ],
            ["newPassword", "Новый пароль", "new-password"],
            ["repeatPassword", "Повторите новый пароль", "new-password"],
          ] as const
        ).map(([field, label, autoComplete]) => (
          <div className="field" key={field}>
            <label htmlFor={`${id}-${field}`}>{label}</label>
            <Input
              id={`${id}-${field}`}
              type="password"
              autoComplete={autoComplete}
              {...form.register(field)}
              aria-invalid={!!form.formState.errors[field]}
              aria-describedby={
                form.formState.errors[field]
                  ? `${id}-${field}-error`
                  : undefined
              }
            />
            {form.formState.errors[field] && (
              <span className={styles.error} id={`${id}-${field}-error`}>
                {form.formState.errors[field]?.message}
              </span>
            )}
          </div>
        ))}
      </fieldset>
      <p className={styles.help}>
        Пароль от 12 символов. Смена пароля завершит вход на других устройствах.
      </p>
      {actions.error && (
        <p className={styles.error} role="alert">
          {actions.error}
        </p>
      )}
      <Button
        type="submit"
        disabled={actions.pending}
        aria-busy={actions.pending}
      >
        Сохранить пароль
      </Button>
    </form>
  );
}
