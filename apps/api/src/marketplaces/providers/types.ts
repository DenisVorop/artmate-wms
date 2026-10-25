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
export interface MarketplaceInbound {
  externalId: string;
  units: number | null;
  source: "wb_supplies" | "ozon_analytics";
  supplyIds: string[];
  warnings: string[];
}
export interface MarketplaceSupplyItem {
  externalId: string;
  name: string;
  plannedUnits: number | null;
  acceptedUnits: number | null;
  readyUnits: number | null;
  pendingUnits: number | null;
}
export interface MarketplaceSupply {
  id: string;
  statusCode: string;
  statusLabel: string;
  expectedAt: string | null;
  receivedAt: string | null;
  updatedAt: string | null;
  calculation: "document" | "analytics" | "excluded" | "review";
  items: MarketplaceSupplyItem[];
  warnings: string[];
}
export interface MarketplaceSnapshot extends MarketplacePeriod {
  provider: MarketplaceProvider;
  asOf: string;
  products: MarketplaceProduct[];
  /** Optional only for snapshots saved before supply import was introduced. */
  inbound?: MarketplaceInbound[];
  supplies?: MarketplaceSupply[];
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
