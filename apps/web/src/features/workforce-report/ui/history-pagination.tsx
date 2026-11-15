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
  if (page === 1 && pages === 1) return null;
  if (page > pages) {
    return (
      <nav className={styles.pagination} aria-label={label}>
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => onPage(pages)}
        >
          Вернуться к записям
        </Button>
      </nav>
    );
  }
  return (
    <nav className={styles.pagination} aria-label={label}>
      <span>{number(total)} всего</span>
      <div>
        <Button
          size="sm"
          variant="secondary"
          aria-label="Предыдущая страница"
          disabled={pending || page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ArrowLeft size={14} aria-hidden="true" />
        </Button>
        <span>
          {page} из {pages}
        </span>
        <Button
          size="sm"
          variant="secondary"
          aria-label="Следующая страница"
          disabled={pending || page >= pages}
          onClick={() => onPage(page + 1)}
        >
          <ArrowRight size={14} aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
