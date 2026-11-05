"use client";
import Link from "next/link";
import { ArrowLeft, Printer, RefreshCw } from "lucide-react";
import {
  Button,
  LoadingState,
  RollLabelFormatSelect,
  rollPaperClass,
  RollLabel,
  StockLabel,
  LocationRollLabel,
  WorkZoneRollLabel,
} from "@/shared/ui";
import {
  boxLabelFormats,
  palletLabelFormats,
  palletPrintCode,
  rollLabelFormats,
} from "@/shared/lib/label-paper";
import { useLabel, type LabelType } from "../model/use-label";
import { useLabelPrint } from "../lib/use-label-print";
import styles from "./label.module.css";

const labelNames = {
  "work-zone": "QR рабочей зоны",
  location: "Этикетка адреса",
  pallet: "Этикетка паллеты",
  box: "Этикетка короба",
};
export function LabelFeature({ type, id }: { type: LabelType; id: string }) {
  const query = useLabel(type, id);
  const print = useLabelPrint(
    `${type}:${id}`,
    query.data?.svg,
    type === "location" || type === "work-zone"
      ? "120x75"
      : type === "box"
        ? "58x40"
        : "75x120",
  );
  const backHref =
    type === "box"
      ? "/assembly"
      : type === "location" || type === "work-zone"
        ? "/warehouse"
        : "/inventory";
  const backText =
    type === "box"
      ? "К сборке"
      : type === "location" || type === "work-zone"
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
    <div
      className={`${styles.page} ${rollPaperClass(print.format)}`}
      data-print-ready={print.ready}
    >
      <header className={`glass-panel ${styles.screenHeader}`}>
        <div>
          <Link href={backHref} className={styles.back}>
            <ArrowLeft size={15} />
            {backText}
          </Link>
          <p className={styles.eyebrow}>{labelNames[type]}</p>
          <h1>{label.code}</h1>
          <p>
            Макет {rollLabelFormats[print.format]}. Одна этикетка на страницу. В
            диалоге печати выберите тот же размер, масштаб 100%, без полей и
            колонтитулов.
          </p>
          {type === "work-zone" && (
            <p className={styles.hint}>
              Скан зоны открывает работу. Для перемещения товара нужны отдельные
              сканы адреса и товара.
            </p>
          )}
          {type === "box" && (
            <p className={styles.hint}>
              Повторная печать сохраняет код этого короба.
            </p>
          )}
        </div>
        <div className={styles.printActions}>
          <RollLabelFormatSelect
            formats={
              type === "location" || type === "work-zone"
                ? ["120x75", "75x120", "100x70"]
                : type === "box"
                  ? boxLabelFormats
                  : palletLabelFormats
            }
            value={print.format}
            onChange={print.setFormat}
          />
          {(type === "work-zone" || type === "location") && (
            <Link
              href={`/labels/a4?type=${type}&id=${encodeURIComponent(id)}`}
              className="button button--secondary"
            >
              Табличка на А4
            </Link>
          )}
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
      <p className={`${styles.printNotice} ${rollPaperClass(print.format)}`}>
        Дождитесь загрузки QR перед печатью.
      </p>
      <div className={styles.preview}>
        {type === "box" || type === "pallet" ? (
          <StockLabel
            kind={type}
            format={print.format}
            code={label.code}
            svg={label.svg}
            imageKey={print.key}
            reference={palletPrintCode(label.code)}
            onLoad={print.markLoaded}
            onError={print.markFailed}
          />
        ) : type === "location" && print.format === "120x75" ? (
          <LocationRollLabel
            label={label}
            imageKey={print.key}
            onLoad={print.markLoaded}
            onError={print.markFailed}
          />
        ) : type === "work-zone" && print.format === "120x75" ? (
          <WorkZoneRollLabel
            label={label}
            imageKey={print.key}
            onLoad={print.markLoaded}
            onError={print.markFailed}
          />
        ) : (
          <RollLabel
            label={label}
            format={print.format}
            imageKey={print.key}
            caption={labelNames[type]}
            onLoad={print.markLoaded}
            onError={print.markFailed}
          />
        )}
      </div>
    </div>
  );
}
