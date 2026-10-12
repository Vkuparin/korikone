import { composer, startNewList, updateName } from "./composer-helper";
import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initialState } from "../../src/domain/model";

for (const chain of ["k-ruoka", "s-kaupat"] as const)
  test(`${chain}: planning review memory correction and partial transfer retain unknown requests`, async () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    delete env.ELECTRON_RUN_AS_NODE;
    env.KORIKONE_TEST_DATA = await mkdtemp(
      join(tmpdir(), "korikone-matching-acceptance-"),
    );
    env.KORIKONE_TEST_HIDDEN = "1";
    const app = await electron.launch({ args: ["."], env });
    try {
      const page = await app.firstWindow();
      const state = initialState();
      state.onboarded = state.setupComplete = true;
      state.staples = [];
      state.context = { ...state.context, providerId: chain };
      const language = chain === "k-ruoka" ? "fi" : "en";
      const tr = (fi: string, en: string) => (language === "fi" ? fi : en);
      await page.evaluate(
        async ({ state, language }) => {
          await window.korikone.save(state);
          await window.korikone.setLanguage(language);
          await window.korikone.signInAI();
        },
        { state, language },
      );
      await app.evaluate(({ dialog }) => {
        dialog.showMessageBox = async (...args: unknown[]) => {
          const options = args.at(-1) as { detail?: string };
          (
            globalThis as unknown as { acceptanceReport: string }
          ).acceptanceReport = options.detail!;
          return { response: 1, checkboxChecked: false };
        };
      });
      const diagnostics = async () => {
        await page.evaluate(() => window.korikone.exportDiagnostics());
        return app.evaluate(() =>
          JSON.parse(
            (globalThis as unknown as { acceptanceReport: string })
              .acceptanceReport,
          ),
        );
      };
      const load = () =>
        page.evaluate(async () => (await window.korikone.load()).value);
      await page.reload();
      const note = composer(page);
      await startNewList(page);
      await note.fill("200 ml kermaa ja 1 l maitoa ja kahvia");
      await note.press("Control+Enter");
      await expect(page.locator("#note-update-help")).toHaveAttribute(
        "data-planning-phase",
        "committed",
      );
      const before = await load();
      const beforeReport = await diagnostics();
      expect(beforeReport.counts.unresolvedLines).toBe(1);
      expect(
        before.committedIntents.find(
          (result) => result.intent.label === "kahvia",
        )?.reason,
      ).toBe("unknown-quantity");
      await expect(
        page.getByText(
          tr("Tunnettujen hintojen välisumma", "Subtotal of known prices"),
          { exact: true },
        ),
      ).toBeVisible();
      await page
        .getByRole("button", {
          name:
            language === "fi"
              ? /^Tarkista ratkaisemattomat rivit/
              : /^Review unresolved rows/,
        })
        .click();
      const review = page.getByRole("region", {
        name: tr("Tarkista tuotevalinnat", "Review product choices"),
        exact: true,
      });
      const cream = review.getByRole("region", {
        name: tr("Tarkista: Kerma", "Review: Kerma"),
        exact: true,
      });
      await cream
        .getByRole("button", {
          name: /^(Muista tyyppi|Remember type): Ruokakerma 2 dl$/,
        })
        .click();
      await cream
        .getByRole("combobox", {
          name: tr("Valinnan merkitys", "Meaning of the choice"),
          exact: true,
        })
        .selectOption("required");
      await cream
        .locator(".row-memory")
        .getByRole("button", {
          name: tr("Muista tyyppi", "Remember type"),
          exact: true,
        })
        .click();
      await expect
        .poll(async () => (await load()).state.categoryPreferences.length)
        .toBe(1);
      await review
        .getByRole("button", {
          name: tr("Sulje tarkistus", "Close review"),
          exact: true,
        })
        .click();
      const milkOpener = page.getByRole("button", {
        name: `${tr("Tarkoitin jotain muuta", "I meant something else")}: Maito`,
        exact: true,
      });
      await milkOpener.click();
      const form = page.getByRole("form", {
        name: `${tr("Korjaa rivi", "Correct row")}: Maito`,
        exact: true,
      });
      await form
        .getByRole("combobox", {
          name: tr("Mikä meni väärin?", "What was wrong?"),
          exact: true,
        })
        .selectOption("wrong-quantity");
      await form
        .getByLabel(tr("Tarvittava määrä (ml)", "Required amount (ml)"), {
          exact: true,
        })
        .fill("2300");
      await form
        .getByRole("button", {
          name: tr("Tallenna korjaus", "Save correction"),
          exact: true,
        })
        .click();
      await expect
        .poll(
          async () =>
            (await load()).basket.find(
              (line) => line.requirement.name === "Maito",
            )?.requirement.amount,
        )
        .toBe(2300);
      const after = await load();
      const afterReport = await diagnostics();
      expect(afterReport.counts.unresolvedLines).toBe(0);
      expect(
        afterReport.operationMetrics.some(
          (metric: { kind: string }) => metric.kind === "correction",
        ),
      ).toBe(true);
      expect(JSON.stringify(afterReport)).not.toContain("kahvia");
      expect(after.developmentRequests).toBe(before.developmentRequests);
      expect(after.developmentStoreWrites).toBe(0);
      expect(
        after.basket.find((line) => line.requirement.name === "Maito"),
      ).toMatchObject({
        packs: 3,
        total:
          3 *
          before.basket.find((line) => line.requirement.name === "Maito")!
            .product!.price!,
        product: { id: "milk" },
      });
      expect(
        after.basket.find((line) => line.requirement.name === "Kerma")?.product
          ?.id,
      ).toBe("cream");
      expect(
        after.committedIntents.find(
          (result) => result.intent.label === "kahvia",
        )?.reason,
      ).toBe("unknown-quantity");
      expect(await page.evaluate(() => window.korikone.prepare())).toEqual({
        ok: false,
        error: "unresolved",
      });
      const partial = await page.evaluate(() =>
        window.korikone.prepare({ allowMissing: true }),
      );
      expect(partial.ok, partial.error).toBe(true);
      expect(partial.value.review?.targets).toHaveLength(2);
      expect(
        partial.value.review?.unresolvedIntents?.map(
          (result) => result.intent.label,
        ),
      ).toContain("kahvia");
      expect(partial.value.developmentStoreWrites).toBe(0);
      await startNewList(page);
      await note.fill("200 ml kermaa ja 1 l maitoa");
      await note.press("Control+Enter");
      await expect
        .poll(async () => (await load()).state.note)
        .toBe("200 ml kermaa ja 1 l maitoa");
      const remembered = await load();
      expect(
        remembered.basket.every((line) => line.matching?.status === "resolved"),
      ).toBe(true);
      expect(remembered.planningIncomplete).toBe(false);
      expect(remembered.developmentRequests).toBe(
        before.developmentRequests + 1,
      );
      await expect(
        page.getByText(tr("Arvio yhteensä", "Estimated total"), {
          exact: true,
        }),
      ).toBeVisible();
      const normal = await page.evaluate(() => window.korikone.prepare());
      expect(normal.ok, normal.error).toBe(true);
      expect(normal.value.review?.targets).toHaveLength(2);
      expect(normal.value.review?.unresolvedIntents ?? []).toEqual([]);
      expect(normal.value.review?.unresolved).toEqual([]);
      expect(normal.value.developmentStoreWrites).toBe(0);
    } finally {
      await app.close();
    }
  });
