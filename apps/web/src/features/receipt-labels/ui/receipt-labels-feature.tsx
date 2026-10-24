"use client";
import Link from "next/link";
import { ArrowLeft, Printer, RefreshCw } from "lucide-react";
import { Button, EmptyState, LoadingState } from "@/shared/ui";
import { useReceiptLabels } from "../model/use-receipt-labels";
import { useReceiptPrint } from "../lib/use-receipt-print";
import styles from "./receipt-labels.module.css";

const receiptDate = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
export function ReceiptLabelsFeature({ id }: { id: string }) {
  const query = useReceiptLabels(id);
  const print = useReceiptPrint(id);
  if (query.isPending) return <LoadingState label="Готовим этикетки паллет…" />;
  if (query.isError || !query.data)
    return (
      <section className={`glass-panel ${styles.error}`} role="alert">
        <h1>Не удалось открыть этикетки</h1>
        <p>
          {query.error instanceof Error
            ? query.error.message
            : "Повторите загрузку документа."}
        </p>
        <div className={styles.actions}>
          <Button onClick={() => void query.refetch()}>
            <RefreshCw size={16} />
            Повторить
          </Button>
          <Link href="/receiving" className="button button--secondary">
            К приёмкам
          </Link>
        </div>
      </section>
    );
  const { receiptCode, receivedAt, labels } = query.data;
  const ready =
    labels.length > 0 &&
    labels.every((label) => print.isLoaded(label.palletId));
  const hasImageError = labels.some((label) => print.isFailed(label.palletId));
  return (
    <div className={styles.page}>
      <header className={`glass-panel ${styles.screenHeader}`}>
        <div>
          <Link href="/receiving" className={styles.back}>
            <ArrowLeft size={15} />К приёмкам
          </Link>
          <p className={styles.eyebrow}>ЭТИКЕТКИ ПАЛЛЕТ</p>
          <h1>{receiptCode}</h1>
          <p>
            Поступление: {receiptDate(receivedAt)} · Этикеток: {labels.length}
          </p>
          <p className={styles.hint}>
            Макет 100 × 70 мм, одна паллета на странице. Выберите этот размер
            бумаги в диалоге печати.
          </p>
        </div>
        <Button onClick={print.print} disabled={!ready || hasImageError}>
          <Printer size={17} />
          {ready ? "Распечатать этикетки" : "Загружаем QR…"}
        </Button>
      </header>
      {hasImageError && (
        <div className={`ops-error ${styles.screenOnly}`} role="alert">
          Не удалось отобразить QR. Повторите загрузку перед печатью.
          <Button variant="secondary" onClick={print.retryImages}>
            <RefreshCw size={15} />
            Повторить загрузку QR
          </Button>
        </div>
      )}
      {labels.length === 0 && (
        <div className={styles.screenOnly}>
          <EmptyState
            title="В документе нет этикеток"
            description="Вернитесь к приёмке и проверьте состав документа."
          />
        </div>
      )}
      <div
        className={styles.labels}
        aria-label={`Этикетки приёмки ${receiptCode}`}
      >
        {labels.map((label) => (
          <article
            className={styles.label}
            key={label.palletId}
            aria-label={`Паллета ${label.code}, ${label.title}, ${label.quantity} штук`}
          >
            <header className={styles.labelHeading}>
              <strong>{label.code}</strong>
              <span>{receiptCode}</span>
            </header>
            <div className={styles.labelBody}>
              {/* SVG is displayed as an image and cannot execute scripts in the page. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={print.key(label.palletId)}
                src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(label.svg)}`}
                width={144}
                height={144}
                alt={`QR паллеты ${label.code}`}
                onLoad={() => print.markLoaded(label.palletId)}
                onError={() => print.markFailed(label.palletId)}
              />
              <div className={styles.labelText}>
                <h2>{label.title}</h2>
                <p className={styles.quantity}>
                  {label.quantity.toLocaleString("ru-RU")} шт.
                </p>
                <p className={styles.date}>
                  Поступление
                  <br />
                  {receiptDate(receivedAt)}
                </p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
