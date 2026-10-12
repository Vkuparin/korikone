/**
 * Words shoppers and retailers use for the same food. Only the listed whole words are
 * interchangeable: the cut ("fileesuikale", "jauheliha"), the unit and every other word of a
 * name must still match as written, so a synonym never turns strips into mince, a whole bird or
 * another animal. "Kananmuna" is one word and is not touched. Later sources of aliases, such as
 * confirmed receipt labels, add groups here; nothing is learned or written at run time.
 */
export const foodSynonyms: readonly {
  id: string;
  /** Every form read as this group in a product or ingredient name. */
  words: readonly string[];
  /** The one alternative search wording for each form a shopper may write. */
  queries: Readonly<Record<string, string>>;
}[] = [
  {
    id: "chicken",
    words: [
      "kana",
      "kanan",
      "broileri",
      "broilerin",
      "kananpoika",
      "kananpojan",
    ],
    queries: {
      kana: "broileri",
      kanan: "broilerin",
      broileri: "kana",
      broilerin: "kanan",
      kananpoika: "broileri",
      kananpojan: "broilerin",
    },
  },
];
const lower = (text: string) => text.toLocaleLowerCase("fi").normalize("NFC");
const group = (word: string) =>
  foodSynonyms.find((g) => g.words.includes(lower(word)));

/** The words with each synonym replaced by its group marker, and whether any was replaced. */
export function canonicalFoodWords(words: string[]) {
  let changed = false;
  const result = words.map((word) => {
    const found = group(word);
    if (!found) return word;
    changed = true;
    return `=${found.id}`;
  });
  return { words: result, changed };
}
/** The same name under the other common wording, or null when it has no synonym. One query. */
export function synonymQuery(name: string): string | null {
  let swapped = false;
  const query = name.replace(/\p{L}+/gu, (word) => {
    const other = group(word)?.queries[lower(word)];
    if (!other || swapped) return word;
    swapped = true;
    return word[0] === word[0].toLocaleUpperCase("fi") &&
      word[0] !== word[0].toLocaleLowerCase("fi")
      ? other[0].toLocaleUpperCase("fi") + other.slice(1)
      : other;
  });
  return swapped ? query : null;
}
// A cooked, smoked, marinated, seasoned, breaded or frozen product is a different purchase.
const states = [
  "kyps",
  "grill",
  "paistet",
  "savu",
  "marino",
  "maustet",
  "hunaj",
  "paneroi",
  "pakaste",
];
/**
 * Whether the product's preparation state is one the ingredient names too. Used when a product
 * matches only through a synonym, so the looser wording cannot also loosen the state.
 */
export function sameFoodState(productWords: string[], wantedWords: string[]) {
  const found = (words: string[]) =>
    states.filter((s) => words.some((w) => lower(w).startsWith(s)));
  const wanted = found(wantedWords);
  return found(productWords).every((s) => wanted.includes(s));
}
