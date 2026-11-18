import { expect, test } from "vitest";
import { editTransferHint } from "../src/ui/transfer-summary";

type Facts = Parameters<typeof editTransferHint>[0];
const hint = (overrides: Partial<Facts>) =>
  editTransferHint({
    fi: false,
    rows: 2,
    ready: 2,
    quoted: true,
    needsLogin: false,
    transferStatus: null,
    omitted: [],
    manual: [],
    hasMissingProducts: false,
    ...overrides,
  });

test("a reused list points to the missing prerequisite before offering transfer", () => {
  expect(hint({ rows: 0, ready: 0 })).toMatchObject({ target: "composer" });
  expect(hint({ quoted: false, ready: 0 })).toMatchObject({ target: "prices" });
  expect(hint({ needsLogin: true })).toEqual({
    target: "settings",
    text: "Sign in to the store before sending.",
  });
  expect(hint({})).toEqual({
    target: "transfer",
    text: "2 products ready to send",
  });
});

test("the edit result separates sendable products, omissions and manual groceries", () => {
  const partial = hint({
    ready: 1,
    omitted: ["Saffron"],
    hasMissingProducts: true,
  });
  expect(partial).toEqual({
    target: "review",
    text: "1 product ready to send\nLeft out of transfer · Saffron",
  });
  expect(hint({ ready: 0, manual: ["Boots"] })).toEqual({
    target: "list",
    text: "No products ready to send.\nAdd at the store · Boots",
  });
  expect(hint({ rows: 0, ready: 0, omitted: ["Curry"] })).toMatchObject({
    target: "list",
    text: expect.stringContaining("Curry"),
  });
});

test("the edit result counts only additional packs and recognizes an existing transfer", () => {
  expect(hint({ additionalPacks: 1 })).toEqual({
    target: "transfer",
    text: "1 additional pack to send",
  });
  expect(hint({ additionalPacks: 0 })).toEqual({
    target: "transfer",
    text: "There are no additional packs to send.",
  });
  for (const transferStatus of ["sent", "partial", "review"] as const)
    expect(hint({ transferStatus })).toMatchObject({ target: "status" });
});
