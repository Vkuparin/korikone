import { z } from "zod";
import { categorySchema, qualifierSchema, qualifierValues } from "./categories";

/** Version of the purchase ledger document and every schema below. */
export const PURCHASE_VERSION = 1;
export const PURCHASES_KEY = "purchases";
/** Retained original text of one source lives in its own document, never in the ledger. */
export const purchaseOriginalKey = (sourceId: string) =>
  `purchase-original:${sourceId}`;
export const purchaseLimits = Object.freeze({
  events: 2000,
  lines: 500,
  adjustments: 200,
  printedAmounts: 50,
  annotations: 500,
  labelCharacters: 200,
  originalCharacters: 50_000,
  cents: 10_000_000,
});

const id = z.string().min(1).max(100);
const cents = z
  .number()
  .int()
  .min(-purchaseLimits.cents)
  .max(purchaseLimits.cents);
const label = z.string().min(1).max(purchaseLimits.labelCharacters);
const timestamp = z.iso.datetime();
/** Retailer group of a source. Never a store-provider ID and never an AI-provider ID. */
export const purchaseChainSchema = z.enum(["s-group", "k-group", "unknown"]);
export type PurchaseChain = z.infer<typeof purchaseChainSchema>;
/** Where in the source a fact was read. Positions only; no source text is repeated here. */
export const sourceSpanSchema = z
  .object({
    page: z.number().int().min(1).max(1000).nullable(),
    line: z.number().int().min(1).max(100_000),
    endLine: z.number().int().min(1).max(100_000),
  })
  .strict()
  .refine((span) => span.endLine >= span.line);
export type SourceSpan = z.infer<typeof sourceSpanSchema>;
/** Who established a fact: the receipt or order itself, or a later explicit correction. */
export const factProvenanceSchema = z.enum(["source", "user"]);
/** Pages read locally from pixels rather than a PDF text layer. Older sources omit this. */
export const receiptOCRPagesSchema = z
  .array(z.number().int().min(1).max(100))
  .max(100)
  .refine((pages) =>
    pages.every((page, index) => index === 0 || page > pages[index - 1]),
  );

/**
 * One imported file, order or the legacy text. A source is evidence; only a purchase event built
 * from it says that something was bought.
 */
export const purchaseSourceSchema = z
  .object({
    id,
    kind: z.enum(["receipt", "order", "legacy-text"]),
    chain: purchaseChainSchema,
    format: z.enum(["pdf", "txt", "csv", "order", "legacy"]),
    ocrPages: receiptOCRPagesSchema.optional(),
    /** Null for the legacy text, which no parser has read. */
    parser: z
      .object({
        id: z.string().min(1).max(50),
        version: z.number().int().min(1),
      })
      .strict()
      .nullable(),
    importedAt: timestamp,
    /** Lowercase hex digest of the normalized sanitized content. Defined by F6.10. */
    fingerprint: z.string().regex(/^[0-9a-f]{16,128}$/),
    /** Whether an original copy is kept beside the sanitized evidence. */
    retention: z.enum(["sanitized", "original"]),
    /** Grows with every reprocessing or correction; late results for an older revision are stale. */
    revision: z.number().int().min(1),
    pages: z.number().int().min(1).max(1000).nullable(),
    lines: z.number().int().min(0).max(100_000),
    /** Lines the parser could not place. They are counted, never dropped silently. */
    unreadableLines: z.number().int().min(0).max(100_000),
  })
  .strict()
  .refine(
    (source) =>
      !source.ocrPages?.length ||
      (source.kind === "receipt" &&
        source.format === "pdf" &&
        source.pages !== null &&
        source.ocrPages.every((page) => page <= source.pages!)),
  );
export type PurchaseSource = z.infer<typeof purchaseSourceSchema>;

