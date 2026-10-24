"use client";
import { RotateCcw } from "lucide-react";
import type { WorkspaceDto } from "@/shared/api/generated/model";
import { Button, EmptyState, Modal } from "@/shared/ui";
import { layoutTrashItems } from "../lib/layout-archive";
import styles from "./plan-panels.module.css";

type Props = {
  open: boolean;
  data: WorkspaceDto;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onRestore: (key: string) => Promise<unknown>;
};
export function LayoutTrash({
  open,
  data,
  pending,
  error,
  onClose,
  onRestore,
}: Props) {
  const items = layoutTrashItems(data);
  return (
    <Modal
      open={open}
      onClose={() => {
        if (!pending) onClose();
      }}
      title="Корзина плана"
      description="Удалённые объекты можно восстановить позже."
    >
      <p className={styles.trashIntro}>
        Удаление убирает объект с плана. История и QR адресов сохраняются.
        Восстановление проверит границы помещения и пересечения с текущими
        объектами.
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {!items.length ? (
        <EmptyState
          title="Корзина пуста"
          description="Здесь появятся удалённые помещения, коридоры, секции, адреса, проходы и входы."
        />
      ) : (
        <div className={styles.trashList}>
          {items.map((item) => (
            <article className={styles.trashItem} key={item.key}>
              <div className={styles.trashHead}>
                <div>
                  <span className={styles.trashType}>{item.kind}</span>
                  <h3>{item.title}</h3>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pending || !!item.restoreReason}
                  aria-label={`Восстановить «${item.title}»`}
                  onClick={() => void onRestore(item.key).catch(() => {})}
                >
                  <RotateCcw size={14} />
                  Восстановить
                </Button>
              </div>
              <p>{item.description}</p>
              {item.restoreReason && (
                <p className={styles.reason}>{item.restoreReason}</p>
              )}
              {item.archivedAt && (
                <time className={styles.trashTime} dateTime={item.archivedAt}>
                  Убрано с плана{" "}
                  {new Intl.DateTimeFormat("ru-RU", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Europe/Moscow",
                  }).format(new Date(item.archivedAt))}
                </time>
              )}
            </article>
          ))}
        </div>
      )}
    </Modal>
  );
}
