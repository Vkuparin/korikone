import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureText, receiptFixtures } from "../fixtures/receipts";

const fixture = (id: string) => receiptFixtures.find((f) => f.id === id)!;

test("files dropped on the app are imported through the operating-system path bridge; a script-made file is ignored", async () => {
  test.setTimeout(90000);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  const data = await mkdtemp(join(tmpdir(), "korikone-drop-"));
  env.KORIKONE_TEST_DATA = data;
  env.KORIKONE_TEST_HIDDEN = "1";
  const receipt = join(data, "pudotettu.txt");
  const image = join(data, "kuva.png");
  await writeFile(receipt, fixtureText(fixture("s-weighed-produce")), "utf8");
  await writeFile(image, "png");
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Kokeile esimerkkiä", exact: true })
      .click();
    await page.evaluate(() => {
      (window as unknown as { dropped: unknown[] }).dropped = [];
      window.korikone.onReceiptDrop((result) =>
        (window as unknown as { dropped: unknown[] }).dropped.push(result),
      );
    });
    const dropped = () =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              dropped: {
                ok: boolean;
                value?: {
                  receiptIntake: {
                    files: { name: string; outcome: string }[];
                  };
                };
              }[];
            }
          ).dropped,
      );

    // A file object made by page script has no path on disk: nothing is imported.
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["S-MARKET"], "vale.txt"));
      document.body.dispatchEvent(
        new DragEvent("drop", {
          dataTransfer: transfer,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await page.waitForTimeout(500);
    expect(await dropped()).toEqual([]);

    // A real drop, as the operating system delivers it.
    const session = await page.context().newCDPSession(page);
    const point = { x: 300, y: 300 };
    const drag = {
      items: [],
      files: [receipt, image],
      dragOperationsMask: 1,
    };
    for (const type of ["dragEnter", "dragOver", "drop"] as const)
      await session.send("Input.dispatchDragEvent", {
        type,
        ...point,
        data: drag,
      });
    await expect.poll(async () => (await dropped()).length).toBe(1);
    const [result] = await dropped();
    expect(result.ok).toBe(true);
    expect(
      result.value!.receiptIntake.files.map((f) => [f.name, f.outcome]),
    ).toEqual([
      ["pudotettu.txt", "added"],
      ["kuva.png", "unsupported"],
    ]);
    // The drop did not navigate the window away from the app.
    expect(page.url()).toMatch(/index\.html$/);
    const listed = (
      (await page.evaluate(() => window.korikone.listPurchases()))
        .value as unknown as { receipts: { purchases: unknown[] } }
    ).receipts;
    expect(listed.purchases).toHaveLength(1);
  } finally {
    await app.close();
  }
});
