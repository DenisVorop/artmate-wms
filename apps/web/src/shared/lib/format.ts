export function number(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}
export function date(value: string) {
  return new Date(value).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
  });
}
