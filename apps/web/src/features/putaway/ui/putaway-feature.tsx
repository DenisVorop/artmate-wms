"use client";
import Link from "next/link";
import { ArrowRight, Check, Search, UserRound } from "lucide-react";
import { useWorkspace } from "@/entities/workspace";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Select,
} from "@/shared/ui";
import { number } from "@/shared/lib/format";
import type { PutawayScanValues } from "../lib/putaway-form";
import {
  isActivePutaway,
  putawayQueue,
  putawayStatusLabels,
  type PutawayTab,
} from "../lib/putaway-queue";
import {
  putawayTransition,
  type PutawayAction,
} from "../lib/putaway-transition";
import { usePutawayState } from "../lib/use-putaway-state";
import { usePutaway } from "../model/use-putaway";
import { PutawayDetails } from "./putaway-details";
import styles from "./putaway.module.css";
const tabs: { value: PutawayTab; label: string }[] = [
  { value: "queued", label: "Очередь" },
  { value: "mine", label: "Мои активные" },
  { value: "completed", label: "История" },
];
export function PutawayFeature() {
  const workspace = useWorkspace();
  const commands = usePutaway();
  const ui = usePutawayState();
  if (workspace.isPending) return <LoadingState />;
  if (!workspace.data)
    return <ErrorState onRetry={() => void workspace.refetch()} />;
  const data = workspace.data;
  const actor = data.employees.find((employee) => employee.id === ui.actorId);
  const working = data.employees.filter(
    (employee) => employee.status === "working",
  );
  const tasks = putawayQueue(data, ui.tab, ui.actorId, ui.search);
  const selected =
    data.putawayTasks.find((task) => task.id === ui.selectedId) ?? tasks[0];
  const mine = data.putawayTasks.filter(
    (task) => task.employeeId === ui.actorId && isActivePutaway(task),
  );
  const execute = async (
    action: PutawayAction,
    values?: PutawayScanValues,
  ): Promise<boolean> => {
    if (!selected || !actor || actor.status !== "working" || commands.pending)
      return false;
    try {
      const result =
        action === "claim"
          ? await commands.claim(selected.id, actor.id)
          : action === "release"
            ? await commands.release(selected.id, actor.id)
            : values
              ? action === "take"
                ? await commands.take(selected.id, actor.id, values)
                : await commands.place(selected.id, actor.id, values)
              : undefined;
      const updated = result?.putawayTasks.find(
        (task) => task.id === selected.id,
      );
      if (updated) {
        const transition = putawayTransition(action, updated);
        ui.setTab(transition.tab);
        ui.setSelectedId(transition.selectedId);
        ui.setSearch("");
        ui.setNotice(transition.notice);
      }
      return !!result;
    } catch {
      return false;
    }
  };
  return (
    <div className={styles.feature}>
      <div className="page-header">
        <div>
          <p className="eyebrow">ВТОРОСТЕПЕННЫЕ ЗАДАНИЯ</p>
          <h1 className="page-heading">Размещение коробов</h1>
          <p className="page-description">
            По желанию: с общей паллеты сборки на хранение по тематикам.
          </p>
        </div>
        <Link href="/assembly" className="button button--secondary">
          К сборке
          <ArrowRight size={15} />
        </Link>
      </div>
      <div className={styles.metrics}>
        <div className={`glass-panel ${styles.metric}`}>
          <span>Коробов в очереди</span>
          <strong>
            {number(
              data.putawayTasks.filter((task) => task.status === "queued")
                .length,
            )}
          </strong>
        </div>
        <div className={`glass-panel ${styles.metric}`}>
          <span>Мои активные размещения</span>
          <strong>{number(mine.length)}</strong>
        </div>
        <div className={`glass-panel ${styles.metric}`}>
          <span>В истории размещений</span>
          <strong>
            {number(
              data.putawayTasks.filter((task) => task.status === "completed")
                .length,
            )}
          </strong>
        </div>
      </div>
      <section
        className={`glass-panel ${styles.actor}`}
        aria-label="Выбор исполнителя"
      >
        <div className={styles.actorIntro}>
          <strong>
            <UserRound size={16} />
            Работаем как
          </strong>
          <p className={styles.help}>
            Локальный деморежим: выбор сотрудника на смене для добровольного
            размещения. Основную сборку при необходимости сначала поставьте на
            паузу.
          </p>
          {!working.length && (
            <p className={styles.help}>
              Нет сотрудников на смене.{" "}
              <Link href="/team" target="_blank" rel="noopener noreferrer">
                Открыть команду и смены ↗
              </Link>
            </p>
          )}
        </div>
        <label className={`field ${styles.actorControl}`}>
          Сотрудник на смене
          <Select
            value={ui.actorId}
            aria-label="Работаем как"
            disabled={commands.pending}
            onChange={(event) => {
              ui.setActorId(event.target.value);
              commands.clearError();
            }}
          >
            <option value="">Выберите сотрудника</option>
            {actor && actor.status !== "working" && (
              <option value={actor.id} disabled>
                {actor.name} · вне смены
              </option>
            )}
            {working.map((employee) => (
              <option value={employee.id} key={employee.id}>
                {employee.name}
              </option>
            ))}
          </Select>
        </label>
        {mine[0] && selected?.id !== mine[0].id && (
          <Button
            size="sm"
            variant="secondary"
            disabled={commands.pending}
            onClick={() => {
              ui.setTab("mine");
              ui.setSearch("");
              ui.setSelectedId(mine[0].id);
              commands.clearError();
            }}
          >
            К моему коробу
          </Button>
        )}
      </section>
      {ui.notice && (
        <div className={styles.notice} role="status">
          <Check size={17} />
          <span>{ui.notice}</span>
          {ui.tab === "completed" && (
            <Button
              size="sm"
              variant="secondary"
              disabled={commands.pending}
              onClick={() => {
                ui.setTab("queued");
                ui.setSearch("");
                ui.setSelectedId(null);
                commands.clearError();
              }}
            >
              Вернуться к очереди
            </Button>
          )}
        </div>
      )}
      {workspace.isError && (
        <div className={styles.readError} role="alert">
          <p>
            Не удалось обновить данные. Показана последняя версия; введённые
            коды сохранены.
          </p>
          <Button
            size="sm"
            variant="secondary"
            disabled={commands.pending}
            onClick={() => void workspace.refetch()}
          >
            Обновить данные
          </Button>
        </div>
      )}
      <div className={styles.layout}>
        <section
          className={`glass-panel ${styles.queue}`}
          aria-label="Очередь размещений"
        >
          <div className={styles.queueTools}>
            <div className={styles.tabs} aria-label="Показать размещения">
              {tabs.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  aria-pressed={ui.tab === tab.value}
                  disabled={commands.pending}
                  onClick={() => {
                    ui.setTab(tab.value);
                    ui.setSelectedId(null);
                    commands.clearError();
                  }}
                >
                  {tab.label} ·{" "}
                  {putawayQueue(data, tab.value, ui.actorId).length}
                </button>
              ))}
            </div>
            <label className={styles.search}>
              <Search size={15} />
              <Input
                aria-label="Поиск размещения"
                placeholder="Короб, задание или тематика"
                value={ui.search}
                disabled={commands.pending}
                onChange={(event) => ui.setSearch(event.target.value)}
              />
            </label>
          </div>
          <div className={styles.taskList}>
            {tasks.map((task) => {
              const box = data.boxes.find((item) => item.id === task.boxId);
              const source = data.locations.find(
                (item) => item.id === task.fromLocationId,
              );
              const pallet = data.pallets.find(
                (item) => item.id === task.fromPalletId,
              );
              return (
                <button
                  type="button"
                  className={styles.card}
                  key={task.id}
                  aria-pressed={selected?.id === task.id}
                  disabled={commands.pending}
                  onClick={() => {
                    ui.setSelectedId(task.id);
                    commands.clearError();
                  }}
                >
                  <span className={styles.cardTop}>
                    <strong>{box?.code ?? task.code}</strong>
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
                  </span>
                  <span className={styles.cardName}>
                    {data.skus.find((item) => item.id === task.skuId)?.name ??
                      "Тематика недоступна"}
                  </span>
                  <span className={styles.help}>
                    {pallet?.code ?? "Исходная паллета"} ·{" "}
                    {source?.code ?? "Адрес недоступен"}
                  </span>
                  <span className={styles.cardBottom}>
                    <span>{task.code}</span>
                    <span>1 короб{box ? ` · ${box.units} шт.` : ""}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {!tasks.length && (
            <EmptyState
              title={
                ui.search
                  ? "Ничего не найдено"
                  : ui.tab === "queued"
                    ? "Очередь пока пуста"
                    : ui.tab === "mine"
                      ? "Нет активного размещения"
                      : "История пока пуста"
              }
              description={
                ui.search
                  ? "Попробуйте другой код или тематику."
                  : ui.tab === "queued"
                    ? "После закрытия короба на сборке здесь автоматически появится добровольное задание на его размещение."
                    : ui.tab === "mine"
                      ? actor
                        ? "Выберите короб в очереди и возьмите его по желанию."
                        : "Выберите сотрудника на смене, чтобы увидеть его активное размещение."
                      : "Здесь сохранятся подтверждённые доставки коробов на хранение."
              }
            />
          )}
        </section>
        {selected ? (
          <PutawayDetails
            key={selected.id}
            task={selected}
            data={data}
            actor={actor}
            pending={commands.pending}
            error={commands.error}
            onClaim={async () => {
              await execute("claim");
            }}
            onScan={(values) =>
              execute(selected.status === "claimed" ? "take" : "place", values)
            }
            onRelease={async () => {
              await execute("release");
            }}
          />
        ) : (
          <section className={`glass-panel ${styles.detail}`}>
            <EmptyState
              title="Один короб — одно размещение"
              description="Выберите задание. Сначала подтвердите забор с накопителя, затем доставку на зарезервированное хранение."
            />
          </section>
        )}
      </div>
    </div>
  );
}
