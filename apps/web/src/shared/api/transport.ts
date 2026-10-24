import { commandFingerprint, fetchReplaySafeCommand } from "./command-replay";

export async function apiFetch<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    return fetchReplaySafeCommand<T>(
      url,
      {
        ...options,
        headers: { "Content-Type": "application/json", ...options.headers },
        cache: "no-store",
      },
      {
        storage: () => window.sessionStorage,
        fetch: (target, init) => fetch(target, init),
        fingerprint: commandFingerprint,
      },
    );
  }
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    cache: "no-store",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const raw = data?.message;
    throw new Error(
      Array.isArray(raw)
        ? raw.join(". ")
        : typeof raw === "string"
          ? raw
          : "Не удалось выполнить действие. Попробуйте ещё раз.",
    );
  }
  return data as T;
}
