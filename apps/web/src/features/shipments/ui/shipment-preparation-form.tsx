"use client";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { WorkspaceDto } from "@/shared/api/generated/model";
import { Button, Modal, Select } from "@/shared/ui";
import {
  preparationSchema,
  type PreparationValues,
} from "../lib/shipment-form";
import { pickingHint } from "../lib/shipment-readiness";
import styles from "./shipments.module.css";

type Props = {
  palletId: string | null;
  data: WorkspaceDto;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (values: PreparationValues) => Promise<unknown>;
};
export function ShipmentPreparationForm({
  palletId,
  data,
  pending,
  error,
  onClose,
  onCreate,
}: Props) {
  const pallet = data.pallets.find((item) => item.id === palletId);
  const {
    register,
    reset,
    handleSubmit,
    formState: { errors },
  } = useForm<PreparationValues>({
    resolver: zodResolver(preparationSchema),
    defaultValues: { palletId: "", toLocationId: "", employeeId: "" },
  });
  useEffect(() => {
    reset({ palletId: palletId ?? "", toLocationId: "", employeeId: "" });
  }, [palletId, reset]);
  const targets = data.locations.filter(
    (item) =>
      !item.archived && item.kind === "picking" && item.accessSides === 4,
  );
  const hasAvailableTarget = targets.some(
    (location) => !pickingHint(data, location.id, pallet),
  );
  return (
    <Modal
      open={!!palletId}
      onClose={() => {
        if (!pending) onClose();
      }}
      title="Спустить паллету"
    >
      {pallet && (
        <form
          className={styles.form}
          aria-busy={pending}
          onSubmit={handleSubmit(async (values) => {
            if (pending) return;
            try {
              await onCreate(values);
              onClose();
            } catch {
              /* The API message remains visible here. */
            }
          })}
        >
          <div className={styles.preparationSummary}>
            <strong>{pallet.code}</strong>
            <span>
              {data.skus.find((item) => item.id === pallet.skuId)?.name}
            </span>
            <small>
              Сейчас:{" "}
              {
                data.locations.find((item) => item.id === pallet.locationId)
                  ?.code
              }{" "}
              · {pallet.quantity} коробов на паллете
            </small>
          </div>
          <label className="field">
            Адрес отбора
            <Select disabled={pending} {...register("toLocationId")}>
              <option value="">Выберите свободный адрес</option>
              {targets.map((location) => {
                const hint = pickingHint(data, location.id, pallet);
                return (
                  <option
                    value={location.id}
                    key={location.id}
                    disabled={!!hint}
                  >
                    {location.code} · {location.name}
                    {hint ? ` — ${hint}` : ""}
                  </option>
                );
              })}
            </Select>
            {errors.toLocationId && (
              <span className={styles.fieldError}>
                {errors.toLocationId.message}
              </span>
            )}
          </label>
          {!hasAvailableTarget && (
            <div className="ops-note">
              Нет свободного подходящего адреса отбора. Освободите место или
              создайте на карте адрес с доступом с четырёх сторон.
            </div>
          )}
          <label className="field">
            Исполнитель
            <Select disabled={pending} {...register("employeeId")}>
              <option value="">Выберите сотрудника на смене</option>
              {data.employees
                .filter((item) => item.status === "working")
                .map((employee) => (
                  <option value={employee.id} key={employee.id}>
                    {employee.name}
                  </option>
                ))}
            </Select>
            {errors.employeeId && (
              <span className={styles.fieldError}>
                {errors.employeeId.message}
              </span>
            )}
          </label>
          <p className={styles.note}>
            Исходный адрес сохранится для возврата остатка.
          </p>
          {error && (
            <div className="ops-error" role="alert">
              {error}
            </div>
          )}
          <Button type="submit" disabled={pending || !hasAvailableTarget}>
            {pending ? "Создаём…" : "Создать задание"}
          </Button>
        </form>
      )}
    </Modal>
  );
}
