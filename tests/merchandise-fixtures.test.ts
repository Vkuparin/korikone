import { expect, test } from "vitest";
import { Service } from "../src/application/service";
import type { MerchandiseIntent } from "../src/domain/merchandise";
import { DemoProvider } from "../src/stores/demo";
import { memoryStorage } from "./helpers/purchase-fixtures";

const intent = (
  family: string,
  attributes: MerchandiseIntent["attributes"],
  missing: MerchandiseIntent["missing"] = [],
): MerchandiseIntent => ({ version: 1, family, attributes, missing });
const attr = (
  kind: MerchandiseIntent["attributes"][number]["kind"],
  value: string,
) => ({ kind, value, provenance: "explicit-note" as const });
const row = (
  id: string,
  name: string,
  merchandise: MerchandiseIntent,
  amount = 1,
) => ({ id, name, amount, unit: "pcs" as const, merchandise });
const milk = { id: "milk", name: "Maito", amount: 2000, unit: "ml" as const };

/** A real Service over the K development stand-in with its synthetic non-food shelf. */
async function shop(extras: object[], storeId?: string) {
  const memory = memoryStorage();
  const service = new Service(memory.storage);
  service.developmentMode = true;
  await service.init();
  const provider = service.registry.get("demo-k") as DemoProvider;
  const [store] = await provider.searchStores(
    storeId === "demo-alternate" ? "alternate" : "",
  );
  await service.save({
    ...service.state,
    staples: [],
    meals: [],
    context: { ...store, providerId: "demo-k" },
    extras: extras as never,
  });
  await service.buildBasket();
  return { ...memory, service, provider };
}
const status = (service: Service, key: string) =>
  service.snapshot().merchandise.statuses.find((s) => s.requirementKey === key)
    ?.status;
const chosen = (service: Service, id: string) =>
  service.basket.find((l) => l.requirement.id === id)?.product?.id ?? null;

test("a store without the shelf says not listed here, never a missing variant", async () => {
  const { service } = await shop(
    [
      milk,
      row("boots", "Kumisaapas", intent("kumisaapas", [attr("size", "32")])),
    ],
    "demo-alternate",
  );
  expect(status(service, "boots:pcs")).toBe("not-listed-here");
  expect(chosen(service, "boots")).toBeNull();
  expect(service.snapshot().merchandise.manual).toEqual([]);
  // Groceries are priced as before.
  expect(chosen(service, "milk")).not.toBeNull();
});

test("the exact size is chosen with the store's evidence and handed over by hand; partial sizes are not guessed", async () => {
  const exact = await shop([
    milk,
    row("boots", "Kumisaapas", intent("kumisaapas", [attr("size", "32")])),
  ]);
  expect(status(exact.service, "boots:pcs")).toBe("exact-available");
  expect(chosen(exact.service, "boots")).toBe("boots-32");
  expect(
    exact.service.basket.find((l) => l.requirement.id === "boots")?.product
      ?.merchandise,
  ).toEqual({ brand: "Nokian", inStore: true, online: true });
  expect(exact.service.snapshot().merchandise.manual).toMatchObject([
    { requirementKey: "boots:pcs", productId: "boots-32", packs: 1 },
  ]);
  // A size the shelf does not have is a missing variant, not the nearest size.
  const other = await shop([
    row("boots", "Kumisaapas", intent("kumisaapas", [attr("size", "36")])),
  ]);
  expect(status(other.service, "boots:pcs")).toBe("variant-missing");
  expect(chosen(other.service, "boots")).toBeNull();
  // A listed size the store reports sold out is out of stock and not chosen.
  const sold = await shop([
    row("boots", "Kumisaapas", intent("kumisaapas", [attr("size", "30")])),
  ]);
  expect(status(sold.service, "boots:pcs")).toBe("out-of-stock");
  expect(chosen(sold.service, "boots")).toBeNull();
});

test("unknown stock is never read as available, and a spec mismatch is not the requested variant", async () => {
  const pan = await shop([
    row("pan", "Paistinpannu", intent("paistinpannu", [attr("spec", "28 cm")])),
  ]);
  expect(status(pan.service, "pan:pcs")).toBe("unknown");
  expect(chosen(pan.service, "pan")).toBeNull();
  const batteries = await shop([
    row("aa", "Alkaliparisto", intent("paristo", [attr("model", "AA")])),
    row("aaa", "Alkaliparisto", intent("paristo", [attr("model", "AAA")])),
  ]);
  expect(chosen(batteries.service, "aa")).toBe("battery-aa");
  expect(chosen(batteries.service, "aaa")).toBe("battery-aaa");
  // AA never stands in for AAA or the reverse.
  const wrong = await shop([
    row("aa", "Alkaliparisto", intent("paristo", [attr("model", "C")])),
  ]);
  expect(chosen(wrong.service, "aa")).toBeNull();
});

test("an edited quantity, a changed store and a failed search keep groceries compatible with zero non-food writes", async () => {
  const { service, provider } = await shop([
    milk,
    row("boots", "Kumisaapas", intent("kumisaapas", [attr("size", "32")]), 2),
  ]);
  // Two pairs: two packs, and the hand-off says so.
  expect(service.snapshot().merchandise.manual).toMatchObject([
    { productId: "boots-32", packs: 2 },
  ]);
  // Sending writes the grocery only.
  const written: string[] = [];
  const original = provider.setQuantity.bind(provider);
  provider.setQuantity = async (context, target) => {
    written.push(target.productId);
    return original(context, target);
  };
  await service.transferDisplayed({
    revision: service.state.revision,
    quotedAt: service.quotedAt!,
    batchKey: service.snapshot().transferBatchKey,
  });
  expect(written).toEqual(["milk"]);
  // A failed read leaves the saved quote alone; a retry succeeds.
  const quoted = service.quotedAt;
  provider.failSearch = true;
  await expect(service.buildBasket()).rejects.toThrow();
  expect(service.quotedAt).toBe(quoted);
  provider.failSearch = false;
  await service.buildBasket();
  expect(status(service, "boots:pcs")).toBe("exact-available");
  // The backup keeps the non-food intent and its attribute.
  const backup = await service.exportBackup();
  expect(
    backup.extras.find((e: { id: string }) => e.id === "boots")?.merchandise
      ?.attributes,
  ).toEqual([attr("size", "32")]);
});
