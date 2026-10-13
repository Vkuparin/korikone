# Edit usability and retail expansion plan

Reviewed with the owner on 11 October 2026. This records product decisions and delivery boundaries; canonical cards/statuses remain in [task lists](tasks/README.md). The ignored local proposal was source material. No retailer account, application implementation or release state changed during this review.

## v0.8 scope

Keep F17's atomic edits, affected-only requoting and local undo, and U18's confirmed-chain accents/neutral dark. Add small contextual edit controls, truthful edit details and store/comparison/return usability. The owner chose to move recipe text-import UI F10.2 and QR export F12.1 from v0.10. Their IDs remain stable; completed F10.1 backend evidence stays in v0.10.

| Proposal | Decision | Canonical cards |
| --- | --- | --- |
| P-08-A row edit entry | Accept; preselect an exact row/meal in the existing composer | F17.9 |
| P-08-B1/B2 edit details | Accept; deterministic revision-bound delta, then collapsed UI | F17.10, F17.11 |
| P-08-C1/C2 usability closeout | Audit first; fix only reproduced gaps, separate lifecycle bugs from UI | U19.1–U19.4 |
| Move recipe import UI | Owner accepted v0.8; reuse reviewed draft and shared inference API | F10.2 |
| Move QR export | Owner accepted v0.8; text snapshot with explicit phone-save limitations | F12.1 |
| P-08-D future compatibility | Analysis only, unassigned and non-blocking for v0.8 | F22.1 |
| P-08-E1/E2 price history | Owner deferred; exact comparable observations, no savings promise | F25.1, F25.2 in Later |
| N1 K non-food | Owner chose before v1.0; separate capability-gated v0.11 | F22.2–F22.8 |
| N2 Prisma | Later, after K capability evidence; direct client by default | F23.1–F23.7 |
| N3 mixed retailer request | Later, after actual capabilities and allocation decision | F24.1–F24.4 |
| Android app | Owner requested feasibility research only | F26.1 in Later |

All new implementation cards are unassigned. Strong cards settle contracts and update dependent Simple cards with exact fields, files, APIs and fixtures. Do not widen or rewrite an actively claimed predecessor. Proposed paths are suggestions until that handoff lands.

v0.8 dependency order:

- F17.1 fixes stable targets; F17.2/F17.3 implement application/interpretation; F17.4/F17.5 establish quotes and undo; F17.6 supplies the composer UI. Existing F17.7/F17.8 evaluate those paths.
- F17.9 follows F17.1/F17.3/F17.6 and F15.15. Row action opens the same composer with an exact target; Update is still explicit. No second AI pipeline or chat transcript.
- F17.10 follows the engine/quotes/undo contracts; F17.11 follows that projection and F17.6. Failed/cancelled edits have no successful-edit delta. Undo is local and never claims to reverse retailer writes.
- U18 remains independent of F17. U19.1 can audit separately; UI and any proven lifecycle fix follow its handoff. U19.4 covers missing interaction cases and records evidence. If no lifecycle bug exists, U19.3 is Dropped with evidence.
- F10.2 depends on completed F10.1 and the F16.17 shared inference contract. F12.1 uses the existing local text export and needs no AI/provider dependency.

F17/U18, contextual edits/details, U19 audit closeout and the two moved features are v0.8 release scope. F22.1 research, price history and retail expansion do not gate it. Trust recorded focused coder checks; run one canonical full pre-release flow at release time.

## Store usability evidence

