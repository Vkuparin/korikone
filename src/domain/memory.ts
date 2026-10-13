import type { Category, Qualifier } from "./categories";
import { sameGrocery } from "./purchase-links";
import type { AppState } from "./model";
import type { CategoryPreference } from "./preferences";
import {
  displayName,
  effectiveAnnotation,
  type DisplayName,
} from "./purchase-review";
import type {
  EvidenceLine,
  PurchaseChain,
  PurchaseEvent,
  PurchaseLedger,
} from "./purchases";

/**
 * One read model over what Korikone knows about the household's shopping. Four kinds of knowledge
 * stay apart and are never merged into one another:
 *
 * - `remembered`: explicit category preferences the shopper saved (F15). They bind matching.
 * - `purchases`: facts from completed receipts and orders (F6), with the interpretation of each
 *   line carried beside the fact and labelled with its origin.
 * - `transfers`: lists sent to a retailer cart (F7). Shopping intent, not purchases.
 * - statistics and aliases derived from `purchases` by the functions below. Observations only.
 *
 * Nothing here is stored: it is recomputed from the saved state and the purchase ledger, so a
 * deleted event, interpretation or preference is gone from the next read.
 */
export type Memory = {
  remembered: CategoryPreference[];
  purchases: PurchaseObservation[];
  transfers: TransferRecord[];
};
/** What a line was understood to be, and who said so. Null identity: nobody has said. */
export type ItemIdentity = {
  /** `category:<category>|<kind>=<value>…` or `name:<lowercase name>`. Never a product code. */
  key: string;
  name: string | null;
  category: Category | null;
  qualifiers: { kind: Qualifier["kind"]; value: string }[];
  origin: "rule" | "model" | "user";
};
export type PurchaseObservation = {
  eventId: string;
  lineId: string;
  origin: PurchaseEvent["origin"];
  chain: PurchaseChain;
  purchasedAt: string | null;
  datePrecision: PurchaseEvent["datePrecision"];
  /** The printed label, with its brand and size words, exactly as evidence has it. */
  label: string;
  quantity: EvidenceLine["quantity"];
  /** Paid amount of the line, else its printed price; null when neither is known. */
  amount: number | null;
  /** The line was under a campaign, discount or group offer at this purchase. */
  promotion: boolean;
  scope: "food" | "non-food" | "unknown";
  identity: ItemIdentity | null;
  /**
   * How the line reads (F27.6), for showing only. It is never part of `identity`: a readable
   * name does not group purchases, confirm an alias or count as a preference.
   */
  display: DisplayName;
};
/** A readable name with the evidence behind it, as the memory views carry it (F27.10). */
export type ReadableName = Pick<DisplayName, "text" | "tier" | "nameOrigin">;
const readable = (display: DisplayName): ReadableName => ({
  text: display.text,
  tier: display.tier,
  nameOrigin: display.nameOrigin,
});
/**
 * Whether a readable name may be given to the planning model as a hint: the shopper's own name,
 * or a name whose every word the receipt prints or spells out, made by the local rule. A model's
 * name stays out however well grounded, and so do generic names and bare printed labels.
 */
