import Link from "next/link";
import { useEffect, useRef, type ReactNode, type Ref } from "react";
import { ChevronDown, Package, X } from "lucide-react";
import { navigationGroups } from "./navigation";
import styles from "./workspace-sidebar.module.css";
import themeStyles from "./workspace-theme.module.css";

export function WorkspaceSidebar({
  sidebarRef,
  mobileOpen,
  currentHref,
  activeEmployees,
  name,
  initials,
  onClose,
  children,
}: {
  sidebarRef: Ref<HTMLElement>;
  mobileOpen: boolean;
  currentHref?: string;
  activeEmployees?: number;
  name?: string;
  initials: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const activeLink = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    activeLink.current?.scrollIntoView({ block: "nearest" });
  }, [currentHref, mobileOpen]);

  return (
    <aside
      id="workspace-sidebar"
      ref={sidebarRef}
      className={`sidebar ${styles.panel} ${themeStyles.light}${mobileOpen ? " sidebar--open" : ""}`}
      aria-label="Левая панель"
    >
      <div className={styles.header}>
        <Link
          href="/"
          className={styles.brand}
          aria-label="artmate WMS, главная"
          onClick={onClose}
        >
          <span className={styles.brandIcon}>
            <Package aria-hidden="true" size={20} strokeWidth={1.7} />
          </span>
          <span>
            artmate <small>WMS</small>
          </span>
        </Link>
        <button
          type="button"
          className={styles.close}
          aria-label="Закрыть меню"
          onClick={onClose}
        >
          <X aria-hidden="true" size={20} />
        </button>
      </div>
      <nav aria-label="Основная навигация" className={styles.navigation}>
        {navigationGroups.map(({ label, links }) => (
          <div key={label ?? "home"} className={styles.group}>
            {label && <p className={styles.groupLabel}>{label}</p>}
            <ul className={styles.list} aria-label={label}>
              {links.map(({ href, label, icon: Icon }) => {
                const onShift = href === "/team" ? activeEmployees : undefined;
                const isCurrent = currentHref === href;
                const shiftStatus =
                  onShift === undefined ? undefined : `На смене: ${onShift}`;
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      ref={isCurrent ? activeLink : undefined}
                      aria-current={isCurrent ? "page" : undefined}
                      aria-description={shiftStatus}
                      className={styles.link}
                      onClick={onClose}
                    >
                      <Icon aria-hidden="true" size={17} strokeWidth={1.7} />
                      <span>{label}</span>
                      {onShift !== undefined && (
                        <span
                          className={styles.count}
                          aria-hidden="true"
                          title={shiftStatus}
                        >
                          {onShift}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className={styles.footer}>
        <details className={styles.profile}>
          <summary className={styles.profileTrigger}>
            <span className={styles.avatar} aria-hidden="true">
              {initials}
            </span>
            <span className={styles.profileIdentity}>
              <strong title={name}>{name ?? "Профиль"}</strong>
              <small>Руководитель</small>
            </span>
            <ChevronDown aria-hidden="true" size={15} />
          </summary>
          <div className={styles.profileActions}>{children}</div>
        </details>
      </div>
    </aside>
  );
}
