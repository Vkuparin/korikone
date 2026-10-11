import { expect, test } from "vitest";
import { canCompare, compareBlocker } from "../src/ui/compare";
import type { Snapshot } from "../src/application/service";
import { initialState, type StoreContext } from "../src/domain/model";

const store = (providerId: string): StoreContext => ({
  providerId,
  storeId: `${providerId}-1`,
  storeName: `${providerId} store`,
  fulfillment: "pickup",
});
function snapshot(
  active: string,
  remembered: string[],
  signedIn: string[],
): Snapshot {
  const state = initialState();
  state.context = store(active);
  state.stores = Object.fromEntries(
    [active, ...remembered].map((id) => [id, store(id)]),
  );
  return {
    state,
    storeLogins: Object.fromEntries(signedIn.map((id) => [id, "signedIn"])),
  } as unknown as Snapshot;
}

test("the comparison prerequisite names the missing store or sign-in and its chain", () => {
  const both = ["k-ruoka", "s-kaupat"];
  // Ready: nothing blocks it.
  const ready = snapshot("s-kaupat", ["k-ruoka"], both);
  expect(canCompare(ready)).toBe(true);
  expect(compareBlocker(ready)).toBeNull();
  // The other chain has no store: that comes first, whatever the sign-ins are.
  for (const signedIn of [both, ["s-kaupat"], []]) {
    const missing = snapshot("s-kaupat", [], signedIn);
    expect(canCompare(missing)).toBe(false);
    expect(compareBlocker(missing)).toEqual({
      need: "store",
      chain: "K-Ruoka",
    });
  }
  expect(compareBlocker(snapshot("k-ruoka", [], both))).toEqual({
    need: "store",
    chain: "S-kaupat",
  });
  // Both stores chosen: the active chain's sign-in is named before the other's.
  expect(compareBlocker(snapshot("s-kaupat", ["k-ruoka"], []))).toEqual({
    need: "login",
    chain: "S-kaupat",
  });
  expect(
    compareBlocker(snapshot("s-kaupat", ["k-ruoka"], ["s-kaupat"])),
  ).toEqual({ need: "login", chain: "K-Ruoka" });
  expect(
    compareBlocker(snapshot("k-ruoka", ["s-kaupat"], ["s-kaupat"])),
  ).toEqual({ need: "login", chain: "K-Ruoka" });
  // Sample stores have no comparison and no prerequisite to explain.
  const demo = snapshot("demo-k", ["k-ruoka", "s-kaupat"], both);
  expect(canCompare(demo)).toBe(false);
  expect(compareBlocker(demo)).toBeNull();
});
