"use client";
import type { MovementDto } from "@/shared/api/generated/model";
import { workBlock } from "../lib/handling";
import { useHandling } from "../model/use-handling";
import type { EmployeeHandlingProps } from "./employee-putaway";
import { Done, HandlingFrame, PairScan } from "./handling-parts";
import styles from "./handling.module.css";

export function EmployeeMovements({
  data,
  movement,
  locked,
  onIdle,
  onProblem,
}: EmployeeHandlingProps & { movement?: MovementDto }) {
  const { employeeId, commands, execute } = useHandling();
  const carrying = movement?.status === "in_transit";
  const done = movement?.status === "completed";
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
      carrying={carrying}
      backLabel="К заданиям"
      locked={locked || done}
      pending={commands.pending}
    >
      {done ? (
        <Done
          message="Паллета размещена. Перемещение завершено."
          onNext={onIdle}
        />
      ) : !movement ? (
        <p>Выбранное перемещение больше недоступно.</p>
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
          {pallet &&
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
                  execute(() =>
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
                  )
                }
              />
            </>
          ) : (
            <p role="alert">Задание больше недоступно.</p>
          )}
        </>
      )}
    </HandlingFrame>
  );
}
