import { expect, test } from "vitest";
import { displayName } from "../src/domain/purchase-review";
import { sanitizeLabel } from "../src/domain/purchases";
import { groundedDisplayName } from "../src/domain/receipt-names";
import { ruleAnnotations } from "../src/domain/receipt-semantics";
import { nameGoldens } from "./fixtures/receipts/names";
import { purchaseEvent, purchaseLine } from "./helpers/purchase-fixtures";

/**
 * Evidence tiers of a set of shown names, as F27.7 defines them: `exact` and `expanded` are
 * grounded display names, `generic` a grocery name without brand or pack, `raw` the printed label.
 */
export function tierCounts(tiers: string[]) {
  const count = (tier: string) => tiers.filter((t) => t === tier).length;
  return {
    lines: tiers.length,
    exact: count("exact"),
    expanded: count("expanded"),
    generic: count("generic"),
    raw: count("raw") + count("user"),
  };
}

test("the golden cases are well formed and written against sanitized labels", () => {
  expect(nameGoldens.length).toBeGreaterThanOrEqual(24);
  expect(new Set(nameGoldens.map((g) => g.id)).size).toBe(nameGoldens.length);
  for (const golden of nameGoldens) {
    expect([golden.id, sanitizeLabel(golden.label)]).toEqual([
      golden.id,
      golden.label,
    ]);
    const { display, tier, generic } = golden.expected;
    // A grounded name has a grounded tier; without one the line is generic or raw.
    expect([golden.id, display !== null]).toEqual([
      golden.id,
      tier === "exact" || tier === "expanded",
    ]);
    if (tier === "generic") expect(generic.length).toBeGreaterThan(0);
    expect(golden.inventions.length).toBeGreaterThan(0);
    // Deposits and campaign rows are never named as products.
    if (golden.role === "deposit" || golden.role === "other")
      expect([golden.id, display, generic]).toEqual([golden.id, null, []]);
  }
  // The areas the card names are all present.
  for (const area of [
    /abbreviation/i,
    /flavour/i,
    /qualifier/i,
    /private label|private-label/i,
    /twice/i,
    /weighed/i,
    /deposit/i,
    /campaign/i,
    /household/i,
    /instruction/i,
  ])
    expect(nameGoldens.some((g) => area.test(g.covers))).toBe(true);
});

test("every expected name is supported by its label, and no invention is ever accepted", () => {
  const disagreements: string[] = [];
  let accepted = 0;
  let inventions = 0;
  for (const golden of nameGoldens) {
    const { display, tier } = golden.expected;
    if (display !== null) {
      const result = groundedDisplayName(golden.label, display);
      if (result?.tier !== tier || result.name !== display)
        disagreements.push(`${golden.id}: expected ${tier}`);
    }
    for (const invention of golden.inventions) {
      inventions++;
      if (groundedDisplayName(golden.label, invention)) {
        accepted++;
        disagreements.push(`${golden.id}: accepted "${invention}"`);
      }
    }
  }
  // False specificity: inventions accepted, over all inventions tried. The gate is zero.
  expect({ disagreements, accepted, inventions }).toEqual({
    disagreements: [],
    accepted: 0,
    inventions: 56,
  });
  // On the ambiguity cases in particular, nothing more specific than the label gets through.
  const ambiguous = nameGoldens.filter((g) => g.ambiguous);
  expect(ambiguous.length).toBe(9);
  expect(
    ambiguous.flatMap((g) =>
      g.inventions.filter((i) => groundedDisplayName(g.label, i)),
    ),
  ).toEqual([]);
});

test("baseline: what the goldens allow, and what the local rules show today", () => {
  // The ceiling the labels themselves support, by tier.
  expect(tierCounts(nameGoldens.map((g) => g.expected.tier))).toEqual({
    lines: 24,
    exact: 14,
    expanded: 3,
    generic: 3,
    raw: 4,
  });
  // Today: local rules give a category and no name, so every line shows its printed label.
  const bought = nameGoldens.filter(
    (g) => g.role === "product" || g.role === "non-food",
  );
  const event = purchaseEvent("e1", "s1", {
    lines: bought.map((g, i) =>
      purchaseLine(`l${i + 1}`, g.label, 100, {
        role: g.role as "product" | "non-food",
      }),
    ),
  });
  const rules = ruleAnnotations(event, 1, "2026-10-13T08:00:00.000Z");
  const shown = event.lines.map((line) =>
    displayName(
      line,
      rules.filter((a) => a.lineId === line.id),
    ),
  );
  expect(tierCounts(shown.map((d) => d.tier))).toEqual({
    lines: 22,
    exact: 0,
    expanded: 0,
    generic: 0,
    raw: 22,
  });
  // A rule's category is known for some lines even though no name is.
  expect(shown.filter((d) => d.specificity === "general").length).toBe(11);
  // Every line has something readable to show.
  expect(shown.every((d) => d.text.length > 0)).toBe(true);
  // Exact names need no model: writing the label out in ordinary case already grounds them.
  const lowerCased = bought.filter((g) => {
    const plain = g.label.charAt(0) + g.label.slice(1).toLocaleLowerCase("fi");
    return groundedDisplayName(g.label, plain)?.tier === "exact";
  });
  expect(lowerCased.length).toBe(22);
});
