import { expect, test } from "vitest";
import { displayName } from "../src/domain/purchase-review";
import { sanitizeLabel } from "../src/domain/purchases";
import {
  groundedDisplayName,
  localDisplayName,
} from "../src/domain/receipt-names";
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

test("baseline: what the goldens allow, and what the local resolver shows without a model (F27.8)", () => {
  // The ceiling the labels themselves support, by tier.
  expect(tierCounts(nameGoldens.map((g) => g.expected.tier))).toEqual({
    lines: 24,
    exact: 14,
    expanded: 3,
    generic: 3,
    raw: 4,
  });
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
  // Before F27.8 every line showed its printed label (raw 22). The resolver now names what the
  // label supports and leaves the rest as printed.
  expect(tierCounts(shown.map((d) => d.tier))).toEqual({
    lines: 22,
    exact: 14,
    expanded: 3,
    generic: 0,
    raw: 5,
  });
  // Every line still has something readable to show.
  expect(shown.every((d) => d.text.length > 0)).toBe(true);
});

test("the local resolver never says more than the golden allows and gives up where the label is ambiguous", () => {
  const wrong: string[] = [];
  let named = 0;
  for (const golden of nameGoldens) {
    const role = golden.role;
    const local =
      role === "product" || role === "non-food"
        ? localDisplayName(golden.label)
        : null;
    if (golden.expected.display === null) {
      // The label proves no readable name: nothing may be made up.
      if (local) wrong.push(`${golden.id}: named ${local.name}`);
      continue;
    }
    if (!local) {
      wrong.push(`${golden.id}: gave up`);
      continue;
    }
    named++;
    if (
      local.name.toLocaleLowerCase("fi") !==
        golden.expected.display.toLocaleLowerCase("fi") ||
      local.tier !== golden.expected.tier
    )
      wrong.push(`${golden.id}: ${local.name} (${local.tier})`);
    // No invention is ever produced.
    expect(
      golden.inventions.map((i) => i.toLocaleLowerCase("fi")),
    ).not.toContain(local.name.toLocaleLowerCase("fi"));
  }
  expect({ wrong, named }).toEqual({ wrong: [], named: 17 });
});
