"use client";
import { useState } from "react";
import Link from "next/link";
import type {
  StocktakeDto,
  StocktakeRowDto,
  CountStocktakeLocationDto,
} from "@/shared/api/generated/model";
import { useStocktakePreview } from "@/entities/stocktake";
import { Badge, Button, LoadingState, ErrorState } from "@/shared/ui";
import {
  stocktakeDate,
  stocktakeStatus,
  stocktakeCancelDescription,
} from "../lib/stocktake-view";
import { StocktakeRow } from "./stocktake-row";
import { StocktakePreview } from "./stocktake-preview";
import { ReasonAction } from "./reason-action";
import styles from "./stocktakes.module.css";

export function StocktakeDocument({
  doc,
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
  const busy = !!pending;
  const own = doc.employeeId === ownEmployeeId;
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
            <h2>{doc.code}</h2>
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
              <span>Исполнитель: {doc.employeeName ?? "Пока не назначен"}</span>
            </div>
          </div>
          <div className={styles.subtle}>
            {doc.locationsCounted} / {doc.locationsTotal} адресов
            {!archived && doc.staleLocations > 0
              ? ` · устарело: ${doc.staleLocations}`
              : ""}
          </div>
        </header>
        <div className={styles.panel} style={{ paddingTop: 0 }}>
          <div className={styles.notice}>
            <strong>
              {doc.status === "approved"
                ? `Документ утверждён ${stocktakeDate(doc.approvedAt)}. Изменения применены к остаткам.`
                : doc.status === "cancelled"
                  ? `Документ отменён ${stocktakeDate(doc.cancelledAt)}. Остатки не изменялись.`
                  : "Подсчёт сохраняется в этом документе. Остатки склада изменятся только после утверждения менеджером."}
            </strong>
            {doc.reason && <p>Причина: {doc.reason}</p>}
          </div>
          {!archived && !working && (
            <p className={styles.notice} style={{ marginTop: 12 }}>
              Рабочая смена не начата или находится на перерыве. Для подсчёта,
              взятия документа и утверждения{" "}
              <Link href="/team">начните или возобновите смену</Link>.
            </p>
          )}
          {doc.status === "queued" && (
            <div style={{ marginTop: 16 }}>
              <Button
                disabled={busy || !doc.canClaim}
                aria-busy={pending === "claim"}
                onClick={() => void onClaim()}
              >
                Взять {doc.code} в работу
              </Button>
              {!doc.canClaim && working && (
                <p className={styles.footerNote}>
                  Сейчас документ нельзя взять. Проверьте свою смену и
                  доступность документа; обновление выполняется автоматически.
                </p>
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
                Передать {doc.code} на проверку
              </Button>
              <p className={styles.footerNote}>
                {dirtyRows.size
                  ? "Сначала сохраните или очистите незавершённые правки в ячейках."
                  : !doc.canSubmit
                    ? "Нужно пересчитать все ячейки, обновить устаревшие снимки и дождаться освобождения занятых адресов."
                    : "После передачи подсчёт станет доступен менеджеру для проверки."}
              </p>
            </div>
          )}
          {doc.status === "counting" && !own && (
            <p className={styles.description}>
              Документ считает {doc.employeeName ?? "назначенный сотрудник"}.
              Менеджер может проверять результаты и обновлять снимки; сохранять
              фактический подсчёт может только назначенный сотрудник на смене.
            </p>
          )}
          {doc.status === "review" && (
            <p className={styles.description}>
              {isManager
                ? "Проверьте каждое расхождение и его причину. При необходимости обновите нужную ячейку: документ вернётся на повторный подсчёт."
                : "Результаты переданы менеджеру. До утверждения остатки не меняются. При повторном подсчёте документ вернётся в работу."}
            </p>
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
          {!archived && (
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
                  Проверить и утвердить изменения
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
              ? `Все изменения, перечисленные выше, будут применены к остаткам одной операцией. Проверьте полный список и укажите причину. Документ сохранится в архиве.`
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
              onClick={() => setReviewRevision(doc.revision)}
            >
              Изменения проверены · учесть новую версию
            </Button>
          )}
        </ReasonAction>
      )}
      <section>
        <div className={styles.sectionHeading} style={{ padding: "0 0 14px" }}>
          <h2>Ячейки документа</h2>
          <span className={styles.subtle}>
            Откройте адрес, чтобы увидеть снимок и результат
          </span>
        </div>
        <div className={styles.rows}>
          {doc.rows.map((row) => (
            <StocktakeRow
              key={row.locationId}
              doc={doc}
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
          <div className={styles.notice}>
            В документе нет ячеек. Создайте новый документ с действующими
            адресами хранения.
          </div>
        )}
      </section>
      <section className={`glass-panel ${styles.panel}`}>
        <h2>История документа</h2>
        <ol className={styles.history}>
          {doc.history.map((item) => (
            <li key={item.id}>
              {stocktakeDate(item.createdAt)} · {item.actorName} ·{" "}
              {item.message}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
