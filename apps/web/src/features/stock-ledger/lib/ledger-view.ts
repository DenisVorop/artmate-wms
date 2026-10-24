import type {
  StockLedgerEventDto,
  StockLedgerLineDto,
} from "@/shared/api/generated/model";
export const ledgerKindLabels: Record<StockLedgerEventDto["kind"], string> = {
  opening_balance: "Начальный остаток",
  receipt_placement: "Приход после размещения",
  assembly: "Сборка",
  putaway: "Размещение короба",
  movement: "Перемещение паллеты",
  shipment: "Отгрузка",
  adjustment: "Корректировка",
};
export const ledgerStageLabels: Record<StockLedgerLineDto["stage"], string> = {
  raw: "До сборки",
  wip: "В сборке",
  boxed: "В коробах",
};
export const ledgerContainerLabels: Record<
  StockLedgerLineDto["containerType"],
  string
> = { pallet: "Паллета", task: "Задание", box: "Короб" };
export function ledgerActor(
  event: Pick<StockLedgerEventDto, "kind" | "employeeName">,
): string {
  return event.kind === "opening_balance"
    ? "Система"
    : event.employeeName?.trim() || "Не указан";
}
export function signedLedgerQuantity(value: number): string {
  return `${value > 0 ? "+" : ""}${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(Object.is(value, -0) ? 0 : value)}`;
}
export function ledgerDeltaTone(
  value: number,
): "positive" | "negative" | "neutral" {
  return value > 0 ? "positive" : value < 0 ? "negative" : "neutral";
}
export function ledgerEventMeaning(
  event: Pick<StockLedgerEventDto, "kind" | "unitsDelta">,
): string {
  if (event.kind === "opening_balance") return "Начальная точка учёта";
  return event.unitsDelta === 0
    ? "Общий баланс не изменён"
    : event.unitsDelta > 0
      ? "Товар добавлен на баланс"
      : "Товар списан с баланса";
}
export function ledgerDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
}
