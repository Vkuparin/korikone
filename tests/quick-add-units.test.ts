import { expect, test } from "vitest";
import { Service } from "../src/application/service";
import { initialState } from "../src/domain/model";
import { addGrocery, lastGroceryAmount } from "../src/domain/groceries";
import { memoryStorage } from "./helpers/purchase-fixtures";

async function blank() {
  const store = memoryStorage();
  const state = initialState();
  state.staples = [];
  await store.storage.set("state", state);
  const service = new Service(store.storage);
  service.developmentMode = true;
  await service.init();
  return { service, storage: store.storage };
}

test("a piece amount of milk, yoghurt, butter or coffee keeps its found product as a one-pack offer (B7.3)", async () => {
  const { service, storage } = await blank();
  for (const name of ["maito", "jogurtti", "voi", "kahvi"])
    await service.refreshAfterChange(() =>
      service.save(addGrocery(service.state, name, "1", "pcs")),
    );
  await service.buildBasket();
  const offers = service.basket.map((line) => [
    line.requirement.name,
    line.product,
    line.packOffer && [
      line.packOffer.name,
      line.packOffer.packAmount,
      line.packOffer.unit,
    ],
  ]);
  // Nothing is chosen for the shopper; each row offers the pack it found.
  expect(offers).toEqual([
    ["maito", null, ["Maito 1 l", 1000, "ml"]],
    ["jogurtti", null, ["Jogurtti 1 kg", 1000, "g"]],
    ["voi", null, ["Voi 500 g", 500, "g"]],
    ["kahvi", null, ["Kahvi suodatinjauhatus 500 g", 500, "g"]],
  ]);
  // The offer survives a restart with the saved quote, matched again like any row.
  const restarted = new Service(storage);
  restarted.developmentMode = true;
  await restarted.init();
  expect(restarted.basket[0].packOffer?.name).toBe("Maito 1 l");
});

test("quick add starts from the amount last used for a name (B7.3)", () => {
  const state = initialState();
  state.extras = [{ id: "maito", name: "Maito", amount: 1000, unit: "ml" }];
  state.staples = [];
  expect(lastGroceryAmount(state, " maito ")).toEqual({
    amount: "1",
    unit: "l",
  });
  state.listHistory = [
    {
      id: "h",
      date: "2026-10-01",
      note: "",
      meals: [],
      recipes: [],
      extras: [{ id: "voi", name: "Voi", amount: 500, unit: "g" }],
      skipped: [],
      removed: [],
      quantities: {},
      prices: {},
      storeKey: "",
      transferred: [],
    },
  ];
  expect(lastGroceryAmount(state, "Voi")).toEqual({ amount: "500", unit: "g" });
  expect(lastGroceryAmount(state, "rusinat")).toBeNull();
});
