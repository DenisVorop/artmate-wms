import type { TaskDto } from "@/shared/api/generated/model";

export function selectEmployeeAssembly(
  tasks: TaskDto[],
  employeeId: string,
): TaskDto | undefined {
  if (!employeeId) return undefined;
  const ordered = [...tasks].sort(
    (a, b) =>
      (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
      a.id.localeCompare(b.id),
  );
  return (
    ordered.find(
      (task) => task.employeeId === employeeId && task.status === "active",
    ) ??
    ordered.find(
      (task) => task.employeeId === employeeId && task.status === "paused",
    ) ??
    ordered.find(
      (task) => task.employeeId === employeeId && task.status === "queued",
    ) ??
    ordered.find((task) => task.employeeId === null && task.status === "queued")
  );
}

export function employeeAssemblyStep(
  task: TaskDto,
): "claim" | "resume" | "source" | "box" | "items" | "recovery" | "complete" {
  if (task.status === "completed") return "complete";
  if (task.status === "queued") return "claim";
  if (task.status === "paused") return "resume";
  if (task.boxCodeConfirmed && task.scannedUnits === task.unitsPerBox)
    return "recovery";
  const next = task.reservations.find(
    (reservation) => reservation.quantity > 0,
  );
  if (!next || next.palletId !== task.sourcePalletId) return "source";
  return task.boxCodeConfirmed ? "items" : "box";
}

export function employeeAssemblyScanContext(task: TaskDto): string {
  const step = employeeAssemblyStep(task);
  const source =
    step === "source"
      ? (task.reservations.find((reservation) => reservation.quantity > 0)
          ?.palletId ?? "missing")
      : "";
  return `${task.id}:${task.openBoxCode}:${step}:${source}`;
}

export function employeeAssemblyResult(
  before: TaskDto,
  tasks: TaskDto[],
  employeeId: string,
): string | null {
  const updated = tasks.find((task) => task.id === before.id);
  if (!updated) return null;
  if (updated.status === "completed" && before.status !== "completed") {
    const next = tasks.find(
      (task) =>
        task.id !== before.id &&
        task.employeeId === employeeId &&
        task.status === "active",
    );
    return next
      ? `Задание завершено. Следующее — ${next.code}.`
      : `Задание завершено. Собрано коробов: ${updated.boxesCompleted}.`;
  }
  return updated.boxesCompleted > before.boxesCompleted
    ? "Короб готов. Поставьте его на общую паллету в зоне сборки."
    : null;
}
