"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, X } from "lucide-react";
import type {
  StocktakeDto,
  StocktakeRowDto,
  CountStocktakeLocationDto,
} from "@/shared/api/generated/model";
import { Button, Input } from "@/shared/ui";
import {
  addCountBox,
  pendingCountBoxError,
  stocktakeCountDefaults,
  stocktakeCountSchema,
  toStocktakeCount,
  type StocktakeCountValues,
} from "../lib/count-form";
import styles from "./stocktakes.module.css";

export function CountLocationForm({
  row,
  revision,
  pending,
  blocked,
  error,
  onSave,
  onDirty,
  onReset,
}: {
  row: StocktakeRowDto;
  revision: number;
  pending: boolean;
  blocked: string | null;
  error: string | null;
  onSave: (
    values: Omit<CountStocktakeLocationDto, "requestId" | "expectedRevision">,
    expectedRevision: number,
  ) => Promise<StocktakeDto | null>;
  onDirty: (id: string, dirty: boolean) => void;
  onReset: () => void;
}) {
  const id = useId();
  const baselineVersion = useRef(row.baselineVersion);
  const countSnapshot = useRef(
    JSON.stringify({
      count: row.count,
      countVersion: row.countVersion,
      countedAt: row.countedAt,
    }),
  );
  const [expectedRevision, setExpectedRevision] = useState(revision);
  const [boxCode, setBoxCode] = useState("");
  const [boxError, setBoxError] = useState<string | null>(null);
  const [resetConfirm, setResetConfirm] = useState(false);
  const form = useForm<StocktakeCountValues>({
    resolver: zodResolver(stocktakeCountSchema),
    defaultValues: stocktakeCountDefaults(row),
  });
  const raws = useFieldArray({ control: form.control, name: "rawPallets" });
  const boxes = form.watch("boxCodes");
  const rawValues = form.watch("rawPallets");
  const dirty = form.formState.isDirty || !!boxCode.trim();
  useEffect(() => {
    onDirty(row.locationId, dirty);
  }, [dirty, onDirty, row.locationId]);
  useEffect(
    () => () => onDirty(row.locationId, false),
    [onDirty, row.locationId],
  );
  const changed =
    baselineVersion.current !== row.baselineVersion ||
    countSnapshot.current !==
      JSON.stringify({
        count: row.count,
        countVersion: row.countVersion,
        countedAt: row.countedAt,
      });
  const revisionChanged = expectedRevision !== revision;
  const disabled = pending || !!blocked || changed || revisionChanged;
  const toggleBox = (code: string, present: boolean) => {
    form.setValue(
      "boxCodes",
      present
        ? [...boxes, code]
        : boxes.filter((value) => value.toLowerCase() !== code.toLowerCase()),
      { shouldDirty: true },
    );
  };
  const addBox = () => {
    const added = addCountBox(boxes, boxCode);
    setBoxError(added.error);
    if (!added.error) {
      form.setValue("boxCodes", added.codes, { shouldDirty: true });
      setBoxCode("");
    }
  };
  const extras = boxes.filter(
    (code) =>
      !row.baseline.boxes.some(
        (box) => box.code.toLowerCase() === code.toLowerCase(),
      ),
  );
  return (
    <form
      className={styles.form}
      onSubmit={form.handleSubmit(async (values) => {
        if (disabled) return;
        const pendingCodeError = pendingCountBoxError(boxCode);
        if (pendingCodeError) {
          setBoxError(pendingCodeError);
          return;
        }
        const saved = await onSave(toStocktakeCount(values), expectedRevision);
        const savedRow = saved?.rows.find(
          (item) => item.locationId === row.locationId,
        );
        if (saved && savedRow) {
          baselineVersion.current = savedRow.baselineVersion;
          countSnapshot.current = JSON.stringify({
            count: savedRow.count,
            countVersion: savedRow.countVersion,
            countedAt: savedRow.countedAt,
          });
          setExpectedRevision(saved.revision);
          form.reset(stocktakeCountDefaults(savedRow));
        }
      })}
    >
      {changed && (
        <div className={styles.error} role="alert">
          Снимок или сохранённый подсчёт этой ячейки изменился. Ваш ввод
          сохранён, но относится к прежней версии. Загрузите актуальную ячейку,
          чтобы сверить и пересчитать её.
          <div className={styles.inlineActions}>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => setResetConfirm(true)}
            >
              Загрузить актуальную ячейку
            </Button>
          </div>
        </div>
      )}
      {revisionChanged && !changed && (
        <div className={styles.notice}>
          <p>
            Документ обновлён, данные этой ячейки не изменились. Ввод сохранён.
            Проверьте текущий документ перед продолжением.
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
            Несохранённый ввод по {row.locationCode} будет очищен. Сохранённые
            результаты останутся в истории документа.
          </p>
          <div className={styles.inlineActions}>
            <Button variant="secondary" onClick={onReset}>
              Очистить ввод и открыть новый снимок
            </Button>
            <Button variant="ghost" onClick={() => setResetConfirm(false)}>
              Оставить ввод
            </Button>
          </div>
        </div>
      )}
      <label className="field" htmlFor={`${id}-address`}>
        Код пересчитанной ячейки
        <Input
          id={`${id}-address`}
          autoComplete="off"
          placeholder="Введите или отсканируйте код адреса"
          disabled={disabled}
          {...form.register("locationCode")}
          aria-invalid={!!form.formState.errors.locationCode}
        />
        {form.formState.errors.locationCode && (
          <span role="alert" className={styles.fieldError}>
            {form.formState.errors.locationCode.message}
          </span>
        )}
      </label>
      <section>
        <h4 className={styles.subheading}>Раскраски на паллетах</h4>
        <p className={styles.footerNote}>
          Отметьте физически найденные паллеты и введите количество. Найденная
          пустая паллета — 0 шт.; не найденная паллета не включается в факт.
          Ожидаемое количество не является результатом подсчёта.
        </p>
        <div className={styles.rawRows}>
          {raws.fields.map((field, index) => {
            const known = row.baseline.rawPallets.find(
              (pallet) =>
                pallet.palletCode.toLowerCase() ===
                field.palletCode.toLowerCase(),
            );
            return (
              <div className={styles.rawRow} key={field.id}>
                <label className={styles.check} style={{ gridColumn: "1/-1" }}>
                  <input
                    type="checkbox"
                    disabled={disabled}
                    {...form.register(`rawPallets.${index}.present`)}
                  />
                  <span>
                    Паллета {known?.palletCode ?? "с указанным кодом"} найдена
                    здесь
                  </span>
                </label>
                <label className="field">
                  Код паллеты
                  <Input
                    autoComplete="off"
                    readOnly={!!known}
                    disabled={disabled}
                    {...form.register(`rawPallets.${index}.palletCode`)}
                    aria-invalid={
                      !!form.formState.errors.rawPallets?.[index]?.palletCode
                    }
                  />
                  {form.formState.errors.rawPallets?.[index]?.palletCode && (
                    <span role="alert" className={styles.fieldError}>
                      {
                        form.formState.errors.rawPallets[index]?.palletCode
                          ?.message
                      }
                    </span>
                  )}
                </label>
                <label className="field">
                  Найдено, шт.
                  <Input
                    inputMode="numeric"
                    type="number"
                    step="1"
                    min="0"
                    max="100000000"
                    disabled={disabled || !rawValues[index]?.present}
                    {...form.register(`rawPallets.${index}.quantity`)}
                    aria-invalid={
                      !!form.formState.errors.rawPallets?.[index]?.quantity
                    }
                  />
                  {form.formState.errors.rawPallets?.[index]?.quantity && (
                    <span role="alert" className={styles.fieldError}>
                      {
                        form.formState.errors.rawPallets[index]?.quantity
                          ?.message
                      }
                    </span>
                  )}
                </label>
                {!known && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => raws.remove(index)}
                    aria-label={`Убрать паллету ${index + 1}`}
                  >
                    <X size={14} />
                  </Button>
                )}
                {known && (
                  <small>
                    {known.skuName} · {known.lotName} · по снимку{" "}
                    {known.quantity} шт.
                  </small>
                )}
              </div>
            );
          })}
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || raws.fields.length >= 200}
          onClick={() =>
            raws.append({ palletCode: "", quantity: "", present: true })
          }
        >
          <Plus size={14} />
          Другая найденная паллета
        </Button>
      </section>
      <section>
        <h4 className={styles.subheading}>Готовые короба</h4>
        {!!row.baseline.boxes.length && (
          <p className={styles.footerNote}>
            Отметьте только физически найденные короба. Неотмеченные будут
            записаны как отсутствующие после сохранения подсчёта.
          </p>
        )}
        <div className={styles.boxList}>
          {row.baseline.boxes.map((box) => (
            <label className={styles.boxCheck} key={box.id}>
              <input
                type="checkbox"
                disabled={disabled}
                checked={boxes.some(
                  (code) => code.toLowerCase() === box.code.toLowerCase(),
                )}
                onChange={(event) => toggleBox(box.code, event.target.checked)}
              />
              <span>{box.code}</span>
              <small>
                {box.skuName} · {box.units} шт.
              </small>
            </label>
          ))}
        </div>
        <div className={styles.scanLine}>
          <Input
            aria-label="Код другого найденного короба"
            placeholder="Другой найденный короб: введите код"
            autoComplete="off"
            value={boxCode}
            disabled={disabled || boxes.length >= 2000}
            onChange={(event) => {
              setBoxCode(event.target.value);
              setBoxError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addBox();
              }
            }}
          />
          <Button
            variant="secondary"
            disabled={disabled || boxes.length >= 2000}
            onClick={addBox}
          >
            Добавить код
          </Button>
        </div>
        {boxError && (
          <span className={styles.fieldError} role="alert">
            {boxError}
          </span>
        )}
        <div className={styles.tags}>
          {extras.map((code) => (
            <span className={styles.tag} key={code}>
              {code}
              <button
                type="button"
                disabled={disabled}
                onClick={() => toggleBox(code, false)}
                aria-label={`Убрать короб ${code}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
        <p className={styles.footerNote}>
          Неизвестный или найденный на другом адресе код сохранится как
          расхождение для проверки. Не создавайте для него новый товар.
        </p>
      </section>
      <label className={styles.check}>
        <input
          type="checkbox"
          disabled={disabled}
          {...form.register("inspected")}
        />
        <span>
          Я осмотрел(а) и пересчитал(а) ячейку {row.locationCode}. Введено всё
          фактически найденное, в том числе если ячейка пуста.
        </span>
      </label>
      {form.formState.errors.inspected && (
        <span role="alert" className={styles.fieldError}>
          {form.formState.errors.inspected.message}
        </span>
      )}
      {!!form.formState.errors.boxCodes && (
        <span role="alert" className={styles.fieldError}>
          Проверьте коды коробов: коды должны быть уникальными и не длиннее 150
          символов.
        </span>
      )}
      {blocked && <p className={styles.notice}>{blocked}</p>}
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      {dirty && (
        <p className={styles.draft}>
          Есть несохранённый подсчёт. Фоновое обновление его не сбрасывает.
        </p>
      )}
      <div className={styles.inlineActions}>
        <Button type="submit" disabled={disabled} aria-busy={pending}>
          Сохранить подсчёт ячейки
        </Button>
      </div>
    </form>
  );
}
