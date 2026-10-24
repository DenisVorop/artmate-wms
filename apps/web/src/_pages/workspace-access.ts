import type { AuthUserDto } from "@/shared/api/generated/model";
const employeeViews = new Set([
  "warehouse",
  "receiving",
  "assembly",
  "putaway",
  "movements",
  "team",
]);
/** UI navigation policy; the API independently authorizes every request. */
export function canOpenWorkspaceView(role: AuthUserDto["role"], view: string) {
  return role === "manager" || employeeViews.has(view);
}
export function landingForRole(role: AuthUserDto["role"]) {
  return role === "manager" ? "/" : "/assembly";
}
