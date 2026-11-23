"use client";
import { TaskHistory } from "@/entities/task-history";
import { useSession } from "@/entities/session";
import { useLayoutEffect, useRef } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { useWorkspace } from "@/entities/workspace";
import { Button, ErrorState, LoadingState, Modal } from "@/shared/ui";
import { isActiveMovement } from "../lib/movement-list";
import { useMovementsState } from "../lib/use-movements-state";
import { useMovements } from "../model/use-movements";
import { MovementCreateForm } from "./movement-create-form";
import { MovementConfirmForm } from "./movement-confirm-form";
import { MovementDetail } from "./movement-detail";
import { MovementTaskList } from "./movement-task-list";
import styles from "./movements.module.css";

export function MovementsFeature() {
  const { user, isManager } = useSession();
  const { data: snapshot, isPending, isError, refetch } = useWorkspace();
  const data = snapshot
    ? {
        ...snapshot,
        movements: snapshot.movements.filter(
          (movement) =>
            isManager ||
            movement.employeeId === user?.employeeId ||
            (movement.autoPurpose === "accessible_raw" &&
              movement.employeeId === null &&
              movement.status === "planned"),
        ),
      }
    : undefined;
  const commands = useMovements();
  const ui = useMovementsState();
  const heading = useRef<HTMLHeadingElement>(null);
  const previousSelection = useRef(ui.selectedId);
  useLayoutEffect(() => {
    if (previousSelection.current !== ui.selectedId) {
      previousSelection.current = ui.selectedId;
      if (!(document.activeElement instanceof HTMLInputElement))
        heading.current?.focus();
    }
  }, [ui.selectedId]);

  if (isPending) return <LoadingState />;
  if (!data) return <ErrorState onRetry={() => void refetch()} />;
  const active = data.movements.filter(isActiveMovement);
  const selected = data.movements.find((item) => item.id === ui.selectedId);
  const emptyPallets = data.pallets.filter(
    (item) =>
      item.status === "stored" &&
      item.quantity === 0 &&
      !data.boxes.some(
        (box) => box.palletId === item.id && box.status === "stored",
      ),
  );
  const retiring = data.pallets.find((item) => item.id === ui.retireId);
  const selectMovement = (id: string | null) => {
    ui.setSelectedId(id);
    ui.setNotice("");
    commands.clearError();
  };
  const addresses = new Map(data.locations.map((item) => [item.id, item.code]));
  const retireAddress = retiring?.locationId
    ? addresses.get(retiring.locationId)
    : undefined;

  return (
    <div className={styles.feature}>
      <header className={styles.pageHeader}>
        <h1 className="page-heading" ref={heading} tabIndex={-1}>
          Перемещения
        </h1>
        {selected ? (
          <Button
            variant="secondary"
            disabled={commands.pending}
            onClick={() => selectMovement(null)}
          >
            <ArrowLeft size={15} aria-hidden="true" />К списку
          </Button>
        ) : (
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
            Новое перемещение
          </Button>
        )}
      </header>
      {selected && (
        <div>
          <TaskHistory kind="movement" id={selected.id} code={selected.code} />
        </div>
      )}
      {ui.notice && (
        <p className={styles.notice} role="status">
          {ui.notice}
        </p>
      )}
      {isError && (
        <div className={styles.readError} role="alert">
          Не удалось обновить задания.
          <Button
            size="sm"
            variant="ghost"
            disabled={commands.pending}
            onClick={() => void refetch()}
          >
            Повторить
          </Button>
        </div>
      )}
      {selected ? (
        <MovementDetail
          key={selected.id}
          movement={selected}
          data={data}
          pending={commands.pending}
          error={commands.error}
          onClaim={async () => {
            await commands.claim(selected.id);
            ui.setNotice("Задание взято.");
          }}
          onTake={async (values) => {
            await commands.take(selected.id, values);
            ui.setNotice("Паллета в пути.");
          }}
          onPlace={async (values) => {
            await commands.place(selected.id, values);
            ui.setNotice("Паллета размещена.");
          }}
          onCancel={async () => {
            await commands.cancel(selected.id);
            ui.setNotice("Перемещение отменено. Адрес освобождён.");
          }}
        />
      ) : (
        <>
          <MovementTaskList
            data={data}
            addresses={addresses}
            filter={ui.filter}
            search={ui.search}
            onFilter={ui.setFilter}
            onSearch={ui.setSearch}
            onSelect={selectMovement}
          />
          {emptyPallets.length > 0 && (
            <section
              className={styles.emptyPallets}
              aria-labelledby="empty-pallets-title"
            >
              <h2 id="empty-pallets-title">Пустые поддоны</h2>
              <ul>
                {emptyPallets.map((pallet) => (
                  <li className={styles.emptyPallet} key={pallet.id}>
                    <div>
                      <strong>{pallet.code}</strong>
                      <span>
                        {pallet.locationId && addresses.get(pallet.locationId)}
                      </span>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={
                        commands.pending ||
                        active.some((item) => item.palletId === pallet.id) ||
                        data.putawayTasks.some(
                          (task) =>
                            ["claimed", "in_transit"].includes(task.status) &&
                            task.toLocationId === pallet.locationId,
                        )
                      }
                      onClick={() => {
                        commands.clearError();
                        ui.setRetireId(pallet.id);
                      }}
                    >
                      Поддон вывезен
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      <MovementCreateForm
        open={ui.creating}
        data={data}
        pending={commands.pending}
        error={commands.error}
        onClose={() => ui.setCreating(false)}
        onCreate={async (values) => {
          const before = new Set(data.movements.map((item) => item.id));
          const result = await commands.create(values);
          ui.setSelectedId(
            result.movements.find((item) => !before.has(item.id))?.id ?? null,
          );
          ui.setFilter("active");
          ui.setSearch("");
          ui.setNotice("Задание создано. Адрес зарезервирован.");
        }}
      />
      <Modal
        open={!!retiring}
        onClose={() => {
          if (!commands.pending) ui.setRetireId(null);
        }}
        title="Подтвердить вывоз поддона"
      >
        {retiring && (
          <div className={styles.retirement}>
            <p className={styles.hint}>
              Подтверждайте вывоз, когда поддон уже убран с места.
            </p>
            <MovementConfirmForm
              key={retiring.id}
              mode="retire"
              palletCode={retiring.code}
              locationCode={retireAddress ?? ""}
              pending={commands.pending}
              onConfirm={async (values) => {
                await commands.retire(retiring.id, values);
                ui.setRetireId(null);
                ui.setNotice("Вывоз поддона подтверждён. Адрес освобождён.");
              }}
            />
            {commands.error && (
              <div className="ops-error" role="alert">
                {commands.error}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
