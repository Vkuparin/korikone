import { validateAIClassification } from "../domain/categories";
import { printedIn } from "../domain/merchandise";
import { DraftError } from "../domain/draft-errors";
import type { Ingredient } from "../domain/model";
import {
  parseJSON,
  validateDraft,
  type DraftValidationState,
  type MealDraft,
} from "./draft";

/**
 * Salvage keeps the usable part of a parseable model draft that strict validation refused. It
 * only removes or downgrades: an invalid classification becomes an inferred one, and a meal, item,
 * ingredient, side or request-ledger entry that cannot be validated is left out. It never adds an
 * explicit-note claim, a product, a price or a request the reply did not contain. The result has
 * passed the same strict `validateDraft` as an accepted reply.
 */
export const salvageLimits = Object.freeze({ passes: 80 });

type Loose = Record<string, unknown>;
const record = (value: unknown): Loose | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Loose)
    : null;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const whole = (value: unknown, min: number, max: number, fallback: number) => {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.replace(",", "."))
        : NaN;
  return Number.isFinite(number)
    ? Math.min(max, Math.max(min, Math.round(number)))
    : fallback;
};
// Units a text reply writes despite the prompt, converted the same way the prompt asks.
const units: Record<string, [Ingredient["unit"], number]> = {
  g: ["g", 1],
  gr: ["g", 1],
  kg: ["g", 1000],
  ml: ["ml", 1],
  cl: ["ml", 10],
  dl: ["ml", 100],
  l: ["ml", 1000],
  pcs: ["pcs", 1],
  pc: ["pcs", 1],
  kpl: ["pcs", 1],
};

