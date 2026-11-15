"use client";

import Link from "next/link";
import { ChevronDown, QrCode, Search } from "lucide-react";
import type { ReactNode } from "react";
import { useWorkspace } from "@/entities/workspace";
import type { WorkspaceDto } from "@/shared/api/generated/model";
import { date, number } from "@/shared/lib/format";
import { Button, ErrorState, Input, LoadingState, Select } from "@/shared/ui";
import {
  isVisibleInventoryPallet,
  skuInventory,
} from "../lib/inventory-balance";
import {
  useInventoryFilter,
  type InventoryView,
} from "../lib/use-inventory-filter";
import { palletComposition, palletMatchesSkus } from "../lib/pallet-stock";
import { boxPlacement } from "../lib/box-placement";
import styles from "./inventory.module.css";

const viewLabels: Record<InventoryView, string> = {
  summary: "По тематикам",
  pallets: "Паллеты",
  boxes: "Короба",
};

const quantityColumns = [
  { key: "totalUnits", title: "Всего", unit: "шт." },
  { key: "rawUnits", title: "До сборки", unit: "шт." },
  { key: "workInProgressUnits", title: "В сборке", unit: "шт." },
  { key: "boxedUnits", title: "В коробах", unit: "шт." },
  { key: "reservedUnits", title: "В резерве", unit: "шт." },
  { key: "boxesCount", title: "Готовые короба", unit: "" },
] as const;

type Stock = ReturnType<typeof skuInventory>;

