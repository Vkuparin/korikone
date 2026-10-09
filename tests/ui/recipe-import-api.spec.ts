import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("recipe import API validates fixture responses without saving a recipe", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(
    join(tmpdir(), "korikone-recipe-api-"),
  );
  env.KORIKONE_TEST_HIDDEN = "1";
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Aloita tyhjästä viikosta" })
      .click();
    const before = await page.evaluate(async () => {
      const signedIn = await window.korikone.signInAI();
      if (!signedIn.ok) throw new Error(signedIn.error);
      return signedIn.value.state;
    });
    const request = {
      text: "Nakkikeitto: 4 annosta, 800 g perunaa, 400 g porkkanaa, 400 g nakkeja.",
      consent: true,
    };
    for (const [scenario, count, error] of [
      ["success", 1, null],
      ["invalidOnce", 2, null],
      ["invalidDraft", 2, "invalidDraft"],
      ["usageLimit", 1, "usageLimit"],
    ] as const) {
      await page.evaluate(
        (scenario) => window.korikone.developmentScenario(scenario),
        scenario,
      );
      const result = await page.evaluate(
        (request) => window.korikone.importRecipe(request),
        request,
      );
      expect(result.ok).toBe(error === null);
      if (error) expect(result.error).toBe(error);
      const current = (await page.evaluate(() => window.korikone.load())).value;
      expect(current.state).toEqual(before);
      expect(current.developmentRequests).toBe(count);
      if (error) expect(current.recipeDraft).toBeNull();
      else {
        expect(current.recipeDraft?.name).toBe("Nakkikeitto");
        expect(current.recipeDraft?.ingredients[0]).toMatchObject({
          id: "potato",
          amount: 800,
          unit: "g",
        });
      }
    }
    await page.evaluate(() => window.korikone.developmentScenario("success"));
    for (const invalid of [
      { text: "", consent: true },
      { text: "   ", consent: true },
      { text: "x".repeat(10001), consent: true },
      { text: "Nakkikeitto", consent: false },
    ]) {
      const result = await page.evaluate(
        (request) => window.korikone.importRecipe(request),
        invalid,
      );
      expect(result.ok).toBe(false);
    }
    expect(
      (await page.evaluate(() => window.korikone.load())).value
        .developmentRequests,
    ).toBe(0);
    await page.evaluate(() =>
      window.korikone.developmentScenario("delayedSuccess"),
    );
    const pending = page.evaluate(
      (request) => window.korikone.importRecipe(request),
      request,
    );
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.korikone.load())).value
            .developmentRequests,
      )
      .toBe(1);
    await page.evaluate(() => window.korikone.cancelAI());
    expect(await pending).toMatchObject({ ok: false, error: "aiCancelled" });
    expect(
      (await page.evaluate(() => window.korikone.load())).value.recipeDraft,
    ).toBeNull();
    await page.evaluate(() => window.korikone.developmentScenario("success"));
    const imported = await page.evaluate(
      (request) => window.korikone.importRecipe(request),
      request,
    );
    expect(imported.value.recipeDraft?.name).toBe("Nakkikeitto");
    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    const restarted = (await page.evaluate(() => window.korikone.load())).value;
    expect(restarted.state).toEqual(before);
    expect(restarted.recipeDraft).toBeNull();
  } finally {
    await app.close();
  }
});
