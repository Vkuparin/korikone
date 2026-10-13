import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { settingsCategory } from "./settings-helper";

async function launch(dir?: string) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  const data = dir ?? (await mkdtemp(join(tmpdir(), "korikone-basis-")));
  env.KORIKONE_TEST_DATA = data;
  env.KORIKONE_TEST_HIDDEN = "1";
  const app = await electron.launch({ args: ["."], env });
  return { app, data, page: await app.firstWindow() };
}

for (const language of ["fi", "en"] as const) {
  const fi = language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);

  test(`the shared price basis switches initial and alternative choices, keeps manual choices and persists in ${language}`, async () => {
    const { app, data, page } = await launch();
    let current = app;
    let view = page;
    try {
      await view
        .getByRole("button", { name: "Aloita tyhjästä viikosta" })
        .click();
      await view.evaluate(async (language) => {
        const api = window.korikone;
        await api.setLanguage(language);
        let saved = { ok: false, error: "draftStale" } as Awaited<
          ReturnType<typeof api.save>
        >;
        for (let i = 0; i < 20 && !saved.ok; i++) {
          const state = (await api.load()).value.state;
          saved = await api.save({
            ...state,
            staples: [],
            meals: [],
            extras: [
              { id: "flour", name: "Vehnäjauho", amount: 1000, unit: "g" },
            ],
          });
        }
        if (!saved.ok) throw new Error(saved.error);
        await api.buildBasket();
      }, language);
      await view.reload();
      const load = async () =>
        (await view.evaluate(() => window.korikone.load())).value;
      const chosen = async () =>
        (await load()).basket.find((l) => l.requirement.id === "flour")?.product
          ?.name;

      // Default is the lowest unit price: the 2 kg pack costs more now and less per kilo.
      const first = await load();
      expect(first.state.priceBasis).toBe("unit");
      expect(await chosen()).toBe("Vehnäjauho 2 kg");
      const row = view.locator('[data-row-key="flour:g"]');
      await expect(row).toBeVisible();
      await expect(
        row.getByRole("button", {
          name: new RegExp(tr("Edullisempi", "Cheaper|Lower")),
        }),
      ).toHaveCount(0);

      // Switching the setting alone changes nothing saved and makes no request.
      await view
        .getByRole("button", { name: tr("Asetukset", "Settings"), exact: true })
        .click();
      await settingsCategory(view, "stores", tr("Kaupat", "Stores"));
      const select = view.getByLabel(tr("Hintaperuste", "Price basis"));
      await expect(select).toHaveValue("unit");
      await select.selectOption("total");
      await expect
        .poll(async () => (await load()).state.priceBasis)
        .toBe("total");
      const switched = await load();
      expect(switched.state.revision).toBe(first.state.revision);
      expect(switched.quotedAt).toBe(first.quotedAt);
      expect(await chosen()).toBe("Vehnäjauho 2 kg");
      expect(switched.developmentRequests).toBe(first.developmentRequests);
      expect(switched.developmentStoreWrites).toBe(0);

      // The list now shows the cheaper payable alternative with its real saving.
      await view
        .getByRole("button", {
          name: tr("Ostoslista", "Shopping list"),
          exact: true,
        })
        .click();
      await expect(
        row.getByRole("button", {
          name: new RegExp(tr("Edullisempi vaihtoehto", "Cheaper option")),
        }),
      ).toContainText(tr("0,90", "0.90"));
      await row
        .getByRole("button", {
          name: new RegExp(tr("Edullisempi vaihtoehto", "Cheaper option")),
        })
        .click();
      await expect(row).toContainText(
        tr("Säästät 0,90 € tällä listalla", "Saves €0.90 on this list"),
      );

      // An explicit generation uses the new basis for the initial choice.
      await view.evaluate(() => window.korikone.buildBasket());
      expect(await chosen()).toBe("Vehnäjauho 1 kg");
      await view.reload();

      // Back to unit mode: the chosen pack stays, the larger pack is a lower unit price that
      // costs more now, and it is not labelled as a saving.
      await view
        .getByRole("button", { name: tr("Asetukset", "Settings"), exact: true })
        .click();
      await settingsCategory(view, "stores", tr("Kaupat", "Stores"));
      await view
        .getByLabel(tr("Hintaperuste", "Price basis"))
        .selectOption("unit");
      await expect
        .poll(async () => (await load()).state.priceBasis)
        .toBe("unit");
      expect(await chosen()).toBe("Vehnäjauho 1 kg");
      await view
        .getByRole("button", {
          name: tr("Ostoslista", "Shopping list"),
          exact: true,
        })
        .click();
      const lower = row.getByRole("button", {
        name: tr("Edullisempi yksikköhinta", "Lower unit price"),
      });
      await expect(lower).toBeVisible();
      await expect(
        row.getByText(/Cheaper option|Edullisempi vaihtoehto/),
      ).toHaveCount(0);
      await lower.click();
      await expect(row).toContainText(tr("mutta maksat nyt", "but it costs"));
      await expect(row).toContainText(tr("1,15 € / kg", "€1.15 / kg"));
      await row
        .getByRole("button", { name: tr("Vaihda", "Swap"), exact: true })
        .click();
      await expect.poll(chosen).toBe("Vehnäjauho 2 kg");

      // A manual choice survives the other basis and an explicit generation.
      await view.evaluate(() =>
        window.korikone.setPriceBasis({ priceBasis: "total" }),
      );
      await view.evaluate(() => window.korikone.buildBasket());
      expect(await chosen()).toBe("Vehnäjauho 2 kg");

      // The setting persists across a restart.
      await current.close();
      ({ app: current, page: view } = await launch(data));
      expect((await load()).state.priceBasis).toBe("total");
    } finally {
      await current.close();
    }
  });
}
