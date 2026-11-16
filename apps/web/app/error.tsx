"use client";
import Link from "next/link";
import { Button, StatusPage } from "@/shared/ui";

export default function Error({ reset }: { reset: () => void }) {
  return (
    <StatusPage
      title="Не удалось открыть страницу"
      action={
        <div className="state-actions">
          <Button onClick={reset}>Повторить</Button>
          <Link href="/" className="button button--secondary">
            На главную
          </Link>
        </div>
      }
    />
  );
}
