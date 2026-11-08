"use client";
import { useEffect, useId, useRef, useState, type ComponentProps } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { WorkspaceDto } from "@/shared/api/generated/model";
import { Button, Input, Select } from "@/shared/ui";
import type { CountLocationForm } from "./count-location-form";
import { StocktakeNumberField } from "./stocktake-number-field";
import {
  openingCountSchema,
  openingCountDefaults,
  openingToday,
  toOpeningCount,
  type OpeningCountValues,
} from "../lib/opening-count-form";
import styles from "./stocktakes.module.css";

export function OpeningLocationForm({
  row,
  revision,
  pending,
  blocked,
  error,
  onSave,
  onDirty,
  onReset,
  compact = false,
  data,
}: ComponentProps<typeof CountLocationForm> & {
  data: Pick<WorkspaceDto, "skus" | "locations">;
}) {
  const id = useId();
  const identity = (value: typeof row) =>
    JSON.stringify({
      baseline: value.baselineVersion,
      count: value.count,
      countVersion: value.countVersion,
      countedAt: value.countedAt,
    });
  const snapshot = useRef(identity(row));
  const [expectedRevision, setExpectedRevision] = useState(revision),
    [resetConfirm, setResetConfirm] = useState(false);
  const form = useForm<OpeningCountValues>({
    resolver: zodResolver(openingCountSchema()),
    defaultValues: openingCountDefaults(row),
  });
  const batches = useFieldArray({ control: form.control, name: "batches" });
  const values = form.watch();
  const dirty = form.formState.isDirty;
  useEffect(() => {
    onDirty(row.locationId, dirty);
  }, [dirty, onDirty, row.locationId]);
  useEffect(
    () => () => onDirty(row.locationId, false),
    [onDirty, row.locationId],
  );
  const changed = snapshot.current !== identity(row),
    revisionChanged = expectedRevision !== revision;
  const disabled = pending || !!blocked || changed || revisionChanged;
  const location = data.locations.find((l) => l.id === row.locationId);
  const sku = data.skus.find((s) => s.id === values.skuId);
  const marker = !!sku && /маркер/i.test(sku.name);
  const errs = form.formState.errors;
  const numberField = (
    name:
      | "unitsPerBox"
      | "heightCm"
      | "weightKg"
      | `batches.${number}.quantity`,
  ) => ({
    registration: form.register(name),
    value: form.getValues(name),
    onApply: (value: string) =>
      form.setValue(name, value, { shouldDirty: true, shouldValidate: true }),
  });
  return (
    <form
      className={`${styles.form} ${compact ? styles.compactForm : ""}`}
      onSubmit={form.handleSubmit(async (v) => {
        if (disabled) return;
        if (
          v.observed === "pallet" &&
          v.kind === "raw" &&
          location?.maxWeightKg != null &&
          !v.weightKg
        ) {
          form.setError("weightKg", {
            message: "Для этого адреса укажите полную массу паллеты",
          });
          return;
        }
        if (
          v.observed === "pallet" &&
          v.kind === "finished" &&
          marker &&
          !["4", "8"].includes(v.unitsPerBox)
        ) {
          form.setError("unitsPerBox", {
            message: "Для маркеров выберите 4 или 8 наборов в коробе",
          });
          return;
        }
        const saved = await onSave(toOpeningCount(v), expectedRevision);
        const actual = saved?.rows.find((r) => r.locationId === row.locationId);
        if (saved && actual) {
          snapshot.current = identity(actual);
          setExpectedRevision(saved.revision);
          form.reset(openingCountDefaults(actual));
        }
      })}
    >
      {changed && (
        <div className={styles.error} role="alert">
          Снимок или сохранённый подсчёт изменился. Ваш ввод сохранён и
          относится к прежней версии.{" "}
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => setResetConfirm(true)}
          >
            Загрузить актуальную ячейку
          </Button>
        </div>
      )}
      {revisionChanged && !changed && (
        <div className={styles.notice}>
          <p>
            Документ обновлён, ввод этой ячейки сохранён. Сверьте текущую
            версию.
          </p>
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => setExpectedRevision(revision)}
          >
            Учесть обновление документа
          </Button>
        </div>
      )}
      {resetConfirm && (
        <div className={styles.confirm}>
          <p>
            Несохранённый ввод по {row.locationCode} будет очищен. Сохранённый
            подсчёт останется в истории.
          </p>
          <Button variant="secondary" onClick={onReset}>
            Очистить ввод и открыть новый снимок
          </Button>
          <Button variant="ghost" onClick={() => setResetConfirm(false)}>
            Оставить ввод
          </Button>
        </div>
      )}
      <label className="field" htmlFor={`${id}-address`}>
        Код осмотренной ячейки
        <Input
          id={`${id}-address`}
          autoFocus={compact}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          disabled={disabled}
          {...form.register("locationCode")}
          aria-invalid={!!errs.locationCode}
        />
        {errs.locationCode && (
          <span role="alert" className={styles.fieldError}>
            {errs.locationCode.message}
          </span>
        )}
      </label>
      <fieldset className={styles.radioGroup} disabled={disabled}>
        <legend>Что физически находится на адресе</legend>
        {(
          [
            ["pallet", "Паллета с товаром"],
            ["empty", "Адрес пустой"],
          ] as const
        ).map(([v, label]) => (
          <label className={styles.radio} key={v}>
            <input type="radio" value={v} {...form.register("observed")} />
            {label}
          </label>
        ))}
      </fieldset>
      {errs.observed && (
        <span role="alert" className={styles.fieldError}>
          {errs.observed.message}
        </span>
      )}
      {values.observed === "pallet" && (
        <>
          <fieldset className={styles.radioGroup} disabled={disabled}>
            <legend>Товар на паллете</legend>
            {(
              [
                ["raw", "Нерасфасованный товар"],
                ["finished", "Готовые короба"],
              ] as const
            ).map(([v, label]) => (
              <label className={styles.radio} key={v}>
                <input type="radio" value={v} {...form.register("kind")} />
                {label}
              </label>
            ))}
          </fieldset>
          <label className="field" htmlFor={`${id}-sku`}>
            Тематика или товар
            <Select
              id={`${id}-sku`}
              disabled={disabled}
              {...form.register("skuId")}
              onChange={(event) => {
                void form.register("skuId").onChange(event);
                const selected = data.skus.find(
                  (s) => s.id === event.target.value,
                );
                form.setValue(
                  "unitsPerBox",
                  selected ? String(selected.unitsPerBox) : "",
                  { shouldDirty: true },
                );
              }}
              aria-invalid={!!errs.skuId}
            >
              <option value="">Выберите товар</option>
              {data.skus.map((s) => (
                <option value={s.id} key={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            {errs.skuId && (
              <span role="alert" className={styles.fieldError}>
                {errs.skuId.message}
              </span>
            )}
          </label>
          <p className={styles.footerNote}>
            Один адрес — одна европаллета 120 × 80 см, одна тематика. Дата
            поступления определяет FIFO.
          </p>
          {values.kind === "finished" &&
            (marker ? (
              <label className="field" htmlFor={`${id}-units`}>
                Наборов маркеров в коробе
                <Select
                  id={`${id}-units`}
                  disabled={disabled}
                  {...form.register("unitsPerBox")}
                >
                  <option value="">Выберите норму</option>
                  <option value="4">4 набора</option>
                  <option value="8">8 наборов</option>
                </Select>
                <small>
                  Укажите фактическую комплектацию найденных коробов.
                </small>
                {errs.unitsPerBox && (
                  <span role="alert" className={styles.fieldError}>
                    {errs.unitsPerBox.message}
                  </span>
                )}
              </label>
            ) : (
              <StocktakeNumberField
                id={`${id}-units`}
                label="Раскрасок в коробе"
                min={1}
                max={1000}
                disabled={disabled}
                hint="Укажите фактическую комплектацию найденных коробов."
                error={errs.unitsPerBox?.message}
                {...numberField("unitsPerBox")}
              />
            ))}
          {batches.fields.map((field, index) => (
            <div className={styles.openingBatch} key={field.id}>
              <label className="field" htmlFor={`${id}-date-${index}`}>
                Дата поступления
                <Input
                  id={`${id}-date-${index}`}
                  type="date"
                  max={openingToday()}
                  disabled={disabled}
                  {...form.register(`batches.${index}.receivedOn`)}
                  aria-invalid={!!errs.batches?.[index]?.receivedOn}
                />
                {errs.batches?.[index]?.receivedOn && (
                  <span role="alert" className={styles.fieldError}>
                    {errs.batches[index]?.receivedOn?.message}
                  </span>
                )}
              </label>
              <StocktakeNumberField
                id={`${id}-quantity-${index}`}
                label={
                  values.kind === "raw" ? "Найдено, штук" : "Найдено, коробов"
                }
                min={1}
                max={values.kind === "raw" ? 100000000 : 2000}
                disabled={disabled}
                error={errs.batches?.[index]?.quantity?.message}
                {...numberField(`batches.${index}.quantity`)}
              />
              {index > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => batches.remove(index)}
                >
                  Убрать дату
                </Button>
              )}
            </div>
          ))}
          {errs.batches?.message && (
            <p role="alert" className={styles.fieldError}>
              {errs.batches.message}
            </p>
          )}
          {values.kind === "finished" && (
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled || batches.fields.length >= 2000}
              onClick={() => batches.append({ receivedOn: "", quantity: "" })}
            >
              Добавить другую дату поступления
            </Button>
          )}
          {values.kind === "raw" && (
            <div className={styles.openingBatch}>
              <StocktakeNumberField
                id={`${id}-height`}
                label="Полная высота с поддоном, см"
                min={15}
                max={1000}
                decimal
                disabled={disabled}
                error={errs.heightCm?.message}
                {...numberField("heightCm")}
              />
              <StocktakeNumberField
                id={`${id}-weight`}
                label="Масса с поддоном, кг"
                hint={
                  location?.maxWeightKg == null ? "Если известна" : undefined
                }
                min={0.1}
                max={100000}
                decimal
                disabled={disabled}
                error={errs.weightKg?.message}
                {...numberField("weightKg")}
              />
            </div>
          )}
        </>
      )}
      <label className={styles.check}>
        <input
          type="checkbox"
          disabled={disabled}
          {...form.register("inspected")}
        />
        Я осмотрел адрес и пересчитал весь товар на нём
      </label>
      {errs.inspected && (
        <span role="alert" className={styles.fieldError}>
          {errs.inspected.message}
        </span>
      )}
      {blocked && (
        <p role="status" className={styles.notice}>
          {blocked}
        </p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <Button type="submit" disabled={disabled} aria-busy={pending}>
        Сохранить факт по адресу
      </Button>
      <p className={styles.footerNote}>
        Пока сохраняется только подсчёт. Товар и этикетки появятся после
        проверки и утверждения руководителем.
      </p>
    </form>
  );
}
