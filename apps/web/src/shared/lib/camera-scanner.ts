/** One opening accepts one code. A new opening may accept the same SKU again. */
export type CameraDecoder = {
  start: (
    stream: MediaStream,
    video: HTMLVideoElement,
    decoded: (value: string) => void,
  ) => Promise<{ stop: () => void }>;
};
type CameraPorts = {
  video: HTMLVideoElement;
  current: () => boolean;
  onResult: (value: string) => void;
  onReady: () => void;
  onError: (message: string) => void;
};
type CameraDependencies = {
  getStream: () => Promise<MediaStream>;
  loadDecoder: () => Promise<CameraDecoder>;
};
const browserDependencies: CameraDependencies = {
  getStream: () => {
    if (!window.isSecureContext)
      throw new Error("Откройте WMS по HTTPS, чтобы использовать камеру.");
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error(
        "Камера недоступна в этом браузере. Откройте WMS в Safari или Chrome.",
      );
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
  },
  loadDecoder: async () => {
    const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] =
      await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
    const hints = new Map([
      [
        DecodeHintType.POSSIBLE_FORMATS,
        [
          BarcodeFormat.QR_CODE,
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
        ],
      ],
    ]);
    const reader = new BrowserMultiFormatReader(hints, {
      delayBetweenScanAttempts: 150,
      delayBetweenScanSuccess: 300,
      tryPlayVideoTimeout: 10000,
    });
    return {
      start: (stream, video, decoded) =>
        reader.decodeFromStream(stream, video, (result) => {
          if (result) decoded(result.getText());
        }),
    };
  },
};
export function cameraErrorMessage(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError")
    return "Разрешите доступ к камере в настройках браузера и попробуйте снова.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError")
    return "Камера не найдена. Можно ввести код вручную.";
  if (name === "NotReadableError" || name === "TrackStartError")
    return "Камера занята. Закройте другое приложение с камерой и повторите.";
  return error instanceof Error && error.message
    ? error.message
    : "Не удалось запустить камеру. Попробуйте снова или введите код вручную.";
}
export function startCameraScanner(
  port: CameraPorts,
  dependencies: CameraDependencies = browserDependencies,
) {
  let closed = false;
  let stream: MediaStream | null = null;
  let controls: { stop: () => void } | null = null;
  const releaseControls = (value: { stop: () => void } | null) => {
    try {
      // Some devices make torch cleanup asynchronous; tracks still must stop.
      if (value) void Promise.resolve(value.stop()).catch(() => {});
    } catch {
      // A decoder cleanup failure must not keep the physical camera running.
    }
  };
  const stop = () => {
    closed = true;
    const activeControls = controls;
    controls = null;
    releaseControls(activeControls);
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    port.video.srcObject = null;
  };
  const current = () => !closed && port.current();
  void (async () => {
    try {
      if (!current()) return stop();
      stream = await dependencies.getStream();
      if (!current()) return stop();
      const decoder = await dependencies.loadDecoder();
      if (!current()) return stop();
      const started = await decoder.start(stream, port.video, (value) => {
        if (!current() || !value.trim()) return;
        stop();
        port.onResult(value);
      });
      controls = started;
      if (!current()) return stop();
      port.onReady();
    } catch (error) {
      const report = current();
      stop();
      if (report) port.onError(cameraErrorMessage(error));
    }
  })();
  return { stop };
}
