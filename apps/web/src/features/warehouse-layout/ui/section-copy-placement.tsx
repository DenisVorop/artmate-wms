"use client";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, MapPin, X } from "lucide-react";
import type { RackSectionDto } from "@/shared/api/generated/model";
import type { Point } from "../lib/plan-geometry";
import {
  sectionCopyPlacementSchema,
  type SectionCopyPlacementValues,
} from "../lib/section-copy-form";
import { Button, Input } from "@/shared/ui";
import styles from "./section-copy-placement.module.css";

type Props = {
  section: RackSectionDto;
  position: Point;
  activeLevelCount: number;
  pending: boolean;
  error: string | null;
  onPositionChange: (position: Point) => void;
  onPlace: (position: Point) => Promise<unknown>;
  onCancel: () => void;
};
export function SectionCopyPlacement({
  section,
  position,
  activeLevelCount,
  pending,
  error,
  onPositionChange,
  onPlace,
  onCancel,
}: Props) {
  const form = useForm<SectionCopyPlacementValues>({
    resolver: zodResolver(sectionCopyPlacementSchema),
    defaultValues: position,
  });
  const { reset, setValue } = form;
  useEffect(() => {
    reset(position);
  }, [section.id, reset]);
  useEffect(() => {
    setValue("x", position.x, { shouldValidate: true });
    setValue("y", position.y, { shouldValidate: true });
  }, [position.x, position.y, setValue]);
  const blocked = pending || form.formState.isSubmitting;
  return (
    <aside
      className={`glass-panel ${styles.panel}`}
      aria-label="Размещение копии секции"
    >
      <span className={styles.icon}>
        <Copy size={22} />
      </span>
      <p className="eyebrow">КОПИРОВАНИЕ СЕКЦИИ</p>
      <h2>Копия {section.code}</h2>
      <p className={styles.hint}>
        Укажите место на карте или задайте координаты. Будут созданы новые
        пустые адреса с настройками всех действующих ярусов.
      </p>
      <dl className={styles.facts}>
        <div>
          <dt>Исходная секция</dt>
          <dd>{section.name}</dd>
        </div>
        <div>
          <dt>Ярусов</dt>
          <dd>{activeLevelCount}</dd>
        </div>
        <div>
          <dt>Размеры / поворот</dt>
          <dd>
            {section.width} × {section.depth} м / {section.rotation}°
          </dd>
        </div>
      </dl>
      <form
        noValidate
        aria-busy={blocked}
        onSubmit={form.handleSubmit(async (values) => {
          if (pending) return;
          onPositionChange(values);
          try {
            await onPlace(values);
          } catch {
            /* Preserve entered coordinates and server error. */
          }
        })}
      >
        <fieldset className={styles.grid} disabled={blocked}>
          {(["x", "y"] as const).map((axis) => {
            const field = form.register(axis, { valueAsNumber: true });
            return (
              <label className="field" key={axis}>
                Координата {axis.toUpperCase()}, м
                <Input
                  type="number"
                  step="any"
                  min={0}
                  max={1000}
                  {...field}
                  aria-invalid={!!form.formState.errors[axis]}
                  onChange={(event) => {
                    void field.onChange(event);
                    const values = form.getValues();
                    if (sectionCopyPlacementSchema.safeParse(values).success)
                      onPositionChange(values);
                  }}
                />
                {form.formState.errors[axis] && (
                  <span className={styles.error}>
                    {form.formState.errors[axis]?.message}
                  </span>
                )}
              </label>
            );
          })}
        </fieldset>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <p className={styles.hint}>
          Короткий клик ставит копию. Перетаскивание её не создаёт. Для
          навигации можно включить «Перемещать карту». Escape отменяет
          копирование.
        </p>
        <div className={styles.actions}>
          <Button type="submit" disabled={blocked} aria-busy={blocked}>
            <MapPin size={16} />
            Создать копию
          </Button>
          <Button variant="secondary" disabled={blocked} onClick={onCancel}>
            <X size={15} />
            Отмена копирования
          </Button>
        </div>
      </form>
    </aside>
  );
}
