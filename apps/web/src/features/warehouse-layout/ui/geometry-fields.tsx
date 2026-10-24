"use client";
import { get, useFormContext, type FieldError } from "react-hook-form";
import { Input, Select } from "@/shared/ui";
import styles from "./warehouse-layout.module.css";
export function GeometryFields({ minimumSize }: { minimumSize?: number } = {}) {
  const {
    register,
    formState: { errors },
  } = useFormContext();
  return (
    <div className={styles.formGrid}>
      {[
        ["width", "Ширина на плане, м"],
        ["depth", "Глубина на плане, м"],
        ["x", "Положение X, м"],
        ["y", "Положение Y, м"],
      ].map(([name, label]) => {
        const error = get(errors, name) as FieldError | undefined;
        return (
          <label className="field" key={name}>
            {label}
            <Input
              type="number"
              step="any"
              min={name === "width" || name === "depth" ? minimumSize : 0}
              {...register(name, { valueAsNumber: true })}
              aria-invalid={!!error}
            />
            {error && (
              <span className={styles.fieldError}>{error.message}</span>
            )}
          </label>
        );
      })}
      <label className="field">
        Поворот на плане
        <Select {...register("rotation", { valueAsNumber: true })}>
          {[0, 90, 180, 270].map((rotation) => (
            <option value={rotation} key={rotation}>
              {rotation}°
            </option>
          ))}
        </Select>
        {get(errors, "rotation") && (
          <span className={styles.fieldError}>
            {String(get(errors, "rotation.message"))}
          </span>
        )}
      </label>
    </div>
  );
}
