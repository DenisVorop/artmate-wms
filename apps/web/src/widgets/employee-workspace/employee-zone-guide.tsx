import type {
  WorkspaceDto,
  WorkZoneDto,
  ZoneOfferDto,
} from "@/shared/api/generated/model";
import { Button, EmployeeScan } from "@/shared/ui";
import styles from "./workspace.module.css";

function describeOffer(
  data: WorkspaceDto,
  zone: WorkZoneDto,
  offer: ZoneOfferDto,
) {
  if (zone.kind === "assembly") {
    const task = data.tasks.find((t) => t.id === offer.jobId);
    if (!task) return null;
    const sku = data.skus.find((s) => s.id === task.skuId);
    const product = sku ? ` «${sku.name}»` : "";
    if (offer.resume) return `Продолжить сборку${product}`;
    const boxes = task.autoPurpose ? 1 : task.boxesTarget - task.boxesCompleted;
    return boxes === 1
      ? `Собрать 1 короб${product}`
      : `Сборка${product} · коробов: ${boxes}`;
  }
  if (zone.kind === "receiving") {
    const pallet = data.pallets.find((row) => row.id === offer.palletId);
    return pallet ? `Разместить паллету ${pallet.code}` : null;
  }
  if (zone.kind === "putaway") return "Разместить 1 короб";
  const shipment = data.shipments.find((row) => row.id === offer.jobId);
  if (!shipment) return null;
  const name = shipment.wb ? `WB № ${shipment.wb.supplyId}` : shipment.code;
  return offer.resume ? `Продолжить отбор ${name}` : `Собрать поставку ${name}`;
}

export function EmployeeZoneGuide({
  data,
  zone,
  offer,
  blocked,
  failed,
  onRetry,
  onTake,
  onProblem,
}: {
  data: WorkspaceDto;
  zone?: WorkZoneDto;
  offer?: ZoneOfferDto;
  blocked: boolean;
  failed: boolean;
  onRetry: () => void;
  onTake: () => void;
  onProblem: (message: string) => void;
}) {
  const zones = data.warehouse.workZones.filter((row) => !row.archived);
  const offers = data.zoneOffers ?? [];
  const available = new Set(offers.map((row) => row.zoneId));
  const eligible = zones.filter(
    (row) => row.id !== zone?.id && available.has(row.id),
  );
  const started = new Set(
    offers.filter((row) => row.inProgress).map((row) => row.zoneId),
  );
  const full = data.assemblyPressure?.level === "full";
  const next =
    eligible.find((row) => started.has(row.id)) ??
    (full ? eligible.find((row) => row.kind === "putaway") : undefined) ??
    eligible.find((row) => row.kind === "receiving") ??
    eligible.find((row) => row.kind === "shipping") ??
    eligible[0];
  const job = zone && offer ? describeOffer(data, zone, offer) : null;

  if (failed || (zones.length > 0 && !data.zoneOffers))
    return (
      <section className={styles.zoneGuide}>
        <h2>{failed ? "Нет связи со складом" : "Проверяем задания…"}</h2>
        {failed && <Button onClick={onRetry}>Повторить</Button>}
      </section>
    );

  return (
    <section
      className={styles.zoneGuide}
      aria-label={job ? "Задание зоны" : "Где есть работа"}
    >
      {zone && !job && (
        <p className={styles.zoneEmpty}>Здесь пока нет заданий</p>
      )}
      <h2 aria-live="polite">
        {job ??
          (next ? `Перейдите в зону «${next.name}»` : "Сейчас заданий нет")}
      </h2>
      {job ? (
        <Button disabled={blocked} onClick={onTake}>
          {offer?.resume ? "Продолжить" : "Взять"}
        </Button>
      ) : (
        <>
          <EmployeeScan
            contextKey={`zone-guide:${zone?.id ?? "entrance"}`}
            label="Сканируйте QR зоны"
            disabled={blocked}
            onScan={async () => false}
            onProblem={onProblem}
          />
          {zones.some((row) => row.id !== next?.id && row.id !== zone?.id) && (
            <ul className={styles.zoneDirectory} aria-label="Другие зоны">
              {zones
                .filter((row) => row.id !== next?.id && row.id !== zone?.id)
                .map((row) => (
                  <li key={row.id}>
                    <span>{row.name}</span>
                    <span>
                      {available.has(row.id) ? "Есть работа" : "Заданий нет"}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
