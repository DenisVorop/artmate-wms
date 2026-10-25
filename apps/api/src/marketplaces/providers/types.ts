export type MarketplaceProvider = "wildberries" | "ozon";
export interface MarketplaceCredentials {
  apiKey: string;
  clientId?: string;
}
export interface MarketplacePeriod {
  from: string;
  to: string;
}
export interface MarketplaceProduct {
  externalId: string;
  offerId?: string;
  name: string;
  barcodes: string[];
}
export interface MarketplaceStock {
  externalId: string;
  warehouseId: string;
  warehouseName: string;
  availableUnits: number | null;
  reservedUnits: number | null;
  inboundUnits: number | null;
}
export interface MarketplaceDemand {
  externalId: string;
  date: string;
  orderedUnits: number;
  cancelledUnits: number;
  returnedUnits: number;
  soldUnits: number | null;
}
export interface MarketplaceSnapshot extends MarketplacePeriod {
  provider: MarketplaceProvider;
  asOf: string;
  products: MarketplaceProduct[];
  stocks: MarketplaceStock[];
  demand: MarketplaceDemand[];
  coverage: {
    catalog: boolean;
    stocks: boolean;
    demand: boolean;
    inbound: boolean;
  };
  warnings: string[];
}
export interface MarketplaceFetchOptions {
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
}
