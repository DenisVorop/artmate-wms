export type StocktakeCommandPorts<T> = {
  isScopeCurrent: () => boolean;
  cancelReads: () => Promise<unknown>;
  command: () => Promise<T>;
  cache: (result: T) => void;
  invalidate: () => Promise<unknown>;
};

/** A successful write stays successful if a subsequent read fails. Scope changes never do. */
export async function runStocktakeCommand<T>(
  ports: StocktakeCommandPorts<T>,
): Promise<T> {
  const assertScope = () => {
    if (!ports.isScopeCurrent())
      throw new Error(
        "Сессия изменилась. Результат прежнего пользователя отклонён.",
      );
  };
  assertScope();
  await ports.cancelReads();
  assertScope();
  const result = await ports.command();
  assertScope();
  try {
    await ports.cancelReads();
  } catch {
    /* A committed write must not be reported as a failed save. */
  }
  assertScope();
  ports.cache(result);
  try {
    await ports.invalidate();
  } catch {
    /* The saved document remains authoritative; polling can retry reads. */
  }
  assertScope();
  return result;
}
