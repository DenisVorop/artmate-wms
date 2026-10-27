import type { LabelDto } from "@/shared/api/generated/model";
import type { RollLabelFormat } from "@/shared/lib/label-paper";
import { rollPaperClass } from "./roll-label-format";
import styles from "./roll-label.module.css";
/** The same existing large-QR roll design is used for individual and batch labels. */
export function RollLabel({
  label,
  format,
  imageKey,
  caption,
  onLoad,
  onError,
}: {
  label: LabelDto;
  format: RollLabelFormat;
  imageKey: string;
  caption: string;
  onLoad: () => void;
  onError: () => void;
}) {
  return (
    <article
      className={`${styles.label} ${rollPaperClass(format)} ${label.title.length > 24 ? styles.mediumLabel : ""} ${label.title.length > 50 ? styles.longLabel : ""} ${label.title.length > 130 || label.code.length > 40 ? styles.denseLabel : ""}`}
      data-format={format}
      aria-label={`${caption} ${label.code}, ${label.title}`}
    >
      <header className={styles.labelHeading}>
        <strong className={label.code.length > 28 ? styles.longCode : ""}>
          {label.code}
        </strong>
        <span>Artmate · {caption}</span>
      </header>
      <div className={styles.labelBody}>
        {/* SVG image context cannot execute scripts. */}
        <img
          key={imageKey}
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(label.svg)}`}
          width={144}
          height={144}
          alt={`QR ${label.code}`}
          onLoad={onLoad}
          onError={onError}
        />
        <h2
          className={
            label.title.length > 70
              ? styles.longTitle
              : label.title.length > 24
                ? styles.mediumTitle
                : ""
          }
        >
          {label.title}
        </h2>
      </div>
      <p className={styles.payload}>{label.payload}</p>
    </article>
  );
}
