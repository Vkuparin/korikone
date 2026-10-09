import { expect, test } from "vitest";
import { tidyName } from "../src/ai/draft";
import { packCount, unitLabel } from "../src/ui/i18n";
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