export const purchaseQuantitySchema = z
  .object({
    /** Pieces, or grams or millilitres, as whole base units. Null when the source does not say. */
    amount: z.number().int().positive().max(10_000_000).nullable(),
    unit: z.enum(["pcs", "g", "ml"]).nullable(),
    provenance: z.enum(["source", "user", "unknown"]),
  })
  .strict()
  .refine((q) =>
    q.provenance === "unknown"
      ? q.amount === null && q.unit === null
      : q.amount !== null && q.unit !== null,
  );
export type PurchaseQuantity = z.infer<typeof purchaseQuantitySchema>;

/** One row of evidence. Money is integer cents; anything the source does not state is null. */
export const evidenceLineSchema = z
  .object({
    id,
    role: z.enum(["product", "deposit", "non-food", "other", "unreadable"]),
    /** Sanitized label: see `sanitizeLabel`. */
    label,
    span: sourceSpanSchema,
    quantity: purchaseQuantitySchema,
    /** Price of one piece, or of one kilogram or litre, as the source prints it. */
    unitPrice: cents.nullable(),
    unitPriceBasis: z.enum(["pcs", "kg", "l"]).nullable(),
    /** Line price before any adjustment, and the amount actually paid for the line. */
    gross: cents.nullable(),
    net: cents.nullable(),
    provenance: factProvenanceSchema,
  })
  .strict()
  .refine(
    (line) => (line.unitPrice === null) === (line.unitPriceBasis === null),
  );
export type EvidenceLine = z.infer<typeof evidenceLineSchema>;

/** A discount, campaign, deposit return or similar. Negative amounts reduce what was paid. */
export const purchaseAdjustmentSchema = z
  .object({
    id,
    kind: z.enum([
      "discount",
      "campaign",
      "loyalty",
      "deposit-return",
      "rounding",
      "other",
    ]),
    label,
    span: sourceSpanSchema,
    amount: cents.nullable(),
    /**
     * line: the source ties it to exactly the listed lines. group: to a group of lines without a
     * per-line split. receipt: to the whole receipt. unknown: the source does not say.
     */
    allocation: z.enum(["line", "group", "receipt", "unknown"]),
    lineIds: z.array(id).max(purchaseLimits.lines),
    provenance: factProvenanceSchema,
  })
  .strict()
  .refine(
    (a) =>
      new Set(a.lineIds).size === a.lineIds.length &&
      (a.allocation === "line"
        ? a.lineIds.length >= 1
        : a.allocation === "group"
          ? a.lineIds.length >= 2
          : a.lineIds.length === 0),
  );
export type PurchaseAdjustment = z.infer<typeof purchaseAdjustmentSchema>;

/** An amount the source itself prints. It stays a source fact even when nothing reproduces it. */
export const printedAmountSchema = z
  .object({
    role: z.enum([
      "total",
      "subtotal",
      "food",
      "non-food",
      "discounts",
      "deposits",
      "tax",
    ]),
    amount: cents,
    span: sourceSpanSchema,
  })
  .strict();
export type PrintedAmount = z.infer<typeof printedAmountSchema>;

export const reconciliationReasonSchema = z.enum([
  "no-printed-total",
  "unreadable-lines",
  "missing-line-amount",
  "missing-adjustment-amount",
  "unallocated-adjustment",
  "difference",
]);
/** Result of local accounting (F6.9). Model output can never set or change it. */
export const reconciliationSchema = z
  .object({
    status: z.enum(["balanced", "unbalanced", "incomplete"]),
    computedTotal: cents.nullable(),
    printedTotal: cents.nullable(),
    /** Computed minus printed, when both are known. */
    difference: cents.nullable(),
    reasons: z.array(reconciliationReasonSchema).max(6),
  })
  .strict()
  .refine(
    (r) =>
      new Set(r.reasons).size === r.reasons.length &&
      (r.status === "balanced"
        ? r.difference === 0 && r.reasons.length === 0
        : r.reasons.length > 0) &&
      (r.difference === null
        ? true
        : r.computedTotal !== null &&
          r.printedTotal !== null &&
          r.difference === r.computedTotal - r.printedTotal),
  );
