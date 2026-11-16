"use client";
import { Fragment, type ReactNode } from "react";
import { useSession } from "@/entities/session";
import { Button, LoadingState, StatusPage } from "@/shared/ui";
import { AuthenticationFeature } from "./authentication-feature";
import styles from "./auth.module.css";

export function AuthBoundary({ children }: { children: ReactNode }) {
  const session = useSession();
  if (session.isPending)
    return (
      <main className="state-page">
        <LoadingState label="Проверка входа…" />
      </main>
    );
  if (!session.data && session.isError)
    return (
      <StatusPage
        title="Нет связи со складом"
        action={
          <Button onClick={() => void session.refetch()}>Повторить</Button>
        }
      />
    );
  if (!session.user || session.user.mustChangePassword)
    return <AuthenticationFeature />;

  return (
    <Fragment
      key={`${session.user.id}:${session.user.role}:${session.user.mustChangePassword}`}
    >
      {session.isError && (
        <div className={styles.notice} role="alert">
          <span>Не удалось проверить доступ</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void session.refetch()}
          >
            Повторить
          </Button>
        </div>
      )}
      {children}
    </Fragment>
  );
}
