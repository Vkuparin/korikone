import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { Service } from "../src/application/service";
import { lineMerchandiseStatus } from "../src/domain/matching";
import type { MerchandiseIntent } from "../src/domain/merchandise";
import type { StoreContext } from "../src/domain/model";
import { DemoProvider } from "../src/stores/demo";
import { KRuokaProvider } from "../src/stores/k-ruoka";
import { KRuokaSite, type PageRequest } from "../src/stores/k-ruoka-site";
import {
  LARGE_STORE,
  SMALL_STORE,
  largeStore,
  response,
} from "./fixtures/k-ruoka/non-food";
import { memoryStorage } from "./helpers/purchase-fixtures";

const basket = JSON.parse(
  readFileSync(
    new URL("./fixtures/k-ruoka/basket-active.json", import.meta.url),
    "utf8",
  ),
);
const context = (storeId: string): StoreContext => ({
  providerId: "k-ruoka",
  storeId,
  storeName: "Synteettinen kauppa",
  fulfillment: "pickup",
});
const intent = (
  family: string,
  attributes: [MerchandiseIntent["attributes"][number]["kind"], string][],
  missing: MerchandiseIntent["missing"] = [],
): MerchandiseIntent => ({
  version: 1,
  family,
  attributes: attributes.map(([kind, value]) => ({
    kind,
    value,
    provenance: "explicit-note",
  })),
  missing,
});
const boots = (size: string | null) => ({
  id: "kumisaapas",
  name: "Kumisaapas",
  amount: 1,
  unit: "pcs" as const,
  merchandise: size
    ? intent("kumisaapas", [["size", size]])
    : intent("kumisaapas", [], ["size"]),
});
const pan = {
  id: "paistinpannu",
  name: "Paistinpannu",
  amount: 1,
  unit: "pcs" as const,
  merchandise: intent("paistinpannu", [["spec", "28 cm"]]),
};
const batteries = {
  id: "alkaliparisto",
  name: "Alkaliparisto",
  amount: 8,
  unit: "pcs" as const,
  merchandise: intent("alkaliparisto", [["model", "AA"]]),
};
/** The real K site client and adapter in a real Service, over a synthetic store page. */
async function shop(
  storeId: string,
  extras: object[],
  answer: (query: string) => { status?: number; body?: unknown } = (query) => ({
    body: response(
      storeId,
      query,
      storeId === LARGE_STORE ? (largeStore[query.toLowerCase()] ?? []) : [],
    ),
  }),
) {
  const searches: string[] = [];
  const writes: unknown[] = [];
  const request: PageRequest = async (r) => {
    const query = decodeURIComponent(
      r.path.match(/product-search\/([^?]+)/)?.[1] ?? "",
    );
    let a: { status?: number; body?: unknown } = { status: 404 };
    if (r.path.startsWith("/kr-api/v2/product-search/")) {
      searches.push(query);
      a = answer(query);
    } else if (r.path.startsWith("/kr-api/basket/")) {
      if (r.method !== "GET" && r.path.includes("by-id")) writes.push(r.body);
      a = { body: { ...basket, items: [], store: { id: storeId, name: "S" } } };
    }
    return {
      status: a.status ?? 200,
      build: "42",
      cfMitigated: null,
      body: JSON.stringify(a.body ?? {}),
    };
  };
  const memory = memoryStorage();
  const service = new Service(memory.storage);
  const provider = new KRuokaProvider(new KRuokaSite(request, 0).call);
  service.registry.register(provider);
  await service.init();
  service.storeLogins["k-ruoka"] = "signedIn";
  await service.save({
    ...service.state,
    staples: [],
    meals: [],
    context: context(storeId),
    extras: extras as never,
  });
  return { ...memory, service, provider, searches, writes };
}
const row = (service: Service, id: string) =>
  service.basket.find((l) => l.requirement.id === id)!;
const status = (service: Service, id: string) =>
  lineMerchandiseStatus(
    row(service, id),
    service.registry.get(service.state.context.providerId).capabilities
      .merchandise,
  );

