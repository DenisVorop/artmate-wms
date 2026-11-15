"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { WorkspaceDto } from "@/shared/api/generated/model";
import { Button, Input, Select } from "@/shared/ui";
import { shipmentSchema, type ShipmentValues } from "../lib/shipment-form";
import { isShipmentBoxAvailable } from "../lib/shipment-readiness";
import styles from "./shipments.module.css";

type FormProps = {
  data: WorkspaceDto;
  error: string | null;
  pending: boolean;
};

export function ManualShipmentForm({
  data,
  error,
  pending,
  onSave,
}: FormProps & { onSave: (values: ShipmentValues) => Promise<void> }) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<ShipmentValues>({
    resolver: zodResolver(shipmentSchema),
    defaultValues: { skuId: "", boxesRequested: 1 },
  });
  const skuId = watch("skuId");
  const available = skuId
    ? data.boxes.filter(
        (box) => box.skuId === skuId && isShipmentBoxAvailable(data, box),
      ).length
    : 0;

  return (
    <form
      className={styles.form}
      noValidate
      aria-busy={pending}
      onSubmit={handleSubmit(async (values) => {
        if (pending) return;
        try {
          await onSave(values);
        } catch {
          /* Keep the entered quantities available for retry. */
        }
      })}
    >
      <label className="field">
        Тематика
        <Select
          disabled={pending}
          aria-invalid={!!errors.skuId}
          {...register("skuId")}
        >
          <option value="">Выберите тематику</option>
          {data.skus.map((sku) => (
            <option key={sku.id} value={sku.id}>
              {sku.name}
            </option>
          ))}
        </Select>
        {errors.skuId && (
          <span className={styles.fieldError}>{errors.skuId.message}</span>
        )}
      </label>
      <label className="field">
        Количество коробов
        <Input
          type="number"
          min={1}
          max={10000}
          disabled={pending}
          aria-invalid={!!errors.boxesRequested}
          {...register("boxesRequested", { valueAsNumber: true })}
        />
        {errors.boxesRequested && (
          <span className={styles.fieldError}>
            Укажите целое число от 1 до 10 000
          </span>
        )}
        {skuId && (
          <span className={styles.note}>
            Доступно к отгрузке: {available} кор.
          </span>
        )}
      </label>
      {error && (
        <div className="ops-error" role="alert">
          {error}
        </div>
      )}
      <Button type="submit" disabled={pending}>
        Создать
      </Button>
    </form>
  );
}

export function WbShipmentForm({
  data,
  error,
  pending,
  onSave,
}: FormProps & {
  onSave: (number: string, reservations: string[]) => Promise<void>;
}) {
  const [number, setNumber] = useState("");
  const [reservations, setReservations] = useState<string[]>([]);
  const drafts = data.shipments.filter(
    (row) =>
      row.status === "draft" &&
      !row.wb &&
      !row.employeeId &&
      !row.scannedBoxIds?.length,
  );

  return (
    <form
      className={styles.form}
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        if (!pending) void onSave(number.trim(), reservations).catch(() => {});
      }}
    >
      <label className="field">
        Номер поставки WB
        <Input
          value={number}
          onChange={(event) => setNumber(event.target.value)}
          inputMode="numeric"
          pattern="[1-9][0-9]{0,19}"
          disabled={pending}
          required
        />
      </label>
      {drafts.length > 0 && (
        <fieldset className={styles.reserveList} disabled={pending}>
          <legend>Использовать готовые резервы</legend>
          {drafts.map((row) => (
            <label key={row.id}>
              <input
                type="checkbox"
                checked={reservations.includes(row.id)}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setReservations((ids) =>
                    checked
                      ? [...ids, row.id]
                      : ids.filter((id) => id !== row.id),
                  );
                }}
              />
              <span>
                {data.skus.find((sku) => sku.id === row.skuId)?.name ??
                  row.code}
                {" · "}
                {row.boxesRequested} кор. · {row.code}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {error && (
        <div className="ops-error" role="alert">
          {error}
        </div>
      )}
      <Button type="submit" disabled={pending}>
        Загрузить поставку
      </Button>
    </form>
  );
}