export type Reconciliation = z.infer<typeof reconciliationSchema>;

/**
 * One actual purchase: a receipt or a retailer's order record. A verified transfer is not a
 * purchase and has no representation here.
 */
export const purchaseEventSchema = z
  .object({
    id,
    /** The sources this event was read from; F6.19 may link a receipt and an order to one event. */
    sourceIds: z.array(id).min(1).max(4),
    origin: z.enum(["receipt", "order"]),
    /** Orders report their own state. Only `completed` counts as spending. */
    status: z.enum(["completed", "pending", "cancelled", "unknown"]),
    chain: purchaseChainSchema,
    /** Sanitized store name as printed, or null. */
    store: label.nullable(),
    purchasedAt: timestamp.nullable(),
    datePrecision: z.enum(["minute", "day", "unknown"]),
    lines: z.array(evidenceLineSchema).max(purchaseLimits.lines),
    adjustments: z
      .array(purchaseAdjustmentSchema)
      .max(purchaseLimits.adjustments),
    printed: z.array(printedAmountSchema).max(purchaseLimits.printedAmounts),
    reconciliation: reconciliationSchema,
  })
  .strict()
  .superRefine((event, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    const lines = new Set(event.lines.map((line) => line.id));
    if (lines.size !== event.lines.length) issue("Duplicate line ID");
    if (
      new Set(event.adjustments.map((a) => a.id)).size !==
      event.adjustments.length
    )
      issue("Duplicate adjustment ID");
    if (
      event.adjustments.some((a) => a.lineIds.some((line) => !lines.has(line)))
    )
      issue("Adjustment names an unknown line");
    if ((event.purchasedAt === null) !== (event.datePrecision === "unknown"))
      issue("Date and its precision disagree");
    if (new Set(event.sourceIds).size !== event.sourceIds.length)
      issue("Duplicate source ID");
  });
export type PurchaseEvent = z.infer<typeof purchaseEventSchema>;

/**
 * An interpretation of one evidence line: what kind of grocery the label means. It is stored
 * apart from the facts and can never change a quantity, an amount or a label.
 */
export const semanticAnnotationSchema = z
  .object({
    eventId: id,
    lineId: id,
    origin: z.enum(["rule", "model", "user"]),
    /** The source revision this was made for; an annotation of an older revision is stale. */
    sourceRevision: z.number().int().min(1),
    name: z.string().min(1).max(100).nullable(),
    category: categorySchema.nullable(),
    qualifiers: z
      .array(
        z
          .object({
            kind: qualifierSchema.shape.kind,
            value: z.string().min(1).max(40),
          })
          .strict()
          .refine((q) =>
            (qualifierValues[q.kind] as readonly string[]).includes(q.value),
          ),
      )
      .max(8),
    scope: z.enum(["food", "non-food", "unknown"]),
    /** AI-provider and model identity for `model`; null otherwise. */
    model: z
      .object({
        providerId: z.string().min(1).max(100),
        modelId: z.string().min(1).max(200),
        taskVersion: z.number().int().min(1),
      })
      .strict()
      .nullable(),
    at: timestamp,
  })
  .strict()
  .refine((a) => (a.origin === "model") === (a.model !== null));
export type SemanticAnnotation = z.infer<typeof semanticAnnotationSchema>;

/**
 * Consent for sending sanitized ambiguous labels to an AI provider. It names the provider and the
 * data scope it was given for; a different provider or scope needs a new answer.
 */
export const RECEIPT_DATA_SCOPE = 1;
export const receiptConsentSchema = z
  .object({
    automatic: z
      .object({
        providerId: z.string().min(1).max(100),
        scope: z.literal(RECEIPT_DATA_SCOPE),
        grantedAt: timestamp,
      })
      .strict()
      .nullable(),
    /** Whether the first-import question has been answered, either way. */
    asked: z.boolean(),
  })
  .strict();
