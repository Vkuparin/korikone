import { z } from "zod";
import {
  categoryQualifierKinds,
  categorySchema,
  qualifierSchema,
  qualifierValues,
} from "./categories";
import {
  purchaseLedgerSchema,
  semanticAnnotationSchema,
  type EvidenceLine,
  type PurchaseEvent,
  type PurchaseLedger,
  type SemanticAnnotation,
} from "./purchases";
import { reconcile, withNetPrices } from "./receipt-accounting";

const id = z.string().min(1).max(100);
const binding = {
  eventId: id,
  lineId: id,
  /** The source revision the shopper was looking at; any other is `purchaseStale`. */
  revision: z.number().int().min(1),
};
const amount = z.number().int().min(0).max(10_000_000);
/** A factual correction of one line. The printed label and the source span are never editable. */
export const purchaseCorrectionSchema = z.discriminatedUnion("field", [
  z
    .object({
      ...binding,
      field: z.literal("quantity"),
      amount: z.number().int().positive().max(10_000_000),
      unit: z.enum(["pcs", "g", "ml"]),
    })
    .strict(),
  z.object({ ...binding, field: z.literal("gross"), amount }).strict(),
  z.object({ ...binding, field: z.literal("net"), amount }).strict(),
  z
    .object({
      ...binding,
      field: z.literal("role"),
      role: z.enum(["product", "deposit", "non-food", "other"]),
    })
    .strict(),
]);
export type PurchaseCorrection = z.infer<typeof purchaseCorrectionSchema>;
/** The shopper's own interpretation of a line, or acceptance of a proposal as it stands. */
export const purchaseInterpretationSchema = z
  .object({
    ...binding,
    name: z.string().trim().min(1).max(100).nullable(),
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
  })
  .strict();

const sourceRevision = (ledger: PurchaseLedger, event: PurchaseEvent) =>
  Math.max(
    ...ledger.sources
      .filter((s) => event.sourceIds.includes(s.id))
      .map((s) => s.revision),
  );
function locate(
  ledger: PurchaseLedger,
  input: { eventId: string; lineId: string; revision: number },
) {
  const event = ledger.events.find((e) => e.id === input.eventId);
  const line = event?.lines.find((l) => l.id === input.lineId);
  if (!event || !line) throw new Error("purchaseMissing");
  if (sourceRevision(ledger, event) !== input.revision)
    throw new Error("purchaseStale");
  return { event, line };
}
/** Every source of the event moves to the next revision, so an older result can no longer land. */
const advanced = (ledger: PurchaseLedger, event: PurchaseEvent, next: number) =>
  ledger.sources.map((s) =>
    event.sourceIds.includes(s.id) ? { ...s, revision: next } : s,
  );

/**
 * Applies one factual correction with `user` provenance, recomputes paid amounts and the
 * reconciliation, and advances the source revision. Interpretations of the corrected line made for
 * the old facts are dropped; nothing is remembered as a household preference.
 */
export function correctPurchase(
  ledger: PurchaseLedger,
  input: unknown,
): PurchaseLedger {
  const correction = purchaseCorrectionSchema.parse(input);
  const { event, line } = locate(ledger, correction);
  if (line.role === "unreadable" && correction.field !== "role")
    throw new Error("purchaseInvalid");
  const changed: EvidenceLine =
    correction.field === "quantity"
      ? {
          ...line,
          quantity: {
            amount: correction.amount,
            unit: correction.unit,
            provenance: "user",
          },
          provenance: "user",
        }
      : correction.field === "role"
        ? { ...line, role: correction.role, provenance: "user" }
        : correction.field === "gross"
          ? // The paid amount follows from the corrected price and the line's own adjustments.
            { ...line, gross: correction.amount, net: null, provenance: "user" }
          : { ...line, net: correction.amount, provenance: "user" };
  const facts = withNetPrices({
    lines: event.lines.map((l) => (l.id === line.id ? changed : l)),
    adjustments: event.adjustments,
  });
  const next = correction.revision + 1;
  const result = purchaseLedgerSchema.safeParse({
    ...ledger,
    sources: advanced(ledger, event, next),
    events: ledger.events.map((e) =>
      e.id === event.id
        ? {
            ...event,
            lines: facts.lines,
            reconciliation: reconcile({ ...facts, printed: event.printed }),
          }
        : e,
    ),
    annotations: ledger.annotations.flatMap((a) =>
      a.eventId !== event.id
        ? [a]
        : a.lineId === line.id
          ? []
          : [{ ...a, sourceRevision: next }],
    ),
  });
  if (!result.success) throw new Error("purchaseInvalid");
  return result.data;
}

