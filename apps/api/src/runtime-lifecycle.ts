type Stoppable = { stop(): Promise<void> };
/** Abort all producers first; their cleanup may need SQL until every stop resolves. */
export function createShutdown(
  stoppables: Stoppable[],
  close: () => Promise<void>,
) {
  let pending: Promise<void> | undefined;
  return () =>
    (pending ??= (async () => {
      const stopped = await Promise.allSettled(
        stoppables.map((service) => service.stop()),
      );
      await close();
      if (stopped.some((result) => result.status === "rejected"))
        throw new Error("Background work could not shut down cleanly");
    })());
}
