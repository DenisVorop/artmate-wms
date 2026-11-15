"use client";
import { useEffect, useRef, useState } from "react";
import {
  buildWorkQueue,
  filterWorkQueue,
  workQueueKindLabels,
  useWorkQueueStocktakes,
  type WorkQueueKind,
  assemblyNeedsClearing,
  employeeWorkQueueGroups,
} from "@/entities/work-queue";
import type { WorkspaceDto } from "@/shared/api/generated/model";
import { Button } from "@/shared/ui";
import styles from "./workspace.module.css";

/** Inspection keeps active work mounted. Opening a movement never claims it. */
export function EmployeeJobList({
  data,
  employeeId,
  onResume,
  onOpenMovements,
  canOpenMovements,
  canOpenShipping,
  shippingZoneOpen,
  onOpenShipping,
}: {
  data: WorkspaceDto;
  employeeId: string;
  onResume: () => void;
  onOpenMovements: () => void;
  canOpenMovements: boolean;
  canOpenShipping: boolean;
  shippingZoneOpen: boolean;
  onOpenShipping: (shipmentId: string) => void;
}) {
  const [kind, setKind] = useState<WorkQueueKind | "all">("all");
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus({ preventScroll: true });
  }, []);
  const stocktakes = useWorkQueueStocktakes();
  const jobs = filterWorkQueue(buildWorkQueue(data, stocktakes.items), {
    kind,
  }).filter((job) => !job.employeeId || job.employeeId === employeeId);
  const groups = employeeWorkQueueGroups(jobs, employeeId);
  return (
    <section className={styles.jobList} aria-labelledby="employee-jobs-title">
      <div className={styles.jobHeading}>
        <h1 id="employee-jobs-title" ref={title} tabIndex={-1}>
          Все задания
        </h1>
        <p>Ваша работа и общая очередь склада.</p>
      </div>
      {assemblyNeedsClearing(data.assemblyPressure) && (
        <div className={styles.warning} role="status">
          <strong>Освободите место на сборочной паллете</strong>
          <p>{data.assemblyPressure!.message}</p>
          <p>Сканируйте QR зоны размещения, затем любой готовый короб.</p>
        </div>
      )}
      <label className={styles.jobFilter}>
        Вид работы
        <select
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
        </select>
      </label>
      <p className={styles.queueHint}>
        Для сборки, приёмки, размещения и отбора сканируйте QR рабочей зоны.
      </p>
      {(kind === "all" || kind === "stocktake") && stocktakes.isPending && (
        <p className={styles.queueHint} role="status">
          Загружаем задания инвентаризации…
        </p>
      )}
      {(kind === "all" || kind === "stocktake") && stocktakes.isError && (
        <div className={styles.warning} role="alert">
          <p>Не удалось обновить инвентаризации. Остальные задания показаны.</p>
          <button onClick={() => void stocktakes.refetch()}>Повторить</button>
        </div>
      )}
      {!jobs.length && (
        <p className={styles.queueEmpty}>
          {kind === "all"
            ? "Ваших и доступных заданий пока нет."
            : "Заданий этого вида пока нет. Выберите другой вид работы."}
        </p>
      )}
      {groups.map(
        ({ title, jobs: entries }) =>
          entries.length > 0 && (
            <section key={title} className={styles.jobGroup} aria-label={title}>
              <h3>
                {title} <span>{entries.length}</span>
              </h3>
              <ul>
                {entries.map((job) => (
                  <li key={job.id} className={styles.jobCard}>
                    <div className={styles.jobMeta}>
                      <span>{job.title}</span>
                      <span>
                        {job.employeeId && job.state === "queued"
                          ? "Назначено вам"
                          : job.statusLabel}
                      </span>
                    </div>
                    <h4>{job.skuName ?? job.objectLabel}</h4>
                    {job.skuName && job.objectLabel !== job.skuName && (
                      <p className={styles.jobCode}>{job.objectLabel}</p>
                    )}
                    <p className={styles.jobQuantity}>{job.quantityLabel}</p>
                    {(job.fromLabel || job.toLabel) && (
                      <p className={styles.jobRoute}>
                        {job.fromLabel && <>Откуда: {job.fromLabel}</>}
                        {job.fromLabel && job.toLabel && <br />}
                        {job.toLabel && <>Куда: {job.toLabel}</>}
                      </p>
                    )}
                    <small>{job.code}</small>
                    {job.kind === "shipping" && job.state !== "review" && (
                      <Button
                        variant="secondary"
                        disabled={!canOpenShipping}
                        onClick={() => onOpenShipping(job.referenceId)}
                      >
                        {shippingZoneOpen
                          ? "К отбору"
                          : "Сканировать зону отгрузки"}
                      </Button>
                    )}
                    {job.kind === "movement" &&
                      data.movements.some(
                        (movement) =>
                          movement.id === job.referenceId &&
                          movement.autoPurpose === "accessible_raw" &&
                          ["planned", "in_transit"].includes(movement.status),
                      ) && (
                        <Button
                          variant="secondary"
                          disabled={!canOpenMovements}
                          onClick={onOpenMovements}
                        >
                          Открыть перемещение
                        </Button>
                      )}
                  </li>
                ))}
              </ul>
            </section>
          ),
      )}
      {(kind === "all" || kind === "stocktake") && stocktakes.hasNextPage && (
        <div className={styles.queuePagination}>
          <p>
            Инвентаризации: загружено {stocktakes.items.length} из{" "}
            {stocktakes.total}. Остальные виды показаны полностью.
          </p>
          <div>
            <Button
              variant="secondary"
              disabled={stocktakes.isFetchingNextPage}
              aria-busy={stocktakes.isFetchingNextPage}
              onClick={() => void stocktakes.fetchNextPage()}
            >
              Загрузить ещё инвентаризации
            </Button>
          </div>
        </div>
      )}
      <Button onClick={onResume}>К текущей работе</Button>
    </section>
  );
}
