"use client";
import { useEffect } from "react";
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
          <label className="field" key={field}>
            {label}
            <Input
              type="password"
              autoComplete={autoComplete}
              {...form.register(field)}
              aria-invalid={!!form.formState.errors[field]}
            />
            {form.formState.errors[field] && (
              <span className={styles.error}>
                {form.formState.errors[field]?.message}
              </span>
            )}
          </label>
        ))}
      </fieldset>
      <p className={styles.help}>
        Минимум 12 символов. После смены пароля остальные сеансы входа будут
        завершены.
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
        Сменить пароль
      </Button>
    </form>
  );
}
