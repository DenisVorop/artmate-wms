import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuthSessionDto, AuthUserDto } from "@/shared/api/generated/model";
import { commandReplayStoragePrefix } from "@/shared/api/command-replay";
import {
  publicSession,
  sessionScope,
  sessionScopeStorageKey,
  synchronizeReplayScope,
} from "./session-state";
function storage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    clear: () => map.clear(),
  };
}
const user: AuthUserDto = {
  id: "manager",
  employeeId: "employee",
  login: "manager",
  name: "Руководитель",
  role: "manager",
  mustChangePassword: false,
};
test("CSRF удаляется из context DTO, исходный ответ не меняется и в scope нет токена", () => {
  const response: AuthSessionDto = {
    needsSetup: false,
    user,
    csrfToken: "secret-csrf",
    expiresAt: "2027-01-01",
  };
  const safe = publicSession(response);
  assert.equal(safe.csrfToken, null);
  assert.equal(response.csrfToken, "secret-csrf");
  assert.equal(safe.user, response.user);
  assert.doesNotMatch(sessionScope(user), /secret-csrf|2027/);
});
test("Identity boundary меняется при другом сотруднике, роли и forced password change, но не при обновлении имени", () => {
  const scope = sessionScope(user);
  for (const patch of [
    { id: "other" },
    { employeeId: "other" },
    { role: "employee" as const },
    { mustChangePassword: true },
  ])
    assert.notEqual(sessionScope({ ...user, ...patch }), scope);
  assert.equal(sessionScope({ ...user, name: "Новое имя" }), scope);
  assert.notEqual(sessionScope(null), scope);
});
test("Same-user reload сохраняет unresolved requestId, смена пользователя/роли очищает только replay prefix", () => {
  const store = storage();
  store.setItem("unrelated", "keep");
  const old = `${commandReplayStoragePrefix}hash`;
  store.setItem(old, "old-request");
  assert.equal(synchronizeReplayScope(store, sessionScope(user)), true);
  assert.equal(store.getItem(old), null);
  store.setItem(old, "retry-request");
  assert.equal(synchronizeReplayScope(store, sessionScope(user)), false);
  assert.equal(store.getItem(old), "retry-request");
  assert.equal(
    synchronizeReplayScope(store, sessionScope({ ...user, role: "employee" })),
    true,
  );
  assert.equal(store.getItem(old), null);
  assert.equal(store.getItem("unrelated"), "keep");
  assert.doesNotMatch(
    store.getItem(sessionScopeStorageKey) ?? "",
    /csrf|password|hash/,
  );
});
test("Logout и explicit force очищают незавершённые ключи даже для того же user", () => {
  const store = storage();
  synchronizeReplayScope(store, sessionScope(user));
  const key = `${commandReplayStoragePrefix}a`;
  store.setItem(key, "id");
  synchronizeReplayScope(store, sessionScope(user), true);
  assert.equal(store.getItem(key), null);
  store.setItem(key, "id");
  synchronizeReplayScope(store, sessionScope(null));
  assert.equal(store.getItem(key), null);
});
