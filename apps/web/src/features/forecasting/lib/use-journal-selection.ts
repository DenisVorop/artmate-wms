"use client";
import { useState } from "react";
import type { ForecastJournalSummaryDto } from "@/entities/forecast";
export function useJournalSelection(runs: ForecastJournalSummaryDto[]) {
  const [selectedRun, selectRun] = useState(""),
    [selectedSku, selectSku] = useState("");
  const runId = runs.some((run) => run.id === selectedRun)
    ? selectedRun
    : (runs[0]?.id ?? "");
  return { runId, selectRun, selectedSku, selectSku };
}
