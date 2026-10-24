"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ScanLine, Keyboard } from "lucide-react";
import { createScanQueue, type ScanQueueState } from "../lib/scan-queue";
import { getAuthEpoch } from "../api/auth-memory";
import { useEmployeeScanActivity } from "./employee-scan-activity";
import styles from "./employee-scan.module.css";
const schema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Отсканируйте код")
    .max(500, "Код слишком длинный"),
});
export type EmployeeScanProps = {
  contextKey: string;
  label: string;
  onScan: (value: string) => Promise<boolean>;
  pending?: boolean;
  disabled?: boolean;
  error?: string | null;
  repeat?: boolean;
  onProblem?: (message: string) => void;
};
export function EmployeeScan({
  contextKey,
  label,
  onScan,
  pending = false,
  disabled = false,
  error,
  repeat = false,
  onProblem,
}: EmployeeScanProps) {
  const activity = useEmployeeScanActivity();
  const id = useId(),
    input = useRef<HTMLInputElement | null>(null);
  const [manual, setManual] = useState(false);
  const [queueState, setQueueState] = useState<ScanQueueState>({
    pending: 0,
    running: false,
    failedCode: null,
  });
  const [localError, setLocalError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { code: "" },
  });
  const live = useRef({
    contextKey,
    onScan,
    onProblem,
    disabled,
    epoch: getAuthEpoch(),
  });
  live.current = {
    contextKey,
    onScan,
    onProblem,
    disabled,
    epoch: getAuthEpoch(),
  };
  const queue = useRef<ReturnType<typeof createScanQueue> | null>(null);
  useEffect(() => {
    const epoch = getAuthEpoch();
    const processor = createScanQueue({
      repeat,
      isCurrent: () =>
        live.current.contextKey === contextKey &&
        live.current.epoch === epoch &&
        !live.current.disabled,
      accept: (value) => live.current.onScan(value),
      changed: setQueueState,
      failed: (value) => {
        form.setValue("code", value);
        setLocalError("Скан не принят. Проверьте код и повторите.");
        if (document.activeElement === input.current) {
          input.current?.select();
        }
      },
      dropped: (count) =>
        live.current.onProblem?.(
          `Не подтверждено сканов: ${count}. Остановитесь и проверьте текущий шаг.`,
        ),
    });
    queue.current = processor;
    setQueueState({ pending: 0, running: false, failedCode: null });
    setLocalError(null);
    form.reset({ code: "" });
    if (!disabled && !document.querySelector("dialog[open]"))
      input.current?.focus({ preventScroll: true });
    return () => {
      if (queue.current === processor) queue.current = null;
      processor.close();
    };
  }, [contextKey, repeat]);
  useEffect(() => {
    if (
      !disabled &&
      !pending &&
      !document.querySelector("dialog[open]") &&
      (document.activeElement === document.body ||
        document.activeElement === input.current)
    )
      input.current?.focus({ preventScroll: true });
  }, [pending, disabled]);
  useEffect(() => {
    const restore = () => {
      if (
        live.current.disabled ||
        document.visibilityState === "hidden" ||
        document.querySelector("dialog[open]")
      )
        return;
      const active = document.activeElement;
      if (
        active &&
        active !== document.body &&
        active !== input.current &&
        !(active instanceof HTMLAnchorElement)
      )
        return;
      input.current?.focus({ preventScroll: true });
    };
    window.addEventListener("focus", restore);
    document.addEventListener("visibilitychange", restore);
    return () => {
      window.removeEventListener("focus", restore);
      document.removeEventListener("visibilitychange", restore);
    };
  }, []);
  useEffect(() => {
    activity.report(id, queueState.pending);
    return () => activity.report(id, 0);
  }, [id, queueState.pending, activity.report]);
  const field = form.register("code");
  const locked = disabled || (!repeat && (pending || queueState.running));
  return (
    <form
      className={styles.form}
      onSubmit={form.handleSubmit((values) => {
        if (locked) return;
        if (queue.current?.enqueue(values.code)) {
          form.reset({ code: "" });
          setLocalError(null);
        } else setLocalError("Дождитесь сохранения и повторите скан.");
      })}
      noValidate
    >
      <label className={styles.label} htmlFor={id}>
        <ScanLine size={20} />
        {label}
      </label>
      <input
        {...field}
        ref={(node) => {
          field.ref(node);
          input.current = node;
        }}
        id={id}
        className={styles.input}
        inputMode={manual ? "text" : "none"}
        enterKeyHint="done"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        placeholder={manual ? "Введите код" : "Сканируйте код"}
        disabled={locked}
        aria-invalid={!!(error || localError || form.formState.errors.code)}
        aria-describedby={`${id}-status`}
      />
      <div
        id={`${id}-status`}
        className={styles.status}
        role={error || localError ? "alert" : "status"}
        aria-live="polite"
      >
        {error ||
          localError ||
          form.formState.errors.code?.message ||
          (queueState.pending
            ? `Сохраняем сканы${queueState.pending > 1 ? ` · ещё ${queueState.pending - 1}` : "…"}`
            : "Готов к сканированию")}
      </div>
      {manual && (
        <button
          type="submit"
          className={`button button--primary ${styles.submit}`}
          disabled={locked}
        >
          Отправить код
        </button>
      )}
      <button
        type="button"
        className={styles.manual}
        onClick={() => {
          setManual(!manual);
          input.current?.focus({ preventScroll: true });
        }}
        disabled={disabled}
      >
        <Keyboard size={17} />
        {manual ? "Вернуться к сканеру" : "Ввести код вручную"}
      </button>
    </form>
  );
}
