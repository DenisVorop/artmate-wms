"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
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
  const router = useRouter();
  const ui = useStocktakesState(initialDocumentId);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousDocument = useRef(ui.selectedId);
  useEffect(() => {
    if (previousDocument.current !== ui.selectedId) {
      previousDocument.current = ui.selectedId;
      heading.current?.focus();
    }
  }, [ui.selectedId]);
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
    !!workspace.data &&
    stocktakeLocations(
      workspace.data.locations,
      new Set(
        workspace.data.warehouse.consumables?.map((row) => row.locationId),
      ),
    ).length > 0;
  const busy = !!commands.pending;
  const success = (message: string) => ui.setNotice(message);
  return (
    <div className={styles.feature}>
      <header className={styles.pageHeader}>
        <h1 className="page-heading" ref={heading} tabIndex={-1}>
          Инвентаризация
        </h1>
        {ui.selectedId ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              commands.clearError();
              ui.select("");
              if (initialDocumentId && ui.dirtyRows.size === 0) {
                router.replace("/stocktakes", { scroll: false });
              }
            }}
          >
            <ArrowLeft size={15} aria-hidden="true" />К списку
          </Button>
        ) : (
          isManager && (
            <Button
              disabled={busy || !canCreate}
              aria-haspopup="dialog"
              onClick={() => {
                commands.clearError();
                ui.setCreating(true);
              }}
            >
              <Plus size={15} aria-hidden="true" />
              Новая инвентаризация
            </Button>
          )
        )}
      </header>
      {!ui.selectedId && isManager && workspace.data && !canCreate && (
        <p className={styles.notice}>
          На карте нет адресов для инвентаризации.
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
            success(`${result.code} создан.`);
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
          <h3>Вернуться к списку?</h3>
          <p>Несохранённый подсчёт будет потерян.</p>
          <div className={styles.inlineActions}>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                ui.forceSelect();
                if (initialDocumentId) {
                  router.replace("/stocktakes", { scroll: false });
                }
              }}
            >
              Выйти без сохранения
            </Button>
            <Button
              variant="ghost"
              onClick={() => ui.setPendingSelection(null)}
            >
              Остаться
            </Button>
          </div>
        </div>
      )}
      {!ui.selectedId ? (
        <div className={styles.detail}>
          {listQuery.isError && list && (
            <div role="alert" className={styles.error}>
              Не удалось обновить список.
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
              pending={listQuery.isFetching || busy}
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
        </div>
      ) : (
        <section className={styles.detail} aria-label="Документ инвентаризации">
          {docQuery.isPending ? (
            <LoadingState label="Загружаем ячейки документа…" />
          ) : !doc ? (
            <ErrorState
              message="Не удалось открыть документ."
              onRetry={() => void docQuery.refetch()}
            />
          ) : (
            <>
              {docQuery.isError && (
                <div className={styles.error} role="alert">
                  Не удалось обновить документ. Показана последняя версия.
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
                  success(`${doc.code} взят в работу.`);
                  return true;
                }}
                onCount={async (row, values, revision) => {
                  const result = await commands.count(
                    doc,
                    row.locationId,
                    values,
                    revision,
                  );
                  if (result) success(`Подсчёт ${row.locationCode} сохранён.`);
                  return result;
                }}
                onRefresh={async (row, revision) => {
                  const result = await commands.refresh(
                    { ...doc, revision },
                    row.locationId,
                  );
                  if (!result) return false;
                  success(`Пересчитайте ${row.locationCode} заново.`);
                  return true;
                }}
                onSubmit={async () => {
                  const result = await commands.submit(doc);
                  if (!result) return false;
                  success(`${doc.code} передан на проверку.`);
                  return true;
                }}
                onApprove={async (reason, revision) => {
                  const result = await commands.approve(
                    { ...doc, revision },
                    reason,
                  );
                  if (!result) return false;
                  ui.showArchive(true);
                  success(`${doc.code} утверждён. Остатки обновлены.`);
                  return true;
                }}
                onCancel={async (reason, revision) => {
                  const result = await commands.cancel(
                    { ...doc, revision },
                    reason,
                  );
                  if (!result) return false;
                  ui.showArchive(true);
                  success(`${doc.code} отменён.`);
                  return true;
                }}
              />
            </>
          )}
        </section>
      )}
    </div>
  );
}
