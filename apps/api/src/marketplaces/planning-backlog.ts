import { isBoxOnHand } from "../box-stock";
import type * as W from "../dto";
import { finishedMetrics, putawayPlacementError } from "../physical";
import type { MarketplacePlanRowDto } from "./dto";
import { canonicalAssemblyLocation } from "../work-zones";
import { placementRoutes } from "../placement-routing";

/** Read-only reservation of future physical volume; never creates warehouse facts. */
export function planningBacklog(
  w: W.WorkspaceDto,
  rows: MarketplacePlanRowDto[],
  minimumBoxes: Record<string, number> = {},
) {
  const order = rows
    .filter(
      (row) =>
        row.averageDailyUnits > 0 ||
        row.localAfterAssemblyUnits <
          (minimumBoxes[row.skuId] ?? 0) * row.unitsPerBox,
    )
    .sort(
      (a, b) =>
        (a.averageDailyUnits > 0
          ? a.localAfterAssemblyUnits / a.averageDailyUnits
          : 0) -
          (b.averageDailyUnits > 0
            ? b.localAfterAssemblyUnits / b.averageDailyUnits
            : 0) ||
        Number(b.providers.some((source) => source.scenario)) -
          Number(a.providers.some((source) => source.scenario)) ||
        b.averageDailyUnits - a.averageDailyUnits ||
        a.skuName.localeCompare(b.skuName, "ru"),
    );
  order.forEach((row, index) => {
    row.backlogRank = index + 1;
  });
  const missingPackaging = w.skus.some((sku) => !sku.packaging);
  if (missingPackaging) {
    rows.forEach((row) => {
      row.backlogCapacityKnown = false;
      row.backlogReason = "Для расчёта мест укажите размеры упаковки.";
    });
    return "Чтобы рассчитать свободные места, укажите размеры упаковки.";
  }
  const capacity = assemblyStorageCapacity(w);
  let fits = true;
  const reserve = capacity.reserve;
  for (const row of rows) {
    const sku = w.skus.find((item) => item.id === row.skuId)!;
    for (let i = 0; fits && i < row.recommendedBoxes; i++)
      fits = reserve({ skuId: sku.id, packagingSnapshot: sku.packaging });
  }
  for (const row of order) {
    row.backlogCapacityKnown = true;
    if (!row.dataComplete)
      row.backlogReason = "Сначала уточните данные для расчёта.";
    else if (row.recommendedBoxes > 0)
      row.backlogReason = "Сначала соберите объём к ближайшей отправке.";
    else if (row.rawAvailableUnits < row.unitsPerBox)
      row.backlogReason =
        "Для следующего короба нужно принять и разместить товар.";
    else if (
      !fits ||
      !reserve({
        skuId: row.skuId,
        packagingSnapshot: w.skus.find((sku) => sku.id === row.skuId)!
          .packaging,
      })
    )
      row.backlogReason =
        "Свободных мест недостаточно. Сначала разместите готовые короба или освободите хранение.";
    else {
      row.backlogBoxes = 1;
      row.backlogUnits = row.unitsPerBox;
      row.backlogCanCreate = true;
      row.backlogReason =
        "Следующий короб в запас. После сборки очередь пересчитается по спросу и свободным местам.";
    }
  }
  return "Следующая работа — по одному коробу: приоритет пересчитывается после сборки. При полном хранении сначала размещение и приёмка.";
}

/** Account for committed warehouse work once, then reserve new boxes in priority order. */
export function assemblyStorageCapacity(w: W.WorkspaceDto) {
  const simulation: W.WorkspaceDto = {
    ...w,
    pallets: structuredClone(w.pallets),
    boxes: [...w.boxes],
  };
  const storage = w.locations.filter((location) =>
    ["rack", "floor"].includes(location.kind),
  );
  const routes = placementRoutes(
    w,
    w.warehouse?.workZones
      ? canonicalAssemblyLocation(w)
      : (w.pallets.find((p) => p.kind === "assembly" && p.status === "stored")
          ?.locationId ?? null),
    storage.map((location) => location.id),
  );
  const reachable = storage.filter(
    (location) => routes.get(location.id)?.status !== "unreachable",
  );
  let inspected = 0;
  type ProposedBox = Pick<W.BoxDto, "skuId" | "packagingSnapshot"> &
    Partial<Pick<W.BoxDto, "lotContents">>;
  function reserve(box: ProposedBox) {
    if (++inspected > 10000 || !box.packagingSnapshot) return false;
    const candidates = [...reachable].sort(
      (a, b) =>
        Number(
          simulation.pallets.some(
            (p) =>
              p.status === "stored" &&
              p.locationId === b.id &&
              p.skuId === box.skuId,
          ),
        ) -
          Number(
            simulation.pallets.some(
              (p) =>
                p.status === "stored" &&
                p.locationId === a.id &&
                p.skuId === box.skuId,
            ),
          ) || a.code.localeCompare(b.code),
    );
    const location = candidates.find(
      (candidate) => !putawayPlacementError(simulation, candidate, box),
    );
    if (!location) return false;
    let pallet = simulation.pallets.find(
      (p) => p.status === "stored" && p.locationId === location.id,
    );
    if (pallet) {
      pallet.quantity++;
      Object.assign(
        pallet,
        finishedMetrics(box.packagingSnapshot, pallet.quantity),
      );
    } else {
      pallet = {
        id: `forecast-capacity-${inspected}`,
        skuId: box.skuId,
        kind: "finished",
        status: "stored",
        locationId: location.id,
        returnLocationId: null,
        quantity: 1,
        packagingSnapshot: box.packagingSnapshot,
        ...finishedMetrics(box.packagingSnapshot, 1),
      } as W.PalletDto;
      simulation.pallets.push(pallet);
    }
    if (box.lotContents?.length)
      simulation.boxes.push({
        ...box,
        id: `forecast-box-${inspected}`,
        palletId: pallet.id,
        locationId: location.id,
        status: "stored",
      } as W.BoxDto);
    return true;
  }
  // Existing unplaced boxes and committed WIP consume capacity before optional work.
  const assigned = new Set(
    w.shipments
      .filter((shipment) => shipment.status === "draft")
      .flatMap((shipment) => shipment.boxIds),
  );
  const incoming = w.boxes.filter(
    (box) =>
      !assigned.has(box.id) &&
      isBoxOnHand(box.status) &&
      !w.locations.some(
        (location) =>
          location.id === box.locationId &&
          ["rack", "floor"].includes(location.kind),
      ) &&
      !(w.putawayTasks ?? []).some(
        (task) =>
          task.boxId === box.id &&
          ["claimed", "in_transit"].includes(task.status),
      ),
  );
  let fits = incoming.every((box) => reserve(box));
  for (const task of w.tasks.filter((task) => task.status !== "completed")) {
    const sku = w.skus.find((item) => item.id === task.skuId);
    const remaining = Math.max(0, task.boxesTarget - task.boxesCompleted);
    if (!sku) {
      fits = false;
      break;
    }
    for (let i = 0; fits && i < remaining; i++)
      fits = reserve({ skuId: sku.id, packagingSnapshot: sku.packaging });
  }
  return {
    reserve: (box: ProposedBox) => fits && reserve(box),
  };
}
