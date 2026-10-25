"use client";
import { useId, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Boxes } from "lucide-react";
import type { MarketplacePlanRowDto } from "@/entities/assembly-plan";
import { Badge, Button, Input } from "@/shared/ui";
import { transitSchema, type TransitValues } from "../lib/planning-form";
import { boxesLabel } from "../lib/planning-view";
import styles from "./assembly-planning.module.css";
const number = (value: number | null, digits = 0) =>
  value == null
    ? "Не уточнено"
    : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(
        value,
      );
const status = {
  ready: "Можно собирать",
  covered: "Запаса достаточно",
  raw_shortage: "Не хватает сырья",
  review: "Нужна проверка",
};
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
  const id = useId();
  const [expanded, setExpanded] = useState(false),
    [manual, setManual] = useState(false);
  const form = useForm<TransitValues>({
    resolver: zodResolver(transitSchema),
    defaultValues:
      row.inTransitUnits == null ? {} : { inTransitUnits: row.inTransitUnits },
  });
  const { state, action, message } = row.advice;
  const needsAssembly =
    row.dataComplete && (state === "ready" || state === "raw_shortage");
  return (
    <article className={`glass-panel ${styles.row}`}>
      <div className={styles.rowMain}>
        <div className={styles.title}>
          <h2>{row.skuName}</h2>
          <Badge
            tone={
              state === "ready"
                ? "success"
                : state === "covered"
                  ? "neutral"
                  : "warning"
            }
          >
            {status[state]}
          </Badge>
        </div>
        <div className={styles.quantity}>
          <strong className={needsAssembly ? styles.quantityAccent : undefined}>
            {needsAssembly
              ? boxesLabel(row.recommendedBoxes)
              : state === "covered"
                ? "Собирать не нужно"
                : "Расчёт ожидает проверки"}
          </strong>
          {needsAssembly && (
            <span>
              {number(row.recommendedUnits)} шт. · по {number(row.unitsPerBox)}{" "}
              в коробе
            </span>
          )}
        </div>
        <div className={styles.rowAction}>
          {action === "create" && (
            <Button
              disabled={pending || !row.canCreate}
              onClick={() => void onCreate()}
            >
              <Boxes size={16} />
              Создать задание
            </Button>
          )}
          {action === "receiving" && (
            <Link className="button button--secondary" href="/receiving">
              Открыть приёмку
            </Link>
          )}
          {action === "integrations" && (
            <Link className="button button--ghost" href="/integrations">
              Проверить данные
            </Link>
          )}
          {action === "transit" && (
            <Button
              variant="secondary"
              aria-expanded={expanded && manual}
              aria-controls={`${id}-details`}
              onClick={() => {
                setExpanded(true);
                setManual(true);
              }}
            >
              Уточнить поставки
            </Button>
          )}
        </div>
      </div>
      {(state === "review" || state === "raw_shortage") && (
        <p className={styles.reason}>{message}</p>
      )}
      <details
        className={styles.detail}
        id={`${id}-details`}
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary>Подробнее</summary>
        <dl className={styles.metrics}>
          <Metric
            label="Заказов в день"
            value={
              row.dataComplete
                ? number(row.averageDailyUnits, 1)
                : "Не уточнено"
            }
          />
          <Metric
            label="На маркетплейсах, шт."
            value={
              row.dataComplete ? number(row.marketplaceUnits) : "Не уточнено"
            }
          />
          <Metric label="В пути, шт." value={number(row.inTransitUnits)} />
          <Metric label="Готовых у нас, шт." value={number(row.readyUnits)} />
          <Metric label="Уже в сборке, шт." value={number(row.openTaskUnits)} />
          <Metric
            label="Сырья для сборки, шт."
            value={number(row.rawAvailableUnits)}
          />
        </dl>
        <p className={styles.help}>
          Готовый товар и текущие задания уже учтены в рекомендации.
        </p>
        <Link
          className={styles.textLink}
          href="/integrations#marketplace-supplies-title"
        >
          Посмотреть поставки →
        </Link>
        <details
          className={styles.manual}
          open={manual}
          onToggle={(event) => setManual(event.currentTarget.open)}
        >
          <summary>Уточнить товар в пути</summary>
          <form
            noValidate
            className={styles.transit}
            onSubmit={form.handleSubmit(async (values) => {
              if (!pending && (await onTransit(values.inTransitUnits)))
                form.reset(values);
            })}
          >
            <label className="field" htmlFor={`${id}-transit`}>
              Товар в пути на маркетплейсы, шт.
              <Input
                id={`${id}-transit`}
                type="number"
                min={0}
                max={100000000}
                {...form.register("inTransitUnits", { valueAsNumber: true })}
                disabled={pending}
                placeholder="Укажите количество"
                aria-invalid={!!form.formState.errors.inTransitUnits}
                aria-describedby={
                  form.formState.errors.inTransitUnits
                    ? `${id}-error`
                    : `${id}-help`
                }
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
              Сохранить количество
            </Button>
            {form.formState.errors.inTransitUnits && (
              <span id={`${id}-error`} className={styles.error} role="alert">
                {form.formState.errors.inTransitUnits.message}
              </span>
            )}
          </form>
          <p className={styles.help} id={`${id}-help`}>
            Укажите весь отправленный товар, который ещё не приняли
            маркетплейсы. Уточнение заменит автоматическое количество до
            следующего обновления данных.
          </p>
        </details>
      </details>
    </article>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metric}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