function StockTable({
  label,
  headers,
  children,
}: {
  label: string;
  headers: ReactNode[];
  children: ReactNode;
}) {
  return (
    <div
      className={styles.scroll}
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      <table className={styles.table}>
        <thead>
          <tr>
            {headers.map((header, index) => (
              <th key={index} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {children || (
            <tr>
              <td colSpan={headers.length} className={styles.empty}>
                Ничего не найдено
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function QuantityCells({ stock }: { stock: Stock }) {
  return quantityColumns.map(({ key }) => (
    <td
      key={key}
      className={key === "totalUnits" ? styles.balance : undefined}
      data-zero={stock[key] === 0 || undefined}
    >
      {number(stock[key])}
    </td>
  ));
}

function BalanceTable({
  data,
  skus,
  filtered,
}: {
  data: WorkspaceDto;
  skus: WorkspaceDto["skus"];
  filtered: boolean;
}) {
  const rows = skus.map((sku) => ({ sku, stock: skuInventory(data, sku.id) }));
  const totals = filtered
    ? rows.reduce<Stock>(
        (sum, { stock }) => {
          for (const { key } of quantityColumns) sum[key] += stock[key];
          return sum;
        },
        {
          totalUnits: 0,
          rawUnits: 0,
          workInProgressUnits: 0,
          boxedUnits: 0,
          reservedUnits: 0,
          boxesCount: 0,
        },
      )
    : {
        ...data.balance,
        reservedUnits: rows.reduce(
          (sum, row) => sum + row.stock.reservedUnits,
          0,
        ),
        boxesCount: rows.reduce((sum, row) => sum + row.stock.boxesCount, 0),
      };

  return (
    <div className={styles.summary}>
      <StockTable
        label="Остатки по тематикам"
        headers={[
          "Товар",
          ...quantityColumns.map(({ title, unit }) => (
            <>
              {title}
              {unit && <small>{unit}</small>}
            </>
          )),
          <>
            Норма<small>шт. / короб</small>
          </>,
        ]}
      >
        {rows.length > 0 && (
          <>
            <tr className={styles.totals}>
              <th scope="row">{filtered ? "Итого по поиску" : "Итого"}</th>
              <QuantityCells stock={totals} />
              <td>—</td>
            </tr>
            {rows.map(({ sku, stock }) => (
              <tr key={sku.id}>
                <th scope="row">
                  {sku.name}
                  <span className={styles.secondary}>{sku.code}</span>
                </th>
                <QuantityCells stock={stock} />
                <td>{number(sku.unitsPerBox)}</td>
              </tr>
            ))}
          </>
        )}
      </StockTable>
    </div>
  );
}

function LabelLink({
  type,
  id,
  code,
}: {
  type: "pallet" | "box";
  id: string;
  code: string;
}) {
  return (
    <Link
      href={`/labels/${type}/${id}`}
      className={styles.label}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Этикетка ${code}`}
      title={`Этикетка ${code}`}
    >
      <QrCode size={18} aria-hidden="true" />
    </Link>
  );
}

function PalletTable({
  data,
  skuIds,
  filtered,
}: {
  data: WorkspaceDto;
  skuIds: ReadonlySet<string>;
  filtered: boolean;
}) {
  const pallets = data.pallets.filter(
    (pallet) =>
      isVisibleInventoryPallet(pallet) &&
      palletMatchesSkus(data, pallet, skuIds, !filtered),
  );
  return (
    <StockTable
      label="Остатки на паллетах"
      headers={["Паллета", "Товар", "Адрес", "Количество", "Поступление", "QR"]}
    >
      {pallets.length > 0 &&
        pallets.map((pallet) => {
          const status =
            pallet.status === "in_transit"
              ? "В перемещении"
              : pallet.status === "retired"
                ? "Снят с хранения"
                : pallet.quantity === 0
                  ? "Пустой поддон"
                  : pallet.kind === "assembly"
                    ? "На накоплении"
                    : "На хранении";
          const address = data.locations.find(
            (location) => location.id === pallet.locationId,
          )?.code;
          const receivedAt = data.lots.find(
            (lot) => lot.id === pallet.lotId,
          )?.receivedAt;
          return (
            <tr key={pallet.id}>
              <th scope="row">
                {pallet.code}
                <span className={styles.secondary}>{status}</span>
              </th>
              <td>
                {pallet.kind === "assembly" ? (
                  <>
                    Общая паллета сборки
                    {palletComposition(data, pallet.id).map((row) => (
                      <div className={styles.secondary} key={row.skuId}>
                        {row.name} · {number(row.boxes)} кор. ·{" "}
                        {number(row.units)} шт.
                      </div>
                    ))}
                  </>
                ) : (
                  (data.skus.find((sku) => sku.id === pallet.skuId)?.name ??
                  "—")
                )}
              </td>
              <td>
                {address ?? (pallet.status === "in_transit" ? "В пути" : "—")}
              </td>
              <td className={styles.quantity}>
                {number(pallet.quantity)}{" "}
                {pallet.kind === "raw" ? "шт." : "кор."}
              </td>
              <td>
                {receivedAt ? (
                  <time dateTime={receivedAt}>{date(receivedAt)}</time>
                ) : (
                  "—"
                )}
              </td>
              <td>
                <LabelLink type="pallet" id={pallet.id} code={pallet.code} />
              </td>
            </tr>
          );
        })}
    </StockTable>
  );
}

function BoxTable({
  data,
  skuIds,
}: {
  data: WorkspaceDto;
  skuIds: ReadonlySet<string>;
}) {
  const boxes = data.boxes.filter((box) => skuIds.has(box.skuId));
  return (
    <StockTable
      label="Короба на складе и в истории"
      headers={["Короб", "Товар", "Состав", "Адрес", "Статус", "QR"]}
    >
      {boxes.length > 0 &&
        boxes.map((box) => {
          const placement = boxPlacement(data, box);
          return (
            <tr key={box.id}>
              <th scope="row">{box.code}</th>
              <td>
                {data.skus.find((sku) => sku.id === box.skuId)?.name ?? "—"}
              </td>
              <td>
                {box.lotContents
                  .map((lot) => `${number(lot.quantity)} шт.`)
                  .join(" + ") || "—"}
                {box.lotContents.length > 1 && (
                  <span className={styles.secondary}>Смешанный короб</span>
                )}
              </td>
              <td>{placement.address}</td>
              <td>
                <span className={styles.status} data-tone={placement.tone}>
                  {placement.status}
                </span>
              </td>
              <td>
                <LabelLink type="box" id={box.id} code={box.code} />
              </td>
            </tr>
          );
        })}
    </StockTable>
  );
}

export function InventoryFeature({
  onCorrection,
}: {
  onCorrection?: () => void;
}) {
  const { data, isPending, isError, refetch } = useWorkspace();
  const { search, setSearch, view, setView } = useInventoryFilter();
  if (isPending) return <LoadingState />;
  if (!data) return <ErrorState onRetry={() => void refetch()} />;

  const query = search.trim().toLocaleLowerCase("ru");
  const skus = data.skus
    .filter((sku) =>
      [sku.name, sku.code, sku.barcode, ...(sku.alternateBarcodes ?? [])]
        .join(" ")
        .toLocaleLowerCase("ru")
        .includes(query),
    )
    .sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true }));
  const skuIds = new Set(skus.map((sku) => sku.id));

  return (
    <section className={styles.panel} aria-label="Остатки">
      <div
        className={styles.filters}
        role="group"
        aria-label="Фильтры остатков"
      >
        <div className={styles.view}>
          <Select
            aria-label="Вид остатков"
            value={view}
            onChange={(event) => setView(event.target.value as InventoryView)}
          >
            {Object.entries(viewLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <ChevronDown size={16} aria-hidden="true" />
        </div>
        <div className={styles.search}>
          <Search size={16} aria-hidden="true" />
          <Input
            type="search"
            aria-label="Поиск по товару"
            placeholder="Тематика, артикул или штрихкод"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      {isError && (
        <div className={styles.notice} role="alert">
          Не удалось обновить остатки.
          <Button size="sm" variant="ghost" onClick={() => void refetch()}>
            Повторить
          </Button>
        </div>
      )}
      {view === "summary" ? (
        <BalanceTable data={data} skus={skus} filtered={!!query} />
      ) : view === "pallets" ? (
        <PalletTable data={data} skuIds={skuIds} filtered={!!query} />
      ) : (
        <BoxTable data={data} skuIds={skuIds} />
      )}
      {onCorrection && (
        <div className={styles.footer}>
          <Button
            size="sm"
            variant="ghost"
            onClick={onCorrection}
            aria-haspopup="dialog"
          >
            Корректировка остатков
          </Button>
        </div>
      )}
    </section>
  );
}
