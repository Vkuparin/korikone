import { test, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SKaupatLibrary } from "../src/stores/s-kaupat-library";
import { SKaupatProvider } from "../src/stores/s-kaupat";
import { match } from "../src/domain/planner";
import { createReview, transfer } from "../src/application/transfer";

test("the released shared client prices, writes and verifies a fixture list with prohibited tools refused", async () => {
  const client = new SKaupatLibrary({
    dataDir: await mkdtemp(join(tmpdir(), "korikone-library-")),
    demo: true,
  });
  try {
    for (const name of [
      "place_order",
      "get_delivery_slots",
      "delete_shopping_list",
      "clear_cart",
    ])
      await expect(client.call(name, {})).rejects.toThrow("unsupported");
    const provider = new SKaupatProvider((name, args) =>
      client.call(name, args),
    );
    const context = (await provider.searchStores("Helsinki"))[0];
    expect(context).toBeDefined();
    await provider.selectStore(context);
    await client.call("start_login", {});
    const products = await provider.searchProducts(context, "maito", "milk");
    expect(products.length).toBeGreaterThan(0);
    const suitable = products.find(
      (product) =>
        product.available && product.price !== null && product.packAmount > 0,
    )!;
    expect(suitable).toBeDefined();
    const line = match(
      {
        id: "milk",
        name: "Maito",
        amount: suitable.packAmount,
        unit: suitable.unit,
        sources: [],
      },
      products,
      [suitable.id],
      [],
    );
    const review = await createReview(provider, context, 0, [line]);
    const journal = await transfer(
      provider,
      { review, status: "ready", verified: [], uncertain: null, error: null },
      () => {},
    );
    expect(journal.status).toBe("verified");
    expect((await provider.getCart(context)).lines).toContainEqual(
      expect.objectContaining({ productId: suitable.id, quantity: 1 }),
    );
  } finally {
    await client.close();
  }
});
