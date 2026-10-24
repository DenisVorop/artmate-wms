"use client";
import { Fragment, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { useSession } from "@/entities/session";
import { Button } from "@/shared/ui";
import { AuthenticationFeature, AuthFrame } from "./authentication-feature";
import styles from "./auth.module.css";
export function AuthBoundary({ children }: { children: ReactNode }) {
  const session = useSession();
  if (session.isPending)
    return (
      <AuthFrame>
        <p className={styles.status} role="status">
          <LoaderCircle size={21} className="spin" />
          Проверяем доступ к складу…
        </p>
      </AuthFrame>
    );
  if (!session.data && session.isError)
    return (
      <AuthFrame>
        <h1>Нет связи со складом</h1>
        <p className={styles.description}>
          Не удалось проверить сессию. Восстановите соединение и повторите вход.
        </p>
        <Button onClick={() => void session.refetch()}>
          Повторить проверку
        </Button>
      </AuthFrame>
    );
  if (!session.user || session.user.mustChangePassword)
    return <AuthenticationFeature />;
  return (
    <Fragment
      key={`${session.user.id}:${session.user.role}:${session.user.mustChangePassword}`}
    >
      {session.isError && (
        <div className={styles.notice} role="alert">
          <span>
            Не удалось проверить сессию. Показаны последние данные о доступе.
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void session.refetch()}
          >
            Проверить доступ
          </Button>
        </div>
      )}
      {children}
    </Fragment>
  );
}
