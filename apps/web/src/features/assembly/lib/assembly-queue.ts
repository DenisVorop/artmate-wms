import type {
  EmployeeDto,
  TaskDto,
  WorkspaceDto,
} from "@/shared/api/generated/model";
export type QueueTab = "free" | "assigned" | "active" | "completed";
export const taskStatusLabels: Record<TaskDto["status"], string> = {
  queued: "В очереди",
  active: "В работе",
  paused: "На паузе",
  completed: "Завершено",
};
export function taskTab(task: TaskDto): QueueTab {
  return task.status === "completed"
    ? "completed"
    : task.status === "active"
      ? "active"
      : task.employeeId || task.status === "paused"
        ? "assigned"
        : "free";
}
export function compareQueue(a: TaskDto, b: TaskDto) {
  return (
    (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
    a.id.localeCompare(b.id)
  );
}
export function queueTasks(
  data: Pick<WorkspaceDto, "tasks"> & {
    skus: Pick<WorkspaceDto["skus"][number], "id" | "name">[];
    employees: Pick<EmployeeDto, "id" | "name">[];
  },
  tab: QueueTab,
  search = "",
) {
  const query = search.trim().toLocaleLowerCase("ru-RU");
  return data.tasks
    .filter(
      (task) =>
        taskTab(task) === tab &&
        (!query ||
          [
            task.code,
            data.skus.find((sku) => sku.id === task.skuId)?.name,
            data.employees.find((employee) => employee.id === task.employeeId)
              ?.name,
          ]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase("ru-RU")
            .includes(query)),
    )
    .sort(compareQueue);
}
export function assignmentBlocked(task: TaskDto): string | null {
  if (task.status === "completed")
    return "Завершённое задание нельзя переназначить.";
  if (task.scannedUnits > 0 || task.boxCodeConfirmed)
    return "Сначала закончите текущий короб. Переназначение доступно между коробами после паузы.";
  if (task.status === "active")
    return "Сначала поставьте задание на паузу от имени текущего исполнителя.";
  return null;
}
export function claimBlocked(
  task: TaskDto,
  actor: EmployeeDto | undefined,
  tasks: TaskDto[],
): string | null {
  if (!actor || actor.status !== "working")
    return "Начните смену в своей учётной записи.";
  if (task.status === "completed") return "Задание уже завершено.";
  if (task.status === "active") return "Задание уже в работе.";
  if (task.employeeId && task.employeeId !== actor.id)
    return "Задание назначено другому сотруднику. Руководитель может изменить назначение между коробами.";
  if (task.status === "paused" && task.employeeId !== actor.id)
    return "Продолжить приостановленное задание может только назначенный сотрудник.";
  const active = tasks.find(
    (candidate) =>
      candidate.status === "active" &&
      candidate.employeeId === actor.id &&
      candidate.id !== task.id,
  );
  return active
    ? `У сотрудника уже есть задание в работе: ${active.code}. Завершите его или поставьте на паузу.`
    : null;
}
export function preparationHint(units: number): string {
  return units === 20
    ? "Подготовьте 2 упаковки по 10 раскрасок."
    : `Подготовьте ${units.toLocaleString("ru-RU")} раскрасок для одного короба.`;
}
export function assemblyStep(
  task: TaskDto,
): "complete" | "inactive" | "recovery" | "source" | "box" | "items" {
  if (task.status === "completed") return "complete";
  if (task.status !== "active") return "inactive";
  if (task.scannedUnits === task.unitsPerBox && task.boxCodeConfirmed)
    return "recovery";
  const next = task.reservations.find(
    (reservation) => reservation.quantity > 0,
  );
  if (!next || next.palletId !== task.sourcePalletId) return "source";
  return task.boxCodeConfirmed ? "items" : "box";
}
export function nextSource(task: TaskDto) {
  return task.reservations.find((reservation) => reservation.quantity > 0);
}

export function assemblyTaskVisible(
  task: Pick<TaskDto, "employeeId" | "status">,
  employeeId: string,
): boolean {
  return (
    !!employeeId &&
    (task.employeeId === employeeId ||
      (task.status === "queued" && task.employeeId === null))
  );
}
