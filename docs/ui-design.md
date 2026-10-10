# Korikone 0.6.0 design contract

Proposal for U14.1, 10 October 2026. Owner accepted on 10 October 2026, provided palette colours remain replaceable CSS variables. This document specifies presentation of current behavior; it does not authorize staged previews, natural-language list edits or new product rules. The gallery remains a static proposal; implementation status and handoff contracts are stated below.

## Review artifacts

Open [the layout gallery](design/0.6.0/layouts.html) and choose Shopping or Settings, light or dark, and empty, populated, working, unresolved or exception. The selectors change local example content only. All figures are illustrative, not fresh retailer quotes. Annotations 1–6 identify the layout decisions.

The [capture manifest](design/0.6.0/screens/manifest.json) indexes 40 viewport screenshots: both pages, both palettes, 1280 × 800 and 800 × 600, and all five states. Narrow Shopping also has `-list.png` captures showing the lower list and action area. The initial view and lower view are the same scrolling workspace, not separate lists. Settings states demonstrate Data with no receipts, General with saved preferences, AI sign-in waiting, Stores failure and Advanced export failure. They are examples of existing states, not new workflow stages.

Reviewed local baseline: `test-results/redesign-desktop.png` and `redesign-narrow.png`, plus newly captured `baseline-shopping-1280.png`, `baseline-shopping-800.png` and `baseline-settings-800.png` in the screenshot directory. Current tiny secondary text and densely packed rows make quantities and exceptions hard to scan; the narrow screenshot also places the total before rows. The proposal increases readable text, makes row controls visible, and keeps the narrow total after the list.

Capture again after `npm run build` with `node docs/design/0.6.0/capture.mjs`. It launches the real Electron app using a fresh temporary `KORIKONE_TEST_DATA` directory, captures the baseline through real saves, then displays the local design HTML. It does not replace IPC handlers or contact accounts. All 40 proposals passed the horizontal-overflow check. Representative desktop, narrow and dark screenshots were inspected visually. This verifies the proposal only; implementation accessibility, startup flash and interaction checks remain with their cards.

## Composition and states

At 1280 × 800, use a 160 px app navigation rail, 24 px main inset, 24 px column gap and 390 px shopping-list column. The composer/interpretation column takes remaining width. Retain ShoppingContext store and fulfillment controls above the workspace. Calendar remains a separate app view. App status/update banners occupy normal flow within the main content width.

At widths of 900 px or less, stack composer, interpretation and list in that order. Use 20 px horizontal inset and 16 px vertical gaps. App navigation may become a compact horizontal strip; every existing view remains reachable through overflow or a labelled menu, including Calendar, Recipes, History and Store. The gallery omits those secondary navigation items on narrow screens to show spacing; implementation must retain them. Settings category navigation becomes a labelled native select. At 800 × 600 the page scrolls; every region need not fit in one frame.

The desktop list uses a flex column with a separately scrolling row region and a non-overlapping footer. Header and footer remain reachable; the row region receives the remaining height. On short windows where the footer/exception would leave no usable rows, switch to normal page flow. Never use an overlay footer covering keyboard focus. On narrow screens, rows and footer use normal flow; no sticky footer at the top of the list. Use scroll padding for any sticky region and `scrollIntoView({block: "nearest"})` only for explicit user navigation, not arriving results.

| State              | Composer/interpretation                                                      | List and action                                                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty              | Note guidance and manual entry; compact model selector                       | Empty explanation; no fabricated total or transfer                                                                                                                   |
| Populated          | Saved note, meal cards, manual recipes, explicit unapplied-note message      | Product name, needed quantity, pack count, known row cost; one total and normal U10 transfer                                                                         |
| Working            | Immediate real lifecycle status and usable Cancel; preserve typed text/focus | Saved list remains readable, prices labelled as previous update; existing busy guards disable writes                                                                 |
| Unresolved         | Retain interpreted meals, including long names                               | Text and warning colour identify missing candidate/pack/price; alternatives and pack confirmation beside row; incomplete subtotal; preserve existing approval guards |
| Exception/recovery | Preserve input and committed list                                            | ConfirmPanel shows batch decision or partial result beside the single total/action; preserve existing recovery and open-only retry, never repeat writes              |

