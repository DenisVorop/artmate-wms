import type { PutawayTaskDto } from "@/shared/api/generated/model";
import type { PutawayTab } from "./putaway-queue";
export type PutawayAction = "claim" | "take" | "place" | "release";
export function putawayTransition(
  action: PutawayAction,
  task: PutawayTaskDto,
): { tab: PutawayTab; selectedId: string; notice: string } {
  const tab =
    task.status === "completed"
      ? "completed"
      : task.status === "queued"
        ? "queued"
        : "mine";
  const notice =
    action === "place" && task.status === "completed"
      ? "Короб размещён."
      : action === "release" && task.status === "queued"
        ? "Задание возвращено в очередь. Адрес освобождён."
        : action === "take" && task.status === "in_transit"
          ? "Короб забран."
          : action === "claim" && task.status === "claimed"
            ? "Задание взято. Адрес зарезервирован."
            : "Статус задания обновлён.";
  return { tab, selectedId: task.id, notice };
}
