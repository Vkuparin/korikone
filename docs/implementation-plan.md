# Korikone implementation plan

Revised 9 October 2026. The current work follows [design.md](design.md) and [ux.md](ux.md), based on the first feedback round. The [original CLI plan](archive/2026-10-07/implementation-plan.md) is historical.

## Current delivery stage

Prepare 0.2.0-alpha.1 for early Windows testing under [the pre-release scope](pre-release.md). Retain the current feature set, run automated and packaged-app checks, and publish an unsigned installer with known issues.

## First feedback implementation

| Area | Implementation | Verification |
| --- | --- | --- |
| Main workspace | Note, interpretation cards, compact shopping list, sidebar and Windows title-bar overlay | Desktop and narrow screenshots; UI flows |
| Live note | 1.8-second debounce, immediate shortcut, activity state, stale-response suppression | Delayed-response desktop fixture |
| Interpretation | Multiple dishes, ready foods and extras; collision remapping; ingredient identity reuse; one validation retry | Schema and service tests; live model quality still needs checking |
| Product choices | Automatic sufficient-pack cost selection; soft brand preferences; explicit overrides | Matcher/service tests; live catalogue limitations remain |
| List editing | Add recipes without days; quantity, home, removal and clear controls | Domain and desktop tests |
| Transfer | One review, explicit unresolved exclusions, durable writes and recovery | Demo journey and service tests; live writes remain pending |
| Reuse | Verified-transfer history and configured recurring-item suggestions | Service persistence and UI checks |
| Schedule | Upcoming dates populated from cooked meals, without changing requirements | Desktop test; saved/editable calendar deferred |
| Receipts | Local PDF/TXT/CSV extraction; worker timeout and limits; editable saved text | Synthetic PDF, malformed/textless PDF and text-import tests |
| Checkout | Default-browser URL, with possible separate retailer login | Live account continuity pending |

## Remaining acceptance work

1. Try a real multi-dish note including nakkikeitto, frozen pizza, breakfast and treats. Check inclusion, quantities and assumptions, including a note based on imported receipts.
2. Observe a small real K-Ruoka transfer and compare exact before/after quantities. Verify the default browser shows the same account's cart after login.
3. Test a wider variety of real PDFs and font encodings. The 0.2.0-alpha.1 installer is built; packaged PDF extraction and malformed-PDF handling passed automated checks.
4. Test a clean Windows installation and observe household use without coaching.
5. Measure whether the 1.8-second pause creates too many paid-plan inference requests; tune from evidence.

## Deferred product work

Automatic OCR for scanned receipts; frequency-based purchase learning; direct phone sync; embedded retailer sessions; a persistent editable meal calendar; and broader purchase-learning features. Do not imply these work in this pre-release. Checkout and payment are always performed by the user.

S-kaupat v1.1.0 is integrated and its offline contract tests are retained. Live login and a three-product account-list transfer passed on 9 October 2026. Authenticated handoff remains open in issue #3. The S-kaupat project retains its own [plan and release gates](s-kaupat-mcp-plan.md). It does not block this K-Ruoka feedback iteration. Keep dependency licensing, account protection, backup compatibility, language switching and journal recovery checks for future changes.