Reserve one labelled provisional-results slot below the composer/status and above interpretation. U14.6 shows only current available lifecycle status. F16.13 later fills the slot with real validated events. Do not render an empty placeholder or fake preview in the shipping v0.6.0 UI. When future previews are selected, saved-list access is deliberate and labelled; only the selected committed state has an authoritative total/action. Do not show two competing full lists or totals.

Keep a stable current-list context slot near the composer for F17.6's persistent “Muokkaa nykyistä listaa” / “Edit current list” and “Uusi lista” / “New list”. Before F17.6, show current supported update/unapplied-note wording only. The design annotations describe the reservation; they are not product controls.

K-Ruoka action labels identify its cart; S-kaupat labels identify its shopping list. Preserve one-click normal transfer, grouped exception approval and open-only retry. The gallery's destination caption explains these variants and should not become redundant product text.

## Typography, spacing and tokens

Use the installed Segoe UI/system sans-serif stack. Base/control text: 16 px, 1.5 line height. Secondary text: 14 px, 1.5. Section headings: 20 px, 1.3. Main title: 28 px desktop and 24 px narrow, 1.25. Total: 26 px semibold with tabular numbers. Prices and quantities use tabular numbers. No product information below 14 px. Long names wrap; compact model selection may ellipsize but retains its full accessible label.

Spacing scale: 4, 8, 12, 16, 20, 24, 32 px. Cards use 20 px desktop / 16 px narrow padding, 12 px radius, 1 px border. Controls use 8 px radius and at least 36 px height. Row controls have visible labels or explicit accessible names. Focus ring: 3 px with 3 px offset. Selection uses border/background and text, never colour alone. Reduced motion disables decorative pulse/spinner animation while status text remains visible.

U14.2 will establish these `--kk-*` variables in `src/ui/style.css`, scoped to the Korikone renderer root. Avoid retailer style/script injection and avoid styling embedded WebContentsView content. Theme selection is separate U15 work.

| Variable          | Light     | Dark      | Use                                                                                 |
| ----------------- | --------- | --------- | ----------------------------------------------------------------------------------- |
| `--kk-bg`         | `#f3f6f3` | `#141c18` | App background                                                                      |
| `--kk-surface`    | `#ffffff` | `#1e2b23` | Cards, menus, dialogs, controls                                                     |
| `--kk-subtle`     | `#e8efe9` | `#293b30` | Selected navigation and status                                                      |
| `--kk-text`       | `#203b2e` | `#edf5ef` | Main text                                                                           |
| `--kk-muted`      | `#52665a` | `#b3c6b9` | Secondary text, never disabled opacity                                              |
| `--kk-border`     | `#b6c6bb` | `#607668` | Card borders; control boundaries need stronger border if contrast check requires it |
| `--kk-action`     | `#256343` | `#91d7ad` | Primary action / success foreground                                                 |
| `--kk-on-action`  | `#ffffff` | `#152b1e` | Text on primary action                                                              |
| `--kk-focus`      | `#126eab` | `#81c7fa` | Keyboard outline                                                                    |
| `--kk-success`    | `#256343` | `#91d7ad` | Confirmed success, paired with text                                                 |
| `--kk-warning`    | `#805000` | `#f3c778` | Unresolved and approval-required text                                               |
| `--kk-warning-bg` | `#fff1d3` | `#392f1c` | Warning surface                                                                     |
| `--kk-error`      | `#ae303b` | `#ffb3ba` | Failure text                                                                        |
| `--kk-error-bg`   | `#fff0f1` | `#3b2227` | Failure surface                                                                     |

U14.2 migrated all literal component colours in `src/ui/style.css` to these roles. `:root[data-theme="dark"]` selects the resolved dark palette; U15.2 supplies production mode selection. The preference is separate from palette values. Later palette changes edit the two variable blocks, without component changes. Added `--kk-control-border` (`#76877c` / `#82998b`) for input/menu boundaries, plus control/menu/footer shadow and pulse roles. Retailer WebContentsViews have separate styles and receive no injection.

