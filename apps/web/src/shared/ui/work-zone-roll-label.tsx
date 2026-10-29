import type { LabelDto } from "@/shared/api/generated/model";
import { workZoneSign } from "@/shared/lib/work-zone-sign";
import { rollPaperClass } from "./roll-label-format";
import styles from "./location-roll-label.module.css";

export function WorkZoneRollLabel({
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
  const purpose = workZoneSign(label.title);
  return (
    <article
      className={`${styles.label} ${rollPaperClass("120x75")}`}
      aria-label={`Рабочая зона: ${purpose}`}
    >
      <img
        key={imageKey}
        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(label.svg)}`}
        width={276}
        height={276}
        alt={`QR рабочей зоны ${purpose}`}
        onLoad={onLoad}
        onError={onError}
      />
      <div className={styles.zoneCaption}>
        <span>Рабочая зона:</span>
        <strong className={purpose.length > 8 ? styles.longPurpose : ""}>
          {purpose}
        </strong>
      </div>
    </article>
  );
}
