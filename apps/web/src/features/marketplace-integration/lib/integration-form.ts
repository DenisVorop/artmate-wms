import { z } from "zod";
import type {
  ConnectMarketplaceDto,
  MapMarketplaceProductDto,
  MarketplaceProductDto,
} from "@/shared/api/generated/model";

export const connectionSchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(1, "Введите API-ключ")
    .max(8192, "Слишком длинный API-ключ"),
  clientId: z.string().trim().max(100, "Не больше 100 символов"),
});
export type ConnectionValues = z.infer<typeof connectionSchema>;
export function connectionSchemaFor(provider: string) {
  return connectionSchema.superRefine((values, context) => {
    if (provider === "ozon" && !values.clientId.trim())
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clientId"],
        message: "Введите Client ID Ozon",
      });
  });
}
export function connectionPayload(
  provider: ConnectMarketplaceDto["provider"],
  values: ConnectionValues,
): Omit<ConnectMarketplaceDto, "requestId"> {
  return {
    provider,
    apiKey: values.apiKey.trim(),
    ...(provider === "ozon" ? { clientId: values.clientId.trim() } : {}),
  };
}
export const connectionDefaults: ConnectionValues = {
  apiKey: "",
  clientId: "",
};

export const mappingSchema = z.object({
  skuId: z.string().trim().min(1, "Выберите тематику"),
  unitsPerItem: z
    .number({ invalid_type_error: "Укажите количество товара" })
    .int("Только целое количество")
    .min(1, "Минимум 1 единица")
    .max(10000, "Максимум 10 000 единиц"),
});
export type MappingValues = z.infer<typeof mappingSchema>;
export function mappingPayload(
  product: Pick<MarketplaceProductDto, "provider" | "externalId">,
  values: MappingValues,
): Omit<MapMarketplaceProductDto, "requestId"> {
  return {
    provider: product.provider,
    externalId: product.externalId,
    skuId: values.skuId,
    unitsPerItem: values.unitsPerItem,
  };
}
