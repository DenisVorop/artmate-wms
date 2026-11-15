"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Package, Ellipsis, X } from "lucide-react";
import { useSession } from "@/entities/session";
import type {
  MovementDto,
  StocktakeSummaryDto,
  ZoneOfferDto,
} from "@/shared/api/generated/model";
import { useWarehouseCommands } from "@/shared/api/use-warehouse-commands";
import { useWorkspace } from "@/entities/workspace";
import { EmployeeAssembly } from "@/features/employee-assembly";
import {
  EmployeePutaway,
  EmployeeReceiving,
  EmployeeMovements,
  employeeMovementJobs,
  movementClaimBlock,
} from "@/features/employee-handling";
import { EmployeeShipping } from "@/features/employee-shipping";
import {
  EmployeeStocktakes,
  useStocktakeCommands,
} from "@/features/stocktakes";
import {
  EmployeeShift,
  useEmployeeWorkday,
  employeePriority,
  useEmployeeZone,
  ownZoneWork,
  isWorkZoneScan,
  type EmployeeMode,
} from "@/features/employee-workday";
import { useAuthActions, ChangePasswordModal } from "@/features/auth";
import {
  Button,
  EmployeeScanBoundary,
  EmployeeScanGateway,
  EmployeeWorkDevice,
  EmployeeDeviceControls,
  useEmployeeScanActivity,
} from "@/shared/ui";
import styles from "./workspace.module.css";
import { EmployeeZoneGuide } from "./employee-zone-guide";
export function EmployeeWorkspace(props: {
  initialMode?: EmployeeMode;
  initialDocumentId?: string;
  initialShipmentId?: string;
}) {
  return (
    <EmployeeScanBoundary>
      <EmployeeWorkspaceBody {...props} />
    </EmployeeScanBoundary>
  );
}
function EmployeeWorkspaceBody({
  initialMode = "zone",
  initialDocumentId,
  initialShipmentId,
}: {
  initialMode?: EmployeeMode;
  initialDocumentId?: string;
  initialShipmentId?: string;
}) {
  const { user } = useSession(),
    workspace = useWorkspace(),
    day = useEmployeeWorkday(
      initialMode === "movements" ||
        (initialMode === "stocktakes" && !initialDocumentId)
        ? "zone"
        : initialMode,
    ),
    movementCommands = useWarehouseCommands(),
    stocktakeCommands = useStocktakeCommands(),
    auth = useAuthActions(),
    scan = useEmployeeScanActivity();
  const [menu, setMenu] = useState(false),
    [help, setHelp] = useState(false),
    [password, setPassword] = useState(false),
    [notice, setNotice] = useState<string | null>(null),
    [showZoneScan, setShowZoneScan] = useState(false),
    [movementId, setMovementId] = useState<string | null>(null),
    [selectedStocktakeId, setSelectedStocktakeId] = useState<string>(),
    [problem, setProblem] = useState<string | null>(null);
  const stocktakeId = selectedStocktakeId ?? initialDocumentId;
  const data = workspace.data,
    employee = data?.employees.find((e) => e.id === user?.employeeId);
  const priority =
    data && user ? employeePriority(data, user.employeeId) : null;
  const jobOpening = useRef(false);
  const movements = employeeMovementJobs(
    data?.movements ?? [],
    user?.employeeId ?? "",
  );
  const movement =
    movements.find((row) => row.status === "in_transit") ??
    data?.movements.find(
      (row) => row.id === movementId && row.employeeId === user?.employeeId,
    );
  const liveZone = ownZoneWork(data, user?.employeeId);
  const previousJob = useRef(liveZone?.assignment);
  useEffect(() => {
    const previous = previousJob.current,
      next = liveZone?.assignment;
    previousJob.current = next;
    if (
      !previous?.jobId ||
      !data ||
      (previous.jobId === next?.jobId && previous.palletId === next?.palletId)
    )
      return;
    const complete = (message: string) => {
      setNotice(message);
      setProblem((current) =>
        current?.startsWith("Сначала ") ? null : current,
      );
    };
    if (
      previous.jobKind === "shipping" &&
      data.shipments.some(
        (s) =>
          s.id === previous.jobId &&
          (s.status === "shipped" ||
            (s.boxIds.length > 0 &&
              s.boxIds.every((id) => s.scannedBoxIds?.includes(id)))),
      )
    )
      complete("Отбор завершён.");
    if (
      previous.jobKind === "assembly" &&
      data.tasks.some(
        (t) => t.id === previous.jobId && t.status === "completed",
      )
    )
      complete("Короб собран.");
    if (
      previous.jobKind === "putaway" &&
      data.putawayTasks.some(
        (t) => t.id === previous.jobId && t.status === "completed",
      )
    ) {
      complete("Короб размещён на хранение.");
    }
    if (
      previous.jobKind === "receiving" &&
      data.pallets.some(
        (p) => p.id === previous.palletId && p.status === "stored",
      )
    )
      complete("Паллета на месте.");
  }, [data, liveZone?.assignment]);
  const requestedMode: EmployeeMode =
    employee?.status !== "working"
      ? "shift"
      : priority?.carrying
        ? priority.mode
        : day.mode === "shift"
          ? "shift"
          : ((liveZone?.zone.kind as EmployeeMode | undefined) ?? day.mode);
  const baseBlocked = scan.pending > 0 || scan.unsaved;
  const zones = useEmployeeZone({
    blocked: baseBlocked,
    onProblem: setProblem,
    onStarted: () => {
      day.choose("zone");
      setProblem(null);
      setMenu(false);
      setShowZoneScan(false);
      setNotice(null);
    },
  });
  const blocked =
    baseBlocked ||
    zones.pending ||
    movementCommands.pending ||
    !!stocktakeCommands.pending;
  const stocktakeBlocked = !!priority && priority.mode !== "shipping";
  const nextDisplay = {
    userId: user?.id,
    mode: requestedMode,
    zone: liveZone,
    key: liveZone
      ? `${liveZone.zone.id}:${liveZone.assignment.jobId}:${liveZone.assignment.palletId}`
      : "manual",
  };
  const displayed = useRef(nextDisplay);
  if (!blocked || displayed.current.userId !== user?.id)
    displayed.current = nextDisplay;
  const { mode, zone: currentZone, key } = displayed.current;
  const jobLocked =
    !!(currentZone?.assignment.locked && currentZone.assignment.jobId) ||
    (mode === "movements" &&
      (movement?.status === "planned" || movement?.status === "in_transit"));

  useEffect(() => {
    if (!blocked) return;
    const preventLoss = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [blocked]);
  const choose = async (next: EmployeeMode, confirmed = false) => {
    if (
      jobLocked ||
      jobOpening.current ||
      zones.pending ||
      scan.pending ||
      (scan.unsaved && !confirmed)
    )
      return false;
    if (
      (currentZone || (mode === "shipping" && priority?.mode === "shipping")) &&
      !(await zones.leave())
    )
      return false;
    if (confirmed) displayed.current.mode = next;
    day.choose(next);
    setMovementId(null);
    setSelectedStocktakeId(undefined);
    setShowZoneScan(false);
    setProblem(null);
    day.clearError();
    setMenu(false);
    return true;
  };
  const shift = async (status: "working" | "break" | "off") => {
    if (
      jobLocked ||
      jobOpening.current ||
      zones.pending ||
      (scan.pending > 0 && status !== "working") ||
      (scan.unsaved && status !== "working") ||
      priority?.carrying
    )
      return;
    const ok = await day.setShift(status);
    if (ok) {
      day.choose(status === "working" ? "zone" : "shift");
      setMenu(false);
      setProblem(null);
    }
  };
  const noShift = employee?.status !== "working";
  const needsZone =
    !currentZone &&
    !priority?.carrying &&
    ["zone", "assembly", "receiving", "putaway", "shipping"].includes(mode);
  const zoneEntry =
    !jobLocked &&
    (showZoneScan ||
      needsZone ||
      (!!currentZone &&
        !currentZone.assignment.jobKind &&
        !priority?.carrying));
  const takeOffer = async (offer: ZoneOfferDto) => {
    if (
      currentZone?.zone.id !== offer.zoneId ||
      blocked ||
      jobLocked ||
      jobOpening.current
    )
      return;
    if ((await zones.takeJob(offer)) !== "handled") void workspace.refetch();
  };
  const openMovement = async (selected: MovementDto) => {
    if (!user || !data || blocked || jobLocked || jobOpening.current) return;
    if (!selected.employeeId) {
      const reason = movementClaimBlock(data, user.employeeId, selected.id);
      if (reason) {
        setProblem(reason);
        return;
      }
    }
    jobOpening.current = true;
    setProblem(null);
    try {
      if (currentZone && !(await zones.leave())) return;
      if (!selected.employeeId) {
        await movementCommands.claimMovement(selected.id, {
          employeeId: user.employeeId,
          requestId: crypto.randomUUID(),
        });
      }
      setMovementId(selected.id);
      setShowZoneScan(false);
      setNotice(null);
      setMenu(false);
      day.choose("movements");
    } catch (error) {
      setProblem(
        error instanceof Error
          ? error.message
          : "Не удалось взять перемещение.",
      );
      void workspace.refetch();
    } finally {
      jobOpening.current = false;
    }
  };
  const openStocktake = async (selected: StocktakeSummaryDto) => {
    if (blocked || jobLocked || jobOpening.current || stocktakeBlocked) return;
    jobOpening.current = true;
    setProblem(null);
    try {
      if (currentZone && !(await zones.leave())) return;
      if (
        selected.status === "queued" &&
        !(await stocktakeCommands.claim(selected))
      )
        return;
      setSelectedStocktakeId(selected.id);
      setShowZoneScan(false);
      setNotice(null);
      setMenu(false);
      day.choose("stocktakes");
    } finally {
      jobOpening.current = false;
    }
  };
  const intercept = async (value: string) => {
    if (isWorkZoneScan(value)) {
      if (jobLocked || jobOpening.current) {
        setProblem("Сначала закончите текущее задание.");
        return "blocked" as const;
      }
      return zones.intercept(value);
    }
    if (zoneEntry) {
      setProblem("Сканируйте QR рабочей зоны.");
      return "blocked" as const;
    }
    return "pass" as const;
  };
  const content = (
    <EmployeeScanGateway
      intercept={intercept}
      canIntercept={(value) => isWorkZoneScan(value) || zoneEntry}
    >
      <div className={styles.surface} data-employee-work>
        <a className={styles.skip} href="#employee-main">
          К заданию
        </a>
        <div className={styles.frame}>
          <header className={styles.header}>
            <Link
              href="/work"
              onClick={(event) => {
                if (blocked || jobLocked) event.preventDefault();
              }}
              aria-disabled={blocked || jobLocked}
              className={styles.brand}
              aria-label="Моё рабочее место"
            >
              <Package size={23} />
              <span>
                artmate<small>МОЯ РАБОТА</small>
              </span>
            </Link>
            <button
              className={styles.menuButton}
              onClick={() => setMenu(!menu)}
              aria-expanded={menu}
              aria-controls="employee-menu"
              aria-label={
                menu ? "Закрыть меню сотрудника" : "Открыть меню сотрудника"
              }
            >
              {menu ? <X /> : <Ellipsis />}
            </button>
          </header>
          {!menu && <EmployeeDeviceControls />}
          {menu && (
            <section
              id="employee-menu"
              className={styles.menu}
              aria-label="Меню сотрудника"
            >
              <p className={styles.person}>{user?.name}</p>
              <EmployeeDeviceControls details />
              {scan.pending > 0 && (
                <p role="status">
                  Сначала дождитесь сохранения сканов или исправьте непринятый
                  код.
                </p>
              )}
              {scan.unsaved && (
                <p role="status">
                  Сначала сохраните подсчёт или вернитесь кнопкой «К работе».
                </p>
              )}
              {noShift && blocked && !jobLocked && (
                <button
                  disabled={day.pending || zones.pending}
                  onClick={() => void shift("working")}
                >
                  Возобновить смену
                </button>
              )}
              {!noShift && !jobLocked && (
                <>
                  <button
                    onClick={() => void shift("break")}
                    disabled={day.pending || blocked || priority?.carrying}
                  >
                    Перерыв
                  </button>
                  <button
                    onClick={() => void shift("off")}
                    disabled={day.pending || blocked || priority?.carrying}
                  >
                    Завершить смену
                  </button>
                </>
              )}
              {priority?.carrying && (
                <p>Сначала поставьте переносимый товар на адрес.</p>
              )}
              <button onClick={() => setHelp(!help)} aria-expanded={help}>
                Помощь
              </button>
              {help && (
                <div className={styles.submenu}>
                  <p>
                    Код не читается? Откройте ручной ввод под полем сканера.
                    Если товар не совпадает или возникла другая проблема —
                    позовите руководителя.
                  </p>
                  {!jobLocked && (
                    <>
                      <Link
                        href="/warehouse"
                        aria-disabled={blocked}
                        onClick={(event) => {
                          if (blocked) event.preventDefault();
                        }}
                      >
                        Карта склада
                      </Link>
                      <Link
                        href="/performance"
                        aria-disabled={blocked}
                        onClick={(event) => {
                          if (blocked) event.preventDefault();
                        }}
                      >
                        Мой результат
                      </Link>
                      <button
                        disabled={blocked}
                        onClick={() => setPassword(true)}
                      >
                        Сменить пароль
                      </button>
                      <button
                        disabled={auth.pending || blocked || jobLocked}
                        onClick={() => void auth.logout()}
                      >
                        Выйти из учётной записи
                      </button>
                    </>
                  )}
                </div>
              )}
              {day.error && (
                <p className={styles.error} role="alert">
                  {day.error}
                </p>
              )}
              {auth.error && (
                <p className={styles.error} role="alert">
                  {auth.error}
                </p>
              )}
            </section>
          )}
          <main id="employee-main" className={styles.main}>
            {workspace.isError && data && !zoneEntry && (
              <div className={styles.warning} role="status">
                <p>
                  Связь со складом нестабильна. Показаны последние загруженные
                  данные.
                </p>
                <button onClick={() => void workspace.refetch()}>
                  Обновить
                </button>
              </div>
            )}
            <div>
              {mode !== "shift" && (
                <h1 className={styles.srOnly}>Моё рабочее место</h1>
              )}
              {blocked && requestedMode !== mode && (
                <div className={styles.warning} role="status">
                  <p>
                    Рабочие условия изменились. Ввод сохранён на экране.{" "}
                    {noShift
                      ? "Возобновите смену через меню."
                      : "Закончите текущий шаг перед переходом."}
                  </p>
                </div>
              )}
              {notice && (
                <div className={styles.completion} role="status">
                  <span>{notice}</span>
                  <button
                    onClick={() => setNotice(null)}
                    aria-label="Скрыть подтверждение"
                  >
                    <X size={17} />
                  </button>
                </div>
              )}
              {(problem || stocktakeCommands.error) && (
                <div className={styles.warning} role="alert">
                  <p>{problem || stocktakeCommands.error}</p>
                  <button
                    onClick={() => {
                      setProblem(null);
                      stocktakeCommands.clearError();
                    }}
                    aria-label="Скрыть сообщение"
                  >
                    <X size={17} />
                  </button>
                </div>
              )}
              {!data ? (
                <section className={styles.state}>
                  <h1>
                    {workspace.isError
                      ? "Нет связи со складом"
                      : "Открываем задание…"}
                  </h1>
                  {workspace.isError && (
                    <Button onClick={() => void workspace.refetch()}>
                      Повторить загрузку
                    </Button>
                  )}
                </section>
              ) : !employee ? (
                <section className={styles.state}>
                  <h1>Профиль сотрудника недоступен</h1>
                  <p>Обратитесь к руководителю.</p>
                </section>
              ) : mode === "shift" ? (
                <EmployeeShift
                  employee={employee}
                  pending={day.pending}
                  error={day.error}
                  onStart={() => void shift("working")}
                  onWork={() => void choose("zone")}
                />
              ) : (
                <>
                  {currentZone && !zoneEntry && (
                    <div className={styles.zoneHeading}>
                      <strong>{currentZone.zone.name}</strong>
                      {!jobLocked && (
                        <button
                          disabled={blocked}
                          onClick={() => setShowZoneScan(true)}
                        >
                          Сменить зону
                        </button>
                      )}
                    </div>
                  )}
                  {currentZone && showZoneScan && (
                    <button
                      className={styles.zoneSwitch}
                      disabled={blocked}
                      onClick={() => setShowZoneScan(false)}
                    >
                      Назад
                    </button>
                  )}
                  {!currentZone &&
                    !zoneEntry &&
                    !jobLocked &&
                    mode !== "stocktakes" && (
                      <button
                        className={styles.zoneSwitch}
                        disabled={blocked}
                        onClick={() => setShowZoneScan(true)}
                      >
                        Сканировать рабочую зону
                      </button>
                    )}
                  {zoneEntry ? (
                    <EmployeeZoneGuide
                      data={data}
                      zone={showZoneScan ? undefined : currentZone?.zone}
                      movements={movements}
                      employeeId={employee.id}
                      stocktakeBlocked={stocktakeBlocked}
                      blocked={blocked}
                      failed={workspace.isError}
                      onRetry={() => void workspace.refetch()}
                      onTake={(offer) => void takeOffer(offer)}
                      onMovement={(selected) => void openMovement(selected)}
                      onStocktake={(selected) => void openStocktake(selected)}
                      onClearZone={() => void choose("zone")}
                      onProblem={setProblem}
                    />
                  ) : (
                    <>
                      {mode === "assembly" && (
                        <EmployeeAssembly
                          key={key}
                          data={data}
                          locked={jobLocked}
                          onIdle={() => void choose("putaway")}
                          onProblem={setProblem}
                        />
                      )}
                      {mode === "putaway" && (
                        <EmployeePutaway
                          key={key}
                          data={data}
                          locked={jobLocked}
                          onIdle={() => void choose("assembly")}
                          onProblem={setProblem}
                        />
                      )}
                      {mode === "receiving" && (
                        <EmployeeReceiving
                          key={key}
                          data={data}
                          locked={jobLocked}
                          onIdle={() => void choose("assembly")}
                          onProblem={setProblem}
                        />
                      )}
                      {mode === "movements" && (
                        <EmployeeMovements
                          data={data}
                          movement={movement}
                          locked={jobLocked}
                          onIdle={() => void choose("zone")}
                          onProblem={setProblem}
                        />
                      )}
                      {mode === "shipping" && (
                        <EmployeeShipping
                          key={key}
                          data={data}
                          locked={jobLocked}
                          shipmentId={
                            currentZone?.assignment.jobKind === "shipping"
                              ? (currentZone.assignment.jobId ?? undefined)
                              : initialShipmentId
                          }
                          onQueue={() => {
                            if (currentZone)
                              void zones.showOffer(currentZone.zone.id);
                          }}
                          onIdle={() => void choose("zone")}
                          onProblem={setProblem}
                        />
                      )}
                      {mode === "stocktakes" && stocktakeId && (
                        <EmployeeStocktakes
                          key={stocktakeId}
                          documentId={stocktakeId}
                          onIdle={() => void choose("zone", true)}
                          onProblem={setProblem}
                        />
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </main>
          <footer className={styles.footer}>
            <span
              className={workspace.isError ? styles.offline : styles.online}
            />
            {workspace.isError ? "Проверьте соединение" : "Склад онлайн"}
          </footer>
        </div>
        <ChangePasswordModal
          open={password}
          onClose={() => setPassword(false)}
        />
      </div>
    </EmployeeScanGateway>
  );
  return (
    <EmployeeWorkDevice active={!noShift} sessionKey={user?.id}>
      {content}
    </EmployeeWorkDevice>
  );
}
