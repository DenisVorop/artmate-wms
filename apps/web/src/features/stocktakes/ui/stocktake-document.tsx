"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { TaskHistory } from "@/entities/task-history";
import type {
  StocktakeDto,
  StocktakeRowDto,
  CountStocktakeLocationDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";
import { useStocktakePreview } from "@/entities/stocktake";
import { Badge, Button, LoadingState, ErrorState } from "@/shared/ui";
import {
  stocktakeDate,
  stocktakeStatus,
  stocktakeCancelDescription,
} from "../lib/stocktake-view";
import { stocktakeWalk } from "@/entities/warehouse-map";
import { StocktakeRow } from "./stocktake-row";
import { StocktakePreview } from "./stocktake-preview";
import { ReasonAction } from "./reason-action";
import styles from "./stocktakes.module.css";

export function StocktakeDocument({
  doc,
  data,
  isManager,
  ownEmployeeId,
  working,
  pending,
  error,
  dirtyRows,
  onDirty,
  onClaim,
  onCount,
  onRefresh,
  onSubmit,
  onApprove,
  onCancel,
}: {
  doc: StocktakeDto;
  data?: Pick<
    WorkspaceDto,
    "skus" | "locations" | "warehouse" | "entrances" | "pallets"
  >;
  isManager: boolean;
  ownEmployeeId: string;
  working: boolean;
  pending: string | null;
  error: string | null;
  dirtyRows: Set<string>;
  onDirty: (id: string, dirty: boolean) => void;
  onClaim: () => Promise<boolean>;
  onCount: (
    row: StocktakeRowDto,
    values: Omit<CountStocktakeLocationDto, "requestId" | "expectedRevision">,
    revision: number,
  ) => Promise<StocktakeDto | null>;
  onRefresh: (row: StocktakeRowDto, revision: number) => Promise<boolean>;
  onSubmit: () => Promise<boolean>;
  onApprove: (reason: string, revision: number) => Promise<boolean>;
  onCancel: (reason: string, revision: number) => Promise<boolean>;
}) {
  const [reasonAction, setReasonAction] = useState<"approve" | "cancel" | null>(
    null,
  );
  const [reviewRevision, setReviewRevision] = useState(doc.revision);
  const archived = doc.status === "approved" || doc.status === "cancelled";
  const previewQuery = useStocktakePreview(
    doc.id,
    isManager && doc.status === "review",
  );
  const preview =
    doc.status === "review" && isManager
      ? previewQuery.data?.revision === doc.revision
        ? previewQuery.data
        : undefined
      : doc.preview;
  const previewReady = !!preview && preview.revision === doc.revision;
  const rows = useMemo(() => stocktakeWalk(doc.rows, data), [doc.rows, data]);
  const busy = !!pending;
  const own = doc.employeeId === ownEmployeeId;
  const requiresShift =
    doc.status === "queued" ||
    (doc.status === "counting" && own) ||
    (doc.status === "review" && isManager);
  const openReason = (action: "approve" | "cancel") => {
    setReviewRevision(doc.revision);

    setReasonAction(action);
  };
  const reasonDisabled =
    reviewRevision !== doc.revision
      ? "Документ обновился после начала проверки. Сверьте изменения и явно учтите новую версию перед продолжением."
      : reasonAction === "approve" &&
          (!doc.canApprove ||
            !previewReady ||
            !preview?.canApprove ||
            dirtyRows.size > 0)
        ? "Утверждение сейчас недоступно. Все ячейки должны быть пересчитаны без устаревших снимков, незавершённых правок и блокирующих расхождений; менеджер должен быть на смене."
        : reasonAction === "cancel" && !doc.canCancel
          ? "Документ больше нельзя отменить в текущем состоянии."
          : null;
  return (
    <div className={styles.detail}>
      <section className="glass-panel">
        <header className={styles.detailHeader}>
          <div>
            <h2>
              {doc.mode === "opening" ? "Первичная инвентаризация · " : ""}
              {doc.code}
            </h2>
            <div className={styles.detailMeta}>
              <Badge
                tone={
                  doc.status === "approved"
                    ? "success"
                    : doc.status === "review"
                      ? "warning"
                      : "neutral"
                }
              >
                {stocktakeStatus(doc.status)}
              </Badge>
              <span>
                Создан {stocktakeDate(doc.createdAt)} · {doc.createdByName}
              </span>
              {doc.employeeName && <span>Исполнитель: {doc.employeeName}</span>}
              {archived && (
                <span>{stocktakeDate(doc.approvedAt ?? doc.cancelledAt)}</span>
              )}
            </div>
          </div>
          <div className={styles.subtle}>
            {isManager && (
              <TaskHistory kind="stocktake" id={doc.id} code={doc.code} />
            )}
            {doc.locationsCounted} / {doc.locationsTotal} адресов
            {!archived && doc.staleLocations > 0
              ? ` · устарело: ${doc.staleLocations}`
              : ""}
          </div>
        </header>
        <div className={styles.panel} style={{ paddingTop: 0 }}>
          {doc.reason && <p className={styles.notice}>Причина: {doc.reason}</p>}
          {requiresShift && !working && (
            <p className={styles.notice}>
              <Link href="/team">Начните или возобновите смену</Link>.
            </p>
          )}
          {doc.status === "queued" && (
            <div style={{ marginTop: 16 }}>
              <Button
                disabled={busy || !doc.canClaim}
                aria-busy={pending === "claim"}
                onClick={() => void onClaim()}
              >
                Взять в работу
              </Button>
              {!doc.canClaim && working && (
                <p className={styles.footerNote}>Документ пока нельзя взять.</p>
              )}
            </div>
          )}
          {doc.status === "counting" && own && (
            <div className={styles.inlineActions} style={{ marginTop: 16 }}>
              <Button
                disabled={busy || !doc.canSubmit || dirtyRows.size > 0}
                aria-busy={pending === "submit"}
                onClick={() => void onSubmit()}
              >
                Передать на проверку
              </Button>
              {(dirtyRows.size > 0 || (!doc.canSubmit && working)) && (
                <p className={styles.footerNote}>
                  {dirtyRows.size
                    ? "Сохраните подсчёт перед отправкой."
                    : "Завершите подсчёт и проверьте отмеченные адреса."}
                </p>
              )}
            </div>
          )}
          {error && (
            <div
              role="alert"
              className={styles.error}
              style={{ marginTop: 14 }}
            >
              {error}
            </div>
          )}
          {(doc.canCancel || (isManager && doc.status === "review")) && (
            <div className={styles.inlineActions} style={{ marginTop: 16 }}>
              {isManager && doc.status === "review" && (
                <Button
                  disabled={
                    busy ||
                    !doc.canApprove ||
                    !previewReady ||
                    !preview?.canApprove ||
                    dirtyRows.size > 0
                  }
                  onClick={() => openReason("approve")}
                >
                  Утвердить
                </Button>
              )}
              {doc.canCancel && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => openReason("cancel")}
                >
                  Отменить документ
                </Button>
              )}
            </div>
          )}
        </div>
      </section>
      {doc.status === "review" && isManager && !previewReady ? (
        previewQuery.isError ? (
          <ErrorState
            message="Не удалось загрузить актуальную проверку расхождений. Утверждение недоступно до успешной загрузки."
            onRetry={() => void previewQuery.refetch()}
          />
        ) : (
          <LoadingState label="Проверяем актуальные расхождения…" />
        )
      ) : (
        doc.status !== "cancelled" &&
        preview && (
          <StocktakePreview
            doc={doc}
            preview={preview}
            applied={doc.status === "approved"}
          />
        )
      )}
      {reasonAction && (
        <ReasonAction
          title={
            reasonAction === "approve"
              ? `Применить результаты ${doc.code}?`
              : `Отменить ${doc.code}?`
          }
          description={
            reasonAction === "approve"
              ? "Подтверждённые изменения будут применены к остаткам."
              : stocktakeCancelDescription(dirtyRows.size)
          }
          label={
            reasonAction === "approve"
              ? `Утвердить ${doc.code} и изменить остатки`
              : `Отменить ${doc.code}`
          }
          danger={reasonAction === "cancel"}
          pending={busy}
          error={error}
          disabledReason={reasonDisabled}
          onSave={(reason) =>
            reasonAction === "approve"
              ? onApprove(reason, reviewRevision)
              : onCancel(reason, reviewRevision)
          }
          onClose={() => setReasonAction(null)}
        >
          {reviewRevision !== doc.revision && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !previewReady}
              onClick={() => {
                setReviewRevision(doc.revision);
              }}
            >
              Изменения проверены · учесть новую версию
            </Button>
          )}
        </ReasonAction>
      )}
      <section>
        <div className={styles.sectionHeading} style={{ padding: "0 0 14px" }}>
          <h2>Ячейки</h2>
        </div>
        <div className={styles.rows}>
          {rows.map((row) => (
            <StocktakeRow
              key={row.locationId}
              doc={doc}
              data={data}
              row={row}
              own={own}
              working={working}
              pending={busy}
              error={pending === null ? error : null}
              dirty={dirtyRows.has(row.locationId)}
              onDirty={onDirty}
              onCount={onCount}
              onRefresh={(row, revision) => onRefresh(row, revision)}
            />
          ))}
        </div>
        {!doc.rows.length && (
          <div className={styles.notice}>В документе нет ячеек.</div>
        )}
      </section>
      <details
        className={`glass-panel ${styles.panel} ${styles.documentHistory}`}
      >
        <summary>История документа</summary>
        <ol className={styles.history}>
          {doc.history.map((item) => (
            <li key={item.id}>
              {stocktakeDate(item.createdAt)} · {item.actorName} ·{" "}
              {item.message}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
