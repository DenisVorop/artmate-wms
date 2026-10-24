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
  spaceDefaults,
  spaceKindLabels,
  spaceSchemaFor,
  type SpaceDraft,
  type SpaceValues,
} from "../lib/space-form";
import styles from "./plan-panels.module.css";
import choiceStyles from "./space-form.module.css";

type Props = {
  open: boolean;
  space?: WarehouseSpaceDto;
  draft?: SpaceDraft;
  warehouse: WarehousePlanDto;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (values: SpaceValues, id?: string) => Promise<unknown>;
};
export function SpaceForm({
  open,
  space,
  draft,
  warehouse,
  pending,
  error,
  onClose,
  onSave,
}: Props) {
  const {
    register,
    reset,
    watch,
    handleSubmit,
    formState: { errors },
  } = useForm<SpaceValues>({
    resolver: zodResolver(spaceSchemaFor(warehouse, space?.id)),
    defaultValues: spaceDefaults(space, draft),
  });
  useEffect(() => {
    if (open) reset(spaceDefaults(space, draft));
  }, [open, space?.id, reset]);
  const close = () => {
    if (!pending) onClose();
  };
  const [kind, width, depth] = watch(["kind", "width", "depth"]);
  const area = Number.isFinite(width * depth)
    ? new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 4 }).format(
        width * depth,
      )
    : "—";
  return (
    <Modal
      open={open}
      onClose={close}
      title={
        space
          ? `Участок · ${space.name}`
          : kind === "corridor"
            ? "Новый коридор"
            : "Новое помещение"
      }
      description={
        space
          ? "Изменение X/Y перенесёт участок и расположенные внутри объекты. Изменения сохранятся после проверки."
          : "Проверьте точные размеры. Участок появится на плане после сохранения."
      }
    >
      <form
        className={styles.form}
        onSubmit={handleSubmit(async (values) => {
          try {
            await onSave(values, space?.id);
            onClose();
          } catch {
            /* Preserve the drawing and exact input after a rejection. */
          }
        })}
      >
        <fieldset className={styles.fieldset} disabled={pending}>
          <label className="field">
            Название участка
            <Input
              {...register("name")}
              placeholder={
                kind === "corridor" ? "Главный коридор" : "Помещение приёмки"
              }
              aria-invalid={!!errors.name}
              autoFocus
            />
            {errors.name && (
              <span className={styles.fieldError}>{errors.name.message}</span>
            )}
          </label>
          <fieldset className={choiceStyles.kindField}>
            <legend>Тип участка</legend>
            <div className={choiceStyles.kindChoices}>
              {Object.entries(spaceKindLabels).map(([value, label]) => (
                <label key={value}>
                  <input type="radio" value={value} {...register("kind")} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className={styles.grid}>
            {[
              ["x", "Положение X, м"],
              ["y", "Положение Y, м"],
              ["width", "Ширина, м"],
              ["depth", "Глубина, м"],
            ].map(([key, label]) => {
              const field = key as "x" | "y" | "width" | "depth";
              return (
                <label className="field" key={field}>
                  {label}
                  <Input
                    type="number"
                    step="any"
                    min={field === "x" || field === "y" ? 0 : 0.5}
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
          Площадь: <strong>{area} м²</strong>. Участки могут соприкасаться
          стенами, но не перекрываться. Координаты считаются от левого верхнего
          угла плана. Изменение X/Y переносит участок вместе со стеллажами,
          местами и проходами, целиком расположенными внутри. Изменение размеров
          меняет границы; всё содержимое должно поместиться после сохранения.
        </p>
        {warehouse.layoutMode === "rectangle" && !space && (
          <p className={styles.hint}>
            Первый участок включит схему отдельных помещений. Все существующие
            места и проходы должны остаться на нарисованном полу. Окончательную
            проверку выполнит система.
          </p>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.footer}>
          <Button variant="secondary" disabled={pending} onClick={close}>
            Отмена
          </Button>
          <Button type="submit" disabled={pending} aria-busy={pending}>
            Сохранить участок
          </Button>
        </div>
      </form>
    </Modal>
  );
}
