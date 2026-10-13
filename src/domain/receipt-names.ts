import { z } from "zod";

/**
 * Readable names for receipt lines (F27.6). A display name is how a line is shown: it may spell
 * out what the shop abbreviated, and nothing more. It is separate from the line's category and
 * qualifiers, from any retailer product identity and from household preferences, and it never
 * changes a quantity, a price or what counts as the same grocery.
 */
export const DISPLAY_NAME_VERSION = 1;
export const displayNameLimits = Object.freeze({
  /** Characters of a display name, and of a model's proposal before validation. */
  characters: 80,
  proposalCharacters: 200,
  words: 12,
});
/**
 * exact: every word is printed on the receipt, apart from case and spacing. expanded: at least
 * one word spells out a printed abbreviation. A name that only says what kind of grocery the line
 * is has no tier here; it is the generic `name` of the semantic annotation.
 */
export const displayTierSchema = z.enum(["exact", "expanded"]);
export type DisplayTier = z.infer<typeof displayTierSchema>;
export const displayNameSchema = z
  .object({
    version: z.literal(DISPLAY_NAME_VERSION),
    name: z.string().min(2).max(displayNameLimits.characters),
    tier: displayTierSchema,
  })
  .strict();
export type DisplayNameEvidence = z.infer<typeof displayNameSchema>;

/**
 * Abbreviations a shop prints that are not a plain prefix of the word they stand for. A word that
 * is a prefix of its expansion ("JOG" for "jogurtti", "KEVYTM" for "kevytmaito") needs no entry.
 * Each entry is one printed token and the single word it may become. Add entries only from
 * reviewed receipt evidence; nothing is learned at run time.
 */
export const printedAbbreviations: Readonly<Record<string, string>> = {
  lton: "laktoositon",
  "l-ton": "laktoositon",
  rton: "rasvaton",
  "r-ton": "rasvaton",
  gton: "gluteeniton",
  "g-ton": "gluteeniton",
  tm: "täysmaito",
  km: "kevytmaito",
  rkl: "ruokalusikka",
  kpl: "kpl",
  pkt: "paketti",
  prk: "purkki",
  plo: "pullo",
  tlk: "tölkki",
  ps: "pussi",
};
/**
 * Words an abbreviation may be spelled out to. A printed token that is a prefix of exactly one of
 * these words stands for that word; a token that fits several ("RUISL" for ruisleipä and
 * ruislimppu, "KEVYTM" for kevytmaito and kevytmaitojuoma) proves none of them and is not
 * expanded. A word outside this list is never an expansion, however plausible. The list is
 * reviewed vocabulary, extended only together with independent fixtures (F27.7).
 */
export const expansionWords: readonly string[] = [
  "jogurtti",
  "kevytmaito",
  "kevytmaitojuoma",
  "täysmaito",
  "maitojuoma",
  "rasvaton",
  "laktoositon",
  "gluteeniton",
  "luomu",
  "piimä",
  "viili",
  "rahka",
  "raejuusto",
  "juusto",
  "juustoraaste",
  "kerma",
  "ruokakerma",
  "kuohukerma",
  "margariini",
  "kananmuna",
  "jauheliha",
  "broileri",
  "kalkkuna",
  "makkara",
  "kinkku",
  "leikkele",
  "tonnikala",
  "ruisleipä",
  "ruislimppu",
  "paahtoleipä",
  "sämpylä",
  "viipaloitu",
  "tomaatti",
  "kurkku",
  "peruna",
  "porkkana",
  "sipuli",
  "banaani",
  "omena",
  "appelsiini",
  "appelsiinimehu",
  "omenamehu",
  "kivennäisvesi",
  "virvoitusjuoma",
  "kahvi",
  "suodatinjauhatus",
  "vehnäjauho",
  "kaurahiutale",
  "makaroni",
  "spagetti",
  "tomaattimurska",
  "ketsuppi",
  "majoneesi",
  "rypsiöljy",
  "oliiviöljy",
  "suklaa",
  "suklaalevy",
  "keksi",
  "pakastepizza",
  "astianpesuaine",
  "pyykinpesuaine",
  "talouspaperi",
  "hammastahna",
  "alkaliparisto",
];
const lower = (text: string) => text.toLocaleLowerCase("fi").normalize("NFC");
const units = "kg|g|mg|l|dl|cl|ml|kpl|pkt|prk|plo|tlk|ps|%";
/** "1KG", "1,5 L", "6X33CL" and "200 G" as comparable pack tokens: "1kg", "1,5l", "6x33cl". */
const packs = (text: string) =>
  [
    ...lower(text).matchAll(
      new RegExp(
        `(\\d+(?:[.,]\\d+)?)(?:\\s?[x×]\\s?(\\d+(?:[.,]\\d+)?))?\\s?(${units})(?![\\p{L}])`,
        "gu",
      ),
    ),
  ].map((m) => `${m[1]}${m[2] ? `x${m[2]}` : ""}${m[3]}`.replace(/\./g, ","));
