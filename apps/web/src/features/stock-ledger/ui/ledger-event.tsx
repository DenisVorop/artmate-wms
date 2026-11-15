"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { StockLedgerEventDto } from "@/shared/api/generated/model";
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
  const label =
    event.referenceType === "stocktake"
      ? "Инвентаризация"
      : ledgerKindLabels[event.kind];
  const detailsId = `ledger-event-${event.id}`;

  return (
    <>
      <tr className={styles.event} data-expanded={expanded || undefined}>
        <th scope="row">
          <button
            type="button"
            className={styles.eventToggle}
            aria-expanded={expanded}
            aria-controls={expanded ? detailsId : undefined}
            onClick={() => onExpanded(!expanded)}
          >
            <ChevronRight size={16} aria-hidden="true" />
            <span>
              {label}
              {event.referenceCode && (
                <span className={styles.secondary}>{event.referenceCode}</span>
              )}
            </span>
          </button>
        </th>
        <td className={styles.date}>
          <time dateTime={event.createdAt}>{ledgerDate(event.createdAt)}</time>
        </td>
        <td>{ledgerActor(event)}</td>
        <td
          className={styles.quantity}
          data-tone={ledgerDeltaTone(event.unitsDelta)}
          title={ledgerEventMeaning(event)}
        >
          {signedLedgerQuantity(event.unitsDelta)}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={4} className={styles.detailCell} id={detailsId}>
            <LedgerEventDetails event={event} />
          </td>
        </tr>
      )}
    </>
  );
}

function LedgerEventDetails({ event }: { event: StockLedgerEventDto }) {
  return (
    <div className={styles.detail}>
      {event.referenceType === "stocktake" && event.referenceId && (
        <Link
          className={styles.documentLink}
          href={`/stocktakes?stocktakeId=${encodeURIComponent(event.referenceId)}`}
        >
          Открыть инвентаризацию {event.referenceCode}
        </Link>
      )}
      {event.reason && (
        <p className={styles.reason}>
          <strong>Причина</strong> {event.reason}
        </p>
      )}
      {event.lines.length === 0 ? (
        <p className={styles.secondary}>Изменений по партиям и адресам нет.</p>
      ) : (
        <table className={styles.lines} aria-label="Изменения по партиям">
          <thead>
            <tr>
              <th scope="col">Товар</th>
              <th scope="col">Партия</th>
              <th scope="col">Грузоместо</th>
              <th scope="col">Адрес</th>
              <th scope="col">Этап</th>
              <th scope="col" className={styles.quantity}>
                Изменение, шт.
              </th>
            </tr>
          </thead>
          <tbody>
            {event.lines.map((line, index) => (
              <tr
                key={`${line.skuId}:${line.containerId}:${line.lotId}:${index}`}
              >
                <th scope="row">
                  {line.skuName}
                  <span className={styles.secondary}>{line.skuCode}</span>
                </th>
                <td>
                  {line.lotName}
                  {line.receivedAt && (
                    <time
                      className={styles.secondary}
                      dateTime={line.receivedAt}
                    >
                      {ledgerDate(line.receivedAt)}
                    </time>
                  )}
                </td>
                <td>
                  <span className={styles.code}>{line.containerCode}</span>
                  <span className={styles.secondary}>
                    {ledgerContainerLabels[line.containerType]}
                  </span>
                  {line.palletCode &&
                    line.palletCode !== line.containerCode && (
                      <span className={styles.secondary}>
                        Паллета {line.palletCode}
                      </span>
                    )}
                </td>
                <td>{line.locationCode ?? "—"}</td>
                <td>{ledgerStageLabels[line.stage]}</td>
                <td
                  className={styles.quantity}
                  data-tone={ledgerDeltaTone(line.quantityDelta)}
                >
                  {signedLedgerQuantity(line.quantityDelta)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
