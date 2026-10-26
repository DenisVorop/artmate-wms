"use client";
import { useEffect, useId, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { MarketplacePlanRowDto } from "@/entities/assembly-plan";
import { Button, Input } from "@/shared/ui";
import {
  stockConfirmationSchema,
  type StockConfirmationValues,
} from "../lib/planning-form";
import { boxesLabel } from "../lib/planning-view";
import styles from "./assembly-planning.module.css";

export function PlanningStock({
  row,
  pending,
  onSave,
}: {
  row: MarketplacePlanRowDto;
  pending: boolean;
  onSave: (values: StockConfirmationValues) => Promise<boolean>;
}) {
  const id = useId();
  const [saved, setSaved] = useState(false);
  const form = useForm<StockConfirmationValues>({
    resolver: zodResolver(stockConfirmationSchema),
    defaultValues: { units: row.readyUnits + row.shipmentReservedUnits },
  });
  const total = row.readyUnits + row.shipmentReservedUnits;
  const dirty = form.formState.isDirty;
  const reset = form.reset;
  useEffect(() => {
    if (!dirty) reset({ units: total });
  }, [total, dirty, reset]);
  return (
    <div>
      {row.stockConfirmedAt && (
        <p className={styles.help}>
          {row.stockEstimated ? "Приблизительный пересчёт от" : "Пересчёт от"}{" "}
          {new Intl.DateTimeFormat("ru-RU", {
            day: "numeric",
            month: "long",
            timeZone: "Europe/Moscow",
          }).format(new Date(row.stockConfirmedAt))}{" "}
          учтён.{" "}
          {row.stockEstimated
            ? "Подтвердите точное количество готового товара."
            : `Готового товара сейчас: ${total % row.unitsPerBox === 0 ? boxesLabel(total / row.unitsPerBox) : `${total} шт.`}.`}
          {row.unregisteredUnits > 0 &&
            " Короба без QR учтены в плане. После их отправки вне WMS уточните остаток."}
        </p>
      )}
      <details className={styles.manual}>
        <summary>Уточнить наш остаток</summary>
        <form
          noValidate
          className={styles.transit}
          onSubmit={form.handleSubmit(async (values) => {
            if (!pending && (await onSave(values))) {
              form.reset(values);
              setSaved(true);
            }
          })}
        >
          <label className="field" htmlFor={`${id}-stock`}>
            Всего готовых товаров у нас, шт.
            <Input
              id={`${id}-stock`}
              type="number"
              min={0}
              max={100000000}
              {...form.register("units", {
                valueAsNumber: true,
                onChange: () => setSaved(false),
              })}
              disabled={pending}
              aria-invalid={!!form.formState.errors.units}
              aria-describedby={`${id}-stock-help${form.formState.errors.units ? ` ${id}-stock-error` : ""}`}
            />
          </label>
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            disabled={pending}
          >
            Подтвердить остаток
          </Button>
          {form.formState.errors.units && (
            <span
              className={styles.error}
              role="alert"
              id={`${id}-stock-error`}
            >
              {form.formState.errors.units.message}
            </span>
          )}
        </form>
        <p className={styles.help} id={`${id}-stock-help`}>
          Укажите весь готовый товар на вашем складе, включая уже учтённый в
          WMS. В одном коробе — {row.unitsPerBox} шт. Товар на маркетплейсах и в
          пути сюда не включайте. Пересчёт уточняет план сборки; адреса и QR
          коробов оформляются отдельно.
        </p>
        {saved && (
          <p className={styles.help} role="status">
            Остаток сохранён, план пересчитан.
          </p>
        )}
      </details>
    </div>
  );
}
