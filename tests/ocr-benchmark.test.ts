import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { parseReceipt } from "../src/receipts/parsers";

const fixtures = JSON.parse(
  readFileSync(
    new URL("./fixtures/receipts/ocr-benchmark.json", import.meta.url),
    "utf8",
  ),
) as {
  receipts: {
    id: string;
    rows: string[];
    expectedTotalCents: number;
    expectedProductCount: number;
  }[];
};
for (const fixture of fixtures.receipts)
  test(`${fixture.id}: independent OCR reference has expected products and balanced total`, () => {
    const result = parseReceipt(fixture.rows.join("\n"));
    expect(result.outcome).toBe("event");
    if (result.outcome !== "event") throw new Error("Reference not recognized");
    expect(
      result.facts.lines.filter((line) => line.role === "product"),
    ).toHaveLength(fixture.expectedProductCount);
    expect(result.facts.reconciliation).toMatchObject({
      status: "balanced",
      computedTotal: fixture.expectedTotalCents,
      printedTotal: fixture.expectedTotalCents,
      difference: 0,
    });
  });
