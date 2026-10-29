import type { LabelDto } from "@/shared/api/generated/model";
import { locationSign } from "@/shared/lib/location-sign";
import { rollPaperClass } from "./roll-label-format";
import styles from "./location-roll-label.module.css";

/** One shared 120 × 75 address template for single and batch printing. */
export function LocationRollLabel({
  label,
  imageKey,
  onLoad,
  onError,
}: {
  label: LabelDto;
  imageKey: string;
  onLoad: () => void;
  onError: () => void;
}) {
  const sign = locationSign(label);
  return (
    <article
      className={`${styles.label} ${rollPaperClass("120x75")}`}
      aria-label={`Место ${sign.place}${sign.tier ? `, ярус ${sign.tier}` : ""}, ${label.code}`}
    >
      <img
        key={imageKey}
        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(label.svg)}`}
        width={276}
        height={276}
        alt={`QR ${label.code}`}
        onLoad={onLoad}
        onError={onError}
      />
      <div className={styles.captions}>
        {sign.archived && <span className={styles.archived}>АРХИВ</span>}
        <strong
          className={`${styles.place} ${sign.place.length > 5 ? styles.longPlace : ""}`}
        >
          МЕСТО {sign.place}
        </strong>
        {sign.tier && <strong className={styles.tier}>ЯРУС {sign.tier}</strong>}
        <strong
          className={`${styles.code} ${label.code.length > 8 ? styles.longCode : ""}`}
        >
          {label.code}
        </strong>
      </div>
    </article>
  );
}
