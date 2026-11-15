import { ArrowRight, ChevronDown, Search } from "lucide-react";
import type { WorkspaceDto } from "@/shared/api/generated/model";
import { Input, Select } from "@/shared/ui";
import {
  movementPalletName,
  movementStatuses,
  movementTitle,
} from "../lib/movement-form";
import {
  matchesMovementFilter,
  type MovementFilter,
} from "../lib/movement-list";
import styles from "./movements.module.css";

const filters: { value: MovementFilter; label: string }[] = [
  { value: "active", label: "Активные" },
  { value: "planned", label: "Ожидают забора" },
  { value: "in_transit", label: "В пути" },
  { value: "completed", label: "Завершённые" },
  { value: "cancelled", label: "Отменённые" },
  { value: "all", label: "Все" },
];

export function MovementTaskList({
  data,
  addresses,
  filter,
  search,
  onFilter,
  onSearch,
  onSelect,
}: {
  data: WorkspaceDto;
  addresses: Map<string, string>;
  filter: MovementFilter;
  search: string;
  onFilter: (value: MovementFilter) => void;
  onSearch: (value: string) => void;
  onSelect: (id: string) => void;
}) {
  const pallets = new Map(data.pallets.map((item) => [item.id, item]));
  const employees = new Map(data.employees.map((item) => [item.id, item.name]));
  const query = search.trim().toLocaleLowerCase("ru-RU");
  const rows = data.movements
    .filter((item) => matchesMovementFilter(item, filter))
    .map((item) => {
      const pallet = pallets.get(item.palletId);
      return {
        item,
        palletCode: pallet?.code,
        product: movementPalletName(data, pallet),
        employee: item.employeeId ? employees.get(item.employeeId) : undefined,
        from: addresses.get(item.fromLocationId),
        to: addresses.get(item.toLocationId),
      };
    })
    .filter(({ item, palletCode, product, employee, from, to }) =>
      [item.code, palletCode, product, employee, from, to]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("ru-RU")
        .includes(query),
    )
    .reverse();

  return (
    <section className={styles.panel} aria-label="Задания на перемещение">
      <div className={styles.filters} role="group" aria-label="Фильтры заданий">
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
              placeholder="Код, товар, адрес, сотрудник"
              value={search}
              onChange={(event) => onSearch(event.target.value)}
            />
          </span>
        </label>
      </div>
      <div
        className={styles.scroll}
        role="region"
        aria-label="Таблица перемещений"
        tabIndex={0}
      >
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Задание</th>
              <th scope="col">Паллета</th>
              <th scope="col">Маршрут</th>
              <th scope="col">Исполнитель</th>
              <th scope="col">Статус</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ item, palletCode, product, employee, from, to }) => (
              <tr key={item.id}>
                <th scope="row">
                  <button
                    type="button"
                    className={styles.document}
                    onClick={() => onSelect(item.id)}
                  >
                    {item.code}
                  </button>
                  <span className={styles.secondary}>
                    {movementTitle(item)}
                  </span>
                </th>
                <td>
                  {product}
                  {palletCode && (
                    <span className={styles.secondary}>{palletCode}</span>
                  )}
                </td>
                <td>
                  <span className={styles.tableRoute}>
                    <span>{from ?? "—"}</span>
                    <ArrowRight size={13} aria-label="в" />
                    <span>{to ?? "—"}</span>
                  </span>
                </td>
                <td>{employee ?? (item.employeeId ? "Недоступен" : "—")}</td>
                <td className={styles.status} data-status={item.status}>
                  {movementStatuses[item.status]}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} className={styles.empty}>
                  {query ? "Перемещения не найдены." : "Перемещений нет."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
