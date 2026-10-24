import type { TaskDto } from "@/shared/api/generated/model";
import { taskTab, type QueueTab } from "./assembly-queue";
export type AssemblyTransition = {
  selectedId: string;
  tab: QueueTab;
  notice: string;
  kind: "scan" | "box" | "next" | "complete" | "unchanged";
};
/** Interpret the committed server snapshot; never pack or claim in a client effect. */
export function afterAssemblyCommand(
  before: TaskDto,
  tasks: TaskDto[],
  actorId: string,
): AssemblyTransition {
  const task = tasks.find((candidate) => candidate.id === before.id);
  if (!task)
    return {
      selectedId: before.id,
      tab: taskTab(before),
      notice: "Команда выполнена. Обновите данные, чтобы увидеть задание.",
      kind: "unchanged",
    };
  if (task.status === "completed" && before.status !== "completed") {
    const next = tasks.find(
      (candidate) =>
        candidate.status === "active" &&
        candidate.employeeId === actorId &&
        candidate.id !== task.id,
    );
    return next
      ? {
          selectedId: next.id,
          tab: "active",
          notice: `${task.code} завершено. Сервер взял следующее задание ${next.code}. Подтвердите источник и новый короб.`,
          kind: "next",
        }
      : {
          selectedId: task.id,
          tab: "completed",
          notice: `${task.code} завершено. На общий накопитель собрано коробов: ${task.boxesCompleted}. Доступных заданий для этого сотрудника сейчас нет — сотрудник свободен.`,
          kind: "complete",
        };
  }
  if (task.boxesCompleted > before.boxesCompleted)
    return {
      selectedId: task.id,
      tab: taskTab(task),
      notice: `Короб закрыт и добавлен на общую накопительную паллету. ${task.code}: ${task.boxesCompleted} из ${task.boxesTarget}. Следующий короб — ${task.openBoxCode}; подтвердите паллету-источник, затем код короба.`,
      kind: "box",
    };
  if (task.scannedUnits > before.scannedUnits)
    return {
      selectedId: task.id,
      tab: taskTab(task),
      notice: `Раскраска учтена: ${task.scannedUnits} из ${task.unitsPerBox} в текущем коробе.`,
      kind: "scan",
    };
  return {
    selectedId: task.id,
    tab: taskTab(task),
    notice: "Состояние задания подтверждено сервером.",
    kind: "unchanged",
  };
}