The focused `tests/ui/palette.spec.ts` checks text on app/card/selected surfaces, primary actions, warning/error/success roles and keyboard outlines, plus actual list/menu computed styles. It captures real Shopping and Settings at both sizes in `design/0.6.0/screens/app-*.png`. Local fixtures generate the initial basket; palette changes and navigation add zero AI or catalogue requests. Layout and tiny row typography still belong to U14.3–U14.5.

| Contrast pair                  | Light   | Dark    |
| ------------------------------ | ------- | ------- |
| Main text / card               | 12.16:1 | 13.27:1 |
| Secondary text / card          | 6.16:1  | 8.21:1  |
| Primary action text / action   | 7.13:1  | 8.97:1  |
| Focus / card                   | 5.46:1  | 8.06:1  |
| Focus / app background         | 5.02:1  | 9.50:1  |
| Warning text / warning surface | 6.12:1  | 8.30:1  |
| Error text / error surface     | 5.78:1  | 8.59:1  |
| Control border / card          | 3.80:1  | 4.83:1  |

Ratios use sRGB relative luminance. Normal text passes ≥4.5:1; focus and control boundaries pass ≥3:1. Transparent controls were checked against app/card/selected parent surfaces. Disabled controls and at-home de-emphasis retain existing behavior; later keyboard/layout acceptance remains U14.7.

## Component boundaries for follow-up cards

| Card  | Existing files/symbols and presentation scope                                                                                                                                                                  |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U14.2 | `src/ui/style.css`: tokens and shared card/form/button/Choice/dialog surfaces; preserve handlers and renderer-only scope                                                                                       |
| U14.3 | `ShoppingWorkspace` in `src/ui/shopping.tsx`: title, `.note-box`, `.note-footer`, unapplied note; existing `ModelSelector` in `model.tsx` and ShoppingContext remain                                           |
| U14.4 | `ShoppingWorkspace` meal cards / `.grocery-row`, `RowDetails` in `details.tsx`, `i18n.ts`: wrap names, readable amounts/costs, visible corrections and keyboard names                                          |
| U14.5 | `.shopping-panel`, `.shopping-total`, `ConfirmPanel` in `confirm.tsx`: separate scroll region and footer, exception/recovery presentation; no transfer behavior changes                                        |
| U14.6 | `ShoppingWorkspace.update`, `working`, `requesting`, `cancelled`, `korikone:cancel-ai`: honest immediate status with existing generate/approveDraft boundary; no invented stage events                         |
| U15.1 | `AppState` schema/defaults in `src/domain/model.ts`, persistence/bootstrap boundary as needed; validated preference and synchronous `getAppearanceBootstrap`; exact U15.2 consumer/subscription contract below |
| U16.1 | Inventory and exact `SettingsProps`/`SettingsSectionProps` mounting, focus and draft contracts below; section extraction remains U16.2/U16.3                                                                   |

## Appearance boundary: U15.1 handoff

`src/domain/appearance.ts` exports `appearanceSchema`, `Appearance`, `ResolvedAppearance`, `AppearanceBootstrap` and pure `appearanceBootstrap(preference, systemDark)`. `stateSchema.appearance` in `src/domain/model.ts` defaults missing values to `system` and accepts only `system/light/dark`. Persist the preference, never the resolved colour. Existing SQLite and `Service.exportBackup/importBackup` carry it without a storage-version change.

`Service.setAppearance(input)` validates and serializes a preference-only write; it can run while planning is busy. `Service.save` excludes appearance-only changes from shopping revision invalidation. Quotes, comparison/approval, input and meals remain unchanged. Main exposes asynchronous `window.korikone.setAppearance(mode)` through real `app:setAppearance` IPC, bypassing the long-operation queue like language changes. Do not use `save`/`refreshAfterChange` for the Settings selector: the preference-only API guarantees zero generation, model-catalogue or product-catalogue calls.

Main loads the saved service state before constructing BrowserWindow. Its initial native background/titlebar resolve the saved preference against `nativeTheme.shouldUseDarkColors`. It registers synchronous read-only `app:appearanceBootstrap`, restricted to the primary app frame. Preload exposes `window.korikone.getAppearanceBootstrap(): AppearanceBootstrap`, a direct value with no Promise or async snapshot dependency. `src/ui/main.tsx` declares that signature. This is a narrow startup read, not permission for synchronous database or network IPC.

