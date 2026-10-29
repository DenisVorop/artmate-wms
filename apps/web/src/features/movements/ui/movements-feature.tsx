"use client";
import { useSession } from "@/entities/session";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Plus,
  Recycle,
  Route,
} from "lucide-react";
import { useWorkspace } from "@/entities/workspace";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
} from "@/shared/ui";
import {
  movementTitle,
  movementStatuses,
  movementPalletName,
} from "../lib/movement-form";
import { useMovementsState } from "../lib/use-movements-state";
import { useMovements } from "../model/use-movements";
import { MovementCreateForm } from "./movement-create-form";
import { MovementConfirmForm } from "./movement-confirm-form";
import { MovementDetail } from "./movement-detail";
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
  if (isPending) return <LoadingState />;
  if (isError || !data) return <ErrorState onRetry={() => void refetch()} />;
  const active = data.movements.filter((item) =>
    ["planned", "in_transit"].includes(item.status),
  );
  const list = [...data.movements]
    .reverse()
    .filter(
      (item) =>
        ui.filter === "all" ||
        (ui.filter === "active"
          ? ["planned", "in_transit"].includes(item.status)
          : item.status === ui.filter),
    );
  const selected =
    data.movements.find((item) => item.id === ui.selectedId) ?? list[0];
  const emptyPallets = data.pallets.filter(
    (item) =>
      item.status === "stored" &&
      item.quantity === 0 &&
      !data.boxes.some(
        (box) => box.palletId === item.id && box.status === "stored",
      ),
  );
  const retiring = data.pallets.find((item) => item.id === ui.retireId);
  return (
    <div className={styles.feature}>
      <div className="page-header">
        <div>
          <p className="eyebrow">ДВИЖЕНИЕ ПО СКЛАДУ</p>
          <h1 className="page-heading">Перемещения</h1>
          <p className="page-description">
            Забрать, перевезти, подтвердить адрес. Каждый шаг сохраняется.
          </p>
        </div>
        <Button
          onClick={() => {
            commands.clearError();
            ui.setCreating(true);
          }}
        >
          <Plus size={16} />
          Новое перемещение
        </Button>
      </div>
      <div className={styles.summary}>
        {[
          [
            "Ожидают забора",
            data.movements.filter((item) => item.status === "planned").length,
          ],
          [
            "Паллеты в пути",
            data.movements.filter((item) => item.status === "in_transit")
              .length,
          ],
          ["Пустые поддоны на местах", emptyPallets.length],
        ].map(([title, value]) => (
          <div className={`glass-panel ${styles.metric}`} key={title}>
            <span>{title}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      {ui.notice && (
        <div className="ops-success" role="status">
          <CheckCircle2 size={16} />
          {ui.notice}
        </div>
      )}
      <div className="ops-layout">
        <section className="glass-panel ops-panel">
          <h2>
            <Route size={18} />
            Задания на перемещение
          </h2>
          <div className={styles.filter} aria-label="Фильтр перемещений">
            {[
              ["active", "Активные"],
              ["all", "Все"],
              ["completed", "Завершены"],
              ["cancelled", "Отменены"],
            ].map(([value, title]) => (
              <button
                key={value}
                type="button"
                aria-pressed={ui.filter === value}
                onClick={() => {
                  ui.setFilter(value!);
                  ui.setSelectedId(null);
                }}
              >
                {title}
              </button>
            ))}
          </div>
          <div className={styles.list}>
            {list.map((movement) => {
              const pallet = data.pallets.find(
                (item) => item.id === movement.palletId,
              );
              return (
                <button
                  type="button"
                  className="ops-task-card"
                  data-selected={movement.id === selected?.id}
                  key={movement.id}
                  onClick={() => {
                    ui.setSelectedId(movement.id);
                    commands.clearError();
                  }}
                >
                  <div className="ops-card-top">
                    <span className="ops-mono">{movement.code}</span>
                    <Badge
                      tone={
                        movement.status === "completed"
                          ? "success"
                          : movement.status === "in_transit"
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {movementStatuses[movement.status]}
                    </Badge>
                  </div>
                  <div className="ops-card-name">
                    {pallet?.code} · {movementPalletName(data, pallet)}
                  </div>
                  <div className={styles.route}>
                    <code>
                      {
                        data.locations.find(
                          (item) => item.id === movement.fromLocationId,
                        )?.code
                      }
                    </code>
                    <ArrowRight size={15} />
                    <code>
                      {
                        data.locations.find(
                          (item) => item.id === movement.toLocationId,
                        )?.code
                      }
                    </code>
                  </div>
                  <div className="ops-sub">
                    {movementTitle(movement)} ·{" "}
                    {movement.employeeId === null
                      ? "Свободное задание"
                      : (data.employees.find(
                          (item) => item.id === movement.employeeId,
                        )?.name ?? "Исполнитель недоступен")}
                  </div>
                </button>
              );
            })}
          </div>
          {list.length === 0 && (
            <EmptyState
              title="Перемещений пока нет"
              description="Создайте задание для переноса паллеты или спуска готовых коробов."
            />
          )}
          {emptyPallets.length > 0 && (
            <div className={styles.emptyPallets}>
              <h3>
                <Recycle size={17} /> Пустые поддоны
              </h3>
              <p className="ops-description">
                Нулевой остаток не освобождает адрес. Подтвердите физический
                вывоз.
              </p>
              {emptyPallets.map((pallet) => (
                <div className={styles.emptyPallet} key={pallet.id}>
                  <div>
                    <strong>{pallet.code}</strong>
                    <p>
                      {
                        data.locations.find(
                          (item) => item.id === pallet.locationId,
                        )?.code
                      }{" "}
                      · место занято поддоном
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={
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
                    Поддон вывезен <ArrowUpRight size={14} />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
        <aside className="ops-stack">
          {selected ? (
            <MovementDetail
              movement={selected}
              data={data}
              pending={commands.pending}
              error={commands.error}
              onClaim={async () => {
                await commands.claim(selected.id);
                ui.setNotice(
                  "Задание взято. Подтвердите забор паллеты сканами.",
                );
              }}
              onTake={async (values) => {
                await commands.take(selected.id, values);
                ui.setNotice("Забор подтверждён. Паллета в пути.");
              }}
              onPlace={async (values) => {
                await commands.place(selected.id, values);
                ui.setNotice(
                  "Размещение подтверждено. Адреса паллеты и коробов обновлены.",
                );
              }}
              onCancel={async () => {
                await commands.cancel(selected.id);
                ui.setNotice("Перемещение отменено. Целевой адрес освобождён.");
              }}
            />
          ) : (
            <div className={`glass-panel ops-panel ${styles.hint}`}>
              <h3>Два подтверждения</h3>
              <p>
                Сначала скан паллеты и исходного адреса, затем — паллеты и
                целевого адреса. Простое создание задания не меняет фактическое
                размещение.
              </p>
            </div>
          )}
        </aside>
      </div>
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
          ui.setNotice("Задание создано. Целевой адрес зарезервирован.");
        }}
      />
      <Modal
        open={!!retiring}
        onClose={() => ui.setRetireId(null)}
        title="Подтвердить вывоз поддона"
        description="Адрес освободится после подтверждения фактического вывоза."
      >
        {retiring && (
          <div className={styles.retirement}>
            <p>
              У паллеты <strong className={styles.code}>{retiring.code}</strong>{" "}
              нет товара. Убедитесь, что поддон физически вывезен с адреса{" "}
              <strong className={styles.code}>
                {
                  data.locations.find((item) => item.id === retiring.locationId)
                    ?.code
                }
              </strong>
              . Будут сняты адрес хранения и удерживаемое место возврата.
            </p>
            <MovementConfirmForm
              key={retiring.id}
              mode="retire"
              palletCode={retiring.code}
              locationCode={
                data.locations.find((item) => item.id === retiring.locationId)
                  ?.code ?? ""
              }
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
