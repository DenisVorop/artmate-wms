"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GetTaskHistoryKind } from "@/shared/api/generated/model";
import { Button, ErrorState, LoadingState, Modal } from "@/shared/ui";
import { useTaskHistory } from "../model/use-task-history";
import styles from "./task-history.module.css";

const time = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));

export function TaskHistory({
  kind,
  id,
  code,
  available = true,
}: {
  kind: GetTaskHistoryKind;
  id: string;
  code: string;
  available?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) opener.current?.focus();
  }, [open]);
  const [page, setPage] = useState(1);
  const query = useTaskHistory(kind, id, page, open && available);
  const result = query.data;
  if (!available) return null;

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        aria-label={`Журнал ${code}`}
        aria-haspopup="dialog"
        onClick={(event) => {
          opener.current = event.currentTarget;
          setPage(1);
          setOpen(true);
        }}
      >
        Журнал
      </Button>
      {open &&
        createPortal(
          <Modal
            open={open}
            onClose={() => setOpen(false)}
            title={`Журнал · ${code}`}
          >
            <div className={styles.content}>
              {query.isPending ? (
                <LoadingState />
              ) : !result ? (
                <ErrorState
                  message="Не удалось загрузить журнал"
                  onRetry={() => void query.refetch()}
                />
              ) : (
                <>
                  <p className={styles.note}>
                    Время получения запроса сервером · МСК
                  </p>
                  {query.isError && (
                    <p className={styles.error} role="alert">
                      Не удалось обновить журнал. Показаны последние данные.
                    </p>
                  )}
                  <div
                    className={styles.scroll}
                    role="region"
                    aria-label="События задания"
                    tabIndex={0}
                  >
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th scope="col">Время</th>
                          <th scope="col">Сотрудник</th>
                          <th scope="col">Действие и код</th>
                          <th scope="col">Результат</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.items.map((event) => (
                          <tr key={event.id}>
                            <td className={styles.time}>
                              {time(event.receivedAt)}
                            </td>
                            <td>{event.employeeName ?? "—"}</td>
                            <td>
                              {event.action}
                              {event.scanValue && (
                                <code>{event.scanValue}</code>
                              )}
                            </td>
                            <td>
                              <span
                                className={
                                  event.result === "rejected"
                                    ? styles.error
                                    : undefined
                                }
                              >
                                {event.result === "rejected"
                                  ? "Ошибка"
                                  : event.result === "observed"
                                    ? "Получен"
                                    : "Принято"}
                              </span>
                              <small>{event.detail}</small>
                            </td>
                          </tr>
                        ))}
                        {!result.items.length && (
                          <tr>
                            <td colSpan={4}>Событий пока нет</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <p className={styles.note}>
                    Журнал ведётся с {time(result.since)}. Более ранние сканы
                    здесь не сохранены.
                  </p>
                  {result.total > result.pageSize && (
                    <nav
                      className={styles.pagination}
                      aria-label="Страницы журнала"
                    >
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={query.isFetching || page <= 1}
                        onClick={() => setPage(page - 1)}
                      >
                        Назад
                      </Button>
                      <span>
                        {page} из {Math.ceil(result.total / result.pageSize)}
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={
                          query.isFetching ||
                          page * result.pageSize >= result.total
                        }
                        onClick={() => setPage(page + 1)}
                      >
                        Далее
                      </Button>
                    </nav>
                  )}
                </>
              )}
            </div>
          </Modal>,
          document.body,
        )}
    </>
  );
}
