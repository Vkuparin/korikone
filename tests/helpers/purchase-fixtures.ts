import type { Storage } from "../../src/application/service";
import {
  type EvidenceLine,
  type PurchaseEvent,
  type PurchaseSource,
} from "../../src/domain/purchases";

/** In-memory documents with the SQLite worker's all-or-nothing `setMany`. */
export function memoryStorage() {
  const entries = new Map<string, unknown>();
  let fail: "before" | "after" | null = null;
  const storage: Storage = {
    get: async (key) => structuredClone(entries.get(key)),
    set: async (key, value) => {
      entries.set(key, structuredClone(value));
    },
    setMany: async (batch) => {
      if (fail === "before") throw new Error("storageFailed");
      for (const entry of structuredClone(batch))
        entries.set(entry.key, entry.value);
      if (fail === "after") throw new Error("storageFailed");
    },
  };
  return {
    storage,
    entries,
    failNext: (mode: "before" | "after" | null) => (fail = mode),
  };
}

const span = (line: number) => ({ page: 1, line, endLine: line });
export function purchaseLine(
  id: string,
  label: string,
  net: number | null,
  extra: Partial<EvidenceLine> = {},
): EvidenceLine {
  return {
    id,
    role: "product",
    label,
    span: span(Number(id.replace(/\D/g, "")) || 1),
    quantity: { amount: 1, unit: "pcs", provenance: "source" },
    unitPrice: net,
    unitPriceBasis: net === null ? null : "pcs",
    gross: net,
    net,
    provenance: "source",
    ...extra,
  };
}
export function purchaseSource(
  id: string,
  extra: Partial<PurchaseSource> = {},
): PurchaseSource {
  return {
    id,
    kind: "receipt",
    chain: "s-group",
    format: "txt",
    parser: { id: "s-group", version: 1 },
    importedAt: "2026-10-01T10:00:00.000Z",
    fingerprint: id.padEnd(16, "0").replace(/[^0-9a-f]/g, "a"),
    retention: "sanitized",
    revision: 1,
    pages: 1,
    lines: 10,
    unreadableLines: 0,
    ...extra,
  };
}
/** A balanced synthetic receipt: milk and bread, total 3.48. */
export function purchaseEvent(
  id: string,
  sourceId: string,
  extra: Partial<PurchaseEvent> = {},
): PurchaseEvent {
  return {
    id,
    sourceIds: [sourceId],
    origin: "receipt",
    status: "completed",
    chain: "s-group",
    store: "Esimerkkikauppa",
    purchasedAt: "2026-09-30T15:20:00.000Z",
    datePrecision: "minute",
    lines: [
      purchaseLine("l1", "KEVYTMAITO 1L", 119),
      purchaseLine("l2", "RUISLEIPÄ", 229),
    ],
    adjustments: [],
    printed: [{ role: "total", amount: 348, span: span(9) }],
    reconciliation: {
      status: "balanced",
      computedTotal: 348,
      printedTotal: 348,
      difference: 0,
      reasons: [],
    },
    ...extra,
  };
}
