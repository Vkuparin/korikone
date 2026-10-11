import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";

for (const language of ["fi", "en"] as const) {
  test(`inline type, alternative and quantity corrections keep consent and unrelated rows intact in ${language}`, async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.KORIKONE_TEST_DATA = await mkdtemp(
      join(tmpdir(), "korikone-row-corrections-"),
    );
    env.KORIKONE_TEST_HIDDEN = "1";
    let app = await electron.launch({ args: ["."], env });
    try {
      let page = await app.firstWindow();
      const state = initialState();
      state.onboarded = state.setupComplete = true;
      state.staples = [];
      state.meals = [];
      state.extras = [
        { id: "mince", name: "Jauheliha", amount: 400, unit: "g" },
        { id: "milk", name: "Maito", amount: 1000, unit: "ml" },
        { id: "pasta", name: "Makaroni", amount: 400, unit: "g" },
      ];
      await page.evaluate(
        async ({ state, language }) => {
          await window.korikone.save(state);
          await window.korikone.setLanguage(language);
          await window.korikone.buildBasket();
          const review = await window.korikone.prepare();
          if (!review.ok) throw new Error(review.error);
        },
        { state, language },
      );
      await page.reload();
      await page.setViewportSize({ width: 800, height: 600 });
      const fi = language === "fi";
      const load = () =>
        page.evaluate(async () => (await window.korikone.load()).value);
      const opener = (name: string) =>
        page.getByRole("button", {
          name: `${fi ? "Tarkoitin jotain muuta" : "I meant something else"}: ${name}`,
          exact: true,
        });
      const form = (name: string) =>
        page.getByRole("form", {
          name: `${fi ? "Korjaa rivi" : "Correct row"}: ${name}`,
          exact: true,
        });
      const save = (name: string) =>
        form(name).getByRole("button", {
          name: fi ? "Tallenna korjaus" : "Save correction",
          exact: true,
        });
      const reason = (name: string) =>
        form(name).getByRole("combobox", {
          name: fi ? "Mikä meni väärin?" : "What was wrong?",
          exact: true,
        });
      const replacement = (name: string) =>
        form(name).getByRole("combobox", {
          name: fi ? "Korvaava tuote" : "Replacement product",
          exact: true,
        });
      const before = await load();
      expect(
        before.basket.find((line) => line.requirement.id === "mince")?.product
          ?.id,
      ).toBe("mince");
      await opener("Jauheliha").focus();
      await opener("Jauheliha").press("Enter");
      await expect(reason("Jauheliha")).toBeFocused();
      await reason("Jauheliha").selectOption("wrong-product-type");
      await replacement("Jauheliha").selectOption("product:mince-chicken");
      await form("Jauheliha").press("Escape");
      await expect(opener("Jauheliha")).toBeFocused();
      expect((await load()).state).toEqual(before.state);
      expect((await load()).basket).toEqual(before.basket);
      await opener("Jauheliha").press("Enter");
      await reason("Jauheliha").selectOption("wrong-product-type");
      await replacement("Jauheliha").selectOption("product:mince-chicken");
      await expect(form("Jauheliha").getByRole("checkbox")).not.toBeChecked();
      await save("Jauheliha").click();
      await expect
        .poll(
          async () =>
            (await load()).basket.find(
              (line) => line.requirement.id === "mince",
            )?.product?.id,
        )
        .toBe("mince-chicken");
      const once = await load();
      expect(once.review).toBeNull();
      expect(once.state.categoryPreferences).toEqual([]);
      expect(once.quotedAt).toBe(before.quotedAt);
      expect(
        once.basket.find((line) => line.requirement.id === "pasta"),
      ).toEqual(before.basket.find((line) => line.requirement.id === "pasta"));
      expect(
        once.basket.find((line) => line.requirement.id === "milk"),
      ).toEqual(before.basket.find((line) => line.requirement.id === "milk"));
      await expect(opener("Jauheliha")).toBeFocused();
      await opener("Jauheliha").press("Enter");
      await reason("Jauheliha").selectOption("unsuitable-alternative");
      await replacement("Jauheliha").selectOption("unresolved");
      await expect(form("Jauheliha").getByRole("checkbox")).toHaveCount(0);
      await save("Jauheliha").click();
      await expect
        .poll(
          async () =>
            (await load()).basket.find(
              (line) => line.requirement.id === "mince",
            )?.matching?.reason,
        )
        .toBe("owner-correction");
      expect(
        (await load()).basket.find((line) => line.requirement.id === "mince")
          ?.product,
      ).toBeNull();
      await opener("Maito").click();
      await reason("Maito").selectOption("wrong-quantity");
      const amount = form("Maito").getByLabel(
        fi ? "Tarvittava määrä (ml)" : "Required amount (ml)",
        { exact: true },
      );
      await amount.fill("0");
      await expect(save("Maito")).toBeDisabled();
      await amount.fill("2.5");
      await expect(save("Maito")).toBeDisabled();
      await amount.fill("2300");
      await save("Maito").click();
      await expect
        .poll(
          async () =>
            (await load()).basket.find((line) => line.requirement.id === "milk")
              ?.requirement.amount,
        )
        .toBe(2300);
      const quantified = await load();
      expect(
        quantified.basket.find((line) => line.requirement.id === "milk"),
      ).toMatchObject({ packs: 3, total: 357 });
      expect(
        quantified.basket.find((line) => line.requirement.id === "pasta"),
      ).toEqual(before.basket.find((line) => line.requirement.id === "pasta"));
      await opener("Jauheliha").click();
      await reason("Jauheliha").selectOption("wrong-product-type");
      await replacement("Jauheliha").selectOption("product:mince-chicken");
      await form("Jauheliha")
        .getByRole("checkbox", {
          name: fi
            ? "Muista tämä tuotetyyppi tuleville listoille"
            : "Remember this product type for future lists",
          exact: true,
        })
        .check();
      await form("Jauheliha")
        .getByRole("combobox", {
          name: fi ? "Valinnan merkitys" : "Meaning of the choice",
          exact: true,
        })
        .selectOption("required");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        await form("Jauheliha").evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return [...element.querySelectorAll("select")].every(
            (select) =>
              select.getBoundingClientRect().right <= bounds.right + 1,
          );
        }),
      ).toBe(true);
      await form("Jauheliha").screenshot({
        path: `test-results/row-correction-${language}.png`,
      });
      await save("Jauheliha").click();
      await expect
        .poll(async () => (await load()).state.categoryPreferences.length)
        .toBe(1);
      const remembered = await load();
      expect(remembered.state.categoryPreferences).toEqual([
        {
          category: "mince",
          qualifiers: [{ kind: "meat", value: "chicken" }],
          strength: "required",
        },
      ]);
      expect(
        remembered.basket.find((line) => line.requirement.id === "mince")
          ?.product?.id,
      ).toBe("mince-chicken");
      expect(remembered.quotedAt).toBe(before.quotedAt);
      expect(remembered.developmentCatalogueRequests).toBe(
        before.developmentCatalogueRequests,
      );
      expect(remembered.developmentRequests).toBe(0);
      expect(remembered.developmentStoreWrites).toBe(0);
      await opener("Maito").click();
      await reason("Maito").selectOption("wrong-quantity");
      await form("Maito")
        .getByLabel(fi ? "Tarvittava määrä (ml)" : "Required amount (ml)", {
          exact: true,
        })
        .fill("2400");
      await page.evaluate(async () => {
        const current = (await window.korikone.load()).value;
        await window.korikone.save({
          ...current.state,
          household: { ...current.state.household, budget: 123 },
        });
      });
      const staleBaseline = await load();
      await save("Maito").click();
      await expect(form("Maito")).toContainText(
        fi ? "Lista muuttui" : "The list changed",
      );
      await expect(save("Maito")).toBeDisabled();
      expect((await load()).state).toEqual(staleBaseline.state);
      expect((await load()).developmentCatalogueRequests).toBe(
        staleBaseline.developmentCatalogueRequests,
      );
      await form("Maito")
        .getByRole("button", { name: fi ? "Peruuta" : "Cancel", exact: true })
        .click();
      await app.close();
      app = await electron.launch({ args: ["."], env });
      page = await app.firstWindow();
      const restarted = await load();
      expect(restarted.state.categoryPreferences).toEqual(
        remembered.state.categoryPreferences,
      );
      expect(
        restarted.basket.find((line) => line.requirement.id === "milk")
          ?.requirement.amount,
      ).toBe(2300);
      expect(
        restarted.basket.find((line) => line.requirement.id === "mince")
          ?.product?.id,
      ).toBe("mince-chicken");
      expect(restarted.developmentCatalogueRequests).toBe(0);
      expect(restarted.developmentStoreWrites).toBe(0);
    } finally {
      await app.close();
    }
  });
}
