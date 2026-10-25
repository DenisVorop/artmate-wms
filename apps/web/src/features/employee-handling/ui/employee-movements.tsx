"use client";
import { Button, useEmployeeScanActivity } from "@/shared/ui";
import { selectMovement, workBlock } from "../lib/handling";
import { useHandlingState } from "../lib/use-handling-state";
import { useHandling } from "../model/use-handling";
import { Done, HandlingFrame, PairScan } from "./handling-parts";
import type { EmployeeHandlingProps } from "./employee-putaway";
import styles from "./handling.module.css";
export function EmployeeMovements({
  data,
  onIdle,
  onProblem,
}: EmployeeHandlingProps) {
  const { employeeId, commands, execute } = useHandling();
  const { pending: scanPending } = useEmployeeScanActivity();
  const candidate = selectMovement(data.movements, employeeId);
  const state = useHandlingState(candidate?.id);
  const next = () => {
    if (scanPending > 0 || commands.pending) return;
    commands.clearError();
    state.next();
  };
  const movement =
    candidate?.status === "in_transit"
      ? candidate
      : state.selectedId
        ? data.movements.find((m) => m.id === state.selectedId)
        : candidate;
  const carrying = movement?.status === "in_transit";
  const done = state.done || movement?.status === "completed";
  const pallet = data.pallets.find((p) => p.id === movement?.palletId);
  const address = data.locations.find(
    (l) =>
      l.id === (carrying ? movement.toLocationId : movement?.fromLocationId),
  );
  const destination = data.locations.find(
    (l) => l.id === movement?.toLocationId,
  );
  const block = workBlock(data, employeeId, "movement", movement?.id);
  return (
    <HandlingFrame
      title="Перемещение паллеты"
      code={movement?.code}
      onIdle={onIdle}
      onProblem={onProblem}
      carrying={carrying && !done}
      pending={commands.pending}
    >
      {done ? (
        <Done
          message="Паллета размещена. Перемещение завершено."
          onNext={next}
        />
      ) : !movement ? (
        <>
          <p>
            {state.selectedId
              ? "Выбранное перемещение больше недоступно."
              : "Назначенных перемещений пока нет."}
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
          {block && <p className={styles.notice}>{block}</p>}
          {pallet && address && movement.employeeId === employeeId ? (
            <>
              <p>
                {carrying
                  ? "Доставьте паллету на зарезервированный адрес."
                  : `После забора доставьте паллету на ${destination?.code ?? "назначенный адрес"}.`}
              </p>
              <PairScan
                key={`${employeeId}:${movement.id}:${movement.status}`}
                contextKey={`${movement.id}:${movement.status}`}
                type="pallet"
                id={pallet.id}
                code={pallet.code}
                addressCode={address.code}
                addressId={address.id}
                routeRequest={{ kind: "movement", id: movement.id }}
                data={data}
                phase={carrying ? "place" : "take"}
                pending={commands.pending}
                error={commands.error}
                disabled={!!block}
                onProblem={onProblem}
                onConfirm={(palletCode, locationCode) =>
                  execute(
                    () =>
                      carrying
                        ? commands.placeMovement(movement.id, {
                            requestId: crypto.randomUUID(),
                            palletCode,
                            locationCode,
                          })
                        : commands.takeMovement(movement.id, {
                            requestId: crypto.randomUUID(),
                            palletCode,
                            locationCode,
                          }),
                    () => {
                      state.setSelectedId(movement.id);
                      if (carrying) state.setDone(true);
                    },
                  )
                }
              />
            </>
          ) : (
            <p role="alert">
              Паллета или адрес больше недоступны. Обновите рабочее место.
            </p>
          )}
        </>
      )}
    </HandlingFrame>
  );
}
