"use client";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type {
  EntranceDto,
  WarehousePlanDto,
} from "@/shared/api/generated/model";
import { Button, Input, Modal, Select } from "@/shared/ui";
import {
  newEntranceDefaults,
  entranceFrame,
  entranceDefaults,
  entranceSchemaFor,
  wallLabels,
  type EntranceValues,
} from "../lib/plan-form";
import styles from "./plan-panels.module.css";

type Props = {
  open: boolean;
  entrance?: EntranceDto;
  entrances?: EntranceDto[];
  warehouse: WarehousePlanDto;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (values: EntranceValues, id?: string) => Promise<unknown>;
};
export function EntranceForm({
  open,
  entrance,
  entrances = [],
  warehouse,
  pending,
  error,
  onClose,
  onSave,
}: Props) {
  const {
    register,
    watch,
    reset,
    handleSubmit,
    formState: { errors },
  } = useForm<EntranceValues>({
    resolver: zodResolver(
      entranceSchemaFor(warehouse, entrances, entrance?.id),
    ),
    defaultValues: entranceDefaults(entrance),
  });
  const [wall, spaceId] = watch(["wall", "spaceId"]);
  const frame = entranceFrame(warehouse, spaceId);
  const activeSpaces = warehouse.spaces.filter((space) => !space.archived);
  useEffect(() => {
    if (open) {
      if (entrance) reset(entranceDefaults(entrance));
      else reset(newEntranceDefaults(warehouse, entrances));
    }
  }, [open, entrance?.id, reset]);
  const close = () => {
    if (!pending) onClose();
  };
  const length = frame
    ? wall === "north" || wall === "south"
      ? frame.width
      : frame.depth
    : null;
  return (
    <Modal
      open={open}
      onClose={close}
      title={entrance ? `Вход · ${entrance.name}` : "Новый вход"}
      description="Выберите участок и положение проёма на его стене."
    >
      <form
        className={styles.form}
        onSubmit={handleSubmit(async (values) => {
          try {
            await onSave(values, entrance?.id);
            onClose();
          } catch {
            /* Preserve edits after a conflict. */
          }
        })}
      >
        <fieldset className={styles.fieldset} disabled={pending}>
          <label className="field">
            Название входа
            <Input
              {...register("name")}
              placeholder="Приёмка / Ворота 1"
              aria-invalid={!!errors.name}
            />
            {errors.name && (
              <span className={styles.fieldError}>{errors.name.message}</span>
            )}
          </label>
          {warehouse.layoutMode === "spaces" && (
            <label className="field">
              Помещение или коридор
              <Select
                {...register("spaceId", {
                  setValueAs: (value) => (value === "" ? null : value),
                })}
                aria-invalid={!!errors.spaceId}
              >
                <option value="">Выберите участок</option>
                {activeSpaces.map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.name} ·{" "}
                    {space.kind === "room" ? "помещение" : "коридор"}
                  </option>
                ))}
              </Select>
              {errors.spaceId && (
                <span className={styles.fieldError}>
                  {errors.spaceId.message}
                </span>
              )}
            </label>
          )}
          <label className="field">
            Стена
            <Select {...register("wall")}>
              {Object.entries(wallLabels).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </Select>
          </label>
          <div className={styles.grid}>
            <label className="field">
              Отступ от края стены, м
              <Input
                type="number"
                step="any"
                min={0}
                {...register("offset", { valueAsNumber: true })}
                aria-invalid={!!errors.offset}
              />
              {errors.offset && (
                <span className={styles.fieldError}>
                  {errors.offset.message}
                </span>
              )}
            </label>
            <label className="field">
              Ширина проёма, м
              <Input
                type="number"
                step="any"
                min={0.5}
                {...register("width", { valueAsNumber: true })}
                aria-invalid={!!errors.width}
              />
              {errors.width && (
                <span className={styles.fieldError}>
                  {errors.width.message}
                </span>
              )}
            </label>
          </div>
        </fieldset>
        <p className={styles.hint}>
          Длина выбранной стены:{" "}
          <strong>{length === null ? "—" : `${length} м`}</strong>. Для верхней
          и нижней стен отступ считается слева, для правой и левой — сверху.
          Вход обозначает проём, а не место хранения.
        </p>
        {warehouse.layoutMode === "spaces" && !activeSpaces.length && (
          <p className={styles.hint}>
            Сначала нарисуйте помещение или коридор. Вход привязывается к стене
            существующего участка.
          </p>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <div className={styles.footer}>
          <Button variant="secondary" onClick={close} disabled={pending}>
            Отмена
          </Button>
          <Button
            type="submit"
            disabled={
              pending ||
              (warehouse.layoutMode === "spaces" && !activeSpaces.length)
            }
            aria-busy={pending}
          >
            {entrance ? "Сохранить вход" : "Добавить вход"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
