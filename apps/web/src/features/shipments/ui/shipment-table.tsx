import { ChevronDown, Search } from "lucide-react";
import type { WorkspaceDto } from "@/shared/api/generated/model";
import { Input, Select } from "@/shared/ui";
import { number } from "@/shared/lib/format";
import { shipmentStatus, type ShipmentFilter } from "../lib/shipment-list";
import { shipmentReadiness } from "../lib/shipment-readiness";
import styles from "./shipments.module.css";

const filters: { value: ShipmentFilter; label: string }[] = [
  { value: "active", label: "Активные" },
  { value: "ready", label: "Готовые к отправке" },
  { value: "shipped", label: "Отправленные" },
  { value: "all", label: "Все" },
];

export function ShipmentTable({
  data,
  filter,
  search,
  pending,
  onFilter,
  onSearch,
  onSelect,
}: {
  data: WorkspaceDto;
  filter: ShipmentFilter;
  search: string;
  pending: boolean;
  onFilter: (filter: ShipmentFilter) => void;
  onSearch: (search: string) => void;
  onSelect: (id: string) => void;
}) {
  const products = new Map(data.skus.map((sku) => [sku.id, sku.name]));
  const employees = new Map(
    data.employees.map((employee) => [employee.id, employee.name]),
  );
  const query = search.trim().toLocaleLowerCase("ru-RU");
  const rows = data.shipments
    .filter((shipment) => {
      if (filter === "all") return true;
      return filter === "shipped"
        ? shipment.status === "shipped"
        : shipment.status === "draft";
    })
    .map((shipment) => {
      const title = shipment.wb
        ? `Поставка WB № ${shipment.wb.supplyId}`
        : (products.get(shipment.skuId) ?? "Товар недоступен");
      const employee = shipment.employeeId
        ? employees.get(shipment.employeeId)
        : undefined;
      const picked = new Set(shipment.scannedBoxIds).size;
      const ready =
        shipment.status === "draft" &&
        shipment.pickingMode === "box" &&
        picked === shipment.boxesRequested &&
        shipmentReadiness(data, shipment).ready;

      return { shipment, title, employee, picked, ready };
    })
    .filter(
      ({ shipment, title, employee, ready }) =>
        (filter !== "ready" || ready) &&
        [shipment.code, title, employee]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("ru-RU")
          .includes(query),
    )
    .reverse();

  return (
    <section className={styles.panel} aria-label="Список отгрузок">
      <div
        className={styles.filters}
        role="group"
        aria-label="Фильтры отгрузок"
      >
        <label className={styles.filterField}>
          Статус
          <span className={styles.bucket}>
            <Select
              value={filter}
              onChange={(event) => {
                const next = filters.find(
                  ({ value }) => value === event.target.value,
                );
                if (next) onFilter(next.value);
              }}
            >
              {filters.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <ChevronDown size={16} aria-hidden="true" />
          </span>
        </label>
        <label className={styles.filterField}>
          Поиск
          <span className={styles.search}>
            <Search size={16} aria-hidden="true" />
            <Input
              type="search"
              placeholder="Номер, товар, сотрудник"
              value={search}
              onChange={(event) => onSearch(event.target.value)}
            />
          </span>
        </label>
      </div>
      <div
        className={styles.scroll}
        role="region"
        aria-label="Таблица отгрузок"
        tabIndex={0}
      >
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Отгрузка</th>
              <th scope="col">Товар / поставка</th>
              <th scope="col">Короба</th>
              <th scope="col">Исполнитель</th>
              <th scope="col">Статус</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ shipment, title, employee, picked, ready }) => (
              <tr key={shipment.id}>
                <th scope="row">
                  <button
                    type="button"
                    className={styles.document}
                    disabled={pending}
                    onClick={() => onSelect(shipment.id)}
                  >
                    {shipment.code}
                  </button>
                </th>
                <td>{title}</td>
                <td className={styles.quantity}>
                  {number(shipment.boxesRequested)}
                  {shipment.status === "draft" &&
                    shipment.pickingMode === "box" && (
                      <span className={styles.secondary}>
                        Отобрано {number(picked)}
                      </span>
                    )}
                </td>
                <td>
                  {employee ?? (shipment.employeeId ? "Недоступен" : "—")}
                </td>
                <td
                  className={styles.status}
                  data-confirmed={shipment.status === "shipped" || ready}
                >
                  {shipmentStatus(shipment, ready)}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} className={styles.empty}>
                  {query ? "Отгрузки не найдены." : "Отгрузок нет."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
