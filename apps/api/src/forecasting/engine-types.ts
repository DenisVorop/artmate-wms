/** Internal statistical contract. Public API DTOs are generated independently. */
export type ForecastAvailability = "available" | "out_of_stock" | "unknown";
export type ForecastModel =
  | "mean"
  | "annual_seasonal"
  | "annual_growth"
  | "ridge"
  | "autoregressive";
export type ForecastConfidence = "low" | "medium" | "high";

export interface ForecastPoint {
  date: string;
  units: number | null;
  availability: ForecastAvailability;
}

/** Each input must contain a single store, product and homogeneous metric. */
export interface ForecastSeries {
  id: string;
  provider: string;
  storeId: string;
  externalId: string;
  metric: string;
  points: ForecastPoint[];
}

export interface ForecastOptions {
  /** Last complete day, inclusive. Points after it never enter training or identity. */
  asOf: string;
  horizonDays: number;
  /** Window of the deployed mean baseline; comparisons must use the same setting. */
  baselineHistoryDays?: number;
  /** Explicit calendar scenario, never labeled as learned annual seasonality. */
  newYearScenario?: boolean;
  /** Internal segment policy. Default preserves full-horizon model selection. */
  allowAutoregressive?: boolean;
  /** Optional stock floor; applied to the total goal, never added to demand. */
  minUnits?: number;
}

export interface ForecastDailyValue {
  date: string;
  units: number;
}

export interface ForecastHorizonMetrics {
  horizonDays: number;
  mae: number;
  wape: number | null;
  /** Signed error per observed day: positive means overprediction. */
  bias: number;
  folds: number;
  observations: number;
}

export interface ForecastMetrics {
  mae: number;
  /** Null for an all-zero validation target; MAE remains usable. */
  wape: number | null;
  bias: number;
  folds: number;
  observations: number;
  baselineImprovement: number | null;
  winRate: number | null;
  byHorizon: ForecastHorizonMetrics[];
}

export interface ForecastCandidate {
  model: ForecastModel;
  /** Eligible for selection, not merely possible to fit. */
  eligible: boolean;
  reason: string | null;
  metrics: ForecastMetrics | null;
}

export interface ForecastHistoryCoverage {
  from: string | null;
  to: string;
  calendarDays: number;
  /** Non-null observations excluding censored stockout days. */
  knownDays: number;
  missingDays: number;
  stockoutDays: number;
  availableDays: number;
  unknownAvailabilityDays: number;
  coverageRatio: number;
}

export interface ForecastResult {
  dailyForecast: ForecastDailyValue[];
  /** Expected demand or the minimum stock floor, whichever is larger. */
  totalUnits: number;
  selectedModel: ForecastModel;
  confidence: ForecastConfidence;
  candidates: ForecastCandidate[];
  historyCoverage: ForecastHistoryCoverage;
  fallbackReason: string | null;
  fingerprint: string;
  modelVersion: string;
  scenario: boolean;
}
