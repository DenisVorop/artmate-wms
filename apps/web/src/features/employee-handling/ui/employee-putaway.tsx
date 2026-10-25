"use client";
import { useState } from "react";
import { LocationMapButton } from "@/entities/warehouse-map";
import { Button, EmployeeScan, useEmployeeScanActivity } from "@/shared/ui";
import type { WorkspaceDto } from "@/shared/api/generated/model";
import { putawayWork, workBlock } from "../lib/handling";
import { useHandling } from "../model/use-handling";
import { HandlingFrame } from "./handling-parts";
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
  const [placed, setPlaced] = useState(false);
  // The server is the sole source of which box is physically in this employee's hands.
  const work = putawayWork(data, employeeId);
  const carrying = work.kind === "place" ? work.task : undefined;
  const claimed = data.putawayTasks.find(
    (task) => task.employeeId === employeeId && task.status === "claimed",
  );
  const box = data.boxes.find((item) => item.id === carrying?.boxId);
  const sku = data.skus.find((item) => item.id === carrying?.skuId);
  const target = data.locations.find(
    (item) => item.id === carrying?.toLocationId,
  );
  const zone = work.kind === "take" ? work.zone : undefined;
  // A work zone may cover several sources. Never direct the employee to an
  // arbitrary first box or address before they have chosen a box by scanning it.
  const commonSource =
    zone?.locationIds.length === 1
      ? data.locations.find(
          (item) =>
            item.id === zone.locationIds[0] &&
            !item.archived &&
            item.kind === "assembly",
        )
      : undefined;
  const block = workBlock(
    data,
    employeeId,
    "putaway",
    carrying?.id ?? claimed?.id,
  );
  const ready = data.putawayTasks.filter(
    (task) =>
      task.status === "queued" ||
      (task.status === "claimed" && task.employeeId === employeeId),
  ).length;
  return (
    <HandlingFrame
      title="Размещение коробов"
      code={carrying?.code}
      onIdle={onIdle}
      carrying={!!carrying}
      pending={commands.pending}
      onProblem={onProblem}
    >
      {placed && (
        <p className={`${styles.notice} ${styles.success}`} role="status">
          Короб размещён. Можно взять следующий.
        </p>
      )}
      {block && <p className={styles.notice}>{block}</p>}
      {carrying ? (
        box && target ? (
          <>
            <div className={styles.instruction}>
              <span className={styles.eyebrow}>2 из 2 · адрес хранения</span>
              <h2>Поставьте короб</h2>
              <strong className={styles.destinationCode}>{target.code}</strong>
              <p>{target.name}</p>
              <div className={styles.carriedObject}>
                <span>У вас в руках</span>
                <strong>{sku?.name ?? "Тематика недоступна"}</strong>
                <span className={styles.boxNumber}>
                  Короб · {box.code.slice(-12)}
                </span>
                <span className={styles.objectCode}>{box.code}</span>
              </div>
              <p className={styles.scanInstruction}>
                Сканируйте QR этого адреса
              </p>
            </div>
            <LocationMapButton
              data={data}
              locationId={target.id}
              intent="place"
              contextKey={`putaway:${employeeId}:${carrying.id}:place:${target.id}`}
            />
            <EmployeeScan
              key={`${employeeId}:${carrying.id}:place`}
              contextKey={`${carrying.id}:place:${box.code}`}
              label="Сканируйте QR адреса хранения"
              pending={commands.pending}
              error={commands.error}
              disabled={!!block}
              onProblem={onProblem}
              onScan={(locationCode) =>
                execute(
                  () =>
                    commands.placePutawayBox(carrying.id, {
                      requestId: crypto.randomUUID(),
                      employeeId,
                      locationCode,
                    }),
                  () => setPlaced(true),
                )
              }
            />
          </>
        ) : (
          <p role="alert">
            Адрес или данные переносимого короба недоступны. Позовите
            руководителя: повторно сканировать короб не нужно.
          </p>
        )
      ) : zone ? (
        <>
          <div className={styles.instruction}>
            <span className={styles.eyebrow}>
              1 из 2 · общая паллета сборки
            </span>
            <h2>Возьмите любой короб</h2>
            <p>
              С общей паллеты готовых коробов. После скана покажем, куда его
              поставить.
            </p>
            <p className={styles.scanInstruction}>Сканируйте QR короба</p>
          </div>
          {commonSource && (
            <LocationMapButton
              data={data}
              locationId={commonSource.id}
              intent="take"
              contextKey={`putaway-any:${employeeId}:${zone.id}:${commonSource.id}`}
            />
          )}
          {ready === 0 && (
            <p className={styles.secondary}>
              По данным склада готовых коробов для размещения пока нет. Новые
              появятся после сборки.
            </p>
          )}
          <EmployeeScan
            key={`${employeeId}:${zone.id}:take`}
            contextKey={`putaway-any:${employeeId}:${zone.id}`}
            label="Сканируйте QR любого готового короба"
            pending={commands.pending}
            error={commands.error}
            disabled={!!block}
            onProblem={onProblem}
            onScan={(boxCode) =>
              execute(
                () =>
                  commands.takeAnyPutawayBox({
                    requestId: crypto.randomUUID(),
                    employeeId,
                    boxCode,
                  }),
                () => setPlaced(false),
              )
            }
          />
        </>
      ) : (
        <>
          <h2>Сканируйте зону размещения</h2>
          <p>
            Сначала подойдите к общей паллете и отсканируйте QR рабочей зоны.
          </p>
        </>
      )}
      {claimed && !carrying && (
        <Button
          variant="ghost"
          disabled={commands.pending || scanPending > 0 || !!block}
          onClick={() => {
            if (scanPending > 0) return;
            void execute(() =>
              commands.releasePutawayTask(claimed.id, {
                requestId: crypto.randomUUID(),
                employeeId,
              }),
            );
          }}
        >
          Вернуть прежнее назначение в очередь
        </Button>
      )}
    </HandlingFrame>
  );
}
