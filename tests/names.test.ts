import { expect, test } from "vitest";
import { tidyName } from "../src/ai/draft";
import { count, packCount, unitLabel } from "../src/ui/i18n";
test("tidies model casing slips but keeps acronyms and normal names", () => {
  expect(tidyName("MakaronI")).toBe("Makaroni");
  expect(tidyName("  kevyt   maito ")).toBe("Kevyt maito");
  expect(tidyName("UHT-maito")).toBe("UHT-maito");
  expect(tidyName("Jauheliha")).toBe("Jauheliha");
});
test("shows Finnish units and pack counts", () => {
  expect(unitLabel("pcs", "fi")).toBe("kpl");
  expect(unitLabel("pcs", "en")).toBe("pcs");
  expect(unitLabel("g", "fi")).toBe("g");
  expect(packCount(1, "fi")).toBe("1 pakkaus");
  expect(packCount(3, "fi")).toBe("3 pakkausta");
  expect(packCount(1, "en")).toBe("1 pack");
});
test("counts take the singular after exactly one (B6.6)", () => {
  const products = (n: number, fi: boolean) =>
    count(n, fi, ["tuote", "tuotetta"], ["product", "products"]);
  expect(products(1, true)).toBe("1 tuote");
  expect(products(2, true)).toBe("2 tuotetta");
  expect(products(21, true)).toBe("21 tuotetta");
  expect(products(0, true)).toBe("0 tuotetta");
  expect(products(1, false)).toBe("1 product");
  expect(products(3, false)).toBe("3 products");
});
