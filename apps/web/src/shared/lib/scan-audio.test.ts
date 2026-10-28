import { test } from "node:test";
import assert from "node:assert/strict";
import { createScanAudio, type ScanAudioState } from "./scan-audio";
const tick = () => new Promise((resolve) => setImmediate(resolve));
function fakeAudio() {
  const frequencies: number[] = [],
    stops: (number | undefined)[] = [];
  let resumes = 0,
    closes = 0;
  const listeners = new Set<() => void>();
  const context = {
    state: "suspended",
    currentTime: 1,
    destination: {},
    addEventListener: (_: string, callback: () => void) =>
      listeners.add(callback),
    removeEventListener: (_: string, callback: () => void) =>
      listeners.delete(callback),
    resume: async () => {
      resumes++;
      context.state = "running";
      for (const fn of listeners) fn();
    },
    close: async () => {
      closes++;
      context.state = "closed";
    },
    createOscillator: () => ({
      type: "sine",
      frequency: { value: 0 },
      onended: null,
      connect: () => {},
      disconnect: () => {},
      start() {
        frequencies.push(this.frequency.value);
      },
      stop(at?: number) {
        stops.push(at);
      },
    }),
    createGain: () => ({
      connect: () => {},
      disconnect: () => {},
      gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {} },
    }),
  };
  return {
    context,
    frequencies,
    stops,
    resumes: () => resumes,
    closes: () => closes,
    listeners,
  };
}
test("audio is created/resumed by activation, patterns differ, latest error interrupts success", async () => {
  const fake = fakeAudio(),
    states: ScanAudioState[] = [];
  let created = 0;
  const audio = createScanAudio({
    create: () => {
      created++;
      return fake.context as unknown as AudioContext;
    },
    changed: (state) => states.push(state),
  });
  audio.play("success");
  assert.equal(created, 0);
  audio.unlock();
  assert.equal(created, 1);
  assert.equal(fake.resumes(), 1);
  await tick();
  assert.equal(states.at(-1), "ready");
  audio.play("success");
  assert.deepEqual(fake.frequencies, [1046, 1397]);
  audio.play("error");
  assert.deepEqual(fake.frequencies.slice(2), [220, 165, 220]);
  assert.equal(fake.stops.filter((at) => at === undefined).length, 2);
  audio.close();
  assert.equal(fake.closes(), 1);
  assert.equal(fake.listeners.size, 0);
  audio.play("success");
  assert.equal(fake.frequencies.length, 5);
});
test("sound test waits for resume and interruptions request activation again", async () => {
  const fake = fakeAudio(),
    states: ScanAudioState[] = [];
  const audio = createScanAudio({
    create: () => fake.context as unknown as AudioContext,
    changed: (state) => states.push(state),
  });
  audio.unlock(() => audio.play("success"));
  await tick();
  assert.equal(fake.frequencies.length, 2);
  fake.context.state = "interrupted";
  for (const fn of fake.listeners) fn();
  assert.equal(states.at(-1), "locked");
  audio.play("error");
  assert.equal(fake.frequencies.length, 2);
  audio.unlock();
  await tick();
  assert.equal(states.at(-1), "ready");
  audio.close();
});
test("unsupported or failed audio never throws into warehouse commands", () => {
  for (const create of [
    undefined,
    () => {
      throw Error("unsupported");
    },
  ]) {
    const states: ScanAudioState[] = [];
    const audio = createScanAudio({
      create,
      changed: (state) => states.push(state),
    });
    assert.doesNotThrow(() => audio.unlock());
    assert.equal(states.at(-1), "unavailable");
    audio.close();
  }
});

test("a confirmed scan cannot mask a simultaneous dropped-scan error", async () => {
  const fake = fakeAudio();
  const audio = createScanAudio({
    create: () => fake.context as unknown as AudioContext,
    changed: () => {},
  });
  audio.unlock();
  await tick();
  audio.play("error");
  audio.play("success");
  assert.deepEqual(fake.frequencies, [220, 165, 220]);
  fake.context.currentTime += 0.5;
  audio.play("success");
  assert.deepEqual(fake.frequencies, [220, 165, 220, 1046, 1397]);
  audio.close();
});
