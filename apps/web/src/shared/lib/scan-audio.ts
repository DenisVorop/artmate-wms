export type ScanSound = "success" | "error";
export type ScanAudioState = "locked" | "ready" | "unavailable";

export function createScanAudio(port: {
  create?: () => AudioContext;
  changed: (state: ScanAudioState) => void;
}) {
  let context: AudioContext | null = null,
    closed = false,
    errorUntil = 0,
    resuming = 0,
    pending: ScanSound | null = null;

  const playing = new Set<OscillatorNode>();
  const stopTones = () => {
    for (const oscillator of playing) {
      try {
        oscillator.stop();
      } catch {}
    }
    playing.clear();
  };
  const silence = () => {
    pending = null;
    errorUntil = 0;
    stopTones();
  };
  const update = () => {
    if (!closed)
      port.changed(context?.state === "running" ? "ready" : "locked");
  };
  const play = (kind: ScanSound) => {
    if (closed || !context || context.state !== "running") {
      if (!closed && resuming > 0 && pending !== "error") pending = kind;
      update();
      return;
    }
    // A warning about dropped/failed scans must finish before any later success.
    if (kind === "success" && context.currentTime < errorUntil) return;
    const error = kind === "error";
    const duration = error ? 0.45 : 0.055;
    const gap = error ? 0 : 0.025;
    const volume = error ? 0.72 : 0.18;
    const frequencies = error ? [185] : [1046, 1397];
    if (error)
      errorUntil = context.currentTime + frequencies.length * (duration + gap);
    try {
      // The latest result replaces old tones; never announce stale queued success.
      stopTones();
      const start = context.currentTime;
      frequencies.forEach((frequency, index) => {
        const oscillator = context!.createOscillator(),
          gain = context!.createGain();
        const at = start + index * (duration + gap);
        oscillator.type = error ? "triangle" : "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(volume, at + 0.008);
        // A sustained low triangle keeps the alarm full without sharp harmonics.
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
        if (context.state !== "running") {
          const resumed = context.resume();
          resuming++;
          const settled = () => {
            resuming--;
            const result = pending;
            if (context?.state === "running" || resuming === 0) pending = null;
            update();
            if (!closed && context?.state === "running") {
              if (result) play(result);
              ready?.();
            }
          };
          void resumed.then(settled, settled);
        } else ready?.();
        update();
      } catch {
        port.changed("unavailable");
      }
    },
    play,
    silence,
    close() {
      closed = true;
      silence();
      if (context) {
        context.removeEventListener("statechange", update);
        void context.close().catch(() => {});
      }
    },
  };
}
