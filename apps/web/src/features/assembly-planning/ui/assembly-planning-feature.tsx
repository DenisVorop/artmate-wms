"use client";
import { useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { useSession } from "@/entities/session";
import { useAssemblyPlan } from "@/entities/assembly-plan";
import { Button, EmptyState, ErrorState, LoadingState } from "@/shared/ui";
import { usePlanningActions } from "../model/use-planning-actions";
import {
  boxesLabel,
  planningGroups,
  planningRows,
  type PlanningFilter,
} from "../lib/planning-view";
import { PlanningSettings } from "./planning-settings";
import { PlanningRow } from "./planning-row";
import styles from "./assembly-planning.module.css";
export function AssemblyPlanningFeature() {
  const session = useSession(),
    query = useAssemblyPlan(session.isManager),
    actions = usePlanningActions();
  const [notice, setNotice] = useState(""),
    [filter, setFilter] = useState<PlanningFilter | null>(null);
  if (query.isPending) return <LoadingState label="Готовим план сборки…" />;
  if (!query.data) return <ErrorState onRetry={() => void query.refetch()} />;
  const { plan, settings, connections, products } = query.data;
  const connected = connections.some((item) => item.configured && item.enabled);
  const groups = planningGroups(plan.rows);
  const active =
    filter ??
    (groups.assembly.length
      ? "assembly"
      : groups.review.length
        ? "review"
        : "all");
  const rows = planningRows(plan.rows, active);
  const tabs: { id: PlanningFilter; label: string; count: number }[] = [
    { id: "assembly", label: "Нужно собрать", count: groups.assembly.length },
    { id: "review", label: "Нужна проверка", count: groups.review.length },
    { id: "all", label: "Все товары", count: plan.rows.length },
  ];
  return (
    <div className={styles.feature}>
      <header className={styles.header}>
        <div>
          <p className="eyebrow">ЗАПАСЫ И ПРОДАЖИ</p>
          <h1 className="page-heading">План сборки</h1>
          <p>Что собрать с учётом продаж, поставок и готовых коробов.</p>
        </div>
        <div className={styles.actions}>
          <Button
            variant="secondary"
            disabled={query.isFetching || actions.pending}
            onClick={() => void query.refetch()}
            aria-busy={query.isFetching}
          >
            <RefreshCw size={15} />
            Обновить расчёт
          </Button>
          <Link className="button button--ghost" href="/integrations">
            Маркетплейсы
          </Link>
        </div>
      </header>
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
              <span>Потребность в сборке</span>
              <strong>
                {groups.assembly.length
                  ? boxesLabel(groups.boxes)
                  : groups.review.length
                    ? "Нужно уточнить данные"
                    : "Запаса достаточно"}
              </strong>
              {groups.review.length > 0 && (
                <small>Товары без расчёта — в списке «Нужна проверка».</small>
              )}
            </div>
            <div className={styles.overviewStat}>
              <strong>{groups.assembly.length}</strong>
              <span>Тематик к сборке</span>
            </div>
            <div className={styles.overviewStat}>
              <strong>{groups.covered.length}</strong>
              <span>С достаточным запасом</span>
            </div>
          </section>
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
                      ? "Дополнительная сборка не нужна"
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
                key={`${row.skuId}:${row.inTransitUnits}`}
                row={row}
                pending={actions.pending}
                onTransit={async (units) =>
                  !!(await actions.transit(row.skuId, units))
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
