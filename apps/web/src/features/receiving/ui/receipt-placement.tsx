"use client";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MapPin, ScanLine } from "lucide-react";
import type { ReceiptDto, WorkspaceDto } from "@/shared/api/generated/model";
import { Button, Input, Modal, Select } from "@/shared/ui";
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
  const row = receipt.pallets.find((item) => item.palletId === palletId);
  const pallet = data.pallets.find((item) => item.id === palletId);
  const sku = data.skus.find((item) => item.id === row?.skuId);
  const options = usePlacementOptions(
    receipt.id,
    palletId,
    !!row && !row.placedAt,
  );
  const staff = data.employees.filter(
    (employee) => employee.status === "working",
  );
  const suggested = options.data?.locations.find(
    (location) => location.id === options.data?.suggestedLocationId,
  );
  const form = useForm<PlacementValues>({
    resolver: zodResolver(placementSchema),
    defaultValues: { employeeId: "", palletCode: "", locationCode: "" },
  });
  const submit = form.handleSubmit(async (values) => {
    if (!pending && row && !row.placedAt) await onPlace(values);
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
          <p className={styles.info}>
            Паллета уже размещена или больше не ожидает приёмки. Обновлённая
            история доступна в документе.
          </p>
          <Button onClick={onClose}>К документу</Button>
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
              Подбираем свободный адрес по габаритам паллеты…
            </p>
          )}
          {options.isError && (
            <div className={styles.readError} role="alert">
              <p>
                Не удалось обновить рекомендации. Ввод сохранён. Можно повторить
                подбор или отсканировать подходящий адрес — сервер проверит его
                при размещении.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void options.refetch()}
                disabled={options.isFetching}
              >
                Обновить подбор
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
              <p>
                Адрес пока не зарезервирован. Разместите паллету и подтвердите
                оба кода сканером или введите их вручную.
              </p>
            </div>
          )}
          {options.data && !suggested && (
            <div className={styles.info}>
              <p>
                {options.data.reason ||
                  "Сейчас нет подходящих свободных адресов. Документ и паллета сохранятся в ожидающей приёмке."}
              </p>
              <Link href="/warehouse" target="_blank" rel="noopener noreferrer">
                Проверить карту склада ↗
              </Link>
            </div>
          )}
          {options.data && options.data.locations.length > 1 && (
            <p className={styles.help}>
              Подходящих адресов: {options.data.locations.length}. Можно
              отсканировать другой подходящий свободный адрес.
            </p>
          )}
          <fieldset disabled={pending} className={styles.fieldset}>
            <label className="field">
              Кто размещает
              <Select
                {...form.register("employeeId")}
                aria-invalid={!!form.formState.errors.employeeId}
              >
                <option value="">Выберите сотрудника на смене</option>
                {staff.map((employee) => (
                  <option value={employee.id} key={employee.id}>
                    {employee.name}
                  </option>
                ))}
              </Select>
              {form.formState.errors.employeeId && (
                <span className={styles.error}>
                  {form.formState.errors.employeeId.message}
                </span>
              )}
            </label>
            {!staff.length && (
              <p className={styles.info}>
                Нет сотрудников на смене.{" "}
                <Link href="/team" target="_blank" rel="noopener noreferrer">
                  Добавьте сотрудника и начните смену ↗
                </Link>
                , затем вернитесь к этой паллете.
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
          <p className={styles.help}>
            <ScanLine size={13} /> Скан паллеты → скан адреса → товар на
            балансе. При ошибке поля остаются заполненными.
          </p>
          <div className={styles.detailActions}>
            <Button variant="ghost" onClick={onClose} disabled={pending}>
              К документу
            </Button>
            <Button
              type="submit"
              disabled={pending || !staff.length}
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