export const contextNameRule = /^[\p{L}\p{N}][\p{L}\p{N} ,.%+&'()/-]{1,79}$/u;
export function contextName(display: ReadableName): string | null {
  return (display.nameOrigin === "user" || display.nameOrigin === "rule") &&
    (display.tier === "user" ||
      display.tier === "exact" ||
      display.tier === "expanded") &&
    contextNameRule.test(display.text) &&
    !/\d{4,}/.test(display.text)
    ? display.text
    : null;
}
export type TransferRecord = {
  id: string;
  date: string;
  /** `providerId:storeId` of the transfer, or empty for entries saved before stores were kept. */
  storeKey: string;
  items: { name: string; quantity: number; unit: string; price: number }[];
};

const identityOf = (a: {
  name: string | null;
  category: Category | null;
  qualifiers: { kind: Qualifier["kind"]; value: string }[];
  origin: "rule" | "model" | "user";
}): ItemIdentity | null => {
  const name = a.name?.trim().toLocaleLowerCase("fi") || null;
  if (!a.category && !name) return null;
  return {
    key: a.category
      ? `category:${a.category}${a.qualifiers
          .map((q) => `|${q.kind}=${q.value}`)
          .sort()
          .join("")}`
      : `name:${name}`,
    name: a.name,
    category: a.category,
    qualifiers: a.qualifiers,
    origin: a.origin,
  };
};

/**
 * Reads the memory. Only completed purchases yield observations: pending, cancelled and
 * unknown-state orders, the legacy receipt text and every transfer are left out of them.
 */
export function readMemory(state: AppState, ledger: PurchaseLedger): Memory {
  const purchases: PurchaseObservation[] = [];
  for (const event of ledger.events) {
    if (event.status !== "completed") continue;
    const revision = Math.max(
      ...ledger.sources
        .filter((s) => event.sourceIds.includes(s.id))
        .map((s) => s.revision),
    );
    const reduced = new Set(event.adjustments.flatMap((a) => a.lineIds));
    for (const line of event.lines) {
      if (line.role !== "product" && line.role !== "non-food") continue;
      const annotation = effectiveAnnotation(
        ledger.annotations,
        event.id,
        line.id,
        revision,
      );
      purchases.push({
        eventId: event.id,
        lineId: line.id,
        origin: event.origin,
        chain: event.chain,
        purchasedAt: event.purchasedAt,
        datePrecision: event.datePrecision,
        label: line.label,
        quantity: line.quantity,
        amount: line.net ?? line.gross,
        promotion: reduced.has(line.id),
        // The receipt's own section wins; otherwise the interpretation's scope, else unknown.
        scope:
          line.role === "non-food"
            ? "non-food"
            : (annotation?.scope ?? "unknown"),
        identity:
          annotation && line.role !== "non-food"
            ? identityOf(annotation)
            : null,
        display: displayName(
          line,
          ledger.annotations.filter(
            (a) =>
              a.eventId === event.id &&
              a.lineId === line.id &&
              a.sourceRevision === revision,
          ),
        ),
      });
    }
  }
  return {
    remembered: structuredClone(state.categoryPreferences),
    purchases,
    transfers: state.listHistory.map((entry) => ({
      id: entry.id,
      date: entry.date,
      storeKey: entry.storeKey,
      items: entry.transferred.map(({ name, quantity, unit, price }) => ({
        name,
        quantity,
        unit,
        price,
      })),
    })),
  };
}

export type PurchaseAlias = {
  key: string;
  name: string | null;
  category: Category | null;
  qualifiers: { kind: Qualifier["kind"]; value: string }[];
  /** How many observations each origin interpreted. A model-only alias is unconfirmed. */
  origins: { rule: number; model: number; user: number };
  confirmed: boolean;
  /** The printed labels behind the alias, per chain. The same alias is never the same product. */
  labels: {
    chain: PurchaseChain;
    label: string;
    observations: number;
    /** How this label reads; the newest reading of the same label. */
    display: ReadableName;
  }[];
  observations: number;
  /** A saved preference for this category whose qualifiers the alias does not all carry. */
  conflictsWithRemembered: boolean;
  /**
   * The readable name most often bought under this alias, the shopper's own first; null when
   * every purchase shows only a generic name or its printed label.
   */
  display: (ReadableName & { observations: number }) | null;
  /**
   * Whether this alias is given to the planning model for a request that asks for the usual,
   * and why not when it is not (F27.10). `readableName` is the name sent with it, or null.
   * Decided by `aliasContext`; `observedSummaries` sends exactly the eligible ones.
   */
  context: AliasContext;
};
export type AliasContext = {
  eligible: boolean;
  reason:
    | "eligible"
    /** Only a model read these purchases. */
    | "model-only"
    /** Grouped by name; there is no validated category to send. */
    | "no-category"
    /** The shopper saved a preference for the category, which speaks instead. */
    | "remembered-preference"
    /** Fewer than two purchases. */
    | "few-observations";
  readableName: string | null;
};
export const contextRules = Object.freeze({ observations: 2, summaries: 20 });
function aliasContext(
  alias: Omit<PurchaseAlias, "context">,
  remembered: Set<Category>,
): AliasContext {
  const reason: AliasContext["reason"] = !alias.confirmed
    ? "model-only"
    : alias.category === null
      ? "no-category"
      : remembered.has(alias.category)
        ? "remembered-preference"
        : alias.observations < contextRules.observations
          ? "few-observations"
          : "eligible";
  return {
    eligible: reason === "eligible",
    reason,
    readableName:
      reason === "eligible" && alias.display
        ? contextName(alias.display)
        : null,
  };
}
/**
 * Groups interpreted purchase lines into aliases by category and qualifiers, or by name. Lines
 * nobody interpreted are returned as `unresolved` labels and belong to no alias. An alias links
 * labels as the same kind of grocery only: it says nothing about equal products across chains,
 * and it is never written back as a preference.
 */
export function purchaseAliases(memory: Memory): {
  aliases: PurchaseAlias[];
  unresolved: {
    chain: PurchaseChain;
    label: string;
    observations: number;
    display: ReadableName;
  }[];
} {
  const aliases = new Map<string, Omit<PurchaseAlias, "context">>();
  /** Per alias, how often each readable name was bought. */
  const names = new Map<string, Map<string, ReadableName & { n: number }>>();
  const unresolved = new Map<
    string,
    {
      chain: PurchaseChain;
      label: string;
      observations: number;
      display: ReadableName;
    }
  >();
  for (const purchase of memory.purchases) {
    if (purchase.scope === "non-food") continue;
    if (!purchase.identity) {
      const key = `${purchase.chain}\n${purchase.label}`;
      const entry = unresolved.get(key) ?? {
        chain: purchase.chain,
        label: purchase.label,
        observations: 0,
        display: readable(purchase.display),
      };
      entry.observations++;
      unresolved.set(key, entry);
      continue;
    }
    const { identity } = purchase;
    const rule = memory.remembered.find(
      (r) => r.category === identity.category,
    );
    const alias = aliases.get(identity.key) ?? {
      key: identity.key,
      name: identity.name,
      category: identity.category,
      qualifiers: identity.qualifiers,
      origins: { rule: 0, model: 0, user: 0 },
      confirmed: false,
      labels: [],
      observations: 0,
      display: null,
      conflictsWithRemembered:
        !!rule &&
        rule.qualifiers.some(
          (q) =>
            !identity.qualifiers.some(
              (own) => own.kind === q.kind && own.value === q.value,
            ),
        ),
    };
    alias.origins[identity.origin]++;
    alias.confirmed ||= identity.origin !== "model";
    alias.observations++;
    // A shopper's own name for the alias replaces a rule's or a model's.
    if (identity.origin === "user" && identity.name) alias.name = identity.name;
    const label = alias.labels.find(
      (l) => l.chain === purchase.chain && l.label === purchase.label,
    );
    if (label) label.observations++;
    else
      alias.labels.push({
        chain: purchase.chain,
        label: purchase.label,
        observations: 1,
        display: readable(purchase.display),
      });
    // Generic names and bare labels say nothing more than the alias itself.
    if (
      purchase.display.tier !== "generic" &&
      purchase.display.tier !== "raw"
    ) {
      const counted = names.get(identity.key) ?? new Map();
      const name = readable(purchase.display);
      const id = `${name.tier === "user" ? 0 : 1}\n${name.text}`;
      counted.set(id, { ...name, n: (counted.get(id)?.n ?? 0) + 1 });
      names.set(identity.key, counted);
    }
    aliases.set(identity.key, alias);
  }
  const remembered = new Set(memory.remembered.map((r) => r.category));
  return {
    aliases: [...aliases.values()]
      .map((alias) => {
        // The shopper's own name first, then the most bought, then alphabetically.
        const best = [...(names.get(alias.key)?.entries() ?? [])].sort(
          (a, b) =>
            Number(b[1].tier === "user") - Number(a[1].tier === "user") ||
            b[1].n - a[1].n ||
            a[0].localeCompare(b[0]),
        )[0]?.[1];
        const withName = {
          ...alias,
          display: best
            ? {
                text: best.text,
                tier: best.tier,
                nameOrigin: best.nameOrigin,
                observations: best.n,
              }
            : null,
        };
        return { ...withName, context: aliasContext(withName, remembered) };
      })
      .sort((a, b) => a.key.localeCompare(b.key)),
    unresolved: [...unresolved.values()],
  };
}

export const statisticsRules = Object.freeze({
  /** Weeks looked at, and weeks with a purchase needed, for a recurrence suggestion. */
  weeks: 8,
  weeksNeeded: 4,
  maxSuggestions: 5,
  dismissalDays: 90,
  /** Comparable visits needed before a typical quantity is stated. */
  quantityVisits: 3,
  /** A visit above this multiple of the median is an outlier and widens nothing. */
  outlierFactor: 3,
});
const DAY = 86_400_000;
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};
/** Monday 00:00 UTC of the week holding the time. */
const weekStart = (time: number) => {
  const date = new Date(time);
  const day = (date.getUTCDay() + 6) % 7;
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() - day,
  );
};

