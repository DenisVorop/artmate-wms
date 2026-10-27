"use client";
import { ClipboardCheck, Plus, RefreshCw } from "lucide-react";
import { useSession } from "@/entities/session";
import { useWorkspace } from "@/entities/workspace";
import { useStocktake, useStocktakes } from "@/entities/stocktake";
import { Button, LoadingState, ErrorState } from "@/shared/ui";
import { stocktakeLocations } from "../lib/stocktake-scope";
import { useStocktakesState } from "../lib/use-stocktakes-state";
import { useStocktakeCommands } from "../model/use-stocktake-commands";
import { CreateStocktake } from "./create-stocktake";
import { StocktakeList } from "./stocktake-list";
import { StocktakeDocument } from "./stocktake-document";
import styles from "./stocktakes.module.css";

export function StocktakesFeature({
  initialDocumentId,
}: {
  initialDocumentId?: string;
}) {
  const { user, isManager } = useSession();
  const workspace = useWorkspace();
  const ui = useStocktakesState(initialDocumentId);
  const commands = useStocktakeCommands();
  const listQuery = useStocktakes({
    bucket: ui.archive ? "archive" : "active",
    page: ui.page,
    pageSize: 10,
  });
  const docQuery = useStocktake(ui.selectedId);
  const list = listQuery.isPlaceholderData ? undefined : listQuery.data;
  const doc = docQuery.data;
  const employee = workspace.data?.employees.find(
    (employee) => employee.id === user?.employeeId,
  );
  const working = employee?.status === "working";
  const canCreate =
    !!workspace.data && stocktakeLocations(workspace.data.locations).length > 0;
  const busy = !!commands.pending;
  const success = (message: string) => ui.setNotice(message);
  return (
    <div className={styles.feature}>
      <header className="page-header">
        <div>
          <p className="eyebrow">ТОВАРНЫЙ УЧЁТ · КОНТРОЛЬ</p>
          <h1 className="page-heading">Инвентаризация</h1>
          <p className="page-description">
            Пересчитайте адреса, проверьте расхождения и примените согласованный
            результат.
          </p>
        </div>
        <div className={styles.actions}>
          <Button
            variant="secondary"
            size="sm"
            disabled={listQuery.isFetching || docQuery.isFetching}
            onClick={() => {
              void listQuery.refetch();
              if (ui.selectedId) void docQuery.refetch();
            }}
          >
            <RefreshCw size={14} />
            Обновить документы
          </Button>
          {isManager && (
            <Button
              disabled={busy || !canCreate || ui.dirtyRows.size > 0}
              onClick={() => {
                commands.clearError();
                ui.setCreating(true);
              }}
            >
              <Plus size={15} />
              Новая инвентаризация
            </Button>
          )}
        </div>
      </header>
      {isManager && !canCreate && !workspace.isPending && (
        <div className={styles.notice}>
          Сначала создайте действующие ячейки стеллажей или места на полу на
          карте склада.
        </div>
      )}
      {ui.dirtyRows.size > 0 && (
        <p className={styles.footerNote}>
          Есть несохранённый подсчёт. Сохраните его перед созданием нового
          документа или перед передачей на проверку.
        </p>
      )}
      {ui.creating && workspace.data && (
        <CreateStocktake
          data={workspace.data}
          pending={busy}
          error={commands.error}
          onClose={() => ui.setCreating(false)}
          onSave={async (ids, mode) => {
            const result = await commands.create(ids, mode);
            if (!result) return false;
            ui.setSelectedId(result.id);
            ui.showArchive(false);
            success(
              `Создан документ ${result.code}. Теперь его можно взять в работу.`,
            );
            return true;
          }}
        />
      )}
      {ui.notice && (
        <div className={styles.success} role="status">
          {ui.notice}
        </div>
      )}
      {ui.pendingSelection !== null && (
        <div className={styles.confirm}>
          <h3>Перейти к другому документу?</h3>
          <p>
            Несохранённый подсчёт останется только в текущей форме и будет
            потерян при переходе. Сохранённые результаты останутся в документе.
          </p>
          <div className={styles.inlineActions}>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={ui.forceSelect}
            >
              Перейти и очистить несохранённый ввод
            </Button>
            <Button
              variant="ghost"
              onClick={() => ui.setPendingSelection(null)}
            >
              Остаться в документе
            </Button>
          </div>
        </div>
      )}
      <div className={styles.layout}>
        <aside className={styles.sidebar} aria-label="Документы инвентаризации">
          {listQuery.isError && list && (
            <div role="alert" className={styles.error}>
              Не удалось обновить список. Показана последняя загруженная версия.
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void listQuery.refetch()}
              >
                Повторить
              </Button>
            </div>
          )}
          {listQuery.isPending || listQuery.isPlaceholderData ? (
            <LoadingState label="Загружаем документы…" />
          ) : !list ? (
            <ErrorState
              message="Не удалось загрузить документы инвентаризации."
              onRetry={() => void listQuery.refetch()}
            />
          ) : (
            <StocktakeList
              data={list}
              archive={ui.archive}
              selectedId={ui.selectedId}
              pending={listQuery.isFetching || busy}
              page={ui.page}
              onPage={ui.setPage}
              onArchive={ui.showArchive}
              onSelect={(id) => {
                if (!busy) {
                  commands.clearError();
                  ui.select(id);
                }
              }}
              search={ui.search}
              onSearch={ui.setSearch}
            />
          )}
        </aside>
        <section className={styles.detail} aria-label="Документ инвентаризации">
          {!ui.selectedId ? (
            <section className={`glass-panel ${styles.emptyDetail}`}>
              <ClipboardCheck size={32} />
              <h2>Выберите документ</h2>
              <p>
                Откройте инвентаризацию из списка, чтобы увидеть адреса и
                результаты подсчёта.
              </p>
              {isManager && canCreate && (
                <Button
                  variant="secondary"
                  onClick={() => ui.setCreating(true)}
                >
                  Новая инвентаризация
                </Button>
              )}
            </section>
          ) : docQuery.isPending ? (
            <LoadingState label="Загружаем ячейки документа…" />
          ) : !doc ? (
            <ErrorState
              message="Документ не удалось открыть: проверьте доступ или повторите загрузку. Выбранный документ и список сохранены."
              onRetry={() => void docQuery.refetch()}
            />
          ) : (
            <>
              {docQuery.isError && (
                <div className={styles.error} role="alert">
                  Документ не удалось обновить. Показана последняя загруженная
                  версия. Перед записью сервер повторно проверит доступ и
                  состояние.
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void docQuery.refetch()}
                  >
                    Повторить загрузку
                  </Button>
                </div>
              )}
              <StocktakeDocument
                key={doc.id}
                doc={doc}
                data={workspace.data}
                isManager={isManager}
                ownEmployeeId={user?.employeeId ?? ""}
                working={working}
                pending={commands.pending}
                error={commands.error}
                dirtyRows={ui.dirtyRows}
                onDirty={ui.setRowDirty}
                onClaim={async () => {
                  const result = await commands.claim(doc);
                  if (!result) return false;
                  success(
                    `${doc.code} взят в работу. Исполнитель: ${user?.name ?? "текущий сотрудник"}.`,
                  );
                  return true;
                }}
                onCount={async (row, values, revision) => {
                  const result = await commands.count(
                    doc,
                    row.locationId,
                    values,
                    revision,
                  );
                  if (result)
                    success(
                      `Подсчёт ${row.locationCode} сохранён. Остатки не изменялись.`,
                    );
                  return result;
                }}
                onRefresh={async (row, revision) => {
                  const result = await commands.refresh(
                    { ...doc, revision },
                    row.locationId,
                  );
                  if (!result) return false;
                  success(
                    `Снимок ${row.locationCode} обновлён. Пересчитайте эту ячейку заново.`,
                  );
                  return true;
                }}
                onSubmit={async () => {
                  const result = await commands.submit(doc);
                  if (!result) return false;
                  success(
                    `${doc.code} передан на проверку. Остатки не изменялись.`,
                  );
                  return true;
                }}
                onApprove={async (reason, revision, openingCompleteSkuIds) => {
                  const result = await commands.approve(
                    { ...doc, revision },
                    reason,
                    openingCompleteSkuIds,
                  );
                  if (!result) return false;
                  ui.showArchive(true);
                  success(
                    `${doc.code} утверждён. Согласованные изменения применены к остаткам.`,
                  );
                  return true;
                }}
                onCancel={async (reason, revision) => {
                  const result = await commands.cancel(
                    { ...doc, revision },
                    reason,
                  );
                  if (!result) return false;
                  ui.showArchive(true);
                  success(
                    `${doc.code} отменён. Подсчёт сохранён в архиве, остатки не изменялись.`,
                  );
                  return true;
                }}
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