const withoutPacks = (text: string) =>
  lower(text).replace(
    new RegExp(
      `\\d+(?:[.,]\\d+)?(?:\\s?[x×]\\s?\\d+(?:[.,]\\d+)?)?\\s?(?:${units})(?![\\p{L}])`,
      "gu",
    ),
    " ",
  );
const tokens = (text: string) =>
  withoutPacks(text)
    .split(/[^\p{L}\p{N}-]+/u)
    .map((t) => t.replace(/^-+|-+$/g, ""))
    .filter(Boolean);

/**
 * Checks a proposed display name against the printed label it is for and returns it normalized
 * with its evidence tier, or null when any part of it is not on the receipt.
 *
 * Every word must be a printed word, or spell out one printed abbreviation: the printed token
 * (three letters or more) is a prefix of exactly one word in `expansionWords`, which is that word,
 * or `printedAbbreviations` maps the token to the word.
 * Each printed token supports at most one word. A pack size must be one the label prints, the
 * same number and unit. No other number, no link, and no word the label does not carry: so
 * "VALIO JOG 1KG" may become "Valio jogurtti 1 kg" and never a flavour, a brand or a product code
 * that is not printed.
 */
export function groundedDisplayName(
  label: string,
  proposal: unknown,
): DisplayNameEvidence | null {
  if (
    typeof proposal !== "string" ||
    proposal.length > displayNameLimits.proposalCharacters
  )
    return null;
  const name = proposal.normalize("NFC").trim().replace(/\s+/g, " ");
  if (
    name.length < 2 ||
    name.length > displayNameLimits.characters ||
    !/^[\p{L}\p{N}]/u.test(name) ||
    /https?|www\.|[<>{}\[\]\\|@#$^*=_~`]|\d{4,}/iu.test(name)
  )
    return null;
  // Pack sizes: each one named must be printed, the same number and unit.
  const printedPacks = packs(label);
  for (const pack of packs(name)) {
    const at = printedPacks.indexOf(pack);
    if (at < 0) return null;
    printedPacks.splice(at, 1);
  }
  const words = tokens(name);
  if (!words.length || words.length > displayNameLimits.words) return null;
  const printed = tokens(label);
  let expanded = false;
  for (const word of words) {
    // A bare number that is not part of a printed pack size is not evidence of anything.
    if (/^\d/.test(word)) {
      const at = printed.indexOf(word);
      if (at < 0) return null;
      printed.splice(at, 1);
      continue;
    }
    const exact = printed.indexOf(word);
    if (exact >= 0) {
      printed.splice(exact, 1);
      continue;
    }
    const short = printed.findIndex(
      (token) =>
        !/^\d/.test(token) &&
        (printedAbbreviations[token] === word ||
          // The token must fit this word and no other word it could stand for.
          (token.length >= 3 &&
            word.length > token.length &&
            word.startsWith(token) &&
            expansionWords.includes(word) &&
            expansionWords.filter((w) => w.startsWith(token)).length === 1)),
    );
    if (short < 0) return null;
    printed.splice(short, 1);
    expanded = true;
  }
  return displayNameSchema.parse({
    version: DISPLAY_NAME_VERSION,
    name,
    tier: expanded ? "expanded" : "exact",
  });
}

/**
 * Words a shop never prints in a product label. A label that carries one reads like an
 * instruction, not a product, so no readable name is made for it and it stays as printed.
 */
const instructionWords =
  /(?<![\p{L}])(?:ignore|previous|instructions?|system|prompt|assistant|answer|say|sano|vastaa|unohda|lisää|add|remove|poista|delete)(?![\p{L}])/iu;
const packToken = new RegExp(
  `^(\\d+(?:[.,]\\d+)?)(?:[x×](\\d+(?:[.,]\\d+)?))?(${units})$`,
  "iu",
);
const vowelOrCommonEnding = /[aeiouyäöånst]$/u;
/** Words in the reviewed list that the printed token is a proper prefix of. */
const completions = (token: string) =>
  expansionWords.filter((w) => w.length > token.length && w.startsWith(token));
/** A printed token that could be a cut-off word: letters only, three or more, no common ending. */
const cutOff = (token: string) =>
  token.length >= 3 &&
  /^\p{L}+$/u.test(token) &&
  !expansionWords.includes(token) &&
  !vowelOrCommonEnding.test(token);

/**
 * Whether a printed label carries an abbreviation that fits several words, so it proves none of
 * them. Such a line is not given a readable name locally and may be put to the model.
 */
export function hasAmbiguousAbbreviation(label: string): boolean {
  return tokens(label).some(
    (token) =>
      !(token in printedAbbreviations) &&
      cutOff(token) &&
      token.length >= 4 &&
      completions(token).length > 1,
  );
}

/**
 * The readable name a printed label supports without any model (F27.8), or null.
 *
 * It writes the label in ordinary case, puts a space inside pack sizes ("1KG" becomes "1 kg"),
 * and spells out a printed abbreviation only where `groundedDisplayName` allows it. A label that
 * reads like an instruction, carries an ambiguous abbreviation or shows nothing the vocabulary
 * recognizes (a reviewed word, or a pack size beside a word of four letters or more) gets no
 * name and keeps its printed label. The result always passes `groundedDisplayName` itself.
 */
export function localDisplayName(label: string): DisplayNameEvidence | null {
  if (instructionWords.test(label) || hasAmbiguousAbbreviation(label))
    return null;
  const chunks = label.normalize("NFC").trim().split(/\s+/).filter(Boolean);
  if (!chunks.length) return null;
  let anchored = false;
  let pack = false;
  let longWord = false;
  const out = chunks.map((chunk) => {
    const asPack = chunk.match(packToken);
    if (asPack) {
      pack = true;
      const unit = asPack[3].toLocaleLowerCase("fi");
      return `${asPack[1]}${asPack[2] ? ` x ${asPack[2]}` : ""}${unit === "%" ? "" : " "}${unit}`;
    }
    const word = lower(chunk);
    if (/^\p{L}+(?:-\p{L}+)*$/u.test(word) && word.length >= 4) longWord = true;
    const mapped = printedAbbreviations[word];
    if (mapped) {
      anchored = true;
      return mapped;
    }
    if (expansionWords.includes(word)) anchored = true;
    else if (cutOff(word)) {
      const only = completions(word);
      if (only.length === 1) {
        anchored = true;
        return only[0];
      }
    }
    // Keep the shopper-visible case of codes such as M10 or AA.
    return /\d/.test(chunk) ||
      (chunk.length <= 3 && chunk === chunk.toLocaleUpperCase("fi"))
      ? chunk
      : word;
  });
  if (!anchored && !(pack && longWord)) return null;
  const text = out
    .join(" ")
    .replace(/^\p{L}/u, (c) => c.toLocaleUpperCase("fi"));
  return groundedDisplayName(label, text);
}