/** Saves the shopper's interpretation of a line for this purchase only. */
export function interpretPurchase(
  ledger: PurchaseLedger,
  input: unknown,
  at: string,
): PurchaseLedger {
  const interpretation = purchaseInterpretationSchema.parse(input);
  const { event, line } = locate(ledger, interpretation);
  if (line.role === "unreadable") throw new Error("purchaseInvalid");
  // A qualifier needs a category that carries it, once.
  const kinds = interpretation.category
    ? categoryQualifierKinds(interpretation.category)
    : [];
  if (
    interpretation.qualifiers.some((q) => !kinds.includes(q.kind)) ||
    new Set(interpretation.qualifiers.map((q) => q.kind)).size !==
      interpretation.qualifiers.length
  )
    throw new Error("purchaseInvalid");
  const next = interpretation.revision + 1;
  const annotation = semanticAnnotationSchema.safeParse({
    eventId: event.id,
    lineId: line.id,
    origin: "user",
    sourceRevision: next,
    name: interpretation.name,
    category: interpretation.category,
    qualifiers: interpretation.qualifiers,
    scope: interpretation.scope,
    model: null,
    at,
  });
  if (!annotation.success) throw new Error("purchaseInvalid");
  const result = purchaseLedgerSchema.safeParse({
    ...ledger,
    sources: advanced(ledger, event, next),
    annotations: [
      ...ledger.annotations.flatMap((a) =>
        a.eventId !== event.id
          ? [a]
          : a.lineId === line.id && a.origin === "user"
            ? []
            : [{ ...a, sourceRevision: next }],
      ),
      annotation.data,
    ],
  });
  if (!result.success) throw new Error("purchaseInvalid");
  return result.data;
}

const rank = { user: 0, rule: 1, model: 2 } as const;
/** The interpretation that counts for a line: the shopper's, else a rule's, else a model's. */
export function effectiveAnnotation(
  annotations: SemanticAnnotation[],
  eventId: string,
  lineId: string,
  revision: number,
): SemanticAnnotation | null {
  return (
    annotations
      .filter(
        (a) =>
          a.eventId === eventId &&
          a.lineId === lineId &&
          a.sourceRevision === revision,
      )
      .sort((a, b) => rank[a.origin] - rank[b.origin])[0] ?? null
  );
}

/** What the receipt screens show: facts, the interpretation that counts, and what needs a look. */
export function purchaseView(ledger: PurchaseLedger) {
  return ledger.events
    .map((event) => {
      const revision = sourceRevision(ledger, event);
      const sources = ledger.sources.filter((s) =>
        event.sourceIds.includes(s.id),
      );
      const lines = event.lines.map((line) => {
        const chosen = effectiveAnnotation(
          ledger.annotations,
          event.id,
          line.id,
          revision,
        );
        const proposal =
          chosen?.origin === "model"
            ? null
            : (ledger.annotations.find(
                (a) =>
                  a.eventId === event.id &&
                  a.lineId === line.id &&
                  a.origin === "model" &&
                  a.sourceRevision === revision,
              ) ?? null);
        const pick = (a: SemanticAnnotation | null) =>
          a && {
            origin: a.origin,
            name: a.name,
            category: a.category,
            qualifiers: a.qualifiers,
            scope: a.scope,
          };
        return {
          ...line,
          interpretation: pick(chosen),
          /** A model proposal the shopper has not accepted, beside a rule or user interpretation. */
          proposal: pick(proposal),
          /** Why the line is in the review group; empty when nothing needs a look. */
          review: [
            ...(line.role === "unreadable" ? (["unreadable"] as const) : []),
            ...(line.role !== "unreadable" && line.gross === null
              ? (["missing-amount"] as const)
              : []),
            ...(line.role === "product" &&
            line.quantity.provenance === "unknown"
              ? (["unknown-quantity"] as const)
              : []),
            ...(line.role === "product" && !chosen
              ? (["uninterpreted"] as const)
              : []),
            ...(chosen?.origin === "model"
              ? (["model-proposal"] as const)
              : []),
          ],
        };
      });
      return {
        eventId: event.id,
        revision,
        origin: event.origin,
        status: event.status,
        chain: event.chain,
        store: event.store,
        purchasedAt: event.purchasedAt,
        datePrecision: event.datePrecision,
        importedAt: sources[0]?.importedAt ?? null,
        retention: sources.some((s) => s.retention === "original")
          ? ("original" as const)
          : ("sanitized" as const),
        unreadableLines: sources.reduce((n, s) => n + s.unreadableLines, 0),
        lines,
        adjustments: event.adjustments,
        printed: event.printed,
        reconciliation: event.reconciliation,
        reviewCount: lines.filter((l) => l.review.length).length,
      };
    })
    .sort((a, b) =>
      (b.purchasedAt ?? b.importedAt ?? "").localeCompare(
        a.purchasedAt ?? a.importedAt ?? "",
      ),
    );
}
export type PurchaseView = ReturnType<typeof purchaseView>;
