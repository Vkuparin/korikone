import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureText, receiptFixtures } from "../fixtures/receipts";
import { receiptTextPDF } from "../fixtures/receipts/pdf";
import { settingsCategory } from "./settings-helper";

/**
 * F27.12: the receipt journey across its boundaries in one run. One real drop of a mixed batch
 * (text, a PDF of the same trip, another trip, a scanned PDF, a mixed PDF, abbreviated labels and
 * a broken file) becomes durable local history with no row action and no modal; one answer to
 * the invitation is one model request for the whole import; a stale correction is refused; the
 * backup and deletion behave; and planning, the store basket and preferences are never touched.
 */
const fixture = (id: string) => receiptFixtures.find((f) => f.id === id)!;
const abbreviated = [
  "S-market Esimerkki",
  "Testikatu 1, 00100 Helsinki",
  "14.10.2026 10:05  Kassa 2  Kuitti 0500",
  "--------------------------------",
  "PIRKKA KEVYTM 1L             1,19",
  "VALIO JOG 1KG                2,49",
  "OUTO TUOTE XZ                1,42",
  "--------------------------------",
  "YHTEENSÄ                     5,10",
].join("\n");
type Purchase = {
  eventId: string;
  revision: number;
  issueCount: number;
  names: {
    lines: number;
    user: number;
    named: number;
    general: number;
    raw: number;
    modelOnly: number;
  };
  factual: { ocr: boolean };
  lines: {
    id: string;
    role: string;
    label: string;
    display: { text: string; tier: string };
  }[];
};

