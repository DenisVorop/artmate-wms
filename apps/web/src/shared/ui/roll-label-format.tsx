"use client";
import {
  rollLabelFormats,
  type RollLabelFormat,
} from "@/shared/lib/label-paper";
import styles from "./roll-label-format.module.css";
export function rollPaperClass(format: RollLabelFormat) {
  return format === "75x120" ? styles.portrait : styles.landscape;
}
export function RollLabelFormatSelect({
  value,
  onChange,
}: {
  value: RollLabelFormat;
  onChange: (value: RollLabelFormat) => void;
}) {
  return (
    <label className={`field ${styles.control}`}>
      Формат этикетки
      <select
        className="input"
        value={value}
        onChange={(event) => onChange(event.target.value as RollLabelFormat)}
      >
        {Object.entries(rollLabelFormats).map(([key, title]) => (
          <option key={key} value={key}>
            {title}
          </option>
        ))}
      </select>
    </label>
  );
}
