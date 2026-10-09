import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("confirmed context IPC preserves notes, reprices, rejects failures and persists across restart", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(
    join(tmpdir(), "korikone-context-api-"),
  );
  env.KORIKONE_TEST_HIDDEN = "1";
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
      .click();
    const note = page.getByLabel("Mitä haluaisit valmistaa?");
    await note.fill("Do not interpret this edited note");
    const result = await page.evaluate(async () => {
      const api = window.korikone;
      const must = (result: Awaited<ReturnType<typeof api.load>>) => {
        if (!result.ok) throw new Error(result.error);
        return result.value;
      };
      const initial = must(await api.load());
      const options = must(await api.getContextOptions());
      if (
        options.developmentCatalogueRequests !==
        initial.developmentCatalogueRequests
      )
        throw new Error("Options fetched catalogue");
      const search = must(await api.searchStores("alternate"));
      const k = search.storeResults.find(
        (context) => context.providerId === "k-ruoka",
      )!;
      const s = search.storeResults.find(
        (context) => context.providerId === "s-kaupat",
      )!;
      const changed = must(
        await api.changeContext({
          context: k,
          revision: search.state.revision,
        }),
      );
      const regular = must(await api.searchStores("Helsinki"));
      const kRegular = regular.storeResults.find(
        (context) => context.providerId === "k-ruoka",
      )!;
      const withinChain = must(
        await api.changeContext({
          context: kRegular,
          revision: regular.state.revision,
        }),
      );
      const remembered = must(
        await api.save({
          ...withinChain.state,
          stores: { ...withinChain.state.stores, "s-kaupat": s },
        }),
      );
      const switched = must(
        await api.changeContext({
          context: remembered.state.stores["s-kaupat"],
          revision: remembered.state.revision,
        }),
      );
      const delivery = must(
        await api.changeContext({
          context: { ...switched.state.context, fulfillment: "delivery" },
          revision: switched.state.revision,
        }),
      );
      const pickup = must(
        await api.changeContext({
          context: { ...delivery.state.context, fulfillment: "pickup" },
          revision: delivery.state.revision,
        }),
      );
      const pickupSearch = must(await api.searchStores("pickup-only"));
      const pickupOnly = pickupSearch.storeResults.find(
        (context) => context.providerId === "s-kaupat",
      )!;
      const unavailable = await api.changeContext({
        context: { ...pickupOnly, fulfillment: "delivery" },
        revision: pickup.state.revision,
      });
      must(await api.scenario("context"));
      const adapterFailure = await api.changeContext({
        context: { ...pickup.state.context, fulfillment: "delivery" },
        revision: pickup.state.revision,
      });
      must(await api.scenario("context"));
      must(await api.scenario("catalogue"));
      const catalogueFailure = await api.changeContext({
        context: pickupOnly,
        revision: pickup.state.revision,
      });
      must(await api.scenario("catalogue"));
      const unchanged = must(await api.load());
      const final = must(
        await api.changeContext({
          context: pickupOnly,
          revision: pickup.state.revision,
        }),
      );
      return {
        initial,
        changed,
        withinChain,
        switched,
        delivery,
        pickup,
        unavailable,
        adapterFailure,
        catalogueFailure,
        unchanged,
        final,
      };
    });
    expect(result.changed.state.context.storeId).toBe("demo-alternate");
    expect(result.withinChain.state.context.storeId).toBe("demo-helsinki");
    expect(result.switched.state.stores["k-ruoka"]).toEqual(
      result.withinChain.state.context,
    );
    expect(result.switched.pickupFee).toEqual({ min: 390, max: 590 });
    expect(result.delivery.pickupFee).toBeNull();
    expect(result.pickup.pickupFee).toEqual({ min: 390, max: 590 });
    expect(result.unavailable).toMatchObject({
      ok: false,
      error: "fulfillmentUnavailable",
    });
    expect(result.adapterFailure).toMatchObject({
      ok: false,
      error: "storeBusy",
    });
    expect(result.catalogueFailure).toMatchObject({
      ok: false,
      error: "storeBusy",
    });
    expect(result.unchanged.state).toEqual(result.pickup.state);
    expect(result.unchanged.basket).toEqual(result.pickup.basket);
    expect(result.final.state.note).toBe(result.initial.state.note);
    expect(result.final.state.meals).toEqual(result.initial.state.meals);
    expect(result.final.developmentRequests).toBe(0);
    expect(result.final.journal).toBeNull();
    await expect(note).toHaveValue("Do not interpret this edited note");
    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    await expect(page.getByLabel("Mitä haluaisit valmistaa?")).toHaveValue(
      result.final.state.note,
    );
    const restored = await page.evaluate(
      async () => (await window.korikone.load()).value,
    );
    expect(restored.state.context).toEqual(result.final.state.context);
    expect(restored.basket).toEqual(result.final.basket);
    expect(restored.developmentCatalogueRequests).toBe(0);
    expect(restored.developmentRequests).toBe(0);
  } finally {
    await app.close();
  }
});
