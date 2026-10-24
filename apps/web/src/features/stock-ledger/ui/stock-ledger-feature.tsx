"use client";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardList,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import type { WorkspaceDto } from "@/shared/api/generated/model";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/shared/ui";
import { number } from "@/shared/lib/format";
import { ledgerPageCount, ledgerResultRange } from "../lib/ledger-filter";
import { ledgerDate, signedLedgerQuantity } from "../lib/ledger-view";
import { useLedgerState } from "../lib/use-ledger-state";
import { useLedgerResults } from "../model/use-ledger-results";
import { LedgerFilters } from "./ledger-filters";
import { LedgerEvent } from "./ledger-event";
import styles from "./stock-ledger.module.css";
export function StockLedgerFeature({
  data,
  onCorrection,
}: {
  data: WorkspaceDto;
  onCorrection?: () => void;
}) {
  const ui = useLedgerState();
  const query = useLedgerResults(ui.filters, ui.page);
  const result = query.isPlaceholderData ? undefined : query.data;
  const pages = result ? ledgerPageCount(result.total, result.pageSize) : 1;
  const range = result
    ? ledgerResultRange(result.page, result.pageSize, result.total)
    : { from: 0, to: 0 };
  const summary = query.data?.summary;
  return (
    <div className={styles.feature}>
      <header className="page-header">
        <div>
          <p className="eyebrow">ТОВАРНЫЙ УЧЁТ · ИСТОРИЯ</p>
          <h1 className="page-heading">Журнал учёта</h1>
          <p className="page-description">
            Приход, сборка, размещение, отгрузки и корректировки — с составом
            каждой операции.
          </p>
        </div>
        <div className={styles.actions}>
          <Button
            size="sm"
            variant="secondary"
            disabled={query.isFetching}
            aria-busy={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw size={14} />
            Обновить журнал
          </Button>
          {onCorrection && (
            <Button onClick={onCorrection}>
              <ClipboardList size={15} />
              Корректировка остатка
            </Button>
          )}
        </div>
      </header>
      {summary && (
        <>
          <div className={styles.metrics}>
            <div className={`glass-panel ${styles.metric}`}>
              <span>По журналу, шт.</span>
              <strong>{number(summary.ledgerUnits)}</strong>
            </div>
            <div className={`glass-panel ${styles.metric}`}>
              <span>На балансе склада, шт.</span>
              <strong>{number(summary.onHandUnits)}</strong>
            </div>
            <div className={`glass-panel ${styles.metric}`}>
              <span>Сверка журнала и баланса</span>
              <Badge tone={summary.reconciled ? "success" : "warning"}>
                {summary.reconciled ? (
                  <>
                    <Check size={13} />
                    Совпадает
                  </>
                ) : (
                  <>
                    <TriangleAlert size={13} />
                    Есть расхождение
                  </>
                )}
              </Badge>
            </div>
          </div>
          <section
            className={`glass-panel ${styles.boundary}`}
            aria-label="Граница доступной истории"
          >
            <span className={styles.boundaryIcon}>
              <ClipboardList size={18} />
            </span>
            <div>
              <strong>История с {ledgerDate(summary.startedAt)}</strong>
              <p>
                В этот момент зафиксирован начальный остаток. Операции до начала
                журнала не восстановлены. Событий с начала учёта:{" "}
                {number(summary.eventsCount)}.
              </p>
              {!summary.reconciled && (
                <p className={styles.reconciliationWarning}>
                  Разница между журналом и балансом:{" "}
                  {signedLedgerQuantity(
                    summary.ledgerUnits - summary.onHandUnits,
                  )}{" "}
                  шт. Проверьте операции и фактический остаток до корректировки.
                </p>
              )}
            </div>
          </section>
        </>
      )}
      <LedgerFilters data={data} values={ui.filters} onApply={ui.apply} />
      <section
        className={`glass-panel ${styles.results}`}
        aria-label="События журнала"
        aria-busy={query.isFetching}
      >
        <div className={styles.resultHeading}>
          <h2>Операции</h2>
          <span>
            {result
              ? `${number(result.total)} по выбранным фильтрам`
              : "Загружаем историю"}
          </span>
          {query.isFetching && result && (
            <span role="status" className={styles.refreshing}>
              Обновляем…
            </span>
          )}
        </div>
        {query.isError && result && (
          <div className={styles.readError} role="alert">
            <p>
              Не удалось обновить журнал. Показана последняя загруженная версия;
              фильтры сохранены.
            </p>
            <Button
              variant="secondary"
              size="sm"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              Повторить загрузку
            </Button>
          </div>
        )}
        {query.isPending || query.isPlaceholderData ? (
          <LoadingState label="Загружаем операции учёта…" />
        ) : !result ? (
          <ErrorState
            message="Не удалось загрузить журнал. Фильтры сохранены: измените их или повторите загрузку."
            onRetry={() => void query.refetch()}
          />
        ) : result.items.length ? (
          <div className={styles.events}>
            {result.items.map((event) => (
              <LedgerEvent
                key={event.id}
                event={event}
                expanded={ui.expanded.has(event.id)}
                onExpanded={(open) => ui.setEventExpanded(event.id, open)}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title={
              result.total > 0
                ? "На этой странице нет операций"
                : "Операции не найдены"
            }
            description={
              result.total > 0
                ? "Вернитесь на первую страницу, чтобы увидеть актуальные результаты."
                : "Измените фильтры или дождитесь новых операций. Начальный остаток отмечает границу доступной истории."
            }
            action={
              result.total > 0 ? (
                <Button variant="secondary" onClick={() => ui.setPage(1)}>
                  На первую страницу
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() =>
                    ui.apply({
                      kind: "",
                      skuId: "",
                      employeeId: "",
                      from: "",
                      to: "",
                      search: "",
                      pageSize: 25,
                    })
                  }
                >
                  Показать все операции
                </Button>
              )
            }
          />
        )}
        {result && (
          <nav className={styles.pagination} aria-label="Страницы журнала">
            <span>
              {number(range.from)}–{number(range.to)} из {number(result.total)}
            </span>
            <div>
              <Button
                size="sm"
                variant="secondary"
                disabled={query.isFetching || result.page <= 1}
                onClick={() => ui.setPage(Math.max(1, result.page - 1))}
              >
                <ArrowLeft size={14} />
                Назад
              </Button>
              <span>
                Страница {result.page} из {pages}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={query.isFetching || result.page >= pages}
                onClick={() => ui.setPage(result.page + 1)}
              >
                Далее
                <ArrowRight size={14} />
              </Button>
            </div>
          </nav>
        )}
      </section>
    </div>
  );
}
