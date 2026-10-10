# Compact shopping context

F16.5, 10 October 2026. `src/ai/context.ts` exports `buildCompactContext`, `relevantRecipes`, `contextOptionsSchema`, `observedSummarySchema`, `CompactContext` and size limits. The module imports domain schemas and Zod only. Authentication, models and inference transport stay outside it.

Ordinary `draftPrompt` now sends the submitted note, language, household servings/budget/exclusions, brand-selection preference and a subset of saved recipes. It never reads `state.receiptText`, calendar, history, transfer journals, assumptions, previous note or store/account fields. Imported receipt text remains available locally in Settings and backups.

`relevantRecipes` compares significant words in the requested note with recipe titles, including common Finnish compounds and final a/ä forms. This is bounded local candidate selection, not semantic interpretation. If no title matches, the recipe context is empty and the model can interpret the requested dish as a new recipe. The validator still checks actual saved/new IDs locally. Selection cannot prove complete understanding of arbitrary text; independent fixture coverage remains the acceptance measure.

At most 12 matching recipes are included. Each keeps ID, title, kind, servings and complete ingredient IDs/names/amounts/units. Cooking instructions stay local. Old explicit-note evidence is omitted and its provenance becomes recipe-inferred in the context copy; an earlier note span cannot establish what the new note requested. Model assumptions, remembered and observed metadata keep their distinctions. Original saved recipes are unchanged.

The serialized request plus context is limited to 24,000 JavaScript characters. Too many matching recipes or too much relevant ingredient data causes `contextTooLarge` before inference rather than silently dropping ingredients. The UI explains how to reduce the request. The note keeps its existing 10,000-character limit. Complete ingredient amounts are never cut to fit. Relevant recipe instructions and unrelated recipes are omitted before calculating the bound.

Saved category preferences are not implemented by this card. `contextOptionsSchema` accepts at most 20 caller-supplied classifications whose category/qualifiers have remembered provenance; it accepts no note spans or free-form memory text. F15.3 must supply only explicit Remember rules through its settled hard/soft API. The current app passes none and sends its existing brand preference. Do not treat a context option as evidence of consent or silently infer a new memory rule.

Future F18 observed summaries have an empty default and a maximum of 20 entries. Each is a validated observed classification plus an integer observation count from 1 to 1,000. Unknown keys, raw labels, transaction IDs, dates, payment/loyalty/account fields and source text are rejected. The schema uses the existing category-specific qualifier values. It is an extension boundary, not receipt ingestion, a habits engine or an explicit preference. No current application path produces these summaries.

All submitted note, recipe and exclusion strings are quoted JSON data. The prompt tells the model to ignore embedded instructions, avoid URL fetching/tool calls and treat observations as hints. This is instruction separation and data minimization; it does not certify arbitrary free text as safe or correct. The note and relevant ingredient/title text that the shopper explicitly submits can still contain their own personal information.

## Fixture and handoff evidence

`tests/ai-context.test.ts` verifies omitted private markers, a receipt getter that throws if read, recipe ingredients/exclusions/brand preference, JSON-quoted injection text, removed cooking text and stale source spans, bounded typed preference/observation inputs, large unrelated stores, oversized relevant input before inference, and saved recipe references. A 900-unrelated-recipe fixture produces fewer than 1,000 serialized characters while preserving its requested recipe ingredients.

The shared shopping evaluator now accepts `ShoppingCase.contextSetup` with optional household, recipes, receiptText and productPreference. It saves them through real `Service.save`. It records `contextCharacters`, and summaries record `maxContextCharacters`. Only compact-context capability is now supported; preferences/lifecycle/preview/edit/resolver markers remain unsupported. Independent milk/egg expectations still pass on both chains after context changes.

- F16.3 extends `contextCases` in the existing runner with these bounded setup fields. Keep note expectations independent of prompt/model output and measure context size alongside omissions/quantity/category errors.
- F16.7/F16.8 keep native-format schemas and validation outside this context module. A protocol capability never relaxes ingredient or provenance validation.
- F16.17 invokes the unchanged provider-neutral context through task prompts. ChatGPT remains the current selected/default adapter; the payload contract contains no provider/auth fields.
- F16.9 snapshots this context for the operation. Reuse its complete validated request/ingredients and bounds; do not read raw receipts during repair or resolver work.
- F15.3 adds its actual remembered-rule fields here after the owner policy lands; replace the provisional classification-only option with that shared type instead of creating a second rule store.
- F18 supplies validated summaries through this explicit input if assigned later. It must not pass arbitrary receipt labels through semantic fields.

Shopping and draft consent text now lists relevant recipes and household preferences, and states that raw receipts and unrelated history stay local. Development mode uses local fixtures with zero live provider or retailer requests.
