# Receipt import without routine review

Accepted for v0.11.0 on 13 October 2026. Canonical cards are [F27.1–F27.12](tasks/0.11.0.md#f27-receipt-import-without-routine-review). Source material: the owner's local `scratch/korikone_frictionless_receipt_import_proposal.md`, reviewed against main `81bdf42`. The source's RUX IDs, scheduling advice and sample types are proposals, not agent instructions. The owner explicitly assigned this work to v0.11.0; retain its existing F22 non-food cards and the v0.12 beta boundary. F27.1 to F27.12 are implemented on the v0.11.0 work branch as of 13 October 2026, not merged or released; the cards record each commit and its checks, and [the evaluation](receipt-learning-evaluation.md#integration-audit-and-release-evidence-f2712) records the joined evidence and what is not covered.

## Scope and benefit

One drop or multi-file picker action saves supported receipts into purchase history. Optional, already-consented AI interpretation improves readable product names without asking users to approve each row. The benefit is usable purchase observations for later relevant shopping requests, such as "tavalliset aamupalat", with less clerical work. Import never modifies the current note, meals, products, active store, quote, transfer journal or retailer basket.

Reuse the existing local PDF/TXT/CSV reader, Finnish OCR, parsers, purchase ledger and provider-neutral enrichment seam. Full PDFs/images, headers, prices, totals, store identity and personal/payment/loyalty details stay local. This supersedes the review-first presentation, not the source-fact or privacy rules. Direct AI document upload and standalone photo/image intake discussed earlier are not included in this accepted proposal. Scanned PDF pages continue through the local OCR worker. No new OCR engine, provider, database or OAuth flow.

## Intake and feedback

- Put a small `Tuo kuitit / Import receipts` action in History beside purchase history, with a keyboard-accessible multi-file picker. Keep the main shopping composer central; no permanent receipt panel or large drop box there.
- Accept PDF/TXT/CSV drops over app-owned content. Show a temporary `Pudota kuitit / Drop receipts` overlay, clear it on leave/drop/cancel, and prevent browser navigation. Exclude embedded retailer surfaces; their pages cannot call receipt IPC.
- Main validates sender, file type/content, per-file size and batch bounds. Use an audited native file bridge or bounded file bytes staged privately, never arbitrary renderer-supplied filesystem paths. Clean temporary files on success, failure, cancellation and shutdown. The Strong intake owner publishes exact count/aggregate byte/time bounds and fixtures before UI handoff.
- Read files serially or with a justified small bound, without buffering all PDFs. Reuse 20 MiB/file, 100 PDF pages, 50000 characters and the 30-second worker deadline, including existing OCR raster/assets bounds. Each file commits independently; a corrupt file does not roll back successful files. Cancellation stops pending work and retains already committed purchases.
- Use one navigation-safe receipt activity surface with actual file counts and Reading, Saving, and Interpreting product names only when that stage runs. Local success appears before optional inference finishes. No estimated completion times, automatic Settings navigation or competing status panels for the same operation.
- Separate added, updated, duplicate, unsupported, failed and cancelled outcomes. Group results once, with View history and retry of failed files only. Duplicate-only input says already saved; name ambiguity says names remain general. Failed input names the affected file in the local UI without copying filenames or receipt contents into diagnostics.
- Import remains local when AI is unavailable or busy. It must not abort or invalidate unrelated planning/edit/transfer work. If another inference owns the connection, skip optional automatic enrichment with an honest unavailable/busy status; no hidden deferred request. Receipt cancellation targets only its operation. Sign-out or provider changes still obey the shared connection lifecycle.

## Consent and bounded inference

ChatGPT sign-in alone is not receipt-AI consent. Without matching provider/scope consent, save locally with zero provider requests. After the first successful import, offer one compact nonblocking invitation: Enable for future imports, Just this import, or Not now. The first two actions can interpret the just-imported eligible records in that same action; only Enable saves automatic permission. Declining suppresses repeated invitations for that provider/scope. Settings retains an accessible control and explicit per-receipt interpretation stays available.

Consent is checked at dispatch and commit. Provider/data-scope changes need fresh consent; changing only the task version does not authorize additional fields. Start v2 with the currently permitted sanitized descriptions and verified quantities. Any extra transmitted field, including separately supplied printed tokens or a chain hint, requires a versioned scope and renewed consent. No original receipt is sent to a model.

For a multi-file import or its consent action, use **at most one combined inference request for the entire action**, pinned to one provider/model. This clarifies the proposal's per-receipt wording and preserves the existing one-request-per-action product rule. Deduplicate equal sanitized label/quantity inputs and map opaque IDs back to every eligible source-bound line. Never merge purchase events because their labels match. Keep the 40-entry, 12000-request-character, 8000-output-character and 60-second inference limits. Omitted rows retain local names; no automatic chunks, repairs, retries, provider switches or later background calls. An explicit Improve names action is a new bounded action.

## Evidence, names and optional details

Separate original evidence, readable name, category/qualifiers, exact retailer identity and explicit household preferences. `VALIO JOG 1KG` can become `Valio jogurtti 1 kg`; it cannot establish a flavour or SKU. Brand/pack display tokens do not change purchased quantity, pack equivalence, dietary attributes or price. Model self-confidence is not evidence.

F27.1 separates factual issues from name specificity/model origin in the read model. A model interpretation alone is never counted as a row requiring review. F27.6 publishes the smallest additive, versioned annotation contract and display resolver. User correction wins; verified printed/retailer identity follows; then grounded expansion, generic interpretation and sanitized original fallback. A broad rule category may coexist with a richer model display name without promoting the model's category/qualifiers to verified facts. Do not bulk call `interpretPurchase` to disguise model output as user acceptance.

Build the v2 batch by need for a readable name, including abbreviated rule-classified lines, rather than only missing category annotations. Validate unsupported brand/flavour/variant/organic/dietary claims per row; preserve safe fallback and existing accounting. Unknown amounts, quantities, dates, discount allocations and source links remain unknown. Source revisions, corrections, deletion, cancellation and operation identity reject stale results.

History cards stay collapsed after routine import. Deliberately opened receipt details show readable names, optional original abbreviations, known quantities and paid amounts. Summarize general/raw-only names separately from factual/accounting issues. Original lines, reconciliation gap, OCR provenance/review notice, retention and deletion remain in optional details. Correct only the selected item inline, restore focus and retain the correction's source binding; no global preference is saved.

Sanitized evidence remains the default. The existing optional retained "original" is extracted source text, not an archived PDF binary; use accurate copy and preserve current backup/deletion semantics. Retaining original text requires explicit choice outside the normal one-action path. Do not add binary attachments or Undo recent import in this milestone. Existing explicit deletion remains available; a safe batch Undo would require a separate contract.

## Memory and later shopping

Keep one purchase ledger. Names make observations understandable but do not create exact historical SKUs, hard preferences, pantry stock or consumption estimates. Model-only evidence stays tentative, including when a rule supplied a category. Preserve recurrence thresholds, comparable-quantity rules and existing relevant-request context eligibility; do not silently broaden ordinary prompts to include receipt history. F27.10 must document whether each observation qualifies for context and why, preserving explicit preference precedence and exclusion rules.

On a later explicit shopping request, resolve against the selected store through the existing matcher and selected price basis. Import performs no catalogue reads or retailer writes and cannot switch stores. Non-food observations remain in history/accounting but do not enter food planning unless requested. Corrections, deleted interpretations/events and backup restore affect the next memory read. Verify a useful readable observation in a relevant request without implying that every imported model name is eligible for AI context.

## Evaluation and delivery

Phase A is F27.1–F27.5: remove review friction, add batch intake/drop and first-use consent. Phase B is F27.6–F27.11: grounded names and memory integration, with F27.7's independent expectations written before implementation tuning. F27.12 checks only missing integration boundaries and records the release handoff. Each card has focused fixtures; reuse passing coder evidence and run the full release flow once under AGENTS.md.

Gates: zero mandatory row actions/routine returning-user modals; one drop/picker action for durable local history; every product has a grounded name or raw fallback; no fabricated known money/quantity, invented retailer identity, unauthorized AI request, duplicate exact import or import-triggered retailer write. Measure exact-evidenced, expanded, generic and raw-only rates separately, with zero invented specificity on curated ambiguity fixtures. Counts are targets/evidence, not promises of perfect real-world recognition.

Use independently authored sanitized fixtures for abbreviated brands/packs, unknown yogurt flavour, milk qualifiers, bread, repeated labels, weighted produce, discounts/deposits, non-food, scanned/mixed PDF, capped batches, corrupt/password/oversize input, duplicate representations/distinct trips, stale correction/deletion, sign-out/quota and printed prompt injection. Exercise real IPC, worker, validation, persistence and relevant FI/EN keyboard/narrow/light/dark UI paths. No original owner receipts, live accounts or provider calls for routine tests. Any owner live acceptance is separately requested after fixtures pass with the number of calls stated.

## Proposal mapping

| Source ID | Canonical card                                                                              |
| --------- | ------------------------------------------------------------------------------------------- |
| RUX-S1    | F27.1 read model                                                                            |
| RUX-L1    | F27.2 optional receipt details                                                              |
| RUX-S2    | F27.3 batch intake and consent-operation contract                                           |
| RUX-L2    | F27.4 drop, picker and feedback                                                             |
| RUX-L3    | F27.5 first-use consent UI                                                                  |
| RUX-S3    | F27.6 grounded-name contract                                                                |
| RUX-S5    | F27.7 independent name fixtures and gates                                                   |
| RUX-L4    | F27.8 local names and batch eligibility                                                     |
| RUX-L5    | F27.9 provider-neutral task v2                                                              |
| RUX-S4    | F27.10 memory/context integration                                                           |
| RUX-L6    | F27.11 labels and counts across views                                                       |
| RUX-L7    | Focused UI checks within F27.2/F27.4/F27.5/F27.11; missing integration cases only in F27.12 |
| RUX-S6    | F27.12 integration audit: `tests/ui/receipt-integration.spec.ts` and the evaluation record   |
