import type { AuthAccountDto } from "@/shared/api/generated/model";
export const accessRoleLabels = {
  manager: "Руководитель",
  employee: "Сотрудник",
} as const;
export function isLastManager(
  account: AuthAccountDto,
  accounts: AuthAccountDto[],
): boolean {
  return (
    account.role === "manager" &&
    !account.blocked &&
    accounts.filter((item) => item.role === "manager" && !item.blocked)
      .length === 1
  );
}
export function accessDate(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat("ru-RU", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Moscow",
      }).format(new Date(value))
    : "Ещё не входил";
}
