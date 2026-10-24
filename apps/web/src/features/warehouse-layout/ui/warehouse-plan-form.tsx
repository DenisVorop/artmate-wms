"use client";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { WarehousePlanDto } from "@/shared/api/generated/model";
import { Button, Input, Modal } from "@/shared/ui";
import {
  warehousePlanSchema,
  type WarehousePlanValues,
} from "../lib/plan-form";
import styles from "./plan-panels.module.css";

type Props = {
  open: boolean;
  warehouse: WarehousePlanDto;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (values: WarehousePlanValues) => Promise<unknown>;
};
export function WarehousePlanForm({
  open,
  warehouse,
  pending,
  error,
  onClose,
  onSave,
}: Props) {
  const {
    register,
    reset,
    handleSubmit,
    formState: { errors },
  } = useForm<WarehousePlanValues>({
    resolver: zodResolver(warehousePlanSchema),
    defaultValues: warehouse,
  });
  useEffect(() => {
    if (open) reset(warehouse);
  }, [open, reset]);
  const close = () => {
    if (!pending) onClose();
  };
  return (
    <Modal
      open={open}
      onClose={close}
      title="Рабочее поле"
      description="Область для размещения схемы. Размеры реальных помещений и коридоров задаются отдельно."
    >
      <form
        className={styles.form}
        noValidate
        aria-busy={pending}
        onSubmit={handleSubmit(async (values) => {
          if (pending) return;
          try {
            await onSave(values);
            onClose();
          } catch {
            /* Preserve values; the API error remains visible. */
          }
        })}
      >
        <fieldset className={styles.fieldset} disabled={pending}>
          <label className="field">
            Название склада
            <Input {...register("name")} aria-invalid={!!errors.name} />
            {errors.name && (
              <span className={styles.fieldError}>{errors.name.message}</span>
            )}
          </label>
          <div className={styles.grid}>
            {[
              ["width", "Ширина рабочего поля, м"],
              ["depth", "Глубина рабочего поля, м"],
            ].map(([key, label]) => {
              const field = key as "width" | "depth";
              return (
                <label className="field" key={key}>
                  {label}
                  <Input
                    type="number"
                    step="any"
                    min={1}
                    max={1000}
                    {...register(field, { valueAsNumber: true })}
                    aria-invalid={!!errors[field]}
                  />
                  {errors[field] && (
                    <span className={styles.fieldError}>
                      {errors[field].message}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </fieldset>
        <p className={styles.hint}>
          Изменение рабочего поля не меняет размеры нарисованных помещений и
          коридоров. При уменьшении поля все активные участки и объекты должны
          остаться внутри него. Чтобы добавить помещение снизу или справа,
          сначала расширьте поле. Затем выберите «Добавить помещение» или «По
          размерам» в конструкторе.
        </p>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <div className={styles.footer}>
          <Button variant="secondary" onClick={close} disabled={pending}>
            Отмена
          </Button>
          <Button type="submit" disabled={pending} aria-busy={pending}>
            Сохранить рабочее поле
          </Button>
        </div>
      </form>
    </Modal>
  );
}