export type PurchaseStatistic = {
  key: string;
  name: string | null;
  category: Category | null;
  qualifiers: { kind: Qualifier["kind"]; value: string }[];
  confirmed: boolean;
  chains: PurchaseChain[];
  /** Dated purchase events that held this grocery, and the first and last of their dates. */
  visits: number;
  from: string;
  to: string;
  /** Distinct weeks with a purchase among the last eight, and the median gap between visits. */
  weeksOfLastEight: number;
  medianGapDays: number | null;
  /**
   * The usual amount per visit, when at least three comparable visits support one. Counts are
   * comparable only for the same label at the same chain, because a pack size is part of the
   * label; weights and volumes compare across labels. Promotion visits and outliers are left out
   * while ordinary visits exist. Null means unknown, never zero.
   */
  typical: {
    amount: number;
    unit: "pcs" | "g" | "ml";
    visits: number;
    min: number;
    max: number;
  } | null;
};
/**
 * Per-grocery statistics from dated, completed food purchases with a known identity. Undated
 * purchases, non-food rows and uninterpreted labels contribute nothing.
 */
export function purchaseStatistics(
  memory: Memory,
  now: Date,
): PurchaseStatistic[] {
  type Visit = { time: number; rows: PurchaseObservation[] };
  const groups = new Map<
    string,
    { identity: ItemIdentity; confirmed: boolean; visits: Map<string, Visit> }
  >();
  for (const purchase of memory.purchases) {
    if (
      !purchase.identity ||
      purchase.scope === "non-food" ||
      purchase.purchasedAt === null ||
      Date.parse(purchase.purchasedAt) > now.getTime()
    )
      continue;
    const group = groups.get(purchase.identity.key) ?? {
      identity: purchase.identity,
      confirmed: false,
      visits: new Map<string, Visit>(),
    };
    group.confirmed ||= purchase.identity.origin !== "model";
    const visit = group.visits.get(purchase.eventId) ?? {
      time: Date.parse(purchase.purchasedAt),
      rows: [],
    };
    visit.rows.push(purchase);
    group.visits.set(purchase.eventId, visit);
    groups.set(purchase.identity.key, group);
  }
  const currentWeek = weekStart(now.getTime());
  return [...groups.values()]
    .map(({ identity, confirmed, visits }) => {
      const ordered = [...visits.values()].sort((a, b) => a.time - b.time);
      const days = [...new Set(ordered.map((v) => Math.floor(v.time / DAY)))];
      const weeks = new Set(
        ordered
          .map((v) => weekStart(v.time))
          .filter(
            (week) =>
              week <= currentWeek &&
              week > currentWeek - statisticsRules.weeks * 7 * DAY,
          ),
      );
      return {
        key: identity.key,
        name: identity.name,
        category: identity.category,
        qualifiers: identity.qualifiers,
        confirmed,
        chains: [
          ...new Set(ordered.flatMap((v) => v.rows.map((r) => r.chain))),
        ],
        visits: ordered.length,
        from: new Date(ordered[0].time).toISOString(),
        to: new Date(ordered.at(-1)!.time).toISOString(),
        weeksOfLastEight: weeks.size,
        medianGapDays:
          days.length >= 2
            ? median(days.slice(1).map((day, i) => day - days[i]))
            : null,
        typical: typicalQuantity(ordered),
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

function typicalQuantity(
  visits: { rows: PurchaseObservation[] }[],
): PurchaseStatistic["typical"] {
  // Per visit and comparability class: the summed quantity, or null if any row lacks one.
  const classes = new Map<
    string,
    {
      unit: "pcs" | "g" | "ml";
      amounts: { amount: number; promotion: boolean }[];
    }
  >();
  for (const visit of visits) {
    const perClass = new Map<
      string,
      { unit: "pcs" | "g" | "ml"; amount: number | null; promotion: boolean }
    >();
    for (const row of visit.rows) {
      const unit = row.quantity.unit;
      const key =
        unit === "pcs" || unit === null
          ? `pcs\n${row.chain}\n${row.label}`
          : unit;
      const entry = perClass.get(key) ?? {
        unit: unit ?? "pcs",
        amount: 0,
        promotion: false,
      };
      entry.amount =
        entry.amount === null || row.quantity.amount === null
          ? null
          : entry.amount + row.quantity.amount;
      entry.promotion ||= row.promotion;
      perClass.set(key, entry);
    }
    for (const [key, entry] of perClass) {
      if (entry.amount === null) continue;
      const list = classes.get(key) ?? { unit: entry.unit, amounts: [] };
      list.amounts.push({ amount: entry.amount, promotion: entry.promotion });
      classes.set(key, list);
    }
  }
  let best: PurchaseStatistic["typical"] = null;
  for (const { unit, amounts } of classes.values()) {
    const ordinary = amounts.filter((a) => !a.promotion);
    const used = (
      ordinary.length >= statisticsRules.quantityVisits ? ordinary : amounts
    ).map((a) => a.amount);
    if (used.length < statisticsRules.quantityVisits) continue;
    const middle = median(used);
    const kept = used.filter(
      (amount) => amount <= middle * statisticsRules.outlierFactor,
    );
    if (kept.length < statisticsRules.quantityVisits) continue;
    if (!best || kept.length > best.visits)
      best = {
        amount: median(kept),
        unit,
        visits: kept.length,
        min: Math.min(...kept),
        max: Math.max(...kept),
      };
  }
  return best;
}

export type RecurrenceSuggestion = PurchaseStatistic & {
  /** The label most often bought, for display beside the name. */
  label: string;
  /** How that label reads (F27.10). Showing only: accepting a suggestion saves no preference. */
  display: ReadableName;
};
/**
 * Groceries bought in at least four of the last eight weeks, most regular first, at most five.
 * A suggestion is evidence with its period; it adds nothing to a list and becomes a recurring
 * item only when the shopper accepts it. A dismissed key stays out for ninety days.
 */
export function recurrenceSuggestions(
  memory: Memory,
  now: Date,
  options: {
    dismissed?: { key: string; at: string }[];
    /** Identity keys or lowercase names the household already has as recurring items. */
    existing?: string[];
  } = {},
): RecurrenceSuggestion[] {
  const dismissed = new Set(
    (options.dismissed ?? [])
      .filter(
        (d) =>
          now.getTime() - Date.parse(d.at) <
          statisticsRules.dismissalDays * DAY,
      )
      .map((d) => d.key),
  );
  const existing = new Set(
    (options.existing ?? []).map((name) => name.trim().toLocaleLowerCase("fi")),
  );
  const labelOf = (key: string) => {
    const counts = new Map<string, number>();
    for (const p of memory.purchases)
      if (p.identity?.key === key)
        counts.set(p.label, (counts.get(p.label) ?? 0) + 1);
    const label = [...counts].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0][0];
    return {
      label,
      display: readable(
        memory.purchases.find(
          (p) => p.identity?.key === key && p.label === label,
        )!.display,
      ),
    };
  };
  return purchaseStatistics(memory, now)
    .map((s) => ({ ...s, ...labelOf(s.key) }))
    .filter(
      (s) =>
        s.weeksOfLastEight >= statisticsRules.weeksNeeded &&
        !dismissed.has(s.key) &&
        !existing.has(s.key) &&
        // A recurring item the household already has, matched by name against the label.
        ![...existing].some(
          (name) =>
            sameGrocery(name, s.label) ||
            (s.name !== null && sameGrocery(name, s.name)),
        ),
    )
    .sort(
      (a, b) =>
        b.weeksOfLastEight - a.weeksOfLastEight ||
        b.visits - a.visits ||
        a.key.localeCompare(b.key),
    )
    .slice(0, statisticsRules.maxSuggestions);
}

/**
 * Bounded observed summaries for the compact AI context (`ObservedSummary` in `src/ai/context.ts`):
 * confirmed category aliases with at least two purchases, most observed first. A category with a
 * saved preference is left out, because the explicit preference already speaks for it. Exactly
 * the aliases whose `context.eligible` is true, each with its `context.readableName` when it has
 * one. The name is a hint about how the purchase reads; it carries no product code, and the
 * classification beside it holds only what the interpretation itself established.
 */
export function observedSummaries(
  memory: Memory,
  limit: number = contextRules.summaries,
) {
  return purchaseAliases(memory)
    .aliases.filter((alias) => alias.context.eligible)
    .sort(
      (a, b) => b.observations - a.observations || a.key.localeCompare(b.key),
    )
    .slice(0, Math.max(0, Math.min(limit, contextRules.summaries)))
    .map((alias) => ({
      ...(alias.context.readableName
        ? { readableName: alias.context.readableName }
        : {}),
      classification: {
        category: alias.category!,
        provenance: "observed" as const,
        qualifiers: alias.qualifiers.map((q) => ({
          ...q,
          provenance: "observed" as const,
        })),
      },
      observations: Math.min(alias.observations, 1000),
    }));
}

/**
 * Whether a request asks for what the household usually buys. Only then are observed summaries
 * given to the model; an ordinary request, or one that names its own groceries, gets no
 * purchase history at all.
 */
export function observationsApply(request: string): boolean {
  return /(?<![\p{L}])(?:usual(?:ly)?|as usual|the regulars?|regular items|typical(?:ly)?|like last time|as always|kuten tavallisesti|kuten aina|kuten viimeksi|tavalliset?|tavallisen|tavallisia|yleensä|tuttuun tapaan|tutut)(?![\p{L}])/iu.test(
    request,
  );
}
