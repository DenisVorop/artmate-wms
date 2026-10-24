"use client";
import type { ReactNode } from "react";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/shared/ui";
import {
  stocktakeReasonSchema,
  type StocktakeReasonValues,
} from "../lib/stocktake-form";
import styles from "./stocktakes.module.css";

export function ReasonAction({
  title,
  description,
  label,
  pending,
  error,
  danger,
  onSave,
  onClose,
  children,
  disabledReason,
}: {
  title: string;
  description: string;
  label: string;
  pending: boolean;
  error: string | null;
  danger?: boolean;
  onSave: (reason: string) => Promise<boolean>;
  onClose: () => void;
  children?: ReactNode;
  disabledReason?: string | null;
}) {
  const id = useId();
  const form = useForm<StocktakeReasonValues>({
    resolver: zodResolver(stocktakeReasonSchema),
    defaultValues: { reason: "" },
  });
  return (
    <form
      className={styles.confirm}
      onSubmit={form.handleSubmit(async (values) => {
        if (!disabledReason && (await onSave(values.reason))) onClose();
      })}
    >
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
      {disabledReason && (
        <p className={styles.error} role="status">
          {disabledReason}
        </p>
      )}
      <label className="field" htmlFor={id}>
        Причина
        <textarea
          id={id}
          className={`input ${styles.textarea}`}
          disabled={pending}
          maxLength={500}
          placeholder="Что проверили и почему применяете это действие"
          {...form.register("reason")}
          aria-invalid={!!form.formState.errors.reason}
        />
        {form.formState.errors.reason && (
          <span className={styles.fieldError} role="alert">
            {form.formState.errors.reason.message}
          </span>
        )}
      </label>
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      <div className={styles.inlineActions}>
        <Button
          type="submit"
          variant={danger ? "danger" : "primary"}
          disabled={pending || !!disabledReason}
          aria-busy={pending}
        >
          {label}
        </Button>
        <Button variant="secondary" disabled={pending} onClick={onClose}>
          Вернуться к документу
        </Button>
      </div>
    </form>
  );
}
