"use client";
import { useId } from "react";
import styles from "./access.module.css";
export function RoleFields({
  value,
  onChange,
  disabled = false,
  lastManager = false,
}: {
  value: "manager" | "employee";
  onChange: (value: "manager" | "employee") => void;
  disabled?: boolean;
  lastManager?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className={styles.roles} disabled={disabled}>
      <legend>Роль доступа</legend>
      {(["employee", "manager"] as const).map((role) => (
        <label className={styles.role} key={role}>
          <input
            type="radio"
            name={name}
            checked={value === role}
            disabled={lastManager && role === "employee"}
            onChange={() => onChange(role)}
          />
          {role === "manager" ? "Руководитель" : "Сотрудник"}
        </label>
      ))}
    </fieldset>
  );
}
