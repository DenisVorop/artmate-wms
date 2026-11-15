"use client";
import Link from "next/link";
import { ArrowRight, Printer } from "lucide-react";
import type {
  EmployeeDto,
  PutawayTaskDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";
import { Badge, Button } from "@/shared/ui";
import type { PutawayScanValues } from "../lib/putaway-form";
import {
  canReleasePutaway,
  canWorkPutaway,
  putawayClaimBlocked,
  putawayDate,
  putawayStatusLabels,
} from "../lib/putaway-queue";
import { usePutawayOptions } from "../model/use-putaway-options";
import { PutawayScanForm } from "./putaway-scan-form";
import styles from "./putaway.module.css";
export function PutawayDetails({
  task,
  data,
  actor,
  pending,
  error,
  onClaim,
  onScan,
  onRelease,
}: {
  task: PutawayTaskDto;
  data: WorkspaceDto;
  actor: EmployeeDto | undefined;
  pending: boolean;
  error: string | null;
  onClaim: () => Promise<void>;
  onScan: (values: PutawayScanValues) => Promise<boolean>;
  onRelease: () => Promise<void>;
}) {
  const box = data.boxes.find((item) => item.id === task.boxId);
  const sku = data.skus.find((item) => item.id === task.skuId);
  const sourcePallet = data.pallets.find(
    (item) => item.id === task.fromPalletId,
  );
  const source = data.locations.find((item) => item.id === task.fromLocationId);
  const target = data.locations.find((item) => item.id === task.toLocationId);
  const owner = data.employees.find((item) => item.id === task.employeeId);
  const options = usePutawayOptions(task.id, task.status === "queued");
  const suggested = options.data?.locations.find(
    (item) => item.id === options.data?.suggestedLocationId,
  );
  const destination = target ?? suggested;
  const block = putawayClaimBlocked(task, actor, data);
  const workingOwn = canWorkPutaway(task, actor);
  return (
    <section
      className={`glass-panel ${styles.detail}`}
      aria-label={`Размещение ${task.code}`}
    >
      <div className={styles.detailHeader}>
        <div>
          <Badge
            tone={
              task.status === "completed"
                ? "success"
                : task.status === "in_transit"
                  ? "warning"
                  : "neutral"
            }
          >
            {putawayStatusLabels[task.status]}
          </Badge>
          <h2>{sku?.name ?? "Товар недоступен"}</h2>
          <p>
            {task.code}
            {box && (
              <>
                {" "}
                · {box.code} · {box.units.toLocaleString("ru-RU")} шт.
              </>
            )}
            {owner && <> · {owner.name}</>}
          </p>
        </div>
        {box && (
          <Link
            className="button button--ghost button--sm"
            href={`/labels/box/${encodeURIComponent(box.code)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Printer size={15} />
            Этикетка
          </Link>
        )}
      </div>
      <div className={styles.addresses}>
        <div className={styles.address}>
          <span>Откуда</span>
          <strong>{source?.code ?? "Адрес недоступен"}</strong>
          {sourcePallet && <span>{sourcePallet.code}</span>}
        </div>
        <ArrowRight size={20} className={styles.arrow} aria-hidden="true" />
        <div className={styles.address} data-target="true">
          <span>
            {task.status === "queued" ? "Предлагаемый адрес" : "Куда"}
          </span>
          <strong>
            {destination?.code ??
              (task.toLocationId ? "Адрес недоступен" : "—")}
          </strong>
          {destination && <span>{destination.name}</span>}
        </div>
      </div>
      {task.status === "queued" && (
        <div className={styles.body}>
          {options.isPending && (
            <p className={styles.help} role="status">
              Подбираем адрес…
            </p>
          )}
          {options.isError && (
            <div className={styles.readError} role="alert">
              Не удалось подобрать адрес.
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void options.refetch()}
                disabled={options.isFetching || pending}
              >
                Повторить
              </Button>
            </div>
          )}
          {options.data && !suggested && (
            <div className={styles.info}>
              <p>{options.data.reason ?? "Нет подходящего места хранения."}</p>
              <div className={styles.actions}>
                <Link
                  href="/warehouse"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Открыть карту склада
                </Link>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending || options.isFetching}
                  onClick={() => void options.refetch()}
                >
                  Проверить снова
                </Button>
              </div>
            </div>
          )}
          {block ? (
            <p className={styles.help}>
              {block.message}
              {block.href && (
                <>
                  {" "}
                  <Link href={block.href}>{block.linkLabel}</Link>
                </>
              )}
            </p>
          ) : (
            <Button
              className={styles.claim}
              disabled={
                pending || options.isPending || (!!options.data && !suggested)
              }
              onClick={() => void onClaim()}
              aria-busy={pending}
            >
              Взять задание
            </Button>
          )}
        </div>
      )}
      {(task.status === "claimed" || task.status === "in_transit") && (
        <div className={styles.body}>
          {!workingOwn ? (
            <p className={styles.info}>
              {task.employeeId === actor?.id
                ? "Начните смену, чтобы продолжить задание."
                : "Сканы принимает только учётная запись исполнителя."}
            </p>
          ) : (
            <>
              <h3>
                {task.status === "claimed"
                  ? "Заберите короб с накопителя"
                  : "Доставьте короб на хранение"}
              </h3>
              <PutawayScanForm
                key={`${task.id}:${task.status}`}
                phase={task.status === "claimed" ? "take" : "place"}
                pending={pending}
                onScan={onScan}
              />
              {canReleasePutaway(task, actor) && (
                <Button
                  className={styles.claim}
                  variant="ghost"
                  size="sm"
                  onClick={() => void onRelease()}
                  disabled={pending}
                >
                  Вернуть в очередь
                </Button>
              )}
            </>
          )}
        </div>
      )}
      {error && (
        <div className="ops-error" role="alert" style={{ marginTop: 17 }}>
          {error}
        </div>
      )}
      <div className={styles.history}>
        <span>
          Создано: <strong>{putawayDate(task.createdAt)}</strong>
        </span>
        {task.claimedAt && (
          <span>
            Взято: <strong>{putawayDate(task.claimedAt)}</strong>
            {owner ? ` · ${owner.name}` : ""}
          </span>
        )}
        {task.takenAt && (
          <span>
            Короб забран: <strong>{putawayDate(task.takenAt)}</strong>
          </span>
        )}
        {task.completedAt && (
          <span>
            Размещено: <strong>{putawayDate(task.completedAt)}</strong>
          </span>
        )}
        <span>МСК</span>
      </div>
    </section>
  );
}
