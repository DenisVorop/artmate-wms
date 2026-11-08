import type { TaskDto } from "./dto";

const allocationOrder = new Intl.Collator("en", { numeric: true });

export function assemblyQueueOrder(
  tasks: readonly TaskDto[],
  employeeId: string,
) {
  const recentBySku = new Map<string, string>();
  for (const task of tasks) {
    if (!task.startedAt && task.status !== "completed") continue;
    const started = task.startedAt ?? task.createdAt ?? "";
    if (started > (recentBySku.get(task.skuId) ?? ""))
      recentBySku.set(task.skuId, started);
  }
  return (a: TaskDto, b: TaskDto) =>
    Number(b.employeeId === employeeId) - Number(a.employeeId === employeeId) ||
    Number(a.autoPurpose === "backlog") - Number(b.autoPurpose === "backlog") ||
    (recentBySku.get(a.skuId) ?? "").localeCompare(
      recentBySku.get(b.skuId) ?? "",
    ) ||
    (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
    allocationOrder.compare(a.queueOrder ?? "", b.queueOrder ?? "") ||
    a.id.localeCompare(b.id);
}
