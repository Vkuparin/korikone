import { composer, startNewList } from "./composer-helper";
import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";

test("closing a fully resolved review returns focus to the saved list heading", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  env.KORIKONE_TEST_DATA = await mkdtemp(
    join(tmpdir(), "korikone-review-focus-"),
  );
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    const state = initialState();
    state.onboarded = state.setupComplete = true;
    state.meals = [];
    state.staples = [];
    state.extras = [{ id: "cream", name: "Kerma", amount: 200, unit: "ml" }];
    await page.evaluate(async (state) => {
      await window.korikone.save(state);
      await window.korikone.setLanguage("en");
      await window.korikone.buildBasket();
    }, state);
    await page.reload();
    const entry = page.getByRole("button", { name: /^Review unresolved rows/ });
    await entry.click();
    const review = page.getByRole("region", {
      name: "Review product choices",
      exact: true,
    });
    await review
      .getByRole("button", { name: "Use once: Ruokakerma 2 dl", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.korikone.load())).value.basket[0]
            ?.product?.id,
      )
      .toBe("cream");
    await expect(entry).toContainText("0");
    await review
      .getByRole("button", { name: "Close review", exact: true })
      .click();
    await expect(entry).toHaveCount(0);
    await expect(
      page.getByRole("complementary").getByRole("heading", { level: 2 }),
    ).toBeFocused();
    const snapshot = (await page.evaluate(() => window.korikone.load())).value;
    expect(snapshot.state.categoryPreferences).toEqual([]);
    expect(snapshot.developmentRequests).toBe(0);
    expect(snapshot.developmentStoreWrites).toBe(0);
  } finally {
    await app.close();
  }
});

