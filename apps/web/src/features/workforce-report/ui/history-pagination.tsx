import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/shared/ui";
import { number } from "@/shared/lib/format";
import { workforcePages } from "../lib/report-view";
import styles from "./workforce-report.module.css";

export function HistoryPagination({
  page,
  pageSize,
  total,
  pending,
  onPage,
  label,
}: {
  page: number;
  pageSize: number;
  total: number;
  pending: boolean;
  onPage: (page: number) => void;
  label: string;
}) {
  const pages = workforcePages(total, pageSize);
  return (
    <nav className={styles.pagination} aria-label={label}>
      <span>Всего: {number(total)}</span>
      <div>
        <Button
          size="sm"
          variant="secondary"
          disabled={pending || page <= 1}
          onClick={() => onPage(Math.max(1, page - 1))}
        >
          <ArrowLeft size={14} />
          Назад
        </Button>
        <span>
          {page} из {pages}
        </span>
        <Button
          size="sm"
          variant="secondary"
          disabled={pending || page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Далее
          <ArrowRight size={14} />
        </Button>
      </div>
    </nav>
  );
}
