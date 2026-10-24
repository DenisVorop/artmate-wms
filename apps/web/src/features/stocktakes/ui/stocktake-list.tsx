import { ArrowLeft, ArrowRight } from "lucide-react";
import type { StocktakeListDto } from "@/shared/api/generated/model";
import { Badge, Button, EmptyState, Input } from "@/shared/ui";
import {
  stocktakeDate,
  stocktakePages,
  stocktakeStatus,
} from "../lib/stocktake-view";
import styles from "./stocktakes.module.css";
export function StocktakeList({
  data,
  archive,
  selectedId,
  pending,
  page,
  onPage,
  onArchive,
  onSelect,
  search,
  onSearch,
}: {
  data: StocktakeListDto;
  archive: boolean;
  selectedId: string;
  pending: boolean;
  page: number;
  onPage: (value: number) => void;
  onArchive: (value: boolean) => void;
  onSelect: (id: string) => void;
  search: string;
  onSearch: (value: string) => void;
}) {
  const items = data.items.filter((item) =>
    `${item.code} ${item.employeeName ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <>
      <div className={`glass-panel ${styles.panel}`}>
        <div className={styles.segmented} aria-label="Список инвентаризаций">
          <Button
            size="sm"
            variant={archive ? "secondary" : "primary"}
            aria-pressed={!archive}
            onClick={() => onArchive(false)}
          >
            Активные
          </Button>
          <Button
            size="sm"
            variant={archive ? "primary" : "secondary"}
            aria-pressed={archive}
            onClick={() => onArchive(true)}
          >
            Архив
          </Button>
        </div>
        <Input
          className={styles.filterSearch}
          aria-label="Найти документ на этой странице"
          placeholder="Код или исполнитель на странице"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
      </div>
      <div className={styles.documentList}>
        {items.map((item) => (
          <button
            type="button"
            className={styles.document}
            key={item.id}
            aria-current={selectedId === item.id}
            onClick={() => onSelect(item.id)}
          >
            <div className={styles.documentTop}>
              <strong>{item.code}</strong>
              <Badge
                tone={
                  item.status === "approved"
                    ? "success"
                    : item.status === "review"
                      ? "warning"
                      : "neutral"
                }
              >
                {stocktakeStatus(item.status)}
              </Badge>
            </div>
            <small>
              {item.employeeName ?? "Свободен · можно взять в работу"}
              <br />
              {stocktakeDate(item.createdAt)} · {item.locationsCounted} /{" "}
              {item.locationsTotal} адресов
              {item.staleLocations > 0
                ? ` · устарело: ${item.staleLocations}`
                : ""}
            </small>
            <span className={styles.progress} aria-hidden="true">
              <span
                style={{
                  width: `${item.locationsTotal ? Math.min(100, (item.locationsCounted / item.locationsTotal) * 100) : 0}%`,
                }}
              />
            </span>
          </button>
        ))}
      </div>
      {!items.length && (
        <div className="glass-panel">
          <EmptyState
            title={
              search
                ? "На странице ничего не найдено"
                : archive
                  ? "Архив пока пуст"
                  : "Активных документов нет"
            }
            description={
              search
                ? "Очистите поиск или перейдите на другую страницу."
                : archive
                  ? "Здесь появятся утверждённые и отменённые документы."
                  : "Менеджер может создать документ, после чего сотрудник возьмёт его в работу."
            }
            action={
              search ? (
                <Button variant="secondary" onClick={() => onSearch("")}>
                  Очистить поиск
                </Button>
              ) : page > 1 ? (
                <Button variant="secondary" onClick={() => onPage(1)}>
                  На первую страницу
                </Button>
              ) : undefined
            }
          />
        </div>
      )}
      <nav className={styles.pagination} aria-label="Страницы инвентаризаций">
        <span>{data.total} документов</span>
        <div>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending || data.page <= 1}
            onClick={() => onPage(data.page - 1)}
            aria-label="Предыдущая страница документов"
          >
            <ArrowLeft size={14} />
          </Button>
          <span>
            {data.page} / {stocktakePages(data.total, data.pageSize)}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={
              pending || data.page >= stocktakePages(data.total, data.pageSize)
            }
            onClick={() => onPage(data.page + 1)}
            aria-label="Следующая страница документов"
          >
            <ArrowRight size={14} />
          </Button>
        </div>
      </nav>
    </>
  );
}
