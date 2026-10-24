"use client";
import Link from "next/link";
import { ArrowRight, Check, Printer } from "lucide-react";
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
          <h2>{sku?.name ?? "Тематика недоступна"}</h2>
          <p>
            <span className={styles.code}>
              {task.code} · {box?.code ?? task.boxId}
            </span>
            <br />
            Один короб
            {box ? ` · ${box.units.toLocaleString("ru-RU")} раскрасок` : ""}
            {owner ? ` · ${owner.name}` : ""}
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
          <span>С накопительной паллеты</span>
          <strong>{source?.code ?? task.fromLocationId}</strong>
          <span>{sourcePallet?.code ?? task.fromPalletId}</span>
        </div>
        <ArrowRight size={20} className={styles.arrow} />
        <div className={styles.address} data-target="true">
          <span>
            {task.status === "completed"
              ? "Размещено на хранение"
              : task.toLocationId
                ? "Зарезервированное хранение"
                : "Адрес хранения"}
          </span>
          <strong>
            {target?.code ??
              (task.toLocationId ? "Адрес недоступен" : "После взятия")}
          </strong>
          <span>
            {task.status === "in_transit"
              ? "Короб сейчас у сотрудника"
              : (target?.name ?? "Паллета одной тематики")}
          </span>
        </div>
      </div>
      {task.status === "queued" && (
        <div className={styles.body}>
          <h3>Добровольное размещение</h3>
          <p className={styles.help}>
            Сборка уже закончила этот короб. Возьмите второстепенное задание,
            когда готовы перенести его с общего накопителя на паллету своей
            тематики.
          </p>
          {options.isPending && (
            <p className={styles.info} role="status">
              Подбираем совместимую паллету хранения или свободный адрес…
            </p>
          )}
          {options.isError && (
            <div className={styles.readError} role="alert">
              <p>
                Не удалось обновить варианты хранения. При взятии сервер снова
                проверит свободное место.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void options.refetch()}
                disabled={options.isFetching || pending}
              >
                Повторить подбор
              </Button>
            </div>
          )}
          {suggested && (
            <div className={styles.options}>
              <h3>Рекомендуемый адрес</h3>
              <strong>{suggested.code}</strong>
              <p className={styles.help}>
                {suggested.name} · полезные размеры{" "}
                {suggested.availableWidthMm / 10} ×{" "}
                {suggested.availableDepthMm / 10} см · высота до{" "}
                {suggested.maxHeightMm / 10} см
                {suggested.maxWeightKg === null
                  ? ""
                  : ` · до ${suggested.maxWeightKg} кг`}
              </p>
              <p className={styles.help}>
                Адрес будет выбран и зарезервирован сервером при взятии. Здесь
                хранится одна тематика с совместимым профилем короба.
              </p>
            </div>
          )}
          {options.data && !suggested && (
            <div className={styles.info}>
              <p>
                {options.data.reason ??
                  "Нет подходящего места хранения. Короб остаётся на накопителе; задание не будет взято без адреса."}
              </p>
              <Link href="/warehouse" target="_blank" rel="noopener noreferrer">
                Проверить карту склада ↗
              </Link>
              <div style={{ marginTop: 10 }}>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending || options.isFetching}
                  onClick={() => void options.refetch()}
                >
                  Обновить подбор
                </Button>
              </div>
            </div>
          )}
          {block && (
            <div className={styles.info}>
              <p>{block.message}</p>
              {block.href && (
                <Link
                  href={block.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {block.linkLabel} ↗
                </Link>
              )}
            </div>
          )}
          <Button
            disabled={
              pending ||
              !!block ||
              options.isPending ||
              (!!options.data && !suggested)
            }
            onClick={() => void onClaim()}
            aria-busy={pending}
          >
            Взять размещение
          </Button>
        </div>
      )}
      {(task.status === "claimed" || task.status === "in_transit") && (
        <div className={styles.body}>
          {!workingOwn ? (
            <p className={styles.info}>
              Задание закреплено за сотрудником{" "}
              {owner?.name ?? "недоступным в справочнике"}. Действия доступны
              этому сотруднику в его учётной записи на смене.
            </p>
          ) : (
            <>
              <h3>
                {task.status === "claimed"
                  ? "Заберите короб с накопителя"
                  : "Доставьте короб на хранение"}
              </h3>
              <p className={styles.help}>
                {task.status === "claimed"
                  ? "Найдите короб на общей паллете сборки. Сканируйте его этикетку, затем QR исходного адреса. Только после подтверждения короб окажется у сотрудника."
                  : "Сканируйте ту же этикетку короба, затем QR зарезервированного адреса. Сервер повторно проверит вместимость и поместит короб на паллету его тематики."}
              </p>
              <PutawayScanForm
                key={`${task.id}:${task.status}`}
                phase={task.status === "claimed" ? "take" : "place"}
                pending={pending}
                onScan={onScan}
              />
              {task.status === "claimed" ? (
                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void onRelease()}
                    disabled={pending || !canReleasePutaway(task, actor)}
                  >
                    Вернуть в очередь
                  </Button>
                  <p className={styles.help}>
                    Доступно до забора короба. Резерв адреса освободится, короб
                    останется на накопителе.
                  </p>
                </div>
              ) : (
                <p className={styles.info}>
                  Короб уже у сотрудника. Сначала разместите его: вернуть
                  задание в очередь или завершить смену во время переноса
                  нельзя.
                </p>
              )}
            </>
          )}
        </div>
      )}
      {task.status === "completed" && (
        <div className={styles.notice} style={{ marginTop: 20 }} role="status">
          <Check size={17} />
          <span>
            Размещение завершено. Короб передан на тематическую паллету
            хранения. Адреса и исполнитель ниже — история этой операции.
          </span>
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
        <span>
          Время указано по Москве. Перенос не меняет количество товара на
          балансе.
        </span>
      </div>
    </section>
  );
}
