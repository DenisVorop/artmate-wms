"use client";
import { useState } from "react";

/** Image readiness belongs to this exact response and retry, never a prior QR. */
export function useLabelPrint(identity: string, svg?: string) {
  const [attempt, setAttempt] = useState(0);
  const [image, setImage] = useState<{
    key: string;
    status: "loaded" | "failed";
  } | null>(null);
  const key = `${identity}:${attempt}:${svg ?? ""}`;
  const ready = !!svg && image?.key === key && image.status === "loaded";
  const failed = image?.key === key && image.status === "failed";
  return {
    key,
    ready,
    failed,
    markLoaded: () => setImage({ key, status: "loaded" }),
    markFailed: () => setImage({ key, status: "failed" }),
    retryImage: () => setAttempt((value) => value + 1),
    print: () => {
      if (ready) window.print();
    },
  };
}
