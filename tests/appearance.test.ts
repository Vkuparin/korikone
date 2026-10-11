import { test, expect } from "vitest";
import { appearanceBootstrap, chainIdentity } from "../src/domain/appearance";

test("appearance bootstrap resolves System and keeps explicit modes independent of system changes", () => {
  for (const systemDark of [false, true]) {
    expect(appearanceBootstrap("system", systemDark)).toEqual({
      preference: "system",
      resolved: systemDark ? "dark" : "light",
      chain: "neutral",
      sequence: 0,
    });
    expect(appearanceBootstrap("light", systemDark)).toMatchObject({
      preference: "light",
      resolved: "light",
    });
    expect(appearanceBootstrap("dark", systemDark)).toMatchObject({
      preference: "dark",
      resolved: "dark",
    });
  }
});

test("chain identity comes from the provider ID alone, with a neutral fallback", () => {
  expect(
    ["s-kaupat", "demo-s", "k-ruoka", "demo-k"].map(chainIdentity),
  ).toEqual(["s", "s", "k", "k"]);
  // Display names, other casing, prototype keys and missing values never select a chain.
  for (const unknown of [
    "prisma",
    "K-Ruoka",
    "S-kaupat · Helsinki",
    "",
    "toString",
    "__proto__",
    undefined,
    null,
    7,
  ])
    expect(chainIdentity(unknown)).toBe("neutral");
  // The identity is independent of the appearance mode and carries the publication order.
  for (const preference of ["system", "light", "dark"] as const)
    expect(appearanceBootstrap(preference, true, "demo-k", 4)).toMatchObject({
      preference,
      chain: "k",
      sequence: 4,
    });
  expect(appearanceBootstrap("light", false, "s-kaupat").chain).toBe("s");
});
