"use client";
import { useSession } from "@/entities/session";
import { useEffect } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MapPin } from "lucide-react";
import type { ReceiptDto, WorkspaceDto } from "@/shared/api/generated/model";
import { Button, Input, Modal } from "@/shared/ui";
import { placementSchema, type PlacementValues } from "../lib/receipt-form";
import { usePlacementOptions } from "../model/use-placement-options";
import styles from "./receiving.module.css";
export function ReceiptPlacement({
  receipt,
  palletId,
  data,
  pending,
  error,
  onClose,
  onPlace,
}: {
  receipt: ReceiptDto;
  palletId: string;
  data: WorkspaceDto;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onPlace: (values: PlacementValues) => Promise<void>;
}) {
  const { user } = useSession();
  const actor = data.employees.find(
    (employee) => employee.id === user?.employeeId,
  );
  const row = receipt.pallets.find((item) => item.palletId === palletId);
  const pallet = data.pallets.find((item) => item.id === palletId);
  const sku = data.skus.find((item) => item.id === row?.skuId);
  const options = usePlacementOptions(
    receipt.id,
    palletId,
    !!row && !row.placedAt,
  );
  const suggested = options.data?.locations.find(
    (location) => location.id === options.data?.suggestedLocationId,
  );
  const form = useForm<PlacementValues>({
    resolver: zodResolver(placementSchema),
    defaultValues: {
      employeeId: user?.employeeId ?? "",
      palletCode: "",
      locationCode: "",
    },
  });
  useEffect(() => {
    form.setValue("employeeId", user?.employeeId ?? "");
  }, [user?.employeeId, form.setValue]);
  const submit = form.handleSubmit(async (values) => {
    if (!pending && actor?.status === "working" && row && !row.placedAt)
      await onPlace({ ...values, employeeId: user?.employeeId ?? "" });
  });
  return (
    <Modal
      open
      title={`Разместить ${pallet?.code ?? "паллету"}`}
      description={`${receipt.code} · ${sku?.name ?? "Тематика"} · ${row?.quantity.toLocaleString("ru-RU") ?? "—"} шт.`}
      onClose={() => {
        if (!pending) onClose();
      }}
    >
      {!row || row.placedAt ? (
        <div className={styles.scanForm}>
          <p className={styles.info}>Паллета больше не ожидает размещения.</p>
        </div>
      ) : (
        <form
          className={styles.scanForm}
          onSubmit={submit}
          noValidate
          aria-busy={pending}
        >
          {options.isPending && (
            <p className={styles.info} role="status">
              Подбираем адрес…
            </p>
          )}
          {options.isError && (
            <div className={styles.readError} role="alert">
              <p>Не удалось подобрать адрес. Можно указать его вручную.</p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void options.refetch()}
                disabled={options.isFetching}
              >
                Повторить
              </Button>
            </div>
          )}
          {suggested && (
            <div className={styles.options}>
              <strong>
                <MapPin size={13} /> Рекомендуемый адрес
              </strong>
              <code>{suggested.code}</code>
              <p>
                {suggested.name} · полезные размеры{" "}
                {suggested.availableWidthMm / 10} ×{" "}
                {suggested.availableDepthMm / 10} см · высота до{" "}
                {suggested.maxHeightMm / 10} см
                {suggested.maxWeightKg === null
                  ? ""
                  : ` · до ${suggested.maxWeightKg} кг`}
              </p>
              {options.data?.recommendation && (
                <p>{options.data.recommendation.explanation}</p>
              )}
              <p>Адрес пока не зарезервирован.</p>
            </div>
          )}
          {options.data && !suggested && (
            <div className={styles.info}>
              <p>
                {options.data.reason || "Нет подходящих свободных адресов."}
              </p>
              <Link href="/warehouse" target="_blank" rel="noopener noreferrer">
                Проверить карту склада ↗
              </Link>
            </div>
          )}
          {options.data && options.data.locations.length > 1 && (
            <p className={styles.help}>
              Подходящих адресов: {options.data.locations.length}
            </p>
          )}
          <fieldset disabled={pending} className={styles.fieldset}>
            <input type="hidden" {...form.register("employeeId")} />
            {actor?.status !== "working" && (
              <p className={styles.info}>
                <Link href="/team">Начните или возобновите смену</Link>, чтобы
                разместить паллету.
              </p>
            )}
            <label className="field">
              <span className={styles.scanSteps}>
                <span>1</span>Код паллеты
              </span>
              <Input
                className={styles.scanCode}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="Отсканируйте QR паллеты"
                {...form.register("palletCode")}
                aria-invalid={!!form.formState.errors.palletCode}
                onKeyDown={async (event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (await form.trigger("palletCode"))
                      form.setFocus("locationCode");
                  }
                }}
              />
              {form.formState.errors.palletCode && (
                <span className={styles.error}>
                  {form.formState.errors.palletCode.message}
                </span>
              )}
            </label>
            <label className="field">
              <span className={styles.scanSteps}>
                <span>2</span>Код адреса
              </span>
              <Input
                className={styles.scanCode}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="Отсканируйте QR места хранения"
                {...form.register("locationCode")}
                aria-invalid={!!form.formState.errors.locationCode}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void submit();
                  }
                }}
              />
              {form.formState.errors.locationCode && (
                <span className={styles.error}>
                  {form.formState.errors.locationCode.message}
                </span>
              )}
            </label>
          </fieldset>
          {error && (
            <div className="ops-error" role="alert">
              {error}
            </div>
          )}
          <div className={styles.detailActions}>
            <Button
              type="submit"
              disabled={pending || actor?.status !== "working"}
              aria-busy={pending}
            >
              Подтвердить размещение
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
