import type { RollLabelFormat } from "@/shared/lib/label-paper";
import { rollPaperClass } from "./roll-label-format";
import styles from "./stock-label.module.css";
/** Physical print geometry shared by reserve, receipt, single and opening labels. */
export function StockLabel({
  kind,
  format,
  code,
  svg,
  imageKey,
  title,
  reference,
  onLoad,
  onError,
}: {
  kind: "box" | "pallet";
  format: RollLabelFormat;
  code: string;
  svg: string;
  imageKey: string;
  title?: string;
  reference?: string;
  onLoad: () => void;
  onError: () => void;
}) {
  return (
    <article
      className={`${styles.label} ${rollPaperClass(format)}`}
      data-format={format}
      data-kind={kind}
      aria-label={`${kind === "box" ? "Короб" : "Паллета"} ${code}`}
    >
      {kind === "pallet" && (
        <h2 className={styles.heading}>{title ?? "Паллета"}</h2>
      )}
      <img
        key={imageKey}
        className={styles.qr}
        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
        width={256}
        height={256}
        alt={`QR ${code}`}
        onLoad={onLoad}
        onError={onError}
      />
      {kind === "pallet" && reference && (
        <p className={styles.reference}>{reference}</p>
      )}
    </article>
  );
}
