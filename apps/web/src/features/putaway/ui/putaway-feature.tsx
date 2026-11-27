"use client";
import { TaskHistory } from "@/entities/task-history";
import { useSession } from "@/entities/session";
import { useLayoutEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import { useWorkspace } from "@/entities/workspace";
import { Button, ErrorState, LoadingState } from "@/shared/ui";
import type { PutawayScanValues } from "../lib/putaway-form";
import {
  matchesPutawayFilter,
  putawayTaskVisible,
  putawayQueue,
} from "../lib/putaway-queue";
import {
  putawayTransition,
  type PutawayAction,
} from "../lib/putaway-transition";
import { usePutawayState } from "../lib/use-putaway-state";
import { usePutaway } from "../model/use-putaway";
import { PutawayDetails } from "./putaway-details";
import { PutawayTaskList } from "./putaway-task-list";
import styles from "./putaway.module.css";
import { CreateBoxTransfers } from "./create-box-transfers";
export function PutawayFeature() {
  const { user, isManager } = useSession();
  const actorId = user?.employeeId ?? "";
  const workspace = useWorkspace();
  const commands = usePutaway();
  const ui = usePutawayState();
  const heading = useRef<HTMLHeadingElement>(null);
  const previousSelection = useRef(ui.selectedId);
  useLayoutEffect(() => {
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
    putawayTasks: workspace.data.putawayTasks.filter(
      (task) => isManager || putawayTaskVisible(task, actorId),
    ),
  };
  const actor = data.employees.find((employee) => employee.id === actorId);
  const tasks = putawayQueue(data, ui.filter, actorId, ui.search);
  const selected = data.putawayTasks.find((task) => task.id === ui.selectedId);

  const selectTask = (id: string | null) => {
    ui.setSelectedId(id);
    ui.setNotice("");
    commands.clearError();
  };
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
        if (
          ui.filter !== "open" &&
          !matchesPutawayFilter(updated, ui.filter, actorId)
        ) {
          ui.setFilter(transition.tab);
        }
        ui.setSelectedId(transition.selectedId);
        ui.setNotice(transition.notice);
      }
      return !!result;
    } catch {
      return false;
    }
  };
  return (
    <div className={styles.feature}>
      <header className={styles.pageHeader}>
        <h1 className="page-heading" ref={heading} tabIndex={-1}>
          Размещение коробов
        </h1>
        {selected && (
          <Button
            variant="secondary"
            disabled={commands.pending}
            onClick={() => selectTask(null)}
          >
            <ArrowLeft size={15} aria-hidden="true" />К списку
          </Button>
        )}
      </header>
      {isManager && !selected && <CreateBoxTransfers data={data} />}
      {selected && (
        <div>
          <TaskHistory kind="putaway" id={selected.id} code={selected.code} />
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
            size="sm"
            variant="ghost"
            disabled={commands.pending}
            onClick={() => void workspace.refetch()}
          >
            Повторить
          </Button>
        </div>
      )}
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
        <PutawayTaskList
          data={data}
          tasks={tasks}
          filter={ui.filter}
          search={ui.search}
          showMine={!!actor}
          onFilter={ui.setFilter}
          onSearch={ui.setSearch}
          onSelect={selectTask}
        />
      )}
    </div>
  );
}
