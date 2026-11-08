"use client";

import { useState } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { Button, Input, Modal } from "@/shared/ui";
import styles from "./stocktakes.module.css";

const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

export function StocktakeNumberField({
  id,
  label,
  min,
  max,
  decimal = false,
  disabled,
  hint,
  error,
  registration,
  value,
  onApply,
}: {
  id: string;
  label: string;
  min: number;
  max: number;
  decimal?: boolean;
  disabled: boolean;
  hint?: string;
  error?: string;
  registration: UseFormRegisterReturn;
  value: string;
  onApply: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft ?? "";
  const close = () => setDraft(null);

  const append = (key: string) => {
    const next = key === "." && !display ? "0." : display + key;
    const format = decimal ? /^\d+(\.\d?)?$/ : /^\d+$/;
    if (
      next.length <= String(max).length + (decimal ? 2 : 0) &&
      format.test(next)
    ) {
      setDraft(next);
    }
  };

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className={styles.numberEntry}>
        <Input
          id={id}
          type="number"
          inputMode={decimal ? "decimal" : "numeric"}
          min={min}
          max={max}
          step={decimal ? 0.1 : 1}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          {...registration}
        />
        <Button
          variant="secondary"
          size="sm"
          aria-label={`Цифры — ${label}`}
          aria-haspopup="dialog"
          disabled={disabled}
          onClick={() => setDraft(value)}
        >
          Цифры
        </Button>
      </div>
      {hint && <small>{hint}</small>}
      {error && (
        <span id={`${id}-error`} role="alert" className={styles.fieldError}>
          {error}
        </span>
      )}
      <Modal
        open={draft !== null}
        onClose={close}
        title={label}
        footer={
          <Button
            disabled={disabled}
            onClick={() => {
              onApply(display.replace(/\.$/, ""));
              close();
            }}
          >
            Готово
          </Button>
        }
      >
        <div className={styles.keypad}>
          <output aria-label="Введённое число">
            {display.replace(".", ",") || "—"}
          </output>
          {digits.map((digit) => (
            <Button
              key={digit}
              variant="secondary"
              onClick={() => append(digit)}
            >
              {digit}
            </Button>
          ))}
          {decimal ? (
            <Button variant="secondary" onClick={() => append(".")}>
              ,
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setDraft("")}>
              Очистить
            </Button>
          )}
          <Button variant="secondary" onClick={() => append("0")}>
            0
          </Button>
          <Button
            variant="ghost"
            aria-label="Удалить последнюю цифру"
            onClick={() => setDraft(display.slice(0, -1))}
          >
            ⌫
          </Button>
        </div>
      </Modal>
    </div>
  );
}