export type ReceiptConsent = z.infer<typeof receiptConsentSchema>;

export const purchaseLedgerSchema = z
  .object({
    version: z.literal(PURCHASE_VERSION),
    sources: z.array(purchaseSourceSchema).max(purchaseLimits.events * 2),
    events: z.array(purchaseEventSchema).max(purchaseLimits.events),
    annotations: z
      .array(semanticAnnotationSchema)
      .max(purchaseLimits.events * 20),
    consent: receiptConsentSchema,
    /** Records that are one purchase (F6.19): a receipt and an order, by rule or by the shopper. */
    links: z
      .array(
        z
          .object({
            eventIds: z.tuple([id, id]),
            by: z.enum(["rule", "user"]),
          })
          .strict()
          .refine((l) => l.eventIds[0] < l.eventIds[1]),
      )
      .max(purchaseLimits.events)
      .default([]),
    /** A verified transfer (`listHistory` ID) and the purchase that followed it. */
    transferLinks: z
      .array(
        z
          .object({ transferId: id, eventId: id, by: z.enum(["rule", "user"]) })
          .strict(),
      )
      .max(purchaseLimits.events)
      .default([]),
    /** Pairs the shopper said are not the same, so they are not offered again. */
    rejectedLinks: z
      .array(z.object({ ids: z.tuple([id, id]) }).strict())
      .max(purchaseLimits.events)
      .default([]),
    /** Recurrence suggestions the shopper dismissed, by identity key and time. */
    dismissedSuggestions: z
      .array(
        z.object({ key: z.string().min(1).max(300), at: timestamp }).strict(),
      )
      .max(500)
      .default([]),
  })
  .strict()
  .superRefine((ledger, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    const sources = new Map(ledger.sources.map((s) => [s.id, s]));
    if (sources.size !== ledger.sources.length) issue("Duplicate source ID");
    const events = new Map(ledger.events.map((e) => [e.id, e]));
    if (events.size !== ledger.events.length) issue("Duplicate event ID");
    const used = new Set<string>();
    for (const event of ledger.events)
      for (const sourceId of event.sourceIds) {
        const source = sources.get(sourceId);
        // A source backs at most one event, and the legacy text backs none.
        if (!source || source.kind === "legacy-text" || used.has(sourceId))
          issue("Event names an unusable source");
        used.add(sourceId);
      }
    if (
      ledger.links.some((l) => l.eventIds.some((e) => !events.has(e))) ||
      ledger.transferLinks.some((l) => !events.has(l.eventId)) ||
      new Set(ledger.transferLinks.map((l) => l.transferId)).size !==
        ledger.transferLinks.length ||
      new Set(ledger.transferLinks.map((l) => l.eventId)).size !==
        ledger.transferLinks.length
    )
      issue("Link names an unknown event or repeats a transfer or purchase");
    const seen = new Set<string>();
    for (const a of ledger.annotations) {
      const key = `${a.eventId}\n${a.lineId}\n${a.origin}`;
      if (
        seen.has(key) ||
        !events.get(a.eventId)?.lines.some((line) => line.id === a.lineId)
      )
        issue("Annotation names an unknown line or repeats an origin");
      seen.add(key);
    }
  });
export type PurchaseLedger = z.infer<typeof purchaseLedgerSchema>;

export const emptyLedger = (): PurchaseLedger => ({
  version: PURCHASE_VERSION,
  sources: [],
  events: [],
  annotations: [],
  consent: { automatic: null, asked: false },
  links: [],
  transferLinks: [],
  rejectedLinks: [],
  dismissedSuggestions: [],
});
/** A missing or unreadable document is an empty ledger; nothing is guessed from a damaged one. */
export function readLedger(input: unknown): PurchaseLedger {
  const parsed = purchaseLedgerSchema.safeParse(input);
  return parsed.success ? parsed.data : emptyLedger();
}