test("one drop of a mixed batch is durable local history with readable names, one optional request and no effect on shopping", async () => {
  test.setTimeout(180000);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  const data = await mkdtemp(join(tmpdir(), "korikone-receipt-integration-"));
  env.KORIKONE_TEST_DATA = data;
  env.KORIKONE_TEST_HIDDEN = "1";
  const scanned = (name: string) =>
    join(process.cwd(), "tests/fixtures/receipts", name);
  const files = {
    trip: join(data, "matka.txt"),
    tripPdf: join(data, "matka.pdf"),
    other: join(data, "toinen-matka.txt"),
    scanned: scanned("ocr-k-clean.pdf"),
    mixed: scanned("ocr-mixed.pdf"),
    short: join(data, "lyhenteet.txt"),
    broken: join(data, "rikki.pdf"),
  };
  await writeFile(files.trip, fixtureText(fixture("trip-original")), "utf8");
  await writeFile(
    files.tripPdf,
    receiptTextPDF(fixture("trip-original").pages),
  );
  await writeFile(files.other, fixtureText(fixture("trip-distinct")), "utf8");
  await writeFile(files.short, abbreviated, "utf8");
  await writeFile(files.broken, "not a pdf");
  const backup = join(data, "varmuuskopio.json");
  let app = await electron.launch({ args: ["."], env });
  try {
    let page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
      .click();
    const load = async () =>
      (await page.evaluate(() => window.korikone.load())).value;
    const purchases = async () =>
      (
        (await page.evaluate(() => window.korikone.listPurchases()))
          .value as unknown as { receipts: { purchases: Purchase[] } }
      ).receipts.purchases;
    await expect.poll(async () => (await load()).quotedAt).not.toBeNull();
    await page.evaluate(() => window.korikone.signInAI());
    await page.reload();
    await page
      .getByRole("navigation")
      .first()
      .getByRole("button", { name: "Historia", exact: true })
      .click();
    const before = await load();
    await page.evaluate(() => {
      const marks = { first: 0, done: 0 };
      (window as unknown as { marks: typeof marks }).marks = marks;
      window.korikone.onReceiptIntake((p) => {
        if (!marks.first) marks.first = Date.now();
        if (p.stage === "done") marks.done = Date.now();
      });
    });

    // One real drop, as the operating system delivers it.
    const session = await page.context().newCDPSession(page);
    const drag = {
      items: [],
      files: Object.values(files),
      dragOperationsMask: 1,
    };
    const send = (type: "dragEnter" | "dragOver" | "drop") =>
      session.send("Input.dispatchDragEvent", {
        type,
        x: 300,
        y: 300,
        data: drag,
      });
    await send("dragEnter");
    await send("dragOver");
    // Hovering draws the overlay and calls nothing.
    await expect(page.locator(".receipt-drop-overlay")).toBeVisible();
    expect((await load()).receiptIntake ?? null).toBeNull();
    const dropped = await page.evaluate(() => Date.now());
    await send("drop");
    await expect(page.locator(".receipt-drop-overlay")).toHaveCount(0);
    const surface = page.getByRole("region", { name: "Kuittien tuonti" });
    await expect(surface.locator(".receipt-intake-summary")).toBeVisible({
      timeout: 120000,
    });
    const intake = (await load()).receiptIntake!;
    expect(intake.files.map((f) => [f.name, f.outcome])).toEqual([
      ["matka.txt", "added"],
      // The same trip as a PDF is the same purchase; the same rows on another day are not.
      ["matka.pdf", "duplicate"],
      ["toinen-matka.txt", "added"],
      ["ocr-k-clean.pdf", "added"],
      // Its pages are read (one by OCR), but they are not a shop's receipt: it fails alone.
      ["ocr-mixed.pdf", "unsupported"],
      ["lyhenteet.txt", "added"],
      ["rikki.pdf", "unsupported"],
    ]);
    const marks = await page.evaluate(
      () =>
        (window as unknown as { marks: { first: number; done: number } }).marks,
    );
    // Feedback started before the batch finished; the times are recorded, not gated.
    expect(marks.first).toBeGreaterThan(0);
    expect(marks.first).toBeLessThanOrEqual(marks.done);
    test.info().annotations.push({
      type: "receipt-feedback-ms",
      description: `first ${marks.first - dropped}, saved ${marks.done - dropped}`,
    });
    console.log(
      `receipt feedback: first ${marks.first - dropped} ms, all saved ${marks.done - dropped} ms`,
    );

    // Local history is complete without any request, modal or row action.
    const saved = await load();
    expect(saved.developmentRequests).toBe(before.developmentRequests);
    expect(saved.developmentStoreWrites).toBe(0);
    expect(saved.developmentCatalogueRequests).toBe(
      before.developmentCatalogueRequests,
    );
    expect(saved.state).toEqual(before.state);
    expect(saved.basket).toEqual(before.basket);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const local = await purchases();
    expect(local).toHaveLength(4);
    expect(local.filter((p) => p.factual.ocr)).toHaveLength(1);
    const bought = (list: Purchase[]) =>
      list.flatMap((p) =>
        p.lines.filter((l) => l.role === "product" || l.role === "non-food"),
      );
    // Every product has something readable: a grounded name or its printed label.
    expect(bought(local).every((l) => l.display.text.length > 0)).toBe(true);
    const tiers = (list: Purchase[]) => {
      const count: Record<string, number> = {};
      for (const line of bought(list))
        count[line.display.tier] = (count[line.display.tier] ?? 0) + 1;
      return count;
    };
    const localTiers = tiers(local);
    // The abbreviated receipt: one expansion the label supports, two labels left as printed.
    const short = local.find((p) =>
      p.lines.some((l) => l.label === "VALIO JOG 1KG"),
    )!;
    expect(
      short.lines
        .filter((l) => l.role === "product")
        .map((l) => [l.label, l.display.text, l.display.tier]),
    ).toEqual([
      ["PIRKKA KEVYTM 1L", "PIRKKA KEVYTM 1L", "raw"],
      ["VALIO JOG 1KG", "Valio jogurtti 1 kg", "expanded"],
      ["OUTO TUOTE XZ", "OUTO TUOTE XZ", "raw"],
    ]);
    // Only factual gaps count as issues; a missing readable name is not one.
    expect(short.issueCount).toBe(0);

    // The invitation is on the same surface and blocks nothing. One answer, one request.
    await surface
      .getByRole("button", { name: "Vain tämä tuonti", exact: true })
      .click();
    await expect
      .poll(
        async () => (await load()).receiptIntake?.enrichment?.status ?? null,
      )
      .not.toBeNull();
    const named = await load();
    expect(named.developmentRequests).toBe(before.developmentRequests + 1);
    expect(named.developmentStoreWrites).toBe(0);
    const after = await purchases();
    expect(after).toHaveLength(4);
    expect(bought(after).every((l) => l.display.text.length > 0)).toBe(true);
    // No row lost a grounded name to the model, and no money or label changed.
    const strip = (list: Purchase[]) =>
      bought(list).map((l) => [l.id, l.label]);
    expect(strip(after)).toEqual(strip(local));
    const afterTiers = tiers(after);
    expect(afterTiers.exact ?? 0).toBeGreaterThanOrEqual(localTiers.exact ?? 0);
    expect(afterTiers.expanded ?? 0).toBeGreaterThanOrEqual(
      localTiers.expanded ?? 0,
    );
    console.log(
      `receipt names: local ${JSON.stringify(localTiers)}, after one request ${JSON.stringify(afterTiers)}`,
    );
    // The permission was for this import only.
    expect(
      (
        (await page.evaluate(() => window.korikone.listPurchases()))
          .value as unknown as {
          receipts: { consent: { automatic: unknown } | null };
        }
      ).receipts.consent?.automatic ?? null,
    ).toBeNull();

    // A correction bound to an older revision is refused; the current one applies to one row.
    const target = (await purchases()).find((p) =>
      p.lines.some((l) => l.label === "VALIO JOG 1KG"),
    )!;
    const line = target.lines.find((l) => l.label === "VALIO JOG 1KG")!;
    const interpret = (revision: number) =>
      page.evaluate((input) => window.korikone.interpretPurchase(input), {
        eventId: target.eventId,
        lineId: line.id,
        revision,
        name: "Aamujogurtti",
        category: null,
        qualifiers: [],
        scope: "food",
      });
    expect((await interpret(target.revision + 5)).ok).toBe(false);
    expect((await interpret(target.revision)).ok).toBe(true);
    const corrected = (await purchases()).find(
      (p) => p.eventId === target.eventId,
    )!;
    expect(
      corrected.lines.find((l) => l.id === line.id)!.display,
    ).toMatchObject({ text: "Aamujogurtti", tier: "user" });
    expect(corrected.names.user).toBe(1);
    expect((await load()).state.categoryPreferences).toEqual(
      before.state.categoryPreferences,
    );

    // What is kept is said plainly: sanitized rows, not the source text and not the PDF.
    await page
      .getByRole("navigation")
      .first()
      .getByRole("button", { name: "Asetukset", exact: true })
      .click();
    await settingsCategory(page, "data", "Tiedot");
    await expect(page.locator(".receipt-card")).toHaveCount(4);
    // The cards stay collapsed after a routine import.
    await expect(page.locator(".receipt-card[open]")).toHaveCount(0);
    const card = page.locator(".receipt-card").first();
    await card.locator(":scope > summary").click();
    await card.locator(".receipt-more summary").click();
    await expect(card).toContainText(
      "Lähdetekstiä tai PDF-tiedostoa ei säilytetä",
    );

    // Backup carries the purchases and the correction, never an original.
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, backup);
    await page.evaluate(() => window.korikone.exportData());
    const exported = await readFile(backup, "utf8");
    expect(exported).toContain("Aamujogurtti");
    expect(exported).not.toContain("purchaseOriginals");
    expect(exported).not.toContain("Testikatu");

    // Deleting one purchase removes it alone; the same file is then a new import, not a duplicate.
    await page.evaluate(
      (eventId) => window.korikone.deletePurchase({ eventId, scope: "event" }),
      target.eventId,
    );
    expect(await purchases()).toHaveLength(3);
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, files.short);
    const again = await page.evaluate(() => window.korikone.importReceipts());
    expect(again.value.receiptIntake!.files.map((f) => f.outcome)).toEqual([
      "added",
    ]);
    // "Just this import" was not remembered: the next import sends nothing by itself.
    expect((await load()).developmentRequests).toBe(
      before.developmentRequests + 1,
    );

    // Everything survives a restart, and shopping is as it was.
    await app.close();
    app = await electron.launch({ args: ["."], env });
    page = await app.firstWindow();
    expect(await purchases()).toHaveLength(4);
    const restarted = await load();
    expect(restarted.state.extras).toEqual(before.state.extras);
    expect(restarted.state.meals).toEqual(before.state.meals);
    expect(restarted.state.context).toEqual(before.state.context);
    expect(restarted.journal ?? null).toEqual(before.journal ?? null);
  } finally {
    await app.close();
  }
});
