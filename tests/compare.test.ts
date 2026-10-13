import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ComparePanel, CompareSummary } from "../src/ui/compare";
import type { Snapshot } from "../src/application/service";
import { compareBaskets } from "../src/domain/compare";
import type { BasketLine, Product } from "../src/domain/model";

const line = (
  id: string,
  total: number | null,
  { packs = 1, deposit = 0, product = true } = {},
): BasketLine => ({
  requirement: { id, name: id, amount: 1, unit: "pcs", sources: [] },
  product: product
    ? ({ id, deposit, price: total, packAmount: 1 } as unknown as Product)
    : null,
  packs,
  total: product ? total : null,
  candidates: [],
});

test("compares only rows both chains priced and lists the largest differences", () => {
  const result = compareBaskets(
    [
      line("milk", 119),
      line("coffee", 599),
      line("pasta", 129),
      line("bottle", 245, { packs: 1, deposit: 15 }),
      line("egg", null, { product: false }),
    ],
    [
      line("milk", 129),
      line("coffee", 499),
      line("pasta", 129),
      line("bottle", null, { product: false }),
      line("egg", 255),
    ],
  );
  expect(result.common).toEqual({ rows: 3, a: 847, b: 757 });
  expect(result.cheaper).toBe("b");
  expect(result.a).toEqual({ priced: 1092, missing: 1, deposits: 15 });
  expect(result.b).toEqual({ priced: 1012, missing: 1, deposits: 0 });
  // Equal rows are not differences; the largest change comes first.
  expect(result.largest.map((r) => [r.requirement.id, r.difference])).toEqual([
    ["coffee", -100],
    ["milk", 10],
  ]);
});

test("reports a tie and handles a chain that prices nothing", () => {
  const tie = compareBaskets([line("milk", 119)], [line("milk", 119)]);
  expect(tie.cheaper).toBeNull();
  expect(tie.largest).toEqual([]);
  const none = compareBaskets(
    [line("milk", 119), line("pasta", 129)],
    [
      line("milk", null, { product: false }),
      line("pasta", null, { product: false }),
    ],
  );
  expect(none.common).toEqual({ rows: 0, a: 0, b: 0 });
  expect(none.cheaper).toBeNull();
  expect(none.b).toEqual({ priced: 0, missing: 2, deposits: 0 });
  expect(none.a.priced).toBe(248);
});

test("limits the difference list and breaks ties by name", () => {
  const result = compareBaskets(
    [line("c", 100), line("a", 100), line("b", 100), line("d", 100)],
    [line("c", 150), line("a", 150), line("b", 50), line("d", 110)],
    2,
  );
  expect(result.largest.map((r) => r.requirement.id)).toEqual(["a", "b"]);
});

test("a cheap-looking total that covers fewer rows is never the cheaper basket", () => {
  // Eleven rows. This store prices all of them for 30,00; the other prices five for 14,00.
  const names = [..."abcdefghijk"];
  const here = names.map((id, i) =>
    line(id, i < 5 ? 260 : 283 + (i === 10 ? 2 : 0)),
  );
  const there = names.map((id, i) =>
    i < 5 ? line(id, 280) : line(id, null, { product: false }),
  );
  const result = compareBaskets(here, there);
  expect(result.a.priced).toBe(3000);
  expect(result.b).toMatchObject({ priced: 1400, missing: 6 });
  // The raw totals differ by 16,00 the other way, but on the five rows both sell this store
  // is 1,00 cheaper, and the result says how little of the list that covers.
  expect(result.common).toEqual({ rows: 5, a: 1300, b: 1400 });
  expect(result.cheaper).toBe("a");
  expect(result.coverage).toEqual({
    rows: 11,
    common: 5,
    onlyA: 6,
    onlyB: 0,
    neither: 0,
    complete: false,
  });
});

