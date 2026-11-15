"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Package, Ellipsis, X } from "lucide-react";
import { useSession } from "@/entities/session";
import { useWorkspace } from "@/entities/workspace";
import { assemblyNeedsClearing, buildWorkQueue } from "@/entities/work-queue";
import { EmployeeAssembly } from "@/features/employee-assembly";
import {
  EmployeePutaway,
  EmployeeReceiving,
  EmployeeMovements,
} from "@/features/employee-handling";
import { EmployeeShipping } from "@/features/employee-shipping";
import { EmployeeStocktakes } from "@/features/stocktakes";
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
  EmployeeScan,
  EmployeeWorkDevice,
  EmployeeDeviceControls,
  useEmployeeScanActivity,
} from "@/shared/ui";
import styles from "./workspace.module.css";
import { EmployeeJobList } from "./employee-job-list";
export function EmployeeWorkspace(props: {
  initialMode?: EmployeeMode;
  initialDocumentId?: string;
  initialShipmentId?: string;
  initialShowJobs?: boolean;
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
  initialShowJobs = false,
}: {
  initialMode?: EmployeeMode;
  initialDocumentId?: string;
  initialShipmentId?: string;
  initialShowJobs?: boolean;
}) {
  const { user } = useSession(),
    workspace = useWorkspace(),
    day = useEmployeeWorkday(initialMode),
    auth = useAuthActions(),
    scan = useEmployeeScanActivity();
  const [menu, setMenu] = useState(false),
    [jobsRequested, setShowJobs] = useState(initialShowJobs),
    [more, setMore] = useState(false),
    [help, setHelp] = useState(false),
    [password, setPassword] = useState(false),
    [notice, setNotice] = useState<string | null>(null),
    [showZoneScan, setShowZoneScan] = useState(false),
    [problem, setProblem] = useState<string | null>(null);
  const [selectedShipmentId, setSelectedShipmentId] =
    useState(initialShipmentId);
  const workPanel = useRef<HTMLDivElement>(null);
  const data = workspace.data,
    employee = data?.employees.find((e) => e.id === user?.employeeId);
  const priority =
    data && user ? employeePriority(data, user.employeeId) : null;
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
        (s) => s.id === previous.jobId && s.status === "shipped",
      )
    )
      complete("Отгрузка завершена.");
    if (
      previous.jobKind === "assembly" &&
      data.tasks.some(
        (t) => t.id === previous.jobId && t.status === "completed",
      )
    )
      complete("Задание сборки завершено.");
    if (
      previous.jobKind === "putaway" &&
      data.putawayTasks.some(
        (t) => t.id === previous.jobId && t.status === "completed",
      )
    )
      complete("Короб размещён на хранение.");
    if (
      previous.jobKind === "receiving" &&
      data.pallets.some(
        (p) => p.id === previous.palletId && p.status === "stored",
      )
    )
      complete("Паллета размещена и зачислена на баланс.");
  }, [data, liveZone?.assignment]);
  const requestedMode: EmployeeMode =
    employee?.status !== "working"
      ? "shift"
      : priority?.carrying
        ? priority.mode
        : day.mode === "shift"
          ? "shift"
          : ((liveZone?.zone.kind as EmployeeMode | undefined) ??
            (day.mode === "stocktakes" || day.mode === "movements"
              ? day.mode
              : (priority?.mode ?? day.mode)));
  const baseBlocked = scan.pending > 0 || scan.unsaved;
  const zones = useEmployeeZone({
    blocked: baseBlocked,
    onProblem: setProblem,
    onStarted: () => {
      day.choose("zone");
      setProblem(null);
      setMenu(false);
      setShowZoneScan(false);
      setShowJobs(false);
      setNotice(null);
    },
  });
  const blocked = baseBlocked || zones.pending;
  const nextDisplay = {
    userId: user?.id,
    mode: requestedMode,
    zone: liveZone,
    key: liveZone
      ? `${liveZone.zone.id}:${liveZone.assignment.jobId}:${liveZone.assignment.palletId}`
      : "manual",
    fullAssembly:
      requestedMode === "assembly" &&
      data?.assemblyPressure?.level === "full" &&
      !data.tasks.some(
        (task) =>
          task.employeeId === user?.employeeId &&
          ["active", "paused"].includes(task.status) &&
          (task.boxCodeConfirmed || task.scannedUnits > 0),
      ),
  };
  const displayed = useRef(nextDisplay);
  if (!blocked || displayed.current.userId !== user?.id)
    displayed.current = nextDisplay;
  const {
    mode,
    zone: currentZone,
    key,
    fullAssembly: assemblyFull,
  } = displayed.current;

  useEffect(() => {
    if (!blocked) return;
    const preventLoss = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [blocked]);
  const choose = async (next: EmployeeMode, confirmed = false) => {
    if (zones.pending || scan.pending || (scan.unsaved && !confirmed))
      return false;
    if (
      (currentZone || (mode === "shipping" && priority?.mode === "shipping")) &&
      !(await zones.leave())
    )
      return false;
    if (confirmed) displayed.current.mode = next;
    day.choose(next);
    setProblem(null);
    day.clearError();
    setMenu(false);
    return true;
  };
  const shift = async (status: "working" | "break" | "off") => {
    if (
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
  const canViewJobs = !!currentZone && !noShift && !showZoneScan;
  const showJobs = jobsRequested && canViewJobs;
  useEffect(() => {
    if (showJobs) return;
    workPanel.current
      ?.querySelector<HTMLInputElement>('input[name="code"]:not(:disabled)')
      ?.focus({ preventScroll: true });
  }, [showJobs]);
  const needsZone =
    !currentZone &&
    !priority?.carrying &&
    ["zone", "assembly", "receiving", "putaway", "shipping"].includes(mode);
  const queueZone =
    currentZone &&
    !currentZone.assignment.jobKind &&
    (currentZone.zone.kind === "assembly" ||
      currentZone.zone.kind === "receiving")
      ? currentZone.zone
      : undefined;
  const zoneJobs =
    data && queueZone
      ? buildWorkQueue(data).filter((job) => {
          if (
            job.kind !== queueZone.kind ||
            job.state !== "queued" ||
            (job.employeeId && job.employeeId !== user?.employeeId)
          )
            return false;
          if (job.kind !== "receiving") return true;
          const source = data.pallets.find(
            (p) => p.id === job.palletId,
          )?.locationId;
          return !source || queueZone.locationIds.includes(source);
        })
      : [];
  const zoneEntry = showZoneScan || needsZone || !!queueZone || assemblyFull;
  const suggestPutaway =
    assemblyFull ||
    (!priority &&
      (!currentZone || currentZone.zone.kind === "assembly") &&
      assemblyNeedsClearing(data?.assemblyPressure));
  const intercept = async (value: string) => {
    if (isWorkZoneScan(value)) return zones.intercept(value);
    if (zoneEntry) {
      setProblem(
        "Нужен QR рабочей зоны с таблички. Код короба или адреса не выбирает работу.",
      );
      return "blocked" as const;
    }
    return "pass" as const;
  };
  const zoneNames: Record<string, string> = {
    receiving: "Приёмка",
    assembly: "Сборка",
    putaway: "Размещение коробов",
    shipping: "Отгрузка",
  };

  const content = (
    <EmployeeScanGateway
      intercept={intercept}
      canIntercept={(value) => isWorkZoneScan(value) || zoneEntry}
    >
      <div className={styles.surface}>
        <a className={styles.skip} href="#employee-main">
          К заданию
        </a>
        <div className={styles.frame}>
          <header className={styles.header}>
            <Link
              href="/work"
              onClick={(event) => {
                if (blocked) event.preventDefault();
              }}
              aria-disabled={blocked}
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
          {canViewJobs && (
            <nav className={styles.workViews} aria-label="Работа сотрудника">
              <button
                type="button"
                aria-pressed={!showJobs}
                onClick={() => setShowJobs(false)}
              >
                Текущая работа
              </button>
              <button
                type="button"
                aria-pressed={showJobs}
                onClick={() => {
                  setShowJobs(true);
                  setMenu(false);
                }}
              >
                Все задания
              </button>
            </nav>
          )}
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
              {noShift && blocked && (
                <button
                  disabled={day.pending || zones.pending}
                  onClick={() => void shift("working")}
                >
                  Возобновить смену
                </button>
              )}
              {!noShift && (
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
              <button onClick={() => setMore(!more)} aria-expanded={more}>
                Другие работы
              </button>
              {more && (
                <div className={styles.submenu}>
                  {(
                    [
                      ["zone", "Сканировать зону"],
                      ["movements", "Перемещения"],
                      ["stocktakes", "Инвентаризация"],
                    ] as [EmployeeMode, string][]
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      disabled={
                        blocked ||
                        (!!priority &&
                          priority.mode !== "shipping" &&
                          priority.mode !== key)
                      }
                      onClick={() => void choose(key)}
                    >
                      {label}
                    </button>
                  ))}
                  {priority && !priority.carrying && (
                    <p>Сначала завершите или приостановите текущее задание.</p>
                  )}
                </div>
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
                  <button disabled={blocked} onClick={() => setPassword(true)}>
                    Сменить пароль
                  </button>
                  <button
                    disabled={auth.pending || blocked}
                    onClick={() => void auth.logout()}
                  >
                    Выйти из учётной записи
                  </button>
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
            {workspace.isError && data && (
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
            {showJobs && data && employee && (
              <EmployeeJobList
                data={data}
                employeeId={employee.id}
                onResume={() => setShowJobs(false)}
                canOpenShipping={
                  !blocked &&
                  !noShift &&
                  (!priority || priority.mode === "shipping")
                }
                shippingZoneOpen={currentZone?.zone.kind === "shipping"}
                onOpenShipping={(shipmentId) => {
                  setSelectedShipmentId(shipmentId);
                  if (currentZone?.zone.kind === "shipping") {
                    setShowZoneScan(false);
                    setShowJobs(false);
                  } else
                    void choose("shipping").then((opened) => {
                      if (opened) setShowJobs(false);
                    });
                }}
                canOpenMovements={
                  !blocked &&
                  !noShift &&
                  !zones.pending &&
                  (!priority || priority.mode === "movements")
                }
                onOpenMovements={() => {
                  if (
                    blocked ||
                    noShift ||
                    zones.pending ||
                    (priority && priority.mode !== "movements")
                  )
                    return;
                  void choose("movements").then((opened) => {
                    if (opened) setShowJobs(false);
                  });
                }}
              />
            )}
            <div ref={workPanel} hidden={showJobs && !!data && !!employee}>
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
              {problem && (
                <div className={styles.warning} role="alert">
                  <p>{problem}</p>
                  <button
                    onClick={() => setProblem(null)}
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
                  {currentZone && (
                    <div className={styles.zoneHeading}>
                      <div>
                        <small>{zoneNames[currentZone.zone.kind]}</small>
                        <strong>{currentZone.zone.name}</strong>
                      </div>
                      <button
                        disabled={blocked}
                        onClick={() => setShowZoneScan((value) => !value)}
                      >
                        {showZoneScan ? "Назад в зону" : "Сменить зону"}
                      </button>
                    </div>
                  )}
                  {!currentZone && !zoneEntry && (
                    <button
                      className={styles.zoneSwitch}
                      disabled={blocked}
                      onClick={() => setShowZoneScan(true)}
                    >
                      Сканировать рабочую зону
                    </button>
                  )}
                  {zoneEntry ? (
                    <section
                      className={styles.zoneEntry}
                      aria-label="Выбор рабочей зоны"
                    >
                      <h2>
                        {suggestPutaway
                          ? data?.assemblyPressure?.boxes
                            ? "Освободите место на сборочной паллете"
                            : "Дождитесь свободного места"
                          : queueZone && !showZoneScan
                            ? zoneJobs.length
                              ? "Задания зоны"
                              : "В этой зоне пока нет заданий"
                            : "Сканируйте QR рабочей зоны"}
                      </h2>
                      <p>
                        {suggestPutaway && data?.assemblyPressure
                          ? `${data.assemblyPressure!.message} ${
                              data.assemblyPressure!.boxes > 0
                                ? "Сканируйте QR зоны размещения, затем любой готовый короб."
                                : "Дождитесь свободного места или сканируйте QR другой рабочей зоны."
                            }`
                          : queueZone && !showZoneScan && zoneJobs.length
                            ? currentZone?.assignment.message
                            : !queueZone || showZoneScan
                              ? "После скана появятся задания этой зоны."
                              : null}
                      </p>
                      {queueZone && !showZoneScan && zoneJobs.length > 0 && (
                        <>
                          <ul className={styles.zoneQueue}>
                            {zoneJobs.map((job) => (
                              <li key={job.id}>
                                <strong>
                                  {job.skuName ?? job.objectLabel}
                                </strong>
                                <small>
                                  {job.quantityLabel}
                                  {job.kind === "receiving"
                                    ? ` · ${job.objectLabel}`
                                    : ""}
                                </small>
                              </li>
                            ))}
                          </ul>
                          <Button
                            disabled={blocked || assemblyFull}
                            onClick={() => void zones.takeNext(queueZone.id)}
                          >
                            {queueZone.kind === "assembly"
                              ? "Взять следующее задание на сборку"
                              : "Взять следующую паллету"}
                          </Button>
                        </>
                      )}
                      {(needsZone ||
                        showZoneScan ||
                        !!queueZone ||
                        assemblyFull) && (
                        <EmployeeScan
                          contextKey={`zone-entry:${user?.id}:${currentZone?.zone.id ?? "idle"}:${showZoneScan}`}
                          label="Сканируйте QR рабочей зоны"
                          disabled={zones.pending}
                          onScan={async () => false}
                          onProblem={setProblem}
                        />
                      )}
                    </section>
                  ) : (
                    <>
                      {mode === "assembly" && (
                        <EmployeeAssembly
                          key={key}
                          data={data}
                          onIdle={() => void choose("putaway")}
                          onProblem={setProblem}
                        />
                      )}
                      {mode === "putaway" && (
                        <EmployeePutaway
                          key={key}
                          data={data}
                          onIdle={() => void choose("assembly")}
                          onProblem={setProblem}
                        />
                      )}
                      {mode === "receiving" && (
                        <EmployeeReceiving
                          key={key}
                          data={data}
                          onIdle={() => void choose("assembly")}
                          onProblem={setProblem}
                        />
                      )}
                      {mode === "movements" && (
                        <EmployeeMovements
                          data={data}
                          onIdle={() => void choose("assembly")}
                          onProblem={setProblem}
                        />
                      )}
                      {mode === "shipping" && (
                        <EmployeeShipping
                          key={key}
                          data={data}
                          shipmentId={selectedShipmentId}
                          onIdle={() => void choose("zone")}
                          onProblem={setProblem}
                        />
                      )}
                      {mode === "stocktakes" && (
                        <EmployeeStocktakes
                          key={initialDocumentId ?? "queue"}
                          initialDocumentId={initialDocumentId}
                          onIdle={() => void choose("assembly", true)}
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
