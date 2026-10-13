import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureText, receiptFixtures } from "../fixtures/receipts";
import { receiptTextPDF } from "../fixtures/receipts/pdf";

const fixture = (id: string) => receiptFixtures.find((f) => f.id === id)!;
type Listed = { receipts: { purchases: { issueCount: number }[] } };

test("one picker action saves several real files through the worker and IPC, beside untouched planning", async () => {
  test.setTimeout(120000);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  const data = await mkdtemp(join(tmpdir(), "korikone-intake-api-"));
  env.KORIKONE_TEST_DATA = data;
  env.KORIKONE_TEST_HIDDEN = "1";
  const files = {
    pdf: join(data, "kaksi-sivua.pdf"),
    banana: join(data, "banaani.txt"),
    fake: join(data, "ei-pdf.pdf"),
    image: join(data, "kuva.png"),
    again: join(data, "sama.txt"),
  };
  const later = join(data, "k-kuitti.csv");
  await writeFile(files.pdf, receiptTextPDF(fixture("s-multi-page").pages));
  await writeFile(
    files.banana,
    fixtureText(fixture("s-weighed-produce")),
    "utf8",
  );
  await writeFile(files.fake, "not a pdf");
  await writeFile(files.image, "png");
  await writeFile(files.again, fixtureText(fixture("s-multi-page")), "utf8");
  await writeFile(later, fixtureText(fixture("k-weighed")), "utf8");
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
      .click();
    const load = async () =>
      (await page.evaluate(() => window.korikone.load())).value;
    await expect.poll(async () => (await load()).quotedAt).not.toBeNull();
    await page.evaluate(() => window.korikone.signInAI());
    const before = await load();
    // The page has a picker action and progress events, and no way to name a path itself.
    expect(
      await page.evaluate(() => ({
        drop: "receiptDrop" in window.korikone,
        picker: typeof window.korikone.importReceipts,
      })),
    ).toEqual({ drop: false, picker: "function" });
    const pick = (paths: string[]) =>
      app.evaluate(({ dialog }, paths) => {
        dialog.showOpenDialog = async (...args: unknown[]) => {
          (globalThis as unknown as { pickerOptions: unknown }).pickerOptions =
            args.at(-1);
          return { canceled: false, filePaths: paths };
        };
      }, paths);
    await page.evaluate(() => {
      (window as unknown as { stages: string[] }).stages = [];
      window.korikone.onReceiptIntake((p) =>
        (window as unknown as { stages: string[] }).stages.push(
          `${p.stage}:${p.file}/${p.files}`,
        ),
      );
    });

    await pick(Object.values(files));
    const imported = await page.evaluate(() =>
      window.korikone.importReceipts(),
    );
    expect(imported.ok).toBe(true);
    const intake = imported.value.receiptIntake!;
    expect(intake.files.map((f) => [f.name, f.outcome, f.code])).toEqual([
      ["kaksi-sivua.pdf", "added", null],
      ["banaani.txt", "added", null],
      ["ei-pdf.pdf", "unsupported", "receiptUnsupported"],
      ["kuva.png", "unsupported", "receiptUnsupported"],
      ["sama.txt", "duplicate", null],
    ]);
    expect(intake.counts).toMatchObject({
      added: 2,
      duplicate: 1,
      unsupported: 2,
    });
    // The picker allows several files of the supported types.
    expect(
      await app.evaluate(
        () =>
          (globalThis as unknown as { pickerOptions: unknown }).pickerOptions,
      ),
    ).toMatchObject({ properties: ["openFile", "multiSelections"] });
    // Progress came through as real stages for real files.
    const stages = await page.evaluate(
      () => (window as unknown as { stages: string[] }).stages,
    );
    expect(stages[0]).toBe("reading:1/5");
    expect(stages).toContain("saving:2/5");
    expect(stages.at(-1)).toBe("done:5/5");
    // No consent was given: nothing was sent, and the shopper may be invited.
    expect(intake.enrichment).toBeNull();
    expect(intake.invitation).toMatchObject({ scope: 1 });
    const saved = await load();
    expect(saved.developmentRequests).toBe(before.developmentRequests);
    expect(saved.state).toEqual(before.state);
    expect(saved.basket).toEqual(before.basket);

    // A planning request is now in flight.
    await page.evaluate(() =>
      window.korikone.developmentScenario("pendingSuccess"),
    );
    await page.evaluate(() => {
      (window as unknown as { planning: unknown }).planning =
        window.korikone.planShopping({ prompt: "1 l maitoa", consent: true });
    });
    await expect
      .poll(async () => (await load()).planning?.phase)
      .toBe("interpreting");
    // "Just this import" while planning owns the connection: skipped honestly, nothing queued.
    const busy = await page.evaluate(
      (invitation) =>
        window.korikone.receiptConsentAction({
          choice: "once",
          providerId: invitation.providerId,
          scope: 1,
          eventIds: invitation.eventIds,
        }),
      intake.invitation!,
    );
    expect(busy.value.receiptIntake!.enrichment).toMatchObject({
      status: "unavailable",
      reason: "aiBusy",
    });
    // Another import beside the same planning request: saved, and planning is undisturbed.
    await pick([later]);
    const second = await page.evaluate(() => window.korikone.importReceipts());
    expect(second.value.receiptIntake!.counts.added).toBe(1);
    const during = await load();
    expect(during.planning?.phase).toBe("interpreting");
    expect(during.state).toEqual(before.state);
    expect(during.basket).toEqual(before.basket);
    expect(during.developmentStoreWrites).toBe(0);
    expect(during.developmentCatalogueRequests).toBe(
      before.developmentCatalogueRequests,
    );
    // Only the planning request was ever sent to a model.
    expect(during.developmentRequests).toBe(before.developmentRequests + 1);
    const listed = (
      (await page.evaluate(() => window.korikone.listPurchases()))
        .value as unknown as Listed
    ).receipts;
    expect(listed.purchases).toHaveLength(3);
    // Cancelling the shopping request is its own action and leaves the saved purchases alone.
    await page.evaluate(() => window.korikone.cancelAI());

    // Saved purchases survive a restart.
    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    const restarted = (
      (await page.evaluate(() => window.korikone.listPurchases()))
        .value as unknown as Listed
    ).receipts;
    expect(restarted.purchases).toHaveLength(3);
  } finally {
    await app.close();
  }
});
