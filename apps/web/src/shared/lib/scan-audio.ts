export type ScanSound = "success" | "error";
export type ScanAudioState = "locked" | "ready" | "unavailable";

export function createScanAudio(port: {
  create?: () => AudioContext;
  changed: (state: ScanAudioState) => void;
}) {
  let context: AudioContext | null = null,
    closed = false,
    errorUntil = 0;
  const playing = new Set<OscillatorNode>();
  const update = () => {
    if (!closed)
      port.changed(context?.state === "running" ? "ready" : "locked");
  };
  const play = (kind: ScanSound) => {
    if (closed || !context || context.state !== "running") {
      update();
      return;
    }
    // A warning about dropped/failed scans must finish before any later success.
    if (kind === "success" && context.currentTime < errorUntil) return;
    const error = kind === "error";
    const duration = error ? 0.16 : 0.055;
    const gap = error ? 0.08 : 0.025;
    const volume = error ? 0.32 : 0.18;
    if (error) errorUntil = context.currentTime + 3 * (duration + gap);
    try {
      // The latest result replaces old tones; never announce stale queued success.
      for (const oscillator of playing) {
        try {
          oscillator.stop();
        } catch {}
      }
      playing.clear();
      const start = context.currentTime;
      const frequencies = error ? [2349, 1760, 2349] : [1046, 1397];
      frequencies.forEach((frequency, index) => {
        const oscillator = context!.createOscillator(),
          gain = context!.createGain();
        const at = start + index * (duration + gap);
        oscillator.type = error ? "square" : "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(volume, at + 0.008);
        // Hold the alarm's body; the former low triangular tone was too muffled.
        if (error) gain.gain.setValueAtTime(volume, at + duration - 0.012);
        gain.gain.linearRampToValueAtTime(0, at + duration);
        oscillator.connect(gain);
        gain.connect(context!.destination);
        playing.add(oscillator);
        oscillator.onended = () => {
          playing.delete(oscillator);
          oscillator.disconnect();
          gain.disconnect();
        };
        oscillator.start(at);
        oscillator.stop(at + duration + 0.005);
      });
    } catch {
      port.changed("unavailable");
    }
  };
  return {
    unlock(ready?: () => void) {
      if (closed) return;
      try {
        if (!context) {
          if (!port.create) {
            port.changed("unavailable");
            return;
          }
          context = port.create();
          context.addEventListener("statechange", update);
        }
        // Called directly in a touch/key handler, before any await or API request.
        if (context.state !== "running")
          void context.resume().then(
            () => {
              update();
              if (!closed && context?.state === "running") ready?.();
            },
            () => {
              if (!closed) port.changed("locked");
            },
          );
        else ready?.();
        update();
      } catch {
        port.changed("unavailable");
      }
    },
    play,
    close() {
      closed = true;
      playing.clear();
      if (context) {
        context.removeEventListener("statechange", update);
        void context.close().catch(() => {});
      }
    },
  };
}