/** A reply that is JSON, fenced JSON or JSON wrapped in a sentence. */
export function parseLooseJSON(raw: string): unknown {
  try {
    return parseJSON(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function looseIngredient(value: unknown, source: string, recipe: boolean) {
  const o = record(value);
  if (!o) return null;
  const name = text(o.name, 200);
  const [unit, scale] = units[text(o.unit, 10).toLowerCase()] ?? [];
  const amount =
    typeof o.amount === "number"
      ? o.amount
      : typeof o.amount === "string"
        ? Number(o.amount.replace(",", "."))
        : NaN;
  if (!name || !unit || !scale || !Number.isFinite(amount) || amount <= 0)
    return null;
  const item: Loose = {
    id: text(o.id, 100) || name.toLocaleLowerCase("fi").slice(0, 100),
    name,
    amount: Math.min(10_000_000, Math.max(1, Math.round(amount * scale))),
    unit,
  };
  if (record(o.classification))
    try {
      item.classification = validateAIClassification(
        o.classification as never,
        source,
        recipe,
      );
    } catch {
      // Inferred again from the name by validateDraft.
    }
  const merchandise = record(o.merchandise);
  if (!recipe && merchandise) {
    // An attribute the shopper did not write is left out; the row then asks for it.
    item.merchandise = {
      ...merchandise,
      attributes: list(merchandise.attributes).filter((a) => {
        const attribute = record(a);
        return (
          attribute?.provenance === "explicit-note" &&
          typeof attribute.value === "string" &&
          !/\d{4,}/.test(attribute.value) &&
          printedIn(source, attribute.value)
        );
      }),
    };
  }
  return item;
}

function looseDraft(value: unknown, source: string): Loose | null {
  const o = record(value);
  if (!o) return null;
  const recipes: Loose[] = [];
  const lost: string[] = [];
  const recipeIds = new Set<string>();
  for (const entry of list(o.recipes).slice(0, 50)) {
    const r = record(entry);
    const name = text(r?.name, 200);
    if (!r || !name) continue;
    const ingredients = list(r.ingredients)
      .map((i) => looseIngredient(i, source, true))
      .filter((i): i is Loose => i !== null)
      .slice(0, 100);
    if (!ingredients.length) {
      lost.push(name);
      continue;
    }
    let id = text(r.id, 200) || `draft-${crypto.randomUUID()}`;
    if (recipeIds.has(id)) id = `draft-${crypto.randomUUID()}`;
    recipeIds.add(id);
    recipes.push({
      id,
      originalId: text(r.id, 200),
      name,
      servings: whole(r.servings, 1, 100, 4),
      ingredients,
      instructions:
        typeof r.instructions === "string"
          ? r.instructions.slice(0, 10_000)
          : "",
      ...(["meal", "ready", "breakfast", "evening", "snack"].includes(
        r.kind as string,
      )
        ? { kind: r.kind }
        : {}),
    });
  }
  const meals = list(o.meals)
    .slice(0, 100)
    .flatMap((entry) => {
      const m = record(entry);
      const recipeId = text(m?.recipeId, 200);
      if (!m || !recipeId) return [];
      // A duplicate recipe ID was renamed: the first recipe with that ID keeps the meal.
      const renamed =
        recipes.find((r) => r.originalId === recipeId)?.id ?? recipeId;
      return [
        {
          day: whole(m.day, 0, 6, 0),
          recipeId: renamed,
          servings: whole(m.servings, 1, 100, 4),
          leftovers: m.leftovers === true,
        },
      ];
    });
  for (const recipe of recipes) {
    delete recipe.originalId;
    // A new recipe the reply forgot to put on the list is still a dish it planned.
    if (!meals.some((m) => m.recipeId === recipe.id) && meals.length < 100)
      meals.push({
        day: 0,
        recipeId: recipe.id as string,
        servings: recipe.servings as number,
        leftovers: false,
      });
  }
  const items = list(o.items)
    .map((i) => looseIngredient(i, source, false))
    .filter((i): i is Loose => i !== null)
    .slice(0, 200);
  return {
    lost,
    recipes,
    meals,
    items,
    notes: text(o.notes, 5000),
    ...(Array.isArray(o.intents) ? { intents: o.intents.slice(0, 100) } : {}),
    ...(Array.isArray(o.offerUses) ? { offerUses: o.offerUses } : {}),
    ...(Array.isArray(o.sides) ? { sides: o.sides.slice(0, 20) } : {}),
  };
}

const at = (path: string | null, pattern: RegExp) =>
  path?.match(pattern) ?? null;

/** What salvage left out, by the reply's own names, so the shopper can ask for it again. */
export type SalvageResult = {
  draft: MealDraft;
  omitted: string[];
  ledgerDropped: boolean;
};

export function salvageDraft(
  raw: string,
  state: DraftValidationState,
  source = state.note,
): SalvageResult | null {
  const draft = looseDraft(parseLooseJSON(raw), source);
  if (!draft) return null;
  const omitted = draft.lost as string[];
  delete draft.lost;
  let ledgerDropped = false;
  const recipes = draft.recipes as Loose[];
  const meals = draft.meals as Loose[];
  const items = draft.items as Loose[];
  const mealName = (meal: Loose) =>
    String(
      [...recipes, ...state.recipes].find((r) => r.id === meal.recipeId)
        ?.name ?? "",
    );
  // Ledger entries and sides point at meal and item positions: shift them past a removed one.
  const shift = (field: "mealIndex" | "itemIndex", index: number) => {
    const intents = draft.intents as Loose[] | undefined;
    if (intents) {
      const kept = intents.filter((i) => record(i)?.[field] !== index);
      for (const intent of kept) {
        const position = record(intent)?.[field];
        if (typeof position === "number" && position > index)
          intent[field] = position - 1;
      }
      if (kept.length) draft.intents = kept;
      else {
        ledgerDropped = true;
        delete draft.intents;
      }
    }
    if (field === "mealIndex" && draft.sides) {
      const kept = (draft.sides as Loose[]).filter(
        (side) => record(side)?.mealIndex !== index,
      );
      for (const side of kept) {
        const position = record(side)?.mealIndex;
        if (typeof position === "number" && position > index)
          side.mealIndex = position - 1;
      }
      draft.sides = kept;
    }
  };
  const dropMeal = (index: number) => {
    const [meal] = meals.splice(index, 1);
    if (!meal) return false;
    omitted.push(mealName(meal));
    shift("mealIndex", index);
    return true;
  };
  const dropItem = (index: number) => {
    const [item] = items.splice(index, 1);
    if (!item) return false;
    omitted.push(String(item.name));
    shift("itemIndex", index);
    return true;
  };
  for (let pass = 0; pass < salvageLimits.passes; pass++) {
    // A recipe whose meal is gone is not a request any more.
    for (let r = recipes.length - 1; r >= 0; r--)
      if (!meals.some((m) => m.recipeId === recipes[r].id))
        recipes.splice(r, 1);
    if (
      !meals.length &&
      !items.length &&
      !(draft.intents as unknown[] | undefined)?.length
    )
      return null;
    try {
      const validated = validateDraft(JSON.stringify(draft), state, source);
      if (!validated.meals.length && !validated.items.length) return null;
      return {
        draft: validated,
        omitted: omitted.filter(Boolean),
        ledgerDropped,
      };
    } catch (error) {
      if (!(error instanceof DraftError)) return null;
      const path = error.path;
      let match: RegExpMatchArray | null;
      if (error.reason.startsWith("intent") || at(path, /^intents/)) {
        const index = at(path, /^intents\[(\d+)\]/);
        const intents = draft.intents as unknown[] | undefined;
        // An entry that cannot be checked is left out; a ledger that no longer covers the
        // reply is dropped whole, keeping the meals and items themselves.
        if (
          index &&
          intents &&
          intents.length > 1 &&
          error.reason !== "intent-coverage"
        )
          intents.splice(Number(index[1]), 1);
        else {
          ledgerDropped = true;
          delete draft.intents;
        }
      } else if (error.reason === "assumed-side" || at(path, /^sides/)) {
        const index = at(path, /^sides\[(\d+)\]/);
        if (!index) delete draft.sides;
        else (draft.sides as unknown[]).splice(Number(index[1]), 1);
      } else if (
        (match = at(path, /^recipes\[(\d+)\]\.ingredients\[(\d+)\]/))
      ) {
        const recipe = recipes[Number(match[1])];
        const ingredients = recipe?.ingredients as Loose[] | undefined;
        const ingredient = ingredients?.[Number(match[2])];
        if (!recipe || !ingredients || !ingredient) return null;
        if (ingredient.classification && error.reason === "classification")
          delete ingredient.classification;
        else ingredients.splice(Number(match[2]), 1);
        if (!ingredients.length) {
          const meal = meals.findIndex((m) => m.recipeId === recipe.id);
          if (meal >= 0) dropMeal(meal);
        }
      } else if ((match = at(path, /^recipes\[(\d+)\]/))) {
        const recipe = recipes[Number(match[1])];
        if (!recipe) return null;
        const meal = meals.findIndex((m) => m.recipeId === recipe.id);
        if (meal < 0 || !dropMeal(meal)) recipes.splice(Number(match[1]), 1);
      } else if ((match = at(path, /^meals\[(\d+)\]/))) {
        if (!dropMeal(Number(match[1]))) return null;
      } else if ((match = at(path, /^items\[(\d+)\]/))) {
        const item = items[Number(match[1])];
        if (!item) return null;
        if (item.classification && error.reason === "classification")
          delete item.classification;
        else dropItem(Number(match[1]));
      } else if (
        error.reason === "recipe-reference" ||
        error.reason === "recipe-id"
      ) {
        return null;
      } else if (path === "offerUses" || error.reason === "offer-selection") {
        return null;
      } else return null;
    }
  }
  return null;
}

/** The note line that tells the shopper what an accepted partial reply left out. */
export function salvageNote(language: "fi" | "en", result: SalvageResult) {
  const names = [...new Set(result.omitted)].slice(0, 12);
  if (!names.length) return "";
  return language === "fi"
    ? `Tekoälyn vastaus oli osin virheellinen, joten nämä jäivät pois: ${names.join(", ")}. Pyydä ne tarvittaessa uudelleen.`
    : `Part of the AI reply was invalid, so these were left out: ${names.join(", ")}. Ask for them again if you need them.`;
}
