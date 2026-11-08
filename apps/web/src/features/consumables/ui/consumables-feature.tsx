"use client";

import { useState, type FormEvent } from "react";
import type {
  ChangeConsumablesDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";
import { useWarehouseCommands } from "@/shared/api/use-warehouse-commands";
import { consumableNames } from "@/shared/lib/consumables";
import { Badge, Button, Input, Select } from "@/shared/ui";
import styles from "./consumables.module.css";

const items = ["individual_box", "transport_carton"] as const;
const number = (value: number) => value.toLocaleString("ru-RU");

export function ConsumablesFeature({ data }: { data: WorkspaceDto }) {
  const commands = useWarehouseCommands();
  const [locationId, setLocationId] = useState("");
  const [item, setItem] =
    useState<ChangeConsumablesDto["item"]>("individual_box");
  const [mode, setMode] = useState<ChangeConsumablesDto["mode"]>("count");
  const [quantity, setQuantity] = useState("");
  const [expected, setExpected] = useState(0);
  const [saved, setSaved] = useState(false);
  const rows = data.warehouse.consumables ?? [];
  const enabled = data.warehouse.consumablesEnabled;
  const addresses = data.locations
    .filter(
      (location) =>
        !location.archived &&
        !location.blocked &&
        ["rack", "floor"].includes(location.kind) &&
        !data.sections.some(
          (section) => section.id === location.sectionId && section.archived,
        ) &&
        !data.pallets.some(
          (pallet) =>
            pallet.status !== "retired" &&
            (pallet.locationId === location.id ||
              pallet.returnLocationId === location.id),
        ) &&
        !data.movements.some(
          (movement) =>
            movement.toLocationId === location.id &&
            ["planned", "in_transit"].includes(movement.status),
        ) &&
        !data.putawayTasks.some(
          (task) =>
            task.toLocationId === location.id &&
            ["claimed", "in_transit"].includes(task.status),
        ),
    )
    .sort((a, b) => a.code.localeCompare(b.code, "ru", { numeric: true }));
  const stock =
    rows.find((row) => row.locationId === locationId && row.item === item)
      ?.quantity ?? 0;
  const reservations = data.tasks
    .filter((task) => task.status !== "completed")
    .flatMap((task) => task.consumableReservations ?? []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (commands.pending) return;
    const pieces = Number(quantity);
    if (
      !locationId ||
      !quantity ||
      !Number.isSafeInteger(pieces) ||
      pieces < 0 ||
      pieces > 1_000_000_000 ||
      (mode === "receive" && pieces === 0)
    )
      return;
    setSaved(false);
    try {
      await commands.changeConsumables(locationId, {
        requestId: crypto.randomUUID(),
        item,
        mode,
        quantity: pieces,
        expectedQuantity: expected,
      });
      setQuantity("");
      setSaved(true);
    } catch {
      // The command hook exposes the server's validation message.
    }
  }

  return (
    <section
      className="ops-profile-block"
      id="consumables"
      aria-labelledby="consumables-title"
    >
      <div className="page-header">
        <div>
          <h2 className="section-title" id="consumables-title">
            Расходники для сборки
          </h2>
          <p className="page-description">
            На один короб раскрасок уходит 20 поштучных коробок и один
            транспортный короб.
          </p>
        </div>
        <Badge tone={enabled ? "success" : "neutral"}>
          {enabled ? "Учёт включён" : "Первичный ввод"}
        </Badge>
      </div>
      <div className="ops-profile-grid">
        {items.map((kind) => {
          const total = rows.reduce(
            (sum, row) => sum + (row.item === kind ? row.quantity : 0),
            0,
          );
          const reserved = reservations.reduce(
            (sum, row) => sum + (row.item === kind ? row.quantity : 0),
            0,
          );
          return (
            <article key={kind} className="glass-panel ops-panel">
              <h3>{consumableNames[kind]}</h3>
              <dl className={styles.totals}>
                <div>
                  <dt>На складе</dt>
                  <dd>{number(total)}</dd>
                </div>
                <div>
                  <dt>В резерве</dt>
                  <dd>{number(reserved)}</dd>
                </div>
                <div>
                  <dt>Свободно</dt>
                  <dd>{number(total - reserved)}</dd>
                </div>
              </dl>
              {rows
                .filter((row) => row.item === kind)
                .map((row) => ({
                  ...row,
                  code:
                    data.locations.find(
                      (location) => location.id === row.locationId,
                    )?.code ?? row.locationId,
                }))
                .sort((a, b) =>
                  a.code.localeCompare(b.code, "ru", { numeric: true }),
                )
                .map((row) => {
                  const held = reservations.reduce(
                    (sum, entry) =>
                      sum +
                      (entry.locationId === row.locationId &&
                      entry.item === kind
                        ? entry.quantity
                        : 0),
                    0,
                  );
                  return (
                    <p key={row.locationId}>
                      <strong>{row.code}</strong> · {number(row.quantity)} шт.
                      {held > 0 && ` · в резерве ${number(held)}`}
                    </p>
                  );
                })}
            </article>
          );
        })}
      </div>
      <form
        className={`glass-panel ops-panel ops-profile-form ${styles.form}`}
        onSubmit={(event) => void save(event)}
      >
        <fieldset disabled={commands.pending} className="ops-profile-grid">
          <label className="field">
            <span>Адрес хранения</span>
            <Select
              value={locationId}
              required
              onChange={(event) => {
                setLocationId(event.target.value);
                setQuantity("");
                setSaved(false);
              }}
            >
              <option value="">Выберите адрес</option>
              {addresses.map((address) => (
                <option key={address.id} value={address.id}>
                  {address.code} · {address.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="field">
            <span>Упаковка</span>
            <Select
              value={item}
              onChange={(event) => {
                setItem(event.target.value as typeof item);
                setQuantity("");
                setSaved(false);
              }}
            >
              {items.map((kind) => (
                <option key={kind} value={kind}>
                  {consumableNames[kind]}
                </option>
              ))}
            </Select>
          </label>
          <label className="field">
            <span>Операция</span>
            <Select
              value={mode}
              onChange={(event) => {
                setMode(event.target.value as typeof mode);
                setQuantity("");
                setSaved(false);
              }}
            >
              <option value="count">Внести фактический остаток</option>
              <option value="receive">Добавить поступление</option>
            </Select>
          </label>
          <label className="field">
            <span>
              {mode === "count" ? "Фактический остаток, шт." : "Поступило, шт."}
            </span>
            <Input
              required
              value={quantity}
              type="number"
              inputMode="numeric"
              min={mode === "count" ? 0 : 1}
              max={1_000_000_000}
              step={1}
              onChange={(event) => {
                if (!quantity) setExpected(stock);
                setQuantity(event.target.value);
                setSaved(false);
              }}
            />
          </label>
        </fieldset>
        {locationId && <p>Сейчас по этому адресу {number(stock)} шт.</p>}
        <Button type="submit" disabled={commands.pending || !locationId}>
          Сохранить
        </Button>
        {saved && <p role="status">Остаток сохранён</p>}
        {!enabled && (
          <div>
            <p className={styles.hint}>
              Внесите остатки обоих видов упаковки, затем включите учёт. WMS
              зарезервирует упаковку и на уже созданные задания.
            </p>
            <Button
              type="button"
              variant="secondary"
              disabled={commands.pending}
              onClick={() => {
                setSaved(false);
                void commands
                  .enableConsumables({ requestId: crypto.randomUUID() })
                  .catch(() => undefined);
              }}
            >
              Включить учёт
            </Button>
          </div>
        )}
        {commands.error && <p role="alert">{commands.error}</p>}
      </form>
    </section>
  );
}
