"use client";
import { Button, useEmployeeScanActivity } from "@/shared/ui";
import type { WorkspaceDto } from "@/shared/api/generated/model";
import { selectPutaway, workBlock } from "../lib/handling";
import { useHandlingState } from "../lib/use-handling-state";
import { useHandling } from "../model/use-handling";
import { useHandlingOptions } from "../model/use-handling-options";
import { Done, HandlingFrame, PairScan } from "./handling-parts";
import styles from "./handling.module.css";
export type EmployeeHandlingProps = {
  data: WorkspaceDto;
  onIdle: () => void;
  onProblem?: (message: string) => void;
};
export function EmployeePutaway({
  data,
  onIdle,
  onProblem,
}: EmployeeHandlingProps) {
  const { employeeId, commands, execute } = useHandling();
  const { pending: scanPending } = useEmployeeScanActivity();
  const candidate = selectPutaway(data.putawayTasks, employeeId);
  const state = useHandlingState(candidate?.id);
  const next = () => {
    if (scanPending > 0 || commands.pending) return;
    commands.clearError();
    state.next();
  };
  const task =
    candidate?.status === "in_transit"
      ? candidate
      : state.selectedId
        ? data.putawayTasks.find((t) => t.id === state.selectedId)
        : candidate;
  const options = useHandlingOptions(
    "putaway",
    task?.id ?? "",
    "",
    task?.status === "queued" && !state.done,
  );
  const box = data.boxes.find((b) => b.id === task?.boxId);
  const sku = data.skus.find((s) => s.id === task?.skuId);
  const block = workBlock(data, employeeId, "putaway", task?.id);
  const carrying = task?.status === "in_transit";
  const target = data.locations.find(
    (l) => l.id === (carrying ? task.toLocationId : task?.fromLocationId),
  );
  const suggested = options.data?.locations.find(
    (l) => l.id === options.data.suggestedLocationId,
  );
  const done = state.done || task?.status === "completed";
  return (
    <HandlingFrame
      title="Размещение короба"
      code={task?.code}
      onIdle={onIdle}
      carrying={carrying && !done}
      pending={commands.pending}
      onProblem={onProblem}
    >
      {done ? (
        <Done message="Короб размещён на хранение." onNext={next} />
      ) : !task ? (
        <>
          <p>
            {state.selectedId
              ? "Выбранное размещение больше недоступно."
              : "Свободных размещений пока нет."}
          </p>
          {state.selectedId && (
            <Button
              disabled={commands.pending || scanPending > 0}
              onClick={next}
            >
              Обновить выбор задания
            </Button>
          )}
        </>
      ) : (
        <>
          <h2>{sku?.name ?? "Тематика недоступна"}</h2>
          <p>
            {box?.code ?? "Короб недоступен"} · {box?.units ?? "—"} раскрасок
          </p>
          {block && <p className={styles.notice}>{block}</p>}
          {task.status === "queued" ? (
            <>
              <p>Перенесите короб с общей паллеты на хранение.</p>
              {options.isPending ? (
                <p role="status">Подбираем адрес хранения…</p>
              ) : options.isError ? (
                <>
                  <p role="alert">Не удалось подобрать адрес.</p>
                  <Button
                    variant="secondary"
                    onClick={() => void options.refetch()}
                  >
                    Повторить подбор
                  </Button>
                </>
              ) : suggested ? (
                <div className={styles.address}>
                  <span>Рекомендуемый адрес</span>
                  <strong className={styles.code}>{suggested.code}</strong>
                </div>
              ) : (
                <p className={styles.notice}>
                  {options.data?.reason ?? "Нет подходящего адреса хранения."}
                </p>
              )}
              <Button
                disabled={
                  commands.pending ||
                  !!block ||
                  !suggested ||
                  options.isPending ||
                  options.isError
                }
                aria-busy={commands.pending}
                onClick={() =>
                  void execute(
                    () =>
                      commands.claimPutawayTask(task.id, {
                        requestId: crypto.randomUUID(),
                        employeeId,
                      }),
                    () => state.setSelectedId(task.id),
                  )
                }
              >
                Взять размещение
              </Button>
              {commands.error && (
                <p role="alert" className={styles.error}>
                  {commands.error}
                </p>
              )}
            </>
          ) : box && target && task.employeeId === employeeId ? (
            <>
              <PairScan
                key={`${employeeId}:${task.id}:${task.status}`}
                contextKey={`${task.id}:${task.status}`}
                type="box"
                id={box.code}
                code={box.code}
                addressCode={target.code}
                phase={carrying ? "place" : "take"}
                pending={commands.pending}
                error={commands.error}
                disabled={!!block}
                onConfirm={(boxCode, locationCode) =>
                  execute(
                    () =>
                      carrying
                        ? commands.placePutawayTask(task.id, {
                            requestId: crypto.randomUUID(),
                            employeeId,
                            boxCode,
                            locationCode,
                          })
                        : commands.takePutawayTask(task.id, {
                            requestId: crypto.randomUUID(),
                            employeeId,
                            boxCode,
                            locationCode,
                          }),
                    () => {
                      state.setSelectedId(task.id);
                      if (carrying) state.setDone(true);
                    },
                  )
                }
              />
              {!carrying && (
                <Button
                  variant="ghost"
                  disabled={commands.pending || scanPending > 0 || !!block}
                  onClick={() =>
                    scanPending === 0 &&
                    void execute(
                      () =>
                        commands.releasePutawayTask(task.id, {
                          requestId: crypto.randomUUID(),
                          employeeId,
                        }),
                      next,
                    )
                  }
                >
                  Вернуть в очередь
                </Button>
              )}
            </>
          ) : (
            <>
              <p role="alert">
                Данные короба, назначения или адреса изменились.
              </p>
              <Button
                variant="secondary"
                disabled={commands.pending || scanPending > 0}
                onClick={next}
              >
                Обновить выбор задания
              </Button>
            </>
          )}
        </>
      )}
    </HandlingFrame>
  );
}
