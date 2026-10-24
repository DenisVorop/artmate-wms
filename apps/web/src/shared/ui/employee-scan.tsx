"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ScanLine, Keyboard, Camera } from "lucide-react";
import { createScanQueue, type ScanQueueState } from "../lib/scan-queue";
import { getAuthEpoch } from "../api/auth-memory";
import { useEmployeeScanActivity } from "./employee-scan-activity";
import { useEmployeeScanGateway } from "./employee-scan-gateway";
import { EmployeeCamera } from "./employee-camera";
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
  const gateway = useEmployeeScanGateway();
  const intercepting = useRef(false);
  const selectAfterIntercept = useRef(false);
  const id = useId(),
    input = useRef<HTMLInputElement | null>(null);
  const [manual, setManual] = useState(false);
  const [camera, setCamera] = useState<{
    contextKey: string;
    epoch: number;
  } | null>(null);
  const cameraSession = useRef<typeof camera>(null);
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
        getAuthEpoch() === epoch &&
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
    selectAfterIntercept.current = false;
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
      !gateway.pending &&
      !document.querySelector("dialog[open]") &&
      (document.activeElement === document.body ||
        document.activeElement === input.current)
    )
      input.current?.focus({ preventScroll: true });
  }, [pending, disabled, gateway.pending]);
  useEffect(() => {
    if (
      !gateway.pending &&
      selectAfterIntercept.current &&
      !disabled &&
      !document.querySelector("dialog[open]")
    ) {
      input.current?.focus({ preventScroll: true });
      input.current?.select();
      selectAfterIntercept.current = false;
    }
  }, [gateway.pending, disabled]);
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
  const locked =
    disabled || gateway.pending || (!repeat && (pending || queueState.running));
  const submitCode = (values: z.infer<typeof schema>) => {
    if (locked || intercepting.current) return;
    const startContext = contextKey,
      epoch = getAuthEpoch();
    const current = () =>
      live.current.contextKey === startContext &&
      getAuthEpoch() === epoch &&
      !live.current.disabled;
    const selectField = () => {
      selectAfterIntercept.current = true;
      if (
        input.current &&
        !input.current.disabled &&
        !document.querySelector("dialog[open]")
      ) {
        input.current.focus({ preventScroll: true });
        input.current.select();
        selectAfterIntercept.current = false;
      }
    };
    const apply = (disposition: "pass" | "handled" | "blocked") => {
      if (!current()) return;
      if (disposition === "blocked") {
        if (queueState.failedCode) form.setValue("code", queueState.failedCode);
        setLocalError(
          "Код не применён. Завершите текущий шаг или устраните причину блокировки.",
        );
        selectField();
        return;
      }
      if (disposition === "handled") {
        form.reset({ code: "" });
        setLocalError(null);
        return;
      }
      if (queue.current?.enqueue(values.code)) {
        form.reset({ code: "" });
        setLocalError(null);
      } else {
        setLocalError("Дождитесь сохранения и повторите скан.");
        selectField();
      }
    };
    const fail = (failure: unknown) => {
      if (current()) {
        setLocalError(
          failure instanceof Error
            ? failure.message
            : "Не удалось обработать код. Повторите ввод.",
        );
        selectField();
      }
    };
    try {
      const result = gateway.intercept(values.code);
      if (typeof result === "string") {
        apply(result);
        return;
      }
      intercepting.current = true;
      void result.then(apply, fail).finally(() => {
        intercepting.current = false;
      });
    } catch (failure) {
      fail(failure);
    }
  };
  const cameraAllowed =
    !locked &&
    !pending &&
    (!queueState.pending || (!!queueState.failedCode && !queueState.running));
  const cameraLive = useRef({ cameraAllowed });
  cameraLive.current = { cameraAllowed };
  const cameraCurrent = (session: NonNullable<typeof camera>) =>
    live.current.contextKey === session.contextKey &&
    getAuthEpoch() === session.epoch &&
    !live.current.disabled &&
    cameraLive.current.cameraAllowed &&
    !intercepting.current;
  const closeCamera = () => {
    cameraSession.current = null;
    setCamera(null);
    requestAnimationFrame(() => {
      if (!live.current.disabled && !document.querySelector("dialog[open]"))
        input.current?.focus({ preventScroll: true });
    });
  };
  return (
    <form
      className={styles.form}
      onSubmit={form.handleSubmit(submitCode)}
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
        {gateway.pending
          ? "Обрабатываем код…"
          : error ||
            localError ||
            form.formState.errors.code?.message ||
            (queueState.pending
              ? `Сохраняем сканы${queueState.pending > 1 ? ` · ещё ${queueState.pending - 1}` : "…"}`
              : "Готов к сканированию")}
      </div>
      {queueState.failedCode && !queueState.running && (
        <details className={styles.recovery}>
          <summary>Отменить непринятые сканы</summary>
          <p>
            Без подтверждения: {queueState.pending}. Уже принятые сервером сканы
            сохранятся. Перед продолжением проверьте товар, который не получил
            подтверждения.
          </p>
          <button
            type="button"
            className="button button--secondary"
            disabled={gateway.pending || pending}
            onClick={() => {
              const discarded = queue.current?.discardFailed() ?? 0;
              if (!discarded) return;
              form.reset({ code: "" });
              setLocalError(null);
              selectAfterIntercept.current = false;
              input.current?.focus({ preventScroll: true });
              live.current.onProblem?.(
                `Отменено непринятых сканов: ${discarded}. Принятые сервером сканы сохранены. Проверьте товар без подтверждения перед продолжением.`,
              );
            }}
          >
            Отменить сканы ({queueState.pending})
          </button>
        </details>
      )}
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
        className={`button button--secondary ${styles.camera}`}
        disabled={!cameraAllowed}
        onClick={() => {
          if (!cameraAllowed || intercepting.current) return;
          const session = { contextKey, epoch: getAuthEpoch() };
          cameraSession.current = session;
          setCamera(session);
        }}
      >
        <Camera size={20} />
        Сканировать камерой
      </button>
      {camera && (
        <EmployeeCamera
          label={label}
          current={() =>
            cameraSession.current === camera && cameraCurrent(camera)
          }
          onClose={closeCamera}
          onCode={(code) => {
            if (cameraSession.current !== camera || !cameraCurrent(camera))
              return;
            closeCamera();
            form.setValue("code", code);
            // The same resolver, zone gateway and ordered queue as HID/manual input.
            void form.handleSubmit((values) => {
              if (cameraCurrent(camera)) submitCode(values);
            })();
          }}
        />
      )}
      <button
        type="button"
        className={styles.manual}
        onClick={() => {
          setManual(!manual);
          input.current?.focus({ preventScroll: true });
        }}
        disabled={disabled || gateway.pending}
      >
        <Keyboard size={17} />
        {manual ? "Вернуться к сканеру" : "Ввести код вручную"}
      </button>
    </form>
  );
}
