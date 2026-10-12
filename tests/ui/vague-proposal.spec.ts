import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composer, updateName } from "./composer-helper";

test("a dish typed alone becomes a priced proposal with its side through the real composer", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(join(tmpdir(), "korikone-vague-"));
  env.KORIKONE_TEST_HIDDEN = "1";
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Aloita tyhjästä viikosta" })
      .click();
    await page.evaluate(async () => {
      const signedIn = await window.korikone.signInAI();
      if (!signedIn.ok) throw new Error(signedIn.error);
    });
    await page.reload();
    const load = async () =>
      (await page.evaluate(() => window.korikone.load())).value;
    // Typing alone sends nothing.
    await composer(page).fill("Uunimakkaraa, maitoa");
    expect((await load()).developmentRequests).toBe(0);
    await page.getByRole("button", { name: updateName }).click();
    await expect
      .poll(async () => (await load()).state.meals.length, { timeout: 20000 })
      .toBe(1);
    const planned = await load();
    expect(planned.proposal.sides).toMatchObject([
      { dish: "Uunimakkara", side: "Perunamuusi" },
    ]);
    expect(planned.proposal.quantities).toMatchObject([
      { label: "maitoa", amount: 1000, unit: "ml" },
    ]);
    const rows = Object.fromEntries(
      planned.basket.map((l) => [l.requirement.name, l.product?.name ?? null]),
    );
    expect(rows).toEqual({
      Uunimakkara: "HK Kabanossi uunimakkara 600 g",
      Juustoraaste: "Juustoraaste 150 g",
      Peruna: "Peruna 1 kg",
      Maito: "Maito 1 l",
      Voi: "Voi 500 g",
    });
    // The dish's own milk and the requested carton are separate rows: one inferred, one asked for.
    expect(
      planned.basket
        .filter((l) => l.requirement.name === "Maito")
        .map((l) => l.requirement.amount)
        .sort((x, y) => x - y),
    ).toEqual([200, 1000]);
    expect(planned.developmentRequests).toBe(1);
    expect(planned.developmentStoreWrites).toBe(0);
    // The proposal and its assumptions are the saved list after a restart.
    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    const restarted = (await page.evaluate(() => window.korikone.load())).value;
    expect(restarted.proposal).toEqual(planned.proposal);
    expect(restarted.basket.map((l) => l.product?.id)).toEqual(
      planned.basket.map((l) => l.product?.id),
    );
    expect(restarted.developmentCatalogueRequests).toBe(0);
  } finally {
    await app.close();
  }
});