/**
 * Keeps a label readable while removing what could identify a person, card or transaction:
 * e-mail addresses, masked card numbers and any run of six or more digits.
 */
export function sanitizeLabel(text: string): string {
  return (
    text
      // Bounded first, so no pattern below runs over an arbitrarily long line.
      .slice(0, 1000)
      .normalize("NFC")
      .replace(/\S+@\S+\.\S+/g, "…")
      .replace(/[*•]{2,}[*•\s-]*\d{2,}/g, "…")
      .replace(/(?<![\p{L}\p{N}])[xX]{4,}[\s-]?\d{2,}/gu, "…")
      .replace(/\d(?:[\s-]?\d){5,}/g, "…")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, purchaseLimits.labelCharacters) || "…"
  );
}

export const LEGACY_SOURCE_ID = "legacy-text";
/**
 * The text saved by releases before 0.9.0 is one undated source. It has no event boundaries, so
 * it yields no purchase event, statistic or AI context until the shopper imports it explicitly.
 */
export function legacySource(
  receiptText: string,
  fingerprint: string,
): PurchaseSource | null {
  const lines = receiptText.split("\n").filter((line) => line.trim()).length;
  if (!lines) return null;
  return purchaseSourceSchema.parse({
    id: LEGACY_SOURCE_ID,
    kind: "legacy-text",
    chain: "unknown",
    format: "legacy",
    parser: null,
    // The text carries no import time; the epoch marks it as unknown rather than inventing one.
    importedAt: new Date(0).toISOString(),
    fingerprint,
    retention: "original",
    revision: 1,
    pages: null,
    lines,
    unreadableLines: lines,
  });
}

/** Sanitized records for a backup file. Consent is never written to a backup. */
export function backupLedger(ledger: PurchaseLedger): PurchaseLedger {
  return {
    ...structuredClone(ledger),
    consent: { automatic: null, asked: false },
  };
}
/**
 * Reads purchase records from a backup. A restored profile must be asked again before anything is
 * sent to an AI provider, and its sources hold no original copy until one is restored explicitly.
 */
export function restoreLedger(
  input: unknown,
  originals: ReadonlySet<string> = new Set(),
): PurchaseLedger {
  const ledger = purchaseLedgerSchema.parse(input);
  return {
    ...ledger,
    sources: ledger.sources.map((source) => ({
      ...source,
      retention:
        source.retention === "original" && originals.has(source.id)
          ? "original"
          : "sanitized",
    })),
    consent: { automatic: null, asked: false },
  };
}

export const purchaseDeletionSchema = z
  .object({
    eventId: id,
    /**
     * original: drop only the retained original copy. annotations: drop interpretations of the
     * event's lines. event: drop the event, its sources and its interpretations.
     */
    scope: z.enum(["original", "annotations", "event"]),
  })
  .strict();
export type PurchaseDeletion = z.infer<typeof purchaseDeletionSchema>;
/**
 * Returns the ledger after a scoped deletion and the source IDs whose retained original must be
 * removed. Deleting an event also forgets its fingerprint, so the same file can be imported again.
 */
