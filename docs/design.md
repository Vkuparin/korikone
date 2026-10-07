# Korikone design

Revised 8 October 2026. This replaces the CLI-first, single-store design. The [original documents](archive/2026-10-07/design.md) are retained for context.

Korikone turns a household's meal plan into a reviewed grocery basket at K-Ruoka or S-kaupat. People use an installed app, connect ChatGPT, choose their store, and approve the products before anything changes in their store cart. They complete checkout themselves.

## Product decisions

| Decision | Reason |
|---|---|
| Local desktop app, Windows first | Keeps sign-in and grocery sessions on the user's device and makes the current ChatGPT integration practical. No terminal, Docker, API key, or MCP configuration in onboarding. |
| Electron, React and TypeScript as the working default | Keep one main application language and avoid a planned framework rewrite. Reconsider Tauri only if a complete packaged prototype demonstrates a worthwhile benefit. |
| One user-facing installation as the target | Compare a dedicated browser session with a minimal extension during S-kaupat feasibility. Require an extension only if it demonstrably improves login, recovery and checkout handoff. |
| ChatGPT for assistance; deterministic code for shopping | AI interprets meal requests and drafts recipes. Code calculates quantities, prices and cart changes. |
| Both chains in the first complete release | Retailer and branch are explicit choices. A release with only catalogue access for S-kaupat must say so and remains a preview. |
| Reuse K-Ruoka integration conditionally; build s-kaupat-mcp as a separate project first | Reuse depends on packaging, license and behavior checks. S-kaupat cart access is an early feasibility gate. |
| Finnish by default, English selectable immediately | Language can change on any screen without reloading or losing work. |
| Structured screens with an optional conversation panel | A weekly planner and a readable basket are easier to inspect and correct than a chat transcript. |
| One local household per app profile | No cloud backend, shared household accounts or device sync in v1. Data is never keyed only by email. |

The [alternate-plan decision record](plan-review.md) explains the accepted changes and deferred ideas. These are proposed implementation choices, not claims that the integrations have been tested. See [integration research](integrations.md), [UX specification](ux.md), and [implementation plan](implementation-plan.md).

## Scope

The first complete release includes Finnish and English UI with immediate language switching, editable recipes, portions, dietary preferences, recurring staples, a weekly plan, product choices for both chains, a verified cart transfer, and manual checkout. Returning users should be able to reuse a week and review only the changes. Target a five-minute review for a familiar basket; measure this during the pilot rather than promising it.

Deferred: automatic cross-store price comparison, splitting one order between chains, pantry inventory, unattended runs, loyalty optimization, receipt extraction, shared households, native mobile apps, and a hosted service. There is no automated checkout or payment, now or later. An extension side panel, inferred pantry inventory and speculative waste scoring are also deferred. The initial experience centers on this week, the shopping list and the basket.

Desktop-first limits reach, especially for people who shop entirely on their phones. The interface adapts to narrow windows, but this does not make it a mobile app. A hosted/mobile version is a later product decision requiring a supported authentication and deployment route.

## ChatGPT connection

