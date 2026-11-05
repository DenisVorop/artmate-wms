export type RollLabelFormat = "58x40" | "75x120" | "100x70" | "120x75" | "a4";
export const boxLabelFormats: readonly RollLabelFormat[] = [
  "58x40",
  "75x120",
  "100x70",
];
export const palletLabelFormats: readonly RollLabelFormat[] = [
  "75x120",
  "a4",
  "100x70",
];
export const rollLabelFormats: Record<RollLabelFormat, string> = {
  "58x40": "58 × 40 мм · короба",
  "120x75": "120 × 75 мм · горизонтально",
  "75x120": "75 × 120 мм · Xprinter",
  "100x70": "100 × 70 мм",
  a4: "А4 · одна паллета на лист",
};
/** The QR remains the full identifier; no service UUID is printed as wrapping prose. */
export function palletPrintCode(code: string) {
  return /^PLT-PRE-[0-9A-F-]{36}$/i.test(code) ? code.slice(-8) : code;
}
