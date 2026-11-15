import type {
  EmployeeDto,
  PutawayTaskDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";
export type PutawayTab = "queued" | "mine" | "completed";
export type PutawayFilter = "open" | "active" | PutawayTab;
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
  employees?: Pick<EmployeeDto, "id" | "name">[];
};
export function matchesPutawayFilter(
  task: PutawayTaskDto,
  filter: PutawayFilter,
  actorId: string,
): boolean {
  switch (filter) {
    case "open":
      return task.status !== "completed";
    case "active":
      return isActivePutaway(task);
    case "mine":
      return !!actorId && task.employeeId === actorId && isActivePutaway(task);
    default:
      return task.status === filter;
  }
}

export function putawayQueue(
  data: QueueData,
  filter: PutawayFilter,
  actorId: string,
  search = "",
) {
  const query = search.trim().toLocaleLowerCase("ru-RU");
  const boxes = new Map(data.boxes.map((box) => [box.id, box.code]));
  const products = new Map(data.skus.map((sku) => [sku.id, sku.name]));
  const employees = new Map(
    data.employees?.map((employee) => [employee.id, employee.name]),
  );
  return data.putawayTasks
    .filter((task) => {
      if (!matchesPutawayFilter(task, filter, actorId)) return false;
      if (!query) return true;
      const searchable = [
        task.code,
        boxes.get(task.boxId),
        products.get(task.skuId),
        task.employeeId ? employees.get(task.employeeId) : undefined,
      ];
      return searchable
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("ru-RU")
        .includes(query);
    })
    .sort((a, b) =>
      filter === "completed"
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
      message: "Начните смену в своей учётной записи.",
      href: "/team",
      linkLabel: "Команда и смены",
    };
  if (task.status !== "queued")
    return {
      message: "Задание уже взято или завершено.",
    };
  const primary = data.tasks.find(
    (item) => item.employeeId === actor.id && item.status === "active",
  );
  if (primary)
    return {
      message: `Поставьте сборку ${primary.code} на паузу.`,
      href: "/assembly",
      linkLabel: "Открыть сборку",
    };
  const movement = data.movements.find(
    (item) =>
      item.employeeId === actor.id &&
      (item.status === "planned" || item.status === "in_transit"),
  );
  if (movement)
    return {
      message: `Сначала завершите перемещение ${movement.code}.`,
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

export function putawayTaskVisible(
  task: Pick<PutawayTaskDto, "employeeId" | "status">,
  employeeId: string,
): boolean {
  return (
    !!employeeId &&
    (task.employeeId === employeeId ||
      (task.status === "queued" && task.employeeId === null))
  );
}
