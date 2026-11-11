import { z } from "zod";

export function parseAlternateBarcodes(text: string) {
  return [...new Set(text.split(/[\s,;]+/).filter(Boolean))];
}

export const skuBarcodesSchema = z.object({
  codes: z.string().refine((text) => {
    const codes = parseAlternateBarcodes(text);
    return codes.length <= 50 && codes.every((code) => code.length <= 150);
  }, "Укажите до 50 штрихкодов, до 150 символов каждый"),
});
export type SkuBarcodesValues = z.infer<typeof skuBarcodesSchema>;
