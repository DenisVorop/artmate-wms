"use client";
import { useSession } from "@/entities/session";
import { Check, Plus, Search, UserRound } from "lucide-react";
import Link from "next/link";
import { useWorkspace } from "@/entities/workspace";
import type { ScanTaskDtoKind, TaskDto } from "@/shared/api/generated/model";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
} from "@/shared/ui";
import { number } from "@/shared/lib/format";
import type { AssemblyValues, AssignmentValues } from "../lib/assembly-form";
import {
  assemblyTaskVisible,
  queueTasks,
  taskStatusLabels,
  taskTab,
  type QueueTab,
} from "../lib/assembly-queue";
import { afterAssemblyCommand } from "../lib/assembly-transition";
import { useAssemblyState } from "../lib/use-assembly-state";
import { useAssembly } from "../model/use-assembly";
import { TaskCreateForm } from "./task-create-form";
import { TaskWorkPanel } from "./task-work-panel";
import styles from "./assembly.module.css";
const tabs: { value: QueueTab; label: string }[] = [
  { value: "free", label: "Свободные" },
  { value: "assigned", label: "Назначены / пауза" },
  { value: "active", label: "В работе" },
  { value: "completed", label: "Завершённые" },
];
export function AssemblyFeature() {
  const { user, isManager } = useSession();
  const actorId = user?.employeeId ?? "";
  const workspace = useWorkspace();
  const commands = useAssembly();
  const ui = useAssemblyState();
  if (workspace.isPending) return <LoadingState />;
  if (!workspace.data)
    return <ErrorState onRetry={() => void workspace.refetch()} />;
  const data = {
    ...workspace.data,
    tasks: workspace.data.tasks.filter(
      (task) => isManager || assemblyTaskVisible(task, actorId),
    ),
  };
  const actor = data.employees.find((employee) => employee.id === actorId);
  const tasks = queueTasks(data, ui.tab, ui.search);
  const selected =
    data.tasks.find((task) => task.id === ui.selectedId) ?? tasks[0];
  const actorTask = data.tasks.find(
    (task) => task.status === "active" && task.employeeId === actor?.id,
  );
  const selectTask = (task: TaskDto) => {
    ui.setTab(taskTab(task));
    ui.setSearch("");
    ui.setSelectedId(task.id);
    commands.clearError();
  };
  const applyTransition = (task: TaskDto, resultTasks: TaskDto[]) => {
    const transition = afterAssemblyCommand(task, resultTasks, actorId);
    ui.setTab(transition.tab);
    ui.setSearch("");
    ui.setSelectedId(transition.selectedId);
    ui.setNotice(transition.notice);
  };
  const create = async (values: AssemblyValues) => {
    if (!isManager) return;
    try {
      const before = new Set(data.tasks.map((task) => task.id));
      const result = await commands.create(values);
      const added =
        result.tasks.find((task) => !before.has(task.id)) ??
        result.tasks
          .filter(
            (task) =>
              task.status === "queued" &&
              task.employeeId === (values.employeeId || null) &&
              task.skuId === values.skuId &&
              task.boxesTarget === values.boxesTarget,
          )
          .sort((a, b) =>
            (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
          )[0];
      ui.setCreating(false);
      if (added) selectTask(added);
      else {
        ui.setTab("free");
        ui.setSearch("");
      }
      ui.setNotice(
        values.employeeId
          ? `Задание ${added?.code ?? ""} создано и назначено сотруднику ${data.employees.find((employee) => employee.id === values.employeeId)?.name ?? ""}. Для начала сборки исполнитель должен быть на смене; назначение можно изменить ниже.`
          : `Задание ${added?.code ?? ""} создано в свободной очереди. Его можно взять на своей смене или назначить исполнителя ниже.`,
      );
    } catch {
      /* Preserve input and show the command error. */
    }
  };
  const claim = async () => {
    if (!selected || !actor || actor.status !== "working") return;
    try {
      const result = await commands.claim(selected.id, actor.id);
      const updated = result.tasks.find((task) => task.id === selected.id);
      if (updated) selectTask(updated);
      ui.setNotice(
        `Задание ${selected.code} взято. Исполнитель: ${actor.name}. Продолжайте сборку по шагам ниже.`,
      );
    } catch {}
  };
  const pause = async () => {
    if (!selected || !actor) return;
    try {
      const result = await commands.pause(selected.id, actor.id);
      const updated = result.tasks.find((task) => task.id === selected.id);
      if (updated) selectTask(updated);
      ui.setNotice(
        `${selected.code} на паузе. Текущий короб и его состав сохранены.`,
      );
    } catch {}
  };
  const scan = async (
    kind: ScanTaskDtoKind,
    value: string,
  ): Promise<boolean> => {
    if (!selected || !actor || actor.status !== "working") return false;
    try {
      const result = await commands.scan(selected.id, actor.id, kind, value);
      if (kind === "barcode") applyTransition(selected, result.tasks);
      else {
        const updated = result.tasks.find((task) => task.id === selected.id);
        ui.setNotice(
          kind === "source"
            ? updated?.boxCodeConfirmed
              ? "Следующий источник подтверждён. Продолжайте сканировать раскраски в текущий короб."
              : "Источник подтверждён. Подготовьте раскраски и проверьте код текущего короба."
            : "Короб подтверждён. Теперь сканируйте каждую раскраску.",
        );
      }
      return true;
    } catch {
      return false;
    }
  };
  const recover = async (value: string) => {
    if (!selected || !actor) return false;
    try {
      const result = await commands.recover(selected.id, actor.id, value);
      applyTransition(selected, result.tasks);
      return true;
    } catch {
      return false;
    }
  };
  const assign = async (values: AssignmentValues) => {
    if (!selected || !isManager) return;
    try {
      const result = await commands.assign(selected.id, values);
      const updated = result.tasks.find((task) => task.id === selected.id);
      if (updated) selectTask(updated);
      ui.setNotice(
        values.employeeId
          ? `Назначение ${selected.code} сохранено. Сборка начнётся, когда исполнитель возьмёт задание на смене.`
          : `${selected.code} возвращено в свободную очередь.`,
      );
      return result;
    } catch {
      return undefined;
    }
  };
  return (
    <div className={styles.feature}>
      <div className="page-header">
        <div>
          <p className="eyebrow">РАБОТА С КОРОБАМИ</p>
          <h1 className="page-heading">Сборка</h1>
          <p className="page-description">
            Каждый короб по сканам — на общую накопительную паллету.
          </p>
        </div>
        {isManager && (
          <Button
            disabled={commands.pending}
            onClick={() => {
              commands.clearError();
              ui.setCreating(true);
            }}
          >
            <Plus size={16} />
            Создать задание
          </Button>
        )}
      </div>
      <div className={styles.metrics}>
        <div className={`glass-panel ${styles.metric}`}>
          <span>В свободной очереди</span>
          <strong>
            {number(
              data.tasks.filter((task) => taskTab(task) === "free").length,
            )}
          </strong>
        </div>
        <div className={`glass-panel ${styles.metric}`}>
          <span>Задания в работе</span>
          <strong>
            {number(
              data.tasks.filter((task) => task.status === "active").length,
            )}
          </strong>
        </div>
        <div className={`glass-panel ${styles.metric}`}>
          <span>Собрано по заданиям, коробов</span>
          <strong>
            {number(
              data.tasks.reduce((sum, task) => sum + task.boxesCompleted, 0),
            )}
          </strong>
        </div>
      </div>
      <section
        className={`glass-panel ${styles.actor}`}
        aria-label="Текущий исполнитель"
      >
        <div className={styles.actorIntro}>
          <strong>
            <UserRound size={16} />
            {actor?.name ?? user?.name ?? "Текущий сотрудник"}
          </strong>
          <p className={styles.help}>
            Операции выполняются от вашей учётной записи.
          </p>
          {actor?.status !== "working" && (
            <p className={styles.help}>
              Для выполнения задания начните свою смену.{" "}
              <Link href="/team">Моя смена →</Link>
            </p>
          )}
        </div>
        {actorTask && selected?.id !== actorTask.id && (
          <Button
            size="sm"
            variant="secondary"
            disabled={commands.pending}
            onClick={() => selectTask(actorTask)}
          >
            К моему заданию
          </Button>
        )}
      </section>
      {ui.notice && (
        <div className={styles.notice} role="status">
          <Check size={17} />
          <span>{ui.notice}</span>
        </div>
      )}
      {workspace.isError && (
        <div className={styles.readError} role="alert">
          <p>
            Не удалось обновить данные. Показана последняя версия; ввод в формах
            сохранён.
          </p>
          <Button
            variant="secondary"
            size="sm"
            disabled={commands.pending}
            onClick={() => void workspace.refetch()}
          >
            Обновить данные
          </Button>
        </div>
      )}
      {selected && taskTab(selected) !== ui.tab && (
        <div className={styles.readError}>
          <p>
            Выбранное задание теперь в разделе «
            {tabs.find((tab) => tab.value === taskTab(selected))?.label}».
            Карточка остаётся открытой для просмотра.
          </p>
          <Button
            size="sm"
            variant="secondary"
            disabled={commands.pending}
            onClick={() => selectTask(selected)}
          >
            Перейти к заданию
          </Button>
        </div>
      )}
      <div className={styles.layout}>
        <section
          className={`glass-panel ${styles.queue}`}
          aria-label="Очередь заданий"
        >
          <div className={styles.queueTools}>
            <div className={styles.tabs} aria-label="Фильтр очереди">
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
                  {
                    data.tasks.filter((task) => taskTab(task) === tab.value)
                      .length
                  }
                </button>
              ))}
            </div>
            <label className={styles.search}>
              <Search size={15} />
              <Input
                placeholder="Код, тематика или сотрудник"
                aria-label="Поиск задания"
                value={ui.search}
                disabled={commands.pending}
                onChange={(event) => ui.setSearch(event.target.value)}
              />
            </label>
          </div>
          <div className={styles.taskList}>
            {tasks.map((task) => (
              <button
                type="button"
                key={task.id}
                className={styles.taskCard}
                aria-pressed={selected?.id === task.id}
                disabled={commands.pending}
                onClick={() => {
                  ui.setSelectedId(task.id);
                  commands.clearError();
                }}
              >
                <span className={styles.cardTop}>
                  <strong>{task.code}</strong>
                  <Badge
                    tone={
                      task.status === "active" || task.status === "completed"
                        ? "success"
                        : task.status === "paused"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {taskStatusLabels[task.status]}
                  </Badge>
                </span>
                <span className={styles.cardName}>
                  {data.skus.find((sku) => sku.id === task.skuId)?.name ??
                    "Тематика недоступна"}
                </span>
                <span className={styles.muted}>
                  {task.boxesCompleted} из {task.boxesTarget} коробов · по{" "}
                  {task.unitsPerBox} шт.
                </span>
                <span className={styles.progress}>
                  <span
                    style={{
                      width: `${task.boxesTarget ? (task.boxesCompleted / task.boxesTarget) * 100 : 0}%`,
                    }}
                  />
                </span>
                <span className={styles.cardBottom}>
                  <span>
                    {data.employees.find(
                      (employee) => employee.id === task.employeeId,
                    )?.name ?? "Без назначения"}
                  </span>
                  {task.scannedUnits > 0 && (
                    <span>
                      {task.scannedUnits}/{task.unitsPerBox} в коробе
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
          {!tasks.length && (
            <EmptyState
              title={
                ui.search
                  ? "Ничего не найдено"
                  : ui.tab === "free"
                    ? "Свободная очередь пуста"
                    : ui.tab === "assigned"
                      ? "Нет назначенных заданий и пауз"
                      : ui.tab === "active"
                        ? "Сейчас никто не собирает"
                        : "Завершённых заданий пока нет"
              }
              description={
                ui.search
                  ? "Попробуйте другой код или название."
                  : ui.tab === "free"
                    ? isManager
                      ? "Создайте задание или снимите назначение с ожидающего задания."
                      : "Новые свободные задания появятся после создания менеджером."
                    : "Выберите другой раздел очереди."
              }
            />
          )}
        </section>
        {selected ? (
          <TaskWorkPanel
            key={selected.id}
            task={selected}
            data={data}
            actor={actor}
            pending={commands.pending}
            error={ui.creating ? null : commands.error}
            onClaim={claim}
            onPause={pause}
            onScan={scan}
            onRecover={recover}
            onAssign={assign}
          />
        ) : (
          <section className={`glass-panel ${styles.work}`}>
            <EmptyState
              title="Рабочее задание"
              description="Выберите карточку для просмотра. Взятие задания и назначение выполняются отдельными действиями."
            />
          </section>
        )}
      </div>
      {isManager && ui.creating && (
        <TaskCreateForm
          data={data}
          pending={commands.pending}
          error={commands.error}
          onClose={() => ui.setCreating(false)}
          onSave={create}
        />
      )}
    </div>
  );
}