test("coverage counts rows priced at one chain, the other, both or neither, and whole packs reconcile to the cent", () => {
  const result = compareBaskets(
    [
      line("milk", 357, { packs: 3 }),
      line("bottle", 490, { packs: 2, deposit: 15 }),
      line("egg", null, { product: false }),
      line("salt", null, { product: false }),
    ],
    [
      line("milk", 387, { packs: 3 }),
      line("bottle", null, { product: false }),
      line("egg", 255),
      line("salt", null, { product: false }),
    ],
  );
  expect(result.coverage).toEqual({
    rows: 4,
    common: 1,
    onlyA: 1,
    onlyB: 1,
    neither: 1,
    complete: false,
  });
  // Three packs at each chain: 3 x 1,19 against 3 x 1,29.
  expect(result.common).toEqual({ rows: 1, a: 357, b: 387 });
  expect(result.largest).toMatchObject([{ a: 357, b: 387, difference: 30 }]);
  expect(result.a).toEqual({ priced: 847, missing: 2, deposits: 30 });
  const full = compareBaskets([line("milk", 119)], [line("milk", 129)]);
  expect(full.coverage).toMatchObject({ rows: 1, common: 1, complete: true });
  expect(compareBaskets([], []).coverage.complete).toBe(false);
});

test("the comparison names its coverage wherever it states a difference, in both languages", () => {
  const names = [..."abcdefghijk"];
  const here = names.map((id, i) => line(id, i < 5 ? 260 : 283));
  const there = names.map((id, i) =>
    i < 5 ? line(id, 280) : line(id, null, { product: false }),
  );
  const view = (fi: boolean, a = here, b = there) => {
    const snapshot = {
      state: { context: { providerId: "k-ruoka" }, language: fi ? "fi" : "en" },
      basket: a,
      comparison: {
        revision: 1,
        other: { providerId: "s-kaupat" },
        lines: b,
        result: compareBaskets(a, b),
        fees: { a: null, b: null },
      },
    } as unknown as Snapshot;
    const props = {
      snapshot,
      busy: false,
      call: async () => true,
      tr: (f: string, e: string) => (fi ? f : e),
      money: (cents: number) => `${(cents / 100).toFixed(2)} €`,
    };
    const text = (html: string) =>
      html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    return {
      summary: text(
        renderToStaticMarkup(
          createElement(CompareSummary, { ...props, onOpen: () => {} }),
        ),
      ),
      panel: text(
        renderToStaticMarkup(
          createElement(ComparePanel, {
            ...props,
            open: true,
            onClose: () => {},
          }),
        ),
      ),
    };
  };
  const fi = view(true);
  // 13,00 against 14,00 on the five shared rows; never "S-kaupat 16,00 cheaper".
  expect(fi.summary).toContain(
    "K-Ruoka 1.00 € halvempi yhteisissä 5/11 rivissä",
  );
  expect(fi.summary).not.toContain("16.00");
  expect(fi.panel).toContain(
    "K-Ruoka on edullisempi 1.00 € yhteisillä tuotteilla.",
  );
  expect(fi.panel).toContain(
    "Molemmissa hinnoiteltu 5 / 11 riviä. Vain K-Ruoka: 6, vain S-kaupat: 0, ei kummassakaan: 0.",
  );
  expect(fi.panel).toContain("ei ole koko korin säästö");
  const en = view(false);
  expect(en.summary).toContain(
    "K-Ruoka 1.00 € cheaper on the shared 5/11 rows",
  );
  expect(en.panel).toContain("Priced at both: 5 of 11 rows.");
  expect(en.panel).toContain("not a saving on the whole basket");
  // A fully priced comparison needs no such note.
  const full = view(
    true,
    [line("milk", 119), line("egg", 255)],
    [line("milk", 129), line("egg", 249)],
  );
  expect(full.summary).toContain("K-Ruoka 0.04 € halvempi ·");
  expect(full.summary).not.toContain("rivissä");
  expect(full.panel).not.toContain("Molemmissa hinnoiteltu");
});
