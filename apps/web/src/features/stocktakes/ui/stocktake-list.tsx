import { ArrowLeft, ArrowRight, ChevronDown, Search } from "lucide-react";
import type { StocktakeListDto } from "@/shared/api/generated/model";
import { Button, Input, Select } from "@/shared/ui";
import {
  stocktakeDate,
  stocktakePages,
  stocktakeStatus,
} from "../lib/stocktake-view";
import styles from "./stocktake-list.module.css";

export function StocktakeList({
  data,
  archive,
  pending,
  onPage,
  onArchive,
  onSelect,
  search,
  onSearch,
}: {
  data: StocktakeListDto;
  archive: boolean;
  pending: boolean;
  onPage: (value: number) => void;
  onArchive: (value: boolean) => void;
  onSelect: (id: string) => void;
  search: string;
  onSearch: (value: string) => void;
}) {
  const query = search.trim().toLocaleLowerCase("ru");
  const items = data.items.filter((item) =>
    `${item.code} ${item.employeeName ?? ""}`
      .toLocaleLowerCase("ru")
      .includes(query),
  );
  const pages = stocktakePages(data.total, data.pageSize);

  return (
    <section className={styles.panel} aria-label="Документы инвентаризации">
      <div className={styles.filters} role="group" aria-label="Фильтры">
        <div className={styles.bucket}>
          <Select
            aria-label="Вид документов"
            value={archive ? "archive" : "active"}
            onChange={(event) => onArchive(event.target.value === "archive")}
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
            aria-label="Поиск по текущей странице"
            placeholder="Номер или исполнитель"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
          />
        </div>
      </div>
      <div
        className={styles.scroll}
        role="region"
        aria-label="Таблица инвентаризаций"
        tabIndex={0}
      >
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Документ</th>
              <th scope="col">Создан</th>
              <th scope="col">Исполнитель</th>
              <th scope="col">Пересчитано</th>
              <th scope="col">Статус</th>
            </tr>
          </thead>
          <tbody>
            {items.length ? (
              items.map((item) => (
                <tr key={item.id}>
                  <th scope="row">
                    <button
                      type="button"
                      className={styles.document}
                      onClick={() => onSelect(item.id)}
                    >
                      {item.code}
                    </button>
                    {item.mode === "opening" && (
                      <span className={styles.secondary}>Первичный ввод</span>
                    )}
                  </th>
                  <td className={styles.date}>
                    <time dateTime={item.createdAt}>
                      {stocktakeDate(item.createdAt)}
                    </time>
                  </td>
                  <td>{item.employeeName ?? "—"}</td>
                  <td>
                    <span className={styles.count}>
                      {item.locationsCounted} из {item.locationsTotal}
                    </span>
                    {item.staleLocations > 0 && (
                      <span className={styles.stale}>
                        Устарело: {item.staleLocations}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={styles.status} data-status={item.status}>
                      {stocktakeStatus(item.status)}
                    </span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className={styles.empty}>
                  {query
                    ? "На этой странице ничего не найдено."
                    : archive
                      ? "Архив пуст."
                      : "Активных документов нет."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {(pages > 1 || data.page > 1) && (
        <nav className={styles.pagination} aria-label="Страницы инвентаризаций">
          <span>Документов: {data.total}</span>
          <div>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending || data.page <= 1}
              onClick={() => onPage(data.page - 1)}
              aria-label="Предыдущая страница"
            >
              <ArrowLeft size={15} aria-hidden="true" />
            </Button>
            <span>
              {data.page} / {pages}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending || data.page >= pages}
              onClick={() => onPage(data.page + 1)}
              aria-label="Следующая страница"
            >
              <ArrowRight size={15} aria-hidden="true" />
            </Button>
          </div>
        </nav>
      )}
    </section>
  );
}
