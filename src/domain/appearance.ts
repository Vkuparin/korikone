import { z } from "zod";

export const appearanceSchema = z.enum(["system", "light", "dark"]);
export type Appearance = z.infer<typeof appearanceSchema>;
export type ResolvedAppearance = "light" | "dark";
export type AppearanceBootstrap = {
  preference: Appearance;
  resolved: ResolvedAppearance;
};

export function appearanceBootstrap(
  preference: Appearance,
  systemDark: boolean,
): AppearanceBootstrap {
  return {
    preference,
    resolved:
      preference === "system" ? (systemDark ? "dark" : "light") : preference,
  };
}
