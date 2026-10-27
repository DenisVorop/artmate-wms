"use client";
import { useState } from "react";
import Link from "next/link";
import { useSession } from "@/entities/session";
import { useAssemblyPlan } from "@/entities/assembly-plan";
import { Button, EmptyState, ErrorState, LoadingState } from "@/shared/ui";
import { usePlanningActions } from "../model/use-planning-actions";
import {
  boxesLabel,
  dispatchLabel,
  planningTimestamp,
  planningGroups,
  planningRows,
  type PlanningFilter,
} from "../lib/planning-view";
import { PlanningResolutions } from "./planning-resolutions";
import { PlanningSettings } from "./planning-settings";
import { PlanningRow } from "./planning-row";
import styles from "./assembly-planning.module.css";
export function AssemblyPlanningFeature() {
  const session = useSession(),
    query = useAssemblyPlan(session.isManager),
    actions = usePlanningActions();
  const [notice, setNotice] = useState(""),
    [filter, setFilter] = useState<PlanningFilter | null>(null);
  if (query.isPending) return <LoadingState label="Готовим план…" />;
  if (!query.data) return <ErrorState onRetry={() => void query.refetch()} />;
  const { settings, connections, products, planStatus, previousPlan } =
    query.data;
  const plan = previousPlan ?? query.data.plan;
  const isPrevious = previousPlan !== null;
  const connected = connections.some((item) => item.configured && item.enabled);
  const groups = planningGroups(plan.rows);
  const active = filter ?? "all";
  const rows = planningRows(plan.rows, active);
  const tabs: { id: PlanningFilter; label: string; count: number }[] = [
    { id: "all", label: "Все товары", count: plan.rows.length },
    { id: "shipping", label: "К отправке", count: groups.shipping.length },
    { id: "assembly", label: "Нужно собрать", count: groups.assembly.length },
    { id: "review", label: "Нужна проверка", count: groups.review.length },
  ];
  return (
    <div className={styles.feature}>
      <header className={styles.header}>
        <div>
          <p className="eyebrow">ЗАПАСЫ И ПРОДАЖИ</p>
          <h1 className="page-heading">Поставки и сборка</h1>
          <p>
            К отгрузке {dispatchLabel(plan.dispatchDate)} · данные обновляются
            каждые 30 минут.
          </p>
        </div>
        <div className={styles.actions}>
          <Link className="button button--ghost" href="/integrations">
            Маркетплейсы
          </Link>
        </div>
      </header>
      <p
        className={isPrevious ? styles.warning : styles.notice}
        role="status"
        aria-live="polite"
      >
        {planStatus.message}
        {planStatus.calculatedAt && (
          <> · Расчёт от {planningTimestamp(planStatus.calculatedAt)}</>
        )}
        {planStatus.salesThrough && (
          <> · Продажи по {dispatchLabel(planStatus.salesThrough)}</>
        )}
        {isPrevious && " · Количества и даты относятся к сохранённому расчёту."}
      </p>
      {notice && (
        <p className={styles.notice} role="status">
          {notice} <Link href="/assembly">Открыть задания →</Link>
        </p>
      )}
      {actions.error && (
        <p className={styles.error} role="alert">
          Изменения не сохранены. Обновите план и повторите попытку.
        </p>
      )}
      {query.isError && (
        <p className={styles.warning} role="alert">
          Не удалось обновить план. Показан предыдущий расчёт. Повторите
          обновление.
        </p>
      )}
      <PlanningSettings
        key={JSON.stringify(settings)}
        settings={settings}
        pending={actions.pending}
        onSave={async (values) => !!(await actions.save(values))}
      />
      {connected && (
        <PlanningResolutions
          data={query.data}
          pending={actions.pending}
          onSave={async (values) => !!(await actions.resolution(values))}
        />
      )}
      {!connected || !products.length ? (
        <section className="glass-panel">
          <EmptyState
            title={
              !connected
                ? "Подключите маркетплейсы"
                : "Загрузите товары и продажи"
            }
            description="После подключения появится рекомендация, что и сколько собирать."
            action={
              <Link className="button button--primary" href="/integrations">
                Открыть маркетплейсы
              </Link>
            }
          />
        </section>
      ) : !plan.rows.length ? (
        <section className="glass-panel">
          <EmptyState
            title="Пока нет товаров для расчёта"
            description="Свяжите товары маркетплейсов с тематиками склада."
            action={
              <Link className="button button--secondary" href="/integrations">
                Настроить товары
              </Link>
            }
          />
        </section>
      ) : (
        <>
          <section
            className={`glass-panel ${styles.overview}`}
            aria-label="Итог плана"
          >
            <div className={styles.total}>
              <span>Ближайшая отправка</span>
              <strong>
                {groups.completeCount
                  ? boxesLabel(groups.outboundBoxes)
                  : "Нужны данные"}
              </strong>
              <small>Потребность к {dispatchLabel(plan.dispatchDate)}</small>
            </div>
            <div className={styles.total}>
              <span>Останется после этой отправки</span>
              <strong>
                {groups.completeCount
                  ? boxesLabel(groups.remainingBoxes)
                  : "Нужны данные"}
              </strong>
              <small>
                {groups.partialBoxes
                  ? "И товар в неполных коробах"
                  : "Из текущего готового запаса"}
              </small>
            </div>
            <div className={styles.total}>
              <span>Собрать на месяц</span>
              <strong className={styles.quantityAccent}>
                {groups.completeCount
                  ? boxesLabel(groups.boxes)
                  : "Нужны данные"}
              </strong>
              <small>
                На все отправки до {dispatchLabel(plan.preparationThrough)} ·
                текущая сборка учтена
              </small>
            </div>
          </section>
          {groups.review.length > 0 && (
            <p className={styles.warning} role="status">
              Итог пока неполный: {groups.review.length} товаров требуют
              проверки. Их количество не включено.
            </p>
          )}
          <details className={`glass-panel ${styles.backlog}`}>
            <summary className={styles.settingsSummary}>
              Отправки на месяц{" "}
              <span>
                {groups.completeCount
                  ? boxesLabel(groups.monthlyOutboundBoxes)
                  : "Нужны данные"}
              </span>
            </summary>
            <div className={styles.weeklyPlan}>
              {groups.weeklyDispatches.map((week) => (
                <div className={styles.quantity} key={week.date}>
                  <span>{dispatchLabel(week.date)}</span>
                  <strong>{boxesLabel(week.boxes)}</strong>
                </div>
              ))}
            </div>
            <p className={styles.help}>
              План до {dispatchLabel(plan.preparationThrough)}. Это
              рекомендации; поставки автоматически не создаются.
            </p>
          </details>
          <details className={`glass-panel ${styles.backlog}`}>
            <summary className={styles.settingsSummary}>
              Что собирать после срочных заданий{" "}
              <span className={styles.settingsAction}>Очередь впрок</span>
            </summary>
            <p className={styles.help}>{plan.backlogMessage}</p>
            {groups.backlog.length > 0 && (
              <ol className={styles.backlogList}>
                {groups.backlog.slice(0, 5).map((row) => (
                  <li key={row.skuId}>
                    <div>
                      <strong>{row.skuName}</strong>
                      {row.backlogCapacityKnown && (
                        <p className={styles.help}>{row.backlogReason}</p>
                      )}
                    </div>
                    {row.backlogCanCreate && (
                      <Button
                        variant="secondary"
                        disabled={actions.pending}
                        onClick={() =>
                          void (async () => {
                            const result = await actions.create(
                              row.skuId,
                              row.proposalHash,
                              "backlog",
                            );
                            if (result)
                              setNotice(
                                `В очередь добавлен один короб «${row.skuName}».`,
                              );
                          })()
                        }
                      >
                        Собрать следующий короб
                      </Button>
                    )}
                  </li>
                ))}
              </ol>
            )}
            <Link className={styles.textLink} href="/tasks">
              Все задания склада →
            </Link>
          </details>
          <div
            className={styles.filters}
            role="group"
            aria-label="Какие товары показать"
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={
                  active === tab.id ? styles.filterActive : styles.filter
                }
                aria-pressed={active === tab.id}
                onClick={() => setFilter(tab.id)}
              >
                {tab.label}
                <span>{tab.count}</span>
              </button>
            ))}
          </div>
          <div className={styles.rows}>
            {!rows.length && (
              <section className="glass-panel">
                <EmptyState
                  title={
                    active === "assembly"
                      ? "Срочная сборка не нужна"
                      : active === "shipping"
                        ? "Отправка пока не требуется"
                        : "Проверка не требуется"
                  }
                  description={
                    active === "assembly" && groups.review.length
                      ? "Для части товаров сначала нужно уточнить данные."
                      : "Откройте все товары, чтобы посмотреть запас."
                  }
                  action={
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setFilter(
                          active === "assembly" && groups.review.length
                            ? "review"
                            : "all",
                        )
                      }
                    >
                      {active === "assembly" && groups.review.length
                        ? "Посмотреть, что проверить"
                        : "Показать все товары"}
                    </Button>
                  }
                />
              </section>
            )}
            {rows.map((row) => (
              <PlanningRow
                key={row.skuId}
                row={row}
                currentRow={
                  query.data.plan.rows.find(
                    (item) => item.skuId === row.skuId,
                  ) ?? row
                }
                previous={isPrevious}
                pending={actions.pending}
                onTransit={async (units) =>
                  !!(await actions.transit(row.skuId, units))
                }
                onStock={async (values) =>
                  !!(await actions.confirmStock(row.skuId, values))
                }
                onCreate={async () => {
                  const result = await actions.create(
                    row.skuId,
                    row.proposalHash,
                  );
                  if (result)
                    setNotice(
                      `Задание «${row.skuName}» добавлено в очередь: ${boxesLabel(row.recommendedBoxes)}.`,
                    );
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
