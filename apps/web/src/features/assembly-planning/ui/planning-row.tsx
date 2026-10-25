"use client";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Boxes } from "lucide-react";
import type { MarketplacePlanRowDto } from "@/entities/assembly-plan";
import { marketplaceDate, providerName } from "@/entities/marketplaces";
import { Badge, Button, Input } from "@/shared/ui";
import { transitSchema, type TransitValues } from "../lib/planning-form";
import styles from "./assembly-planning.module.css";
const number = (value: number | null, digits = 0) =>
  value == null
    ? "Нет данных"
    : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(
        value,
      );
export function PlanningRow({
  row,
  pending,
  onCreate,
  onTransit,
}: {
  row: MarketplacePlanRowDto;
  pending: boolean;
  onCreate: () => Promise<void>;
  onTransit: (units: number) => Promise<boolean>;
}) {
  const form = useForm<TransitValues>({
    resolver: zodResolver(transitSchema),
    defaultValues:
      row.inTransitUnits == null ? {} : { inTransitUnits: row.inTransitUnits },
  });
  const shortage = Math.max(0, row.recommendedUnits - row.rawAvailableUnits);
  return (
    <article className={`glass-panel ${styles.row}`}>
      <div className={styles.title}>
        <h2>{row.skuName}</h2>
        <Badge
          tone={
            row.canCreate
              ? "success"
              : row.dataComplete && row.recommendedBoxes === 0
                ? "neutral"
                : row.blockers.length
                  ? "warning"
                  : "neutral"
          }
        >
          {row.canCreate
            ? "Можно собирать"
            : row.dataComplete && row.recommendedBoxes === 0
              ? "Запаса достаточно"
              : row.dataComplete && row.recommendedBoxes > 0
                ? shortage > 0
                  ? "Нужно сырьё"
                  : "Нужна сборка"
                : row.blockers.length
                  ? "Проверьте данные"
                  : "Запаса достаточно"}
        </Badge>
      </div>
      <div className={styles.recommendation}>
        <div>
          <strong>
            {row.dataComplete
              ? `${number(row.recommendedBoxes)} коробов к сборке`
              : "Расчёт пока недоступен"}
          </strong>
          <span>
            {row.dataComplete ? number(row.recommendedUnits) : "—"} единиц · по{" "}
            {number(row.unitsPerBox)} в коробе
          </span>
        </div>
        <Button
          disabled={pending || !row.canCreate || row.recommendedBoxes < 1}
          onClick={() => void onCreate()}
        >
          <Boxes size={17} />
          Создать задание
        </Button>
      </div>
      <div className={styles.metrics}>
        <Metric
          label="Спрос в день"
          value={row.dataComplete ? number(row.averageDailyUnits, 1) : "—"}
          note="Единиц товара · оба маркетплейса"
        />
        <Metric
          label="На маркетплейсах"
          value={row.dataComplete ? number(row.marketplaceUnits) : "—"}
          note="Единиц товара на их складах"
        />
        <div className={styles.metric}>
          <span>В пути на маркетплейсы</span>
          <strong>{number(row.inTransitUnits)}</strong>
          <small>
            {row.inboundSource === "api"
              ? "Из API поставок"
              : row.inboundSource === "manual"
                ? "Подтверждено вручную"
                : "Нужна проверка данных"}
          </small>
          <div className={styles.sources}>
            {row.inboundSources.map((source) => (
              <small key={source.provider}>
                {providerName(source.provider)}: {number(source.units)}
                {row.inboundSource === "manual" && " · API"}
              </small>
            ))}
          </div>
        </div>
        <Metric
          label="Готово у нас"
          value={number(row.readyUnits)}
          note="Включая общий накопитель"
        />
        <Metric
          label="Уже в заданиях"
          value={number(row.openTaskUnits)}
          note="Оставшийся объём сборки"
        />
      </div>
      {!!row.blockers.length && (
        <div className={styles.blockers} role="status">
          {row.blockers.map((reason) => (
            <p key={reason} className={styles.warning}>
              {reason}
            </p>
          ))}
        </div>
      )}
      {!!row.warnings.length && (
        <details className={styles.detail}>
          <summary>Примечания к расчёту · {row.warnings.length}</summary>
          {row.warnings.map((warning) => (
            <p key={warning} className={styles.help}>
              {warning}
            </p>
          ))}
        </details>
      )}
      {row.dataComplete && shortage > 0 && (
        <p className={styles.warning}>
          Для рекомендации не хватает {number(shortage)} доступных единиц сырья.
        </p>
      )}
      <details className={styles.detail}>
        <summary>Расчёт и товар в пути</summary>
        <dl>
          <dt>Целевой запас, единиц товара</dt>
          <dd>{row.dataComplete ? number(row.targetUnits) : "—"}</dd>
          <dt>Готово к отгрузке со склада</dt>
          <dd>{number(row.shippingReadyUnits)}</dd>
          <dt>Зарезервировано под отгрузки</dt>
          <dd>{number(row.shipmentReservedUnits)}</dd>
          <dt>Сырья доступно для новых заданий</dt>
          <dd>{number(row.rawAvailableUnits)}</dd>
        </dl>
        <div className={styles.sourceDetails}>
          {row.inboundSources.map((source) => (
            <div key={source.provider}>
              <strong>
                {providerName(source.provider)} · {number(source.units)}
              </strong>
              <p className={styles.help}>
                {source.source === "wb_supplies"
                  ? "По документам поставок WB"
                  : source.source === "ozon_analytics"
                    ? "По аналитике Ozon: в пути и на приёмке"
                    : source.source === "legacy"
                      ? "Ранее загруженные данные"
                      : "Источник не подтверждён"}
                {source.asOf
                  ? ` · ${marketplaceDate(source.asOf)}`
                  : " · Дата загрузки неизвестна"}
                {source.supplyCount > 0 &&
                  ` · документов: ${number(source.supplyCount)}`}
              </p>
              {source.warnings.map((warning) => (
                <p key={warning} className={styles.warning}>
                  {warning}
                </p>
              ))}
            </div>
          ))}
        </div>
        <p className={styles.help}>
          <Link href="/integrations#marketplace-supplies-title">
            Посмотреть документы поставок →
          </Link>
        </p>
        <details className={styles.manual}>
          <summary>Указать товар в пути вручную</summary>
          <form
            noValidate
            className={styles.transit}
            onSubmit={form.handleSubmit(async (values) => {
              if (!pending && (await onTransit(values.inTransitUnits)))
                form.reset(values);
            })}
          >
            <label className="field">
              Единиц товара в пути на маркетплейсы
              <Input
                type="number"
                min={0}
                max={100000000}
                {...form.register("inTransitUnits", { valueAsNumber: true })}
                disabled={pending}
                placeholder="Укажите количество"
                aria-invalid={!!form.formState.errors.inTransitUnits}
              />
            </label>
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              disabled={
                pending ||
                (row.inTransitUnits != null && !form.formState.isDirty)
              }
            >
              Подтвердить
            </Button>
            {form.formState.errors.inTransitUnits && (
              <span className={styles.error}>
                {form.formState.errors.inTransitUnits.message}
              </span>
            )}
          </form>
          <p className={styles.help}>
            Ручное подтверждение заменяет расчёт товара в пути из API. Укажите
            общий объём отправленного, ещё не принятого товара по обоим
            маркетплейсам. Ноль подтверждайте только после проверки фактических
            поставок. Уже принятый товар сюда не входит. После новой загрузки
            данных ручное подтверждение сбрасывается.
          </p>
        </details>
      </details>
    </article>
  );
}
function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className={styles.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