At review time GitHub issues [#6](https://github.com/Vkuparin/korikone/issues/6), [#7](https://github.com/Vkuparin/korikone/issues/7) and [#10](https://github.com/Vkuparin/korikone/issues/10) were open. Current source already has chain-card store controls in `src/ui/chains.tsx` and a retailer return cue in `main.tsx`. `shopping.tsx` imports `compareBlocker` but does not render it; comparison controls remain conditional on `canCompare`. This is source evidence, not an owner acceptance result.

U19 must reproduce missing behavior on the current main revision before changing it. Record already-fixed issue portions rather than recreating controls or opening duplicate issues. Compare unavailable states need an explanation and an action for the missing store/sign-in. Browsing comparison or another retailer never silently changes the active shopping context. Returning should retain the existing session/page where the retailer permits it; expiry must be reported honestly.

## QR use case and limitations

Show the existing list's plain text in a QR code for taking it to a phone without an account, server or mobile app. A scan yields text; it does not install Korikone, synchronize updates, create a retailer basket or automatically save a phone checklist. Scanner behavior varies: display/copy/share may let the user save to Notes or another app. Long lists use numbered codes and require more scans. Retain ordinary copy/save exports and explain the manual step.

Acceptance includes deterministic UTF-8 splitting/decoding and an owner phone check of scan, copy/share and save for short and long lists. Rendering a code alone cannot establish this use case. If phone usability is poor, return the concrete limitation to the PM rather than quietly introducing a hosted link or mobile sync service. Android research F26.1 explores better options separately.

## K-Ruoka non-food before stable release

The owner chose K-Ruoka non-food before v1.0 and Prisma later. Assign the gated K work to v0.11 and move beta F14 intact to v0.12; retain all completion evidence. v0.9 purchase learning and v0.10 calendar/offers/OCR keep their existing contracts. No non-food receipt line becomes a meal ingredient or automatic preference. Existing F6.20 regression scope covers this distinction; no duplicate receipt implementation card is needed.

Use the existing embedded K client and audited fallback, not a second integration or mandatory MCP fork. F22.2 establishes a capability-specific go/no-go. Discovery, exact variant selection and basket mutation are separate capabilities. A useful manual product-page handoff can be delivered when writes are unsupported. If reliable useful discovery itself is unsupported, record the no-go and ask the owner to defer the feature before beta. Do not let speculative work expand feature freeze.

Keep these facts distinct:

1. A chain sells a family somewhere.
2. The selected store lists a product.
3. The exact requested variant is evidenced as orderable there.
4. The authenticated basket can accept that variant using verified operations.

A no-hit in a small K-store is not chain-wide unavailability. Preserve the selected store and label not listed here, out of stock, availability unknown, unsupported search, failed search, signed out and stale context distinctly. Required size/specification stays unresolved until clarified; the model cannot fill it with guessed catalogue facts. Cheapest suitable uses the existing lowest total for enough packs among candidates meeting the requirements. Explicit constraints precede preferences and price; changes of required type/variant need consent.

No automatic store/chain switch or background multi-store comparison. Another-store discovery requires an explicit action and a proven scoped search method. Retain unknown pack/stock/price evidence and grocery g/ml/pcs behavior, backups and stable edit IDs. F22.1 records future extension needs without building a framework in v0.8.

## Prisma and separate baskets

Official [Prisma delivery guidance](https://www.prisma.fi/tuki/toimitustavat), checked on 11 October 2026, distinguishes pickup from store stock from warehouse-to-store delivery. Available methods vary by product and location; some supplier products cannot use store pickup. The [FAQ](https://www.prisma.fi/tuki/usein-kysytyt-kysymykset) is another source for the feasibility audit. These help pages do not establish a supported integration API, authenticated basket-write permission or shared grocery pickup.

F23.1 audits authorized access, terms/license, transport, rate limits, variants and fulfillment before implementation. Default to a direct local `PrismaClient`/provider and read-only discovery with explicit product-page handoff. A standalone MCP is unnecessary; consider a thin wrapper only when a real second consumer warrants a shared client. Authentication/session state and shopping policy must not be duplicated across transports.

Treat Prisma and S-kaupat as separate retailer identities, basket/review state and fulfillment operations. Shared group, login or building cannot prove a common checkout, collection time or counter. Basket writes require verified support and a separate owner scope decision; a no-go leaves discovery/manual handoff intact. Checkout, payment and slot booking remain manual.

F24 may later partition one request into independently reviewed baskets or manual handoffs using proven capabilities. Minimize extra trips and friction; nominal item prices alone cannot justify an extra order. State unknown fees/coverage explicitly, preserve independent failure/retry state, and never promise cross-basket rollback or an authoritative total from incomplete prices.

## Accounting and remaining decisions

Non-food is excluded from food budgets by default. Preserve real non-food purchase facts in receipt detail and actual-spending history; distinguish whole-receipt spending from comparable food-budget spending. Unknown allocation remains unknown. F8/F19 and F22/F24 handoffs must define any category scope explicitly instead of dropping purchases or inventing a food total.

Still to settle through the named Strong/owner gates: actual K non-food capability; detailed variant/compatibility schemas; Prisma access and optional basket authority; mixed-retailer allocation policy; Android architecture/sync scope; release assignment for Later work. These decisions block only dependent work. This plan authorizes no live account test, new cloud service, model download or application release.

## K-Ruoka non-food capability audit (F22.2)

Source and fixture review on 13 October 2026 of `src/stores/k-ruoka-site.ts`, `src/stores/k-ruoka.ts`, `src/stores/provider.ts`, the anonymised grocery response captured on 9 October 2026 (`tests/fixtures/k-ruoka/product-search.json`) and the K worker 0.1.3 tool list in [integrations.md](integrations.md). No live account, store search or basket call was made. "Observed" below means seen in that captured grocery response or fixed by the code; everything about non-food products themselves is unknown until an authorized live read.

| Capability | Observed | Unknown | Decision | Fallback |
| --- | --- | --- | --- | --- |
| Store-scoped discovery | The search request carries `storeId`; each product names its store and a different store is refused as `contextChanged`. The search needs no sign-in. | Whether a store's search returns non-food products at all, for which stores, and how complete it is. | Conditional go: the mapper is not grocery-specific, so whatever the store returns is shown for that store only. | Manual search on the store page. |
| Not listed here | An empty result for the selected store. The response also has `totalHits` and `hasGoodResults`, which the site client does not pass on. | Whether an empty result means not sold, not sold online, or a search miss. | Go for "not found at this store" as exactly that statement; never "not sold by the chain". | Another wording, or the store page. |
| Exact variant identity | `ean` and a Finnish name. `brand.name` exists in the response and is dropped by the client. | Whether size, colour or specifications arrive as fields for non-food products. None exist in the captured product. | No-go for structured variants. Go for a variant evidenced by its printed name and EAN: a size counts only when the name prints it. | Ask the shopper; show the candidates unchosen. |
| Price | `mobilescan.pricing.normal.price`, `unit`, `isApproximate`. A per-piece exact price is used; anything else stays unknown. | Member, campaign and delivery prices for non-food. | Go for the per-piece price as printed; unknown stays unknown. | Price shown as unknown. |
| Stock | `isAvailable` (true, false or absent) and `availability.store` / `availability.web`; only `isAvailable` is passed on. | What `isAvailable` means when the two availability flags differ, and how current it is. | Go with three values: available, not available, unknown. Go for passing on the store and web flags as evidence; no stock quantity is ever claimed. | "Availability unknown". |
| Pack and quantity | A count printed in the name (`4 kpl`) becomes the pack. A single item has no count in its name, so its pack is unknown today and the row waits for a confirmed pack size. `28 cm` is not a pack. | Nothing further. | Go for treating a product priced exactly per piece as one piece per unit when its name prints no count, in F22.5. | Existing pack confirmation. |
| Basket write | `ADD-ITEM` by EAN with a whole piece count and no substitutes, only for an EAN this session's search returned; `SET-ITEM-AMOUNT` for an existing item; read before and read back after. Nothing in the client is grocery-specific. | Whether the store's online basket accepts a non-food EAN, and whether pickup applies to it. | No-go for automatic writes until one authorized live write and read-back establishes it. F22.7 publishes the unsupported status and the manual handoff unless the owner authorizes that check. | Open the product or search on the store page. |
| Signed out, error, changed site, stale store | Basket reads fail with `loginRequired`; a failed or malformed search throws; a product of another store is `contextChanged`. | Nothing. | Go: each stays a distinct outcome. | Retry or sign in. |
| Worker fallback (k-ruoka-mcp 0.1.3) | The same seven product fields as the site client. | No variant, brand or availability split. | Keep only where the site client is unavailable; it adds no non-food capability. | The site client. |

Findings for F22.3 and F22.5:

- Three response fields are worth passing on because they are observed and cost nothing: `brand.name`, `availability.store` / `availability.web`, and the response's `totalHits`. Nothing else may be added without a captured response that shows it.
- Today a product that is in the shop but not orderable online (`availability.web` false, `isAvailable` true) is indistinguishable from an orderable one.
- A search for a size returns other sizes and unsized products: a returned product is never evidence that it is the requested variant. Matching must read the printed name.
- A single non-food item has an unknown pack today and would wait for pack confirmation.

Open live gate, for the owner to authorize or decline: three read-only searches in the selected K store (for example boots in a size, a frying pan, AA batteries) to see whether non-food products are returned and with which fields. No sign-in, basket call or AI request is needed for that read. A basket write check is separate and is not requested here.

Fixtures: `tests/fixtures/k-ruoka/non-food.ts` (synthetic, in the captured envelope) and `tests/k-ruoka-nonfood-audit.test.ts` (6): the fields carried and passed on, store binding and signed-out search, boots in sizes 31 and 32 with an unavailable colour and an unsized product, a missing size, a pan without a price and one without availability, batteries in two pack sizes and one not orderable online, an empty small store, a store error, a changed response shape, a stale store and the limits of a basket write.

## Merchandise contract (F22.3)

Implemented in `src/domain/merchandise.ts`, with additions to `src/domain/model.ts`, `src/stores/provider.ts` and `src/application/quotes.ts`. F22.1's compatibility review was not done as a separate card; its question is answered here: the F17 identities, operations and the row model need no change, only the optional field below.

**One row model.** A non-food request is an ordinary shopping row counted in pieces that also carries `merchandise` (`merchandiseIntentSchema`, optional on `ingredientSchema`). The row keeps its ID, its `id:unit` edit target, its amount, sources, undo snapshot and place in backups. Rows without the field, and every profile and backup made before v0.11, parse and behave exactly as before; grams, millilitres and pieces are untouched. A malformed intent in a backup is refused, not repaired.

**Intent.** `{ version: 1, family, attributes, missing }`:

- `family`: the kind of product in the shopper's words, in base form ("kumisaapas").
- `attributes`: up to six of `{ kind, value, provenance }` with `kind` one of `size`, `colour`, `model`, `material`, `spec` and `provenance` `explicit-note` or `clarified`. Every listed attribute is a hard requirement. Nothing a model assumed can be an attribute: the schema has no such provenance.
- `missing`: attribute kinds the family cannot be bought without and the shopper has not given. While any is listed the row is not searched or priced. A kind cannot be both given and missing, and each kind appears once.

**Product family versus exact variant.** `attributeEvidence(productName, attribute)` is `printed`, `conflict` or `absent`: a value counts only when the product's name prints it as whole words ("32" is not in "320"); another size after "koko" or another colour word is a conflict; silence proves nothing. `variantMatch(productName, intent)` is `exact` (every required attribute printed), `other` (one conflicts) or `unverified` (silent about one, contradicting none). Only `exact` may be chosen for a row.

**Statements.** `merchandiseStatus(intent, search)` turns one store search into one of nine values (`merchandiseStatusSchema`), and none may be shown as another:

| Status | Meaning |
| --- | --- |
| `exact-available` | The requested variant is listed at this store and reported available. |
| `variant-missing` | The family is listed here, but no listed product is evidenced as the variant. |
| `not-listed-here` | This store's search returned nothing of the family. It says nothing about other stores. |
| `out-of-stock` | The variant is listed and reported not available. |
| `unknown` | The variant is listed and the store did not say whether it is available. Never read as in stock. |
| `unsupported` | The provider cannot search non-food products. |
| `signed-out` | The operation needs a sign-in that is not there. |
| `failed` | The search failed; nothing is known. |
| `stale` | The answer belongs to another store or an older list and is not used. |

**Store evidence.** `Product.merchandise` (`merchandiseEvidenceSchema`, optional): `{ brand, inStore, online }`, each null when the store does not say. It is kept in saved quotes. There is no stock quantity.

**Capabilities.** `StoreProvider.capabilities.merchandise` (`merchandiseCapabilitiesSchema`, optional): `{ discovery, variants: "structured" | "name" | "none", stock: "flag" | "none", cartWrite }`. Absent means `noMerchandise`. Search results never imply write authority: `cartWrite` is true only where a basket write is verified for such products.

Fixtures: `tests/merchandise.test.ts` (5): schema strictness and versions, old profiles and backups, grocery rows unchanged beside a non-food row, edits and undo keeping the intent, name-only variant evidence, and one statement per store answer with unknown never read as in stock.

For F22.4: produce `merchandise` only from the shopper's words, list a required kind in `missing` instead of guessing, and never add attributes from a catalogue. For F22.5: set `Product.merchandise`, declare the K capabilities from the F22.2 audit, and reject non-`exact` variants in matching. For F22.6: show `merchandiseStatus` values with their own texts and ask for `missing` kinds.

## K-Ruoka non-food search and binding (F22.5)

Only what the F22.2 audit proved is used. There is no second client and the worker fallback gains nothing.

- **Fields.** `KRuokaSite` now passes on `brand` (from `brand.name`), `inStore` and `online` (from `availability.store` and `availability.web`), all optional. `KRuokaProvider` puts them on `Product.merchandise` when the store reported any of them. The worker fallback does not report them, so the field is then absent.
- **Capabilities.** `KRuokaProvider.capabilities.merchandise` is `{ discovery: true, variants: "name", stock: "flag", cartWrite: false }`. No other provider declares non-food support.
- **Search.** For a row with a merchandise intent, `candidateQueries` asks for the variant first (`"Kumisaapas 32"`) and then the family alone, inside the usual three reads per row; a failed read stays terminal. `searchCandidates` asks nothing while `missing` lists a required attribute, and nothing of a provider without `merchandise.discovery`. A product priced exactly per piece whose name prints no count is one piece per unit for such a row; a printed count (`4 kpl`) stays the pack.
- **Binding.** In `assess` (`src/domain/matching.ts`) a product is eligible for a non-food row only when `variantMatch` is `exact`: another size or colour is refused as `qualifier-conflict`, a product silent about a required attribute as `qualifier-unknown`. A product in the shop but not orderable online (`online === false`) needs the shopper's approval and is never chosen automatically; unknown availability, unknown price and unknown pack stay unknown and unchosen, as for groceries. Products are bound to the selected store as before, and changing the store drops the quote.
- **Statement.** `lineMerchandiseStatus(line, capabilities)` gives the F22.3 status of a quoted row: `unsupported` without discovery; otherwise from the products read, with a refused other or unproven variant counting as `variant-missing`. Null for a grocery row.
- **No write.** `Service.prepare` leaves non-food rows out of a transfer unless the provider declares `merchandise.cartWrite`. They are reported in `review.unresolved` like any row left out, and a list with only such rows has nothing to send (`unresolved`). Search results never grant write authority.

Fixtures: `tests/k-ruoka-nonfood.test.ts` (5) runs the real `KRuokaSite`, `KRuokaProvider` and `Service` over the synthetic store page: exact size chosen with its store evidence, other size, unsized product and sold-out colour not chosen, a pan with unknown availability not chosen over one that reports it, eight batteries as two packs of four and a not-orderable ten-pack left alone, a missing size, an empty small store, sold out, unknown, a store change, a missing required attribute and an unsupporting provider with zero reads, a store error, a changed response, a product of another store, and no basket write. `tests/k-ruoka-nonfood-audit.test.ts` is updated for the three passed-on fields.

For F22.6: read `lineMerchandiseStatus` for the row's statement, `requirement.merchandise.missing` for what to ask, and `product.merchandise` for brand and the shop/online evidence. For F22.7: `capabilities.merchandise.cartWrite` is the one switch; it stays false until a live write and read-back is authorized and passes. For F22.8: the development store stand-ins declare no non-food capability yet; add synthetic non-food products and the capability to `DemoProvider` for the K stand-in only.

## Non-food requests in planning and edits (F22.4)

Both existing tasks carry non-food requests; there is no new task, provider or call. Operation caps are unchanged: one planning interpretation with one repair, one edit request with one repair.

**Planning** (`src/ai/output.ts`, `src/ai/draft.ts`). A direct item may carry `merchandise` (the F22.3 intent); groceries have it null. The planning wire schema's items gain the field, and a reply from before it is still accepted. `validateDraft` checks each such item with `validatedMerchandise(item, note, path)`:

- the unit is pieces;
- the family is in the note (`namesSameFood`);
- every attribute has provenance `explicit-note`, its value is printed in the note as whole words (`printedIn`), and it holds no run of four or more digits;
- a kind the family needs (`requiredMerchandiseKinds`: a size for footwear and clothing) and the shopper did not give is moved to `missing`, whether or not the model listed it;
- no grocery category is put on the row.

Anything else is `DraftError` reason `merchandise` and follows the one-repair rule. The intent schema is strict, so a model cannot supply stock, a price, a product ID or a capability. A size after "koko" or "size" and a measure such as `28 cm` are not amounts (`withoutAttributeNumbers` in `src/domain/intents.ts`): the amount is the number of pieces, one with quantity provenance `assumed` when no count is written.

**Edits** (`src/domain/edits.ts`, `src/ai/edit.ts`).

- `setItem` and `addItem` by name accept an optional `merchandise` for a new row only; an existing row keeps what it is. The row must be counted in pieces.
- `setAttribute { rowKey, kind, value }` gives a non-food row one attribute the shopper stated, with provenance `clarified`, and removes that kind from `missing`. The row is searched again; nothing else is read. A row without a merchandise intent refuses it (`invalidEdit`). Undo restores the earlier intent.
- The edit context lists `merchandise: { attributes, missing }` on such rows so the interpreter can tell what is being answered. Wire fields: `merchandise` on new items and `attribute: { kind, value }` for `setAttribute`, both null otherwise; a reply from before them is still accepted.
- `validateEditIntent(raw, known, state, instruction)` takes the shopper's instruction as the only evidence: an attribute value or intent not printed in it, a value with four or more digits, or a `setAttribute` without a row target is invalid output.

**Choice.** Nothing about choosing changed: among products evidenced as the exact variant, the existing price basis picks the lowest sufficient-pack total, and `accept` cannot select another variant because it is not a candidate the matcher allows.

Development fixtures: `merchandiseFixture` in `src/ai/merchandise-fixtures.ts` reads rubber boots, a frying pan and batteries in Finnish and English for both the planning and the edit fixture. `tests/merchandise-inference.test.ts` (6) runs them through the real `Service`, K client and synthetic store: stated attributes in both languages with groceries unchanged and one request, a missing size asked and answered with `setAttribute` and undone, attributes, codes and retailer facts a model may not add, the repair limit and a quota error, and one edit adding two non-food items beside an untouched grocery row.

For F22.6: ask for `requirement.merchandise.missing[0]` and send the answer as an ordinary edit with the row as `focusTargetId`; the applied result is `{ op: "setAttribute", name, to: "size: 32" }`. Planning failures name `merchandise` in `planning.failureCause.reason`.
