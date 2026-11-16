import Link from "next/link";
import { StatusPage } from "@/shared/ui";

export function AccessDenied() {
  return (
    <StatusPage
      title="Раздел доступен руководителю"
      action={
        <Link href="/work" className="button button--primary">
          К работе
        </Link>
      }
    />
  );
}
