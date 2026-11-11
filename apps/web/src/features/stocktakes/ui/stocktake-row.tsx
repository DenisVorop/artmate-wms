"use client";
import { useState } from "react";
import Link from "next/link";
import { ChevronDown, RefreshCw } from "lucide-react";
import type {
  StocktakeDto,
  StocktakeRowDto,
  CountStocktakeLocationDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";
import { Badge, Button } from "@/shared/ui";
import { stocktakeDate } from "../lib/stocktake-view";
import { OpeningLocationForm } from "./opening-location-form";
import { OpeningCountSummary } from "./opening-count-summary";
import { CountLocationForm } from "./count-location-form";
import styles from "./stocktakes.module.css";

export function StocktakeRow({
  doc,
  row,
  own,
  working,
  pending,
  error,
  onCount,
  onRefresh,
  onDirty,
  dirty,
  compact = false,
  preserveDraft = false,
  data,
}: {
  data?: Pick<WorkspaceDto, "skus" | "locations" | "pallets">;
  compact?: boolean;
  preserveDraft?: boolean;
  doc: StocktakeDto;
  row: StocktakeRowDto;
  own: boolean;
  working: boolean;
  pending: boolean;
  error: string | null;
  onCount: (
    row: StocktakeRowDto,
    values: Omit<CountStocktakeLocationDto, "requestId" | "expectedRevision">,
    revision: number,
  ) => Promise<StocktakeDto | null>;
  onRefresh: (row: StocktakeRowDto, revision: number) => Promise<boolean>;
  onDirty: (id: string, dirty: boolean) => void;
  dirty: boolean;
}) {
  const [open, setOpen] = useState(compact);
  const [visited, setVisited] = useState(compact);
  const [formKey, setFormKey] = useState(0);
  const [confirmRefresh, setConfirmRefresh] = useState(false);
  const [refreshRevision, setRefreshRevision] = useState(doc.revision);
  const archived = doc.status === "approved" || doc.status === "cancelled";
  const blocked = !doc.canCount
    ? working
      ? "Подсчёт доступен назначенному сотруднику, пока документ находится в работе."
      : compact
        ? "Начните или возобновите смену на рабочем экране."
        : "Чтобы сохранять подсчёт, начните или возобновите свою смену в разделе «Команда»."
    : row.stale
      ? "Ячейка изменилась после снимка. Обновите только эту ячейку и пересчитайте её."
      : row.busyReasons.length
        ? row.busyReasons.join(". ")
        : null;
  const refresh = async (revision: number) => {
    if (await onRefresh(row, revision)) {
      setConfirmRefresh(false);
      setFormKey((value) => value + 1);
      onDirty(row.locationId, false);
    }
  };
  const history = doc.history.filter(
    (item) => item.locationId === row.locationId && item.previousRow,
  );
  return (
    <article
      className={`glass-panel ${styles.row} ${compact ? styles.compactRow : ""}`}
    >
      <div className={styles.rowHeading}>
        {compact ? (
          <div className={styles.rowButton}>
            <strong>
              {row.locationCode} · {row.locationName}
            </strong>
            <small>
              {row.count
                ? "Подсчёт сохранён"
                : "Осмотрите и пересчитайте этот адрес"}
            </small>
          </div>
        ) : (
          <button
            type="button"
            className={styles.rowButton}
            aria-expanded={open}
            aria-controls={`stocktake-row-${row.locationId}`}
            onClick={() => {
              setOpen((value) => !value);
              setVisited(true);
            }}
          >
            <strong>
              {row.locationCode} · {row.locationName}
            </strong>
            <small>
              {row.count
                ? `Подсчитано ${stocktakeDate(row.countedAt)} · ${row.countedByName ?? "Автор не указан"}`
                : "Ещё не пересчитана"}
            </small>
          </button>
        )}
        <div className={styles.actions}>
          {!archived && row.stale ? (
            <Badge tone="danger">Снимок устарел</Badge>
          ) : !archived && row.busyReasons.length ? (
            <Badge tone="warning">Занята</Badge>
          ) : (
            <Badge tone={row.count ? "success" : "neutral"}>
              {row.count ? "Подсчитана" : "Ожидает подсчёта"}
            </Badge>
          )}
          {!compact && <ChevronDown size={16} />}
        </div>
      </div>
      {visited && (
        <div
          id={`stocktake-row-${row.locationId}`}
          className={styles.rowContent}
          hidden={!open}
        >
          {!archived && !!row.busyReasons.length && (
            <div className={styles.notice}>
              <strong>Сейчас ячейка занята</strong>
              <ul className={styles.blockers}>
                {row.busyReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          )}
          {!compact && (
            <div className={styles.baseline}>
              <strong>
                {archived ? "Исходный снимок ячейки" : "Ожидалось по снимку"}
              </strong>
              {row.baseline.pallet && <p>Поддон: {row.baseline.pallet.code}</p>}
              <ul>
                {row.baseline.rawPallets.map((pallet) => (
                  <li key={pallet.palletId}>
                    {pallet.palletCode} · {pallet.skuName} · {pallet.quantity}{" "}
                    шт. · {pallet.lotName}
                  </li>
                ))}
                {row.baseline.boxes.map((box) => (
                  <li key={box.id}>
                    {box.code} · {box.skuName} · {box.units} шт.
                  </li>
                ))}
              </ul>
              {!row.baseline.rawPallets.length &&
                !row.baseline.boxes.length && <p>Товара по снимку нет.</p>}
            </div>
          )}
          {row.count && !compact && (
            <div className={styles.counted}>
              <strong>Сохранённый факт</strong>
              {row.count.openingPallet && (
                <OpeningCountSummary
                  pallet={row.count.openingPallet}
                  skus={data?.skus ?? []}
                />
              )}
              {row.count.rawPallets.map((pallet) => (
                <p key={pallet.palletCode}>
                  {pallet.palletCode}: {pallet.quantity} шт.
                </p>
              ))}
              {doc.mode !== "opening" && (
                <p>
                  Найденные короба:{" "}
                  {row.count.boxCodes.length
                    ? row.count.boxCodes.join(" · ")
                    : "нет"}
                </p>
              )}
              {!row.count.openingPallet &&
                !row.count.rawPallets.length &&
                !row.count.boxCodes.length && (
                  <p>Ячейка осмотрена, товар не найден.</p>
                )}
            </div>
          )}
          {((own && doc.status === "counting") || preserveDraft) &&
            (doc.mode === "opening" ? (
              data ? (
                <OpeningLocationForm
                  data={data}
                  key={formKey}
                  compact={compact}
                  row={row}
                  revision={doc.revision}
                  pending={pending}
                  blocked={blocked}
                  error={error}
                  onSave={(values, revision) => onCount(row, values, revision)}
                  onDirty={onDirty}
                  onReset={() => setFormKey((value) => value + 1)}
                />
              ) : (
                <p role="status">Загружаем каталог товаров…</p>
              )
            ) : (
              <CountLocationForm
                key={formKey}
                compact={compact}
                data={data}
                row={row}
                revision={doc.revision}
                pending={pending}
                blocked={blocked}
                error={error}
                onSave={(values, revision) => onCount(row, values, revision)}
                onDirty={onDirty}
                onReset={() => setFormKey((value) => value + 1)}
              />
            ))}
          {doc.mode === "opening" &&
            doc.status === "approved" &&
            row.openingResult &&
            (row.openingResult.palletId ||
              row.openingResult.boxIds.length > 0) && (
              <Link
                className="button button--secondary"
                target="_blank"
                rel="noopener noreferrer"
                href={`/labels/opening?stocktakeId=${encodeURIComponent(doc.id)}&locationId=${encodeURIComponent(row.locationId)}`}
              >
                Печать этикеток этого адреса
              </Link>
            )}
          {!archived && doc.canRefresh && (
            <>
              <Button
                variant="secondary"
                size="sm"
                disabled={pending || !!row.busyReasons.length}
                onClick={() => {
                  if (row.count || dirty) {
                    setRefreshRevision(doc.revision);
                    setConfirmRefresh(true);
                  } else void refresh(doc.revision);
                }}
              >
                <RefreshCw size={14} />
                Обновить снимок ячейки
              </Button>
              {confirmRefresh && (
                <div className={styles.confirm}>
                  <h3>Повторно пересчитать {row.locationCode}?</h3>
                  {refreshRevision !== doc.revision && (
                    <p className={styles.error}>
                      Документ обновился после открытия этого действия.
                      Вернитесь к текущему подсчёту и заново откройте обновление
                      снимка.
                    </p>
                  )}
                  <p>
                    Снимок обновится только у этой ячейки. Текущий подсчёт
                    перейдёт в историю, несохранённый ввод будет очищен.{" "}
                    {doc.status === "review"
                      ? "Документ вернётся в работу, после подсчёта его нужно снова отправить на проверку."
                      : "Ячейку потребуется пересчитать заново."}
                  </p>
                  <div className={styles.inlineActions}>
                    <Button
                      variant="secondary"
                      disabled={pending || refreshRevision !== doc.revision}
                      onClick={() => void refresh(refreshRevision)}
                    >
                      Обновить {row.locationCode} и пересчитать
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={pending}
                      onClick={() => setConfirmRefresh(false)}
                    >
                      Оставить текущий подсчёт
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
          {!!history.length && (
            <details className={styles.history}>
              <summary>
                Предыдущие подсчёты этой ячейки · {history.length}
              </summary>
              <ul>
                {history.map((item) => (
                  <li key={item.id}>
                    {stocktakeDate(item.createdAt)} · {item.actorName}:{" "}
                    {item.message}
                    {item.previousRow?.count && (
                      <div>
                        {item.previousRow.count.openingPallet && (
                          <OpeningCountSummary
                            pallet={item.previousRow.count.openingPallet}
                            skus={data?.skus ?? []}
                          />
                        )}
                        {item.previousRow.count.rawPallets
                          .map(
                            (pallet) =>
                              `${pallet.palletCode}: ${pallet.quantity} шт.`,
                          )
                          .join(" · ")}
                        {doc.mode !== "opening" && (
                          <>
                            ; короба:{" "}
                            {item.previousRow.count.boxCodes.join(" · ") ||
                              "не найдены"}
                            .
                          </>
                        )}
                        {doc.mode === "opening" &&
                          item.previousRow.count.openingPallet === null && (
                            <p>Ячейка осмотрена, товар не найден.</p>
                          )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </article>
  );
}
