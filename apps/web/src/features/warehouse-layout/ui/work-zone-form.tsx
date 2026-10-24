"use client";
import { useEffect, useId } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { WorkspaceDto, WorkZoneDto } from "@/shared/api/generated/model";
import { Button, Input, Modal, Select } from "@/shared/ui";
import {
  workZoneDefaults,
  workZoneKindLabels,
  workZoneSchemaFor,
  eligibleZoneLocations,
  type WorkZoneValues,
} from "../lib/work-zone-form";
import styles from "./work-zones.module.css";
export function WorkZoneForm({
  open,
  zone,
  data,
  pending,
  error,
  onClose,
  onSave,
}: {
  open: boolean;
  zone?: WorkZoneDto;
  data: WorkspaceDto;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (values: WorkZoneValues, id?: string) => Promise<unknown>;
}) {
  const kindId = useId();
  const form = useForm<WorkZoneValues>({
    resolver: zodResolver(workZoneSchemaFor(!!zone)),
    defaultValues: workZoneDefaults(zone),
  });
  useEffect(() => {
    if (open) form.reset(workZoneDefaults(zone));
  }, [open, zone?.id, form.reset]);
  const kind = form.watch("kind");
  const selected = form.watch("locationIds");
  const eligible = eligibleZoneLocations(data, kind);
  const unavailable = selected.filter(
    (id) => !eligible.some((l) => l.id === id),
  );
  const save = form.handleSubmit(async (values) => {
    if (pending) return;
    try {
      await onSave(values, zone?.id);
      onClose();
    } catch {
      /* Preserve entered values; server error is shown below. */
    }
  });
  return (
    <Modal
      open={open}
      title={
        zone ? `Настроить рабочую зону ${zone.code}` : "Новая рабочая зона"
      }
      description="Зона объединяет существующие адреса для работы по QR. Вместимость и остатки адресов сохраняются."
      onClose={() => {
        if (!pending) onClose();
      }}
    >
      <form className={styles.form} onSubmit={save} noValidate>
        <label className="field" htmlFor={kindId}>
          Назначение
          <Select id={kindId} {...form.register("kind")} disabled={pending}>
            {Object.entries(workZoneKindLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        <div className={styles.fields}>
          <label className="field">
            Название
            <Input
              {...form.register("name")}
              placeholder={
                zone
                  ? "Название рабочей зоны"
                  : "Система предложит автоматически"
              }
              disabled={pending}
            />
            {form.formState.errors.name && (
              <small className={styles.error}>
                {form.formState.errors.name.message}
              </small>
            )}
          </label>
          <label className="field">
            Код зоны{!zone && " · необязательно"}
            <Input
              {...form.register("code")}
              placeholder={zone ? "Код рабочей зоны" : "Автоматически"}
              disabled={pending}
            />
            {form.formState.errors.code && (
              <small className={styles.error}>
                {form.formState.errors.code.message}
              </small>
            )}
          </label>
        </div>
        <p className={styles.hint}>
          {!zone && "Пустые название и код заполнит система. "}Каждый QR
          относится к одной рабочей зоне; один адрес может участвовать в разных
          назначениях.
        </p>
        {kind === "assembly" && (
          <p className={styles.hint}>
            Все зоны сборки используют один текущий адрес общей накопительной
            паллеты. Другие адреса сборки доступны для зоны размещения.
          </p>
        )}
        <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <legend className="field">Адреса зоны</legend>
          <div className={styles.addresses}>
            {eligible.map((location) => (
              <label key={location.id} className={styles.address}>
                <input
                  type="checkbox"
                  value={location.id}
                  {...form.register("locationIds")}
                  disabled={pending}
                />
                <span>
                  <strong>{location.code}</strong>
                  <small>{location.name}</small>
                </span>
              </label>
            ))}
            {unavailable.map((id) => (
              <label key={id} className={styles.address}>
                <input
                  type="checkbox"
                  value={id}
                  {...form.register("locationIds")}
                  disabled={pending}
                />
                <span>
                  <strong>
                    {data.locations.find((l) => l.id === id)?.code ?? id}
                  </strong>
                  <small>
                    Адрес больше не подходит выбранному назначению. Снимите
                    отметку или измените назначение.
                  </small>
                </span>
              </label>
            ))}
          </div>
          {!eligible.length && (
            <p className={styles.hint}>
              Подходящих адресов пока нет. Создайте адрес нужного типа в
              конструкторе.
            </p>
          )}
          {form.formState.errors.locationIds && (
            <p className={styles.error} role="alert">
              {form.formState.errors.locationIds.message}
            </p>
          )}
        </fieldset>
        {unavailable.length > 0 && (
          <p className={styles.error}>
            Есть неподходящие адреса. Сервер повторно проверит состав зоны при
            сохранении.
          </p>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.footer}>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Отмена
          </Button>
          <Button
            type="submit"
            disabled={pending || unavailable.length > 0}
            aria-busy={pending}
          >
            {zone ? "Сохранить рабочую зону" : "Создать рабочую зону"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
