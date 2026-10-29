"use client";
import { get, useFormContext, type FieldError } from "react-hook-form";
import { Input, Select } from "@/shared/ui";
import { nullableNumberFromInput } from "../lib/number-input";
import styles from "./warehouse-layout.module.css";

export function ProfileFields({
  prefix = "",
  lockAccessSides = false,
}: {
  prefix?: string;
  lockAccessSides?: boolean;
}) {
  const {
    register,
    formState: { errors },
  } = useFormContext();
  const path = (name: string) => (prefix ? `${prefix}.${name}` : name);
  const error = (name: string) =>
    get(errors, path(name)) as FieldError | undefined;
  const textFields = [
    ["code", "Адрес яруса / места", "A-01-02"],
    ["name", "Название адреса", "Секция A · Ярус 2"],
  ] as const;
  const numericFields = [
    ["availableWidthMm", "Полезная ширина, мм", 100],
    ["availableDepthMm", "Полезная глубина, мм", 100],
    ["maxHeightMm", "Полезная высота, мм", 100],
    ["maxBoxes", "Вместимость, коробов", 1],
  ] as const;
  return (
    <div className={styles.formGrid}>
      {textFields.map(([name, label, placeholder]) => (
        <label className="field" key={name}>
          {label}
          <Input
            {...register(path(name))}
            placeholder={placeholder}
            aria-invalid={!!error(name)}
          />
          {error(name) && (
            <span className={styles.fieldError}>{error(name)?.message}</span>
          )}
        </label>
      ))}
      {numericFields.map(([name, label, step]) => (
        <label className="field" key={name}>
          {label}
          <Input
            type="number"
            step={step}
            {...register(path(name), { valueAsNumber: true })}
            aria-invalid={!!error(name)}
          />
          {error(name) && (
            <span className={styles.fieldError}>{error(name)?.message}</span>
          )}
        </label>
      ))}
      <label className="field">
        Лимит массы, кг
        <Input
          type="number"
          step="0.1"
          placeholder="Без ограничения"
          {...register(path("maxWeightKg"), {
            setValueAs: nullableNumberFromInput,
          })}
          aria-invalid={!!error("maxWeightKg")}
        />
        {error("maxWeightKg") && (
          <span className={styles.fieldError}>
            {error("maxWeightKg")?.message}
          </span>
        )}
      </label>
      <label className="field">
        Сторон доступа
        <Select
          {...register(path("accessSides"), { valueAsNumber: true })}
          aria-readonly={lockAccessSides}
        >
          {(lockAccessSides ? [4] : [1, 2, 3, 4]).map((count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </Select>
        {error("accessSides") && (
          <span className={styles.fieldError}>
            {error("accessSides")?.message}
          </span>
        )}
      </label>
      <p className={`${styles.hint} ${styles.fullWidth}`}>
        Вместимость в коробах — верхний предел. Фактическое размещение также
        ограничивают высота и схема укладки паллеты. Если задан лимит массы,
        масса паллеты должна быть известна.
      </p>
    </div>
  );
}