test("a large store: the exact variant is chosen for the selected store, with truthful stock and pack", async () => {
  const { service, searches } = await shop(LARGE_STORE, [
    boots("32"),
    pan,
    batteries,
    { id: "milk", name: "Maito", amount: 1000, unit: "ml" },
  ]);
  await service.buildBasket();
  // Boots in size 32: the blue pair, one piece. Not size 31, not the unsized pair, and not the
  // red pair that is out of stock.
  expect(row(service, "kumisaapas")).toMatchObject({
    product: {
      id: "6400000000328",
      name: "Lasten kumisaapas sininen koko 32",
      storeId: LARGE_STORE,
      packAmount: 1,
      unit: "pcs",
      merchandise: { brand: "Synteettinen", inStore: true, online: true },
    },
    packs: 1,
    total: 1990,
  });
  expect(
    Object.fromEntries(
      row(service, "kumisaapas").matching!.decisions.map((d) => [
        d.id,
        `${d.status}:${d.reason}`,
      ]),
    ),
  ).toEqual({
    "6400000000311": "rejected:qualifier-conflict",
    "6400000000328": "eligible:resolved",
    "6400000000335": "approval-required:stock",
    "6400000000342": "rejected:qualifier-unknown",
  });
  expect(status(service, "kumisaapas")).toBe("exact-available");
  // The pan: the cheaper 28 cm one does not say whether it is available, so it is not chosen
  // over the one that does. The 24 cm pan is another product.
  expect(row(service, "paistinpannu")).toMatchObject({
    product: { id: "6400000001004" },
    packs: 1,
    total: 2490,
  });
  // Eight AA batteries are two packs of four. The ten-pack is in the shop but not orderable
  // online and is never chosen for the order; AAA is another product.
  expect(row(service, "alkaliparisto")).toMatchObject({
    product: { id: "6400000002001", packAmount: 4 },
    packs: 2,
    total: 798,
  });
  // The variant is asked for first, within the usual three reads per row.
  expect(searches.slice(0, 3)).toEqual([
    "Kumisaapas 32",
    "Paistinpannu 28 cm",
    "Alkaliparisto AA",
  ]);
  // The grocery row beside them is a grocery row as before: asked by name, with no variant.
  expect(searches).toContain("Maito");
  expect(row(service, "milk").requirement).toEqual({
    id: "milk",
    name: "Maito",
    amount: 1000,
    unit: "ml",
    sources: ["extra"],
  });
  expect(status(service, "milk")).toBeNull();
});

test("each outcome keeps its own statement: missing size, another store, sold out, unknown", async () => {
  // Size 34 is not among the listed sizes.
  const missing = await shop(LARGE_STORE, [boots("34")]);
  await missing.service.buildBasket();
  expect(row(missing.service, "kumisaapas")).toMatchObject({
    product: null,
    total: null,
  });
  expect(status(missing.service, "kumisaapas")).toBe("variant-missing");
  // A small store lists nothing of the kind. That is this store's answer only.
  const small = await shop(SMALL_STORE, [boots("32")]);
  await small.service.buildBasket();
  expect(row(small.service, "kumisaapas").product).toBeNull();
  expect(row(small.service, "kumisaapas").candidates).toEqual([]);
  expect(status(small.service, "kumisaapas")).toBe("not-listed-here");
  expect(small.searches.length).toBeLessThanOrEqual(3);
  // Only the sold-out colour exists in the size.
  const soldOut = await shop(LARGE_STORE, [boots("32")], (query) => ({
    body: response(LARGE_STORE, query, [
      {
        ean: "6400000000335",
        name: "Lasten kumisaapas punainen koko 32",
        available: false,
        availability: { store: false, web: false },
      },
    ]),
  }));
  await soldOut.service.buildBasket();
  expect(row(soldOut.service, "kumisaapas").product).toBeNull();
  expect(status(soldOut.service, "kumisaapas")).toBe("out-of-stock");
  // The store does not say: unknown, and nothing is chosen on a guess.
  const unknown = await shop(LARGE_STORE, [pan], (query) => ({
    body: response(LARGE_STORE, query, [
      {
        ean: "6400000001028",
        name: "Paistinpannu 28 cm",
        price: 17.9,
        available: null,
        availability: null,
      },
    ]),
  }));
  await unknown.service.buildBasket();
  expect(row(unknown.service, "paistinpannu").product).toBeNull();
  expect(status(unknown.service, "paistinpannu")).toBe("unknown");
  // Changing to the small store drops the large store's quote: no product crosses stores.
  const moved = await shop(LARGE_STORE, [boots("32")]);
  await moved.service.buildBasket();
  expect(row(moved.service, "kumisaapas").product?.storeId).toBe(LARGE_STORE);
  await moved.service.save({
    ...moved.service.state,
    context: context(SMALL_STORE),
  });
  expect(moved.service.snapshot().basket).toEqual([]);
  expect(moved.service.quotedAt).toBeNull();
});

