import { initialState, type Recipe, type Unit } from "../domain/model";
import { mealFixtures } from "./meal-fixtures";
import type { EditContext } from "./edit";

type Row = EditContext["rows"][number];
type Meal = EditContext["meals"][number];

const numbers: Record<string, number> = {
  yksi: 1,
  yhden: 1,
  kaksi: 2,
  kahden: 2,
  kolme: 3,
  kolmen: 3,
  neljä: 4,
  neljän: 4,
  viisi: 5,
  kuusi: 6,
  kahdeksan: 8,
  kahdeksalle: 8,
  one: 1,
  a: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  eight: 8,
};
const number = `\\d+(?:[.,]\\d+)?|${Object.keys(numbers).join("|")}`;
const packWord =
  "tölkki\\p{L}*|purkki\\p{L}*|pakkaus\\p{L}*|paketti\\p{L}*|pussi\\p{L}*|cartons?|packs?|packages?|bags?|jars?";
const value = (token: string) =>
  numbers[token.toLowerCase()] ?? Number(token.replace(",", "."));
const english: Record<string, string> = {
  milk: "maito",
  coffee: "kahvi",
  bread: "leipä",
  potato: "peruna",
  potatoes: "peruna",
  carrot: "porkkana",
  carrots: "porkkana",
  cream: "kerma",
  egg: "kananmuna",
  eggs: "kananmuna",
  onion: "sipuli",
  onions: "sipuli",
  rice: "riisi",
  oats: "kaurahiutale",
  tomato: "tomaatti",
  mince: "jauheliha",
  sausage: "nakki",
  sausages: "nakki",
};
const ignored = new RegExp(
  `^(?:${number}|${packWord}|kg|g|ml|l|dl|kpl|pcs|lisää|add|poista|remove|delete|vaihda|korvaa|replace|swap|with|tuplaa|double|muuta|aseta|set|change|to|of|the|some|more|on|jo|ei|not|is|are|at|home|have|already|we|löytyy|löydy|kotoa|kotona|määrä|määräksi|hengelle|annosta|servings|people|for|tämä|se|this|it)$`,
  "iu",
);
const stem = (word: string) =>
  word.length >= 5 ? word.slice(0, Math.max(4, word.length - 2)) : word;
const words = (text: string) =>
  text
    .toLocaleLowerCase("fi")
    .split(/[^\p{L}\p{N}.,]+/u)
    .map((w) => w.replace(/^[.,]+|[.,]+$/g, ""))
    .filter((w) => w && !ignored.test(w))
    .map((w) => english[w] ?? w);
