import type { AuthSessionDto } from "./generated/model";
export function isAuthSessionResponse(value: unknown): value is AuthSessionDto {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  if (
    typeof data.needsSetup !== "boolean" ||
    !(data.csrfToken === null || typeof data.csrfToken === "string") ||
    !(data.expiresAt === null || typeof data.expiresAt === "string")
  )
    return false;
  if (data.user === null) return true;
  if (!data.user || typeof data.user !== "object") return false;
  const user = data.user as Record<string, unknown>;
  return (
    ["id", "employeeId", "login", "name"].every(
      (key) => typeof user[key] === "string",
    ) &&
    (user.role === "manager" || user.role === "employee") &&
    typeof user.mustChangePassword === "boolean"
  );
}
