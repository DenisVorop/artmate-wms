import type { PerformanceMetricsDto } from "@/shared/api/generated/model";
import { number } from "@/shared/lib/format";
import { formatWorkforceDuration } from "../lib/report-view";
import styles from "./workforce-report.module.css";

export function ReportMetrics({ metrics }: { metrics: PerformanceMetricsDto }) {
  return (
    <div className={styles.metrics} aria-label="Итоги за выбранный период">
      <div className={`glass-panel ${styles.metric}`}>
        <span>Упаковано коробов</span>
        <strong>{number(metrics.boxesPacked)}</strong>
        <small>{number(metrics.unitsPacked)} раскрасок в этих коробах</small>
      </div>
      <div className={`glass-panel ${styles.metric}`}>
        <span>Принято паллет</span>
        <strong>{number(metrics.receiptPalletsPlaced)}</strong>
        <small>Размещение подтверждено</small>
      </div>
      <div className={`glass-panel ${styles.metric}`}>
        <span>Размещено готовых коробов</span>
        <strong>{number(metrics.putawayBoxesPlaced)}</strong>
        <small>Из сборки на хранение</small>
      </div>
      <div className={`glass-panel ${styles.metric}`}>
        <span>Перемещено паллет</span>
        <strong>{number(metrics.movementPalletsPlaced)}</strong>
        <small>Завершённые перемещения</small>
      </div>
      <div className={`glass-panel ${styles.metric}`}>
        <span>В смене без перерывов</span>
        <strong>{formatWorkforceDuration(metrics.workingSeconds)}</strong>
        <small>В пределах периода</small>
      </div>
      <div className={`glass-panel ${styles.metric}`}>
        <span>Перерывы</span>
        <strong>{formatWorkforceDuration(metrics.breakSeconds)}</strong>
        <small>В пределах периода</small>
      </div>
    </div>
  );
}
