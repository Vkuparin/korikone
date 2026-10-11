import { z } from "zod";

export const appearanceSchema = z.enum(["system", "light", "dark"]);
export type Appearance = z.infer<typeof appearanceSchema>;
export type ResolvedAppearance = "light" | "dark";
/** The chain whose accent the app shows: S-kaupat green, K-Ruoka orange, or a neutral fallback. */
export const chainIdentitySchema = z.enum(["s", "k", "neutral"]);
export type ChainIdentity = z.infer<typeof chainIdentitySchema>;
export type AppearanceBootstrap = {
  preference: Appearance;
  resolved: ResolvedAppearance;
  /** Derived from the committed shopping context; never saved and never a preference. */
  chain: ChainIdentity;
  /** Grows with every published change, so a late older value cannot replace a newer one. */
  sequence: number;
};

const chains: Record<string, ChainIdentity> = {
  "s-kaupat": "s",
  "demo-s": "s",
  "k-ruoka": "k",
  "demo-k": "k",
};
/** Identity comes from the provider ID alone, never from a store name, tab or sign-in state. */
export function chainIdentity(providerId: unknown): ChainIdentity {
  return typeof providerId === "string" && Object.hasOwn(chains, providerId)
    ? chains[providerId]
    : "neutral";
}

export function appearanceBootstrap(
  preference: Appearance,
  systemDark: boolean,
  providerId?: string,
  sequence = 0,
): AppearanceBootstrap {
  return {
    preference,
    resolved:
      preference === "system" ? (systemDark ? "dark" : "light") : preference,
    chain: chainIdentity(providerId),
    sequence,
  };
}
