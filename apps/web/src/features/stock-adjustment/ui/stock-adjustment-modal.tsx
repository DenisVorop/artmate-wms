"use client";

import { useEffect, useId } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { WorkspaceDto } from "@/shared/api/generated/model";
import { Button, Input, Modal, Select } from "@/shared/ui";
import {
  adjustmentDefaults,
  adjustmentSchemaFor,
  type AdjustmentValues,
} from "../lib/adjustment-form";
import {
  adjustmentSnapshotChanged,
  captureAdjustmentSnapshot,
  eligibleAdjustmentTargets,
  type AdjustmentKind,
} from "../lib/adjustment-targets";
import { useAdjustmentState } from "../lib/use-adjustment-state";
import { useStockAdjustment } from "../model/use-stock-adjustment";
import styles from "./stock-adjustment.module.css";

type Props = { data: WorkspaceDto; open: boolean; onClose: () => void };
const number = (value: number) => value.toLocaleString("ru-RU");

export function StockAdjustmentModal({ data, open, onClose }: Props) {
  const state = useAdjustmentState();
  const command = useStockAdjustment();
  const id = useId();
  const form = useForm<AdjustmentValues>({
    resolver: zodResolver(adjustmentSchemaFor(state.snapshot)),
    defaultValues: adjustmentDefaults,
  });
  const {
    register,
    watch,
    setValue,
    setError,
    reset,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = form;
  const values = watch();
  useEffect(() => {
    if (open) {
      reset(adjustmentDefaults);
      state.setSnapshot(null);
      state.setConfirming(false);
      command.clearError();
    }
    // A polling snapshot must never reset an entered count or its expected base.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reset]);
  const busy = command.pending || isSubmitting;
  const targets = eligibleAdjustmentTargets(data, values.kind);
  const workers = data.employees.filter(
    (employee) => employee.status === "working",
  );
  const employee = data.employees.find(
    (employee) => employee.id === values.employeeId,
  );
  const stale = state.snapshot
    ? adjustmentSnapshotChanged(data, state.snapshot)
    : null;
  const canRefresh =
    state.snapshot &&
    captureAdjustmentSnapshot(
      data,
      state.snapshot.kind,
      state.snapshot.targetId,
    );
  const close = () => {
    if (!busy) onClose();
  };
  function chooseTarget(targetId: string) {
    const snapshot = captureAdjustmentSnapshot(data, values.kind, targetId);
    state.setSnapshot(snapshot);
    state.setConfirming(false);
    setValue("targetId", targetId, { shouldValidate: true });
    setValue(
      "countedQuantity",
      snapshot?.kind === "raw_count" ? snapshot.expectedQuantity : 0,
    );
    command.clearError();
  }
  function validateLive() {
    if (
      !state.snapshot ||
      state.snapshot.targetId !== values.targetId ||
      state.snapshot.kind !== values.kind
    ) {
      setError("targetId", {
        message: "Повторно выберите объект корректировки",
      });
      return false;
    }
    if (stale) {
      setError("targetId", { message: stale });
      return false;
    }
    if (!employee || employee.status !== "working") {
      setError("employeeId", {
        message: "Сотрудник должен находиться на смене",
      });
      return false;
    }
    return true;
  }
  const snapshot = state.snapshot;
  const after = values.kind === "box_writeoff" ? 0 : values.countedQuantity;
  const delta = snapshot
    ? (after - snapshot.expectedQuantity) * snapshot.units
    : 0;
  return (
    <Modal
      open={open}
      onClose={close}
      title={
        state.confirming ? "Проверьте корректировку" : "Корректировка остатков"
      }
      description="Изменение сохранится в журнале вместе с исполнителем и причиной."
    >
      <form
        className={styles.form}
        onSubmit={handleSubmit(async (parsed) => {
          if (!validateLive()) return;
          if (!state.confirming) {
            state.setConfirming(true);
            return;
          }
          try {
            await command.apply(parsed, state.snapshot!);
            onClose();
          } catch {
            /* Preserve count, expectation, reason and server error. */
          }
        })}
      >
        {!state.confirming ? (
          <>
            <label className="field" htmlFor={`${id}-kind`}>
              Операция
              <Select
                id={`${id}-kind`}
                {...register("kind", {
                  onChange: (event) => {
                    const kind = event.target.value as AdjustmentKind;
                    setValue("kind", kind);
                    setValue("targetId", "");
                    setValue("countedQuantity", 0);
                    state.setSnapshot(null);
                    state.setConfirming(false);
                    command.clearError();
                  },
                })}
                disabled={busy}
              >
                <option value="raw_count">Пересчёт раскрасок до сборки</option>
                <option value="box_writeoff">Списание целого короба</option>
              </Select>
            </label>
            <label className="field" htmlFor={`${id}-target`}>
              {values.kind === "raw_count" ? "Паллета раскрасок" : "Короб"}
              <Select
                id={`${id}-target`}
                {...register("targetId")}
                value={values.targetId}
                onChange={(event) => chooseTarget(event.target.value)}
                disabled={busy}
                aria-invalid={!!errors.targetId}
                aria-describedby={`${id}-target-help`}
              >
                <option value="">Выберите объект</option>
                {snapshot &&
                  !targets.some(
                    (target) => target.targetId === snapshot.targetId,
                  ) && (
                    <option value={snapshot.targetId} disabled>
                      {snapshot.code} — сейчас недоступен
                    </option>
                  )}
                {targets.map((target) => (
                  <option value={target.targetId} key={target.targetId}>
                    {target.code} · {target.skuName} · {target.locationCode} ·{" "}
                    {number(target.expectedQuantity)}{" "}
                    {target.kind === "raw_count" ? "шт." : "короб"}
                  </option>
                ))}
              </Select>
              {errors.targetId && (
                <span className={styles.error}>{errors.targetId.message}</span>
              )}
            </label>
            <p id={`${id}-target-help`} className={styles.hint}>
              {targets.length
                ? "Доступны объекты на хранении без резервов и незавершённых перемещений."
                : "Подходящих объектов нет. Проверьте размещение, резервы и задания перемещения."}
            </p>
            {snapshot && (
              <div className={styles.base}>
                <span>Зафиксировано при выборе</span>
                <strong>
                  {snapshot.code} · {snapshot.locationCode}
                </strong>
                <span>
                  {snapshot.skuName} ({snapshot.skuCode})
                </span>
                <strong>
                  {number(snapshot.expectedQuantity)}{" "}
                  {snapshot.kind === "raw_count"
                    ? "шт."
                    : `короб · ${number(snapshot.units)} шт.`}
                </strong>
              </div>
            )}
            <label className="field" htmlFor={`${id}-employee`}>
              Исполнитель на смене
              <Select
                id={`${id}-employee`}
                {...register("employeeId")}
                disabled={busy}
                aria-invalid={!!errors.employeeId}
              >
                <option value="">Выберите сотрудника</option>
                {values.employeeId &&
                  !workers.some((item) => item.id === values.employeeId) && (
                    <option value={values.employeeId} disabled>
                      {employee?.name ?? "Сотрудник"} — вне смены
                    </option>
                  )}
                {workers.map((worker) => (
                  <option key={worker.id} value={worker.id}>
                    {worker.name}
                  </option>
                ))}
              </Select>
              {errors.employeeId && (
                <span className={styles.error}>
                  {errors.employeeId.message}
                </span>
              )}
            </label>
            {!workers.length && (
              <p className={styles.hint}>
                Сначала начните смену сотрудника на странице «Команда».
              </p>
            )}
            {values.kind === "raw_count" ? (
              <label className="field" htmlFor={`${id}-count`}>
                Фактическое количество, шт.
                <Input
                  id={`${id}-count`}
                  type="number"
                  min={0}
                  max={100000000}
                  step={1}
                  inputMode="numeric"
                  {...register("countedQuantity", { valueAsNumber: true })}
                  disabled={busy}
                  aria-invalid={!!errors.countedQuantity}
                />
                {errors.countedQuantity && (
                  <span className={styles.error}>
                    {errors.countedQuantity.message}
                  </span>
                )}
              </label>
            ) : (
              <p className={styles.hint}>
                Короб списывается целиком вместе с сохранённым составом партий.
                После списания: 0 коробов.
              </p>
            )}
            <label className="field" htmlFor={`${id}-reason`}>
              Причина
              <textarea
                id={`${id}-reason`}
                className={`input ${styles.reason}`}
                rows={3}
                maxLength={500}
                placeholder="Например, недостача при пересчёте или повреждение короба"
                {...register("reason")}
                disabled={busy}
                aria-invalid={!!errors.reason}
              />
              {errors.reason && (
                <span className={styles.error}>{errors.reason.message}</span>
              )}
            </label>
          </>
        ) : (
          snapshot && (
            <section className={styles.summary} aria-label="Итог корректировки">
              <div className={styles.summaryTitle}>
                {values.kind === "raw_count"
                  ? "Пересчёт раскрасок"
                  : "Списание целого короба"}
              </div>
              <dl>
                <dt>Объект</dt>
                <dd>{snapshot.code}</dd>
                <dt>Тематика</dt>
                <dd>
                  {snapshot.skuName} · {snapshot.skuCode}
                </dd>
                <dt>Адрес</dt>
                <dd>{snapshot.locationCode}</dd>
                <dt>До → после</dt>
                <dd>
                  {number(snapshot.expectedQuantity)} → {number(after)}{" "}
                  {snapshot.kind === "raw_count" ? "шт." : "коробов"}
                </dd>
                <dt>Изменение баланса</dt>
                <dd className={styles.delta}>
                  {delta > 0 ? "+" : ""}
                  {number(delta)} шт.
                </dd>
                <dt>Исполнитель</dt>
                <dd>{employee?.name}</dd>
                <dt>Причина</dt>
                <dd className={styles.reasonText}>{values.reason.trim()}</dd>
              </dl>
              <p className={styles.hint}>
                {values.kind === "raw_count"
                  ? "Запись останется в журнале. Исправить количество можно следующей корректировкой."
                  : "Короб останется в истории со статусом «Списан» и будет исключён из баланса и отгрузок. Восстановление списанного короба пока не предусмотрено."}
              </p>
            </section>
          )
        )}
        {stale && (
          <div className={styles.warning} role="alert">
            <p>{stale}</p>
            <p>Ожидаемый остаток и адрес в форме не изменены.</p>
            {canRefresh && (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  state.setSnapshot(canRefresh);
                  state.setConfirming(false);
                  form.clearErrors("targetId");
                  command.clearError();
                }}
              >
                Обновить исходные данные
              </Button>
            )}
          </div>
        )}
        {state.confirming && employee?.status !== "working" && (
          <p className={styles.serverError} role="alert">
            Исполнитель сейчас вне смены. Вернитесь к данным и выберите
            сотрудника на смене.
          </p>
        )}
        {command.error && (
          <div className={styles.serverError} role="alert">
            {command.error}
          </div>
        )}
        {busy && (
          <p className={styles.hint} role="status">
            Сохраняем корректировку…
          </p>
        )}
        <div className={styles.actions}>
          {state.confirming ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => state.setConfirming(false)}
            >
              Вернуться к данным
            </Button>
          ) : (
            <Button variant="secondary" disabled={busy} onClick={close}>
              Отмена
            </Button>
          )}
          <Button
            type="submit"
            variant={
              state.confirming && values.kind === "box_writeoff"
                ? "danger"
                : "primary"
            }
            disabled={busy || !!stale || !snapshot || !workers.length}
            aria-busy={busy}
          >
            {state.confirming
              ? values.kind === "box_writeoff"
                ? "Списать короб"
                : "Применить корректировку"
              : "Проверить корректировку"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
