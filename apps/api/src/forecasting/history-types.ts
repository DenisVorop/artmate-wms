import type { MarketplaceProvider } from "../marketplaces/providers/types";
export type HistoryMetric = "ordered" | "cancelled" | "sold" | "returned";
export type HistorySource = "operational_snapshot" | "ozon_fbo" | "wb_finance";
export interface HistoryFact {
  id: string;
  storeId: string;
  provider: MarketplaceProvider;
  externalId: string;
  date: string;
  metric: HistoryMetric;
  units: number;
  source: HistorySource;
  observedAt: string;
  /** Ozon retrieval-window provenance, independent of canonical creation date. */
  windowFrom?: string;
  windowTo?: string;
}
export interface HistoryCoverage {
  /** WB dates select report windows, not sale dates; never imply zero sales. */
  scope?: "sale_date" | "report_window" | "processing_window";
  snapshotHash?: string;
  storeId: string;
  provider: MarketplaceProvider;
  from: string;
  to: string;
  source: HistorySource;
  observedAt: string;
}
export interface HistoryJob {
  id: string;
  provider: MarketplaceProvider;
  storeId: string;
  connectionVersion: number;
  from: string;
  to: string;
  monthFrom: string;
  monthTo: string;
  cursor: string;
  seenCursors: string[];
  pages: number;
  consecutiveFailures?: number;
  cursorRestarts?: number;
  status:
    | "queued"
    | "running"
    | "complete"
    | "permission_required"
    | "paused"
    | "failed";
  leaseId: string | null;
  leaseUntil: string | null;
  retryAt: string | null;
  message: string;
  createdAt: string;
  updatedAt: string;
}
export interface HistorySeriesPoint {
  date: string;
  units: number | null;
  availability: "available" | "out_of_stock" | "unknown";
}
export interface ForecastHistorySeries {
  skuId: string;
  provider: MarketplaceProvider;
  storeId: string;
  externalId: string;
  metric: HistoryMetric;
  source: HistorySource;
  points: HistorySeriesPoint[];
}
export interface HistoryPage {
  facts: Omit<HistoryFact, "storeId" | "provider" | "observedAt">[];
  cursor: string | null;
}