test("nothing is asked of the store while a required attribute is missing or the provider cannot search", async () => {
  const unsized = await shop(LARGE_STORE, [boots(null)]);
  await unsized.service.buildBasket();
  expect(unsized.searches).toEqual([]);
  expect(row(unsized.service, "kumisaapas")).toMatchObject({
    product: null,
    candidates: [],
  });
  // A provider that declares no non-food discovery is never searched for such a row.
  const memory = memoryStorage();
  const service = new Service(memory.storage);
  service.developmentMode = true;
  const stand = new DemoProvider("s-kaupat");
  service.registry.register(stand);
  await service.init();
  await service.save({
    ...service.state,
    staples: [],
    meals: [],
    context: (await stand.searchStores())[0],
    extras: [
      boots("32"),
      { id: "milk", name: "Maito", amount: 1000, unit: "ml" },
    ],
  });
  await service.buildBasket();
  expect(row(service, "kumisaapas").product).toBeNull();
  expect(status(service, "kumisaapas")).toBe("unsupported");
  // The grocery row at the same store is priced as always.
  expect(row(service, "milk").product).not.toBeNull();
  expect(stand.searchRequests).toBe(1);
});

test("a store error, a changed response and a product of another store fail the read and choose nothing", async () => {
  for (const answer of [
    () => ({ status: 503 }),
    () => ({ body: { products: [] } }),
    (query: string) => ({
      body: response(LARGE_STORE, query, [
        {
          ean: "6400000000328",
          name: "Lasten kumisaapas sininen koko 32",
          storeId: "N999",
        },
      ]),
    }),
  ]) {
    const { service, searches } = await shop(
      LARGE_STORE,
      [boots("32")],
      answer,
    );
    await expect(service.buildBasket()).rejects.toThrow();
    // A failed read is terminal: no second wording is tried and nothing is quoted.
    expect(searches).toHaveLength(1);
    expect(service.basket).toEqual([]);
    expect(service.quotedAt).toBeNull();
  }
});

test("a priced non-food row is never written to the basket: the write is not verified for this provider", async () => {
  const { service, provider, writes } = await shop(LARGE_STORE, [boots("32")]);
  expect(provider.capabilities.merchandise).toEqual({
    discovery: true,
    variants: "name",
    stock: "flag",
    cartWrite: false,
  });
  await service.buildBasket();
  expect(row(service, "kumisaapas").total).toBe(1990);
  // Only non-food rows on the list: there is nothing that may be sent.
  await expect(service.prepare()).rejects.toThrow("manualOnly");
  const clicked = await service.transferDisplayed({
    revision: service.state.revision,
    quotedAt: service.quotedAt!,
    batchKey: service.snapshot().transferBatchKey,
  });
  expect(clicked.transferException).toBe("manualOnly");
  expect(clicked.journal ?? null).toBeNull();
  expect(writes).toEqual([]);
});
