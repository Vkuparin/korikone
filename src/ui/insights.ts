import { useCallback, useEffect, useState } from "react";
import type { Service, Snapshot } from "../application/service";

export type Insights = Awaited<ReturnType<Service["purchaseInsights"]>>;

/**
 * The derived purchase views (suggestions, aliases, actual purchases, link review). Read on
 * request from the main process; nothing is stored in the renderer, and a read makes no AI,
 * catalogue or retailer call.
 */
export function purchaseInsightsKey(snapshot: Snapshot): string {
  return JSON.stringify([
    snapshot.purchaseImport,
    snapshot.receiptEnrichment,
    snapshot.receiptIntake,
    snapshot.purchaseSignals,
    snapshot.state.staples,
    snapshot.state.listHistory,
  ]);
}

export function useInsights(snapshot: Snapshot, enabled = true) {
  const key = purchaseInsightsKey(snapshot);
  const [insights, setInsights] = useState<Insights | null>(null);
  const refresh = useCallback(async () => {
    const result = await window.korikone.purchaseInsights();
    if (result.ok)
      setInsights((result.value as unknown as { insights: Insights }).insights);
  }, []);
  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh, key]);
  return { insights, refresh };
}
