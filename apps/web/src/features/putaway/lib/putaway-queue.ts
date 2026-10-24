import type {
  EmployeeDto,
  PutawayTaskDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";
export type PutawayTab = "queued" | "mine" | "completed";
export const putawayStatusLabels: Record<PutawayTaskDto["status"], string> = {
  queued: "Свободно",
  claimed: "Ожидает забора",
  in_transit: "У сотрудника",
  completed: "Размещён",
};
export const isActivePutaway = (task: PutawayTaskDto) =>
  task.status === "claimed" || task.status === "in_transit";
type QueueData = Pick<WorkspaceDto, "putawayTasks"> & {
  boxes: Pick<WorkspaceDto["boxes"][number], "id" | "code">[];
  skus: Pick<WorkspaceDto["skus"][number], "id" | "name">[];
};
export function putawayQueue(
  data: QueueData,
  tab: PutawayTab,
  actorId: string,
  search = "",
) {
  const query = search.trim().toLocaleLowerCase("ru-RU");
  return data.putawayTasks
    .filter(
      (task) =>
        (tab === "queued"
          ? task.status === "queued"
          : tab === "mine"
            ? !!actorId && task.employeeId === actorId && isActivePutaway(task)
            : task.status === "completed") &&
        (!query ||
          [
            task.code,
            data.boxes.find((box) => box.id === task.boxId)?.code,
            data.skus.find((sku) => sku.id === task.skuId)?.name,
          ]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase("ru-RU")
            .includes(query)),
    )
    .sort((a, b) =>
      tab === "completed"
        ? (b.completedAt ?? "").localeCompare(a.completedAt ?? "") ||
          b.id.localeCompare(a.id)
        : a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
}
export type ClaimBlock = { message: string; href?: string; linkLabel?: string };
export function putawayClaimBlocked(
  task: PutawayTaskDto,
  actor: EmployeeDto | undefined,
  data: Pick<WorkspaceDto, "tasks" | "movements" | "putawayTasks">,
): ClaimBlock | null {
  if (!actor || actor.status !== "working")
    return {
      message: "Выберите сотрудника на смене в поле «Работаем как».",
      href: "/team",
      linkLabel: "Команда и смены",
    };
  if (task.status !== "queued")
    return {
      message:
        "Это размещение уже взято или завершено. Обновлённый статус указан в карточке.",
    };
  const primary = data.tasks.find(
    (item) => item.employeeId === actor.id && item.status === "active",
  );
  if (primary)
    return {
      message: `У сотрудника в работе сборка ${primary.code}. Для добровольного размещения сначала поставьте её на паузу. Текущий короб и его состав сохранятся.`,
      href: "/assembly",
      linkLabel: "Открыть сборку и поставить на паузу",
    };
  const movement = data.movements.find(
    (item) =>
      item.employeeId === actor.id &&
      (item.status === "planned" || item.status === "in_transit"),
  );
  if (movement)
    return {
      message: `Сначала завершите перемещение ${movement.code}. Сотрудник не может одновременно перевозить паллету и размещать отдельный короб.`,
      href: "/movements",
      linkLabel: "Открыть перемещения",
    };
  const other = data.putawayTasks.find(
    (item) =>
      item.id !== task.id &&
      item.employeeId === actor.id &&
      isActivePutaway(item),
  );
  return other
    ? {
        message: `Сначала завершите своё размещение ${other.code}${other.status === "claimed" ? " или верните его в очередь до забора короба" : ": короб уже у сотрудника"}.`,
      }
    : null;
}
export function canWorkPutaway(
  task: PutawayTaskDto,
  actor: EmployeeDto | undefined,
): boolean {
  return (
    !!actor &&
    actor.status === "working" &&
    task.employeeId === actor.id &&
    isActivePutaway(task)
  );
}
export function canReleasePutaway(
  task: PutawayTaskDto,
  actor: EmployeeDto | undefined,
): boolean {
  return task.status === "claimed" && canWorkPutaway(task, actor);
}
export function putawayDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
}
