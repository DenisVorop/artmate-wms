"use client";
import Link from "next/link";
import { ArrowLeft, Printer, RefreshCw } from "lucide-react";
import {
  Button,
  EmptyState,
  LoadingState,
  RollLabelFormatSelect,
  rollPaperClass,
} from "@/shared/ui";
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
  const print = useReceiptPrint(
    id,
    query.data?.labels ?? [],
    !query.isFetching && !query.isError,
  );
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
  const ready = print.ready;
  const hasImageError = print.failed;
  return (
    <div className={styles.page} data-print-ready={ready}>
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
            Одна паллета на этикетке. Выберите в драйвере{" "}
            {print.format === "75x120" ? "75 × 120 мм" : "100 × 70 мм"}, масштаб
            100%, без колонтитулов.
          </p>
        </div>
        <div className={styles.printActions}>
          <RollLabelFormatSelect
            value={print.format}
            onChange={print.setFormat}
          />
          <Button
            onClick={print.print}
            disabled={!ready}
            aria-busy={!ready && !hasImageError && labels.length > 0}
          >
            <Printer size={17} />
            Распечатать этикетки
          </Button>
          {!ready && labels.length > 0 && (
            <p role="status">
              {hasImageError ? "QR не загружен" : "Загружаем QR…"}
            </p>
          )}
        </div>
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
      <p className={`${styles.printNotice} ${rollPaperClass(print.format)}`}>
        Печать недоступна. Дождитесь загрузки всех QR приёмки и повторите
        печать.
      </p>
      <div
        className={styles.labels}
        aria-label={`Этикетки приёмки ${receiptCode}`}
      >
        {labels.map((label) => {
          const imageKey = print.key(label);
          return (
            <article
              className={`${styles.label} ${rollPaperClass(print.format)}`}
              data-format={print.format}
              key={label.palletId}
              aria-label={`Паллета ${label.code}, ${label.title}, ${label.quantity} штук`}
            >
              <header className={styles.labelHeading}>
                <strong
                  className={
                    label.code.length > 18 ? styles.longCode : undefined
                  }
                >
                  {label.code}
                </strong>
                <span>{receiptCode}</span>
              </header>
              <div className={styles.labelBody}>
                {/* SVG is displayed as an image and cannot execute scripts in the page. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  key={imageKey}
                  src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(label.svg)}`}
                  width={144}
                  height={144}
                  alt={`QR паллеты ${label.code}`}
                  onLoad={() => print.markLoaded(imageKey)}
                  onError={() => print.markFailed(imageKey)}
                />
                <div className={styles.labelText}>
                  <h2
                    className={
                      label.title.length > 55 ? styles.longTitle : undefined
                    }
                  >
                    {label.title}
                  </h2>
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
          );
        })}
      </div>
    </div>
  );
}
