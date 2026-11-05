"use client";
import Link from "next/link";
import { useSession } from "@/entities/session";
import { ArrowDownLeft, Check, Plus, Search } from "lucide-react";
import { useWorkspace } from "@/entities/workspace";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
} from "@/shared/ui";
import { number } from "@/shared/lib/format";
import type { PlacementValues, ReceiptValues } from "../lib/receipt-form";
import {
  filterReceipts,
  receiptDate,
  receiptProgress,
  receiptStatusLabels,
} from "../lib/receipt-view";
import { useReceivingState } from "../lib/use-receiving-state";
import { useReceivePallet } from "../model/use-receive-pallet";
import { ReceiptCreateForm } from "./receipt-create-form";
import { ReceiptDetails } from "./receipt-details";
import { ReceiptPlacement } from "./receipt-placement";
import styles from "./receiving.module.css";
export function ReceivingFeature() {
  const { isManager } = useSession();
  const workspace = useWorkspace();
  const commands = useReceivePallet();
  const state = useReceivingState();
  if (workspace.isPending) return <LoadingState />;
  if (!workspace.data)
    return <ErrorState onRetry={() => void workspace.refetch()} />;
  const data = workspace.data;
  const receipts = filterReceipts(data, state.view, state.search);
  const selected =
    receipts.find((receipt) => receipt.id === state.selectedId) ?? receipts[0];
  const placementReceipt = data.receipts.find(
    (receipt) => receipt.id === state.placing?.receiptId,
  );
  const active = data.receipts.filter(
    (receipt) => receipt.status !== "completed",
  );
  const awaiting = active.flatMap((receipt) =>
    receipt.pallets.filter((row) => !row.placedAt),
  );
  const openCreate = () => {
    if (!isManager) return;
    commands.clearError();
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
      state.setCompletedId(null);
      state.setNotice(
        `Приёмка ${added?.code ?? ""} создана. Наклейте готовые этикетки и разместите каждую паллету, чтобы зачислить товар на баланс.`,
      );
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
        state.setCompletedId(updated.id);
        state.setNotice(
          `Приёмка ${updated.code} завершена. Все паллеты размещены и доступны на балансе.`,
        );
      } else {
        state.setCompletedId(null);
        state.setNotice(
          `Паллета ${pallet?.code ?? ""} размещена. Товар зачислен на баланс.`,
        );
      }
    } catch {
      /* Keep scans for correction or an idempotent retry. */
    }
  };
  return (
    <div className={styles.feature}>
      <div className="page-header">
        <div>
          <p className="eyebrow">ВХОДЯЩИЕ ПОСТАВКИ</p>
          <h1 className="page-heading">Приёмка</h1>
          <p className="page-description">
            Создайте приёмку. Сотрудник наклеит готовые этикетки и разместит
            паллеты.
          </p>
        </div>
        {isManager && (
          <div className={styles.headerActions}>
            <Link href="/labels/pallets" className="button button--secondary">
              Этикетки паллет
            </Link>
            <Button onClick={openCreate} disabled={commands.pending}>
              <Plus size={16} />
              Новая приёмка
            </Button>
          </div>
        )}
      </div>
      <div className={styles.stats}>
        <div className={`glass-panel ${styles.stat}`}>
          <span>Активные приёмки</span>
          <strong>{number(active.length)}</strong>
        </div>
        <div className={`glass-panel ${styles.stat}`}>
          <span>Паллеты ждут размещения</span>
          <strong>{number(awaiting.length)}</strong>
        </div>
        <div className={`glass-panel ${styles.stat}`}>
          <span>Ещё не на балансе, шт.</span>
          <strong>
            {number(awaiting.reduce((sum, row) => sum + row.quantity, 0))}
          </strong>
        </div>
      </div>
      {state.notice && (
        <div className={styles.notice} role="status">
          <Check size={17} />
          <span>{state.notice}</span>
          {state.completedId && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                state.setView("archive");
                state.setSearch("");
                state.setSelectedId(state.completedId);
              }}
            >
              Открыть в архиве
            </Button>
          )}
        </div>
      )}
      {workspace.isError && (
        <div className={styles.readError} role="alert">
          <p>
            Не удалось обновить данные. Показана последняя загруженная версия;
            открытые формы сохранены.
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void workspace.refetch()}
          >
            Обновить данные
          </Button>
        </div>
      )}
      <div className={styles.layout}>
        <section
          className={`glass-panel ${styles.documents}`}
          aria-label="Документы приёмки"
        >
          <div className={styles.toolbar}>
            <div className={styles.tabs} aria-label="Показать приёмки">
              <button
                type="button"
                aria-pressed={state.view === "active"}
                onClick={() => {
                  state.setView("active");
                  state.setSelectedId(null);
                }}
              >
                Активные · {active.length}
              </button>
              <button
                type="button"
                aria-pressed={state.view === "archive"}
                onClick={() => {
                  state.setView("archive");
                  state.setSelectedId(null);
                }}
              >
                Архив · {data.receipts.length - active.length}
              </button>
            </div>
            <label className={styles.search}>
              <Search size={15} />
              <Input
                placeholder="Код приёмки или тематика"
                aria-label="Поиск приёмки"
                value={state.search}
                onChange={(event) => state.setSearch(event.target.value)}
              />
            </label>
          </div>
          <div className={styles.documentsList}>
            {receipts.map((receipt) => {
              const progress = receiptProgress(receipt);
              const themes = [
                ...new Set(
                  receipt.pallets.map(
                    (row) =>
                      data.skus.find((sku) => sku.id === row.skuId)?.name ??
                      "Тематика недоступна",
                  ),
                ),
              ];
              return (
                <button
                  key={receipt.id}
                  type="button"
                  className={styles.document}
                  aria-pressed={selected?.id === receipt.id}
                  onClick={() => state.setSelectedId(receipt.id)}
                >
                  <span className={styles.documentTop}>
                    <strong>{receipt.code}</strong>
                    <ArrowDownLeft size={15} />
                  </span>
                  <span className={styles.documentDate}>
                    {receiptDate(receipt.receivedAt)}
                  </span>
                  <span className={styles.documentThemes}>
                    {themes.join(" · ")}
                  </span>
                  <Badge
                    tone={
                      receipt.status === "completed" ? "success" : "warning"
                    }
                  >
                    {receiptStatusLabels[receipt.status]}
                  </Badge>
                  <span className={styles.documentBottom}>
                    <span>
                      {progress.placed} / {progress.total} паллет размещено
                    </span>
                    <span>{Math.round(progress.percent)}%</span>
                  </span>
                  <span className={styles.progress}>
                    <span style={{ width: `${progress.percent}%` }} />
                  </span>
                </button>
              );
            })}
          </div>
          {!receipts.length && (
            <EmptyState
              title={
                state.search
                  ? "Ничего не найдено"
                  : state.view === "archive"
                    ? "Архив пока пуст"
                    : "Нет активных приёмок"
              }
              description={
                state.search
                  ? "Попробуйте другой код или название тематики."
                  : state.view === "archive"
                    ? "Здесь появятся полностью размещённые документы."
                    : isManager
                      ? "Создайте документ на поступившие паллеты. Места хранения можно подготовить позже."
                      : "Новые приёмки появятся после создания менеджером. Здесь можно разместить поступившие паллеты."
              }
              action={
                isManager && !state.search && state.view === "active" ? (
                  <Button onClick={openCreate}>Создать приёмку</Button>
                ) : undefined
              }
            />
          )}
        </section>
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
          <section className={`glass-panel ${styles.detail}`}>
            <EmptyState
              title="Документ и его паллеты"
              description="Выберите приёмку, чтобы напечатать этикетки, разместить паллеты и посмотреть историю."
            />
          </section>
        )}
      </div>
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
