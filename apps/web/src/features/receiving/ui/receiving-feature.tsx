"use client";
import { useEffect, useRef } from "react";
import { useSession } from "@/entities/session";
import { ArrowLeft, Plus } from "lucide-react";
import { useWorkspace } from "@/entities/workspace";
import { Button, ErrorState, LoadingState } from "@/shared/ui";
import type { PlacementValues, ReceiptValues } from "../lib/receipt-form";
import { filterReceipts } from "../lib/receipt-view";
import { useReceivingState } from "../lib/use-receiving-state";
import { useReceivePallet } from "../model/use-receive-pallet";
import { ReceiptCreateForm } from "./receipt-create-form";
import { ReceiptDetails } from "./receipt-details";
import { ReceiptList } from "./receipt-list";
import { ReceiptPlacement } from "./receipt-placement";
import styles from "./receiving.module.css";
export function ReceivingFeature() {
  const { isManager } = useSession();
  const workspace = useWorkspace();
  const commands = useReceivePallet();
  const state = useReceivingState();
  const heading = useRef<HTMLHeadingElement>(null);
  const previousReceipt = useRef(state.selectedId);
  useEffect(() => {
    if (previousReceipt.current !== state.selectedId) {
      previousReceipt.current = state.selectedId;
      heading.current?.focus();
    }
  }, [state.selectedId]);
  if (workspace.isPending) return <LoadingState />;
  if (!workspace.data)
    return <ErrorState onRetry={() => void workspace.refetch()} />;
  const data = workspace.data;
  const receipts = filterReceipts(data, state.view, state.search);
  const selected = data.receipts.find(
    (receipt) => receipt.id === state.selectedId,
  );
  const placementReceipt = data.receipts.find(
    (receipt) => receipt.id === state.placing?.receiptId,
  );
  const openCreate = () => {
    if (!isManager) return;
    commands.clearError();
    state.setNotice("");
    state.setCreating(true);
  };
  const create = async (values: ReceiptValues) => {
    try {
      const before = new Set(data.receipts.map((receipt) => receipt.id));
      const result = await commands.receive(values);
      const added =
        result.receipts.find((receipt) => !before.has(receipt.id)) ??
        result.receipts.find(
          (receipt) =>
            receipt.receivedAt ===
              new Date(`${values.receivedAt}:00+03:00`).toISOString() &&
            receipt.status !== "completed",
        );
      state.setCreating(false);
      state.setView("active");
      state.setSearch("");
      state.setSelectedId(added?.id ?? null);
      state.setNotice(added ? `${added.code} создана.` : "Приёмка создана.");
    } catch {
      /* Mutation exposes the readable error; preserve the form. */
    }
  };
  const place = async (values: PlacementValues) => {
    if (!state.placing) return;
    const { receiptId, palletId } = state.placing;
    try {
      const result = await commands.place(receiptId, palletId, values);
      const updated = result.receipts.find(
        (receipt) => receipt.id === receiptId,
      );
      const pallet = result.pallets.find((item) => item.id === palletId);
      state.setPlacing(null);
      if (updated?.status === "completed") {
        state.setView("archive");
        state.setSearch("");
        state.setNotice(`${updated.code} завершена.`);
      } else {
        state.setNotice(
          pallet ? `${pallet.code} размещена.` : "Паллета размещена.",
        );
      }
    } catch {
      /* Keep scans for correction or an idempotent retry. */
    }
  };
  return (
    <div className={styles.feature}>
      <header className={styles.pageHeader}>
        <h1 className="page-heading" ref={heading} tabIndex={-1}>
          Приёмка
        </h1>
        {selected ? (
          <Button
            variant="secondary"
            disabled={commands.pending}
            onClick={() => {
              state.setSelectedId(null);
              state.setNotice("");
            }}
          >
            <ArrowLeft size={15} aria-hidden="true" />К списку
          </Button>
        ) : (
          isManager && (
            <Button
              onClick={openCreate}
              disabled={commands.pending}
              aria-haspopup="dialog"
            >
              <Plus size={15} aria-hidden="true" />
              Новая приёмка
            </Button>
          )
        )}
      </header>
      {state.notice && (
        <p className={styles.notice} role="status">
          {state.notice}
        </p>
      )}
      {workspace.isError && (
        <div className={styles.readError} role="alert">
          Не удалось обновить приёмки.
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void workspace.refetch()}
          >
            Повторить
          </Button>
        </div>
      )}
      {selected ? (
        <ReceiptDetails
          receipt={selected}
          data={data}
          pending={commands.pending}
          onPlace={(palletId) => {
            commands.clearError();
            state.setPlacing({ receiptId: selected.id, palletId });
          }}
        />
      ) : (
        <ReceiptList
          receipts={receipts}
          skus={data.skus}
          view={state.view}
          search={state.search}
          isManager={isManager}
          onView={state.setView}
          onSearch={state.setSearch}
          onSelect={(id) => {
            state.setNotice("");
            state.setSelectedId(id);
          }}
        />
      )}
      {isManager && state.creating && (
        <ReceiptCreateForm
          data={data}
          pending={commands.pending}
          error={commands.error}
          onClose={() => state.setCreating(false)}
          onSave={create}
        />
      )}
      {state.placing && placementReceipt && (
        <ReceiptPlacement
          key={`${state.placing.receiptId}:${state.placing.palletId}`}
          receipt={placementReceipt}
          palletId={state.placing.palletId}
          data={data}
          pending={commands.pending}
          error={commands.error}
          onClose={() => state.setPlacing(null)}
          onPlace={place}
        />
      )}
    </div>
  );
}
