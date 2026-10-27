import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, createApiFetch } from "./transport";
import {
  advanceAuthEpoch,
  getCsrfToken,
  setCsrfToken,
  subscribeSessionInvalidation,
} from "./auth-memory";
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const noStorage = () => {
  throw new Error("Auth must never persist request credentials");
};
test("Auth POST bypasses replay/storage and attaches same-origin+CSRF headers without saving credentials", async () => {
  setCsrfToken("memory-csrf");
  let seen: RequestInit | undefined;
  const request = createApiFetch({
    storage: noStorage,
    fetch: async (_url, options) => {
      seen = options;
      return json({
        user: null,
        needsSetup: false,
        csrfToken: null,
        expiresAt: null,
      });
    },
  });
  await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      login: "employee",
      password: "synthetic test secret",
    }),
  });
  const headers = new Headers(seen?.headers);
  assert.equal(headers.get("X-WMS-Request"), "1");
  assert.equal(headers.get("X-WMS-CSRF"), "memory-csrf");
  assert.equal(seen?.credentials, "same-origin");
  assert.equal(
    seen?.body,
    JSON.stringify({ login: "employee", password: "synthetic test secret" }),
  );
  assert.equal(getCsrfToken(), "memory-csrf");
  setCsrfToken(null);
});
test("Wrong login/current password exposes HTTP status without refreshing into a login loop", async () => {
  let invalidations = 0;
  const unsubscribe = subscribeSessionInvalidation(() => {
    invalidations++;
  });
  const request = createApiFetch({
    storage: noStorage,
    fetch: async () => json({ message: "Неверный пароль" }, 401),
  });
  for (const url of ["/api/auth/login", "/api/auth/change-password"])
    await assert.rejects(
      request(url, { method: "POST", body: "{}" }),
      (e) => e instanceof ApiError && e.status === 401,
    );
  assert.equal(invalidations, 0);
  unsubscribe();
});
test("Protected 401/403 asks global session guard to refresh, preserving readable error and status", async () => {
  let invalidations = 0;
  const unsubscribe = subscribeSessionInvalidation(() => {
    invalidations++;
  });
  for (const status of [401, 403]) {
    const request = createApiFetch({
      storage: noStorage,
      fetch: async () => json({ message: "Нет доступа" }, status),
    });
    await assert.rejects(
      request("/api/auth/accounts"),
      (e) =>
        e instanceof ApiError &&
        e.status === status &&
        e.message === "Нет доступа",
    );
  }
  assert.equal(invalidations, 2);
  unsubscribe();
});
test("Old warehouse GET and admin response are rejected after identity epoch changes", async () => {
  for (const url of ["/api/workspace", "/api/auth/accounts"]) {
    let resolve!: (response: Response) => void;
    const waiting = new Promise<Response>((done) => {
      resolve = done;
    });
    const request = createApiFetch({
      storage: noStorage,
      fetch: () => waiting,
    });
    const result = request(url);
    advanceAuthEpoch();
    resolve(json({ privateManagerData: true }));
    await assert.rejects(
      result,
      (e) => e instanceof ApiError && e.status === 409,
    );
  }
});
test("Session GET can adopt fresh identity after epoch change, malformed auth JSON cannot succeed", async () => {
  let resolve!: (response: Response) => void;
  const waiting = new Promise<Response>((done) => {
    resolve = done;
  });
  const request = createApiFetch({ storage: noStorage, fetch: () => waiting });
  const result = request("/api/auth/session");
  advanceAuthEpoch();
  resolve(
    json({ needsSetup: true, user: null, csrfToken: null, expiresAt: null }),
  );
  assert.deepEqual(await result, {
    needsSetup: true,
    user: null,
    csrfToken: null,
    expiresAt: null,
  });
  const malformed = createApiFetch({
    storage: noStorage,
    fetch: async () => new Response("invalid JSON", { status: 200 }),
  });
  await assert.rejects(
    malformed("/api/auth/login", { method: "POST", body: "{}" }),
    (e) => e instanceof ApiError && e.status === 200,
  );
});
test("JSON null or malformed session user cannot replace the authentication boundary", async () => {
  for (const value of [
    null,
    {},
    {
      needsSetup: false,
      user: { id: "a", role: "manager" },
      csrfToken: "token",
      expiresAt: null,
    },
  ]) {
    const request = createApiFetch({
      storage: noStorage,
      fetch: async () => json(value),
    });
    await assert.rejects(
      request("/api/auth/session"),
      (e) => e instanceof ApiError && e.status === 200,
    );
  }
});

