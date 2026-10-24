"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { startCameraScanner } from "../lib/camera-scanner";
import styles from "./employee-camera.module.css";

export function EmployeeCamera({
  label,
  current,
  onCode,
  onClose,
}: {
  label: string;
  current: () => boolean;
  onCode: (value: string) => void;
  onClose: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const live = useRef({ current, onCode, onClose });
  live.current = { current, onCode, onClose };
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => {
    if (!video.current) return;
    let active = true;
    setReady(false);
    setError(null);
    const scanner = startCameraScanner({
      video: video.current,
      current: () =>
        active &&
        live.current.current() &&
        document.visibilityState !== "hidden",
      onReady: () => setReady(true),
      onError: setError,
      onResult: (value) => {
        if (!active || !live.current.current()) return;
        // Release the modal before gateway routing or field focus restoration.
        dialog.current?.close();
        live.current.onCode(value);
      },
    });
    const cancel = () => {
      active = false;
      scanner.stop();
      live.current.onClose();
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") cancel();
    };
    const timer = window.setInterval(() => {
      if (!live.current.current()) cancel();
    }, 150);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", hidden);
      scanner.stop();
    };
  }, [attempt]);
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className={styles.header}>
        <h2 id={`${id}-title`}>
          <Camera size={22} /> Сканировать камерой
        </h2>
        <button
          type="button"
          className={styles.close}
          aria-label="Закрыть камеру"
          onClick={onClose}
          autoFocus
        >
          <X size={24} />
        </button>
      </div>
      <p id={`${id}-description`} className={styles.description}>
        {label}
      </p>
      <div className={styles.preview}>
        <video
          ref={video}
          autoPlay
          muted
          playsInline
          aria-label="Изображение с камеры"
        />
        {!error && <div className={styles.frame} aria-hidden="true" />}
      </div>
      <p className={styles.status} role={error ? "alert" : "status"}>
        {error ||
          (ready
            ? "Наведите камеру на один QR или штрихкод"
            : "Включаем камеру…")}
      </p>
      {error && (
        <button
          type="button"
          className={`button button--primary ${styles.retry}`}
          onClick={() => setAttempt((n) => n + 1)}
        >
          Попробовать снова
        </button>
      )}
    </dialog>
  );
}