U15.2 implements the following exact consumer/subscription contract:

1. Add `public/appearance-bootstrap.js`, loaded by a classic blocking `<script src="./appearance-bootstrap.js"></script>` in `index.html` head before styles/app rendering. Read `window.korikone.getAppearanceBootstrap()` and immediately set root `data-appearance` to preference and `data-theme` to resolved. No async `load`, React effect, localStorage preference mirror or media-query fallback. Verify built HTML ordering, not just source ordering.
2. Add `src/ui/appearance.ts` exporting `applyAppearance(value: AppearanceBootstrap)` and `subscribeAppearance(): () => void`. `applyAppearance` sets those same root attributes. `subscribeAppearance` subscribes through preload, then reads the synchronous current value to close the subscription/read gap. Mount once in App; invoke returned cleanup on unmount.
3. Extend preload with `onAppearanceChange(callback: (value: AppearanceBootstrap) => void): () => void` on main channel `app:appearanceChanged`. Wrap the Electron event and pass only the value; cleanup removes precisely that listener. Add its window signature beside `getAppearanceBootstrap`.
4. Main uses one `nativeTheme` `updated` listener. Re-resolve only in System mode. On successful `setAppearance`, `save`, `importData` and development-profile changes, re-resolve the authoritative service preference too. Deduplicate by preference/resolved value; publish to primary app webContents only, and update native background/titlebar. Remove the native listener at shutdown. Never set `nativeTheme.themeSource` in production, because that changes retailer behavior; tests may set it as the external system-theme fixture.
5. The two palette blocks in `src/ui/style.css` are already available. Native background/titlebar values must match `--kk-bg`/`--kk-text` if later palettes change; name their mapping in main rather than scattering literal colours. No retailer CSS/script injection or store-window theme override.
6. On appearance events, update renderer `state.appearance` without replacing other fields. Older ordinary-operation snapshots must preserve the latest appearance, as they already preserve language. `setAppearance` and profile/backup restoration intentionally adopt their returned preference. Appearance changes must not unmount ShoppingWorkspace or clear `shopping-note`.

U15.1 evidence: focused persistence/bootstrap unit tests cover legacy defaults, all modes, SQLite restart, real backup round-trip, invalid save/setter/import values, and preserved priced list/approval/revision while busy. `tests/ui/appearance-contract.spec.ts` covers the synchronous real IPC value, saved dark native frame after restart, System resolution against deterministic nativeTheme changes and explicit override. Renderer first-frame colour, runtime subscription cleanup and owner startup-flash check remain U15.2; the boundary test does not claim those consumers exist yet.

U15.3 uses `setAppearance` with FI `Järjestelmä/Vaalea/Tumma` and EN `System/Light/Dark` and shows the current resolved System value. Its `tests/ui/settings.spec.ts` must cover keyboard selection, zero new generation/catalogue calls, restart and real backup restore, while preserving typed note/list and household drafts.

## Settings inventory

Read `src/ui/main.tsx` Settings block and its child components, plus current recurring-items page. One Settings page has seven categories. Each existing function must remain reachable. Row alternatives, quantity, pack confirmation, at-home and remove remain in Shopping, outside Advanced.