test("Marketplace credentials and commands bypass all browser replay storage while retaining CSRF and auth epoch", async () => {
  setCsrfToken("test-marketplace-csrf");
  const seen: Array<{ url: string; options: RequestInit }> = [];
  const request = createApiFetch({
    storage: () => {
      throw new Error("Marketplace secrets must never reach storage");
    },
    fetch: async (url, options) => {
      seen.push({ url: String(url), options: options! });
      return json({
        connections: [],
        products: [],
        supplies: [],
        planningStock: [],
        previousPlan: null,
        planStatus: {
          state: "unavailable",
          calculatedAt: null,
          dataUpdatedAt: null,
          salesThrough: null,
          message: "",
        },
        settings: {
          historyDays: 28,
          horizonDays: 14,
          safetyDays: 3,
          leadDays: 7,
        },
        plan: {
          generatedAt: new Date().toISOString(),
          dispatchDate: "2026-10-31",
          preparationDays: 30,
          preparationThrough: "2026-11-23",
          leadDays: 7,
          horizonDays: 14,
          safetyDays: 3,
          backlogMessage: "Очередь",
          rows: [],
          warnings: [],
        },
      });
    },
  });
  for (const url of [
    "/api/marketplaces/connections",
    "/api/marketplaces/sync",
    "/api/marketplaces/settings",
    "/api/marketplaces/planning-stock",
  ]) {
    await request(url, {
      method: "POST",
      body: JSON.stringify({
        requestId: "market-test-id",
        apiKey: "SYNTHETIC-ONLY-SECRET",
      }),
    });
  }
  assert.equal(seen.length, 4);
  for (const { options } of seen) {
    assert.equal(
      new Headers(options.headers).get("X-WMS-CSRF"),
      "test-marketplace-csrf",
    );
    assert.equal(options.credentials, "same-origin");
  }
  let resolve!: (response: Response) => void;
  const pending = createApiFetch({
    storage: noStorage,
    fetch: () =>
      new Promise((done) => {
        resolve = done;
      }),
  })("/api/marketplaces");
  advanceAuthEpoch();
  resolve(json({ connections: [] }));
  await assert.rejects(
    pending,
    (error) => error instanceof ApiError && error.status === 409,
  );
  setCsrfToken(null);
});

test("forecast finance credentials bypass browser replay storage and validate history responses", async () => {
  setCsrfToken("forecast-csrf");
  let seen: RequestInit | undefined;
  const request = createApiFetch({
    storage: noStorage,
    fetch: async (_url, options) => {
      seen = options;
      return json({ providers: [], jobs: [] });
    },
  });
  await request("/api/forecast/history/finance", {
    method: "POST",
    body: JSON.stringify({
      requestId: "fixture",
      apiKey: "synthetic finance secret",
    }),
  });
  assert.equal(new Headers(seen?.headers).get("X-WMS-CSRF"), "forecast-csrf");
  assert.equal(seen?.credentials, "same-origin");
  const malformed = createApiFetch({
    storage: noStorage,
    fetch: async () =>
      json({ providers: [{ financeConfigured: true }], jobs: [] }),
  });
  await assert.rejects(
    malformed("/api/forecast/history/finance", { method: "POST", body: "{}" }),
    /некорректный прогноз/,
  );
  setCsrfToken(null);
});

test("forecast late results cannot populate another user's session", async () => {
  let resolve!: (response: Response) => void;
  const waiting = new Promise<Response>((done) => {
    resolve = done;
  });
  const request = createApiFetch({ storage: noStorage, fetch: () => waiting });
  const result = request("/api/forecast/history");
  advanceAuthEpoch();
  resolve(json({ providers: [], jobs: [] }));
  await assert.rejects(
    result,
    (error) => error instanceof ApiError && error.status === 409,
  );
});
