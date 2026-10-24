import type { WorkspaceDto } from "./generated/model";
import { isCurrentWorkspace, newestWorkspace } from "./workspace-shape";
export { isCurrentWorkspace } from "./workspace-shape";

type CommandPort = {
  command: () => Promise<WorkspaceDto>;
  cancelRead: () => Promise<unknown>;
  readCurrent: () => Promise<unknown>;
  getCached: () => unknown;
  setCached: (snapshot: WorkspaceDto) => void;
  invalidate: () => Promise<unknown>;
};

/** Once command resolves, a failed read must never invite repeating its write. */
export async function runWarehouseCommand(
  port: CommandPort,
): Promise<WorkspaceDto> {
  const previous = port.getCached();
  if (!isCurrentWorkspace(previous))
    throw new Error(
      "Данные склада ещё не загружены. Обновите страницу перед изменением.",
    );
  await port.cancelRead();
  const response = await port.command();
  try {
    // A polling read may have started while the command was executing.
    await port.cancelRead();
    const current = await port.readCurrent();
    if (isCurrentWorkspace(current)) {
      const result =
        newestWorkspace(current, newestWorkspace(response, port.getCached())) ??
        previous;
      port.setCached(result);
      return result;
    }
  } catch {
    // The write is already committed; polling will recover the current state.
  }
  const cached = port.getCached();
  const fallback = isCurrentWorkspace(cached) ? cached : previous;
  const result = newestWorkspace(response, fallback) ?? fallback;
  if (result === response) port.setCached(result);
  try {
    await port.invalidate();
  } catch {
    /* Refresh failure cannot turn a commit into a failed write. */
  }
  return result;
}