/** A word names a row when either contains the other's stem: "leipä" names "Ruisleipä", "maitotölkkiä" names "Maito". */
function mentions(clause: string, name: string): boolean {
  const target = name.toLocaleLowerCase("fi");
  return words(clause).some(
    (word) =>
      word.length >= 3 &&
      (target.includes(stem(word)) ||
        target
          .split(/[^\p{L}]+/u)
          .some((part) => part.length >= 4 && word.includes(stem(part)))),
  );
}
function quantity(clause: string) {
  const packs = clause.match(
    new RegExp(
      `(?<![\\p{L}\\p{N}])(${number})\\s+\\p{L}*?(?:${packWord})`,
      "iu",
    ),
  );
  if (packs)
    return {
      text: packs[0],
      quantity: { kind: "packs" as const, count: value(packs[1]) },
    };
  const amount = clause.match(
    /(?<![\p{L}\p{N}])(\d+(?:[.,]\d+)?)\s*(kg|g|ml|dl|l|kpl|pcs)(?![\p{L}\p{N}])/iu,
  );
  if (!amount) return null;
  const token = amount[2].toLowerCase();
  const unit: Unit = /kpl|pcs/.test(token)
    ? "pcs"
    : /ml|dl|l/.test(token)
      ? "ml"
      : "g";
  return {
    text: amount[0],
    quantity: {
      kind: "amount" as const,
      amount:
        value(amount[1]) *
        (token === "kg" || token === "l" ? 1000 : token === "dl" ? 100 : 1),
      unit,
    },
  };
}
/** Base forms of the groceries the fixture catalogue knows, so "kahvia" adds "Kahvi". */
const groceries: [RegExp, string][] = [
  [/maito|milk/i, "Maito"],
  [/kahvi|coffee/i, "Kahvi"],
  [/kananmun|eggs?/i, "Kananmuna"],
  [/jauheliha|mince/i, "Jauheliha"],
  [/sipuli|onions?/i, "Sipuli"],
  [/riisi|rice/i, "Riisi"],
  [/kerma|cream/i, "Ruokakerma"],
  [/banaan|bananas?/i, "Banaani"],
  [/pakastepizza|frozen pizza/i, "Pakastepizza"],
  [/jogurt|yoghurt/i, "Jogurtti"],
  [/suklaa|chocolate/i, "Suklaa"],
];
const defaults = initialState().recipes;
const catalogue: { pattern: RegExp; recipe: Recipe }[] = [
  ...mealFixtures,
  { pattern: /pasta/, recipe: defaults.find((r) => r.id === "pasta")! },
  { pattern: /keitto|soup/, recipe: defaults.find((r) => r.id === "soup")! },
  {
    pattern: /puuro|porridge/,
    recipe: defaults.find((r) => r.id === "porridge")!,
  },
];
const mealNamed = (clause: string, meal: Meal) =>
  mentions(clause, meal.name) ||
  catalogue.some(
    (entry) =>
      (entry.recipe.id === meal.recipeId || entry.recipe.name === meal.name) &&
      entry.pattern.test(clause),
  );

/**
 * Finite, rule-based development reply for the edit task. It reads only the supplied edit data and
 * returns ambiguity or unsupported for anything outside these fixed Finnish and English phrasings.
 */
