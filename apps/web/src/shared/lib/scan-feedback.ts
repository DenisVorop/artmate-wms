import type { ScanSound } from "./scan-audio";

/** Preserve the synchronous gateway fast path. Queue admission is never success. */
export function scanWithFeedback<T extends string | boolean>(
  operation: () => T | Promise<T>,
  outcome: (result: T) => ScanSound | null,
  current: () => boolean,
  play: (kind: ScanSound) => void,
): T | Promise<T> {
  const completed = (result: T) => {
    const kind = outcome(result);
    if (kind && current()) play(kind);
    return result;
  };
  const failed = (error: unknown): never => {
    if (current()) play("error");
    throw error;
  };
  try {
    const result = operation();
    return typeof result === "object"
      ? result.then(completed, failed)
      : completed(result);
  } catch (error) {
    return failed(error);
  }
}