| Proposed section | Current control / state                                                                                         | Existing handler or source                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| General          | FI/EN language selector; Svenska remains disabled/unoffered                                                     | header `Choice`, `changeLanguage`, `setLanguage`; reuse one shared preference                                                     |
| General          | System/Light/Dark with resolved System indicator                                                                | `state.appearance`, `setAppearance`; U15.3 adds the selector                                                                      |
| Household        | Servings 1–100, budget decimal → cents, exclusions, exclusions help, Save                                       | household form in `main.tsx`, `save(AppState)`; retain native required/min/max validation                                         |
| Household        | Recurring-items explanation and edit entry                                                                      | `editStaples`, `setPage("staples")`; child page retains enable/edit/remove and add/save/cancel                                    |
| Household child  | Item name, amount, unit g/ml/pcs, cadence days 1–365, last-purchased date, enabled flag                         | staples page, `parseAmount`, `editingStapleId`; `duplicateStaple` and `invalidQuantity` errors                                    |
| Stores           | Demo provider selector, live selected-provider option, pickup/delivery selector disabled for live provider      | context `save`; currently under Advanced details but belongs to Stores                                                            |
| Stores           | Selected store, chain status and explanation, pick/repick, use remembered store                                 | `Chains`, `state.stores`, `state.context`; `call("save", state)`                                                                  |
| Stores           | Login, login check, waiting Cancel, S-kaupat logout                                                             | `loginStore`, `checkStoreLogin`, `cancelStoreLogin`, `logoutStore`; `storeLogins`, failed/waiting status                          |
| Stores           | Per-chain store picker query, minimum 2 characters, submit, no results, select result                           | `Chains` local `picking`/`searched`, `searchStores`, `save`                                                                       |
| Stores           | Legacy selected-provider store search and result buttons; K-Ruoka/S-kaupat explanatory status                   | Settings search form `searchStores`, `snapshot.storeResults`, context `save`; preserve until deliberate deduplication is assigned |
| ChatGPT and AI   | Connection/data-sharing explanation, connected/waiting/permission-missing/disconnected state, email, auth error | `snapshot.ai`, translated `authFailed` fallback                                                                                   |
| ChatGPT and AI   | Continue with ChatGPT, sign out, manage usage, waiting Cancel                                                   | `signInAI`, `signOutAI`, `usageAI`, `cancelAI`; retain waiting/busy disablement                                                   |
| ChatGPT and AI   | Model selector, unavailable selection, empty/failed catalogue, reload, Automatic explanation                    | `ModelSelector`, `modelsAI`, `setAIModel`; catalogue refresh is not generation                                                    |
| ChatGPT and AI   | Honest unavailable remaining allowance/reset time, latest rate-limit message                                    | `ai-allowance`, `aiRequestLimit`; do not infer remaining usage                                                                    |
| Data             | Receipt import PDF/text/CSV, local extraction/OCR explanation, pasted receipt lines max 50000, Save             | `importReceipt`, `receiptText` form `save`; preserve draft on section changes                                                     |
| Data             | Local-data explanation, backup export and restore                                                               | `exportData`, `importData`; real local dialogs and validation                                                                     |
| Advanced         | Development checkbox and explanation                                                                            | `setDevelopmentMode`, `snapshot.developmentMode`; test-data mode rejects disabling at service boundary, UI must explain lock      |
| Advanced         | Restart setup, development scenario selector with all existing scenarios                                        | `setupComplete: false` save; `developmentScenario`; retain all current options without renaming protocol values                   |
| Advanced         | Export diagnostics                                                                                              | `exportDiagnostics`, moved from Data details; real local export                                                                   |
| About            | Runtime version / unavailable fallback                                                                          | `getAppInfo`, `appVersion`, `app-version` test id                                                                                 |
| About            | Notices/release entry                                                                                           | Preserve existing release-banner `openRelease`; U16.2 adds explicitly specified fixed-path `openNotices` boundary below           |
| Shared           | Global translated alert, busy status, Cancel; update/development/demo banners                                   | `error`, `busy`, `cancelTransfer`, `cancelAI`, `snapshot.update`; remain visible outside active section                           |

## Settings contract: U16.1 handoff

`src/ui/settings-contract.ts` is the settled shared type boundary. It exports `settingsSections` in order `general, household, stores, ai, data, advanced, about`, `SettingsSection`, `SettingsProps` and `SettingsSectionProps`. No Settings UI has been extracted by U16.1.

`SettingsProps` contains `visible`, `activeSection`, `onSectionChange`, `sections: Record<SettingsSection, ReactNode>` and `t`. App owns `settingsSection` state and the existing page state. `SettingsSectionProps` reuses `snapshot`, `busy`, `call`, `save`, `t`, `changeLanguage`, `editStaples`, `appVersion`, `aiRequestLimit` and `developmentLocked`; no second service/snapshot/preference store. `getAppInfo` now returns `{version, developmentLocked}` where the lock is the main process's actual `forcedDevelopment` flag. Keep the version-unavailable fallback; an information-read failure must not disable the real development-mode guard.

