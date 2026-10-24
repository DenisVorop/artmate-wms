import type { AuthSessionDto, AuthUserDto } from "@/shared/api/generated/model";
import { commandReplayStoragePrefix } from "@/shared/api/command-replay";
export const sessionScopeStorageKey = "artmate-wms:auth-scope:v1";
export function sessionScope(user: AuthUserDto | null): string {
  return user
    ? JSON.stringify([
        user.id,
        user.employeeId,
        user.role,
        user.mustChangePassword,
      ])
    : "signed-out";
}
export function publicSession(response: AuthSessionDto): AuthSessionDto {
  return { ...response, csrfToken: null };
}
export function clearReplayRegistry(
  storage: Pick<Storage, "length" | "key" | "removeItem">,
) {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(commandReplayStoragePrefix)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}
export function synchronizeReplayScope(
  storage: Storage,
  scope: string,
  force = false,
): boolean {
  const changed = storage.getItem(sessionScopeStorageKey) !== scope;
  if (changed || force) clearReplayRegistry(storage);
  storage.setItem(sessionScopeStorageKey, scope);
  return changed;
}
