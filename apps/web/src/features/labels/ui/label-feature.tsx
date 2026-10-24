"use client";
import Link from "next/link";
import { ArrowLeft, Printer, RefreshCw } from "lucide-react";
import { Button, LoadingState } from "@/shared/ui";
import { useLabel, type LabelType } from "../model/use-label";
import { useLabelPrint } from "../lib/use-label-print";
import styles from "./label.module.css";

const labelNames = {
  location: "Этикетка адреса",
  pallet: "Этикетка паллеты",
  box: "Этикетка короба",
};
export function LabelFeature({ type, id }: { type: LabelType; id: string }) {
  const query = useLabel(type, id);
  const print = useLabelPrint(`${type}:${id}`, query.data?.svg);
  const backHref =
    type === "box"
      ? "/assembly"
      : type === "location"
        ? "/warehouse"
        : "/inventory";
  const backText =
    type === "box"
      ? "К сборке"
      : type === "location"
        ? "К складу"
        : "К остаткам";
  if (query.isPending)
    return (
      <div className={styles.page}>
        <LoadingState label="Готовим этикетку…" />
      </div>
    );
  if (query.isError || !query.data)
    return (
      <div className={styles.page}>
        <section className={`glass-panel ${styles.error}`} role="alert">
          <h1>Не удалось открыть этикетку</h1>
          <p>
            {query.error instanceof Error
              ? query.error.message
              : "Проверьте код и повторите загрузку."}
          </p>
          <div className={styles.actions}>
            <Button
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
              aria-busy={query.isFetching}
            >
              <RefreshCw size={16} />
              Повторить
            </Button>
            <Link href={backHref} className="button button--secondary">
              {backText}
            </Link>
          </div>
        </section>
      </div>
    );
  const label = query.data;
  return (
    <div className={styles.page}>
      <header className={`glass-panel ${styles.screenHeader}`}>
        <div>
          <Link href={backHref} className={styles.back}>
            <ArrowLeft size={15} />
            {backText}
          </Link>
          <p className={styles.eyebrow}>{labelNames[type]}</p>
          <h1>{label.code}</h1>
          <p>
            Макет 100 × 70 мм. Выберите этот размер бумаги в диалоге печати.
          </p>
          {type === "box" && (
            <p className={styles.hint}>
              Повторная печать сохраняет код этого короба.
            </p>
          )}
        </div>
        <div className={styles.printActions}>
          <Button
            onClick={print.print}
            disabled={!print.ready}
            aria-busy={!print.ready && !print.failed}
          >
            <Printer size={17} />
            Распечатать этикетку
          </Button>
          {!print.ready && (
            <p role="status">
              {print.failed ? "QR не загружен" : "Загружаем QR…"}
            </p>
          )}
        </div>
      </header>
      {print.failed && (
        <div className={`ops-error ${styles.screenOnly}`} role="alert">
          <span>
            Не удалось отобразить QR. Повторите загрузку перед печатью.
          </span>
          <Button variant="secondary" onClick={print.retryImage}>
            <RefreshCw size={15} />
            Повторить загрузку QR
          </Button>
        </div>
      )}
      <div className={styles.preview}>
        <article
          className={styles.label}
          aria-label={`${labelNames[type]} ${label.code}, ${label.title}`}
        >
          <header className={styles.labelHeading}>
            <strong>{label.code}</strong>
            <span>Artmate · {labelNames[type]}</span>
          </header>
          <div className={styles.labelBody}>
            {/* An SVG image cannot execute scripts in this document. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={print.key}
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(label.svg)}`}
              width={144}
              height={144}
              alt={`QR ${label.code}`}
              onLoad={print.markLoaded}
              onError={print.markFailed}
            />
            <h2>{label.title}</h2>
          </div>
          <p className={styles.payload}>{label.payload}</p>
        </article>
      </div>
    </div>
  );
}