export function deletePurchase(
  ledger: PurchaseLedger,
  input: unknown,
): { ledger: PurchaseLedger; originals: string[] } {
  const { eventId, scope } = purchaseDeletionSchema.parse(input);
  const event = ledger.events.find((e) => e.id === eventId);
  if (!event) throw new Error("purchaseMissing");
  const retained = ledger.sources
    .filter((s) => event.sourceIds.includes(s.id) && s.retention === "original")
    .map((s) => s.id);
  if (scope === "annotations")
    return {
      ledger: {
        ...ledger,
        annotations: ledger.annotations.filter((a) => a.eventId !== eventId),
      },
      originals: [],
    };
  if (scope === "original")
    return {
      ledger: {
        ...ledger,
        sources: ledger.sources.map((s) =>
          retained.includes(s.id) ? { ...s, retention: "sanitized" } : s,
        ),
      },
      originals: retained,
    };
  return {
    ledger: {
      ...ledger,
      sources: ledger.sources.filter((s) => !event.sourceIds.includes(s.id)),
      events: ledger.events.filter((e) => e.id !== eventId),
      annotations: ledger.annotations.filter((a) => a.eventId !== eventId),
      // Links and rejections that name the deleted event go with it.
      links: ledger.links.filter((l) => !l.eventIds.includes(eventId)),
      transferLinks: ledger.transferLinks.filter((l) => l.eventId !== eventId),
      rejectedLinks: ledger.rejectedLinks.filter(
        (l) => !l.ids.includes(eventId),
      ),
    },
    originals: retained,
  };
}

/** Adds a parsed source and its event, or replaces both when the source ID is already known. */
export function putPurchase(
  ledger: PurchaseLedger,
  source: PurchaseSource,
  event: PurchaseEvent,
): PurchaseLedger {
  if (!event.sourceIds.includes(source.id)) throw new Error("purchaseInvalid");
  const previous = ledger.events.find((e) => e.id === event.id);
  const next = purchaseLedgerSchema.safeParse({
    ...ledger,
    // A replaced source or event keeps its place, so reprocessing does not reorder history.
    sources: ledger.sources.some((s) => s.id === source.id)
      ? ledger.sources.map((s) => (s.id === source.id ? source : s))
      : [...ledger.sources, source],
    events: previous
      ? ledger.events.map((e) => (e.id === event.id ? event : e))
      : [...ledger.events, event],
    // Interpretations of lines that no longer exist, or of an older revision, do not carry over.
    annotations: previous
      ? ledger.annotations.filter(
          (a) =>
            a.eventId !== event.id ||
            (a.sourceRevision === source.revision &&
              event.lines.some((line) => line.id === a.lineId)),
        )
      : ledger.annotations,
  });
  if (!next.success) throw new Error("purchaseInvalid");
  return next.data;
}

export type PurchaseMergeOutcome = "added" | "updated" | "duplicate";
/**
 * The shared dedupe rule for every importer. A source with a known fingerprint is the same
 * source: identical facts change nothing, different facts update that source and event in place
 * with the next revision. No second event is ever created for one fingerprint.
 */
export function mergePurchase(
  ledger: PurchaseLedger,
  source: PurchaseSource,
  event: PurchaseEvent,
): { ledger: PurchaseLedger; outcome: PurchaseMergeOutcome; eventId: string } {
  const known = ledger.sources.find(
    (s) => s.fingerprint === source.fingerprint && s.kind === source.kind,
  );
  if (!known) {
    if (ledger.events.length >= purchaseLimits.events)
      throw new Error("purchaseLimit");
    return {
      ledger: putPurchase(ledger, source, event),
      outcome: "added",
      eventId: event.id,
    };
  }
  const previous = ledger.events.find((e) => e.sourceIds.includes(known.id));
  if (!previous) throw new Error("purchaseInvalid");
  const facts = (e: PurchaseEvent) =>
    JSON.stringify({ ...e, id: "", sourceIds: [] });
  // The same facts read by the same parser are a repeat, whatever file format carried them.
  if (
    facts(previous) === facts(event) &&
    JSON.stringify(known.parser) === JSON.stringify(source.parser)
  )
    return { ledger, outcome: "duplicate", eventId: previous.id };
  return {
    ledger: putPurchase(
      ledger,
      {
        ...source,
        id: known.id,
        importedAt: known.importedAt,
        retention: known.retention,
        revision: known.revision + 1,
      },
      { ...event, id: previous.id, sourceIds: previous.sourceIds },
    ),
    outcome: "updated",
    eventId: previous.id,
  };
}
