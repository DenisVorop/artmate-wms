import type {
  WorkspaceDto,
  WorkZoneDto,
  ZoneOfferDto,
} from "@/shared/api/generated/model";
import { Button, EmployeeScan } from "@/shared/ui";
import styles from "./workspace.module.css";

function offerDetails(
  data: WorkspaceDto,
  zone: WorkZoneDto,
  offer: ZoneOfferDto,
) {
  if (zone.kind === "assembly") {
    const task = data.tasks.find((row) => row.id === offer.jobId);
    if (!task) return null;
    const name = data.skus.find((sku) => sku.id === task.skuId)?.name;
    const boxes =
      task.autoPurpose && !offer.resume
        ? 1
        : task.boxesTarget - task.boxesCompleted;
    return {
      title: name ? `Собрать «${name}»` : task.code,
      note:
        boxes === 1
          ? `1 короб · ${task.unitsPerBox} шт.`
          : `${boxes} коробов · по ${task.unitsPerBox} шт.`,
    };
  }
  if (zone.kind === "receiving") {
    const pallet = data.pallets.find((row) => row.id === offer.palletId);
    const row = data.receipts
      .find((receipt) => receipt.id === offer.jobId)
      ?.pallets.find((row) => row.palletId === offer.palletId);
    const name = data.skus.find((sku) => sku.id === row?.skuId)?.name;
    return pallet && row
      ? {
          title: name ? `Разместить паллету «${name}»` : "Разместить паллету",
          note: [pallet.code, `${row.quantity.toLocaleString("ru-RU")} шт.`]
            .filter(Boolean)
            .join(" · "),
        }
      : null;
  }
  if (zone.kind === "putaway") {
    if (offer.jobId === zone.id)
      return {
        title: "Разместить короб",
        note: "Подойдёт любой готовый короб",
      };
    const task = data.putawayTasks.find((row) => row.id === offer.jobId);
    const box = data.boxes.find((row) => row.id === task?.boxId);
    return box
      ? {
          title: `Разместить короб ${box.code}`,
          note: data.skus.find((sku) => sku.id === task?.skuId)?.name,
        }
      : null;
  }
  const shipment = data.shipments.find((row) => row.id === offer.jobId);
  if (!shipment) return null;
  return {
    title: shipment.wb
      ? `Собрать поставку WB № ${shipment.wb.supplyId}`
      : `Собрать отгрузку ${shipment.code}`,
    note: `Коробов к отбору: ${shipment.boxesRequested}`,
  };
}

export function EmployeeZoneGuide({
  data,
  zone,
  blocked,
  failed,
  onRetry,
  onTake,
  onClearZone,
  onProblem,
}: {
  data: WorkspaceDto;
  zone?: WorkZoneDto;
  blocked: boolean;
  failed: boolean;
  onRetry: () => void;
  onTake: (offer: ZoneOfferDto) => void;
  onClearZone: () => void;
  onProblem: (message: string) => void;
}) {
  const zones = data.warehouse.workZones.filter((row) => !row.archived);
  const offers = data.zoneOffers ?? [];
  const groups = (zone ? [zone] : zones).map((item) => ({
    zone: item,
    jobs: offers
      .filter((offer) => offer.zoneId === item.id)
      .flatMap((offer) => {
        const details = offerDetails(data, item, offer);
        return details ? [{ ...details, offer }] : [];
      }),
  }));
  const otherZone =
    zone &&
    zones.find(
      (row) =>
        row.id !== zone.id && offers.some((offer) => offer.zoneId === row.id),
    );
  const loading = zones.length > 0 && !data.zoneOffers;

  return (
    <section className={styles.zoneGuide} aria-label="Рабочие задания">
      <div className={styles.zoneScanner}>
        <h2>Сканируйте QR зоны</h2>
        <EmployeeScan
          compact
          contextKey={`zone-guide:${zone?.id ?? "entrance"}`}
          label="Сканируйте QR зоны"
          disabled={blocked}
          onScan={async () => false}
          onProblem={onProblem}
        />
      </div>
      {failed || loading ? (
        <>
          <p role="status">
            {failed ? "Нет связи со складом" : "Загружаем задания…"}
          </p>
          {failed && <Button onClick={onRetry}>Повторить</Button>}
        </>
      ) : (
        <section aria-labelledby="zone-jobs-title">
          <div className={styles.zoneTableHeading}>
            <h2 id="zone-jobs-title">
              {zone ? zone.name : "Задания по зонам"}
            </h2>
            {zone && (
              <Button
                variant="secondary"
                disabled={blocked}
                onClick={onClearZone}
              >
                Все зоны
              </Button>
            )}
          </div>
          {!zone && groups.some(({ jobs }) => jobs.length > 0) && (
            <p className={styles.zoneTableHint} id="zone-jobs-hint">
              Чтобы взять задание, сканируйте QR его зоны.
            </p>
          )}
          {groups.length === 0 ? (
            <p>Рабочих зон пока нет.</p>
          ) : (
            <table
              className={styles.zoneTable}
              aria-labelledby="zone-jobs-title"
            >
              <thead className={styles.srOnly}>
                <tr>
                  <th scope="col">Задание</th>
                  <th scope="col">Действие</th>
                </tr>
              </thead>
              {groups.map(({ zone: group, jobs }) => (
                <tbody key={group.id} aria-label={group.name}>
                  {!zone && (
                    <tr className={styles.zoneGroup}>
                      <th scope="rowgroup" colSpan={2}>
                        {group.name}
                      </th>
                    </tr>
                  )}
                  {jobs.length === 0 ? (
                    <tr>
                      <td colSpan={2} className={styles.zoneTableHint}>
                        Заданий нет
                      </td>
                    </tr>
                  ) : (
                    jobs.map(({ title, note, offer }) => (
                      <tr key={`${offer.jobId}:${offer.palletId ?? ""}`}>
                        <td>
                          <strong>{title}</strong>
                          {note && <small>{note}</small>}
                        </td>
                        <td>
                          <Button
                            size="sm"
                            disabled={!zone || blocked}
                            aria-label={`${offer.resume ? "Продолжить" : "Взять"}: ${title}`}
                            onClick={() => onTake(offer)}
                          >
                            {offer.resume ? "Продолжить" : "Взять"}
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              ))}
            </table>
          )}
          {zone && groups[0]?.jobs.length === 0 && otherZone && (
            <p className={styles.zoneTableHint}>
              Есть работа в зоне «{otherZone.name}».
            </p>
          )}
        </section>
      )}
    </section>
  );
}
