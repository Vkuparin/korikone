import { z } from "zod";
import {
  categoryQualifierKinds,
  categorySchema,
  inferredClassification,
  qualifierEvidenced,
  qualifierSchema,
  qualifierValues,
} from "./categories";
import {
  RECEIPT_DATA_SCOPE,
  sanitizeLabel,
  semanticAnnotationSchema,
  type PurchaseEvent,
  type PurchaseLedger,
  type ReceiptConsent,
  type SemanticAnnotation,
} from "./purchases";

/** Version of the enrichment request and result shapes. */
export const ENRICHMENT_VERSION = 1;
export const enrichmentLimits = Object.freeze({
  rows: 40,
  labelCharacters: 80,
  nameCharacters: 60,
  requestCharacters: 12_000,
});

/**
 * Category metadata that local rules read from a label, for product lines only. A rule never
 * guesses: a label it does not recognize gets no annotation and stays a candidate for review.
 */
export function ruleAnnotations(
  event: PurchaseEvent,
  sourceRevision: number,
  at: string,
): SemanticAnnotation[] {
  return event.lines.flatMap((line) => {
    if (line.role !== "product") return [];
    const found = inferredClassification(line.label, "model-assumed");
    if (!found) return [];
    return [
      semanticAnnotationSchema.parse({
        eventId: event.id,
        lineId: line.id,
        origin: "rule",
        sourceRevision,
        name: null,
        category: found.category,
        qualifiers: found.qualifiers.map(({ kind, value }) => ({
          kind,
          value,
        })),
        scope: "food",
        model: null,
        at,
      }),
    ];
  });
}

