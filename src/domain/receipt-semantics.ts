import { z } from "zod";
import {
  categoryQualifierKinds,
  categorySchema,
  inferredClassification,
  qualifierEvidenced,
  qualifierSchema,
  qualifierValues,
} from "./categories";
import { displayNameLimits, groundedDisplayName } from "./receipt-names";
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
/**
 * Version 2 of the result (F27.6): each row may also propose `display`, a readable name for the
 * printed label. The request is unchanged, so no new field is sent and the data scope stays 1.
 */
export const ENRICHMENT_NAME_VERSION = 2;
export const enrichmentNameResultSchema = z
  .object({
    version: z.literal(ENRICHMENT_NAME_VERSION),
    rows: z
      .array(
        enrichmentResultSchema.shape.rows.element
          .extend({
            display: z
              .string()
              .max(displayNameLimits.proposalCharacters)
              .nullable(),
          })
          .strict(),
      )
      .max(enrichmentLimits.rows),
  })
  .strict();
export type EnrichmentNameResult = z.infer<typeof enrichmentNameResultSchema>;
type ResultRow = EnrichmentResult["rows"][number] & { display?: string | null };
/** Either version of a model result, as rows. Anything else is invalid. */
function resultRows(input: unknown): ResultRow[] | null {
  const named = enrichmentNameResultSchema.safeParse(input);
  if (named.success) return named.data.rows;
  const plain = enrichmentResultSchema.safeParse(input);
  return plain.success ? plain.data.rows : null;
}

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

/** One request for several purchases: the same limits as for one, shared by all of them. */
export type CombinedBatch = {
  /** Each purchase in the batch and the source revision its rows were read at. */
  events: Map<string, number>;
  request: EnrichmentRequest | null;
  /**
   * Row ID to every line it stands for. Lines with the same sanitized label and verified
   * quantity share one row, within and across purchases; the purchases themselves stay apart.
   */
  rows: Map<
    string,
    {
      label: string;
      lines: { eventId: string; lineId: string; label: string }[];
    }
  >;
  /** Ambiguous lines no row stands for, because a limit was reached. They stay as they are. */
  omitted: number;
  /** Ambiguous lines a row does stand for. */
  covered: number;
};
/**
 * The single request of one multi-receipt action. It sends what `buildEnrichmentBatch` would send
 * for each purchase, with equal rows sent once, under the same 40-row and 12 000-character limits
 * for the whole action. Nothing identifies a purchase, a store or a file.
 */
export function buildCombinedBatch(
  ledger: PurchaseLedger,
  eventIds: string[],
): CombinedBatch {
  const events = new Map<string, number>();
  const rows: CombinedBatch["rows"] = new Map();
  const byContent = new Map<string, string>();
  const request: EnrichmentRequest["rows"] = [];
  let omitted = 0;
  let covered = 0;
  for (const eventId of [...new Set(eventIds)]) {
    const single = ledger.events.some((e) => e.id === eventId)
      ? buildEnrichmentBatch(ledger, eventId)
      : null;
    if (!single) continue;
    events.set(eventId, single.sourceRevision);
    omitted += single.omitted;
    for (const sent of single.request?.rows ?? []) {
      const line = single.rows.get(sent.rowId)!;
      const content = JSON.stringify([sent.label, sent.quantity]);
      const existing = byContent.get(content);
      if (existing) {
        rows.get(existing)!.lines.push({ eventId, ...line });
        covered++;
        continue;
      }
      const row = { ...sent, rowId: `r${request.length}` };
      if (
        request.length >= enrichmentLimits.rows ||
        JSON.stringify([...request, row]).length >
          enrichmentLimits.requestCharacters
      ) {
        omitted++;
        continue;
      }
      request.push(row);
      byContent.set(content, row.rowId);
      rows.set(row.rowId, { label: line.label, lines: [{ eventId, ...line }] });
      covered++;
    }
  }
  return {
    events,
    request: request.length
      ? enrichmentRequestSchema.parse({
          version: ENRICHMENT_VERSION,
          rows: request,
          categories: categorySchema.options,
          qualifiers: qualifierValues,
        })
      : null,
    rows,
    omitted,
    covered,
  };
}
/**
 * Validates the one result of a combined batch. Each purchase is checked on its own: one that was
 * corrected, reprocessed or deleted while the model answered is reported in `stale` and gets
 * nothing, and the others keep their accepted rows. Row rules are those of `validateEnrichment`.
 */
