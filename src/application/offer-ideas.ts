import type { OfferIdea } from "../ai/offers";
export type OfferIdeasView =
  | { status: "loading" }
  | { status: "unsupported" | "empty" | "signed-out" }
  | { status: "error"; code: string }
  | { status: "ready"; ideas: OfferIdea[]; truncated: boolean };
