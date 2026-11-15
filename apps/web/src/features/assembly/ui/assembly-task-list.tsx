import Link from "next/link";
import { ChevronDown, Search } from "lucide-react";
import type { TaskDto, WorkspaceDto } from "@/shared/api/generated/model";
import { Input, Select } from "@/shared/ui";
import { taskStatusLabels, type QueueFilter } from "../lib/assembly-queue";
import styles from "./assembly.module.css";

const filters: { value: QueueFilter; label: string }[] = [
  { value: "open", label: "Незавершённые" },
  { value: "free", label: "Свободные" },
  { value: "assigned", label: "Назначенные и на паузе" },
  { value: "active", label: "В работе" },
  { value: "completed", label: "Завершённые" },
];

export function AssemblyTaskList({
  data,
  tasks,
  filter,
  search,
  showLabels,
  onFilter,
  onSearch,
  onSelect,
}: {
  data: WorkspaceDto;
  tasks: TaskDto[];
  filter: QueueFilter;
  search: string;
  showLabels: boolean;
  onFilter: (filter: QueueFilter) => void;
  onSearch: (value: string) => void;
  onSelect: (id: string) => void;
}) {
  const names = new Map(data.skus.map((sku) => [sku.id, sku.name]));
  const employees = new Map(
    data.employees.map((employee) => [employee.id, employee.name]),
  );

  return (
    <section className={styles.panel} aria-label="Задания на сборку">
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
        aria-label="Таблица заданий на сборку"
        tabIndex={0}
      >
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Задание</th>
              <th scope="col">Товар</th>
              <th scope="col">Исполнитель</th>
              <th scope="col">Собрано</th>
              <th scope="col">Статус</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id}>
                <th scope="row">
                  <button
                    type="button"
                    className={styles.document}
                    onClick={() => onSelect(task.id)}
                  >
                    {task.code}
                  </button>
                </th>
                <td>{names.get(task.skuId) ?? "Товар недоступен"}</td>
                <td>
                  {(task.employeeId && employees.get(task.employeeId)) || "—"}
                </td>
                <td className={styles.quantity}>
                  {task.boxesCompleted} из {task.boxesTarget} кор.
                  {task.scannedUnits > 0 && (
                    <span className={styles.secondary}>
                      {task.scannedUnits} из {task.unitsPerBox} шт. в коробе
                    </span>
                  )}
                </td>
                <td className={styles.status} data-status={task.status}>
                  {taskStatusLabels[task.status]}
                </td>
              </tr>
            ))}
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
      {showLabels && (
        <footer className={styles.tableFooter}>
          <Link href="/labels/boxes" className={styles.textLink}>
            Этикетки коробов
          </Link>
        </footer>
      )}
    </section>
  );
}
