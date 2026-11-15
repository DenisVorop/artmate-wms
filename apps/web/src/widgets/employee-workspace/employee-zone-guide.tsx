import type {
  MovementDto,
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

type JobRow = {
  key: string;
  title: string;
  note?: string;
  action: string;
  disabled: boolean;
  onClick: () => void;
};

export function EmployeeZoneGuide({
  data,
  zone,
  movements,
  blocked,
  failed,
  onRetry,
  onTake,
  onMovement,
  onClearZone,
  onProblem,
}: {
  data: WorkspaceDto;
  zone?: WorkZoneDto;
  movements: readonly MovementDto[];
  blocked: boolean;
  failed: boolean;
  onRetry: () => void;
  onTake: (offer: ZoneOfferDto) => void;
  onMovement: (movement: MovementDto) => void;
  onClearZone: () => void;
  onProblem: (message: string) => void;
}) {
  const zones = data.warehouse.workZones.filter((row) => !row.archived);
  const offers = data.zoneOffers ?? [];
  const movementJobs = movements.map<JobRow>((movement) => {
    const pallet = data.pallets.find((item) => item.id === movement.palletId);
    const sku = data.skus.find((item) => item.id === pallet?.skuId);
    const from = data.locations.find(
      (item) => item.id === movement.fromLocationId,
    );
    const to = data.locations.find((item) => item.id === movement.toLocationId);
    const action = movement.employeeId ? "Продолжить" : "Взять";
    return {
      key: movement.id,
      title: sku ? `Переместить «${sku.name}»` : "Переместить паллету",
      note: [
        pallet?.code ?? movement.code,
        from && to ? `${from.code} → ${to.code}` : undefined,
      ]
        .filter(Boolean)
        .join(" · "),
      action,
      disabled: blocked,
      onClick: () => onMovement(movement),
    };
  });
  const groups = (zone ? [zone] : zones).map((item) => ({
    id: item.id,
    name: item.name,
    jobs: offers
      .filter((offer) => offer.zoneId === item.id)
      .flatMap<JobRow>((offer) => {
        const details = offerDetails(data, item, offer);
        return details
          ? [
              {
                ...details,
                key: `${offer.jobId}:${offer.palletId ?? ""}`,
                action: offer.resume ? "Продолжить" : "Взять",
                disabled: !zone || blocked,
                onClick: () => onTake(offer),
              },
            ]
          : [];
      }),
  }));
  const hasZoneJobs = groups.some(({ jobs }) => jobs.length > 0);
  if (!zone && movementJobs.length > 0)
    groups.unshift({
      id: "movements",
      name: "Перемещения паллет",
      jobs: movementJobs,
    });
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
            <h2 id="zone-jobs-title">{zone ? zone.name : "Задания"}</h2>
            {zone && (
              <Button
                variant="secondary"
                disabled={blocked}
                onClick={onClearZone}
              >
                Все задания
              </Button>
            )}
          </div>
          {!zone && hasZoneJobs && (
            <p className={styles.zoneTableHint} id="zone-jobs-hint">
              Для заданий в зоне сначала сканируйте её QR.
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
              {groups.map(({ id, name, jobs }) => (
                <tbody key={id} aria-label={name}>
                  {!zone && (
                    <tr className={styles.zoneGroup}>
                      <th scope="rowgroup" colSpan={2}>
                        {name}
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
                    jobs.map(
                      ({ key, title, note, action, disabled, onClick }) => (
                        <tr key={key}>
                          <td>
                            <strong>{title}</strong>
                            {note && <small>{note}</small>}
                          </td>
                          <td>
                            <Button
                              size="sm"
                              disabled={disabled}
                              aria-label={`${action}: ${title}`}
                              onClick={onClick}
                            >
                              {action}
                            </Button>
                          </td>
                        </tr>
                      ),
                    )
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
