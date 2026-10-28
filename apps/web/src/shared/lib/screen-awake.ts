export type ScreenAwakeState = "off" | "requesting" | "on" | "unavailable";
export type ScreenLock = {
  readonly released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
};

/** Owns one visible work session, including requests that resolve after it ends. */
export function createScreenAwake(port: {
  request?: () => Promise<ScreenLock>;
  visible: () => boolean;
  changed: (state: ScreenAwakeState) => void;
}) {
  let active = false,
    disposed = false,
    version = 0;
  let lock: ScreenLock | null = null,
    requesting: number | null = null;
  const release = (value: ScreenLock) => {
    void value.release().catch(() => {});
  };
  const clear = () => {
    version++;
    requesting = null;
    const previous = lock;
    lock = null;
    if (previous) release(previous);
  };
  const refresh = () => {
    if (disposed) return;
    if (!active || !port.visible()) {
      clear();
      port.changed("off");
      return;
    }
    if ((lock && !lock.released) || requesting === version) return;
    if (!port.request) {
      port.changed("unavailable");
      return;
    }
    const started = version;
    requesting = started;
    port.changed("requesting");
    void (async () => {
      try {
        const acquired = await port.request!();
        if (disposed || !active || started !== version || !port.visible()) {
          release(acquired);
          return;
        }
        lock = acquired;
        acquired.addEventListener("release", () => {
          if (lock !== acquired || disposed) return;
          lock = null;
          port.changed(active && port.visible() ? "unavailable" : "off");
        });
        if (acquired.released) {
          lock = null;
          port.changed("unavailable");
        } else port.changed("on");
      } catch {
        if (!disposed && started === version) port.changed("unavailable");
      } finally {
        if (requesting === started) requesting = null;
      }
    })();
  };
  return {
    setActive(value: boolean) {
      if (disposed) return;
      if (active !== value) {
        clear();
        active = value;
      }
      refresh();
    },
    refresh,
    close() {
      disposed = true;
      active = false;
      clear();
    },
  };
}
