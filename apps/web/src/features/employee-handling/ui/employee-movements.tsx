"use client";
import { Button, useEmployeeScanActivity } from "@/shared/ui";
import { LocationMapButton } from "@/entities/warehouse-map";
import { selectMovement, workBlock, movementClaimBlock } from "../lib/handling";
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
    candidate?.employeeId === employeeId &&
    ["planned", "in_transit"].includes(candidate.status)
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
  const automatic = movement?.autoPurpose === "accessible_raw";
  const free =
    automatic && movement.status === "planned" && movement.employeeId === null;
  const claimBlock = movement
    ? movementClaimBlock(data, employeeId, movement.id)
    : null;
  const theme =
    data.skus.find((sku) => sku.id === pallet?.skuId)?.name ?? "Сырьё";
  const source = data.locations.find(
    (place) => place.id === movement?.fromLocationId,
  );
  const addressText = (place: typeof source) =>
    place
      ? `${place.code}${place.kind === "rack" ? ` · ярус ${place.level}` : ""}`
      : "Адрес недоступен";
  return (
    <HandlingFrame
      title={automatic ? "Спустить сырьё ниже" : "Перемещение паллеты"}
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
              : "Доступных перемещений пока нет."}
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
          {automatic && (
            <div className={styles.objectIdentity}>
              <strong>{theme}</strong>
              <p>
                {addressText(source)} → {addressText(destination)}
              </p>
            </div>
          )}
          {block && <p className={styles.notice}>{block}</p>}
          {free ? (
            <>
              <p>Спустите паллету на доступный ярус для сборки.</p>
              <LocationMapButton
                data={data}
                locationId={source?.id}
                routeRequest={{ kind: "movement", id: movement.id }}
                intent="take"
                contextKey={`${movement.id}:claim`}
              />
              {claimBlock && !block && (
                <p className={styles.notice}>{claimBlock}</p>
              )}
              <Button
                disabled={commands.pending || scanPending > 0 || !!claimBlock}
                onClick={() =>
                  void execute(
                    () =>
                      commands.claimMovement(movement.id, {
                        requestId: crypto.randomUUID(),
                        employeeId,
                      }),
                    () => state.setSelectedId(movement.id),
                  )
                }
              >
                Взять задание
              </Button>
              {commands.error && (
                <p className={styles.error} role="alert">
                  {commands.error}
                </p>
              )}
            </>
          ) : pallet &&
            address &&
            movement.employeeId === employeeId &&
            ["planned", "in_transit"].includes(movement.status) ? (
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
            <>
              <p role="alert">Задание уже взято или больше недоступно.</p>
              <Button
                disabled={commands.pending || scanPending > 0}
                onClick={next}
              >
                Проверить задания
              </Button>
            </>
          )}
        </>
      )}
    </HandlingFrame>
  );
}
