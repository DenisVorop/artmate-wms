"use client";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type {
  MarketplaceOverviewDto,
  SetMarketplaceResolutionDto,
} from "@/entities/assembly-plan";
import { Button } from "@/shared/ui";
import {
  resolutionSchema,
  resolutionCommand,
  resolutionLabels,
  type ResolutionValues,
} from "../lib/resolution-form";
import { dispatchLabel } from "../lib/planning-view";
import styles from "./assembly-planning.module.css";
const providerName = (value: string) =>
  value === "wildberries" ? "WB" : "Ozon";
export function PlanningResolutions({
  data,
  pending,
  onSave,
}: {
  data: MarketplaceOverviewDto;
  pending: boolean;
  onSave: (
    values: Omit<SetMarketplaceResolutionDto, "requestId">,
  ) => Promise<boolean>;
}) {
  const id = useId();
  const [notice, setNotice] = useState("");
  const form = useForm<ResolutionValues>({
    resolver: zodResolver(resolutionSchema),
    defaultValues: {
      kind: "exclude_supply",
      provider: "wildberries",
      externalId: "",
      supplyId: "",
      donorProvider: "ozon",
      note: "",
    },
  });
  const kind = form.watch("kind"),
    provider = form.watch("provider");
  const products = data.products.filter(
    (p) => p.provider === provider && p.skuId,
  );
  const supplies = data.supplies.filter((s) => s.provider === provider);
  const enabled = data.resolutions.filter((r) => r.enabled);
  return (
    <details className={`glass-panel ${styles.settings}`}>
      <summary className={styles.settingsSummary}>
        Уточнения плана{" "}
        <span className={styles.settingsAction}>
          {enabled.filter((r) => r.active).length
            ? `Действует: ${enabled.filter((r) => r.active).length}`
            : "Поставки, остатки и новинки"}
        </span>
      </summary>
      <p className={styles.help}>
        Укажите подтверждённые факты, которых пока нет в данных площадки. Они
        меняют только план. Складские остатки и историю поставок это не
        переписывает.
      </p>
      {enabled.map((r) => (
        <div className={styles.resolution} key={r.id}>
          <div>
            <strong>
              {resolutionLabels[r.kind]} · {providerName(r.provider)}
            </strong>
            <p>
              {r.externalId
                ? (data.products.find(
                    (p) =>
                      p.provider === r.provider &&
                      p.externalId === r.externalId,
                  )?.name ?? "Товар")
                : (data.supplies
                    .find(
                      (s) => s.provider === r.provider && s.id === r.supplyId,
                    )
                    ?.items.map((i) => i.name)
                    .join(", ") ?? "Поставка")}
            </p>
            <p className={styles.help}>
              {r.note}
              {!r.active && " · Не применяется"}
              {r.expiresAt &&
                ` · Подтверждение до ${dispatchLabel(r.expiresAt.slice(0, 10))}`}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() =>
              void (async () => {
                if (
                  await onSave({
                    kind: r.kind,
                    provider: r.provider,
                    enabled: false,
                    note: "Руководитель отменил уточнение плана",
                    ...(r.externalId ? { externalId: r.externalId } : {}),
                    ...(r.supplyId ? { supplyId: r.supplyId } : {}),
                    ...(r.donorProvider
                      ? { donorProvider: r.donorProvider }
                      : {}),
                  })
                )
                  setNotice("Уточнение отменено.");
              })()
            }
          >
            Отменить
          </Button>
        </div>
      ))}
      <form
        noValidate
        onSubmit={form.handleSubmit(async (values) => {
          setNotice("");
          if (!pending && (await onSave(resolutionCommand(values)))) {
            form.reset({ ...values, note: "" });
            setNotice("Уточнение сохранено. План обновляется автоматически.");
          }
        })}
      >
        <div className={styles.fields}>
          <label className="field" htmlFor={`${id}-kind`}>
            Что уточнить
            <select
              className="input"
              aria-label="Что уточнить"
              id={`${id}-kind`}
              {...form.register("kind")}
              disabled={pending}
            >
              {Object.entries(resolutionLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field" htmlFor={`${id}-provider`}>
            Площадка
            <select
              className="input"
              aria-label="Площадка"
              id={`${id}-provider`}
              {...form.register("provider")}
              disabled={pending}
            >
              <option value="wildberries">Wildberries</option>
              <option value="ozon">Ozon</option>
            </select>
          </label>
          {kind === "exclude_supply" ? (
            <label className="field" htmlFor={`${id}-supply`}>
              Поставка
              <select
                className="input"
                aria-label="Поставка"
                id={`${id}-supply`}
                {...form.register("supplyId")}
                disabled={pending}
                aria-invalid={!!form.formState.errors.supplyId}
              >
                <option value="">Выберите поставку</option>
                {supplies.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.items
                      .map((i) => `${i.name} · ${i.plannedUnits ?? "?"} шт.`)
                      .join(", ")}{" "}
                    ·{" "}
                    {s.receivedAt || s.expectedAt
                      ? dispatchLabel(
                          (s.receivedAt ?? s.expectedAt!).slice(0, 10),
                        )
                      : s.statusLabel}
                  </option>
                ))}
              </select>
              {form.formState.errors.supplyId && (
                <span role="alert">
                  {form.formState.errors.supplyId.message}
                </span>
              )}
            </label>
          ) : (
            <label className="field" htmlFor={`${id}-product`}>
              Товар
              <select
                className="input"
                aria-label="Товар"
                id={`${id}-product`}
                {...form.register("externalId")}
                disabled={pending}
                aria-invalid={!!form.formState.errors.externalId}
              >
                <option value="">Выберите товар</option>
                {products.map((p) => (
                  <option key={p.externalId} value={p.externalId}>
                    {p.name}
                  </option>
                ))}
              </select>
              {form.formState.errors.externalId && (
                <span role="alert">
                  {form.formState.errors.externalId.message}
                </span>
              )}
            </label>
          )}
          {kind === "launch" && (
            <label className="field" htmlFor={`${id}-donor`}>
              Продажи для оценки запуска
              <select
                className="input"
                aria-label="Продажи для оценки запуска"
                id={`${id}-donor`}
                {...form.register("donorProvider")}
                disabled={pending}
                aria-invalid={!!form.formState.errors.donorProvider}
              >
                <option value="ozon">Та же тематика на Ozon</option>
                <option value="wildberries">Та же тематика на WB</option>
              </select>
              {form.formState.errors.donorProvider && (
                <span role="alert">
                  {form.formState.errors.donorProvider.message}
                </span>
              )}
            </label>
          )}
          <label
            className={`field ${styles.resolutionNote}`}
            htmlFor={`${id}-note`}
          >
            Причина
            <textarea
              className="input"
              id={`${id}-note`}
              rows={2}
              {...form.register("note")}
              disabled={pending}
              aria-invalid={!!form.formState.errors.note}
            />
            {form.formState.errors.note && (
              <span role="alert">{form.formState.errors.note.message}</span>
            )}
          </label>
        </div>
        {kind === "zero_stock" && (
          <p className={styles.help}>
            Подтверждение действует неделю. Как только API покажет товар на
            складе, его остаток получит приоритет.
          </p>
        )}
        {kind === "launch" && (
          <p className={styles.help}>
            Предварительная оценка по той же тематике и соотношению продаж
            площадок. После накопления собственной истории включится обычный
            прогноз.
          </p>
        )}
        <Button type="submit" variant="secondary" disabled={pending}>
          Сохранить уточнение
        </Button>
      </form>
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
    </details>
  );
}