### U16.2 files, mounting and focus

Create `src/ui/settings.tsx` with named exports `Settings`, `GeneralSettings`, `HouseholdSettings`, `AboutSettings`, using the contract types. App constructs the seven section nodes and passes them to `Settings`. During U16.2, the four remaining sections are the actual current JSX blocks in `main.tsx` passed through `sections`; do not replace them with placeholders or temporarily hide functions. U16.3 extracts those nodes afterward. Retain the global header language `Choice`; General uses the same `changeLanguage` callback. General hosts U15.3's appearance selector when available.

Mount `Settings` once inside `.app-main` after onboarding, and keep it mounted while other main pages/recurring items are shown, with its outer wrapper `hidden={!visible}`. The shell lazily mounts a section on its first visit, then retains it with a native `hidden` attribute while inactive. Only the active section participates in layout, accessibility or Tab navigation. Explicit `[hidden] { display: none !important; }` protects against component display rules. Lazy mounting prevents hidden AI ModelSelector effects at startup. Never key the shell/section by language, snapshot revision or selected category.

Uncontrolled household fields, receipt textarea and store search query remain mounted so their drafts survive category/page changes and unrelated snapshot updates. Receipt form must lose the current `key={state.receiptText}` reset trigger during extraction. Track its committed baseline: update a field on import/restore only if its current value still equals that baseline; retain edited draft values and label them unapplied otherwise. The same baseline rule applies to household inputs on backup restore. Use refs or controlled draft values inside the section without forcing a shell remount. A successful household save commits its current draft; failed save keeps inputs and displays App's real error. Do not reset household drafts when language or appearance changes.

Desktop category control: a labelled `nav` with buttons using `aria-current="page"`; no tab roles requiring invented keyboard behavior. Narrow category control: labelled native `select`, with options for every category. Use `settingsGeneral`, `settingsHousehold`, `settingsStores`, `settingsAI`, `settingsData`, `settingsAdvanced`, `settingsAbout`, `settingsCategory` translation keys in `src/ui/i18n.ts`. Keep only the relevant navigation control visible at widths ≤900 px.

Each section has one `h2` with stable `id="settings-section-{section}"` and `tabIndex={-1}`. On a category change or explicit section entry, focus that heading after mount with `preventScroll`, then scroll nearest only when needed. Do not focus on status/snapshot/busy updates or language changes. Preserve the title “Asetukset” / “Settings” as the page `h1`. Header language menu behavior remains unchanged.

App adds `openSettings(section: SettingsSection = "general")`, which selects that section and sets page to Settings. Existing household chips call `openSettings("household")`. Recurring-items entry remains its current page and save handlers; its Back button calls `openSettings("household")`. Keep `editingStapleId` and its native form validation/error handling in App during this release. The recurring child page is outside the category shell and must not be unmounted by a preference event.

About retains `app-version` and runtime getter. Show a releases entry using existing `openRelease` only when `snapshot.update` exists, with current development suppression; do not imply an available update when none was found. Provide a local notices entry under U16.2 using named IPC `openNotices`: main resolves only `join(app.getAppPath(), "THIRD_PARTY_NOTICES.txt")`, verifies the local file, opens it via `shell.openPath` and returns the ordinary snapshot. Treat a nonempty shell error as `noticesUnavailable`; add FI/EN text. Preload adds only this named method. No renderer-supplied path/URL. This is an explicitly specified U16.2 boundary addition, not an existing handler. Development testing may stub the OS opener at this boundary, while reading the notices stays real and local.

### U16.3 section extraction

Create `src/ui/settings-sections.tsx` exporting `StoresSettings`, `AISettings`, `DataSettings`, `AdvancedSettings`, each using `SettingsSectionProps`. Replace App's four legacy section nodes with these components; leave App's `call`/`save`, polling, update/development/error banners and navigation ownership in place.

