import Link from "next/link";
import { Check, Package, Printer, ScanLine } from "lucide-react";
import type { ReceiptDto, WorkspaceDto } from "@/shared/api/generated/model";
import { Badge, Button } from "@/shared/ui";
import { number } from "@/shared/lib/format";
import {
  receiptDate,
  receiptProgress,
  receiptStatusLabels,
} from "../lib/receipt-view";
import styles from "./receiving.module.css";
export function ReceiptDetails({
  receipt,
  data,
  pending,
  onPlace,
}: {
  receipt: ReceiptDto;
  data: WorkspaceDto;
  pending: boolean;
  onPlace: (palletId: string) => void;
}) {
  const progress = receiptProgress(receipt);
  return (
    <section
      className={`glass-panel ${styles.detail}`}
      aria-label={`Приёмка ${receipt.code}`}
    >
      <div className={styles.detailHeader}>
        <div>
          <Badge tone={receipt.status === "completed" ? "success" : "warning"}>
            {receiptStatusLabels[receipt.status]}
          </Badge>
          <h2>{receipt.code}</h2>
          <p>
            Поступление {receiptDate(receipt.receivedAt)} · Москва
            <br />
            {receipt.completedAt
              ? `Завершена ${receiptDate(receipt.completedAt)}`
              : "Товар становится доступным после размещения каждой паллеты."}
          </p>
        </div>
        <div className={styles.detailActions}>
          <Link
            className="button button--secondary button--sm"
            href={`/receiving/${receipt.id}/labels`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Printer size={15} />
            Этикетки приёмки
          </Link>
        </div>
      </div>
      <div className={styles.documentBottom}>
        <span>
          Размещено {progress.placed} из {progress.total} паллет
        </span>
        <span>{Math.round(progress.percent)}%</span>
      </div>
      <div
        className={styles.progress}
        role="progressbar"
        aria-label="Размещение паллет"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.placed}
      >
        <span style={{ width: `${progress.percent}%` }} />
      </div>
      <div className={styles.palletList}>
        {receipt.pallets.map((row) => {
          const pallet = data.pallets.find((item) => item.id === row.palletId);
          const sku = data.skus.find((item) => item.id === row.skuId);
          const location = data.locations.find(
            (item) => item.id === row.locationId,
          );
          const employee = data.employees.find(
            (item) => item.id === row.placedByEmployeeId,
          );
          return (
            <article key={row.palletId} className={styles.pallet}>
              <div className={styles.palletTop}>
                <span className={styles.palletIcon}>
                  <Package size={17} />
                </span>
                <div className={styles.palletName}>
                  <strong>{sku?.name ?? "Тематика недоступна"}</strong>
                  <small>{pallet?.code ?? row.palletId}</small>
                </div>
                <div className={styles.palletQuantity}>
                  {number(row.quantity)}
                  <span>шт.</span>
                </div>
              </div>
              <div className={styles.palletBottom}>
                <Badge tone={row.placedAt ? "success" : "warning"}>
                  {row.placedAt ? (
                    <>
                      <Check size={12} />
                      Размещена
                    </>
                  ) : (
                    "Ожидает размещения"
                  )}
                </Badge>
                {pallet && (
                  <span className={styles.help}>
                    {pallet.widthMm / 10} × {pallet.depthMm / 10} ×{" "}
                    {pallet.heightMm / 10} см
                  </span>
                )}
                <Link
                  target="_blank"
                  rel="noopener noreferrer"
                  className="button button--ghost button--sm"
                  href={`/labels/pallet/${row.palletId}`}
                  aria-label={`Этикетка паллеты ${pallet?.code ?? row.palletId}`}
                >
                  <ScanLine size={15} />
                  QR
                </Link>
                {!row.placedAt && (
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() => onPlace(row.palletId)}
                  >
                    Разместить
                  </Button>
                )}
              </div>
              {row.placedAt && (
                <div className={styles.history}>
                  <span>
                    Размещено:{" "}
                    <strong>
                      {location?.code ?? row.locationId ?? "Адрес недоступен"}
                    </strong>{" "}
                    · {employee?.name ?? "Сотрудник недоступен"}
                  </span>
                  <span>{receiptDate(row.placedAt)} · Москва</span>
                  <span>
                    Адрес и количество зафиксированы на момент приёмки.
                  </span>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
