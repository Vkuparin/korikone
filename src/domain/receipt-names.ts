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
 * Every word must be a printed word, or spell out one printed abbreviation: the printed token is
 * a prefix of the word (three letters or more), or `printedAbbreviations` maps it to the word.
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
          (token.length >= 3 &&
            word.startsWith(token) &&
            word.length <= token.length + 14)),
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
