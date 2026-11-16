import Link from "next/link";
import { StatusPage } from "@/shared/ui";

export default function NotFound() {
  return (
    <StatusPage
      title="Страница не найдена"
      action={
        <Link href="/" className="button button--primary">
          На главную
        </Link>
      }
    />
  );
}