- `StoresSettings` retains the demo provider/fulfillment details, selected live store, both explanatory status paragraphs, `Chains`, legacy store search and results. `Chains` keeps its `picking`/`searched` state while its section is hidden. It continues real `searchStores`/`save`/login handlers. Do not deduplicate either search workflow in this extraction.
- `AISettings` retains connection status/email/error, sign-in/out, waiting cancellation, usage entry, `ModelSelector`, `ai-allowance`, rate-limit message and Automatic explanation. Its model catalogue fetch can run on first visit as it already does on Settings entry; never generate a list on navigation.
- `DataSettings` retains local receipt import/paste/save, max length 50000, extraction/OCR explanation, local-data explanation and actual export/restore dialogs. Apply the draft-baseline rule above; do not replace IPC for fixture coverage.
- `AdvancedSettings` retains all `aiScenarios` values from `src/ai/fixtures.ts` (use that list rather than maintaining a divergent copy), development mode/explanation, restart setup and diagnostics. Disable the checkbox when `busy || developmentLocked`; show FI/EN lock explanation. The real main handler still rejects disabling forced test mode. No future preference/resolver switches appear yet.

### U16.4 direct entries and fixture handoff

Use `openSettings("ai")` for Shopping's disconnected/model/permission/rate-limit paths and `openSettings("stores")` for store connection/context paths. `ShoppingWorkspace` currently has only generic `settings`; extend to `settings(section?: SettingsSection)` or named callbacks without changing unrelated handlers. Household count and recurring entries route to Household. Named diagnostics/development links route to Advanced. StorePage's Settings action routes to Stores. Global alerts stay visible outside the section; links are added only for relevant actionable errors, not every validation failure.

`tests/ui/settings.spec.ts` is the focused new navigation/draft/FI/EN/narrow/keyboard coverage file. Exercise real household save, receipt save/import failure and backup restore; test switching sections and returning from recurring items with unsaved values. Check zero new `developmentRequests` and product catalogue requests for category/preference changes, using a post-setup baseline count rather than assuming the example basket has zero requests. Model catalogue refresh remains separately counted and is not generation.

Retain affected cases from `tests/ui/settings-info.spec.ts`, `forms.spec.ts`, `chains.spec.ts`, `setup.spec.ts`, `models.spec.ts`, `backup.spec.ts` and `development.spec.ts`; run only affected files or named cases, not the full desktop suite. Use existing delayed/failed AI model fixtures, real service forced-mode rejection and local file dialog selection. `exportDiagnostics` keeps its actual local preview/export. Ordinary row corrections remain in Shopping, outside Advanced. U14.7 covers final combined owner visual acceptance.

## Owner review gate

Owner accepted the proposed hierarchy, green palettes, narrow stacking and Settings navigation on 10 October 2026. Palette colours must remain replaceable semantic CSS variables, allowing later palette changes without component edits. U14.2/U15.1/U16.1 may proceed. This gate comes from U14.1's explicit “Done when owner accepts layouts” requirement and the roadmap's detailed-layout decision. The broad implementation request permits preparing these artifacts; it does not silently close the named visual decision.

Remaining implementation checks: FI/EN labels and long names; current validation/persistence/UI fixtures; both palettes and keyboard/reduced motion; System startup without flash; retained transfer/cancellation/recovery behavior. Visual acceptance uses development mode and zero ChatGPT/store requests. No live check is needed for this layout proposal.

U14.3 implemented the composer context/model/action rows with 16 px note/action text, 14 px help text, visible keyboard focus, and responsive spacing. Focused FI/EN checks cover explicit button and shortcut updates, model-menu focus return, retained store/fulfillment controls and no automatic generation. Combined owner visual acceptance remains U14.7.

U15.2 implements the blocking bootstrap and runtime subscription. The built head orders the classic bootstrap before the module and stylesheet. Native colours use the named nativePalette mapping in main. subscribeAppearance accepts an optional callback for preference-only renderer state updates and returns preload cleanup. Local first-frame, override, System event, deduplication, cleanup and preserved-input checks pass; owner visual startup-flash acceptance remains.

U16.2 implements the retained Settings shell and General, Household and About. The four other sections still use their original App JSX through sections. Household drafts adopt restored values only when untouched and show an unsaved message otherwise. About opens the fixed bundled notices path through real IPC; tests stub only the OS opener. Focused FI/EN navigation/save/failure/retention checks and affected recipe/runtime-info checks pass. Owner combined visual acceptance remains U14.7.
