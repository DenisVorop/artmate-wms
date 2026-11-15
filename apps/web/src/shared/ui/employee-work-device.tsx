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
  const wakeLock = useRef<ReturnType<typeof createScreenAwake> | null>(null);
  const scanAudio = useRef<ReturnType<typeof createScanAudio> | null>(null);
  useEffect(() => {
    setScreen("off");
    if (!active) return;
    const screen = createScreenAwake({
      request:
        navigator.wakeLock && window.isSecureContext
          ? () => navigator.wakeLock.request("screen")
          : undefined,
      visible: () => document.visibilityState === "visible",
      changed: setScreen,
    });
    wakeLock.current = screen;
    screen.setActive(true);
    const visibility = () => screen.refresh();
    const hide = () => screen.setActive(false);
    const show = () => screen.setActive(true);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    return () => {
      if (wakeLock.current === screen) wakeLock.current = null;
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
      screen.close();
      scanAudio.current?.silence();
    };
  }, [active, sessionKey]);

  useEffect(() => {
    setAudio("locked");
    if (!sessionKey) return;
    const audio = createScanAudio({
      create: window.AudioContext ? () => new AudioContext() : undefined,
      changed: setAudio,
    });
    scanAudio.current = audio;
    const activate = (event: Event) => {
      if (!event.isTrusted) return;
      audio.unlock();
      wakeLock.current?.refresh();
    };
    // Capture the shift-start gesture too: the shift request finishes after it.
    // Touchend/click and real scanner key events can activate audio on iOS.
    document.addEventListener("click", activate, true);
    document.addEventListener("touchend", activate, true);
    document.addEventListener("keydown", activate, true);
    return () => {
      if (scanAudio.current === audio) scanAudio.current = null;
      document.removeEventListener("click", activate, true);
      document.removeEventListener("touchend", activate, true);
      document.removeEventListener("keydown", activate, true);
      audio.close();
    };
  }, [sessionKey]);
  const value = useMemo(
    () => ({
      active,
      screen,
      audio,
      play: (kind: ScanSound) => {
        if (active) scanAudio.current?.play(kind);
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
  const screenUnavailable = device.active && device.screen === "unavailable";
  const audioUnavailable =
    device.active && details && device.audio === "unavailable";
  if (!screenUnavailable && !audioUnavailable) return null;

  return (
    <div className={styles.controls}>
      {screenUnavailable && (
        <p role="status">
          Телефон может погасить экран. Проверьте энергосбережение и откройте
          WMS по HTTPS.
        </p>
      )}
      {audioUnavailable && (
        <p role="status">
          Звук недоступен. Проверяйте результат скана на экране.
        </p>
      )}
    </div>
  );
}