for (const language of ["fi", "en"] as const) {
  test(`optional grouped review keeps dismissal, once, memory and unresolved transfer distinct in ${language}`, async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.KORIKONE_TEST_DATA = await mkdtemp(
      join(tmpdir(), "korikone-grouped-review-"),
    );
    env.KORIKONE_TEST_HIDDEN = "1";
    const app = await electron.launch({ args: ["."], env });
    try {
      const page = await app.firstWindow();
      const state = initialState();
      state.onboarded = state.setupComplete = true;
      state.meals = [];
      state.staples = [];
      state.extras = [
        { id: "cream", name: "Kerma", amount: 200, unit: "ml" },
        { id: "onion", name: "Sipuli", amount: 500, unit: "g" },
        { id: "coffee", name: "Kahvi", amount: 500, unit: "g" },
        {
          id: "missing-fixture",
          name: "Tuntematon testiruoka",
          amount: 1,
          unit: "pcs",
        },
      ];
      await page.evaluate(
        async ({ state, language }) => {
          await window.korikone.save(state);
          await window.korikone.setLanguage(language);
          await window.korikone.buildBasket();
        },
        { state, language },
      );
      await page.reload();
      await page.setViewportSize({ width: 800, height: 600 });
      const fi = language === "fi";
      const load = () =>
        page.evaluate(async () => (await window.korikone.load()).value);
      const review = page.getByRole("region", {
        name: fi ? "Tarkista tuotevalinnat" : "Review product choices",
        exact: true,
      });
      const entry = page.getByRole("button", {
        name: /^(Tarkista ratkaisemattomat rivit|Review unresolved rows)/,
      });
      await expect(review).toHaveCount(0);
      await startNewList(page);
      await composer(page).fill("A new note that is not applied");
      await expect(review).toHaveCount(0);
      const before = await load();
      expect(
        before.basket.find((line) => line.requirement.id === "coffee")?.product
          ?.id,
      ).toBe("coffee");
      await entry.focus();
      await entry.press("Enter");
      await expect(review.getByRole("heading", { level: 2 })).toBeFocused();
      await expect(review.locator(".review-category")).toHaveCount(3);
      await expect(review.locator(".candidate-reason")).toHaveCount(3);
      expect(
        await review.locator(".candidate").evaluateAll((candidates) =>
          candidates.every((candidate) => {
            const reason = candidate
              .querySelector(".candidate-reason")
              ?.getBoundingClientRect();
            const pack = candidate
              .querySelector("small:not(.candidate-reason)")
              ?.getBoundingClientRect();
            return (
              !reason ||
              !pack ||
              reason.top >= pack.bottom - 1 ||
              reason.bottom <= pack.top + 1
            );
          }),
        ),
      ).toBe(true);
      const missing = review.getByRole("region", {
        name: `${fi ? "Tarkista" : "Review"}: Tuntematon testiruoka`,
        exact: true,
      });
      await missing
        .getByRole("button", {
          name: fi ? "Jätä ratkaisematta" : "Leave unresolved",
          exact: true,
        })
        .click();
      await expect(missing).toContainText(
        fi ? "Jätetty ratkaisematta" : "Left unresolved",
      );
      expect((await load()).state).toEqual(before.state);
      await review.press("Escape");
      await expect(review).toHaveCount(0);
      await expect(entry).toBeFocused();
      const dismissed = await load();
      expect(dismissed.basket).toEqual(before.basket);
      expect(dismissed.state).toEqual(before.state);
      expect(dismissed.developmentCatalogueRequests).toBe(
        before.developmentCatalogueRequests,
      );
      await entry.press("Enter");
      const cream = review.getByRole("region", {
        name: `${fi ? "Tarkista" : "Review"}: Kerma`,
        exact: true,
      });
      await cream
        .getByRole("button", {
          name: /^(Muista tyyppi|Remember type): Ruokakerma 2 dl$/,
        })
        .click();
      await cream.locator(".row-memory").press("Escape");
      await expect(review).toBeVisible();
      expect((await load()).state.categoryPreferences).toEqual([]);
      await cream
        .getByRole("button", {
          name: /^(Muista tyyppi|Remember type): Ruokakerma 2 dl$/,
        })
        .click();
      await cream
        .getByLabel(fi ? "Valinnan merkitys" : "Meaning of the choice")
        .selectOption("required");
      await cream
        .locator(".row-memory")
        .getByRole("button", {
          name: fi ? "Muista tyyppi" : "Remember type",
          exact: true,
        })
        .click();
      await expect
        .poll(async () => (await load()).state.categoryPreferences.length)
        .toBe(1);
      await expect(cream).toContainText(
        fi
          ? "Tuote valittu nykyiseen listaan"
          : "Product chosen for the current list",
      );
      const onion = review.getByRole("region", {
        name: `${fi ? "Tarkista" : "Review"}: Sipuli`,
        exact: true,
      });
      await onion
        .getByRole("button", {
          name: /^(Käytä kerran|Use once): Kotimaista sipuli 500 g$/,
        })
        .click();
      await expect(onion.getByRole("heading", { level: 4 })).toBeFocused();
      const approved = await load();
      expect(approved.state.categoryPreferences).toHaveLength(1);
      expect(approved.state.categoryPreferences[0].category).toBe("cream");
      expect(
        approved.basket.find((line) => line.requirement.id === "onion")?.product
          ?.id,
      ).toBe("onion");
      const coffeeBefore = before.basket.find(
        (line) => line.requirement.id === "coffee",
      )!;
      expect(
        approved.basket.find((line) => line.requirement.id === "coffee"),
      ).toMatchObject({
        requirement: coffeeBefore.requirement,
        packs: coffeeBefore.packs,
        total: coffeeBefore.total,
        matching: coffeeBefore.matching,
        product: {
          id: coffeeBefore.product!.id,
          price: coffeeBefore.product!.price,
          packAmount: coffeeBefore.product!.packAmount,
          unit: coffeeBefore.product!.unit,
        },
      });
      await missing
        .getByRole("button", {
          name: fi ? "Jätä ratkaisematta" : "Leave unresolved",
          exact: true,
        })
        .click();

      await review.screenshot({
        path: `test-results/grouped-panel-${language}.png`,
      });
      await page.screenshot({
        path: `test-results/grouped-review-${language}.png`,
        fullPage: true,
      });
      await review
        .getByRole("button", {
          name: fi ? "Sulje tarkistus" : "Close review",
          exact: true,
        })
        .click();
      await expect(entry).toBeFocused();
      await expect(entry).toContainText("1");
      await page.locator(".transfer-button").click();
      const transfer = page.getByRole("region", {
        name: fi ? "Siirron vahvistus" : "Transfer confirmation",
        exact: true,
      });
      await expect(transfer).toContainText("Tuntematon testiruoka");
      const awaitingTransfer = await load();
      expect(awaitingTransfer.transferException).toBe("acknowledgeReview");
      expect(awaitingTransfer.review?.targets).toHaveLength(3);
      expect(awaitingTransfer.developmentRequests).toBe(0);
      expect(awaitingTransfer.developmentStoreWrites).toBe(0);
    } finally {
      await app.close();
    }
  });
}
