"use client";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createScreenAwake, type ScreenAwakeState } from "../lib/screen-awake";
import {
  createScanAudio,
  type ScanAudioState,
  type ScanSound,
} from "../lib/scan-audio";
import styles from "./employee-work-device.module.css";

const Context = createContext({
  active: false,
  screen: "off" as ScreenAwakeState,
  audio: "locked" as ScanAudioState,
  activate: () => {},
  test: () => {},
  play: (_kind: ScanSound) => {},
});
export const useEmployeeScanFeedback = () => useContext(Context);

export function EmployeeWorkDevice({
  active,
  sessionKey,
  children,
}: {
  active: boolean;
  sessionKey?: string;
  children: ReactNode;
}) {
  const [screen, setScreen] = useState<ScreenAwakeState>("off");
  const [audio, setAudio] = useState<ScanAudioState>("locked");
  const device = useRef<{
    screen: ReturnType<typeof createScreenAwake>;
    audio: ReturnType<typeof createScanAudio>;
  } | null>(null);
  useEffect(() => {
    setScreen("off");
    setAudio("locked");
    if (!active) return;
    const screen = createScreenAwake({
      request:
        navigator.wakeLock && window.isSecureContext
          ? () => navigator.wakeLock.request("screen")
          : undefined,
      visible: () => document.visibilityState === "visible",
      changed: setScreen,
    });
    const audio = createScanAudio({
      create: window.AudioContext ? () => new AudioContext() : undefined,
      changed: setAudio,
    });
    const owned = { screen, audio };
    device.current = owned;
    screen.setActive(true);
    const activate = () => {
      audio.unlock();
      screen.refresh();
    };
    const visibility = () => {
      screen.refresh();
    };
    const hide = () => {
      screen.setActive(false);
    };
    const show = () => {
      screen.setActive(true);
    };
    // Touchend/click are intentional: iOS may not grant audio activation on touchstart.
    document.addEventListener("click", activate, true);
    document.addEventListener("touchend", activate, true);
    document.addEventListener("keydown", activate, true);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    return () => {
      if (device.current === owned) device.current = null;
      document.removeEventListener("click", activate, true);
      document.removeEventListener("touchend", activate, true);
      document.removeEventListener("keydown", activate, true);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
      screen.close();
      audio.close();
    };
  }, [active, sessionKey]);
  const value = useMemo(
    () => ({
      active,
      screen,
      audio,
      activate: () => {
        device.current?.audio.unlock();
        device.current?.screen.refresh();
      },
      test: () => {
        const owned = device.current;
        owned?.audio.unlock(() => {
          if (device.current === owned) owned.audio.play("success");
        });
      },
      play: (kind: ScanSound) => {
        device.current?.audio.play(kind);
      },
    }),
    [active, screen, audio],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function EmployeeDeviceControls({
  details = false,
}: {
  details?: boolean;
}) {
  const device = useEmployeeScanFeedback();
  const activate = () => {
    device.activate();
    device.test();
    requestAnimationFrame(() => {
      if (document.querySelector("dialog[open]")) return;
      const input = [
        ...document.querySelectorAll<HTMLInputElement>(
          "input[data-employee-scan-input]:not(:disabled)",
        ),
      ].find((element) => element.getClientRects().length > 0);
      input?.focus({ preventScroll: true });
    });
  };
  if (!device.active) return null;
  if (!details && device.audio === "ready" && device.screen !== "unavailable")
    return null;
  return (
    <div className={styles.controls}>
      {(details || device.screen === "unavailable") && (
        <p role="status">
          {device.screen === "on"
            ? "Экран остаётся включённым"
            : device.screen === "requesting"
              ? "Включаем рабочий экран…"
              : "Телефон может погасить экран. Проверьте энергосбережение и откройте WMS по HTTPS."}
        </p>
      )}
      {device.audio === "unavailable" ? (
        <p role="status">
          Звук недоступен. Проверяйте результат скана на экране.
        </p>
      ) : device.audio !== "ready" ? (
        <button
          type="button"
          className="button button--secondary"
          onClick={activate}
        >
          Включить звук сканов
        </button>
      ) : (
        details && (
          <button
            type="button"
            className="button button--secondary"
            onClick={activate}
          >
            Проверить звук
          </button>
        )
      )}
      {details && (
        <p>
          Короткий высокий сигнал — скан принят. Тройной низкий — ошибка:
          остановитесь и посмотрите на экран. Проверьте громкость телефона.
        </p>
      )}
    </div>
  );
}