export function editFixtureReply(data: EditContext) {
  const operations: Record<string, unknown>[] = [];
  const ambiguities: { phrase: string; candidates: string[] }[] = [];
  const unsupported: { phrase: string }[] = [];
  const used = new Set<string>();
  const one = <T extends { target: string }>(
    phrase: string,
    found: T[],
    apply: (target: T) => void,
  ) => {
    const free = found.filter((t) => !used.has(t.target));
    // The focused target settles "this" and a tie between similar rows.
    const chosen =
      free.length > 1 && data.focus
        ? free.filter((t) => t.target === data.focus)
        : free;
    if (chosen.length === 1) {
      used.add(chosen[0].target);
      apply(chosen[0]);
    } else if (free.length > 1)
      ambiguities.push({
        phrase,
        candidates: free.slice(0, 8).map((t) => t.target),
      });
    else unsupported.push({ phrase });
  };
  const focused = <T extends { target: string }>(clause: string, all: T[]) =>
    /(?<![\p{L}])(?:tämä|tämän|tätä|se|sen|sitä|this|it)(?![\p{L}])/iu.test(
      clause,
    )
      ? all.filter((t) => t.target === data.focus)
      : [];
  for (const raw of data.instruction.split(
    /(?<!\d)[,;.](?!\d)\s*|\s+(?:ja|and|sekä)\s+|\n+/iu,
  )) {
    const phrase = raw.trim();
    if (!phrase) continue;
    const clause = phrase.toLocaleLowerCase("fi");
    const rows = (text = clause): Row[] => {
      const named = data.rows.filter((row) => mentions(text, row.name));
      return named.length ? named : focused(clause, data.rows);
    };
    const meals = (text = clause): Meal[] => {
      const named = data.meals.filter((meal) => mealNamed(text, meal));
      return named.length ? named : focused(clause, data.meals);
    };
    const q = quantity(clause);
    const home = /kotoa|kotona|at home|already have/.test(clause);
    if (home) {
      const atHome = !/(?<![\p{L}])(?:ei|not|don't)(?![\p{L}])/iu.test(clause);
      one(phrase, rows(), (row) =>
        operations.push({ op: "markAtHome", target: row.target, atHome }),
      );
    } else if (/^(?:poista|remove|delete)(?![\p{L}])/iu.test(clause)) {
      one(phrase, rows(), (row) =>
        operations.push({ op: "removeItem", target: row.target }),
      );
    } else if (/^(?:vaihda|korvaa|replace|swap)(?![\p{L}])/iu.test(clause)) {
      // The dish to replace is named first; the replacement follows it.
      const parts = clause.split(/\s+/);
      const at = parts.findIndex((part) =>
        data.meals.some((meal) => mealNamed(part, meal)),
      );
      const replaced =
        at < 0
          ? focused(clause, data.meals)
          : data.meals.filter((meal) => mealNamed(parts[at], meal));
      const tail = parts.slice(at + 1).join(" ");
      const entry = catalogue.find((e) => e.pattern.test(tail));
      const saved = data.recipes.find(
        (r) =>
          (mentions(tail, r.name) || r.id === entry?.recipe.id) &&
          !replaced.some((meal) => meal.recipeId === r.id),
      );
      if (!saved && !entry) unsupported.push({ phrase });
      else
        one(phrase, replaced, (meal) =>
          operations.push({
            op: "replaceMeal",
            target: meal.target,
            ...(saved
              ? { recipeId: saved.id }
              : { recipe: structuredClone(entry!.recipe) }),
          }),
        );
    } else if (/tuplaa|kaksinkertaista|double/.test(clause)) {
      one(phrase, meals(), (meal) =>
        operations.push({
          op: "changeServings",
          target: meal.target,
          servings: meal.servings * 2,
        }),
      );
    } else if (
      new RegExp(
        `(${number})\\s+(?:hengelle|annosta|servings|people)`,
        "iu",
      ).test(clause)
    ) {
      const servings = value(
        clause.match(
          new RegExp(
            `(${number})\\s+(?:hengelle|annosta|servings|people)`,
            "iu",
          ),
        )![1],
      );
      one(phrase, meals(), (meal) =>
        operations.push({
          op: "changeServings",
          target: meal.target,
          servings,
        }),
      );
    } else if (/^(?:lisää|add)(?![\p{L}])/iu.test(clause)) {
      const text = q ? clause.replace(q.text.toLowerCase(), " ") : clause;
      // A grocery already on the list in another unit is a separate row, not an ambiguity.
      const found = rows(text).filter(
        (row) => q?.quantity.kind !== "amount" || row.unit === q.quantity.unit,
      );
      const typed = words(text).join(" ");
      const name =
        groceries.find(([pattern]) => pattern.test(typed))?.[1] ??
        typed.charAt(0).toLocaleUpperCase("fi") + typed.slice(1);
      if (!q || !typed) unsupported.push({ phrase });
      else if (found.length)
        one(phrase, found, (row) =>
          operations.push({
            op: "addItem",
            target: row.target,
            quantity: q.quantity,
          }),
        );
      else
        operations.push({
          op: "addItem",
          name,
          quantity: q.quantity,
        });
    } else if (q) {
      // "kaksi maitotölkkiä" names the grocery inside the pack word, so only the count is removed.
      const rest =
        q.quantity.kind === "packs"
          ? clause.replace(
              new RegExp(`(?<![\p{L}\p{N}])(?:${number})\s+`, "iu"),
              " ",
            )
          : clause.replace(q.text.toLowerCase(), " ");
      one(phrase, rows(rest), (row) =>
        operations.push({
          op: "changeQuantity",
          target: row.target,
          quantity: q.quantity,
        }),
      );
    } else unsupported.push({ phrase });
  }
  return { version: 1, operations, ambiguities, unsupported };
}
