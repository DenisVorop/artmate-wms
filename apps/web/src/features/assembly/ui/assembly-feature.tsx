"use client";
import { TaskHistory } from "@/entities/task-history";
import { useSession } from "@/entities/session";
import { useEffect, useRef } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { useWorkspace } from "@/entities/workspace";
import type { ScanTaskDtoKind, TaskDto } from "@/shared/api/generated/model";
import { Button, ErrorState, LoadingState } from "@/shared/ui";
import type { AssemblyValues, AssignmentValues } from "../lib/assembly-form";
import { assemblyTaskVisible, queueTasks } from "../lib/assembly-queue";
import { afterAssemblyCommand } from "../lib/assembly-transition";
import { useAssemblyState } from "../lib/use-assembly-state";
import { useAssembly } from "../model/use-assembly";
import { AssemblyTaskList } from "./assembly-task-list";
import { TaskCreateForm } from "./task-create-form";
import { TaskWorkPanel } from "./task-work-panel";
import styles from "./assembly.module.css";
export function AssemblyFeature() {
  const { user, isManager } = useSession();
  const actorId = user?.employeeId ?? "";
  const workspace = useWorkspace();
  const commands = useAssembly();
  const ui = useAssemblyState();
  const heading = useRef<HTMLHeadingElement>(null);
  const previousSelection = useRef(ui.selectedId);
  useEffect(() => {
    if (previousSelection.current !== ui.selectedId) {
      previousSelection.current = ui.selectedId;
      heading.current?.focus();
    }
  }, [ui.selectedId]);
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
  const tasks = queueTasks(data, ui.filter, ui.search);
  const selected = data.tasks.find((task) => task.id === ui.selectedId);
  const selectTask = (id: string | null) => {
    ui.setSelectedId(id);
    ui.setNotice("");
    commands.clearError();
  };
  const applyTransition = (task: TaskDto, resultTasks: TaskDto[]) => {
    const transition = afterAssemblyCommand(task, resultTasks, actorId);
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
              task.boxesTarget === 1,
          )
          .sort((a, b) =>
            (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
          )[0];
      ui.setCreating(false);
      selectTask(added?.id ?? null);
      ui.setFilter("open");
      ui.setSearch("");
      ui.setNotice(
        values.boxesTarget > 1
          ? `Создано заданий: ${values.boxesTarget}. По одному коробу в каждом.`
          : "Задание создано.",
      );
    } catch {
      /* Preserve input and show the command error. */
    }
  };
  const claim = async () => {
    if (!selected || !actor || actor.status !== "working") return;
    try {
      await commands.claim(selected.id, actor.id);
      ui.setNotice("Задание взято.");
    } catch {}
  };
  const pause = async () => {
    if (!selected || !actor) return;
    try {
      await commands.pause(selected.id, actor.id);
      ui.setNotice("Задание на паузе. Состав короба сохранён.");
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
      else
        ui.setNotice(
          kind === "source" ? "Паллета подтверждена." : "Короб подтверждён.",
        );
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
      ui.setNotice(
        values.employeeId
          ? "Исполнитель назначен."
          : "Задание возвращено в свободную очередь.",
      );
      return result;
    } catch {
      return undefined;
    }
  };
  return (
    <div className={styles.feature}>
      <header className={styles.pageHeader}>
        <h1 className="page-heading" ref={heading} tabIndex={-1}>
          Сборка
        </h1>
        {selected ? (
          <Button
            variant="secondary"
            disabled={commands.pending}
            onClick={() => selectTask(null)}
          >
            <ArrowLeft size={15} aria-hidden="true" />К списку
          </Button>
        ) : (
          isManager && (
            <Button
              disabled={commands.pending}
              aria-haspopup="dialog"
              onClick={() => {
                commands.clearError();
                ui.setNotice("");
                ui.setCreating(true);
              }}
            >
              <Plus size={15} aria-hidden="true" />
              Создать задание
            </Button>
          )
        )}
      </header>
      {selected && (
        <div>
          <TaskHistory kind="assembly" id={selected.id} code={selected.code} />
        </div>
      )}
      {ui.notice && (
        <p className={styles.notice} role="status">
          {ui.notice}
        </p>
      )}
      {workspace.isError && (
        <div className={styles.readError} role="alert">
          Не удалось обновить задания.
          <Button
            variant="ghost"
            size="sm"
            disabled={commands.pending}
            onClick={() => void workspace.refetch()}
          >
            Повторить
          </Button>
        </div>
      )}
      {selected ? (
        <TaskWorkPanel
          key={selected.id}
          task={selected}
          data={data}
          actor={actor}
          pending={commands.pending}
          error={commands.error}
          onClaim={claim}
          onPause={pause}
          onScan={scan}
          onRecover={recover}
          onAssign={assign}
        />
      ) : (
        <AssemblyTaskList
          data={data}
          tasks={tasks}
          filter={ui.filter}
          search={ui.search}
          showLabels={isManager}
          onFilter={ui.setFilter}
          onSearch={ui.setSearch}
          onSelect={selectTask}
        />
      )}
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
