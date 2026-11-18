import { expect, test } from "vitest";
import { initialState, parseState, stateSchema } from "../src/domain/model";
import { cheaperThanUsual, type PriceObservation } from "../src/domain/prices";

const entry = (id: string) => ({
  id,
  date: "2026-10-01",
  note: "",
  meals: [],
  extras: [],
  transferred: [
    { productId: "p", name: "Maito", quantity: 1, unit: "pcs", price: 119 },
  ],
});

test("unchanged list history is reused, not re-validated; any other history is validated (B7.4)", () => {
  const known = stateSchema.parse({
    ...initialState(),
    listHistory: [entry("a"), entry("b")],
  });
  // The same history, by reference or as an equal copy from the window, is shared as validated.
  const same = parseState({ ...known, note: "maitoa" }, known);
  expect(same.listHistory).toBe(known.listHistory);
  expect(same.note).toBe("maitoa");
  const copy = parseState(structuredClone({ ...known, note: "x" }), known);
  expect(copy.listHistory).toBe(known.listHistory);
  // A changed history goes through the full schema, which still refuses bad entries.
  const changed = parseState(
    { ...known, listHistory: [entry("c"), ...known.listHistory] },
    known,
  );
  expect(changed.listHistory.map((h) => h.id)).toEqual(["c", "a", "b"]);
  expect(() =>
    parseState(
      { ...known, listHistory: [{ ...entry("d"), transferred: "x" }] },
      known,
    ),
  ).toThrow();
  // The rest of the state is validated as before.
  expect(() => parseState({ ...known, revision: -1 }, known)).toThrow();
});

test("cheaper than usual reads an index built once per price history (B7.4)", () => {
  const product = {
    id: "p",
    providerId: "demo-k",
    storeId: "s",
    price: 90,
    packAmount: 1,
  } as Parameters<typeof cheaperThanUsual>[0];
  const history: PriceObservation[] = [];
  for (let d = 1; d <= 6; d++)
    history.push({
      productId: "p",
      providerId: "demo-k",
      storeId: "s",
      date: `2026-10-0${d}`,
      price: 120,
      unitPrice: 120,
    });
  // Another store's prices and today's price do not count.
  history.push({ ...history[0], storeId: "other", unitPrice: 10 });
  history.push({ ...history[0], date: "2026-10-12", unitPrice: 10 });
  const now = new Date("2026-10-12T10:00:00Z");
  expect(cheaperThanUsual(product, history, now)).toBe(true);
  expect(cheaperThanUsual({ ...product, price: 115 }, history, now)).toBe(
    false,
  );
  expect(cheaperThanUsual(product, history.slice(0, 3), now)).toBe(false);
});
