"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ClipboardList, Search } from "lucide-react";
import { useSession } from "@/entities/session";
import { useWorkspace } from "@/entities/workspace";
import {
  buildWorkQueue,
  filterWorkQueue,
  useWorkQueueStocktakes,
  workQueueKindLabels,
  workQueueStateLabels,
  type WorkQueueKind,
  type WorkQueueState,
} from "@/entities/work-queue";
import { WorkspaceShell } from "@/widgets/workspace-shell";
import { EmployeeWorkspace } from "@/widgets/employee-workspace";
import { WorkAutomation } from "@/features/work-automation";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Select,
} from "@/shared/ui";
import styles from "./work-queue-page.module.css";

function ManagerWorkQueue() {
  const workspace = useWorkspace();
  const [kind, setKind] = useState<WorkQueueKind | "all">("all");
  const [state, setState] = useState<
    WorkQueueState | "open" | "archive" | "all"
  >("open");
  const [employeeId, setEmployeeId] = useState("all");
  const [search, setSearch] = useState("");
  const archive =
    state === "archive" || state === "completed" || state === "cancelled";
  const activeStocktakes = useWorkQueueStocktakes();
  const archivedStocktakes = useWorkQueueStocktakes("archive", archive);
  const stocktakes = archive ? archivedStocktakes : activeStocktakes;
  if (workspace.isPending) return <LoadingState />;
  if (!workspace.data)
    return <ErrorState onRetry={() => void workspace.refetch()} />;
  const jobs = buildWorkQueue(
    workspace.data,
    [...activeStocktakes.items, ...(archive ? archivedStocktakes.items : [])],
    { manager: true },
  );
  const visible = filterWorkQueue(jobs, { kind, state, employeeId, search });
  const open = filterWorkQueue(jobs);
  const active = open.filter((job) => job.state === "active").length;
  const free = open.filter(
    (job) => !job.employeeId && job.assignmentKnown,
  ).length;
  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">ЕДИНАЯ ОЧЕРЕДЬ СКЛАДА</p>
          <h1 className="page-heading">Все задания</h1>
          <p className="page-description">
            Сборка, приёмка и перемещения — вместе с исполнителями и текущим
            состоянием.
          </p>
        </div>
        <Badge tone="success">
          <ClipboardList size={15} /> Обновляется автоматически
        </Badge>
      </div>
      <WorkAutomation />
      <div
        className={styles.summary}
        aria-label="Состояние загруженных текущих заданий"
      >
        <div>
          <strong>{open.length}</strong>
          <span>незавершённых</span>
        </div>
        <div>
          <strong>{active}</strong>
          <span>в работе</span>
        </div>
        <div>
          <strong>{free}</strong>
          <span>без исполнителя</span>
        </div>
      </div>
      {(activeStocktakes.hasNextPage ||
        activeStocktakes.isPending ||
        activeStocktakes.isError) && (
        <p className="muted">
          Счётчики включают только загруженные задания. Инвентаризации:{" "}
          {activeStocktakes.items.length}
          {activeStocktakes.total ? ` из ${activeStocktakes.total}` : ""}.
        </p>
      )}
      <section
        className={`glass-panel ${styles.panel}`}
        aria-label="Очередь заданий"
      >
        <div className={styles.filters}>
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
            <span>Состояние</span>
            <Select
              value={state}
              onChange={(event) => setState(event.target.value as typeof state)}
            >
              <option value="open">Незавершённые</option>
              {(
                ["queued", "active", "paused", "review"] as WorkQueueState[]
              ).map((value) => (
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
            <span>Найти задание</span>
            <div className={styles.search}>
              <Search size={16} aria-hidden="true" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Код, тематика, адрес…"
              />
            </div>
          </label>
        </div>
        <div className={styles.listHeader}>
          <span>Показано: {visible.length}</span>
          <span>Приёмка — отдельное задание на каждую паллету</span>
        </div>
        {workspace.isError && (
          <div className="ops-error" role="alert">
            Не удалось обновить склад. Показаны последние полученные данные.
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void workspace.refetch()}
            >
              Обновить
            </Button>
          </div>
        )}
        {stocktakes.isError && (
          <div className="ops-error" role="alert">
            Инвентаризации временно недоступны. Остальные задания показаны.
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void stocktakes.refetch()}
            >
              Повторить
            </Button>
          </div>
        )}
        {stocktakes.isPending && (
          <p className="muted" role="status">
            Загружаем инвентаризации…
          </p>
        )}
        {visible.length ? (
          <ul className={styles.list}>
            {visible.map((job) => (
              <li key={job.id} className={styles.card}>
                <div className={styles.primary}>
                  <div className={styles.meta}>
                    <span>{job.title}</span>
                    <span>{job.code}</span>
                  </div>
                  <h2>{job.objectLabel}</h2>
                  {job.skuName && job.skuName !== job.objectLabel && (
                    <p className={styles.theme}>{job.skuName}</p>
                  )}
                  <p className={styles.quantity}>{job.quantityLabel}</p>
                  {(job.fromLabel || job.toLabel) && (
                    <p className={styles.route}>
                      {job.fromLabel && <span>Откуда: {job.fromLabel}</span>}
                      {job.toLabel && <span>Куда: {job.toLabel}</span>}
                    </p>
                  )}
                </div>
                <div className={styles.assignment}>
                  <Badge
                    tone={
                      job.state === "active"
                        ? "success"
                        : job.state === "review" || job.state === "paused"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {job.statusLabel}
                  </Badge>
                  {job.autoPurpose && (
                    <Badge tone="neutral">Автоматически</Badge>
                  )}
                  <span className={styles.owner}>
                    {job.employeeName ?? "Без исполнителя"}
                  </span>
                  <Link href={job.href} className={styles.link}>
                    {job.kind === "stocktake"
                      ? "Открыть документ"
                      : "Открыть раздел"}
                    <ArrowRight size={15} aria-hidden="true" />
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="Заданий не найдено"
            description="Измените фильтры или создайте задание в нужном разделе."
          />
        )}
        {!!stocktakes.total && (
          <div className={styles.pagination}>
            <span>
              Инвентаризации: загружено {stocktakes.items.length} из{" "}
              {stocktakes.total}
            </span>
            {stocktakes.hasNextPage && (
              <Button
                variant="secondary"
                disabled={stocktakes.isFetchingNextPage}
                onClick={() => void stocktakes.fetchNextPage()}
              >
                {stocktakes.isFetchingNextPage
                  ? "Загружаем…"
                  : "Показать ещё инвентаризации"}
              </Button>
            )}
          </div>
        )}
      </section>
    </>
  );
}
export function WorkQueuePage() {
  const { user } = useSession();
  if (!user) return <LoadingState />;
  if (user.role === "employee") return <EmployeeWorkspace />;
  return (
    <WorkspaceShell>
      <ManagerWorkQueue />
    </WorkspaceShell>
  );
}
