import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startCameraScanner,
  cameraErrorMessage,
  type CameraDecoder,
} from "./camera-scanner";
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup(
  options: {
    stream?: Promise<MediaStream>;
    decoder?: Promise<CameraDecoder>;
  } = {},
) {
  let trackStops = 0,
    decoderStops = 0,
    ready = 0,
    active = true;
  let decoded: ((value: string) => void) | undefined;
  const stream = {
    getTracks: () => [{ stop: () => trackStops++ }],
  } as unknown as MediaStream;
  const video = { srcObject: stream } as HTMLVideoElement;
  const codes: string[] = [],
    errors: string[] = [];
  const decoder: CameraDecoder = {
    start: async (_stream, _video, callback) => {
      decoded = callback;
      return { stop: () => decoderStops++ };
    },
  };
  const scanner = startCameraScanner(
    {
      video,
      current: () => active,
      onResult: (code) => codes.push(code),
      onReady: () => ready++,
      onError: (error) => errors.push(error),
    },
    {
      getStream: () => options.stream ?? Promise.resolve(stream),
      loadDecoder: () => options.decoder ?? Promise.resolve(decoder),
    },
  );
  return {
    scanner,
    stream,
    video,
    codes,
    errors,
    decode: (code: string) => decoded?.(code),
    stale: () => {
      active = false;
    },
    counts: () => ({ trackStops, decoderStops, ready }),
  };
}
test("one camera opening accepts one code even when several frames decode it", async () => {
  const run = setup();
  await tick();
  run.decode("EAN-123");
  run.decode("EAN-123");
  run.decode("OTHER");
  assert.deepEqual(run.codes, ["EAN-123"]);
  assert.equal(run.counts().trackStops, 1);
  assert.equal(run.counts().decoderStops, 1);
  assert.equal(run.video.srcObject, null);
});
test("a new camera opening accepts the identical SKU again", async () => {
  const first = setup();
  await tick();
  first.decode("4601234567890");
  const second = setup();
  await tick();
  second.decode("4601234567890");
  assert.deepEqual(
    [...first.codes, ...second.codes],
    ["4601234567890", "4601234567890"],
  );
});
test("cancel before permission resolves stops the late stream without starting decoder", async () => {
  const permission = deferred<MediaStream>();
  const run = setup({ stream: permission.promise });
  run.scanner.stop();
  permission.resolve(run.stream);
  await tick();
  assert.deepEqual(run.counts(), { trackStops: 1, decoderStops: 0, ready: 0 });
  assert.deepEqual(run.codes, []);
  assert.deepEqual(run.errors, []);
});
test("cancel during decoder loading stops tracks and ignores late decoder", async () => {
  const loading = deferred<CameraDecoder>();
  const run = setup({ decoder: loading.promise });
  await tick();
  run.scanner.stop();
  loading.resolve({
    start: async () => {
      assert.fail("must not start after close");
    },
  });
  await tick();
  assert.equal(run.counts().trackStops, 1);
  assert.deepEqual(run.codes, []);
});
test("auth or operation becoming stale prevents decoded result", async () => {
  const run = setup();
  await tick();
  run.stale();
  run.decode("artmate-wms:box:BOX-TEST");
  assert.deepEqual(run.codes, []);
  run.scanner.stop();
  assert.equal(run.counts().trackStops, 1);
});
test("permission rejection is actionable and no result is emitted", async () => {
  const permission = deferred<MediaStream>();
  const run = setup({ stream: permission.promise });
  permission.reject(new DOMException("Permission denied", "NotAllowedError"));
  await tick();
  assert.equal(run.errors.length, 1);
  assert.match(run.errors[0], /Разрешите доступ/);
  assert.deepEqual(run.codes, []);
});
test("error from canceled permission prompt does not update closed UI", async () => {
  const permission = deferred<MediaStream>();
  const run = setup({ stream: permission.promise });
  run.scanner.stop();
  permission.reject(new DOMException("Permission denied", "NotAllowedError"));
  await tick();
  assert.deepEqual(run.errors, []);
});
test("decoder startup failure releases camera and reports recovery", async () => {
  const loading = deferred<CameraDecoder>();
  const run = setup({ decoder: loading.promise });
  await tick();
  loading.reject(new Error("Decoder unavailable"));
  await tick();
  assert.equal(run.counts().trackStops, 1);
  assert.deepEqual(run.errors, ["Decoder unavailable"]);
});
test("result before decoder controls resolve still closes the late decoder", async () => {
  const controls = deferred<{ stop: () => void }>();
  let stopped = 0;
  const run = setup({
    decoder: Promise.resolve({
      start: async (_stream, _video, decoded) => {
        decoded("QR-ONCE");
        return controls.promise;
      },
    }),
  });
  await tick();
  assert.deepEqual(run.codes, ["QR-ONCE"]);
  controls.resolve({ stop: () => stopped++ });
  await tick();
  assert.equal(stopped, 1);
  assert.equal(run.counts().trackStops, 1);
  assert.equal(run.counts().ready, 0);
});
test("camera error hints distinguish unavailable and busy devices", () => {
  assert.match(
    cameraErrorMessage(new DOMException("missing", "NotFoundError")),
    /не найдена/,
  );
  assert.match(
    cameraErrorMessage(new DOMException("busy", "NotReadableError")),
    /занята/,
  );
});

test("context changes during decoder startup release both late controls and tracks", async () => {
  const controls = deferred<{ stop: () => void }>();
  let stopped = 0;
  const run = setup({
    decoder: Promise.resolve({ start: async () => controls.promise }),
  });
  await tick();
  run.stale();
  controls.resolve({ stop: () => stopped++ });
  await tick();
  assert.equal(stopped, 1);
  assert.equal(run.counts().trackStops, 1);
  assert.equal(run.counts().ready, 0);
});
