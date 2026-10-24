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
            checked={value === role}
            disabled={lastManager && role === "employee"}
            onChange={() => onChange(role)}
          />
          <span>
            <strong>{role === "manager" ? "Руководитель" : "Сотрудник"}</strong>
            <small>
              {role === "manager"
                ? "Управление складом и доступом"
                : "Своя смена и рабочие задания"}
            </small>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
