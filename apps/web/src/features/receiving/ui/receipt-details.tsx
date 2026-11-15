import Link from "next/link";
import { Printer, QrCode } from "lucide-react";
import type { ReceiptDto, WorkspaceDto } from "@/shared/api/generated/model";
import { Button } from "@/shared/ui";
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
    <section className={styles.panel} aria-label={`Приёмка ${receipt.code}`}>
      <header className={styles.detailHeader}>
        <div>
          <h2>{receipt.code}</h2>
          <p className={styles.detailMeta}>
            {receiptStatusLabels[receipt.status]} · {progress.placed} из{" "}
            {progress.total} паллет
          </p>
          <p className={styles.detailMeta}>
            Поступление{" "}
            <time dateTime={receipt.receivedAt}>
              {receiptDate(receipt.receivedAt)}
            </time>
            {receipt.completedAt && (
              <>
                {" "}
                · Завершена{" "}
                <time dateTime={receipt.completedAt}>
                  {receiptDate(receipt.completedAt)}
                </time>
              </>
            )}
          </p>
        </div>
        <Link
          className="button button--secondary button--sm"
          href={`/receiving/${receipt.id}/labels`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Printer size={15} aria-hidden="true" />
          Этикетки приёмки
        </Link>
      </header>
      <div
        className={styles.scroll}
        role="region"
        aria-label="Паллеты приёмки"
        tabIndex={0}
      >
        <table className={`${styles.table} ${styles.palletTable}`}>
          <thead>
            <tr>
              <th scope="col">Паллета</th>
              <th scope="col">Товар</th>
              <th scope="col">Кол-во, шт.</th>
              <th scope="col">Размещение</th>
              <th scope="col">Действия</th>
            </tr>
          </thead>
          <tbody>
            {receipt.pallets.map((row) => {
              const pallet = data.pallets.find(
                (item) => item.id === row.palletId,
              );
              const sku = data.skus.find((item) => item.id === row.skuId);
              const location = data.locations.find(
                (item) => item.id === row.locationId,
              );
              const employee = data.employees.find(
                (item) => item.id === row.placedByEmployeeId,
              );
              const code = pallet?.code ?? row.palletId;
              return (
                <tr key={row.palletId}>
                  <th scope="row">
                    {code}
                    {pallet && (
                      <span className={styles.secondary}>
                        {pallet.widthMm / 10} × {pallet.depthMm / 10} ×{" "}
                        {pallet.heightMm / 10} см
                      </span>
                    )}
                  </th>
                  <td>{sku?.name ?? "Товар недоступен"}</td>
                  <td className={styles.quantity}>{number(row.quantity)}</td>
                  <td>
                    {row.placedAt ? (
                      <>
                        <strong>
                          {location?.code ??
                            row.locationId ??
                            "Адрес недоступен"}
                        </strong>
                        <span className={styles.secondary}>
                          <time dateTime={row.placedAt}>
                            {receiptDate(row.placedAt)}
                          </time>
                          {employee && ` · ${employee.name}`}
                        </span>
                      </>
                    ) : (
                      <span className={styles.waiting}>Ожидает размещения</span>
                    )}
                  </td>
                  <td>
                    <div className={styles.palletActions}>
                      <Link
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.qr}
                        href={`/labels/pallet/${row.palletId}`}
                        aria-label={`Этикетка паллеты ${code}`}
                        title={`Этикетка паллеты ${code}`}
                      >
                        <QrCode size={17} aria-hidden="true" />
                      </Link>
                      {!row.placedAt && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={pending}
                          onClick={() => onPlace(row.palletId)}
                        >
                          Разместить
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
