import { z } from "zod";
export const putawayScanSchema = z.object({
  boxCode: z.string().trim().min(1, "Отсканируйте код короба"),
  locationCode: z.string().trim().min(1, "Отсканируйте код адреса"),
});
export type PutawayScanValues = z.infer<typeof putawayScanSchema>;
export function emptyPutawayScans(): PutawayScanValues {
  return { boxCode: "", locationCode: "" };
}
