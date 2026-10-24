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
