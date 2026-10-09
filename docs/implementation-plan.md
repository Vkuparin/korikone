# Korikone implementation plan

Revised 9 October 2026. The current work follows [design.md](design.md) and [ux.md](ux.md), based on the first feedback round. The [original CLI plan](archive/2026-10-07/implementation-plan.md) is historical.

## Current delivery stage

0.2.0-alpha.2 is published for early Windows testing under [the pre-release scope](pre-release.md). Keep the current feature boundaries. Continue acceptance preparation with development-mode fixtures; live ChatGPT requests and retailer-account tests require an explicit user request.

The current source iteration completes note-request cancellation and automates the original multi-dish example, debounce request counts, failure preservation and manual retry. Development fixtures cover these paths through the real application handlers. They do not establish live model quality.

## First feedback implementation

| Area | Implementation | Verification |
| --- | --- | --- |
| Main workspace | Note, interpretation cards, compact shopping list, sidebar and Windows title-bar overlay | Desktop and narrow screenshots; UI flows |
| Live note | 1.8-second debounce, immediate shortcut, activity state, cancellation, stale-response suppression | Delayed-response desktop fixture; request counts check that cancellation and failures do not automatically resubmit |
| Interpretation | Multiple dishes, ready foods and extras; collision remapping; ingredient identity reuse; one validation retry | Schema and service tests; live model quality still needs checking |
| Product choices | Automatic sufficient-pack cost selection; soft brand preferences; explicit overrides | Matcher/service tests; live catalogue limitations remain |
| List editing | Add recipes without days; quantity, home, removal and clear controls | Domain and desktop tests |
| Transfer | One review, explicit unresolved exclusions, durable writes and recovery | Demo journey and service tests; live writes remain pending |
| Reuse | Verified-transfer history and configured recurring-item suggestions | Service persistence and UI checks |
| Schedule | Upcoming dates populated from cooked meals, without changing requirements | Desktop test; saved/editable calendar deferred |
| Receipts | Local PDF/TXT/CSV extraction; worker timeout and limits; editable saved text | Synthetic PDF, malformed/textless PDF and text-import tests |
| Checkout | Default-browser URL, with possible separate retailer login | Live account continuity pending |

## Remaining acceptance work

Offline preparation is separate from the live checks below. The original nakkikeitto/kanapasta/ready-food/breakfast/treats example now has scripted fixtures and a desktop regression test. The synthetic PDF corpus covers Finnish WinAnsi text and euro signs in Helvetica and Courier, page order, and page/file limits. Keep real receipt files local and use them only when supplied for testing. These examples do not establish support for every receipt font or PDF producer.

1. Try a real multi-dish note including nakkikeitto, frozen pizza, breakfast and treats. Check inclusion, quantities and assumptions, including a note based on imported receipts.
2. Observe a small real K-Ruoka transfer and compare exact before/after quantities. Verify the default browser shows the same account's cart after login.
3. Test a wider variety of real PDFs and font encodings. The 0.2.0-alpha.2 installer is published; packaged PDF extraction and malformed-PDF handling passed automated checks.
4. Test a clean Windows installation and observe household use without coaching.
5. With an explicitly requested live session, measure whether the 1.8-second pause creates too many paid-plan inference requests. Offline fixture counts already check one request after a typing burst, no automatic retry after cancellation or a usage failure, and a single request for manual retry. Tune the pause from observed use rather than fixture response timing.

## Deferred product work

Automatic OCR for scanned receipts; frequency-based purchase learning; direct phone sync; embedded retailer sessions; a persistent editable meal calendar; and broader purchase-learning features. Do not imply these work in this pre-release. Checkout and payment are always performed by the user.

S-kaupat v1.2.0 is integrated and its offline contract tests are retained. Live login and a three-product account-list transfer passed on 9 October 2026. Authenticated handoff remains open in issue #3. The S-kaupat project retains its own [plan and release gates](s-kaupat-mcp-plan.md). It does not block this K-Ruoka feedback iteration. Keep dependency licensing, account protection, backup compatibility, language switching and journal recovery checks for future changes.
