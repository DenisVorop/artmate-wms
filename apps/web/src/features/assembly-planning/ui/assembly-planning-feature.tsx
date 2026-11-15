"use client";
import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { useSession } from "@/entities/session";
import {
  useAssemblyPlan,
  type MarketplacePlanDto,
} from "@/entities/assembly-plan";
import { Button, ErrorState, LoadingState } from "@/shared/ui";
import { usePlanningActions } from "../model/use-planning-actions";
import { displayedPlanningPlan } from "../lib/planning-display";
import {
  boxesLabel,
  dispatchLabel,
  planningTimestamp,
  planningGroups,
  type PlanningFilter,
} from "../lib/planning-view";
import { PlanningResolutions } from "./planning-resolutions";
import { PlanningSettings } from "./planning-settings";
import { PlanningRow } from "./planning-row";
import { PlanningTable } from "./planning-table";
import styles from "./assembly-planning.module.css";

export function AssemblyPlanningFeature({
  preview,
}: {
  preview?: MarketplacePlanDto;
}) {
  const session = useSession();
  const query = useAssemblyPlan(session.isManager && !preview);
  const actions = usePlanningActions();
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState<PlanningFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousSelection = useRef(selectedId);
  useLayoutEffect(() => {
    if (previousSelection.current !== selectedId) {
      previousSelection.current = selectedId;
      heading.current?.focus();
    }
  }, [selectedId]);

  const data = query.data;
  if (!preview && query.isPending)
    return <LoadingState label="Загружаем план…" />;
  if (!preview && !data)
    return <ErrorState onRetry={() => void query.refetch()} />;

  const connected = !!data?.connections.some(
    (item) => item.configured && item.enabled,
  );
  const planStatus = data?.planStatus;
  const plan =
    preview ??
    (data && connected && data.products.length
      ? displayedPlanningPlan(data.plan, data.previousPlan, data.planStatus)
      : null);
  const isPrevious = !preview && !!data?.previousPlan;
  const readOnly = !!preview || isPrevious;
  const groups = planningGroups(plan?.rows ?? []);
  const selected = plan?.rows.find((row) => row.skuId === selectedId);
  const create = async (
    skuId: string,
    proposalHash: string,
    skuName: string,
    purpose: "urgent" | "backlog",
  ) => {
    if (readOnly) return;
    setNotice("");
    if (await actions.create(skuId, proposalHash, purpose))
      setNotice(`Задание на один короб «${skuName}» создано.`);
  };

  return (
    <div className={styles.feature}>
      <header className={styles.header}>
        <h1 className="page-heading" ref={heading} tabIndex={-1}>
          Поставки и сборка
        </h1>
        {selected && (
          <Button
            variant="secondary"
            disabled={actions.pending}
            onClick={() => setSelectedId(null)}
          >
            <ArrowLeft size={15} aria-hidden="true" />К плану
          </Button>
        )}
      </header>
      {preview ? (
        <p className={styles.help}>
          Демоданные WB и Ozon{" · "}
          <a className={styles.textLink} href="#planning-forecast">
            К графикам прогноза
          </a>
        </p>
      ) : (
        plan &&
        planStatus && (
          <p
            className={isPrevious ? styles.warning : styles.help}
            role="status"
          >
            {isPrevious ? "Предыдущий расчёт" : "Расчёт"}
            {planStatus.calculatedAt && (
              <> от {planningTimestamp(planStatus.calculatedAt)}</>
            )}
            {planStatus.salesThrough && (
              <> · Продажи по {dispatchLabel(planStatus.salesThrough)}</>
            )}
            {planStatus.state === "refreshing" && " · Обновляется"}
          </p>
        )
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice} <Link href="/assembly">К заданиям</Link>
        </p>
      )}
      {actions.error && (
        <p className={styles.error} role="alert">
          Не удалось сохранить изменения. Повторите попытку после обновления
          плана.
        </p>
      )}
      {!preview && query.isError && (
        <div className={styles.readError} role="alert">
          Не удалось обновить план.
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void query.refetch()}
          >
            Повторить
          </Button>
        </div>
      )}
      {plan && selected ? (
        <PlanningRow
          row={selected}
          previous={readOnly}
          pending={actions.pending}
          onCreate={() =>
            create(
              selected.skuId,
              selected.proposalHash,
              selected.skuName,
              "urgent",
            )
          }
        />
      ) : plan?.rows.length ? (
        <>
          <PlanningTable
            rows={plan.rows}
            totals={groups}
            dispatchDate={plan.dispatchDate}
            preparationThrough={plan.preparationThrough}
            filter={filter}
            search={search}
            onFilter={setFilter}
            onSearch={setSearch}
            onSelect={setSelectedId}
          />
          {groups.weeklyDispatches.length > 0 && (
            <details className={styles.settings}>
              <summary className={styles.settingsSummary}>
                Отправки по неделям <ChevronDown size={16} aria-hidden="true" />
              </summary>
              <dl className={styles.weekTotals}>
                {groups.weeklyDispatches.map((week) => (
                  <div key={week.date}>
                    <dt>{dispatchLabel(week.date)}</dt>
                    <dd>{boxesLabel(week.boxes)}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
          <details className={styles.settings}>
            <summary className={styles.settingsSummary}>
              Сборка впрок <ChevronDown size={16} aria-hidden="true" />
            </summary>
            {groups.backlog.length ? (
              <ol className={styles.backlogList}>
                {groups.backlog.slice(0, 5).map((row) => (
                  <li key={row.skuId}>
                    <div>
                      <strong>{row.skuName}</strong>
                      {row.backlogCapacityKnown && (
                        <p className={styles.help}>{row.backlogReason}</p>
                      )}
                    </div>
                    {!readOnly && row.backlogCanCreate && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={actions.pending}
                        onClick={() =>
                          void create(
                            row.skuId,
                            row.proposalHash,
                            row.skuName,
                            "backlog",
                          )
                        }
                      >
                        Создать задание
                      </Button>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className={styles.help}>{plan.backlogMessage}</p>
            )}
          </details>
        </>
      ) : (
        <section className={styles.emptyPanel}>
          <p role="status">
            {!connected
              ? "Подключите маркетплейсы, чтобы получить план."
              : !data?.products.length
                ? "Нет товаров маркетплейсов."
                : plan
                  ? "Свяжите товары маркетплейсов с тематиками склада."
                  : planStatus?.message}
          </p>
          <Link className={styles.textLink} href="/integrations">
            К маркетплейсам
          </Link>
        </section>
      )}
      {!preview && data && !selected && (
        <>
          <PlanningSettings
            key={JSON.stringify(data.settings)}
            settings={data.settings}
            pending={actions.pending}
            onSave={async (values) => !!(await actions.save(values))}
          />
          {connected && (
            <PlanningResolutions
              data={data}
              pending={actions.pending}
              onSave={async (values) => !!(await actions.resolution(values))}
            />
          )}
        </>
      )}
    </div>
  );
}