The linked cookbook describes local apps using an eligible ChatGPT Plus or Pro plan without user-managed API keys. Paid or remotely hosted offerings require requesting access. We therefore propose a free, open-source, locally running first release, subject to checking the terms and DevKit license before distribution. It is not safe to assume that website identity-only access is generally available. [Cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt), [quickstart](https://developers.openai.com/siwc/quickstart).

The local runtime owns the sign-in flow. Use the official DevKit behind an `AIProvider` boundary after validating and pinning it. The UI receives connection state, never tokens. Required behavior: persistent installation host ID; browser authorization with PKCE, state and nonce; save the issued client ID before code exchange; validate identity; check the actual granted plan-usage permission. Successful sign-in alone must not enable AI. [Registration guide](https://developers.openai.com/siwc/token-sharing-open-source/sign-in).

Store each connection separately using its verified identity and registration, with tokens protected by the operating system. Serialize token refresh and isolate active requests when accounts change. Signing out stops new AI requests; removing a connection deletes its local credentials. Local household deletion is a separate, explicit action. An additional ChatGPT account gets a separate app profile by default; sharing existing household data requires a deliberate local selection. [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions).

Discover available models for the selected account. Choose a tested compatible default; expose model choice in advanced settings. Inference uses the public Responses endpoint with OAuth credentials, `store: false`, `stream: true`, and succeeds only on `response.completed`. Partial text is a draft and cannot change recipes or baskets. [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).

Keep the necessary conversation context locally. The current preview does not support hosted MCP tools, HTTP continuation through `previous_response_id`, or several ordinary Responses parameters. Our application executes local store calls itself. Start with structured meal interpretation and validated JSON; only add function calls if needed and verified against the supported namespace contract. Keep the provider request builder separate from generic Responses examples. [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

Users can explore sample data, edit saved recipes and use manual shopping lists without connecting ChatGPT. Missing permission, an unavailable model, exhausted usage and expired login each have a distinct recovery action. Never switch to paid API billing automatically.

ChatGPT connection and grocery login are separate. Connecting ChatGPT neither signs into a retailer nor gives Korikone the user's ChatGPT conversation history. The app explains what meal and preference data it sends to OpenAI before the first AI request. [Quickstart](https://developers.openai.com/siwc/quickstart).

A small application-owned AI workflow is the initial implementation. Keep the provider boundary, but do not build multiple agent runtimes or schedule a later rewrite. Codex app-server remains an alternative only if a working comparison shows less total implementation and maintenance work. Grocery correctness and approval stay in application code regardless of runtime.

## Interface language

Finnish (`fi`) is the default on first launch, regardless of OS language. Offer `Suomi` and `English` in a persistent language selector available before sign-in and on every screen. Apply the selection immediately through the UI localization state, without reload, restart or sign-out. Persist it per local app profile; remember the pre-sign-in choice for initial profile setup.

Translate navigation, onboarding, forms, validation, dialogs, progress, errors, accessibility labels and notifications. Format dates, numbers and EUR amounts with the selected locale (`fi-FI` or `en-FI`), retaining Helsinki scheduling semantics and the stored numeric values. Preserve partially entered form values and validation state when switching, including decimal-comma input; do not reinterpret an in-progress quantity under a different locale.

A language change is presentation-only: it never alters meal quantities, provider search context, basket revisions, approval bindings or in-flight operations. Store stable error/progress codes and interpolate them in the active language, including for operations that started before the switch. Translate display labels rather than using translated strings as keys.

User-written recipes and prompts, retailer product names and legal/login pages retain their original language. New AI requests use the selected UI language for explanations unless the user asks otherwise; switching does not re-run or translate existing AI content. Keep Finnish catalogue queries independent of UI language. Follow approved OpenAI branding/localization for the sign-in control. See [UX details](ux.md).

## Weekly workflow

1. Choose a saved retailer, branch and pickup/delivery context. Show this selection throughout the run.
2. Type a request, reuse a week, or add meals directly. For example: "Four dinners for two adults and two children, one vegetarian meal, under 120 euros. We already have rice."
3. Review editable meal cards. Approve new recipes and portion assumptions together in the plan review, rather than one dialog per dish. Existing approved recipes remain stable until edited.
4. Build the ingredient list. Scale recipes, merge compatible units, add due staples and extras, then apply skips. Every line shows where it came from.
5. Match products for this store. Prefer previously accepted products; collect missing, ambiguous or unavailable choices in the basket review.
6. Review a priced basket. Resolve blocking items, acknowledge a budget overrun or raise the budget, and inspect the proposed changes to the current store cart.
7. Select "Siirrä ostoskoriin". Apply only the approved changes, then read back and verify the cart.
8. Open the retailer's cart in the authenticated store window. The user chooses or confirms fulfillment details and completes checkout manually.
9. Mark the run as ordered, or reconcile it with a supported order import. Filling a cart never counts as a purchase or advances staple cadence.

## Architecture

![Korikone architecture](architecture.svg)

```text
apps/desktop/src/
  main/                  Electron lifecycle and validated IPC
  domain/                Types, planner, matcher and basket diff
  application/           Workflow state, approval and recovery
  ai/                    ChatGPT sign-in, profiles and requests
  stores/                Contract, registry and two MCP adapters
  persistence/           SQLite migrations and operation journal
  ui/                    React components and fi/en translations
fixtures/                Synthetic and sanitized provider responses
```

The tree starts with modules in one application workspace. Extract shared packages only when reuse or independent testing warrants it. These are not separately deployed services. The separate `s-kaupat-mcp` repository owns its retailer client, thin MCP server, fixtures, packaging and releases. Build and validate its first usable release before Korikone store integration. Korikone consumes its pinned stdio release just as it consumes the K-Ruoka server. Neither server knows about recipes or meal planning. See the [separate-project plan](s-kaupat-mcp-plan.md).

The renderer has no Node integration, shell access or generic tool execution. Main-process IPC validates requests and exposes named application operations. Store workers receive only the session access they need. Managed browser profiles, tokens and the SQLite database live in OS application-data directories outside the repository. If an extension is selected, grocery sessions remain in the chosen browser profile; the bridge binds commands to a verified account, branch and tab without exporting cookies.

The application coordinates reads and writes. AI can propose recipes or rank a bounded list of products; it cannot invent product IDs, prices, stock, nutrition or approval. It has no cart mutation, shell, navigation or checkout capability. Product descriptions and MCP output are untrusted data, never executable instructions.

## Browser access and checkout continuity

Before committing the S-kaupat client to a browser implementation, compare a dedicated managed session with a minimal extension using the shopper's normal browser session. The desktop shell and browser approach are independent decisions. Keep the same MCP and domain contracts for either approach; select one initial S-kaupat implementation rather than shipping both.

The comparison must cover installation on a clean machine, first and returning login, account/branch selection, cart writes, browser restart, interrupted operations and opening the same cart for manual checkout. Record required user interventions and recovery outcomes. A smaller download alone is not enough to justify an extra setup step. See the [S0 experiment](s-kaupat-mcp-plan.md).

If an extension wins, scope it to the supported retailer and fixed commands. No general JavaScript execution, unrelated browsing access, OpenAI credentials or second application UI. Package and register its native helper through the installer, guide extension enablement, and report connection failures in ordinary language. The independently usable S-kaupat project owns the required bridge and packaging; it must not depend on a running Korikone app.

K-Ruoka reuse remains conditional on its own installation and checkout tests. Do not rewrite a working upstream integration merely to share a transport. If the S-kaupat choice creates different setup flows across chains, test that combined onboarding before release and keep the difference out of the weekly shopping flow.

Users must reach the correct authenticated cart without choosing technical browser profiles, copying cookies or following developer instructions. Detach automation before manual checkout. An extension must stop dispatching commands for the handoff; a managed browser must remain open and usable after automation disconnects. Both are acceptance tests, not assumed capabilities.

## Store model and extension points

A retailer is not a branch. Prices and availability belong to a specific context:

```ts
type ProviderId = string; // registry IDs: "k-ruoka", "s-kaupat", future IDs

type StoreContext = {
  providerId: ProviderId;
  storeId: string;
  connectionId: string;
  fulfillment: "pickup" | "delivery";
  slotId?: string;
};

type Capabilities = {
  catalogue: boolean;
  authenticatedCart: boolean;
  exactQuantity: boolean;
  removeLine: boolean;
  orderHistory: boolean;
  personalOffers: boolean;
  substitutionSettings: boolean;
};

interface StoreProvider {
  capabilities(context?: StoreContext): Promise<Capabilities>;
  searchStores(query: string): Promise<StoreSummary[]>;
  authStatus(connectionId: string): Promise<AuthState>;
  startLogin(connectionId: string): Promise<LoginAttempt>;
  loginStatus(attemptId: string): Promise<AuthState>;
  cancelLogin(attemptId: string): Promise<void>;
  searchProducts(context: StoreContext, query: string): Promise<Product[]>;
  getProducts(context: StoreContext, ids: string[]): Promise<Product[]>;
  getCart(context: StoreContext): Promise<CartSnapshot>;
  setLineQuantity(context: StoreContext, target: CartTarget): Promise<WriteReceipt>;
  removeLine(context: StoreContext, lineId: string): Promise<WriteReceipt>;
  openCartForUser(context: StoreContext): Promise<void>;
  // Optional extensions, called only when supported:
  orderHistory?(context: StoreContext, since: string): Promise<Order[]>;
  personalOffers?(context: StoreContext): Promise<Offer[]>;
}
```

This is a proposed domain contract, not an upstream MCP schema. Methods for unsupported capabilities return a typed `unsupported` result; an empty array must not disguise missing functionality. `getProducts` may use verified lookups internally, but must not fabricate a catalogue entry from an old search result. Register a provider with its display name, adapter factory, capabilities and contract fixtures. Avoid chain-specific conditionals in the planner or UI.

Product references use `(providerId, productId)`. Store observations also include branch, fulfillment context, applicable account/offer scope and observation time. GTIN/EAN is optional metadata, not a universal key. Cart line IDs are separate from product IDs. Preserve retailer-native quantity units and increments alongside normalized pack sizes. Missing stock or price is `unknown`, never zero or available by default.

Preferences distinguish hard requirements (for example a required dietary attribute, pinned brand or no substitutions) from soft preferences (for example a preferred brand with generic alternatives allowed). Filter hard requirements before ranking. A soft-preference alternative requires acceptance in the basket review before it becomes an accepted product; it is not a silent relaxation.

Accepted products are per ingredient and retailer, with branch overrides. A "pinned" preference at K-Ruoka is not silently transferred to a similarly named S-kaupat product. Dietary exclusions apply before price ranking. Missing allergen data remains unresolved; the app does not certify food safety.

### Switching stores

Keep recipes, ingredient requirements, budget and household preferences. Create a new basket revision for the new context; fetch fresh offers, match again, and show unresolved choices. Invalidate old transfer approvals. Never copy product IDs, personalized prices or cart line IDs between contexts.

Existing retailer carts remain untouched. A partially transferred run stays attached to its original context and has a visible recovery entry. Switching is disabled during an active write; stop, reconcile, then switch. Returning to a previous store revalidates its basket rather than reviving an old approval.

Both stores use the same screens. Capability labels explain differences such as "Shopping list only" or "Order history unavailable". A new provider may start with catalogue access without pretending to support cart transfer.

## Planning and pricing rules

Retain the original design's accepted-product policies: `pinned`, `cheapest` among acceptable products, and `ask`. Explain each product choice in ordinary language. Offer candidates for unfamiliar items rather than silently accepting an AI recommendation.

Recipes have numeric servings and quantities in grams, millilitres or pieces. Convert kg/l input deterministically; do not convert pieces to weight without an explicit ingredient conversion. Money uses integer cents and quantities use decimal-safe arithmetic. Choose enough packs to cover the need, respecting permitted sizes and purchase increments. Show required quantity, bought quantity and expected surplus.

For v1, `cheapest` means the lowest total purchase cost that covers the required amount among accepted, available products satisfying hard requirements and pack limits. For each candidate, round up to its purchase increment and calculate the line cost. Initially choose one candidate product per ingredient rather than solving mixed-pack combinations; break equal-cost ties by less surplus, then a stable product ID. Unit price remains visible for comparison, but does not determine the winner. For a 500 g requirement, an acceptable 500 g pack at EUR 2 wins over a 1 kg pack at EUR 3 even though the larger pack has a lower unit price. Do not claim global basket optimization. No inferred consumption or invented waste penalty is needed. Weight-priced produce, deposits, multibuy eligibility and loyalty conditions are explicit fields. Unsupported pricing rules are flagged for store review.

The estimate separates goods, deposits and known fees. Unknown delivery charges remain visible as unknown. Quote freshness has a provider-configurable expiry; recheck prices and availability before transfer. A changed total or product invalidates approval. Checkout prices remain authoritative.

Pantry handling is limited to explicit "already have this" exclusions and recurring staples. Do not infer authoritative stock levels or ask users to maintain inventory in v1.

Staples are due from confirmed purchases, not planned weeks or transferred carts. Start with user-set cadence; history import is optional. Users edit recipes and preferences in forms. YAML/JSON are import/export formats rather than required maintenance work.

## Cart transfer and recovery

Collect product decisions and the cart diff into one review. One transfer approval authorizes the displayed batch, not a series of repetitive per-item prompts. New uncertainty or a changed approved target still stops the operation for review.

A transfer is a recoverable operation, not an assumed atomic transaction:

1. Verify the retailer account and selected context. Refuse an anonymous or ambiguous cart.
2. Read the current cart, refresh product observations and calculate a diff. Preserve unrelated items by default. For overlapping products, show existing quantity, planned addition and resulting quantity. Never silently reduce an existing line.
3. Bind approval to the basket revision, context, account, baseline cart fingerprint and exact target quantities. Enforce quantity and budget guards in application code.
4. Lock writes per account/cart across app windows. Re-read the baseline before starting. A changed cart requires a new diff and approval.
5. Journal each intended operation before dispatch. Apply absolute quantities serially. Check the affected line after each write and the entire cart at the end.
6. If a write times out, re-read before deciding whether to retry. If state cannot be established, stop with an uncertain result. Never blindly replay an add operation.
7. On restart, reconcile unfinished operations against the real cart and offer a new reviewed diff for remaining changes. Cancel means stop future writes; it does not mean rollback.

External edits can still race with a provider that has no conditional-write API. Re-read frequently, detect conflicts and stop. Do not claim exactly-once guarantees or overwrite a changed line to force agreement. There is no automatic rollback: it could erase a user's edits.

Workflow states: `draft`, `planning`, `needs_review`, `ready`, `transferring`, `partially_transferred`, `verified`, `ordered`. Failed AI generation preserves the previous draft. A transfer is `verified` only when readback agrees with approved targets and retained baseline items. It is `ordered` only after purchase confirmation.

Neither the domain contract nor the app tool registry includes bulk cart clearing or checkout. The automated browser worker allows only login, catalogue and cart operations. The selected browser approach must provide a human-controlled store window or tab for checkout; automation detaches before handing control over. Proving that this uses the same authenticated cart is a release gate.

## Data and privacy

Use SQLite with versioned migrations and a pre-migration backup. Store households, recipes and revisions, ingredients, accepted products, staples, plans, store contexts, observations, basket revisions, cart snapshots, operation journals and confirmed orders. Unique run IDs support multiple runs in one week.

The secret store holds ChatGPT credentials separately from retailer browser sessions. Grocery passwords are entered only into the retailer's login page. Logs exclude cookies, tokens, addresses, full prompts and raw authenticated pages by default. Diagnostic export shows a preview and redacts sensitive fields. Keep synthetic fixtures in git; recorded fixtures need a redaction check.

Provide local data export/import and delete controls. Explain that meal and preference data used for AI leaves the device; grocery credentials do not go to OpenAI. Do not equate `store: false` with a blanket retention promise. Remote product images require a restricted loader, with no authenticated session headers and a placeholder on failure.

## Quality bar and limits

Keep the deployment small, but retain migrations, CI, packaging, signed release artifacts where supported, pinned dependencies and recoverable transfers. Non-technical users cannot repair a corrupt schema or manually install a browser runtime.

Store access remains unofficial until a retailer provides an agreement or supported interface. Stop on a challenge or access denial and offer manual shopping-list mode. A provider outage must not prevent recipe editing or export. Do not add challenge bypassing to meet a release date.

Open gates: current ChatGPT eligibility and DevKit redistribution; licenses and clean-machine packaging for upstream code; S-kaupat authenticated cart feasibility; delivery-slot effects on prices; weighted-item behavior; same-session checkout handoff; supported OS list. The [implementation plan](implementation-plan.md) turns these into explicit tests before release.

