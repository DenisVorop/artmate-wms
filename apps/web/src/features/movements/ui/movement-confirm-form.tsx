"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input } from "@/shared/ui";
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
      className={styles.confirm}
      aria-busy={pending}
      onSubmit={handleSubmit(async (values) => {
        try {
          await onConfirm(values);
        } catch {
          /* The API error is shown by the owning workflow. */
        }
      })}
    >
      <label className="field">
        Код паллеты
        <Input
          {...register("palletCode")}
          className={styles.scanInput}
          disabled={pending}
          autoCapitalize="off"
          spellCheck={false}
          autoComplete="off"
          placeholder={palletCode || "Отсканируйте QR паллеты"}
          aria-invalid={!!errors.palletCode}
          autoFocus
        />
        {errors.palletCode && (
          <span className={styles.fieldError}>{errors.palletCode.message}</span>
        )}
      </label>
      <label className="field">
        Код адреса
        <Input
          {...register("locationCode")}
          className={styles.scanInput}
          disabled={pending}
          autoCapitalize="off"
          spellCheck={false}
          autoComplete="off"
          placeholder={locationCode || "Отсканируйте QR адреса"}
          aria-invalid={!!errors.locationCode}
        />
        {errors.locationCode && (
          <span className={styles.fieldError}>
            {errors.locationCode.message}
          </span>
        )}
      </label>
      <Button type="submit" disabled={pending}>
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
