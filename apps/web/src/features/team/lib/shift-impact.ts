import type { WorkspaceDto } from "@/shared/api/generated/model";

/** UI guidance only: the API checks physical work again under its transaction lock. */
export function shiftStopBlocker(data: WorkspaceDto, employeeId: string) {
  const box = data.putawayTasks.find(
    (task) => task.employeeId === employeeId && task.status === "in_transit",
  );
  if (box) return `Сначала завершите размещение короба по заданию ${box.code}.`;
  const pallet = data.movements.find(
    (movement) =>
      movement.employeeId === employeeId && movement.status === "in_transit",
  );
  if (pallet) return `Сначала завершите перемещение паллеты ${pallet.code}.`;
  return null;
}

export function shiftStopImpact(data: WorkspaceDto, employeeId: string) {
  const messages: string[] = [];
  if (
    data.tasks.some(
      (task) => task.employeeId === employeeId && task.status === "active",
    )
  )
    messages.push(
      "Сборка встанет на паузу; содержимое короба и резервы сохранятся.",
    );
  if (
    data.putawayTasks.some(
      (task) => task.employeeId === employeeId && task.status === "claimed",
    )
  )
    messages.push(
      "Взятые, но ещё не начатые размещения коробов вернутся в свободную очередь.",
    );
  return messages.join(" ");
}

export function shiftDuration(seconds: number) {
  if (seconds <= 0) return "0 мин";
  const minutes = Math.floor(seconds / 60);
  if (!minutes) return "< 1 мин";
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} ч ${minutes % 60} мин` : `${minutes} мин`;
}