export function validateCombined(
  batch: CombinedBatch,
  input: unknown,
  ledger: PurchaseLedger,
  model: { providerId: string; modelId: string; taskVersion: number },
  at: string,
): EnrichmentOutcome & { stale: string[] } {
  const result = { data: { rows: resultRows(input) } };
  if (!result.data.rows) throw new Error("enrichmentInvalid");
  const stale = [...batch.events]
    .filter(([eventId, sourceRevision]) => {
      const event = ledger.events.find((e) => e.id === eventId);
      const revision = event
        ? Math.max(
            ...ledger.sources
              .filter((s) => event.sourceIds.includes(s.id))
              .map((s) => s.revision),
          )
        : -1;
      return (
        !event ||
        revision !== sourceRevision ||
        [...batch.rows.values()].some((row) =>
          row.lines.some(
            (line) =>
              line.eventId === eventId &&
              event.lines.find((l) => l.id === line.lineId)?.label !==
                line.label,
          ),
        )
      );
    })
    .map(([eventId]) => eventId);
  const annotations: SemanticAnnotation[] = [];
  const seen = new Set<string>();
  let rejected = 0;
  for (const row of result.data.rows) {
    const sent = batch.rows.get(row.rowId);
    if (!sent || seen.has(row.rowId)) {
      rejected++;
      if (sent) seen.add(row.rowId);
      continue;
    }
    seen.add(row.rowId);
    let refused = false;
    for (const line of sent.lines) {
      if (stale.includes(line.eventId)) continue;
      // The label of each line is its own evidence for a qualifier.
      const accepted = acceptedRow(row, line.label);
      if (!accepted) {
        refused = true;
        continue;
      }
      annotations.push(
        semanticAnnotationSchema.parse({
          eventId: line.eventId,
          lineId: line.lineId,
          origin: "model",
          sourceRevision: batch.events.get(line.eventId)!,
          ...accepted,
          model,
          at,
        }),
      );
    }
    if (refused) rejected++;
  }
  const fresh = [...batch.rows.values()]
    .flatMap((row) => row.lines)
    .filter((line) => !stale.includes(line.eventId)).length;
  return {
    annotations,
    rejected,
    unresolved: fresh - annotations.length,
    stale,
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
  const result = { data: { rows: resultRows(input) } };
  if (!result.data.rows) throw new Error("enrichmentInvalid");
  const annotations: SemanticAnnotation[] = [];
  const seen = new Set<string>();
  let rejected = 0;
  for (const row of result.data.rows) {
    const sent = batch.rows.get(row.rowId);
    const accepted =
      sent !== undefined && !seen.has(row.rowId)
        ? acceptedRow(row, sent.label)
        : null;
    if (sent) seen.add(row.rowId);
    if (!sent || !accepted) {
      rejected++;
      continue;
    }
    annotations.push(
      semanticAnnotationSchema.parse({
        eventId: batch.eventId,
        lineId: sent.lineId,
        origin: "model",
        sourceRevision: batch.sourceRevision,
        ...accepted,
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
 * One row of a model result against the printed label it answers, or null when it must be dropped:
 * a category outside the taxonomy, a qualifier the category does not carry or the label does not
 * print, or a name that is not a short plain label.
 */
function acceptedRow(
  row: ResultRow,
  label: string,
): Pick<
  SemanticAnnotation,
  "name" | "category" | "qualifiers" | "scope" | "display"
> | null {
  {
    const sent = { label };
    const category = categorySchema.safeParse(row.category ?? undefined);
    const name = row.name?.trim().replace(/\s+/g, " ") ?? null;
    const kinds = category.success ? categoryQualifierKinds(category.data) : [];
    const valid =
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
      !(row.scope === "non-food" && row.category !== null);
    // A display name stands or falls on its own: one the label does not support is dropped and
    // the rest of the row is kept, so the line falls back to its generic name or printed label.
    const display = groundedDisplayName(label, row.display);
    if (
      !valid ||
      (name === null &&
        row.category === null &&
        row.scope === "unknown" &&
        !display)
    )
      return null;
    // The caller's `semanticAnnotationSchema.parse` validates the assembled annotation.
    return {
      name,
      category: category.success ? category.data : null,
      qualifiers: row.qualifiers as SemanticAnnotation["qualifiers"],
      scope: row.scope,
      ...(display ? { display } : {}),
    };
  }
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
