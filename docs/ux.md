# Korikone user experience

Design specification, 8 October 2026. The primary user is comfortable with grocery websites and ChatGPT, but should not need to know about models, MCP, tokens or browser profiles.

## Visual direction

Use a quiet, contemporary grocery-planning workspace: warm off-white background, deep green actions, charcoal text, generous spacing and clear product photography where available. Reserve retailer colors for retailer labels. Avoid making a K-Ruoka basket look selected merely because an unrelated button is orange.

Proposed tokens: canvas `#F6F7F3`, surface `#FFFFFF`, text `#182C25`, secondary text `#52615A`, primary `#176348`, border `#DCE3DB`. Validate all final text/state combinations for accessible contrast. Use a system sans-serif with Finnish character support, 16px body text, tabular numbers for prices, 8px spacing increments and 12-16px card radii. Use restrained shadows and 120-180ms feedback transitions; honor reduced motion.

The interface should look designed even with missing product photos. Use stable image slots, useful text and neutral placeholders. Do not generate misleading product packaging. Dense item lists need aligned quantities and prices more than decorative cards.

## Navigation and layout

Primary navigation: `Viikko`, `Reseptit`, `Vakiotuotteet`, `Asetukset`. The active week opens directly on returning visits. Keep the current retailer and branch in a persistent header selector, with fulfillment mode nearby. The ChatGPT account/connection status lives in the account menu.

Wide windows use a main planning area and a basket summary at the right. Compact windows stack them with an accessible Plan/Basket switch and a sticky summary action. No horizontal scrolling for ordinary tasks at 200% zoom. Use at least 44px click targets for primary controls.

The assistant opens in a side panel within the desktop app when needed. Its suggestions become editable meal cards or proposed product choices; users never have to copy JSON out of chat. Closing the panel leaves the work visible.

## Language switching

Finnish is the first-launch default. A persistent selector labeled `Suomi / English` is available on welcome/sign-in screens and in the app header, including while an operation is running. Use language names, not flags. Switching takes effect immediately with no reload, confirmation dialog or loss of work. Save the choice for subsequent launches.

All application text changes together: navigation, controls, empty states, dialogs, errors, progress, notifications and screen-reader labels. Format numbers, euro prices and dates with the selected locale. Underlying amounts, dates and units remain unchanged. Keep typed form text intact through a switch and parse it using its original input context until committed.

Existing recipes, user messages and retailer product names are not auto-translated. Retailer login/checkout pages control their own language. Existing AI drafts remain as generated; the next request asks for explanations in the selected language. Product discovery may still use Finnish catalogue terms. Language switching never triggers fresh AI generation, a new basket or another cart transfer.

| Finnish | English |
|---|---|
| Viikko | Week |
| Reseptit | Recipes |
| Vakiotuotteet | Regular items |
| Asetukset | Settings |
| Vaihda tuote | Replace product |
| Siirrä ostoskoriin | Transfer to cart |
| Ostoskori päivitetty | Cart updated |
| Avaa kaupan ostoskori | Open store cart |

The Finnish copy elsewhere in this specification is the default-language example, not a Finnish-only scope. Review both complete translation catalogues with fluent readers before release.

## Installation and browser continuity

Target one user-facing app installation with bundled dependencies. S-kaupat feasibility chose a managed browser session, so no extension is needed: S-kaupat shows a small login window once and otherwise works from a minimised window. After a transfer, the S-kaupat handoff tells the user to open the "Korikone" list and press *Lisää kaikki ostoskoriin*. The original extension guidance follows in case a later decision revisits it. If required, guide installation and enablement with a clear ready state and recoverable missing/disabled/incompatible states. Users must not configure MCP, load unpacked extensions, select technical profile directories or copy cookies.

The user should log into the retailer normally and reach the same verified cart for checkout. Test first use, return visits, browser restart and expired sessions. A second login or a separate browser window may be acceptable only if the tested flow is understandable and reliable. Do not assume default-browser session reuse. No extension side panel is planned for v1.

## First use

1. Show what Korikone does with a sample weekly plan and `Kokeile esimerkkiä`. Explain that checkout happens in the grocery store.
2. Offer `Continue with ChatGPT` using approved branding. Explain eligibility and plan usage before redirecting. Follow the current approved localization rather than inventing a translated brand button. Offer manual planning when connection is unavailable.
3. Ask for household portions and dietary exclusions; allow skipping and later editing. Explain that preferences used in AI requests are sent to OpenAI.
4. Show K-Ruoka and S-kaupat as equally prominent retailer choices. Search for a branch by name/location, then choose pickup or delivery. Confirm with a short address to distinguish similarly named branches.
5. Defer grocery login until it is needed for account-specific prices or transfer. Open the retailer's login window and return a clear success/expiry state to the app.

