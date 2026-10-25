import { foodNameFacts } from "../domain/food-names";
import { noteQuantity } from "../domain/intents";
import type { Unit } from "../domain/model";
import {
  tidyName,
  validateDraft,
  type DraftValidationState,
  type MealDraft,
} from "./draft";

export const fallbackLimits = Object.freeze({ requests: 40, characters: 100 });

// One ordinary shop purchase when the note gives no amount; pricing shows the real pack.
const ordinary: Partial<Record<string, { amount: number; unit: Unit }>> = {
  milk: { amount: 1000, unit: "ml" },
  cream: { amount: 200, unit: "ml" },
  eggs: { amount: 10, unit: "pcs" },
  coffee: { amount: 500, unit: "g" },
  bread: { amount: 500, unit: "g" },
};
// Most packaged foods are sold by weight; these are sold by volume.
const drink =
  /mehu|juoma|limu|olut|siideri|vesi|jogurtti|viili|piimä|kefiiri|öljy|juice|drink|soda|water|yogh?urt/iu;
const quantityWords =
  /(?<![\p{L}])(?:\d+(?:[.,]\d+)?\s*(?:kg|g|ml|dl|cl|l|kpl|pcs|pkt|prk|pss|rs)?|kilo[a-z]*|litra[a-z]*|desilitra[a-z]*|grammaa?|kappaletta|litres?|liters?|grams?|kilograms?|millilitres?|milliliters?|pieces?|pack(?:s|et)?|pakettia?|purkkia?|pussia?)(?![\p{L}])/giu;

// A single word that is one of these foods in another case or in English becomes its base name.
const canonical: Record<string, [string, RegExp]> = {
  milk: ["Maito", /^(?:mait|milk)/iu],
  bread: ["Leipä", /^(?:leip|bread)/iu],
  eggs: ["Kananmuna", /^(?:kananmun|muna|munia|eggs?$)/iu],
  mince: ["Jauheliha", /^(?:jauhelih|mince)/iu],
  onion: ["Sipuli", /^(?:sipul|onions?$)/iu],
  rice: ["Riisi", /^(?:riis|rice$)/iu],
  cream: ["Kerma", /^(?:kerm|cream$)/iu],
  coffee: ["Kahvi", /^(?:kahv|coffee$)/iu],
};
const numberWords =
  /^(?:yksi|kaksi|kolme|neljä|viisi|kuusi|seitsemän|kahdeksan|yhdeksän|kymmenen|yksitoista|kaksitoista|puoli|puolitoista|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a|an)$/iu;
/** The phrase without its amount, as a search name: base form where it is safe to tell. */
export function searchName(phrase: string): string {
  const words = phrase
    .replace(quantityWords, " ")
    .split(/\s+/u)
    .filter((word) => word && !numberWords.test(word));
  if (!words.length) return "";
  const category = foodNameFacts(words.join(" ")).category;
  const base = category ? canonical[category] : undefined;
  if (base && words.length === 1 && base[1].test(words[0])) return base[0];
  // Finnish partitive after a vowel, as in maitoa, kahvia or perunaa: one letter less.
  const last = words.length - 1;
  if (/\p{L}{3}[aeiouyäö][aä]$/iu.test(words[last]))
    words[last] = words[last].slice(0, -1);
  return tidyName(words.join(" ")).slice(0, fallbackLimits.characters);
}
/** The note's own request phrases: one per line, comma, semicolon or "ja"/"and". */
export function notePhrases(note: string): string[] {
  const seen = new Set<string>();
  return note
    .split(/\r?\n|[,;]|\s+(?:ja|sekä|and|plus|\+)\s+/iu)
    .map((part) =>
      part
        .replace(/^\s*(?:[-*•–]+|\d+[.)])\s*/u, "")
        .replace(/[.!?:]+$/u, "")
        .trim(),
    )
    .filter((part) => {
      const key = part.toLocaleLowerCase("fi");
      if (!/\p{L}{2}/u.test(part) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, fallbackLimits.requests);
}

/**
 * B4.3: the last resort when interpretation gave nothing usable. Each request phrase of the note
 * becomes one plain product search, with the note's amount when it states one and otherwise one
 * ordinary purchase. No recipe, brand, product or price is invented, and nothing is marked as the
 * shopper's explicit choice. Returns null when the note has no request phrase.
 */
export function fallbackDraft(
  note: string,
  state: DraftValidationState & { language: "fi" | "en" },
): MealDraft | null {
  const items = notePhrases(note).flatMap((phrase, index) => {
    const name = searchName(phrase);
    if (!/\p{L}{2}/u.test(name)) return [];
    const stated = noteQuantity(phrase);
    const amount =
      stated ??
      ordinary[foodNameFacts(name).category ?? ""] ??
      (drink.test(name)
        ? { amount: 1000, unit: "ml" as const }
        : { amount: 400, unit: "g" as const });
    return [{ id: `fallback-${index}`, name, ...amount }];
  });
  if (!items.length) return null;
  const notes =
    state.language === "fi"
      ? "Tekoälyn vastausta ei voitu käyttää, joten pyyntösi lisättiin listalle sellaisinaan tuotehakuina. Määrät ovat arvioita. Tarkenna listaa muokkauksilla tai yritä uudelleen."
      : "The AI reply could not be used, so your requests were added to the list as plain product searches. Amounts are estimates. Refine the list with edits or try again.";
  return validateDraft(
    JSON.stringify({ recipes: [], meals: [], items, notes }),
    state,
    note,
  );
}
