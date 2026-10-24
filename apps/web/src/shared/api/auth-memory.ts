let csrfToken: string | null = null;
let authEpoch = 0;
let identityScope = "signed-out";
let authIntent = 0;
export const getAuthIdentityScope = () => identityScope;
export function setAuthIdentityScope(value: string) {
  identityScope = value;
}
export function beginAuthIntent() {
  authIntent += 1;
  return authIntent;
}
export const getAuthIntent = () => authIntent;
const listeners = new Set<() => void>();
export const getCsrfToken = () => csrfToken;
export function setCsrfToken(value: string | null) {
  csrfToken = value;
}
export const getAuthEpoch = () => authEpoch;
export function advanceAuthEpoch() {
  csrfToken = null;
  identityScope = "signed-out";
  authEpoch += 1;
  return authEpoch;
}
export function subscribeSessionInvalidation(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function requestSessionRefresh() {
  for (const listener of listeners) listener();
}
