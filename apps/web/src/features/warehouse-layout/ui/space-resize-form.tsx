"use client";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type {
  WarehousePlanDto,
  WarehouseSpaceDto,
} from "@/shared/api/generated/model";
import { Button, Input, Modal } from "@/shared/ui";
import {
  spaceResizeDefaults,
  spaceResizeSchemaFor,
  type SpaceResizeValues,
} from "../lib/space-resize-form";
import styles from "./resize-shell.module.css";
export function SpaceResizeForm({
  open,
  space,
  warehouse,
  pending,
  error,
  onClose,
  onSave,
}: {
  open: boolean;
  space: WarehouseSpaceDto | undefined;
  warehouse: WarehousePlanDto;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (id: string, values: SpaceResizeValues) => Promise<unknown>;
}) {
  const form = useForm<SpaceResizeValues>({
    resolver: zodResolver(spaceResizeSchemaFor(warehouse, space?.id ?? "")),
    defaultValues: space
      ? spaceResizeDefaults(space)
      : { x: 0, y: 0, width: 0.5, depth: 0.5 },
  });
  const { reset } = form;
  // Snapshot polling must not overwrite exact coordinates being edited.
  useEffect(() => {
    if (open && space) reset(spaceResizeDefaults(space));
  }, [open, space?.id, reset]);
  if (!space) return null;
  const close = () => {
    if (!pending) onClose();
  };
  return (
    <Modal
      open={open}
      title={`Размеры: ${space.name}`}
      description="Измените границы помещения или коридора. Стеллажи, места и проходы сохранят свои координаты."
      onClose={close}
    >
      <form
        className={styles.form}
        noValidate
        aria-busy={pending}
        onSubmit={form.handleSubmit(async (values) => {
          if (pending) return;
          try {
            await onSave(space.id, values);
            onClose();
          } catch {
            /* Keep input and show the server rejection. */
          }
        })}
      >
        <fieldset className={styles.fieldset} disabled={pending}>
          <div className={styles.grid}>
            {(
              [
                ["x", "Левая граница X, м"],
                ["y", "Верхняя граница Y, м"],
                ["width", "Ширина участка, м"],
                ["depth", "Глубина участка, м"],
              ] as const
            ).map(([field, label]) => (
              <label key={field} className="field">
                {label}
                <Input
                  type="number"
                  min={field === "x" || field === "y" ? 0 : 0.5}
                  max={1000}
                  step="any"
                  {...form.register(field, { valueAsNumber: true })}
                  aria-invalid={!!form.formState.errors[field]}
                />
                {form.formState.errors[field] && (
                  <span className={styles.error}>
                    {form.formState.errors[field]?.message}
                  </span>
                )}
              </label>
            ))}
          </div>
        </fieldset>
        <p className={styles.hint}>
          Все объекты внутри участка должны остаться в его новых границах. Входы
          следуют за стенами; система проверит, что проёмы помещаются. Для
          переноса участка вместе с оборудованием используйте его настройки или
          перетаскивание за фон.
        </p>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.footer}>
          <Button variant="secondary" disabled={pending} onClick={close}>
            Отмена
          </Button>
          <Button
            type="submit"
            disabled={pending || !form.formState.isDirty}
            aria-busy={pending}
          >
            Сохранить границы
          </Button>
        </div>
      </form>
    </Modal>
  );
}
