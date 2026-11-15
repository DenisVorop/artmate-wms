import Link from "next/link";
import { ChevronDown, Search } from "lucide-react";
import type { ReceiptDto, WorkspaceDto } from "@/shared/api/generated/model";
import { Input, Select } from "@/shared/ui";
import {
  receiptDate,
  receiptProgress,
  receiptStatusLabels,
} from "../lib/receipt-view";
import styles from "./receiving.module.css";

export function ReceiptList({
  receipts,
  skus,
  view,
  search,
  isManager,
  onView,
  onSearch,
  onSelect,
}: {
  receipts: ReceiptDto[];
  skus: WorkspaceDto["skus"];
  view: "active" | "archive";
  search: string;
  isManager: boolean;
  onView: (view: "active" | "archive") => void;
  onSearch: (value: string) => void;
  onSelect: (id: string) => void;
}) {
  const names = new Map(skus.map((sku) => [sku.id, sku.name]));

  return (
    <section className={styles.panel} aria-label="Документы приёмки">
      <div className={styles.filters} role="group" aria-label="Фильтры приёмки">
        <div className={styles.bucket}>
          <Select
            aria-label="Вид приёмок"
            value={view}
            onChange={(event) =>
              onView(event.target.value === "archive" ? "archive" : "active")
            }
          >
            <option value="active">Активные</option>
            <option value="archive">Архив</option>
          </Select>
          <ChevronDown size={16} aria-hidden="true" />
        </div>
        <div className={styles.search}>
          <Search size={16} aria-hidden="true" />
          <Input
            type="search"
            placeholder="Номер приёмки или товар"
            aria-label="Поиск приёмки"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
          />
        </div>
      </div>
      <div
        className={styles.scroll}
        role="region"
        aria-label="Таблица приёмок"
        tabIndex={0}
      >
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Приёмка</th>
              <th scope="col">
                Поступление <small>МСК</small>
              </th>
              <th scope="col">Товар</th>
              <th scope="col">Размещено</th>
              <th scope="col">Статус</th>
            </tr>
          </thead>
          <tbody>
            {receipts.length ? (
              receipts.map((receipt) => {
                const progress = receiptProgress(receipt);
                const products = [
                  ...new Set(
                    receipt.pallets.map(
                      (row) => names.get(row.skuId) ?? "Товар недоступен",
                    ),
                  ),
                ];
                return (
                  <tr key={receipt.id}>
                    <th scope="row">
                      <button
                        type="button"
                        className={styles.document}
                        onClick={() => onSelect(receipt.id)}
                      >
                        {receipt.code}
                      </button>
                    </th>
                    <td className={styles.date}>
                      <time dateTime={receipt.receivedAt}>
                        {receiptDate(receipt.receivedAt)}
                      </time>
                    </td>
                    <td>
                      {products.slice(0, 2).join(", ") || "—"}
                      {products.length > 2 && (
                        <span className={styles.secondary}>
                          Ещё {products.length - 2}
                        </span>
                      )}
                    </td>
                    <td className={styles.quantity}>
                      {progress.placed} из {progress.total}
                    </td>
                    <td
                      className={
                        receipt.status === "completed"
                          ? styles.complete
                          : styles.waiting
                      }
                    >
                      {receiptStatusLabels[receipt.status]}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={5} className={styles.empty}>
                  {search.trim()
                    ? "Приёмки не найдены."
                    : view === "archive"
                      ? "Архив пуст."
                      : "Активных приёмок нет."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {isManager && (
        <footer className={styles.tableFooter}>
          <Link href="/labels/pallets" className={styles.textLink}>
            Этикетки паллет
          </Link>
        </footer>
      )}
    </section>
  );
}
