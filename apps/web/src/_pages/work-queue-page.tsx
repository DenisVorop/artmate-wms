"use client";

import { useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { useSession } from "@/entities/session";
import { useWorkspace } from "@/entities/workspace";
import {
  buildWorkQueue,
  filterWorkQueue,
  useWorkQueueStocktakes,
  workQueueKindLabels,
  workQueueStateLabels,
  type WorkQueueJob,
  type WorkQueueKind,
} from "@/entities/work-queue";
import { WorkspaceShell } from "@/widgets/workspace-shell";
import { EmployeeWorkspace } from "@/widgets/employee-workspace";
import { WorkAutomation } from "@/features/work-automation";
import {
  Button,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  Select,
} from "@/shared/ui";
import styles from "./work-queue-page.module.css";

const openStates = ["queued", "active", "paused", "review"] as const;
type StateFilter = (typeof openStates)[number] | "open" | "archive";

function WorkQueueRow({ job }: { job: WorkQueueJob }) {
  const name = job.skuName ?? job.objectLabel;
  const codes = [...new Set([job.code, job.objectLabel])].filter(
    (value) => value !== name,
  );
  return (
    <tr>
      <th scope="row">
        <Link
          href={job.href}
          className={styles.jobLink}
          aria-label={codes.length ? `${name}, ${codes.join(", ")}` : undefined}
        >
          {name}
        </Link>
        {codes.length > 0 && (
          <span className={styles.secondary}>{codes.join(" · ")}</span>
        )}
      </th>
      <td>
        {job.title}
        {job.quantityLabel && (
          <span className={styles.secondary}>{job.quantityLabel}</span>
        )}
      </td>
      <td>{job.employeeName ?? "—"}</td>
      <td>
        <span className={styles.status} data-state={job.state}>
          {job.statusLabel}
        </span>
      </td>
    </tr>
  );
}

function ManagerWorkQueue() {
  const workspace = useWorkspace();
  const [kind, setKind] = useState<WorkQueueKind | "all">("all");
  const [state, setState] = useState<StateFilter>("open");
  const [employeeId, setEmployeeId] = useState("all");
  const [search, setSearch] = useState("");
  const [automationOpen, setAutomationOpen] = useState(false);
  const archive = state === "archive";
  const showStocktakes = kind === "all" || kind === "stocktake";
  const stocktakes = useWorkQueueStocktakes(
    archive ? "archive" : "active",
    showStocktakes,
  );

  const filtered =
    kind !== "all" || state !== "open" || employeeId !== "all" || search !== "";
  const visible = workspace.data
    ? filterWorkQueue(
        buildWorkQueue(workspace.data, showStocktakes ? stocktakes.items : [], {
          manager: true,
        }),
        { kind, state, employeeId, search },
      )
    : [];
  const awaitingStocktakes = showStocktakes && stocktakes.isPending;

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <h1 className="page-heading">Все задания</h1>
        <Button
          variant="secondary"
          aria-haspopup="dialog"
          onClick={() => setAutomationOpen(true)}
        >
          Автоматизация
        </Button>
      </header>

      <Modal
        open={automationOpen}
        onClose={() => setAutomationOpen(false)}
        title="Автоматизация"
      >
        {automationOpen && <WorkAutomation />}
      </Modal>

      {workspace.isPending ? (
        <LoadingState />
      ) : !workspace.data ? (
        <ErrorState onRetry={() => void workspace.refetch()} />
      ) : (
        <>
          <section className={styles.filters} aria-label="Фильтры заданий">
            <label>
              <span>Вид работы</span>
              <Select
                value={kind}
                onChange={(event) =>
                  setKind(event.target.value as WorkQueueKind | "all")
                }
              >
                <option value="all">Все виды</option>
                {Object.entries(workQueueKindLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              <span>Статус</span>
              <Select
                value={state}
                onChange={(event) =>
                  setState(event.target.value as StateFilter)
                }
              >
                <option value="open">Незавершённые</option>
                {openStates.map((value) => (
                  <option key={value} value={value}>
                    {workQueueStateLabels[value]}
                  </option>
                ))}
                <option value="archive">Завершённые и отменённые</option>
              </Select>
            </label>
            <label>
              <span>Исполнитель</span>
              <Select
                value={employeeId}
                onChange={(event) => setEmployeeId(event.target.value)}
              >
                <option value="all">Все сотрудники</option>
                <option value="free">Без исполнителя</option>
                {workspace.data.employees.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              <span>Поиск</span>
              <span className={styles.search}>
                <Search size={16} aria-hidden="true" />
                <Input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Код, товар, адрес"
                />
              </span>
            </label>
            <Button
              variant="secondary"
              disabled={!filtered}
              onClick={() => {
                setKind("all");
                setState("open");
                setEmployeeId("all");
                setSearch("");
              }}
            >
              Сбросить
            </Button>
          </section>

          <section className={styles.results} aria-label="Результаты">
            {workspace.isError && (
              <div className={styles.notice} role="alert">
                Не удалось обновить задания.
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void workspace.refetch()}
                >
                  Повторить
                </Button>
              </div>
            )}
            {showStocktakes && stocktakes.isError && (
              <div className={styles.notice} role="alert">
                Не удалось загрузить инвентаризации.
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void stocktakes.refetch()}
                >
                  Повторить
                </Button>
              </div>
            )}
            <div
              className={styles.tableScroll}
              role="region"
              aria-label="Таблица заданий"
              tabIndex={0}
            >
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Задание</th>
                    <th scope="col">Вид работы</th>
                    <th scope="col">Исполнитель</th>
                    <th scope="col">Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length ? (
                    visible.map((job) => (
                      <WorkQueueRow key={job.id} job={job} />
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className={styles.empty}>
                        {awaitingStocktakes
                          ? "Загрузка инвентаризаций…"
                          : showStocktakes && stocktakes.isError
                            ? "Других заданий нет."
                            : "Заданий нет."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <footer className={styles.footer}>
              <span role="status">
                Показано: {visible.length}
                {awaitingStocktakes && visible.length > 0
                  ? " · Загружаем инвентаризации…"
                  : ""}
              </span>
              {showStocktakes && stocktakes.hasNextPage && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={stocktakes.isFetchingNextPage}
                  onClick={() => void stocktakes.fetchNextPage()}
                >
                  {stocktakes.isFetchingNextPage
                    ? "Загружаем…"
                    : "Показать ещё инвентаризации"}
                </Button>
              )}
            </footer>
          </section>
        </>
      )}
    </div>
  );
}

export function WorkQueuePage() {
  const { user } = useSession();
  if (!user) return <LoadingState />;
  if (user.role === "employee") return <EmployeeWorkspace />;
  return (
    <WorkspaceShell showFooter={false} theme="light">
      <ManagerWorkQueue />
    </WorkspaceShell>
  );
}