The ChatGPT UI should show which account is active, when plan usage is enabled, and a discoverable usage-management action. Limit errors should lead to usage management or manual planning while retaining the draft. [OpenAI UI/UX guidelines](https://developers.openai.com/siwc/ui-ux-guidelines).

## Weekly planner

Heading: `Mitä tällä viikolla syödään?`. Beneath it, show the week dates, household portions and editable budget. The request field accepts an ordinary sentence. Offer `Käytä viime viikkoa` as a secondary shortcut.

Meal cards show day, dish, portions and recipe status. Direct controls support replacing a dish, changing portions, marking leftovers and deleting a meal. Recipe suggestions show quantities before approval. Group new recipes and portion assumptions into one plan review; do not interrupt with a dialog for each dish. Keep the core journey centered on the week, shopping list and basket, with recipes and settings available when needed. Keep staples in a separate section with inclusion toggles and a short reason such as `Viimeksi ostettu 3 viikkoa sitten`.

Generation uses a clear stage label and cancel control. Do not manufacture progress percentages. Streamed text may be visible, but cards only become actionable when validated. An interrupted request says the draft was preserved and provides retry.

Pantry input is a simple "already have this" exclusion. Recurring staples can be included or skipped. Do not ask users to maintain stock levels or accept inferred consumption in the first release.

## Basket review

Show missing decisions first, then categories such as produce, chilled goods and pantry. Each product row includes:

- Product name and pack size, with image if available.
- Required amount, number of packs and bought amount.
- Line total and unit price; variable-weight items clearly marked as estimates.
- A concise reason: accepted product, cheapest accepted option, pinned favorite or user choice.
- `Vaihda tuote`, quantity adjustment and exclusion controls.

Let users mark requirements as strict (for example a required brand or no substitutions) or preferences as flexible (for example generic products allowed). Explain when a proposed alternative differs from a soft preference and collect its acceptance in review. Never trade away a hard requirement for a lower price.

Opening a replacement picker keeps the ingredient and required amount visible. Compare candidates by pack size, price, availability and dietary information. A cheaper product with unknown required dietary data is not silently acceptable.

Explain cheapest choices using the total cost of enough packs, with unit price and surplus alongside. For example, for a 500 g requirement, "500 g for EUR 2; the 1 kg alternative costs EUR 3" is more useful than claiming the larger pack saves money solely because its unit price is lower. No speculative waste score appears in the UI.

The summary distinguishes goods, deposits, known fees and unknown fees. Example data must be labeled as sample data. Over-budget state offers edit budget or acknowledge the displayed overrun. Missing items cannot disappear into an optimistic total.

Collect unresolved choices into the basket review, then approve the displayed transfer batch once. Do not repeat confirmations for each approved line. A changed target or uncertain result still requires renewed review.

Before transfer, show the destination and exact cart changes: new lines, existing quantities and resulting quantities, plus retained unrelated items. Use `Siirrä ostoskoriin` for the final action. Never label it `Tilaa` or imply a purchase has occurred.

## Store switching

The selector first chooses the retailer, then branch and fulfillment. Switching before transfer preserves the meals and displays `Haetaan tuotteet valitusta kaupasta`. Existing retailer carts stay unchanged. Show a fresh total only after matching completes; old totals must be visibly stale while loading.

If products need attention, show how many and place those rows first. Keep branch names visible on basket revisions and recent runs. A partially transferred basket remains available under its original retailer with a recovery action. Do not merge those states into the newly selected basket.

## States that need complete designs

| State | What the user sees | Action |
|---|---|---|
| No ChatGPT connection | Manual planner and explanation of AI assistance | Connect or continue manually |
| Plan permission absent | Account connected, AI permission unavailable | Reconnect with permission |
| Usage exhausted | Draft retained; no further AI work | Manage usage or edit manually |
| Browser helper/extension unavailable or incompatible (if required) | Draft retained; retailer connection unavailable | Guided enable, reconnect or update |
| Store login expired | Work retained; transfer paused | Reconnect retailer |
| Store blocked/offline | Current data marked stale | Retry later or export list |
| Unknown/unavailable product | Ingredient remains in unresolved section | Choose replacement or explicitly omit |
| Existing cart items | Before/after quantity diff | Review resulting cart |
| Changed price/context | Previous approval invalidated | Review refreshed basket |
| Partial transfer | Verified, pending and uncertain lines separated | Check cart, then approve remaining changes |
| Transfer verified | `Ostoskori päivitetty` with verification time | `Avaa kaupan ostoskori` |
| Checkout handoff | Retailer window under human control | User pays there; later confirms purchase |

Do not hide actionable errors in transient toasts. State text stays with the affected item and announces changes to assistive technology. Technical details are available only through an optional diagnostics view.

## Accessibility and usability acceptance

Keyboard access covers every task, including meal reordering without drag gestures. Dialogs manage focus and restore it to their trigger. Inputs have labels, validation is associated with fields, prices have readable currency labels, and status never depends on color alone.

Use Finnish date/number conventions in Finnish and English conventions in English, with EUR as the currency and Finland as the shopping region. Preserve names containing accents and long Finnish compound words. Destructive local actions require a clear scope and offer undo where feasible. Do not offer undo for retailer writes unless a new reviewed compensating change is actually available.

Validate the prototype with non-technical participants before implementing the full flow. Ask them to connect, find a branch, reuse a week, replace an unavailable product, switch chains, review an existing cart and recover from interruption. Include switching languages before sign-in, mid-edit and during a partial-transfer recovery. Verify every UI label updates while data and work remain unchanged. Observe where they hesitate or misinterpret completion. The release target is independent task completion with no accidental purchases and no unexplained cart changes.
