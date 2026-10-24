"use client";
import { ChevronDown, ArrowRightLeft } from "lucide-react";
import type { StockLedgerEventDto } from "@/shared/api/generated/model";
import { Badge } from "@/shared/ui";
import {
  ledgerActor,
  ledgerContainerLabels,
  ledgerDate,
  ledgerDeltaTone,
  ledgerEventMeaning,
  ledgerKindLabels,
  ledgerStageLabels,
  signedLedgerQuantity,
} from "../lib/ledger-view";
import styles from "./stock-ledger.module.css";
export function LedgerEvent({
  event,
  expanded,
  onExpanded,
}: {
  event: StockLedgerEventDto;
  expanded: boolean;
  onExpanded: (open: boolean) => void;
}) {
  return (
    <details
      className={styles.event}
      open={expanded}
      onToggle={(e) => onExpanded(e.currentTarget.open)}
    >
      <summary className={styles.eventHeader}>
        <span className={styles.eventIcon}>
          <ArrowRightLeft size={17} />
        </span>
        <span className={styles.eventIdentity}>
          <strong>{ledgerKindLabels[event.kind]}</strong>
          <span>
            {ledgerDate(event.createdAt)} · {ledgerActor(event)}
          </span>
          {event.referenceCode && <code>{event.referenceCode}</code>}
        </span>
        <span className={styles.eventQuantity}>
          <strong data-tone={ledgerDeltaTone(event.unitsDelta)}>
            {signedLedgerQuantity(event.unitsDelta)}
            <small> шт.</small>
          </strong>
          <span>{ledgerEventMeaning(event)}</span>
        </span>
        <ChevronDown className={styles.chevron} size={17} />
      </summary>
      {expanded && (
        <div className={styles.eventBody}>
          {event.reason && (
            <p className={styles.reason}>
              <strong>Причина</strong>
              {event.reason}
            </p>
          )}
          <div className={styles.lineHeading}>
            <span>Изменения по остаткам</span>
            <span>Строк: {event.lines.length.toLocaleString("ru-RU")}</span>
          </div>
          {event.lines.length === 0 ? (
            <p className={styles.help}>
              В этой операции нет изменений по партиям и местам.
            </p>
          ) : (
            <div className={styles.lines}>
              {event.lines.map((line, index) => (
                <article
                  key={`${line.skuId}:${line.containerId}:${line.lotId}:${index}`}
                  className={styles.line}
                >
                  <div className={styles.lineIdentity}>
                    <strong>{line.skuName}</strong>
                    <span>{line.skuCode}</span>
                    <Badge>{ledgerStageLabels[line.stage]}</Badge>
                  </div>
                  <div className={styles.lineFacts}>
                    <span>
                      Партия: <strong>{line.lotName}</strong>
                      {line.receivedAt && ` · ${ledgerDate(line.receivedAt)}`}
                    </span>
                    <span>
                      {ledgerContainerLabels[line.containerType]}:{" "}
                      <code>{line.containerCode}</code>
                      {line.palletCode &&
                        line.palletCode !== line.containerCode && (
                          <>
                            {" "}
                            · паллета <code>{line.palletCode}</code>
                          </>
                        )}
                    </span>
                    <span>
                      Адрес: <code>{line.locationCode ?? "Не указан"}</code>
                    </span>
                  </div>
                  <strong
                    className={styles.lineQuantity}
                    data-tone={ledgerDeltaTone(line.quantityDelta)}
                  >
                    {signedLedgerQuantity(line.quantityDelta)}
                    <small> шт.</small>
                  </strong>
                </article>
              ))}
            </div>
          )}
          <p className={styles.help}>
            Партии, адреса и названия зафиксированы на момент операции. Знак
            показывает изменение именно этой строки.
          </p>
        </div>
      )}
    </details>
  );
}
