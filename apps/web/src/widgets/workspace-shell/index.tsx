"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, Command, Menu, Search } from "lucide-react";
import { useWorkspace } from "@/entities/workspace";
import { Modal, Input, Button } from "@/shared/ui";

import { useSession } from "@/entities/session";
import { ChangePasswordModal, useAuthActions } from "@/features/auth";
import sessionStyles from "./session-controls.module.css";

import { navigationLinks } from "./navigation";
import { WorkspaceSidebar } from "./workspace-sidebar";

export function WorkspaceShell({
  children,
  showFooter = true,
}: {
  children: ReactNode;
  showFooter?: boolean;
}) {
  const { user } = useSession();
  if (user?.role !== "employee")
    return (
      <ManagerWorkspaceShell name={user?.name} showFooter={showFooter}>
        {children}
      </ManagerWorkspaceShell>
    );
  return (
    <div style={{ minHeight: "100dvh", padding: "0 16px" }}>
      <header
        style={{
          maxWidth: 1100,
          margin: "auto",
          minHeight: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <Link href="/work" className="button button--ghost">
          ← К работе
        </Link>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>{user.name}</span>
      </header>
      <main
        id="workspace-main"
        style={{ maxWidth: 1100, margin: "auto", paddingBottom: 32 }}
      >
        {children}
      </main>
    </div>
  );
}

function ManagerWorkspaceShell({
  children,
  name,
  showFooter,
}: {
  children: ReactNode;
  name?: string;
  showFooter: boolean;
}) {
  const pathname = usePathname();
  const auth = useAuthActions();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const initials =
    name
      ?.trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "?";
  const { data, isError, isPending } = useWorkspace();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const sidebarRef = useRef<HTMLElement>(null);
  const current = navigationLinks.find(({ href }) =>
    href === "/"
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`),
  );
  useEffect(() => {
    setMobileOpen(false);
    setSearchOpen(false);
  }, [pathname]);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setMobileOpen(false);
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
    const focusable = () =>
      Array.from(
        sidebarRef.current?.querySelectorAll<HTMLElement>(
          "a[href], button:not(:disabled), summary",
        ) ?? [],
      ).filter(
        (element) =>
          element.getClientRects().length > 0 &&
          (element.tagName === "SUMMARY" ||
            !element.closest("details:not([open])")),
      );
    const focusFrame = requestAnimationFrame(() => focusable()[0]?.focus());
    const mobileViewport = window.matchMedia("(max-width: 680px)");
    const closeOnDesktop = () => {
      if (!mobileViewport.matches) setMobileOpen(false);
    };
    mobileViewport.addEventListener("change", closeOnDesktop);
    function trapFocus(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const links = focusable();
      const first = links[0];
      const last = links.at(-1);
      const active = document.activeElement;
      const atBoundary = active === (event.shiftKey ? first : last);
      if (first && (atBoundary || !sidebarRef.current?.contains(active))) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    }
    document.addEventListener("keydown", trapFocus);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", trapFocus);
      mobileViewport.removeEventListener("change", closeOnDesktop);
      previousFocus?.focus();
    };
  }, [mobileOpen]);
  const links = navigationLinks.filter((item) =>
    item.label.toLowerCase().includes(query.toLowerCase()),
  );
  const activeEmployees = data?.employees.filter(
    ({ status }) => status === "working" || status === "break",
  ).length;
  return (
    <div className="workspace-layout">
      <a className="skip-link" href="#workspace-main">
        К содержимому
      </a>
      {mobileOpen && (
        <button
          className="sidebar-scrim"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <WorkspaceSidebar
        sidebarRef={sidebarRef}
        mobileOpen={mobileOpen}
        currentHref={current?.href}
        activeEmployees={activeEmployees}
        name={name}
        initials={initials}
        onClose={() => setMobileOpen(false)}
      >
        <Button
          variant="ghost"
          size="sm"
          disabled={auth.pending}
          onClick={() => {
            setMobileOpen(false);
            setPasswordOpen(true);
          }}
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
      </WorkspaceSidebar>
      <div className="workspace-content">
        <header className="topbar">
          <div className="topbar-breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label={mobileOpen ? "Закрыть меню" : "Открыть меню"}
              aria-expanded={mobileOpen}
              aria-controls="workspace-sidebar"
              onClick={() => setMobileOpen((value) => !value)}
            >
              <Menu size={21} aria-hidden="true" />
            </button>
            <span className="breadcrumb-workspace">Рабочее пространство</span>
            <span className="breadcrumb-divider">/</span>
            <strong>{current?.label ?? "Обзор"}</strong>
          </div>
          <div className="topbar-actions">
            <span className={sessionStyles.role}>Руководитель</span>
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
        {showFooter && (
          <footer className="workspace-footer">
            <span>
              artmate wms <span className="footer-dot">·</span> Локальный склад
            </span>
            <span>Данные сохраняются на этом компьютере</span>
          </footer>
        )}
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
              <span>{label}</span>
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
