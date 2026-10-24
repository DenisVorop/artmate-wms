export type ScanQueueState = {
  pending: number;
  running: boolean;
  failedCode: string | null;
};
/** Serialized, context-bound scans. Equal item barcodes are separate observations. */
export function createScanQueue(port: {
  accept: (value: string) => Promise<boolean>;
  isCurrent: () => boolean;
  changed: (state: ScanQueueState) => void;
  failed: (value: string) => void;
  dropped: (count: number) => void;
  repeat: boolean;
}) {
  const items: string[] = [];
  let running = false,
    failed = false,
    closed = false;
  const publish = (settled = false) => {
    if (!closed && (settled || port.isCurrent()))
      port.changed({
        pending: items.length,
        running,
        failedCode: failed ? (items[0] ?? null) : null,
      });
  };
  const drain = async () => {
    if (running || failed || closed) return;
    running = true;
    publish();
    while (items.length && !closed && port.isCurrent()) {
      const value = items[0];
      let accepted = false;
      try {
        accepted = await port.accept(value);
      } catch {
        accepted = false;
      }
      if (accepted) items.shift();
      if (closed) break;
      if (!accepted || (!port.isCurrent() && items.length > 0)) {
        failed = true;
        port.failed(items[0]);
        break;
      }
      if (!port.isCurrent()) break;
      publish();
    }
    running = false;
    // A disabled context must still settle its local activity and expose recovery.
    // close() remains the boundary that prevents updates after unmount.
    publish(true);
  };
  return {
    enqueue(value: string) {
      const code = value.trim();
      if (!code || closed || !port.isCurrent()) return false;
      if (!port.repeat && running) return false;
      if (items.length >= 50 && !failed) return false;
      if (failed) {
        items[0] = code;
        failed = false;
      } else items.push(code);
      publish();
      void drain();
      return true;
    },
    discardFailed() {
      if (closed || running || !failed) return 0;
      const discarded = items.length;
      items.length = 0;
      failed = false;
      // Explicit recovery is local and remains available after external disabling.
      publish(true);
      return discarded;
    },
    close() {
      if (closed) return;
      closed = true;
      // The in-flight request is already owned by the API; only unsent scans stop.
      const dropped = Math.max(0, items.length - (running ? 1 : 0));
      items.length = running ? Math.min(1, items.length) : 0;
      if (dropped) port.dropped(dropped);
    },
  };
}
