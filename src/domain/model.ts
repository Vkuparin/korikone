import { z } from "zod";

export const unitSchema = z.enum(["g", "ml", "pcs"]);
export type Unit = z.infer<typeof unitSchema>;
export const ingredientSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  amount: z.number().int().positive().max(10_000_000),
  unit: unitSchema,
});
export const recipeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  servings: z.number().int().min(1).max(100),
  ingredients: z.array(ingredientSchema).min(1).max(100),
  instructions: z.string().max(10000),
});
export const mealSchema = z.object({
  id: z.string(),
  day: z.number().int().min(0).max(6),
  recipeId: z.string(),
  servings: z.number().int().min(1).max(100),
  leftovers: z.boolean(),
});
export const stapleSchema = ingredientSchema.extend({
  everyDays: z.number().int().min(1).max(365),
  lastPurchased: z.string().nullable(),
  enabled: z.boolean(),
});
export const contextSchema = z.object({
  providerId: z.string().min(1),
  storeId: z.string().min(1),
  storeName: z.string(),
  fulfillment: z.enum(["pickup", "delivery"]),
});
export const stateSchema = z.object({
  version: z.literal(1),
  language: z.enum(["fi", "en"]),
  onboarded: z.boolean(),
  setupComplete: z.boolean().default(true),
  household: z.object({
    servings: z.number().int().min(1).max(100),
    budget: z.number().int().min(0).max(1_000_000),
    exclusions: z.string().max(1000),
  }),
  recipes: z.array(recipeSchema).max(1000),
  meals: z.array(mealSchema).max(100),
  staples: z.array(stapleSchema).max(500),
  skipped: z.array(z.string()).max(1000),
  context: contextSchema,
  revision: z.number().int().nonnegative(),
  accepted: z.record(z.string(), z.array(z.string())),
  // Earlier weeks, newest first, for "use last week".
  history: z
    .array(
      z.object({ savedAt: z.string(), meals: z.array(mealSchema).max(100) }),
    )
    .max(12)
    .default([]),
});
export type AppState = z.infer<typeof stateSchema>;
export type Recipe = z.infer<typeof recipeSchema>;
export type Ingredient = z.infer<typeof ingredientSchema>;
export type StoreContext = z.infer<typeof contextSchema>;
export type Requirement = Ingredient & { sources: string[] };
export type Product = {
  id: string;
  providerId: string;
  storeId: string;
  name: string;
  ingredientId: string;
  packAmount: number;
  unit: Unit;
  price: number | null;
  available: boolean | null;
  deposit: number;
  nativeUnit: string;
  increment: number;
  observedAt: string;
};
export type BasketLine = {
  requirement: Requirement;
  product: Product | null;
  packs: number;
  total: number | null;
  candidates: Product[];
};
export type CartLine = {
  productId: string;
  quantity: number;
  unit: string;
  name: string;
};
export type Cart = {
  accountId: string;
  context: StoreContext;
  lines: CartLine[];
};
export type Target = CartLine & {
  before: number;
  price: number;
  accountId?: string;
};
export type Review = {
  id: string;
  revision: number;
  context: StoreContext;
  baseline: Cart;
  targets: Target[];
  createdAt: string;
  total: number;
  quotes: BasketLine[];
};
export type Journal = {
  review: Review;
  status: "ready" | "transferring" | "partial" | "verified";
  verified: string[];
  uncertain: string | null;
  error: string | null;
};

export function parseAmount(input: string, unit: Unit | "kg" | "l"): number {
  if (!/^\d+(?:[.,]\d{1,3})?$/.test(input.trim()))
    throw new Error("invalidQuantity");
  const [whole, fraction = ""] = input.trim().replace(",", ".").split(".");
  const value = Number(whole) * 1000 + Number(fraction.padEnd(3, "0"));
  const result = unit === "kg" || unit === "l" ? value : value / 1000;
  if (!Number.isSafeInteger(result) || result <= 0 || result > 10_000_000)
    throw new Error("invalidQuantity");
  return result;
}
export function initialState(): AppState {
  return {
    version: 1,
    language: "fi",
    onboarded: false,
    setupComplete: false,
    household: { servings: 4, budget: 12000, exclusions: "" },
    recipes: [
      {
        id: "pasta",
        name: "Tomaattipasta",
        servings: 4,
        ingredients: [
          { id: "pasta", name: "Pasta", amount: 400, unit: "g" },
          { id: "tomato", name: "Tomaattimurska", amount: 800, unit: "g" },
        ],
        instructions: "Keitä pasta. Kuumenna tomaattimurska ja yhdistä.",
      },
      {
        id: "soup",
        name: "Peruna-porkkanakeitto",
        servings: 4,
        ingredients: [
          { id: "potato", name: "Peruna", amount: 800, unit: "g" },
          { id: "carrot", name: "Porkkana", amount: 400, unit: "g" },
          { id: "cream", name: "Ruokakerma", amount: 200, unit: "ml" },
        ],
        instructions: "Pilko kasvikset ja keitä kypsiksi. Lisää kerma.",
      },
      {
        id: "porridge",
        name: "Kaurapuuro",
        servings: 4,
        ingredients: [
          { id: "oats", name: "Kaurahiutale", amount: 200, unit: "g" },
          { id: "milk", name: "Maito", amount: 800, unit: "ml" },
        ],
        instructions: "Keitä hiljalleen sekoittaen.",
      },
    ],
    meals: [],
    staples: [
      {
        id: "coffee",
        name: "Kahvi",
        amount: 500,
        unit: "g",
        everyDays: 21,
        lastPurchased: null,
        enabled: true,
      },
    ],
    skipped: [],
    context: {
      providerId: "demo-k",
      storeId: "demo-helsinki",
      storeName: "K-Ruoka · Helsinki (demo)",
      fulfillment: "pickup",
    },
    revision: 0,
    accepted: {},
    history: [],
  };
}
