import { ChevronDown, Search } from "lucide-react";
import type {
  PutawayTaskDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";
import { Input, Select } from "@/shared/ui";
import { putawayStatusLabels, type PutawayFilter } from "../lib/putaway-queue";
import styles from "./putaway.module.css";

const filters: { value: PutawayFilter; label: string }[] = [
  { value: "open", label: "Незавершённые" },
  { value: "queued", label: "Свободные" },
  { value: "active", label: "В работе" },
  { value: "mine", label: "Мои в работе" },
  { value: "completed", label: "Завершённые" },
];

export function PutawayTaskList({
  data,
  tasks,
  filter,
  search,
  showMine,
  onFilter,
  onSearch,
  onSelect,
}: {
  data: WorkspaceDto;
  tasks: PutawayTaskDto[];
  filter: PutawayFilter;
  search: string;
  showMine: boolean;
  onFilter: (filter: PutawayFilter) => void;
  onSearch: (value: string) => void;
  onSelect: (id: string) => void;
}) {
  const boxes = new Map(data.boxes.map((box) => [box.id, box]));
  const products = new Map(data.skus.map((sku) => [sku.id, sku.name]));
  const employees = new Map(
    data.employees.map((employee) => [employee.id, employee.name]),
  );
  const addresses = new Map(
    data.locations.map((place) => [place.id, place.code]),
  );

  return (
    <section className={styles.panel} aria-label="Задания на размещение">
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
              {filters
                .filter(({ value }) => value !== "mine" || showMine)
                .map(({ value, label }) => (
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
              placeholder="Задание, короб, товар, сотрудник"
              value={search}
              onChange={(event) => onSearch(event.target.value)}
            />
          </span>
        </label>
      </div>
      <div
        className={styles.scroll}
        role="region"
        aria-label="Таблица заданий на размещение"
        tabIndex={0}
      >
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Задание</th>
              <th scope="col">Товар</th>
              <th scope="col">Исполнитель</th>
              <th scope="col">Адрес хранения</th>
              <th scope="col">Статус</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => {
              const box = boxes.get(task.boxId);
              return (
                <tr key={task.id}>
                  <th scope="row">
                    <button
                      type="button"
                      className={styles.document}
                      onClick={() => onSelect(task.id)}
                    >
                      {task.code}
                    </button>
                    {box && (
                      <span className={styles.secondary}>{box.code}</span>
                    )}
                  </th>
                  <td>{products.get(task.skuId) ?? "Товар недоступен"}</td>
                  <td>
                    {(task.employeeId && employees.get(task.employeeId)) || "—"}
                  </td>
                  <td>
                    {(task.toLocationId && addresses.get(task.toLocationId)) ||
                      "—"}
                  </td>
                  <td className={styles.status} data-status={task.status}>
                    {putawayStatusLabels[task.status]}
                  </td>
                </tr>
              );
            })}
            {!tasks.length && (
              <tr>
                <td colSpan={5} className={styles.empty}>
                  {search.trim() ? "Задания не найдены." : "Заданий нет."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
