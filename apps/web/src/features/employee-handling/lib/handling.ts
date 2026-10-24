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
export function selectMovement(tasks: MovementDto[], employeeId: string) {
  if (!employeeId) return undefined;
  return tasks
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
  return scan === code || scan === `artmate-wms:${type}:${id}`;
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
