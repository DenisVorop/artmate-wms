import type { Queryable } from "./database";
import type { SkuDto } from "./dto";

export function skuBarcodeOwner(skus: SkuDto[], barcode: string) {
  return skus.find(
    (sku) =>
      sku.barcode === barcode || sku.alternateBarcodes?.includes(barcode),
  );
}

export async function linkedBarcodeOwners(tx: Queryable, codes: string[]) {
  const { rows } = await tx.query<{ barcode: string; sku_id: string }>(
    `SELECT DISTINCT code.barcode, mapping.payload->>'skuId' AS sku_id
      FROM marketplace_snapshots snapshot
      JOIN marketplace_connections connection ON connection.id = snapshot.id
      CROSS JOIN LATERAL jsonb_array_elements(snapshot.payload->'products') AS product(payload)
      JOIN marketplace_mappings mapping
        ON mapping.payload->>'provider' = snapshot.id
        AND mapping.payload->>'externalId' = product.payload->>'externalId'
      CROSS JOIN LATERAL jsonb_array_elements_text(product.payload->'barcodes') AS code(barcode)
      WHERE connection.payload->>'enabled' = 'true'
        AND connection.payload->>'lastSuccessVersion' = connection.payload->>'version'
        AND mapping.payload->>'unitsPerItem' = '1'
        AND code.barcode = ANY($1::text[])`,
    [codes],
  );
  const owners = new Map<string, Set<string>>();
  for (const { barcode, sku_id } of rows) {
    const matched = owners.get(barcode) ?? new Set<string>();
    matched.add(sku_id);
    owners.set(barcode, matched);
  }
  return owners;
}
