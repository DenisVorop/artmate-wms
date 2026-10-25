"use client";
import { Button, useEmployeeScanActivity } from "@/shared/ui";
import { selectReceipt, workBlock } from "../lib/handling";
import { useHandlingState } from "../lib/use-handling-state";
import { useHandling } from "../model/use-handling";
import { useHandlingOptions } from "../model/use-handling-options";
import { Done, HandlingFrame, PairScan } from "./handling-parts";
import type { EmployeeHandlingProps } from "./employee-putaway";
import styles from "./handling.module.css";
export function EmployeeReceiving({
  data,
  onIdle,
  onProblem,
}: EmployeeHandlingProps) {
  const { employeeId, commands, execute } = useHandling();
  const { pending: scanPending } = useEmployeeScanActivity();
  const assignment = data.warehouse.zoneWork?.find(
    (work) => work.employeeId === employeeId && work.jobKind === "receiving",
  );
  const candidate = assignment
    ? data.receipts.find((receipt) => receipt.id === assignment.jobId)
    : selectReceipt(data.receipts);
  const state = useHandlingState(
    assignment?.palletId ??
      candidate?.pallets.find((p) => !p.placedAt)?.palletId,
  );
  const next = () => {
    if (scanPending > 0 || commands.pending) return;
    commands.clearError();
    state.next();
  };
  const receipt = state.selectedId
    ? data.receipts.find((r) =>
        r.pallets.some((p) => p.palletId === state.selectedId),
      )
    : candidate;
  const row =
    receipt?.pallets.find((p) => p.palletId === state.selectedId) ??
    receipt?.pallets.find((p) => !p.placedAt);
  const pallet = data.pallets.find((p) => p.id === row?.palletId);
  const sku = data.skus.find((s) => s.id === row?.skuId);
  const options = useHandlingOptions(
    "receiving",
    receipt?.id ?? "",
    pallet?.id ?? "",
    !!row && !row.placedAt && !state.done,
  );
  const suggested = options.data?.locations.find(
    (l) => l.id === options.data.suggestedLocationId,
  );
  const block = workBlock(data, employeeId, "receiving");
  const done = state.done || !!row?.placedAt;
  return (
    <HandlingFrame
      title="Размещение приёмки"
      code={receipt?.code}
      onIdle={onIdle}
      onProblem={onProblem}
      pending={commands.pending}
    >
      {done ? (
        <Done
          message="Паллета размещена и зачислена на баланс."
          onNext={next}
        />
      ) : !receipt || !row ? (
        <>
          <p>
            {state.selectedId
              ? "Выбранная паллета больше недоступна."
              : "Паллет, ожидающих размещения, пока нет."}
          </p>
          {state.selectedId && (
            <Button
              disabled={commands.pending || scanPending > 0}
              onClick={next}
            >
              Обновить выбор паллеты
            </Button>
          )}
        </>
      ) : (
        <>
          <h2>{sku?.name ?? "Тематика недоступна"}</h2>
          <p>
            {row.quantity.toLocaleString("ru-RU")} раскрасок ·{" "}
            {pallet?.code ?? "Паллета недоступна"}
          </p>
          {!assignment &&
            receipt.pallets.filter((p) => !p.placedAt).length > 1 && (
              <details>
                <summary>Другая паллета</summary>
                <div
                  className={styles.choices}
                  aria-label="Паллеты текущей приёмки"
                >
                  {receipt.pallets
                    .filter((p) => !p.placedAt)
                    .map((p) => (
                      <Button
                        key={p.palletId}
                        variant="secondary"
                        disabled={commands.pending || scanPending > 0}
                        aria-pressed={p.palletId === row.palletId}
                        onClick={() => {
                          if (scanPending > 0 || commands.pending) return;
                          commands.clearError();
                          state.setSelectedId(p.palletId);
                        }}
                      >
                        {data.pallets.find((item) => item.id === p.palletId)
                          ?.code ?? p.palletId}{" "}
                        ·{" "}
                        {data.skus.find((s) => s.id === p.skuId)?.name ??
                          "Тематика"}{" "}
                        · {p.quantity.toLocaleString("ru-RU")} шт.
                      </Button>
                    ))}
                </div>
              </details>
            )}
          {block && <p className={styles.notice}>{block}</p>}
          {options.isPending ? (
            <p role="status">Подбираем адрес по габаритам паллеты…</p>
          ) : options.isError ? (
            <>
              <p role="alert">
                Не удалось обновить доступные адреса. Сканы сохранены.
              </p>
              <Button
                variant="secondary"
                onClick={() => void options.refetch()}
              >
                Повторить подбор
              </Button>
            </>
          ) : !suggested ? (
            <>
              <p className={styles.notice}>
                {options.data?.reason ??
                  "Подходящих свободных адресов пока нет."}
              </p>
              <Button
                variant="secondary"
                onClick={() => void options.refetch()}
              >
                Обновить подбор
              </Button>
            </>
          ) : null}
          {pallet && (
            <PairScan
              key={`${employeeId}:${receipt.id}:${pallet.id}`}
              contextKey={`${receipt.id}:${pallet.id}`}
              type="pallet"
              id={pallet.id}
              code={pallet.code}
              addressCode={
                suggested?.code ??
                (options.data?.locations.length
                  ? "Выберите адрес хранения"
                  : "Ожидаем свободный адрес")
              }
              addressId={suggested?.id}
              data={data}
              phase="place"
              pending={commands.pending}
              error={commands.error}
              disabled={!!block || !options.data?.locations.length}
              onProblem={onProblem}
              onConfirm={(palletCode, locationCode) =>
                execute(
                  () =>
                    commands.placeReceiptPallet(receipt.id, pallet.id, {
                      requestId: crypto.randomUUID(),
                      employeeId,
                      palletCode,
                      locationCode,
                    }),
                  () => {
                    state.setSelectedId(pallet.id);
                    state.setDone(true);
                  },
                )
              }
            />
          )}
        </>
      )}
    </HandlingFrame>
  );
}
