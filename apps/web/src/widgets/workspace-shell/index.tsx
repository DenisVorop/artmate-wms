"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  MoveRight,
  PackageCheck,
  ArrowUpRight,
  Boxes,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  Command,
  Grid2X2,
  Layers3,
  NotebookTabs,
  ClipboardCheck,
  Menu,
  Package,
  Search,
  UsersRound,
  X,
} from "lucide-react";
import { useWorkspace } from "@/entities/workspace";
import { Modal, Input, Button } from "@/shared/ui";

import { useSession } from "@/entities/session";
import { ChangePasswordModal, useAuthActions } from "@/features/auth";
import sessionStyles from "./session-controls.module.css";

const allNavigation = [
  { href: "/", label: "Обзор", icon: ChartNoAxesCombined },
  { href: "/warehouse", label: "Карта склада", icon: Grid2X2 },
  { href: "/inventory", label: "Остатки", icon: Layers3 },
  { href: "/stocktakes", label: "Инвентаризация", icon: ClipboardCheck },
  { href: "/stock-ledger", label: "Журнал учёта", icon: NotebookTabs },
  { href: "/receiving", label: "Приёмка", icon: ArrowDownToLine },
  { href: "/assembly", label: "Сборка", icon: Boxes },
  { href: "/putaway", label: "Размещение коробов", icon: PackageCheck },
  { href: "/movements", label: "Перемещения", icon: MoveRight },
  { href: "/shipments", label: "Отгрузки", icon: ArrowUpRight },
  { href: "/team", label: "Команда", icon: UsersRound },
  {
    href: "/performance",
    label: "Смены и выработка",
    icon: ChartNoAxesCombined,
  },
];

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const session = useSession();
  const auth = useAuthActions();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const workerPaths = [
    "/warehouse",
    "/receiving",
    "/assembly",
    "/putaway",
    "/movements",
    "/team",
    "/performance",
    "/stocktakes",
  ];
  const navigation = allNavigation.filter(
    (item) => session.isManager || workerPaths.includes(item.href),
  );
  const initials =
    session.user?.name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "?";
  const roleLabel = session.isManager ? "Руководитель" : "Сотрудник";
  const { data, isError, isPending } = useWorkspace();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const sidebarRef = useRef<HTMLElement>(null);
  const current =
    allNavigation.find((item) => item.href === pathname) ||
    navigation.find((item) => item.href === "/assembly") ||
    navigation[0]!;
  useEffect(() => {
    setMobileOpen(false);
    setSearchOpen(false);
  }, [pathname]);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((value) => !value);
      }
      if (event.key === "Escape") setMobileOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!mobileOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const links = sidebarRef.current?.querySelectorAll<HTMLElement>(
      "a[href], button:not(:disabled)",
    );
    links?.[0]?.focus();
    function trapFocus(event: KeyboardEvent) {
      if (event.key !== "Tab" || !links?.length) return;
      const first = links[0];
      const last = links[links.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", trapFocus);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", trapFocus);
      previousFocus?.focus();
    };
  }, [mobileOpen]);
  const links = navigation.filter((item) =>
    item.label.toLowerCase().includes(query.toLowerCase()),
  );
  const activeEmployees =
    data?.employees.filter((employee) =>
      ["working", "break"].includes(String(employee.status)),
    ).length ?? 0;
  return (
    <div className="workspace-layout">
      <a className="skip-link" href="#workspace-main">
        К содержимому
      </a>
      {mobileOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Закрыть меню"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        ref={sidebarRef}
        className={`sidebar ${mobileOpen ? "sidebar--open" : ""}`}
        aria-label="Основная навигация"
      >
        <Link
          href={session.isManager ? "/" : "/assembly"}
          className="brand"
          aria-label="artmate WMS, главная"
        >
          <span className="brand-symbol">
            <Package size={24} strokeWidth={1.5} />
          </span>
          <span>
            artmate<span className="brand-subtitle">WAREHOUSE SYSTEM</span>
          </span>
        </Link>
        <div className="warehouse-switch">
          <span className="warehouse-switch-icon">
            <Grid2X2 size={17} />
          </span>
          <div>
            <strong title={data?.warehouse.name}>
              {data?.warehouse.name ?? "Склад"}
            </strong>
            <span>Адресное хранение</span>
          </div>
          <span className="warehouse-selected" aria-label="Выбран">
            <Check size={14} />
          </span>
        </div>
        <p className="nav-caption">УПРАВЛЕНИЕ</p>
        <nav className="main-navigation">
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? "page" : undefined}
              className={`nav-item ${pathname === href ? "nav-item--active" : ""}`}
            >
              <Icon size={19} strokeWidth={1.7} />
              <span>
                {!session.isManager && href === "/team" ? "Моя смена" : label}
              </span>
              {pathname === href && <span className="nav-current-dot" />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="shift-note">
            <span className="status-dot" />
            <span>
              {session.isManager
                ? activeEmployees
                  ? `На смене: ${activeEmployees}`
                  : "Управление сменами"
                : data?.employees.find(
                      (employee) => employee.id === session.user?.employeeId,
                    )?.status === "working"
                  ? "Ваша смена открыта"
                  : data?.employees.find(
                        (employee) => employee.id === session.user?.employeeId,
                      )?.status === "break"
                    ? "Ваша смена · перерыв"
                    : "Вне смены"}
            </span>
            <Link
              href="/team"
              aria-label={
                session.isManager ? "Открыть команду" : "Открыть мою смену"
              }
            >
              <ArrowUpRight size={16} />
            </Link>
          </div>
          <details className={sessionStyles.profile}>
            <summary className="sidebar-profile">
              <span className="avatar avatar--manager">{initials}</span>
              <span>
                <strong>{session.user?.name}</strong>
                <small>
                  {roleLabel} · {session.user?.login}
                </small>
              </span>
              <ChevronDown size={15} />
            </summary>
            <div className={sessionStyles.menu}>
              <Button
                variant="ghost"
                size="sm"
                disabled={auth.pending}
                onClick={() => setPasswordOpen(true)}
              >
                Сменить пароль
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={auth.pending}
                aria-busy={auth.pending}
                onClick={() => void auth.logout()}
              >
                Выйти из склада
              </Button>
              {auth.error && (
                <p className={sessionStyles.error} role="alert">
                  {auth.error}
                </p>
              )}
            </div>
          </details>
        </div>
      </aside>
      <div className="workspace-content">
        <header className="topbar">
          <div className="topbar-breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label={mobileOpen ? "Закрыть меню" : "Открыть меню"}
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((value) => !value)}
            >
              {mobileOpen ? <X size={21} /> : <Menu size={21} />}
            </button>
            <span className="breadcrumb-workspace">Рабочее пространство</span>
            <span className="breadcrumb-divider">/</span>
            <strong>
              {!session.isManager && current.href === "/team"
                ? "Моя смена"
                : current.label}
            </strong>
          </div>
          <div className="topbar-actions">
            <span className={sessionStyles.role}>{roleLabel}</span>
            <button
              className="search-button"
              onClick={() => {
                setQuery("");
                setSearchOpen(true);
              }}
              aria-label="Поиск раздела"
            >
              <Search size={16} />
              <span>Найти раздел</span>
              <kbd>⌘ K</kbd>
            </button>
            <span
              className={`connection-status ${isError ? "connection-status--error" : ""}`}
            >
              <span
                className={`status-dot ${isError ? "status-dot--danger" : ""}`}
              />
              {isError
                ? "Нет связи"
                : isPending
                  ? "Соединение…"
                  : "Склад онлайн"}
            </span>
            <span className="topbar-avatar">{initials}</span>
          </div>
        </header>
        <main id="workspace-main" className="main-content">
          {children}
        </main>
        <footer className="workspace-footer">
          <span>
            artmate wms <span className="footer-dot">·</span> Локальный склад
          </span>
          <span>Данные сохраняются на этом компьютере</span>
        </footer>
      </div>
      <ChangePasswordModal
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
      />
      <Modal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        title="Перейти в раздел"
        description="Найдите нужный экран склада"
      >
        <div className="search-field">
          <Search size={18} />
          <Input
            aria-label="Название раздела"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Карта, приёмка, сборка…"
            autoFocus
          />
        </div>
        <div className="command-links">
          {links.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} onClick={() => setSearchOpen(false)}>
              <Icon size={19} />
              <span>
                {!session.isManager && href === "/team" ? "Моя смена" : label}
              </span>
              <ArrowUpRight size={16} />
            </Link>
          ))}
          {links.length === 0 && <p className="muted">Раздел не найден</p>}
        </div>
        <p className="command-hint">
          <Command size={12} /> K — открыть поиск <span>Esc — закрыть</span>
        </p>
      </Modal>
    </div>
  );
}
