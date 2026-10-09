import { test, expect } from "vitest";
import { addGrocery } from "../src/domain/groceries";
import { initialState } from "../src/domain/model";
import { requirements } from "../src/domain/planner";
import { Service } from "../src/application/service";

test("manual groceries merge with recipe ingredients and receive a fresh fixture quote", async () => {
  const service = new Service({ get: async () => null, set: async () => {} });
  const state = initialState();
  state.staples = [];
  state.meals = [
    { id: "meal", recipeId: "soup", day: 0, servings: 4, leftovers: false },
  ];
  service.state = state;
  await service.save(addGrocery(state, "  PERUNA  ", "0,5", "kg"));
  await service.buildBasket();
  const potato = service.basket.filter((l) => l.requirement.name === "Peruna");
  expect(potato).toHaveLength(1);
  expect(potato[0].requirement.amount).toBe(1300);
  expect(potato[0].requirement.sources).toEqual([
    "Peruna-porkkanakeitto",
    "extra",
  ]);
  expect(potato[0].packs).toBe(2);
  expect(potato[0].total).toBe(398);
  await service.save(addGrocery(service.state, "Peruna", "200", "g"));
  expect(service.state.extras).toHaveLength(1);
  expect(
    requirements(service.state).find((r) => r.id === "potato")?.amount,
  ).toBe(1500);
});

test("manual additions retain home status, restore removed rows and add to quantity overrides", () => {
  const state = initialState();
  state.staples = [];
  state.quantities["potato:g"] = 2000;
  state.removed = ["potato:g", "carrot:g"];
  state.skipped = ["potato:g"];
  const next = addGrocery(state, "Peruna", "0.125", "kg");
  expect(next.quantities["potato:g"]).toBe(2125);
  expect(next.removed).toEqual(["carrot:g"]);
  expect(next.skipped).toEqual(["potato:g"]);
  expect(requirements(next)).toEqual([]);
  expect(requirements(next, new Date(), true)[0].amount).toBe(2125);
  expect(state.quantities["potato:g"]).toBe(2000);
});

test("manual amounts use base units and never merge incompatible units", () => {
  let state = initialState();
  state.staples = [];
  state = addGrocery(state, "Maito", "1,25", "l");
  state = addGrocery(state, "Maito", "2", "pcs");
  expect(state.extras.map((i) => [i.amount, i.unit])).toEqual([
    [1250, "ml"],
    [2, "pcs"],
  ]);
  for (const value of ["0", "-1", "NaN", "1e3", "0,0001", "10001"])
    expect(() => addGrocery(state, "Kahvi", value, "kg")).toThrow();
  expect(() => addGrocery(state, "Kahvi", "1,5", "pcs")).toThrow();
  expect(() => addGrocery(state, " ", "1", "g")).toThrow();
  state.quantities["milk:ml"] = 10_000_000;
  expect(() => addGrocery(state, "Maito", "1", "ml")).toThrow();
});
