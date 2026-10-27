import { test } from "node:test";
import assert from "node:assert/strict";
import { createApiFetch, ApiError } from "./transport";
import {
  isWorkAutomationResponse,
  isAssemblyPressure,
} from "./work-automation-response";
import {
  advanceAuthEpoch,
  setCsrfToken,
  subscribeSessionInvalidation,
} from "./auth-memory";
import { isWorkspaceCommandResponse } from "./workspace-shape";

const status = {
  enabled: true,
  lastCheckedAt: "2026-10-27T10:00:00Z",
  queuedAssemblyTasks: 2,
  queuedPutawayTasks: 18,
  assemblyBoxes: 18,
  assemblyCapacityBoxes: 18,
  pressure: "full",
  message: "Освободите сборочную паллету.",
  blockers: ["Нужно сырьё: Котики"],
};
const pressure = {
  level: "full",
  locationId: "assembly",
  palletId: "shared",
  boxes: 1,
  committedBoxes: 17,
  capacityBoxes: 18,
  message: "Места заняты текущей сборкой.",
};
function storageFixture() {
  const entries = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    key: (index) => [...entries.keys()][index] ?? null,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
  return { entries, storage };
}
test("automation status guards preserve known zero, unavailable capacity and reject fabricated or incomplete counts", () => {
  assert.equal(isWorkAutomationResponse(status), true);
  assert.equal(
    isWorkAutomationResponse({
      ...status,
      queuedAssemblyTasks: 0,
      assemblyCapacityBoxes: null,
      pressure: "unavailable",
      lastCheckedAt: null,
      blockers: [],
    }),
    true,
  );
  for (const invalid of [
    null,
    [],
    {},
    { ...status, enabled: "true" },
    { ...status, queuedAssemblyTasks: -1 },
    { ...status, assemblyBoxes: 1.5 },
    { ...status, assemblyCapacityBoxes: "18" },
    { ...status, pressure: "urgent" },
    { ...status, blockers: [null] },
    { ...status, lastCheckedAt: "unknown" },
  ])
    assert.equal(isWorkAutomationResponse(invalid), false);
  assert.equal(isAssemblyPressure(pressure), true);
  assert.equal(
    isAssemblyPressure({
      ...pressure,
      level: "unavailable",
      capacityBoxes: null,
      palletId: null,
      locationId: null,
    }),
    true,
  );
  for (const invalid of [
    { ...pressure, committedBoxes: -1 },
    { ...pressure, capacityBoxes: "unknown" },
    { ...pressure, boxes: null },
    { ...pressure, level: "overflow" },
  ])
    assert.equal(isAssemblyPressure(invalid), false);
});
test("settings confirmation retains the original request on uncertainty and cannot confirm a warehouse mutation", async () => {
  const { entries, storage } = storageFixture();
  const requests: Record<string, unknown>[] = [];
  let attempts = 0;
  setCsrfToken("csrf-automation");
  const api = createApiFetch({
    storage: () => storage,
    fetch: async (_url, init) => {
      assert.equal(
        new Headers(init!.headers).get("X-WMS-CSRF"),
        "csrf-automation",
      );
      assert.equal(init?.credentials, "same-origin");
      requests.push(JSON.parse(String(init?.body)));
      return Response.json(attempts++ ? status : { enabled: true });
    },
  });
  const options = (requestId: string) => ({
    method: "POST",
    body: JSON.stringify({ requestId, enabled: true }),
  });
  await assert.rejects(
    api("/api/work-automation/settings", options("first")),
    /неподтверждённый/,
  );
  assert.equal(entries.size, 1);
  assert.deepEqual(
    await api("/api/work-automation/settings", options("retry")),
    status,
  );
  assert.deepEqual(
    requests.map((request) => request.requestId),
    ["first", "first"],
  );
  assert.equal(entries.size, 0);
  await assert.rejects(
    api("/api/tasks", options("not-stock")),
    /неподтверждённый/,
  );
  assert.equal(isWorkspaceCommandResponse(status), false);
  setCsrfToken(null);
});
test("manager-only automation errors refresh access and malformed GET cannot display success", async () => {
  const { storage } = storageFixture();
  let refreshes = 0;
  const unsubscribe = subscribeSessionInvalidation(() => {
    refreshes++;
  });
  for (const code of [401, 403]) {
    const denied = createApiFetch({
      storage: () => storage,
      fetch: async () =>
        Response.json({ message: "Только для руководителя" }, { status: code }),
    });
    await assert.rejects(
      denied("/api/work-automation"),
      (error) => error instanceof ApiError && error.status === code,
    );
  }
  assert.equal(refreshes, 2);
  unsubscribe();
  const broken = createApiFetch({
    storage: () => storage,
    fetch: async () => Response.json({ enabled: true }),
  });
  await assert.rejects(
    broken("/api/work-automation"),
    /состояние автоматических заданий/,
  );
});
test("a late automation response from the previous identity is rejected", async () => {
  const { storage } = storageFixture();
  let resolve!: (value: Response) => void;
  const response = new Promise<Response>((done) => {
    resolve = done;
  });
  const api = createApiFetch({ storage: () => storage, fetch: () => response });
  const result = api("/api/work-automation");
  advanceAuthEpoch();
  resolve(Response.json(status));
  await assert.rejects(
    result,
    (error) => error instanceof ApiError && error.status === 409,
  );
});

test("legacy warehouse acknowledgements may omit new metadata, but malformed pressure or automatic purpose is not confirmation", () => {
  const workspace = Object.fromEntries(
    [
      "skus",
      "locations",
      "lots",
      "pallets",
      "boxes",
      "tasks",
      "employees",
      "shipments",
      "activities",
    ].map((key) => [key, []]),
  );
  assert.equal(isWorkspaceCommandResponse(workspace), true);
  assert.equal(
    isWorkspaceCommandResponse({
      ...workspace,
      assemblyPressure: pressure,
      tasks: [{ autoPurpose: "urgent" }, { autoPurpose: "backlog" }, {}],
    }),
    true,
  );
  assert.equal(
    isWorkspaceCommandResponse({
      ...workspace,
      assemblyPressure: { ...pressure, committedBoxes: -1 },
    }),
    false,
  );
  assert.equal(
    isWorkspaceCommandResponse({
      ...workspace,
      tasks: [{ autoPurpose: "whatever" }],
    }),
    false,
  );
});