export const enrichmentRequestSchema = z
  .object({
    version: z.literal(ENRICHMENT_VERSION),
    rows: z
      .array(
        z
          .object({
            rowId: z.string().regex(/^r\d{1,3}$/),
            label: z.string().min(1).max(enrichmentLimits.labelCharacters),
            /** A verified quantity only; never a price. */
            quantity: z
              .object({
                amount: z.number().int().positive(),
                unit: z.enum(["pcs", "g", "ml"]),
              })
              .strict()
              .nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(enrichmentLimits.rows),
    categories: z.array(categorySchema),
    qualifiers: z.record(z.string(), z.array(z.string())),
  })
  .strict();
export type EnrichmentRequest = z.infer<typeof enrichmentRequestSchema>;

/** What a model may say about a row: a plain name, a known category, qualifiers and food scope. */
export const enrichmentResultSchema = z
  .object({
    version: z.literal(ENRICHMENT_VERSION),
    rows: z
      .array(
        z
          .object({
            rowId: z.string().max(10),
            name: z.string().max(200).nullable(),
            category: z.string().max(40).nullable(),
            qualifiers: z
              .array(
                z
                  .object({
                    kind: z.string().max(40),
                    value: z.string().max(40),
                  })
                  .strict(),
              )
              .max(8),
            scope: z.enum(["food", "non-food", "unknown"]),
          })
          .strict(),
      )
      .max(enrichmentLimits.rows),
  })
  .strict();
export type EnrichmentResult = z.infer<typeof enrichmentResultSchema>;

export type EnrichmentBatch = {
  eventId: string;
  sourceRevision: number;
  /** Null when no line is ambiguous: there is nothing to send. */
  request: EnrichmentRequest | null;
  /** Row ID to line ID and the exact label that was sent, for the staleness check. */
  rows: Map<string, { lineId: string; label: string }>;
  /** Ambiguous lines beyond the row cap. They stay unresolved; no second request is made. */
  omitted: number;
};

/**
 * Selects the lines worth asking about and redacts them. Only product lines without a rule or
 * user interpretation are sent, as a sanitized label and an optional verified quantity. Store,
 * date, totals, prices, adjustments, other lines and every identifier stay local.
 */
export function buildEnrichmentBatch(
  ledger: PurchaseLedger,
  eventId: string,
): EnrichmentBatch {
  const event = ledger.events.find((e) => e.id === eventId);
  if (!event) throw new Error("purchaseMissing");
  const sourceRevision = Math.max(
    ...ledger.sources
      .filter((s) => event.sourceIds.includes(s.id))
      .map((s) => s.revision),
  );
  const settled = new Set(
    ledger.annotations
      .filter(
        (a) =>
          a.eventId === eventId &&
          a.origin !== "model" &&
          a.sourceRevision === sourceRevision,
      )
      .map((a) => a.lineId),
  );
  const ambiguous = event.lines.filter(
    (line) => line.role === "product" && !settled.has(line.id),
  );
  const rows = new Map<string, { lineId: string; label: string }>();
  const request: EnrichmentRequest["rows"] = [];
  for (const line of ambiguous) {
    if (request.length >= enrichmentLimits.rows) break;
    const label = sanitizeLabel(line.label).slice(
      0,
      enrichmentLimits.labelCharacters,
    );
    const row = {
      rowId: `r${request.length}`,
      label,
      quantity:
        line.quantity.provenance === "unknown"
          ? null
          : { amount: line.quantity.amount!, unit: line.quantity.unit! },
    };
    const next = [...request, row];
    if (JSON.stringify(next).length > enrichmentLimits.requestCharacters) break;
    request.push(row);
    rows.set(row.rowId, { lineId: line.id, label: line.label });
  }
  return {
    eventId,
    sourceRevision,
    request: request.length
      ? enrichmentRequestSchema.parse({
          version: ENRICHMENT_VERSION,
          rows: request,
          categories: categorySchema.options,
          qualifiers: qualifierValues,
        })
      : null,
    rows,
    omitted: ambiguous.length - request.length,
  };
}

/** The shopper's answer for one enrichment action, naming the provider and data scope shown. */
export const enrichmentConsentSchema = z
  .object({
    providerId: z.string().min(1).max(100),
    scope: z.literal(RECEIPT_DATA_SCOPE),
  })
  .strict();
export type EnrichmentConsent = z.infer<typeof enrichmentConsentSchema>;
/**
 * Whether labels may be sent to `providerId` now. An explicit answer covers this one action and
 * must name the same provider and the current data scope. Without one, only saved automatic
 * consent for exactly this provider and scope counts. A connected account alone never does.
 */
export function enrichmentAllowed(
  saved: ReceiptConsent,
  providerId: string,
  explicit?: unknown,
): boolean {
  if (explicit !== undefined) {
    const answer = enrichmentConsentSchema.safeParse(explicit);
    return answer.success && answer.data.providerId === providerId;
  }
  return (
    saved.automatic !== null &&
    saved.automatic.providerId === providerId &&
    saved.automatic.scope === RECEIPT_DATA_SCOPE
  );
}

export type EnrichmentOutcome = {
  annotations: SemanticAnnotation[];
  /** Rows of the result that failed validation and were dropped. */
  rejected: number;
  /** Rows that were sent but have no accepted proposal. */
  unresolved: number;
};

/**
 * Validates a model result against the batch it answers and the ledger as it is now. A result is
 * stale if the source was reprocessed or a sent label changed. Each row stands alone: an unknown
 * or repeated row ID, a category outside the taxonomy, a qualifier the category does not carry or
 * the label does not print, or a name that is not a short plain label drops that row only.
 * Nothing here can change a quantity, an amount, a label or a saved preference.
 */
export function validateEnrichment(
  batch: EnrichmentBatch,
  input: unknown,
  ledger: PurchaseLedger,
  model: { providerId: string; modelId: string; taskVersion: number },
  at: string,
): EnrichmentOutcome {
  const event = ledger.events.find((e) => e.id === batch.eventId);
  const revision = event
    ? Math.max(
        ...ledger.sources
          .filter((s) => event.sourceIds.includes(s.id))
          .map((s) => s.revision),
      )
    : -1;
  if (
    !event ||
    revision !== batch.sourceRevision ||
    [...batch.rows.values()].some(
      (row) =>
        event.lines.find((line) => line.id === row.lineId)?.label !== row.label,
    )
  )
    throw new Error("enrichmentStale");
  const result = enrichmentResultSchema.safeParse(input);
  if (!result.success) throw new Error("enrichmentInvalid");
  const annotations: SemanticAnnotation[] = [];
  const seen = new Set<string>();
  let rejected = 0;
  for (const row of result.data.rows) {
    const sent = batch.rows.get(row.rowId);
    const category = categorySchema.safeParse(row.category ?? undefined);
    const name = row.name?.trim().replace(/\s+/g, " ") ?? null;
    const kinds = category.success ? categoryQualifierKinds(category.data) : [];
    const valid =
      sent !== undefined &&
      !seen.has(row.rowId) &&
      (row.category === null || category.success) &&
      // Qualifiers need a category that carries them and the printed label as evidence.
      row.qualifiers.every((q) => {
        const kind = qualifierSchema.shape.kind.safeParse(q.kind);
        return (
          kind.success &&
          kinds.includes(kind.data) &&
          (qualifierValues[kind.data] as readonly string[]).includes(q.value) &&
          qualifierEvidenced(kind.data, q.value, sent.label)
        );
      }) &&
      new Set(row.qualifiers.map((q) => q.kind)).size ===
        row.qualifiers.length &&
      // A name is a short label, not prose, a link, an amount or an instruction.
      (name === null ||
        (name.length >= 2 &&
          name.length <= enrichmentLimits.nameCharacters &&
          /^[\p{L}][\p{L}\p{N} %.,'-]*$/u.test(name) &&
          !/https?|www\.|\d{4,}/i.test(name))) &&
      (name !== null || row.category !== null || row.scope !== "unknown") &&
      !(row.scope === "non-food" && row.category !== null);
    if (sent) seen.add(row.rowId);
    if (!valid) {
      rejected++;
      continue;
    }
    annotations.push(
      semanticAnnotationSchema.parse({
        eventId: batch.eventId,
        lineId: sent.lineId,
        origin: "model",
        sourceRevision: batch.sourceRevision,
        name,
        category: category.success ? category.data : null,
        qualifiers: row.qualifiers,
        scope: row.scope,
        model,
        at,
      }),
    );
  }
  return {
    annotations,
    rejected,
    unresolved: batch.rows.size - annotations.length,
  };
}

/**
 * Stores accepted model proposals beside the facts. They replace only an earlier model proposal
 * for the same line; a rule or user interpretation is never overwritten or removed.
 */
export function applyEnrichment(
  ledger: PurchaseLedger,
  annotations: SemanticAnnotation[],
): PurchaseLedger {
  const incoming = new Set(annotations.map((a) => `${a.eventId}\n${a.lineId}`));
  if (annotations.some((a) => a.origin !== "model"))
    throw new Error("enrichmentInvalid");
  return {
    ...ledger,
    annotations: [
      ...ledger.annotations.filter(
        (a) =>
          a.origin !== "model" || !incoming.has(`${a.eventId}\n${a.lineId}`),
      ),
      ...annotations,
    ],
  };
}
