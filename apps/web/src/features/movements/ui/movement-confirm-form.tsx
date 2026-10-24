"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowDownToLine, ScanLine } from "lucide-react";
import { Button } from "@/shared/ui";
import { scanSchema, type ScanValues } from "../lib/movement-form";
import styles from "./movements.module.css";

type Props = {
  mode: "take" | "place" | "retire";
  palletCode: string;
  locationCode: string;
  pending: boolean;
  onConfirm: (values: ScanValues) => Promise<unknown>;
};
export function MovementConfirmForm({
  mode,
  palletCode,
  locationCode,
  pending,
  onConfirm,
}: Props) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ScanValues>({
    resolver: zodResolver(scanSchema),
    defaultValues: { palletCode: "", locationCode: "" },
  });
  return (
    <form
      className={`ops-form ${styles.confirm}`}
      onSubmit={handleSubmit(async (values) => {
        try {
          await onConfirm(values);
        } catch {
          /* The API error is shown by the owning workflow. */
        }
      })}
    >
      <div>
        <h3>
          {mode === "take"
            ? "Подтвердить забор"
            : mode === "place"
              ? "Подтвердить размещение"
              : "Подтвердить вывоз"}
        </h3>
        <p className="ops-sub">
          Отсканируйте паллету{" "}
          <strong className={styles.code}>{palletCode}</strong> и{" "}
          {mode === "place" ? "целевой" : "исходный"} адрес{" "}
          <strong className={styles.code}>{locationCode}</strong>. Без сканера
          введите коды вручную.
        </p>
      </div>
      <label>
        Код паллеты
        <input
          {...register("palletCode")}
          className="ops-scan-input"
          autoComplete="off"
          placeholder="Отсканируйте QR паллеты"
          autoFocus
        />
        {errors.palletCode && (
          <span className="ops-field-error">{errors.palletCode.message}</span>
        )}
      </label>
      <label>
        Код {mode === "place" ? "целевого" : "исходного"} адреса
        <input
          {...register("locationCode")}
          className="ops-scan-input"
          autoComplete="off"
          placeholder="Отсканируйте QR адреса"
        />
        {errors.locationCode && (
          <span className="ops-field-error">{errors.locationCode.message}</span>
        )}
      </label>
      <Button type="submit" disabled={pending}>
        {mode === "place" ? (
          <ArrowDownToLine size={16} />
        ) : (
          <ScanLine size={16} />
        )}
        {pending
          ? "Подтверждаем…"
          : mode === "take"
            ? "Паллета забрана"
            : mode === "place"
              ? "Паллета размещена"
              : "Поддон вывезен"}
      </Button>
    </form>
  );
}
