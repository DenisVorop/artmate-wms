"use client";
import {
  rollLabelFormats,
  type RollLabelFormat,
} from "@/shared/lib/label-paper";
import styles from "./roll-label-format.module.css";
export function rollPaperClass(format: RollLabelFormat) {
  return format === "58x40"
    ? styles.boxCompact
    : format === "a4"
      ? styles.palletSheet
      : format === "120x75"
        ? styles.addressLandscape
        : format === "75x120"
          ? styles.portrait
          : styles.landscape;
}
export function RollLabelFormatSelect({
  value,
  onChange,
  formats = ["75x120", "100x70"],
}: {
  value: RollLabelFormat;
  formats?: readonly RollLabelFormat[];
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
        {formats.map((key) => (
          <option key={key} value={key}>
            {rollLabelFormats[key]}
          </option>
        ))}
      </select>
    </label>
  );
}
