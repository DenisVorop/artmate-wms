"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { useSession } from "@/entities/session";
import type { WorkspaceDto } from "@/shared/api/generated/model";
import { Button, ErrorState, LoadingState } from "@/shared/ui";
import { number } from "@/shared/lib/format";
import { ledgerPageCount, ledgerResultRange } from "../lib/ledger-filter";
import { ledgerDate, signedLedgerQuantity } from "../lib/ledger-view";
import { useLedgerState } from "../lib/use-ledger-state";
import { useLedgerResults } from "../model/use-ledger-results";
import { LedgerFilters } from "./ledger-filters";
import { LedgerEvent } from "./ledger-event";
import styles from "./stock-ledger.module.css";

type Props = { data: WorkspaceDto; onCorrection?: () => void };

function ManagerStockLedgerFeature({ data, onCorrection }: Props) {
  const ui = useLedgerState();
  const query = useLedgerResults(ui.filters, ui.page);
  const result = query.isPlaceholderData ? undefined : query.data;
  const summary = query.data?.summary;

  return (
    <div className={styles.feature}>
      <h1 className="page-heading">Журнал учёта</h1>
      <LedgerFilters data={data} values={ui.filters} onApply={ui.apply} />
      <section
        className={styles.results}
        aria-label="Операции"
        aria-busy={query.isFetching}
      >
        {summary && !summary.reconciled && (
          <p className={styles.warning} role="status">
            Расхождение{" "}
            {signedLedgerQuantity(summary.ledgerUnits - summary.onHandUnits)}{" "}
            шт. · по журналу {number(summary.ledgerUnits)} шт. · на балансе{" "}
            {number(summary.onHandUnits)} шт.
          </p>
        )}
        {query.isError && result && (
          <div className={styles.readError} role="alert">
            Не удалось обновить журнал.
            <Button
              variant="ghost"
              size="sm"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              Повторить
            </Button>
          </div>
        )}
        {query.isPending || query.isPlaceholderData ? (
          <LoadingState label="Загружаем операции…" />
        ) : !result ? (
          <ErrorState
            message="Не удалось загрузить журнал."
            onRetry={() => void query.refetch()}
          />
        ) : (
          <>
            <div
              className={styles.tableScroll}
              role="region"
              aria-label="Таблица операций"
              tabIndex={0}
            >
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Операция</th>
                    <th scope="col">
                      Дата и время <small>МСК</small>
                    </th>
                    <th scope="col">Исполнитель</th>
                    <th scope="col" className={styles.quantity}>
                      Изменение, шт.
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.length > 0 ? (
                    result.items.map((event) => (
                      <LedgerEvent
                        key={event.id}
                        event={event}
                        expanded={ui.expanded.has(event.id)}
                        onExpanded={(open) =>
                          ui.setEventExpanded(event.id, open)
                        }
                      />
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className={styles.empty}>
                        Операции не найдены.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <LedgerPagination
              result={result}
              pending={query.isFetching}
              onPage={ui.setPage}
            />
          </>
        )}
        {(summary || onCorrection) && (
          <footer className={styles.footer}>
            {summary && <span>История с {ledgerDate(summary.startedAt)}</span>}
            {onCorrection && (
              <Button
                size="sm"
                variant="ghost"
                aria-haspopup="dialog"
                onClick={onCorrection}
              >
                Корректировка остатка
              </Button>
            )}
          </footer>
        )}
      </section>
    </div>
  );
}

function LedgerPagination({
  result,
  pending,
  onPage,
}: {
  result: { page: number; pageSize: number; total: number };
  pending: boolean;
  onPage: (page: number) => void;
}) {
  const { page, pageSize, total } = result;
  const pages = ledgerPageCount(total, pageSize);
  if (pages <= 1 && page <= 1) return null;

  const { from, to } = ledgerResultRange(page, pageSize, total);
  return (
    <nav className={styles.pagination} aria-label="Страницы журнала">
      <span>
        {number(from)}–{number(to)} из {number(total)}
      </span>
      <div>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending || page <= 1}
          onClick={() => onPage(Math.min(page - 1, pages))}
          aria-label="Предыдущая страница"
        >
          <ArrowLeft size={15} aria-hidden="true" />
        </Button>
        <span>
          {page} / {pages}
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending || page >= pages}
          onClick={() => onPage(page + 1)}
          aria-label="Следующая страница"
        >
          <ArrowRight size={15} aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}

export function StockLedgerFeature(props: Props) {
  const { isManager } = useSession();
  return isManager ? (
    <ManagerStockLedgerFeature {...props} />
  ) : (
    <p>Журнал доступен руководителю.</p>
  );
}
