"use client";
import { useState } from "react";
import Link from "next/link";
import { RefreshCw, Settings2 } from "lucide-react";
import { useSession } from "@/entities/session";
import { useAssemblyPlan } from "@/entities/assembly-plan";
import { Button, EmptyState, ErrorState, LoadingState } from "@/shared/ui";
import { usePlanningActions } from "../model/use-planning-actions";
import { PlanningSettings } from "./planning-settings";
import { PlanningRow } from "./planning-row";
import styles from "./assembly-planning.module.css";
export function AssemblyPlanningFeature() {
  const session = useSession(),
    query = useAssemblyPlan(session.isManager),
    actions = usePlanningActions();
  const [notice, setNotice] = useState("");
  if (query.isPending)
    return <LoadingState label="Рассчитываем план сборки…" />;
  if (!query.data) return <ErrorState onRetry={() => void query.refetch()} />;
  const { plan, settings, connections, products } = query.data;
  const connected = connections.some((item) => item.configured && item.enabled);
  return (
    <div className={styles.feature}>
      <header className={styles.header}>
        <div>
          <p className="eyebrow">ПРОДАЖИ → ЗАПАС → СБОРКА</p>
          <h1 className="page-heading">План сборки</h1>
          <p>
            Общий спрос Wildberries и Ozon. Сначала используем готовые короба и
            текущую очередь, затем рассчитываем новую сборку.
          </p>
        </div>
        <div className={styles.actions}>
          <Button
            variant="secondary"
            disabled={query.isFetching || actions.pending}
            onClick={() => void query.refetch()}
          >
            <RefreshCw size={15} />
            Обновить расчёт
          </Button>
          <Link className="button button--ghost" href="/integrations">
            <Settings2 size={16} />
            Подключения
          </Link>
        </div>
      </header>
      {notice && (
        <p className={styles.notice} role="status">
          {notice} <Link href="/assembly">Открыть сборку →</Link>
        </p>
      )}
      {actions.error && (
        <p className={styles.error} role="alert">
          {actions.error}
        </p>
      )}
      {query.isError && (
        <p className={styles.warning} role="alert">
          Не удалось обновить расчёт. Показан предыдущий результат.
        </p>
      )}
      <PlanningSettings
        key={JSON.stringify(settings)}
        settings={settings}
        pending={actions.pending}
        onSave={async (values) => !!(await actions.save(values))}
      />
      <div className={`glass-panel ${styles.formula}`}>
        <strong>Потребность в сборке</strong> = целевой запас − остатки на
        маркетплейсах − подтверждённый товар в пути − готовые раскраски у нас −
        оставшийся объём заданий. Результат округляется до целых коробов.
      </div>
      {plan.warnings.map((warning) => (
        <p key={warning} className={styles.warning}>
          {warning}
        </p>
      ))}
      {!connected || !products.length ? (
        <section className="glass-panel">
          <EmptyState
            title={
              !connected ? "Подключите маркетплейсы" : "Нужны продажи и каталог"
            }
            description="Для рекомендации загрузите данные и сопоставьте товары с тематиками WMS. Отсутствующие данные не считаются нулевыми продажами."
            action={
              <Link className="button button--primary" href="/integrations">
                Настроить интеграции
              </Link>
            }
          />
        </section>
      ) : !plan.rows.length ? (
        <section className="glass-panel">
          <EmptyState
            title="Нет тематик для расчёта"
            description="Проверьте соответствия карточек маркетплейсов и тематик склада."
            action={
              <Link className="button button--secondary" href="/integrations">
                Сопоставить товары
              </Link>
            }
          />
        </section>
      ) : (
        <div className={styles.rows}>
          {plan.rows.map((row) => (
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
                    `Задание на ${row.recommendedBoxes} коробов «${row.skuName}» добавлено в свободную очередь.`,
                  );
              }}
            />
          ))}
        </div>
      )}
      <p className={styles.stats}>
        Рекомендации не создают задания автоматически. При создании сервер
        повторно проверяет актуальный расчёт и доступное сырьё.
      </p>
    </div>
  );
}
