"use client";

import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  ArrowRight,
  LoaderCircle,
  PackageOpen,
  X,
} from "lucide-react";

const cx = (...classes: (string | false | undefined)[]) =>
  classes.filter(Boolean).join(" ");

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "secondary" | "ghost" | "danger";
    size?: "sm" | "md";
  }
>(function Button(
  { className, variant = "primary", size = "md", type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        "button",
        `button--${variant}`,
        size === "sm" && "button--sm",
        className,
      )}
      {...props}
    />
  );
});
export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cx("input", className)} {...props} />;
});
export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cx("input", "select", className)} {...props}>
      {children}
    </select>
  );
});
export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
  className?: string;
}) {
  return (
    <span className={cx("badge", `badge--${tone}`, className)}>{children}</span>
  );
}
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) {
          const rect = ref.current.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <header className="modal-header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <button className="icon-button" aria-label="Закрыть" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      <div className="modal-body">{children}</div>
      {footer && <footer className="modal-footer">{footer}</footer>}
    </dialog>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon">
        <PackageOpen size={26} />
      </span>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
export function LoadingState({
  label = "Загружаем данные склада…",
}: {
  label?: string;
}) {
  return (
    <div className="state-panel glass-panel" role="status">
      <LoaderCircle className="spin" size={24} />
      <p>{label}</p>
    </div>
  );
}
export function ErrorState({
  message = "Не удалось загрузить данные. Проверьте соединение с сервером.",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="state-panel glass-panel" role="alert">
      <AlertCircle size={26} />
      <h3>Нет соединения со складом</h3>
      <p>{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Повторить <ArrowRight size={16} />
        </Button>
      )}
    </div>
  );
}

export { EmployeeScan } from "./employee-scan";
export {
  EmployeeWorkDevice,
  EmployeeDeviceControls,
} from "./employee-work-device";
export {
  EmployeeScanGateway,
  useEmployeeScanGateway,
} from "./employee-scan-gateway";
export type {
  EmployeeScanGatewayProps,
  EmployeeScanDisposition,
} from "./employee-scan-gateway";
export type { EmployeeScanProps } from "./employee-scan";
export {
  EmployeeScanBoundary,
  useEmployeeScanActivity,
} from "./employee-scan-activity";
export { RollLabelFormatSelect, rollPaperClass } from "./roll-label-format";

export { RollLabel } from "./roll-label";
export { LocationRollLabel } from "./location-roll-label";
export { WorkZoneRollLabel } from "./work-zone-roll-label";

export { StockLabel } from "./stock-label";
