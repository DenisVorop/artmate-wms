"use client";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { WorkspaceDto } from "@/shared/api/generated/model";
import { Button, Input, Select } from "@/shared/ui";
import {
  resolveStocktakeScope,
  stocktakeLocations,
  openingStocktakeLocations,
} from "../lib/stocktake-scope";
import {
  stocktakeCreateSchema,
  validateScopeSize,
  type StocktakeCreateValues,
  type StocktakeCreateInput,
} from "../lib/stocktake-form";
import styles from "./stocktakes.module.css";

export function CreateStocktake({
  data,
  pending,
  error,
  onSave,
  onClose,
}: {
  data: WorkspaceDto;
  pending: boolean;
  error: string | null;
  onSave: (ids: string[], mode: "recount" | "opening") => Promise<boolean>;
  onClose: () => void;
}) {
  const id = useId();
  const [snapshot, setSnapshot] = useState(data);
  const [search, setSearch] = useState("");
  const form = useForm<StocktakeCreateInput, unknown, StocktakeCreateValues>({
    resolver: zodResolver(stocktakeCreateSchema),
    defaultValues: {
      mode: "recount",
      scope: "room",
      scopeId: "",
      locationIds: [],
    },
  });
  const values = form.watch();
  const packagingLocations = new Set(
    snapshot.warehouse.consumables?.map((row) => row.locationId),
  );
  const locations = stocktakeLocations(
    values.mode === "opening"
      ? openingStocktakeLocations(snapshot)
      : snapshot.locations,
    packagingLocations,
  );
  const selected = resolveStocktakeScope(
    values.scope,
    values.scopeId,
    values.locationIds,
    locations,
    snapshot.sections,
    snapshot.warehouse.spaces,
  );
  const submit = form.handleSubmit(async (values) => {
    const resolved = resolveStocktakeScope(
      values.scope,
      values.scopeId,
      values.locationIds,
      locations,
      snapshot.sections,
      snapshot.warehouse.spaces,
    );
    const problem = validateScopeSize(resolved.length);
    if (problem) {
      form.setError("root", { message: problem });
      return;
    }
    if (
      await onSave(
        resolved.map((location) => location.id),
        values.mode,
      )
    )
      onClose();
  });
  return (
    <section
      className={`glass-panel ${styles.panel}`}
      aria-label="Новая инвентаризация"
    >
      <div
        className={styles.sectionHeading}
        style={{ padding: 0, marginBottom: 18 }}
      >
        <div>
          <h2>
            {values.mode === "opening"
              ? "Первичная инвентаризация"
              : "Новая инвентаризация"}
          </h2>
          <p>
            {values.mode === "opening"
              ? "Внесите товар, который уже физически есть на складе, но ещё не учтён в WMS. Адреса должны быть пустыми по данным системы. Остатки и QR появятся после утверждения."
              : "Выберите адреса, которые нужно пересчитать. Остатки изменятся только после утверждения результатов."}
          </p>
        </div>
        <Button variant="ghost" size="sm" disabled={pending} onClick={onClose}>
          Закрыть форму
        </Button>
      </div>
      <form className={styles.form} onSubmit={submit}>
        <fieldset className={styles.radioGroup} disabled={pending}>
          <legend>Что сделать</legend>
          {(
            [
              ["recount", "Сверка остатков"],
              ["opening", "Первичный ввод"],
            ] as const
          ).map(([value, label]) => (
            <label className={styles.radio} key={value}>
              <input type="radio" value={value} {...form.register("mode")} />
              {label}
            </label>
          ))}
        </fieldset>
        {values.mode === "opening" && (
          <p className={styles.notice}>
            Уже учтённые, заблокированные и зарезервированные места исключены.
            Для них используйте обычную сверку остатков.
          </p>
        )}
        <fieldset className={styles.radioGroup} disabled={pending}>
          <legend>Область подсчёта</legend>
          {(
            [
              ["room", "Помещение"],
              ["section", "Секция"],
              ["locations", "Адреса"],
            ] as const
          ).map(([value, label]) => (
            <label className={styles.radio} key={value}>
              <input
                type="radio"
                value={value}
                {...form.register("scope")}
                onChange={(event) => {
                  form.register("scope").onChange(event);
                  form.setValue("scopeId", "");
                  form.clearErrors();
                }}
              />
              {label}
            </label>
          ))}
        </fieldset>
        {values.scope === "room" && (
          <label className="field" htmlFor={`${id}-room`}>
            Помещение или коридор
            <Select
              id={`${id}-room`}
              disabled={pending}
              {...form.register("scopeId")}
            >
              <option value="">Выберите область</option>
              {snapshot.warehouse.spaces
                .filter((space) => !space.archived)
                .map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.name}
                    {space.kind === "corridor" ? " · коридор" : ""}
                  </option>
                ))}
            </Select>
            {!snapshot.warehouse.spaces.some((space) => !space.archived) && (
              <small>
                На плане пока нет помещений. Выберите секцию или отдельные
                адреса.
              </small>
            )}
          </label>
        )}
        {values.scope === "section" && (
          <label className="field" htmlFor={`${id}-section`}>
            Секция стеллажа
            <Select
              id={`${id}-section`}
              disabled={pending}
              {...form.register("scopeId")}
            >
              <option value="">Выберите секцию</option>
              {snapshot.sections
                .filter((section) => !section.archived)
                .map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.code} · {section.name}
                  </option>
                ))}
            </Select>
          </label>
        )}
        {form.formState.errors.scopeId && (
          <span role="alert" className={styles.fieldError}>
            {form.formState.errors.scopeId.message}
          </span>
        )}
        {values.scope === "locations" && (
          <>
            <Input
              aria-label="Поиск адресов для инвентаризации"
              placeholder="Найти адрес или название"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className={styles.scopeList}>
              {locations
                .filter((location) =>
                  `${location.code} ${location.name}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((location) => (
                  <label className={styles.scopeItem} key={location.id}>
                    <input
                      type="checkbox"
                      value={location.id}
                      disabled={pending}
                      {...form.register("locationIds")}
                    />
                    <span>
                      {location.code} · {location.name}
                      <br />
                      <small>
                        {location.kind === "rack"
                          ? `Ярус ${location.level}`
                          : "Место на полу"}
                        {location.blocked
                          ? " · заблокировано для размещения"
                          : ""}
                      </small>
                    </span>
                  </label>
                ))}
            </div>
            {form.formState.errors.locationIds && (
              <span role="alert" className={styles.fieldError}>
                {form.formState.errors.locationIds.message}
              </span>
            )}
          </>
        )}
        <div className={styles.scopeSummary}>
          <strong>Адресов в документе: {selected.length} / 200</strong>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              setSnapshot(data);
              form.clearErrors();
            }}
          >
            Обновить список адресов
          </Button>
        </div>
        {!!selected.length && (
          <div className={styles.scopePreview}>
            {selected.map((location) => location.code).join(" · ")}
          </div>
        )}
        <p className={styles.footerNote}>
          Список адресов зафиксирован при открытии формы. Только действующие
          ячейки стеллажей и места на полу; зоны сборки, приёмки и отгрузки не
          входят в подсчёт.
        </p>
        {(form.formState.errors.root?.message || error) && (
          <div className={styles.error} role="alert">
            {form.formState.errors.root?.message || error}
          </div>
        )}
        <div className={styles.inlineActions}>
          <Button type="submit" disabled={pending} aria-busy={pending}>
            Создать документ
          </Button>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Отмена
          </Button>
        </div>
      </form>
    </section>
  );
}
