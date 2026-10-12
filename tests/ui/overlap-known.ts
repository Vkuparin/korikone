/**
 * Layout failures confirmed by the B1.17 audit, by `<language>-<width>` and measured state, each
 * `<kind>: <parent> > <element>` as `layoutFindings` describes it. B1.18 fixed both failures that
 * the audit confirmed, so every state must now measure clean; add an entry here only for a
 * confirmed failure that a later card is assigned to fix.
 *
 * Fixed in B1.18: the meal card's "Muokkaa ohjeella" and "Poista" now sit in a wrapping row with a
 * gap (`.meal-actions`), and the navigation rail is wide enough for "Viikkosuunnitelma" whole.
 */
export const knownOverlaps: Record<string, Record<string, string[]>> = {};
