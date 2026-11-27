import type {
  StocktakeSummaryDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";

export type WorkQueueKind =
  | "assembly"
  | "receiving"
  | "putaway"
  | "movement"
  | "shipping"
  | "stocktake";
export type WorkQueueState =
  | "queued"
  | "active"
  | "paused"
  | "review"
  | "completed"
  | "cancelled";
export type WorkQueueJob = {
  id: string;
  referenceId: string;
  palletId?: string;
  kind: WorkQueueKind;
  code: string;
  title: string;
  objectLabel: string;
  skuId: string | null;
  skuName: string | null;
  employeeId: string | null;
  employeeName: string | null;
  assignmentKnown: boolean;
  status: string;
  state: WorkQueueState;
  statusLabel: string;
  quantityLabel: string;
  fromLabel: string | null;
  toLabel: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** Existing screen. Only stocktakes currently support an exact document link. */
  href: string;
  autoPurpose?: "urgent" | "backlog";
  urgentPutaway?: boolean;
};
export function assemblyNeedsClearing(
  pressure: WorkspaceDto["assemblyPressure"],
) {
  return (
    !!pressure &&
    pressure.boxes > 0 &&
    (pressure.level === "near_full" || pressure.level === "full")
  );
}
export const workQueueKindLabels: Record<WorkQueueKind, string> = {
  assembly: "Сборка",
  receiving: "Приёмка",
  putaway: "Размещение коробов",
  movement: "Перемещение паллеты",
  shipping: "Отгрузка",
  stocktake: "Инвентаризация",
};
export const workQueueStateLabels: Record<WorkQueueState, string> = {
  queued: "В очереди",
  active: "В работе",
  paused: "На паузе",
  review: "На проверке",
  completed: "Завершено",
  cancelled: "Отменено",
};
const stateOrder: Record<WorkQueueState, number> = {
  active: 0,
  paused: 1,
  review: 2,
  queued: 3,
  completed: 4,
  cancelled: 5,
};

/** A read model of exactly the server projection supplied by the caller. */
export function buildWorkQueue(
  workspace: WorkspaceDto,
  stocktakes: StocktakeSummaryDto[] = [],
  options: { manager?: boolean } = {},
): WorkQueueJob[] {
  const jobs: WorkQueueJob[] = [];
  const skus = new Map(workspace.skus.map((sku) => [sku.id, sku]));
  const employees = new Map(
    workspace.employees.map((person) => [person.id, person]),
  );
  const locations = new Map(
    workspace.locations.map((place) => [place.id, place]),
  );
  const pallets = new Map(
    workspace.pallets.map((pallet) => [pallet.id, pallet]),
  );
  const boxes = new Map(workspace.boxes.map((box) => [box.id, box]));
  const location = (id: string | null | undefined) => {
    if (!id) return null;
    const place = locations.get(id);
    return place ? `${place.code} · ${place.name}` : "Адрес недоступен";
  };
  const movementAddress = (id: string) => {
    const place = locations.get(id);
    return place
      ? `${place.code}${place.kind === "rack" ? ` · ярус ${place.level}` : ""}`
      : "Адрес недоступен";
  };
  const add = (
    job: Omit<
      WorkQueueJob,
      | "id"
      | "title"
      | "employeeName"
      | "skuName"
      | "statusLabel"
      | "assignmentKnown"
    > & {
      statusLabel?: string;
      assignmentKnown?: boolean;
      employeeName?: string | null;
      title?: string;
    },
  ) => {
    jobs.push({
      ...job,
      id: `${job.kind}:${job.referenceId}${job.palletId ? `:${job.palletId}` : ""}`,
      title: job.title ?? workQueueKindLabels[job.kind],
      assignmentKnown: job.assignmentKnown ?? true,
      employeeName:
        job.employeeName ??
        (job.employeeId
          ? (employees.get(job.employeeId)?.name ?? "Исполнитель недоступен")
          : null),
      skuName: job.skuId ? (skus.get(job.skuId)?.name ?? null) : null,
      statusLabel: job.statusLabel ?? workQueueStateLabels[job.state],
    });
  };
  for (const task of workspace.tasks) {
    const source = pallets.get(
      task.reservations.find((reservation) => reservation.quantity > 0)
        ?.palletId ?? "",
    );
    add({
      referenceId: task.id,
      kind: "assembly",
      code: task.code,
      objectLabel: skus.get(task.skuId)?.name ?? task.code,
      skuId: task.skuId,
      employeeId: task.employeeId,
      status: task.status,
      state: task.status,
      quantityLabel: `${task.boxesCompleted} / ${task.boxesTarget} коробов · по ${task.unitsPerBox} шт.`,
      fromLabel:
        task.status === "completed" ? null : location(source?.locationId),
      toLabel: null,
      createdAt: task.createdAt,
      updatedAt: null,
      href: "/assembly",
      autoPurpose: task.autoPurpose,
    });
  }
  for (const receipt of workspace.receipts) {
    for (const row of receipt.pallets) {
      const pallet = pallets.get(row.palletId);
      const claim = !row.placedAt
        ? workspace.warehouse.zoneWork?.find(
            (work) =>
              work.jobKind === "receiving" &&
              work.jobId === receipt.id &&
              work.palletId === row.palletId,
          )
        : undefined;
      add({
        referenceId: receipt.id,
        palletId: row.palletId,
        kind: "receiving",
        code: receipt.code,
        objectLabel: pallet?.code ?? "Паллета приёмки",
        skuId: row.skuId,
        employeeId: row.placedByEmployeeId ?? claim?.employeeId ?? null,
        assignmentKnown: !!(options.manager || row.placedByEmployeeId || claim),
        status: row.placedAt
          ? "placed"
          : claim
            ? "claimed"
            : "awaiting_placement",
        state: row.placedAt ? "completed" : claim ? "active" : "queued",
        statusLabel: row.placedAt
          ? "Размещено"
          : claim
            ? "В работе"
            : "Ожидает размещения",
        quantityLabel: `${row.quantity} шт. · 1 паллета`,
        fromLabel: row.placedAt ? null : location(pallet?.locationId),
        toLabel: location(row.locationId),
        createdAt: receipt.createdAt,
        updatedAt: row.placedAt ?? receipt.createdAt,
        href: "/receiving",
      });
    }
  }
  for (const task of workspace.putawayTasks) {
    const urgentPutaway =
      task.status !== "completed" &&
      assemblyNeedsClearing(workspace.assemblyPressure) &&
      task.fromLocationId === workspace.assemblyPressure?.locationId;
    add({
      referenceId: task.id,
      kind: "putaway",
      code: task.code,
      objectLabel: boxes.get(task.boxId)?.code ?? "Короб",
      skuId: task.skuId,
      employeeId: task.employeeId,
      status: task.status,
      state:
        task.status === "queued"
          ? "queued"
          : task.status === "completed"
            ? "completed"
            : "active",
      statusLabel:
        task.status === "in_transit"
          ? "Короб в руках"
          : task.status === "claimed"
            ? "Взято в работу"
            : undefined,
      quantityLabel: `1 короб${boxes.get(task.boxId) ? ` · ${boxes.get(task.boxId)!.units} шт.` : ""}`,
      fromLabel: location(task.fromLocationId),
      toLabel: location(task.toLocationId),
      createdAt: task.createdAt,
      updatedAt:
        task.completedAt ?? task.takenAt ?? task.claimedAt ?? task.createdAt,
      href: "/putaway",
      urgentPutaway,
      title: task.transferZoneId
        ? "Перенести короб"
        : urgentPutaway
          ? "Разобрать сборочную паллету"
          : undefined,
    });
  }
  for (const movement of workspace.movements) {
    const pallet = pallets.get(movement.palletId);
    add({
      referenceId: movement.id,
      kind: "movement",
      code: movement.code,
      objectLabel: pallet?.code ?? "Паллета",
      skuId: pallet?.skuId ?? null,
      employeeId: movement.employeeId || null,
      status: movement.status,
      state:
        movement.status === "planned"
          ? "queued"
          : movement.status === "in_transit"
            ? "active"
            : movement.status,
      statusLabel:
        movement.status === "in_transit" ? "Паллета в пути" : undefined,
      quantityLabel: "1 паллета",
      fromLabel:
        movement.autoPurpose === "accessible_raw"
          ? movementAddress(movement.fromLocationId)
          : location(movement.fromLocationId),
      toLabel:
        movement.autoPurpose === "accessible_raw"
          ? movementAddress(movement.toLocationId)
          : location(movement.toLocationId),
      createdAt: movement.createdAt,
      updatedAt: movement.completedAt ?? movement.takenAt ?? movement.createdAt,
      href: "/movements",
      title:
        movement.autoPurpose === "accessible_raw"
          ? "Спустить сырьё ниже"
          : undefined,
    });
  }
  for (const shipment of workspace.shipments) {
    const picked =
      shipment.pickingMode === "box" &&
      shipment.boxIds.length > 0 &&
      shipment.boxIds.every((id) => shipment.scannedBoxIds?.includes(id));
    add({
      referenceId: shipment.id,
      kind: "shipping",
      code: shipment.code,
      objectLabel: shipment.wb
        ? `Поставка WB № ${shipment.wb.supplyId}`
        : (skus.get(shipment.skuId)?.name ?? shipment.code),
      skuId: shipment.wb ? null : shipment.skuId,
      employeeId: shipment.employeeId ?? null,
      status: shipment.status,
      state:
        shipment.status === "shipped"
          ? "completed"
          : picked
            ? "review"
            : shipment.employeeId
              ? "active"
              : "queued",
      statusLabel:
        shipment.status === "shipped"
          ? "Отгружено"
          : picked
            ? "Готово к отправке"
            : shipment.employeeId
              ? "В работе"
              : "Готово к отбору",
      quantityLabel: `${shipment.scannedBoxIds?.length ?? 0} / ${shipment.boxesRequested} коробов`,
      fromLabel: null,
      toLabel: null,
      createdAt: null,
      updatedAt: null,
      href: "/shipments",
    });
  }
  for (const document of stocktakes) {
    add({
      referenceId: document.id,
      kind: "stocktake",
      title:
        document.mode === "opening" ? "Первичная инвентаризация" : undefined,
      code: document.code,
      objectLabel: document.code,
      skuId: null,
      employeeId: document.employeeId,
      employeeName: document.employeeName,
      status: document.status,
      state:
        document.status === "approved"
          ? "completed"
          : document.status === "counting"
            ? "active"
            : document.status,
      quantityLabel: `${document.locationsCounted} / ${document.locationsTotal} адресов`,
      fromLabel: null,
      toLabel: null,
      createdAt: document.createdAt,
      updatedAt:
        document.approvedAt ?? document.cancelledAt ?? document.createdAt,
      href: `/stocktakes?stocktakeId=${encodeURIComponent(document.id)}`,
    });
  }
  return jobs.sort(
    (a, b) =>
      stateOrder[a.state] - stateOrder[b.state] ||
      (a.state === "queued" && b.state === "queued"
        ? Number(!!b.urgentPutaway) - Number(!!a.urgentPutaway)
        : 0) ||
      (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
      a.id.localeCompare(b.id),
  );
}

export type WorkQueueFilters = {
  kind?: WorkQueueKind | "all";
  state?: WorkQueueState | "open" | "archive" | "all";
  employeeId?: string | "all" | "free";
  search?: string;
};
export function filterWorkQueue(
  jobs: WorkQueueJob[],
  filters: WorkQueueFilters = {},
): WorkQueueJob[] {
  const state = filters.state ?? "open";
  const search = filters.search?.trim().toLocaleLowerCase("ru") ?? "";
  return jobs.filter((job) => {
    const closed = job.state === "completed" || job.state === "cancelled";
    if (filters.kind && filters.kind !== "all" && filters.kind !== job.kind)
      return false;
    if (
      state === "open"
        ? closed
        : state === "archive"
          ? !closed
          : state !== "all" && state !== job.state
    )
      return false;
    if (
      filters.employeeId === "free"
        ? !!job.employeeId || !job.assignmentKnown
        : filters.employeeId &&
          filters.employeeId !== "all" &&
          filters.employeeId !== job.employeeId
    )
      return false;
    return (
      !search ||
      [
        job.code,
        job.objectLabel,
        job.skuName,
        job.employeeName,
        job.fromLabel,
        job.toLabel,
        job.title,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("ru")
        .includes(search)
    );
  });
}

/** Presentation groups retain in-progress personal work, then urgent real box
 * tasks. Assigned queued assembly must not hide available pallet-clearing work. */
export function employeeWorkQueueGroups(
  jobs: WorkQueueJob[],
  employeeId: string,
) {
  const visible = jobs.filter(
    (job) => !job.employeeId || job.employeeId === employeeId,
  );
  const own = visible.filter((job) => job.employeeId === employeeId);
  const available = visible.filter(
    (job) => !job.employeeId && job.assignmentKnown,
  );
  const waiting = visible.filter(
    (job) => !job.employeeId && !job.assignmentKnown,
  );
  const clearing = visible.filter(
    (job) => job.urgentPutaway && job.state === "queued" && job.assignmentKnown,
  );
  if (!clearing.length)
    return [
      { title: "Мои задания", jobs: own },
      { title: "Свободные задания", jobs: available },
      { title: "Ожидают размещения", jobs: waiting },
    ];
  const protectedWork = own.filter((job) => job.state !== "queued");
  const urgentIds = new Set(clearing.map((job) => job.id));
  return [
    { title: "Мои задания", jobs: protectedWork },
    { title: "Разобрать сборочную паллету", jobs: clearing },
    {
      title: protectedWork.length ? "Назначено вам" : "Мои задания",
      jobs: own.filter(
        (job) => job.state === "queued" && !urgentIds.has(job.id),
      ),
    },
    {
      title: "Свободные задания",
      jobs: available.filter((job) => !urgentIds.has(job.id)),
    },
    { title: "Ожидают размещения", jobs: waiting },
  ];
}
