"use client";
import {
  FormProvider,
  useFieldArray,
  useForm,
  useFormContext,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, Plus, Trash2, Package } from "lucide-react";
import type { WorkspaceDto } from "@/shared/api/generated/model";
import { Button, Input, Modal, Select } from "@/shared/ui";
import {
  palletDefaults,
  receiptDefaults,
  receiptSchema,
  unknownMass,
  type ReceiptValues,
} from "../lib/receipt-form";
import styles from "./receiving.module.css";

type Props = {
  data: WorkspaceDto;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (values: ReceiptValues) => Promise<void>;
};
export function ReceiptCreateForm({
  data,
  pending,
  error,
  onClose,
  onSave,
}: Props) {
  const form = useForm<ReceiptValues>({
    resolver: zodResolver(receiptSchema),
    defaultValues: receiptDefaults(data.skus.length > 0),
  });
  const rows = useFieldArray({ control: form.control, name: "pallets" });
  const submit = form.handleSubmit(async (values) => {
    if (!pending) await onSave(values);
  });
  return (
    <Modal
      open
      title="Новая приёмка"
      description="Одна строка — одна физическая паллета. После создания можно напечатать этикетки и начать размещение."
      onClose={() => {
        if (!pending) onClose();
      }}
    >
      <FormProvider {...form}>
        <form
          onSubmit={submit}
          noValidate
          className={styles.createForm}
          aria-busy={pending}
        >
          <fieldset disabled={pending} className={styles.fieldset}>
            <label className="field">
              Фактическое поступление · Москва
              <Input
                type="datetime-local"
                {...form.register("receivedAt")}
                aria-invalid={!!form.formState.errors.receivedAt}
              />
              {form.formState.errors.receivedAt && (
                <span className={styles.error}>
                  {form.formState.errors.receivedAt.message}
                </span>
              )}
              <small>Эта дата определяет старшинство партии по FIFO.</small>
            </label>
            <div className={styles.rows}>
              {rows.fields.map((row, index) => (
                <PalletFields
                  key={row.id}
                  data={data}
                  index={index}
                  canRemove={rows.fields.length > 1}
                  onRemove={() => rows.remove(index)}
                  onClone={() =>
                    rows.append(
                      structuredClone(form.getValues(`pallets.${index}`)),
                      { shouldFocus: false },
                    )
                  }
                  canAdd={rows.fields.length < 100}
                />
              ))}
            </div>
            <Button
              variant="secondary"
              disabled={rows.fields.length >= 100}
              onClick={() => rows.append(palletDefaults(data.skus.length > 0))}
            >
              <Plus size={16} />
              Добавить паллету
            </Button>
            {form.formState.errors.pallets?.root && (
              <p role="alert" className={styles.error}>
                {form.formState.errors.pallets.root.message}
              </p>
            )}
          </fieldset>
          {error && (
            <div className="ops-error" role="alert">
              {error}
            </div>
          )}
          <div className={styles.formFooter}>
            <small>
              На баланс — после размещения. Создание документа и печать этикеток
              ещё не добавляют товар в доступный запас.
            </small>
            <div className={styles.detailActions}>
              <Button variant="ghost" disabled={pending} onClick={onClose}>
                Отмена
              </Button>
              <Button type="submit" disabled={pending} aria-busy={pending}>
                Создать приёмку
              </Button>
            </div>
          </div>
        </form>
      </FormProvider>
    </Modal>
  );
}
function PalletFields({
  data,
  index,
  canRemove,
  canAdd,
  onRemove,
  onClone,
}: {
  data: WorkspaceDto;
  index: number;
  canRemove: boolean;
  canAdd: boolean;
  onRemove: () => void;
  onClone: () => void;
}) {
  const {
    register,
    watch,
    formState: { errors },
  } = useFormContext<ReceiptValues>();
  const row = watch(`pallets.${index}`);
  const error = errors.pallets?.[index];
  const physicalError =
    error?.widthCm || error?.depthCm || error?.heightCm || error?.weightKg;
  const existingBarcode =
    row.skuMode === "new"
      ? data.skus.find((sku) => sku.barcode === row.newSku.barcode.trim())
      : undefined;
  return (
    <section className={styles.row} aria-label={`Паллета ${index + 1}`}>
      <div className={styles.rowHeader}>
        <strong>
          <Package size={15} />
          Паллета {index + 1}
        </strong>
        <div>
          <Button
            size="sm"
            variant="ghost"
            disabled={!canAdd}
            onClick={onClone}
            aria-label={`Дублировать паллету ${index + 1}`}
            title="Дублировать строку"
          >
            <Copy size={15} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!canRemove}
            onClick={onRemove}
            aria-label={`Удалить паллету ${index + 1}`}
            title="Удалить строку"
          >
            <Trash2 size={15} />
          </Button>
        </div>
      </div>
      <div className={styles.rowFields}>
        <div>
          {row.skuMode === "existing" ? (
            <label className="field">
              Тематика
              <Select
                {...register(`pallets.${index}.skuId`)}
                aria-invalid={!!error?.skuId}
              >
                <option value="">Выберите тематику</option>
                {data.skus.map((sku) => (
                  <option key={sku.id} value={sku.id}>
                    {sku.name} · {sku.code}
                  </option>
                ))}
              </Select>
              {error?.skuId && (
                <span className={styles.error}>{error.skuId.message}</span>
              )}
            </label>
          ) : (
            <p className={styles.inlineLabel}>Новая тематика</p>
          )}
          <div
            className={styles.skuModes}
            role="group"
            aria-label={`Тематика паллеты ${index + 1}`}
          >
            <label>
              <input
                type="radio"
                value="existing"
                {...register(`pallets.${index}.skuMode`)}
                disabled={!data.skus.length}
              />
              Из каталога
            </label>
            <label>
              <input
                type="radio"
                value="new"
                {...register(`pallets.${index}.skuMode`)}
              />
              Новая
            </label>
          </div>
        </div>
        <label className="field">
          Раскрасок, шт.
          <Input
            type="number"
            min={1}
            max={100000}
            step={1}
            {...register(`pallets.${index}.quantity`, { valueAsNumber: true })}
            aria-invalid={!!error?.quantity}
          />
          {error?.quantity && (
            <span className={styles.error}>{error.quantity.message}</span>
          )}
        </label>
      </div>
      {row.skuMode === "new" && (
        <div className={styles.newSku}>
          <label className="field">
            Название
            <Input
              placeholder="Например, Котики-2"
              maxLength={100}
              {...register(`pallets.${index}.newSku.name`)}
              aria-invalid={!!error?.newSku?.name}
            />
            {error?.newSku?.name && (
              <span className={styles.error}>{error.newSku.name.message}</span>
            )}
          </label>
          <label className="field">
            Штрихкод товара
            <Input
              autoComplete="off"
              maxLength={150}
              {...register(`pallets.${index}.newSku.barcode`)}
              aria-invalid={!!error?.newSku?.barcode}
            />
            {error?.newSku?.barcode && (
              <span className={styles.error}>
                {error.newSku.barcode.message}
              </span>
            )}
          </label>
          <label className="field">
            Артикул · необязательно
            <Input
              placeholder="Система присвоит автоматически"
              maxLength={40}
              {...register(`pallets.${index}.newSku.code`)}
            />
            {error?.newSku?.code && (
              <span className={styles.error}>{error.newSku.code.message}</span>
            )}
          </label>
          <label className="field">
            Раскрасок в коробе
            <Input
              type="number"
              min={1}
              max={1000}
              step={1}
              {...register(`pallets.${index}.newSku.unitsPerBox`, {
                valueAsNumber: true,
              })}
              aria-invalid={!!error?.newSku?.unitsPerBox}
            />
            {error?.newSku?.unitsPerBox && (
              <span className={styles.error}>
                {error.newSku.unitsPerBox.message}
              </span>
            )}
          </label>
          {existingBarcode && (
            <p className={styles.info}>
              Штрихкод уже есть в каталоге: «{existingBarcode.name}». Выберите
              «Из каталога», если это та же тематика. При совпадении всех данных
              сервер использует существующую тематику.
            </p>
          )}
        </div>
      )}
      <details
        className={styles.physical}
        open={physicalError ? true : undefined}
      >
        <summary>
          Груз с поддоном и масса · {row.widthCm || "—"} × {row.depthCm || "—"}{" "}
          × {row.heightCm || "—"} см
        </summary>
        <div className={styles.physicalGrid}>
          {(["widthCm", "depthCm", "heightCm"] as const).map((name) => (
            <label className="field" key={name}>
              {
                {
                  widthCm: "Ширина, см",
                  depthCm: "Глубина, см",
                  heightCm: "Высота с поддоном, см",
                }[name]
              }
              <Input
                type="number"
                min={10}
                max={1000}
                step="0.1"
                {...register(`pallets.${index}.${name}`, {
                  valueAsNumber: true,
                })}
                aria-invalid={!!error?.[name]}
              />
              {error?.[name] && (
                <span className={styles.error}>{error[name]?.message}</span>
              )}
            </label>
          ))}
          <label className="field">
            Масса, кг
            <Input
              type="number"
              min={0}
              step="any"
              placeholder="Неизвестна"
              {...register(`pallets.${index}.weightKg`, {
                setValueAs: unknownMass,
              })}
              aria-invalid={!!error?.weightKg}
            />
            {error?.weightKg && (
              <span className={styles.error}>{error.weightKg.message}</span>
            )}
          </label>
        </div>
        <p className={styles.help}>
          Размеры и масса вместе с поддоном. По ним система подберёт подходящий
          адрес.
        </p>
      </details>
    </section>
  );
}
