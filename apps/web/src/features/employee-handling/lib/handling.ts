import type {
  MovementDto,
  PutawayTaskDto,
  ReceiptDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";
const oldest = <T extends { createdAt: string; id: string }>(a: T, b: T) =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
export function selectPutaway(tasks: PutawayTaskDto[], employeeId: string) {
  if (!employeeId) return undefined;
  const own = tasks.filter(
    (t) =>
      t.employeeId === employeeId &&
      ["claimed", "in_transit"].includes(t.status),
  );
  return (
    own.sort(
      (a, b) =>
        Number(b.status === "in_transit") - Number(a.status === "in_transit") ||
        oldest(a, b),
    )[0] ??
    tasks.filter((t) => t.status === "queued" && !t.employeeId).sort(oldest)[0]
  );
}
/** Scanning any ready box is allowed only after entering a live putaway zone.
 * A server-confirmed carried box always wins, including after refresh or zone loss.
 */
export function putawayWork(
  data: Pick<WorkspaceDto, "putawayTasks" | "warehouse">,
  employeeId: string,
) {
  const carrying = employeeId
    ? data.putawayTasks.find(
        (task) =>
          task.employeeId === employeeId && task.status === "in_transit",
      )
    : undefined;
  if (carrying) return { kind: "place" as const, task: carrying };
  const binding = employeeId
    ? data.warehouse.zoneWork?.find((work) => work.employeeId === employeeId)
    : undefined;
  const zone = data.warehouse.workZones?.find(
    (item) =>
      item.id === binding?.zoneId && item.kind === "putaway" && !item.archived,
  );
  return zone ? { kind: "take" as const, zone } : { kind: "zone" as const };
}
export function selectMovement(tasks: MovementDto[], employeeId: string) {
  if (!employeeId) return undefined;
  const own = tasks
    .filter(
      (t) =>
        t.employeeId === employeeId &&
        ["planned", "in_transit"].includes(t.status),
    )
    .sort(
      (a, b) =>
        Number(b.status === "in_transit") - Number(a.status === "in_transit") ||
        oldest(a, b),
    )[0];
  return (
    own ??
    tasks
      .filter(
        (task) =>
          task.employeeId === null &&
          task.status === "planned" &&
          task.autoPurpose === "accessible_raw",
      )
      .sort(oldest)[0]
  );
}
export function selectReceipt(receipts: ReceiptDto[]) {
  return receipts
    .filter(
      (r) => r.status !== "completed" && r.pallets.some((p) => !p.placedAt),
    )
    .sort(
      (a, b) => a.receivedAt.localeCompare(b.receivedAt) || oldest(a, b),
    )[0];
}
export function matchesScan(
  value: string,
  type: "box" | "pallet" | "location",
  id: string,
  code: string,
) {
  const scan = value.trim();
  return (
    scan === code ||
    scan === `artmate-wms:${type}:${id}` ||
    (type === "pallet" &&
      code.startsWith("PLT-PRE-") &&
      scan === `artmate-wms:pallet:${code}`)
  );
}
export function workBlock(
  data: Pick<
    WorkspaceDto,
    "employees" | "tasks" | "movements" | "putawayTasks"
  >,
  employeeId: string,
  kind: "putaway" | "receiving" | "movement",
  currentId?: string,
) {
  if (
    !employeeId ||
    data.employees.find((e) => e.id === employeeId)?.status !== "working"
  )
    return "Начните или продолжите смену, чтобы выполнять сканы.";
  const carryingBox = data.putawayTasks.find(
    (t) =>
      t.employeeId === employeeId &&
      t.status === "in_transit" &&
      !(kind === "putaway" && t.id === currentId),
  );
  if (carryingBox)
    return `Сначала разместите короб по заданию ${carryingBox.code}: он уже у вас.`;
  const carryingPallet = data.movements.find(
    (t) =>
      t.employeeId === employeeId &&
      t.status === "in_transit" &&
      !(kind === "movement" && t.id === currentId),
  );
  if (carryingPallet)
    return `Сначала завершите перемещение ${carryingPallet.code}: паллета уже у вас.`;
  if (
    kind === "putaway" &&
    !data.putawayTasks.some(
      (t) =>
        t.id === currentId &&
        t.employeeId === employeeId &&
        ["claimed", "in_transit"].includes(t.status),
    )
  ) {
    const movement = data.movements.find(
      (t) => t.employeeId === employeeId && t.status === "planned",
    );
    if (movement) return `Сначала завершите перемещение ${movement.code}.`;
    const primary = data.tasks.find(
      (t) => t.employeeId === employeeId && t.status === "active",
    );
    if (primary)
      return `Сначала поставьте сборку ${primary.code} на паузу в основном задании.`;
  }
  return null;
}

/** A free task is claimed explicitly; this only explains server checks. */
export function movementClaimBlock(
  data: Pick<
    WorkspaceDto,
    "employees" | "tasks" | "movements" | "putawayTasks" | "shipments"
  >,
  employeeId: string,
  movementId: string,
) {
  const block = workBlock(data, employeeId, "movement", movementId);
  if (block) return block;
  if (
    data.movements.some(
      (task) =>
        task.id !== movementId &&
        task.employeeId === employeeId &&
        task.status === "planned",
    )
  )
    return "Сначала завершите своё перемещение паллеты.";
  if (
    data.putawayTasks.some(
      (task) => task.employeeId === employeeId && task.status === "claimed",
    )
  )
    return "Сначала завершите размещение короба.";
  if (
    data.tasks.some(
      (task) =>
        task.employeeId === employeeId &&
        task.status !== "completed" &&
        (task.scannedUnits > 0 ||
          task.boxCodeConfirmed ||
          task.openBoxContents?.length > 0),
    )
  )
    return "Сначала завершите открытый короб.";
  if (
    data.shipments.some(
      (task) =>
        task.employeeId === employeeId &&
        task.status === "draft" &&
        (task.scannedBoxIds?.length ?? 0) > 0,
    )
  )
    return "Сначала завершите текущий отбор отгрузки.";
  if (
    data.tasks.some(
      (task) => task.employeeId === employeeId && task.status === "active",
    )
  )
    return "Сначала поставьте сборку на паузу.";
  return null;
}
