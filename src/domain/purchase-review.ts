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
import { localDisplayName } from "./receipt-names";

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

export type DisplayName = {
  /** Always something readable: the best name there is, else the sanitized printed label. */
  text: string;
  /**
   * user: the shopper named it. named: a rule or a model gave a readable name. general: only a
   * category is known and the printed label is shown. raw: nothing is known beyond the label.
   */
  specificity: "user" | "named" | "general" | "raw";
  /**
   * The evidence behind the text (F27.6), strongest first: the shopper's own name; a name whose
   * every word is printed (`exact`); one that spells out a printed abbreviation (`expanded`); a
   * generic grocery name (`generic`); or the printed label itself (`raw`).
   */
  tier: "user" | "exact" | "expanded" | "generic" | "raw";
  /** Who gave the name shown, and who gave the category; null when nobody did. */
  nameOrigin: SemanticAnnotation["origin"] | null;
  categoryOrigin: SemanticAnnotation["origin"] | null;
  /** The name or category rests on a model alone. Information, never a reason to review. */
  modelOnly: boolean;
};
/**
 * The name to show for a line. The shopper's wins, then a rule's, then a model's; the name and the
 * category are resolved separately, so a rule's category can stand beside a model's fuller name
 * without either taking the other's origin. Every line gets a text.
 */
export function displayName(
  line: Pick<EvidenceLine, "label"> & { role?: EvidenceLine["role"] },
  annotations: SemanticAnnotation[],
): DisplayName {
  const ordered = [...annotations].sort(
    (a, b) => rank[a.origin] - rank[b.origin],
  );
  // The shopper's own name first; then a grounded display name, exact before expanded and a
  // rule's before a model's within a tier; then a generic name; then the printed label.
  const own = ordered.find((a) => a.origin === "user" && a.name);
  // The local rule of F27.8 needs no model and no stored record: it reads the printed label only.
  const local =
    line.role === "product" || line.role === "non-food"
      ? localDisplayName(line.label)
      : null;
  const pick = (tier: "exact" | "expanded") => {
    const rule = ordered.find(
      (a) => a.origin !== "model" && a.display?.tier === tier,
    );
    if (rule) return { name: rule.display!.name, tier, origin: rule.origin };
    if (local?.tier === tier)
      return { name: local.name, tier, origin: "rule" as const };
    const model = ordered.find((a) => a.display?.tier === tier);
    return model
      ? { name: model.display!.name, tier, origin: model.origin }
      : null;
  };
  const groundedName = pick("exact") ?? pick("expanded");
  const grounded = groundedName && {
    origin: groundedName.origin,
    display: { name: groundedName.name, tier: groundedName.tier },
  };
  const generic = ordered.find((a) => a.name);
  const named = own ?? grounded ?? generic;
  const categorised = ordered.find((a) => a.category);
  const origins = new Set(ordered.map((a) => a.origin));
  // A name the local rule made is the rule's own, even when only a model annotated the line.
  if (grounded?.origin === "rule") origins.add("rule");
  return {
    text: own?.name ?? grounded?.display!.name ?? generic?.name ?? line.label,
    specificity: named
      ? named.origin === "user"
        ? "user"
        : "named"
      : categorised
        ? "general"
        : "raw",
    tier: own
      ? "user"
      : grounded
        ? grounded.display!.tier
        : generic
          ? "generic"
          : "raw",
    nameOrigin: named?.origin ?? null,
    categoryOrigin: categorised?.origin ?? null,
    modelOnly: origins.has("model") && origins.size === 1,
  };
}
function nameCounts(
  lines: { role: EvidenceLine["role"]; display: DisplayName }[],
) {
  const bought = lines.filter(
    (l) => l.role === "product" || l.role === "non-food",
  );
  const count = (specificity: DisplayName["specificity"]) =>
    bought.filter((l) => l.display.specificity === specificity).length;
  return {
    lines: bought.length,
    user: count("user"),
    named: count("named"),
    general: count("general"),
    raw: count("raw"),
    /** Of all bought lines, those whose interpretation is a model's alone. */
    modelOnly: bought.filter((l) => l.display.modelOnly).length,
  };
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
        const current = ledger.annotations.filter(
          (a) =>
            a.eventId === event.id &&
            a.lineId === line.id &&
            a.sourceRevision === revision,
        );
        // Factual and accounting issues only: what the source could not establish.
        const issues = [
          ...(line.role === "unreadable" ? (["unreadable"] as const) : []),
          ...(line.role !== "unreadable" && line.gross === null
            ? (["missing-amount"] as const)
            : []),
          ...(line.role === "product" && line.quantity.provenance === "unknown"
            ? (["unknown-quantity"] as const)
            : []),
        ];
        return {
          ...line,
          issues,
          display: displayName(line, current),
          interpretation: pick(chosen),
          /** A model proposal the shopper has not accepted, beside a rule or user interpretation. */
          proposal: pick(proposal),
          /**
           * Legacy (before F27.1): mixes factual issues with `uninterpreted` and
           * `model-proposal`. New code reads `issues` and `display`; a model's interpretation
           * alone is not something to review.
           */
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
        ocrPages: [...new Set(sources.flatMap((s) => s.ocrPages ?? []))].sort(
          (a, b) => a - b,
        ),
        unreadableLines: sources.reduce((n, s) => n + s.unreadableLines, 0),
        lines,
        adjustments: event.adjustments,
        printed: event.printed,
        reconciliation: event.reconciliation,
        /** Legacy count over `review`; includes model-only and uninterpreted rows. */
        reviewCount: lines.filter((l) => l.review.length).length,
        /** Lines with a factual issue. A model-made or missing name never counts here. */
        issueCount: lines.filter((l) => l.issues.length).length,
        /** Facts about the whole receipt that the reading or the accounting left open. */
        factual: {
          unbalanced: event.reconciliation.status === "unbalanced",
          incomplete: event.reconciliation.status === "incomplete",
          unreadableLines: sources.reduce((n, s) => n + s.unreadableLines, 0),
          ocr: sources.some((s) => (s.ocrPages ?? []).length > 0),
        },
        /** How the bought lines (products and non-food) are named. The five kinds add up. */
        names: nameCounts(lines),
      };
    })
    .sort((a, b) =>
      (b.purchasedAt ?? b.importedAt ?? "").localeCompare(
        a.purchasedAt ?? a.importedAt ?? "",
      ),
    );
}
export type PurchaseView = ReturnType<typeof purchaseView>;
