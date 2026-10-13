import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import {
  merchandiseStatusSchema,
  noMerchandise,
  type MerchandiseIntent,
} from "../src/domain/merchandise";
import { MerchandiseRow, merchandiseStatusText } from "../src/ui/merchandise";

const intent = (
  missing: MerchandiseIntent["missing"] = [],
): MerchandiseIntent => ({
  version: 1,
  family: "kumisaapas",
  attributes: missing.length
    ? []
    : [{ kind: "size", value: "32", provenance: "explicit-note" }],
  missing,
});
const render = (props: Partial<Parameters<typeof MerchandiseRow>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(MerchandiseRow, {
      language: "fi",
      intent: intent(),
      status: null,
      evidence: null,
      capabilities: noMerchandise,
      busy: false,
      canOpenStore: false,
      answer: async () => true,
      openStore: () => {},
      ...props,
    }),
  );

test("every store statement has its own text in both languages and none reads as another", () => {
  for (const fi of [true, false]) {
    const texts = merchandiseStatusSchema.options.map((s) =>
      merchandiseStatusText(s, fi),
    );
    expect(new Set(texts).size).toBe(texts.length);
    // Not listed here is not "does not exist"; unknown is not "in stock".
    expect(merchandiseStatusText("not-listed-here", fi)).toMatch(
      fi ? /muiden kauppojen/ : /other stores/,
    );
    expect(merchandiseStatusText("unknown", fi)).not.toMatch(
      fi ? /ilmoitettu saatavilla/ : /reported available/,
    );
  }
});

test("a missing attribute is asked for once and nothing is searched; a statement replaces the question when given", () => {
  const asking = render({
    intent: intent(["size"]),
    status: "not-listed-here",
  });
  expect(asking).toContain("Tarvitaan vielä koko");
  expect(asking).toContain("<form");
  // The store statement is not shown while the row cannot be searched.
  expect(asking).not.toContain("merchandise-status");
  const answered = render({ status: "variant-missing" });
  expect(answered).toContain("koko 32");
  expect(answered).toContain('data-status="variant-missing"');
  expect(answered).not.toContain("<form");
});

test("brand and shop/online evidence are shown only as the store reported them, and manual hand-off is explicit", () => {
  const html = render({
    language: "en",
    status: "exact-available",
    evidence: { brand: "Nokian", inStore: true, online: false },
    canOpenStore: true,
  });
  expect(html).toContain("Brand: Nokian");
  expect(html).toContain("In the shop");
  expect(html).toContain("Not online");
  expect(html).toContain("not transferred automatically");
  expect(html).toContain("Open the store page");
  const silent = render({
    language: "en",
    status: "unknown",
    evidence: { brand: null, inStore: null, online: null },
  });
  expect(silent).not.toContain("In the shop");
  expect(silent).not.toContain("Online");
});
