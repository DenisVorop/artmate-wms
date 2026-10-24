"use client";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ScanLine } from "lucide-react";
import { Button, Input } from "@/shared/ui";
import { scanSchema, type ScanValues } from "../lib/assembly-form";
import styles from "./assembly.module.css";
export function ScanControl({
  label,
  placeholder,
  action,
  pending,
  onScan,
}: {
  label: string;
  placeholder: string;
  action: string;
  pending: boolean;
  onScan: (value: string) => Promise<boolean>;
}) {
  const form = useForm<ScanValues>({
    resolver: zodResolver(scanSchema),
    defaultValues: { value: "" },
  });
  const { setFocus } = form;
  useEffect(() => {
    setFocus("value");
  }, [setFocus]);
  return (
    <form
      className={styles.scanForm}
      noValidate
      aria-busy={pending}
      onSubmit={form.handleSubmit(async (values) => {
        if (pending) return;
        const success = await onScan(values.value);
        if (success) {
          form.reset({ value: "" });
          requestAnimationFrame(() => form.setFocus("value"));
        }
      })}
    >
      <label className="field">
        {label}
        <Input
          className={styles.scanInput}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          disabled={pending}
          placeholder={placeholder}
          {...form.register("value")}
          aria-invalid={!!form.formState.errors.value}
        />
        {form.formState.errors.value && (
          <span className={styles.error}>
            {form.formState.errors.value.message}
          </span>
        )}
      </label>
      <Button type="submit" disabled={pending} aria-busy={pending}>
        <ScanLine size={15} />
        {action}
      </Button>
    </form>
  );
}
