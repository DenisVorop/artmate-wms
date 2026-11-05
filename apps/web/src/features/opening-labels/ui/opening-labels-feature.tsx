"use client";
import { useState } from "react";
import Link from "next/link";
import { useStocktake, useOpeningLabels } from "@/entities/stocktake";
import {
  Button,
  ErrorState,
  LoadingState,
  StockLabel,
  Select,
  RollLabelFormatSelect,
  rollPaperClass,
} from "@/shared/ui";
import {
  boxLabelFormats,
  palletLabelFormats,
  palletPrintCode,
} from "@/shared/lib/label-paper";
import { useOpeningPrint } from "../lib/use-opening-print";
import styles from "./opening-labels.module.css";
export function OpeningLabelsFeature({
  stocktakeId,
  locationId,
}: {
  stocktakeId: string;
  locationId: string;
}) {
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState<"pallet" | "box">("pallet");
  const doc = useStocktake(stocktakeId),
    query = useOpeningLabels(doc.data, locationId, page);
  const labels = (query.data?.labels ?? []).filter(
    (item) => item.ref.type === kind,
  );
  const print = useOpeningPrint(
    `${stocktakeId}:${locationId}:${page}:${doc.data?.revision}:${kind}`,
    labels,
    !!doc.data && !doc.isError && !query.isFetching && !query.isError,
    kind,
  );
  if (!stocktakeId || !locationId)
    return (
      <ErrorState message="Откройте печать из утверждённого адреса первичной инвентаризации." />
    );
  if (doc.isPending || (query.isPending && !doc.isError))
    return <LoadingState label="Готовим полный комплект QR этой страницы…" />;
  if (doc.isError || query.isError || !query.data)
    return (
      <ErrorState
        message={
          query.error instanceof Error
            ? query.error.message
            : "Не удалось загрузить утверждённый документ и этикетки."
        }
        onRetry={() => {
          void doc.refetch();
          void query.refetch();
        }}
      />
    );
  return (
    <div
      className={`${styles.page} ${rollPaperClass(print.format)}`}
      data-print-ready={print.ready}
    >
      <header className={`glass-panel ${styles.header}`}>
        <div>
          <Link
            href={`/stocktakes?stocktakeId=${encodeURIComponent(stocktakeId)}`}
          >
            К документу инвентаризации
          </Link>
          <h1>Этикетки · {query.data.locationCode}</h1>
          <p>
            {doc.data?.code} · Страница {page} из {query.data.pages} ·{" "}
            {labels.length} этикеток из {query.data.total}
          </p>
          <p>
            Одна этикетка на страницу. Выберите тот же размер в драйвере,
            масштаб 100%, без полей и колонтитулов.
          </p>
        </div>
        <div>
          <label className="field">
            Что печатать
            <Select
              value={kind}
              onChange={(event) =>
                setKind(event.target.value as "pallet" | "box")
              }
            >
              <option value="pallet">Паллеты</option>
              <option value="box">Короба</option>
            </Select>
          </label>
          <RollLabelFormatSelect
            formats={kind === "box" ? boxLabelFormats : palletLabelFormats}
            value={print.format}
            onChange={print.setFormat}
          />
          <Button disabled={!print.ready} onClick={print.print}>
            Распечатать эту страницу этикеток
          </Button>
          {!!labels.length && !print.ready && (
            <p role="status">
              {print.failed ? "QR не загружен" : "Загружаем все QR…"}
            </p>
          )}
        </div>
        <div className={styles.pagination}>
          <Button
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Предыдущие этикетки
          </Button>
          <Button
            variant="secondary"
            disabled={page >= query.data.pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Следующие этикетки
          </Button>
        </div>
      </header>
      {print.failed && (
        <div className={styles.screenOnly} role="alert">
          Не все QR отобразились. Печать заблокирована.
          <Button onClick={print.retry}>Повторить загрузку QR</Button>
        </div>
      )}
      {!labels.length && (
        <p className={styles.screenOnly}>
          На этой странице нет {kind === "pallet" ? "паллет" : "коробов"} для
          печати.
        </p>
      )}
      <p className={`${styles.printNotice} ${rollPaperClass(print.format)}`}>
        Печать недоступна: дождитесь загрузки всех QR выбранной страницы.
      </p>
      <div className={styles.labels}>
        {labels.map((item) => (
          <StockLabel
            kind={item.ref.type}
            key={`${item.ref.type}:${item.ref.id}`}
            code={item.label.code}
            svg={item.label.svg}
            reference={palletPrintCode(item.label.code)}
            format={print.format}
            imageKey={print.key(item)}
            onLoad={() => print.loaded(print.key(item))}
            onError={() => print.fail(print.key(item))}
          />
        ))}
      </div>
    </div>
  );
}
