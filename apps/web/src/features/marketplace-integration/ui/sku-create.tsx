"use client";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { Button, Input } from "@/shared/ui";
import {
  skuCreateDefaults,
  skuCreateSchema,
  type SkuCreateValues,
} from "../lib/sku-create-form";
import { useSkuCreate } from "../model/use-sku-create";
import styles from "./marketplace-integration.module.css";

export function SkuCreate({
  disabled,
  onCreated,
}: {
  disabled: boolean;
  onCreated: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const actions = useSkuCreate();
  const form = useForm<SkuCreateValues>({
    resolver: zodResolver(skuCreateSchema),
    defaultValues: skuCreateDefaults,
  });
  return (
    <div className={styles.skuCreate}>
      <Button
        variant="secondary"
        size="sm"
        disabled={disabled || actions.pending}
        aria-expanded={open}
        aria-controls={`${id}-form`}
        onClick={() => setOpen(!open)}
      >
        <Plus size={15} aria-hidden="true" /> Добавить тематику
      </Button>
      {open && (
        <form
          id={`${id}-form`}
          className={styles.skuCreateForm}
          aria-label="Новая тематика"
          aria-busy={actions.pending}
          noValidate
          onSubmit={form.handleSubmit(async (values) => {
            if (actions.pending || !(await actions.create(values))) return;
            form.reset(skuCreateDefaults);
            onCreated(values.name);
            setOpen(false);
          })}
        >
          <div className={styles.skuCreateFields}>
            <label className="field">
              Название тематики
              <Input
                autoFocus
                maxLength={100}
                placeholder="Например, Котики-2"
                {...form.register("name")}
                disabled={actions.pending}
                aria-invalid={!!form.formState.errors.name}
                aria-describedby={
                  form.formState.errors.name ? `${id}-name-error` : undefined
                }
              />
              {form.formState.errors.name && (
                <span id={`${id}-name-error`} className={styles.error}>
                  {form.formState.errors.name.message}
                </span>
              )}
            </label>
            <label className="field">
              Штрихкод товара
              <Input
                maxLength={150}
                autoComplete="off"
                {...form.register("barcode")}
                disabled={actions.pending}
                aria-invalid={!!form.formState.errors.barcode}
                aria-describedby={
                  form.formState.errors.barcode
                    ? `${id}-barcode-error`
                    : undefined
                }
              />
              {form.formState.errors.barcode && (
                <span id={`${id}-barcode-error`} className={styles.error}>
                  {form.formState.errors.barcode.message}
                </span>
              )}
            </label>
            <label className="field">
              Единиц товара в коробе
              <Input
                type="number"
                min={1}
                max={1000}
                step={1}
                {...form.register("unitsPerBox", { valueAsNumber: true })}
                disabled={actions.pending}
                aria-invalid={!!form.formState.errors.unitsPerBox}
                aria-describedby={
                  form.formState.errors.unitsPerBox
                    ? `${id}-units-error`
                    : undefined
                }
              />
              {form.formState.errors.unitsPerBox && (
                <span id={`${id}-units-error`} className={styles.error}>
                  {form.formState.errors.unitsPerBox.message}
                </span>
              )}
            </label>
          </div>
          {actions.error && (
            <p className={styles.error} role="alert">
              {actions.error}
            </p>
          )}
          <div className={styles.actions}>
            <Button type="submit" size="sm" disabled={actions.pending}>
              {actions.pending ? "Сохраняем…" : "Создать тематику"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
