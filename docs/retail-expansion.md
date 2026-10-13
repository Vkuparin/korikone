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
