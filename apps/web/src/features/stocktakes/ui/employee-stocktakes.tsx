"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowLeft, ClipboardCheck } from "lucide-react";
import { useSession } from "@/entities/session";
import { useWorkspace } from "@/entities/workspace";
import { useStocktake, useStocktakes } from "@/entities/stocktake";
import {
  Badge,
  Button,
  ErrorState,
  LoadingState,
  useEmployeeScanActivity,
} from "@/shared/ui";
import {
  employeeStocktakeJobs,
  employeeStocktakeNextRow,
  employeeStocktakeCanLeave,
  lastCountedStocktakeRow,
} from "../lib/employee-stocktakes";
import { stocktakeWalk } from "@/entities/warehouse-map";
import { useStocktakesState } from "../lib/use-stocktakes-state";
import { useStocktakeCommands } from "../model/use-stocktake-commands";
import { StocktakeRow } from "./stocktake-row";
import styles from "./stocktakes.module.css";
type Destination =
  | { kind: "idle" }
  | { kind: "document"; id: string }
  | { kind: "row"; id: string };
export function EmployeeStocktakes({
  initialDocumentId,
  onIdle,
  onProblem,
}: {
  initialDocumentId?: string;
  onIdle: () => void;
  onProblem?: (message: string) => void;
}) {
  const { user } = useSession(),
    workspace = useWorkspace(),
    ui = useStocktakesState(initialDocumentId),
    commands = useStocktakeCommands();
  const [rowId, setRowId] = useState<string | null>(null),
    [reviewRow, setReviewRow] = useState(false),
    [destination, setDestination] = useState<Destination | null>(null);
  const listQuery = useStocktakes({
      bucket: "active",
      page: ui.page,
      pageSize: 100,
    }),
    docQuery = useStocktake(ui.selectedId),
    doc = docQuery.data;
  const working =
      workspace.data?.employees.find((e) => e.id === user?.employeeId)
        ?.status === "working",
    busy = !!commands.pending;
  const activity = useEmployeeScanActivity(),
    activityId = useId();
  const hasUnsavedWork = busy || ui.dirtyRows.size > 0;
  useEffect(() => {
    activity.reportUnsaved(activityId, hasUnsavedWork);
    return () => activity.reportUnsaved(activityId, false);
  }, [activity.reportUnsaved, activityId, hasUnsavedWork]);
  const jobs = employeeStocktakeJobs(
    listQuery.isPlaceholderData ? [] : (listQuery.data?.items ?? []),
    user?.employeeId ?? "",
  );
  const selected =
    doc && doc.id === ui.selectedId && doc.employeeId === user?.employeeId;
  const rows = useMemo(
    () => stocktakeWalk(doc?.rows ?? [], workspace.data),
    [doc?.rows, workspace.data],
  );
  const nextRow = (
    source: typeof rows,
    afterId = lastCountedStocktakeRow(source),
  ) =>
    employeeStocktakeNextRow(
      { rows: stocktakeWalk(source, workspace.data, afterId) },
      afterId,
    );
  const effectiveRowId = rowId ?? (doc ? nextRow(doc.rows) : ""),
    row = rows.find((r) => r.locationId === effectiveRowId);
  useEffect(() => {
    if (doc && workspace.data && rowId === null) setRowId(effectiveRowId);
  }, [doc, rowId, effectiveRowId, workspace.data]);
  const problemRef = useRef(onProblem);
  problemRef.current = onProblem;
  useEffect(() => {
    if (commands.error) problemRef.current?.(commands.error);
  }, [commands.error]);
  const navigate = (next: Destination) => {
    if (!employeeStocktakeCanLeave(ui.dirtyRows)) {
      setDestination(next);
      return;
    }
    applyNavigation(next);
  };
  const applyNavigation = (next: Destination) => {
    commands.clearError();
    ui.setNotice(null);
    setReviewRow(false);
    setRowId(null);
    if (next.kind === "idle") onIdle();
    else if (next.kind === "document") ui.setSelectedId(next.id);
    else {
      setRowId(next.id);
      setReviewRow(true);
    }
    setDestination(null);
  };
  return (
    <div className={styles.employeeFeature}>
      <header className={styles.employeeHeader}>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => navigate({ kind: "idle" })}
        >
          <ArrowLeft size={16} />К работе
        </Button>
        <h2>
          {doc?.mode === "opening"
            ? "Первичная инвентаризация"
            : "Пересчёт ячеек"}
        </h2>
      </header>
      {destination && (
        <div className={styles.confirm} role="alert">
          <strong>Есть несохранённый подсчёт</strong>
          <p>
            При переходе этот ввод будет очищен. Сохранённые результаты
            останутся в документе.
          </p>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              ui.dirtyRows.forEach((id) => ui.setRowDirty(id, false));
              applyNavigation(destination);
            }}
          >
            Перейти и очистить ввод
          </Button>
          <Button variant="ghost" onClick={() => setDestination(null)}>
            Остаться у ячейки
          </Button>
        </div>
      )}
      {ui.notice && (
        <div className={styles.success} role="status">
          {ui.notice}
        </div>
      )}
      {!working && (
        <p className={styles.notice}>
          Начните или возобновите смену на рабочем экране, чтобы считать ячейки.
        </p>
      )}
      {!ui.selectedId ? (
        <>
          {listQuery.isPending ? (
            <LoadingState label="Загружаем пересчёты…" />
          ) : listQuery.isError ? (
            <ErrorState
              message="Не удалось загрузить документы пересчёта."
              onRetry={() => void listQuery.refetch()}
            />
          ) : (
            <>
              {!jobs.length ? (
                <div className={`glass-panel ${styles.employeeEmpty}`}>
                  <ClipboardCheck size={28} />
                  <h3>Пересчётов пока нет</h3>
                  <p>Когда руководитель создаст документ, он появится здесь.</p>
                  <Button
                    disabled={busy}
                    onClick={() => navigate({ kind: "idle" })}
                  >
                    К другим заданиям
                  </Button>
                </div>
              ) : (
                <div className={styles.employeeJobs}>
                  {jobs.map((job) => (
                    <button
                      type="button"
                      className={styles.document}
                      key={job.id}
                      onClick={() => navigate({ kind: "document", id: job.id })}
                    >
                      <div className={styles.documentTop}>
                        <strong>{job.code}</strong>
                        <Badge
                          tone={job.status === "review" ? "warning" : "neutral"}
                        >
                          {job.status === "counting"
                            ? "Ваша работа"
                            : job.status === "review"
                              ? "На проверке"
                              : "Свободен"}
                        </Badge>
                      </div>
                      <span>
                        {job.locationsCounted} из {job.locationsTotal} ячеек
                      </span>
                      <small>
                        {job.status === "queued"
                          ? "Открыть и взять в работу"
                          : job.status === "review"
                            ? "Ожидает решения руководителя"
                            : "Продолжить пересчёт"}
                      </small>
                    </button>
                  ))}
                </div>
              )}
              {(listQuery.data?.total ?? 0) > 100 && (
                <div className={styles.inlineActions}>
                  <Button
                    variant="secondary"
                    disabled={ui.page === 1}
                    onClick={() => ui.setPage((p) => p - 1)}
                  >
                    Назад
                  </Button>
                  <span>Страница {ui.page}</span>
                  <Button
                    variant="secondary"
                    disabled={ui.page * 100 >= (listQuery.data?.total ?? 0)}
                    onClick={() => ui.setPage((p) => p + 1)}
                  >
                    Далее
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      ) : docQuery.isPending ? (
        <LoadingState label="Открываем ячейки…" />
      ) : !doc ? (
        <ErrorState
          message="Документ недоступен. Обновите данные или вернитесь к работе."
          onRetry={() => void docQuery.refetch()}
        />
      ) : (
        <>
          {docQuery.isError && (
            <div className={styles.notice} role="status">
              Не удалось обновить документ. Ввод сохранён на экране.{" "}
              <Button
                variant="secondary"
                onClick={() => void docQuery.refetch()}
              >
                Обновить
              </Button>
            </div>
          )}
          <section className={`glass-panel ${styles.employeeSummary}`}>
            <div>
              <strong>{doc.code}</strong>
              <p>
                {doc.locationsCounted} из {doc.locationsTotal} ячеек пересчитано
              </p>
            </div>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => navigate({ kind: "document", id: "" })}
            >
              Другой документ
            </Button>
          </section>
          {commands.error && (
            <div className={styles.error} role="alert">
              {commands.error}
            </div>
          )}
          {doc.status === "queued" ? (
            <section className={`glass-panel ${styles.employeeEmpty}`}>
              <h3>Пересчитать {doc.locationsTotal} ячеек</h3>
              <p>
                Подойдите к каждому адресу и введите фактически найденный товар.
                Результат проверит руководитель.
              </p>
              <Button
                disabled={busy || !working || !doc.canClaim}
                aria-busy={busy}
                onClick={async () => {
                  const result = await commands.claim(doc);
                  if (result) {
                    setRowId(null);
                    ui.setNotice("Документ взят. Начните с указанной ячейки.");
                  }
                }}
              >
                Взять документ в работу
              </Button>
            </section>
          ) : !selected || ["approved", "cancelled"].includes(doc.status) ? (
            <p className={styles.notice}>
              Документ завершён или сейчас недоступен для вашего подсчёта.
            </p>
          ) : doc.status === "review" ? (
            <section className={`glass-panel ${styles.employeeEmpty}`}>
              <ClipboardCheck size={28} />
              <h3>Передано на проверку</h3>
              <p>
                Руководитель проверит результаты. Остатки изменятся после его
                утверждения.
              </p>
              <Button
                disabled={busy}
                onClick={() => navigate({ kind: "idle" })}
              >
                К другим заданиям
              </Button>
              <details>
                <summary>Нужен повторный подсчёт?</summary>
                <p>
                  Откройте нужную ячейку и обновите её снимок. Прежний результат
                  останется в истории.
                </p>
                <div className={styles.employeeCells}>
                  {rows.map((r) => (
                    <Button
                      key={r.locationId}
                      variant="secondary"
                      onClick={() =>
                        navigate({ kind: "row", id: r.locationId })
                      }
                    >
                      {r.locationCode}
                    </Button>
                  ))}
                </div>
              </details>
            </section>
          ) : null}
          {((selected &&
            (doc.status === "counting" ||
              (doc.status === "review" && reviewRow))) ||
            ui.dirtyRows.size > 0) && (
            <>
              {doc.rows.length > 1 && (
                <label className={styles.employeeCellChoice}>
                  Ячейка
                  <select
                    value={effectiveRowId}
                    disabled={busy}
                    onChange={(e) =>
                      navigate({ kind: "row", id: e.target.value })
                    }
                  >
                    <option value="">Выбрать ячейку</option>
                    {rows.map((r) => (
                      <option key={r.locationId} value={r.locationId}>
                        {r.locationCode} ·{" "}
                        {r.stale
                          ? "нужен пересчёт"
                          : r.busyReasons.length
                            ? "занята"
                            : r.count
                              ? "сохранено"
                              : "не пересчитана"}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {row && (
                <>
                  {!!doc.preview.issues.filter(
                    (i) =>
                      i.locationIds.includes(row.locationId) &&
                      !["NOT_COUNTED", "STALE", "BUSY"].includes(i.code),
                  ).length && (
                    <div className={styles.notice}>
                      <strong>Проверьте введённые коды</strong>
                      {doc.preview.issues
                        .filter(
                          (i) =>
                            i.locationIds.includes(row.locationId) &&
                            !["NOT_COUNTED", "STALE", "BUSY"].includes(i.code),
                        )
                        .map((i, index) => (
                          <p key={`${i.code}-${index}`}>{i.message}</p>
                        ))}
                    </div>
                  )}
                  <StocktakeRow
                    key={`${doc.id}:${row.locationId}`}
                    compact
                    preserveDraft={ui.dirtyRows.has(row.locationId)}
                    doc={doc}
                    data={workspace.data}
                    row={row}
                    own={!!selected}
                    working={!!working}
                    pending={busy}
                    error={null}
                    dirty={ui.dirtyRows.has(row.locationId)}
                    onDirty={ui.setRowDirty}
                    onCount={async (r, values, revision) => {
                      const result = await commands.count(
                        doc,
                        r.locationId,
                        values,
                        revision,
                      );
                      if (result) {
                        ui.setRowDirty(r.locationId, false);
                        setRowId(nextRow(result.rows, r.locationId));
                        setReviewRow(false);
                        ui.setNotice(`Ячейка ${r.locationCode} сохранена.`);
                      }
                      return result;
                    }}
                    onRefresh={async (r, revision) => {
                      const result = await commands.refresh(
                        { ...doc, revision },
                        r.locationId,
                      );
                      if (!result) return false;
                      ui.setNotice(
                        "Снимок обновлён. Осмотрите ячейку и пересчитайте заново.",
                      );
                      return true;
                    }}
                  />
                </>
              )}
              {!row && doc.status === "counting" && (
                <section className={`glass-panel ${styles.employeeEmpty}`}>
                  <ClipboardCheck size={28} />
                  <h3>Все ячейки пересчитаны</h3>
                  {doc.preview.issues.some(
                    (i) => !["NOT_COUNTED", "STALE", "BUSY"].includes(i.code),
                  ) && (
                    <div className={styles.notice}>
                      <strong>Есть коды для проверки</strong>
                      <p>
                        Если код введён ошибочно, выберите ячейку выше и
                        исправьте подсчёт. Фактически найденные неизвестные коды
                        передайте руководителю вместе с документом.
                      </p>
                    </div>
                  )}
                  <p>
                    Передайте документ руководителю. Он проверит найденные
                    расхождения.
                  </p>
                  <Button
                    disabled={busy || !doc.canSubmit || ui.dirtyRows.size > 0}
                    aria-busy={busy}
                    onClick={async () => {
                      const result = await commands.submit(doc);
                      if (result) {
                        ui.setNotice("Результаты переданы руководителю.");
                        setRowId("");
                      }
                    }}
                  >
                    Передать на проверку
                  </Button>
                </section>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
