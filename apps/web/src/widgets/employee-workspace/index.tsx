"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Package, Ellipsis, X } from "lucide-react";
import { useSession } from "@/entities/session";
import { useWorkspace } from "@/entities/workspace";
import { EmployeeAssembly } from "@/features/employee-assembly";
import {
  EmployeePutaway,
  EmployeeReceiving,
  EmployeeMovements,
} from "@/features/employee-handling";
import { EmployeeStocktakes } from "@/features/stocktakes";
import {
  EmployeeShift,
  useEmployeeWorkday,
  employeePriority,
  type EmployeeMode,
} from "@/features/employee-workday";
import { useAuthActions, ChangePasswordModal } from "@/features/auth";
import {
  Button,
  EmployeeScanBoundary,
  useEmployeeScanActivity,
} from "@/shared/ui";
import styles from "./workspace.module.css";
export function EmployeeWorkspace(props: {
  initialMode?: EmployeeMode;
  initialDocumentId?: string;
}) {
  return (
    <EmployeeScanBoundary>
      <EmployeeWorkspaceBody {...props} />
    </EmployeeScanBoundary>
  );
}
function EmployeeWorkspaceBody({
  initialMode = "assembly",
  initialDocumentId,
}: {
  initialMode?: EmployeeMode;
  initialDocumentId?: string;
}) {
  const { user } = useSession(),
    workspace = useWorkspace(),
    day = useEmployeeWorkday(initialMode),
    auth = useAuthActions(),
    scan = useEmployeeScanActivity();
  const [menu, setMenu] = useState(false),
    [more, setMore] = useState(false),
    [help, setHelp] = useState(false),
    [password, setPassword] = useState(false),
    [problem, setProblem] = useState<string | null>(null);
  const data = workspace.data,
    employee = data?.employees.find((e) => e.id === user?.employeeId);
  const priority =
    data && user ? employeePriority(data, user.employeeId) : null;
  const requestedMode: EmployeeMode =
    employee?.status !== "working"
      ? "shift"
      : priority?.carrying
        ? priority.mode
        : day.mode === "shift"
          ? "shift"
          : (priority?.mode ?? day.mode);
  const blocked = scan.pending > 0 || scan.unsaved;
  const displayed = useRef({ userId: user?.id, mode: requestedMode });
  if (!blocked || displayed.current.userId !== user?.id)
    displayed.current = { userId: user?.id, mode: requestedMode };
  const mode = displayed.current.mode;

  useEffect(() => {
    if (!blocked) return;
    const preventLoss = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [blocked]);
  const choose = (next: EmployeeMode, confirmed = false) => {
    if (scan.pending || (scan.unsaved && !confirmed)) return;
    if (confirmed) displayed.current.mode = next;
    day.choose(next);
    setProblem(null);
    day.clearError();
    setMenu(false);
  };
  const shift = async (status: "working" | "break" | "off") => {
    if (
      scan.pending ||
      (scan.unsaved && status !== "working") ||
      priority?.carrying
    )
      return;
    const ok = await day.setShift(status);
    if (ok) {
      day.choose(status === "working" ? "assembly" : "shift");
      setMenu(false);
      setProblem(null);
    }
  };
  const noShift = employee?.status !== "working";
  return (
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
        {menu && (
          <section
            id="employee-menu"
            className={styles.menu}
            aria-label="Меню сотрудника"
          >
            <p className={styles.person}>{user?.name}</p>
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
                disabled={day.pending || scan.pending > 0}
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
                    ["assembly", "Сборка"],
                    ["putaway", "Разместить короба"],
                    ["receiving", "Приёмка"],
                    ["movements", "Перемещения"],
                    ["stocktakes", "Инвентаризация"],
                  ] as [EmployeeMode, string][]
                ).map(([key, label]) => (
                  <button
                    key={key}
                    disabled={blocked || (!!priority && priority.mode !== key)}
                    onClick={() => choose(key)}
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
                  Код не читается? Откройте ручной ввод под полем сканера. Если
                  товар не совпадает или возникла другая проблема — позовите
                  руководителя.
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
          {workspace.isError && data && (
            <div className={styles.warning} role="status">
              <p>Связь со складом нестабильна.</p>
              <button onClick={() => void workspace.refetch()}>Обновить</button>
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
              onWork={() => choose("assembly")}
            />
          ) : (
            <>
              {mode === "assembly" && (
                <EmployeeAssembly
                  data={data}
                  onIdle={() => choose("putaway")}
                  onProblem={setProblem}
                />
              )}
              {mode === "putaway" && (
                <EmployeePutaway
                  data={data}
                  onIdle={() => choose("assembly")}
                  onProblem={setProblem}
                />
              )}
              {mode === "receiving" && (
                <EmployeeReceiving
                  data={data}
                  onIdle={() => choose("assembly")}
                  onProblem={setProblem}
                />
              )}
              {mode === "movements" && (
                <EmployeeMovements
                  data={data}
                  onIdle={() => choose("assembly")}
                  onProblem={setProblem}
                />
              )}
              {mode === "stocktakes" && (
                <EmployeeStocktakes
                  key={initialDocumentId ?? "queue"}
                  initialDocumentId={initialDocumentId}
                  onIdle={() => choose("assembly", true)}
                  onProblem={setProblem}
                />
              )}
            </>
          )}
        </main>
        <footer className={styles.footer}>
          <span
            className={workspace.isError ? styles.offline : styles.online}
          />
          {workspace.isError ? "Проверьте соединение" : "Склад онлайн"}
        </footer>
      </div>
      <ChangePasswordModal open={password} onClose={() => setPassword(false)} />
    </div>
  );
}
