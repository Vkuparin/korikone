/**
 * Layout failures confirmed by the B1.17 audit, by `<language>-<width>` and measured state.
 * Each entry is `<kind>: <parent> > <element>` as `layoutFindings` describes it, without its text.
 * B1.18 removes an entry when it fixes that failure; a state not listed must measure clean.
 *
 * 1. `crowded: article.interpretation > button.text.edit-with-instruction`: on a meal card
 *    "Muokkaa ohjeella" and "Poista" sit side by side with no gap and read as one link.
 * 2. `spill` / `broken-word: nav > button`: "Viikkosuunnitelma" runs 10 px out of its button at
 *    1024 px and is broken inside the word at 800 px.
 */
export const knownOverlaps: Record<string, Record<string, string[]>> = {
  "en-1024": {
    "shopping-list": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
    "row-details-0": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
    "row-details-5": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
    "row-details-10": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
    "edit-outcome": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
    "exports-qr": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
    "composer-unsent": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
    "composer-working": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
    "composer-cancelled": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
    "transfer-pressed": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
    "list-return": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
  },
  "fi-1024": {
    "shopping-empty": ["spill: nav > button"],
    "shopping-list": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
      "spill: nav > button",
    ],
    "row-details-0": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
      "spill: nav > button",
    ],
    "row-details-5": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
      "spill: nav > button",
    ],
    "row-details-10": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
      "spill: nav > button",
    ],
    "edit-outcome": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
      "spill: nav > button",
    ],
    "exports-qr": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
      "spill: nav > button",
    ],
    "composer-unsent": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
      "spill: nav > button",
    ],
    "composer-working": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
      "spill: nav > button",
    ],
    "composer-cancelled": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
      "spill: nav > button",
    ],
    "transfer-pressed": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
      "spill: nav > button",
    ],
    "list-return": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
      "spill: nav > button",
    ],
    "week-plan": ["spill: nav > button"],
    recipes: ["spill: nav > button"],
    history: ["spill: nav > button"],
    store: ["spill: nav > button"],
    "settings-general": ["spill: nav > button"],
    "settings-household": ["spill: nav > button"],
    "settings-stores": ["spill: nav > button"],
    "settings-ai": ["spill: nav > button"],
    "settings-data": ["spill: nav > button"],
    "settings-advanced": ["spill: nav > button"],
    "settings-about": ["spill: nav > button"],
  },
  "fi-1280": {
    "shopping-list": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
    "row-details-0": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
    "row-details-5": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
    "row-details-10": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
    "edit-outcome": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
    "exports-qr": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
    "composer-unsent": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
    "composer-working": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
    "composer-cancelled": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
    "transfer-pressed": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
    "list-return": [
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
  },
  "fi-800": {
    "shopping-empty": ["broken-word: nav > button"],
    "shopping-list": [
      "broken-word: nav > button",
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
    "row-details-0": [
      "broken-word: nav > button",
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
    "row-details-5": [
      "broken-word: nav > button",
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
    "row-details-10": [
      "broken-word: nav > button",
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
    "edit-outcome": [
      "broken-word: nav > button",
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
    "exports-qr": [
      "broken-word: nav > button",
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
    "composer-unsent": [
      "broken-word: nav > button",
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
    "composer-working": [
      "broken-word: nav > button",
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
    "composer-cancelled": [
      "broken-word: nav > button",
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
    "transfer-pressed": [
      "broken-word: nav > button",
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
    "list-return": [
      "broken-word: nav > button",
      "crowded: article.interpretation > button.text.edit-with-instruction",
    ],
    "week-plan": ["broken-word: nav > button"],
    recipes: ["broken-word: nav > button"],
    history: ["broken-word: nav > button"],
    store: ["broken-word: nav > button"],
    "settings-general": ["broken-word: nav > button"],
    "settings-household": ["broken-word: nav > button"],
    "settings-stores": ["broken-word: nav > button"],
    "settings-ai": ["broken-word: nav > button"],
    "settings-data": ["broken-word: nav > button"],
    "settings-advanced": ["broken-word: nav > button"],
    "settings-about": ["broken-word: nav > button"],
  },
};
