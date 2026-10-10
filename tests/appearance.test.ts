import { test, expect } from "vitest";
import { appearanceBootstrap } from "../src/domain/appearance";

test("appearance bootstrap resolves System and keeps explicit modes independent of system changes", () => {
  for (const systemDark of [false, true]) {
    expect(appearanceBootstrap("system", systemDark)).toEqual({
      preference: "system",
      resolved: systemDark ? "dark" : "light",
    });
    expect(appearanceBootstrap("light", systemDark)).toEqual({
      preference: "light",
      resolved: "light",
    });
    expect(appearanceBootstrap("dark", systemDark)).toEqual({
      preference: "dark",
      resolved: "dark",
    });
  }
});
