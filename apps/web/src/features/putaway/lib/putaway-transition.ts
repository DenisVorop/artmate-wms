import type { PutawayTaskDto } from "@/shared/api/generated/model";
import type { PutawayTab } from "./putaway-queue";
export type PutawayAction = "claim" | "take" | "place" | "release";
/** A completed secondary job never claims another job, either secondary or primary. */
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
      ? `${task.code}: короб размещён на тематической паллете хранения. Баланс сохранён. Следующее размещение можно взять из очереди по желанию.`
      : action === "release" && task.status === "queued"
        ? `${task.code} возвращено в очередь. Резерв адреса снят; короб остаётся на накопительной паллете.`
        : action === "take" && task.status === "in_transit"
          ? `${task.code}: короб у сотрудника. Доставьте его на зарезервированный адрес и подтвердите размещение. Освободить задание после забора нельзя.`
          : action === "claim" && task.status === "claimed"
            ? `${task.code} взято. Адрес хранения зарезервирован; подтвердите короб и адрес накопителя, чтобы забрать его.`
            : `Состояние ${task.code} подтверждено сервером.`;
  return { tab, selectedId: task.id, notice };
}
