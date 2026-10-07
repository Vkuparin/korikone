# Korikone — Design & Implementation Plan

> Alternate proposal retained for reference. The accepted direction is recorded in [plan-review.md](plan-review.md) and incorporated into [design.md](design.md) and [implementation-plan.md](implementation-plan.md). This proposal is not the implementation baseline; its original body is preserved below.

## 1. Product Goal

Korikone is a local-first grocery planning and basket-building application for non-technical users.

Its core purpose is to:

1. Let a household define a weekly meal plan in natural language.
2. Convert meals into normalized ingredient requirements.
3. Merge those requirements with household staples, pantry state, and preferences.
4. Search supported online grocery stores.
5. Choose suitable products using price, unit price, package size, brand preferences, and substitution rules.
6. Add the selected products to the user's real online shopping basket.
7. Let the user review the basket.
8. Hand final checkout back to the grocery store website.

The application should automate the tedious part of grocery shopping while deliberately keeping final purchasing authority with the user.

---

## 2. Product Principles

### 2.1 Consumer-first UX

The user should not need to know what any of the following are:

- MCP
- OAuth
- Responses API
- Codex
- Rust
- Tauri
- Native Messaging
- browser automation
- API keys
- local ports
- model context windows

The expected onboarding should be approximately:

1. Install Korikone.
2. Click **Continue with ChatGPT**.
3. Install/enable the Korikone browser extension.
4. Choose K-Ruoka and/or S-kaupat.
5. Log into the supermarket normally in the browser if needed.
6. Start planning meals.

### 2.2 Local-first trust model

Prefer keeping the following on the user's machine:

- household profile
- recurring staples
- meal history
- product preferences
- basket history
- grocery account session state
- Korikone configuration
- authorization policies

Only information required for model inference should be sent to the selected AI provider.

### 2.3 Grocery credentials stay in the browser

Korikone should not ask users for grocery-store usernames or passwords.

Prefer:

- user's normal Chrome/Edge browser
- user's existing supermarket session
- a narrowly scoped browser extension
- no extraction or storage of supermarket passwords
- no copying of authentication cookies into Korikone unless absolutely unavoidable

### 2.4 Human-controlled checkout

Korikone should be able to:

- search
- compare
- add
- remove
- change quantity
- inspect basket
- open checkout

Korikone should not initially be able to:

- submit the order
- enter payment details
- confirm a bank payment
- authorize a purchase autonomously

For v1, final checkout is performed manually on the store website.

---

# 3. Recommended Architecture

## 3.1 High-level structure

```text
                    ┌──────────────────────┐
                    │    ChatGPT / LLM     │
                    └──────────┬───────────┘
                               │
                        tool/function calls
                               │
                               ▼
                    ┌──────────────────────┐
                    │      Korikone Core       │
                    │                      │
                    │ OAuth                │
                    │ agent orchestration  │
                    │ household logic      │
                    │ policy engine        │
                    │ SQLite               │
                    │ MCP client           │
                    └──────────┬───────────┘
                               │
                              MCP
                               │
                               ▼
                    ┌──────────────────────┐
                    │   Korikone Store MCP     │
                    │                      │
                    │ K-Ruoka adapter      │
                    │ S-kaupat adapter     │
                    └──────────┬───────────┘
                               │
                     Native Messaging / IPC
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Browser Extension    │
                    │                      │
                    │ site-specific bridge │
                    └──────────┬───────────┘
                               │
                               ▼
                    User's normal browser
                     K-Ruoka / S-kaupat
```

Two frontends use the same Korikone Core:

```text
                     Korikone Core
                        │
             ┌──────────┴──────────┐
             │                     │
             ▼                     ▼
      Desktop application    Browser extension
      full experience        lightweight experience
```

---

# 4. Technology Stack

## 4.1 Desktop application

Recommended:

- **Tauri 2**
- **React**
- **TypeScript**
- **Vite**
- **Tailwind CSS**
- **shadcn/ui** or equivalent accessible component primitives
- **TanStack Query**
- **Zustand** or a similarly lightweight local UI state library

Why Tauri:

- lower idle resource use than Electron
- smaller binaries
- strong native/web boundary
- excellent fit for a local-first consumer app
- React/TypeScript frontend remains fully modern
- secure native core can own secrets and local policy

Electron remains a valid prototype option, but Tauri is preferred for a polished production client.

## 4.2 Browser extension

Recommended:

- **WXT**
- **React**
- **TypeScript**
- Manifest V3
- Chrome first
- Edge second
- Firefox later

The extension should request the narrowest possible permissions.

Target host permissions:

```text
https://www.k-ruoka.fi/*
https://www.s-kaupat.fi/*
```

Avoid broad permissions such as:

```text
<all_urls>
cookies
downloads
history
```

unless a real implementation requirement is discovered.

## 4.3 Native core

Recommended:

- **Rust**
- **SQLite**
- OS-native secure secret storage
- Tauri command interface
- Native Messaging host capability
- MCP client
- policy/approval layer
- model-provider abstraction

## 4.4 AI integration

Primary consumer path:

- **Sign in with ChatGPT**
- use the user's eligible ChatGPT plan
- no API key setup
- no separate billing flow

Optional advanced providers later:

- OpenAI API key
- Anthropic
- local OpenAI-compatible server
- Hermes Agent
- other MCP-capable runtimes

---

# 5. Agent Runtime Strategy

## 5.1 Recommended development strategy

Use a runtime abstraction from day one:

```ts
interface KorikoneAgent {
  startConversation(): Promise<string>;
  sendMessage(
    conversationId: string,
    message: string
  ): AsyncIterable<AgentEvent>;
  cancel(conversationId: string): Promise<void>;
}
```

Implementations:

```text
CodexAgent
NativeResponsesAgent
LocalAgent
```

### v1 recommendation

Use **Codex app-server** initially if it materially reduces implementation time.

Benefits:

- mature agent loop
- MCP support
- tool execution
- streaming
- conversation/thread handling
- cancellation
- approval flows
- compatibility with Sign in with ChatGPT

### production direction

Move toward a **Korikone-owned lightweight agent loop** once the workflow is stable.

Reason:

Korikone's domain is much narrower than a general coding agent.

The production agent only needs a constrained tool vocabulary such as:

```text
get_household
get_meal_plan
save_meal_plan
search_products
compare_products
get_cart
add_to_cart
remove_from_cart
set_quantity
get_delivery_slots
```

This improves:

- predictability
- safety
- startup time
- product ownership
- provider independence
- error handling
- observability

---

# 6. MCP Architecture

MCP should be the tool/plugin boundary.

Do not make the browser extension itself the MCP server.

Prefer:

```text
Korikone Core
   │
   │ MCP client
   ▼
Korikone-store-mcp
   │
   ▼
browser bridge
```

## 6.1 Korikone Store MCP

Initial tools:

```text
search_products
get_product
compare_products
get_cart
add_to_cart
remove_from_cart
set_quantity
get_store
get_delivery_slots
open_checkout
```

Intentionally absent:

```text
submit_order
confirm_purchase
enter_payment
```

## 6.2 Korikone as MCP server

Korikone should eventually expose a higher-level MCP interface of its own.

Possible tools:

```text
plan_week
get_weekly_menu
save_weekly_menu
build_shopping_list
optimize_basket
fill_basket
get_household_preferences
get_staples
```

This makes Korikone reusable from:

- Codex
- Claude Code
- Hermes Agent
- other desktop agents
- future local models

without coupling the core product to one AI provider.

---

# 7. Authentication Design

## 7.1 Sign in with ChatGPT

Authentication should be handled by Korikone Core.

Flow:

```text
Korikone UI
  │
  │ Continue with ChatGPT
  ▼
Korikone Core
  │
  ├─ generate PKCE
  ├─ start loopback callback listener
  └─ open system browser
         │
         ▼
     OpenAI login
         │
         ▼
127.0.0.1 callback
         │
         ▼
Korikone Core securely stores credentials
```

The browser extension should not own long-lived OpenAI credentials.

## 7.2 Grocery store authentication

The grocery store session remains in the user's normal browser.

Flow:

```text
Korikone
  │
  ▼
Browser extension
  │
  ▼
K-Ruoka / S-kaupat
  │
  ├─ already logged in → ready
  └─ not logged in → user logs in normally
```

Korikone should display state such as:

```text
K-Ruoka     Connected
S-kaupat    Sign in required
```

without exposing sensitive session details.

---

# 8. Browser Extension Responsibilities

The extension should be intentionally dumb.

Responsibilities:

- detect supported store pages
- detect login state
- read visible/store data required by adapters
- perform constrained product/cart actions
- relay results to the native host
- provide a lightweight side-panel experience

It should not:

- run a general-purpose AI agent
- store OpenAI tokens
- act as the primary application database
- perform checkout
- execute arbitrary model-generated JavaScript
- read unrelated websites

## 8.1 Possible extension commands

```ts
type StoreCommand =
  | { type: "searchProducts"; query: string }
  | { type: "getProduct"; productId: string }
  | { type: "getCart" }
  | { type: "addProduct"; productId: string; quantity: number }
  | { type: "removeProduct"; productId: string }
  | { type: "setQuantity"; productId: string; quantity: number }
  | { type: "getDeliverySlots" }
  | { type: "openCheckout" };
```

---

# 9. Store Adapter Strategy

Each store implements the same contract.

```ts
interface StoreAdapter {
  searchProducts(query: ProductQuery): Promise<Product[]>;
  getProduct(productId: string): Promise<Product>;
  getCart(): Promise<Cart>;
  addToCart(productId: string, quantity: number): Promise<void>;
  removeFromCart(productId: string): Promise<void>;
  setQuantity(productId: string, quantity: number): Promise<void>;
  getDeliverySlots(): Promise<DeliverySlot[]>;
  openCheckout(): Promise<void>;
}
```

Implement:

```text
KRuokaAdapter
SKaupatAdapter
```

The adapter may internally use either:

1. normal DOM/UI interactions, or
2. store network/API calls available from the authenticated browser session.

The rest of Korikone must not depend on which technique is used.

---

# 10. Grocery Planning Domain Model

## 10.1 Meal plan

```text
Week
 ├─ Monday
 │   ├─ breakfast
 │   ├─ lunch
 │   ├─ dinner
 │   └─ snacks
 ├─ Tuesday
 ...
```

Allow both structured input and natural language.

Example:

> Mon spaghetti bolognese, Tue salmon soup, Wed tacos. Kids need packed snacks Mon-Fri. We already have lots of potatoes and pasta.

## 10.2 Normalized ingredient requirement

Example:

```json
{
  "ingredient": "ground beef",
  "quantity": 1600,
  "unit": "g",
  "category": "meat",
  "constraints": {
    "maxFatPercent": 12
  }
}
```

## 10.3 Household product preferences

Example:

```yaml
milk:
  preferred_type: kevytmaito
  target_stock_l: 8
  restock_below_l: 3
  selection_strategy: cheapest
  substitution_allowed: true

ketchup:
  preferred_brands:
    - Felix
  generic_allowed: false

pasta:
  selection_strategy: cheapest_per_kg
  package_size:
    min_g: 500
    max_g: 1000
```

## 10.4 Staples

Track:

- minimum stock
- target stock
- estimated weekly use
- last known purchase quantity
- optional estimated current inventory

Do not attempt perfect pantry tracking in v1.

Use simple user-maintained or inferred state.

---

# 11. Product Selection Logic

The AI should not simply pick the cheapest sticker price.

Selection should use deterministic scoring after semantic filtering.

Suggested pipeline:

```text
correct product category
        ↓
hard dietary constraints
        ↓
household preference constraints
        ↓
acceptable package size
        ↓
brand/generic rules
        ↓
substitution policy
        ↓
unit price
        ↓
waste / excess inventory penalty
        ↓
absolute price
```

Example score:

```text
effective_score =
    normalized_unit_cost
  + excess_inventory_penalty
  + preference_penalty
  + substitution_penalty
  + waste_penalty
```

Use the model for semantic interpretation.

Use deterministic application logic for scoring when possible.

---

# 12. User Experience

## 12.1 Desktop app

Primary areas:

### Home

- upcoming week
- current basket status
- quick meal entry
- last shopping run
- "Build next week's basket"

### Week

Calendar-like weekly meal planner.

### Basket

Sections:

```text
Meals
Breakfast & snacks
Household staples
Optional extras
```

Show:

- chosen product
- quantity
- price
- unit price
- substituted product
- reason for selection
- estimated saving when useful

### Household

Configure:

- household size
- dietary preferences
- staple products
- brands
- package preferences
- substitution rules

### History

Show:

- previous baskets
- spend per week
- recurring purchases
- price changes
- inferred consumption

### Assistant

Natural-language interface for:

- changing meals
- exclusions
- "we have plenty of pasta"
- "don't buy cereal this week"
- "use vegetarian meals twice this week"

## 12.2 Browser extension

Use a side panel.

Example:

```text
Korikone

Next week's basket

✓ Salmon soup
✓ Tacos
✓ Lasagne

47 / 52 items added

Current basket
€121.32

[Continue filling]

[Review basket]
```

The extension is not the full settings/admin UI.

---

# 13. Safety Model

## 13.1 Capability policy

Example:

```text
search_products       AUTO
get_product           AUTO
get_cart              AUTO
add_to_cart           AUTO
set_quantity          AUTO
remove_from_cart      AUTO

clear_cart            CONFIRM
change_store          CONFIRM
open_checkout         USER ACTION

submit_order          NOT AVAILABLE
payment               NOT AVAILABLE
```

## 13.2 Independent verification

After basket filling:

1. read the cart again
2. compare actual cart vs planned basket
3. identify:
   - missing items
   - duplicate items
   - wrong quantity
   - price changes
   - unavailable products
4. only then report completion

Never trust an assumed successful click or network call.

## 13.3 Logging

Maintain local structured logs for:

- model decisions
- tool calls
- MCP calls
- store responses
- policy decisions
- basket diffs
- recoverable errors

Sensitive values must be redacted.

---

# 14. Suggested Repository Structure

```text
Korikone/
│
├─ apps/
│  ├─ desktop/
│  │  ├─ src/
│  │  └─ src-tauri/
│  │
│  └─ extension/
│     ├─ src/
│     └─ wxt.config.ts
│
├─ packages/
│  ├─ domain/
│  │  ├─ meals/
│  │  ├─ groceries/
│  │  ├─ household/
│  │  └─ basket/
│  │
│  ├─ protocol/
│  │  ├─ native-messaging/
│  │  └─ agent-events/
│  │
│  ├─ store-contracts/
│  │  ├─ types.ts
│  │  └─ schemas.ts
│  │
│  ├─ ui/
│  │  └─ shared React components
│  │
│  └─ agent-api/
│     ├─ KorikoneAgent.ts
│     ├─ CodexAgent.ts
│     └─ NativeResponsesAgent.ts
│
├─ crates/
│  ├─ Korikone-core/
│  │  ├─ auth/
│  │  ├─ db/
│  │  ├─ policy/
│  │  ├─ agent/
│  │  ├─ mcp/
│  │  └─ messaging/
│  │
│  └─ Korikone-native-host/
│
├─ services/
│  └─ Korikone-store-mcp/
│     ├─ src/
│     ├─ adapters/
│     │  ├─ kruoka/
│     │  └─ skaupat/
│     └─ tests/
│
├─ fixtures/
│  └─ demo-store/
│
├─ docs/
│  ├─ architecture.md
│  ├─ security.md
│  └─ privacy.md
│
└─ pnpm-workspace.yaml
```

---

# 15. Shared Protocol Design

Use explicit versioned messages.

Example:

```json
{
  "protocolVersion": 1,
  "requestId": "uuid",
  "type": "store.addProduct",
  "payload": {
    "store": "kruoka",
    "productId": "12345",
    "quantity": 2
  }
}
```

Response:

```json
{
  "protocolVersion": 1,
  "requestId": "uuid",
  "ok": true,
  "result": {
    "cartItemCount": 48
  }
}
```

Benefits:

- easier debugging
- forward compatibility
- extension/native decoupling
- easier integration testing

---

# 16. Demo Store

Implement a built-in fake store early.

Reasons:

- automated integration testing
- browser-store review
- development without real supermarket accounts
- reproducible product selection tests
- UI demos
- offline development

Demo Store should support:

```text
search
prices
unit prices
availability
add/remove
quantity
basket
delivery slots
```

It should deliberately include edge cases:

- unavailable products
- multiple package sizes
- substitutions
- temporary price changes
- duplicate products
- minimum quantities

---

# 17. Browser Store Publishing Strategy

## Chrome

Target Manifest V3.

Keep permissions minimal.

Provide:

- clear single-purpose description
- privacy policy
- screenshots
- Demo Store reviewer instructions
- explanation of native helper requirement
- explanation that checkout remains on the retailer's site

## Edge

Reuse the Chromium extension code.

Publish separately to Microsoft Edge Add-ons.

## Firefox

Add later after:

- Chrome integration is stable
- native messaging behavior is proven
- store adapters are sufficiently robust

---

# 18. Privacy Design

A simple privacy model should be a core product advantage.

Aim for statements like:

> Korikone does not ask for or store your supermarket password.

> Your household preferences and shopping history are stored locally by default.

> Korikone only sends information to the selected AI provider when required to perform AI-assisted planning.

> Korikone cannot place a grocery order without the user completing checkout on the retailer's website.

Document:

- what is stored locally
- what is sent to OpenAI
- what the extension can access
- retention policy
- log handling
- crash telemetry policy
- optional analytics behavior

Analytics should be opt-in or aggressively privacy-preserving.

---

# 19. Implementation Phases

## Phase 0 — Repository & contracts

Goal: establish architecture without real store integration.

Build:

- monorepo
- shared TypeScript packages
- Tauri shell
- WXT extension shell
- Rust Korikone Core shell
- versioned message protocol
- StoreAdapter contract
- KorikoneAgent abstraction
- basic CI

Exit criteria:

- desktop app launches
- extension loads
- both can communicate with the local native host
- automated tests run in CI

---

## Phase 1 — Demo Store

Goal: build the complete vertical workflow without retailer fragility.

Build:

- Demo Store dataset
- search
- cart
- add/remove/update
- fake delivery slots
- fake product availability
- cart review screen

Exit criteria:

User can:

1. create a basic meal plan
2. generate a shopping list
3. find demo products
4. fill demo basket
5. review final basket

---

## Phase 2 — Household & meal planning domain

Build:

- household profile
- meal plan model
- ingredient normalization
- basic recipes
- pantry notes
- staple rules
- product preferences

Initial UX:

```text
Monday: salmon soup
Tuesday: tacos
Wednesday: chicken pasta

We have potatoes and pasta.
Need dishwasher tablets.
```

Output:

- normalized ingredients
- quantities
- recurring staples

Exit criteria:

Repeated inputs produce stable, inspectable shopping requirements.

---

## Phase 3 — Sign in with ChatGPT

Build:

- PKCE OAuth
- loopback callback
- secure token storage
- account state UI
- logout/revoke flow
- token refresh
- model capability discovery where applicable

Add:

```text
[ Continue with ChatGPT ]
```

Exit criteria:

A non-technical test user can connect without API keys.

---

## Phase 4 — Agent integration

Initial implementation:

- Codex app-server adapter OR a minimal Responses-based agent
- streaming events
- cancellation
- bounded tool set
- tool-call logging
- MCP dispatcher

Expose Demo Store tools.

Exit criteria:

Model can autonomously:

1. interpret meal request
2. generate shopping requirements
3. search Demo Store
4. fill Demo Store basket
5. explain unresolved decisions

---

## Phase 5 — K-Ruoka integration

Build:

- K-Ruoka page detection
- login detection
- product search
- product details
- cart reading
- add/remove/update
- delivery slot reading if feasible
- open checkout

Implement either:

- DOM-first approach
- authenticated store API approach

behind the same adapter contract.

Exit criteria:

A real K-Ruoka basket can be filled and verified from Korikone.

---

## Phase 6 — S-kaupat integration

Implement the same StoreAdapter.

Reuse:

- product model
- selection logic
- browser bridge
- native protocol

Exit criteria:

Same user workflow works with S-kaupat.

---

## Phase 7 — Product optimization

Add deterministic ranking.

Consider:

- €/kg
- €/L
- package size
- household usage
- excess stock
- generic vs branded
- promotions
- substitution preference
- estimated waste

UI should explain important decisions.

Example:

> Selected 1 kg chicken pack instead of two 500 g packs because it saves €1.40.

---

## Phase 8 — Shopping history & staples

Add:

- previous baskets
- recurring product detection
- average weekly consumption
- suggested restock thresholds
- household staple recommendations

Do not make inferred pantry state authoritative.

User corrections always win.

---

## Phase 9 — Extension side-panel UX

Build polished extension experience:

- connection state
- selected store
- current meal plan
- progress
- unresolved decisions
- basket total
- review button

The side panel should complement, not duplicate, the full desktop app.

---

## Phase 10 — Hardening

Add:

- retries
- store-page change detection
- adapter health diagnostics
- version compatibility checks
- migration system
- structured logs
- crash recovery
- interrupted basket-run recovery

Test:

- slow network
- expired sessions
- out-of-stock products
- changed prices
- duplicate cart items
- browser closed mid-run
- extension service-worker restart
- MCP process crash
- OAuth expiration
- model timeout

---

# 20. v1 Scope

Ship v1 with:

- Windows desktop app
- Chrome extension
- Edge extension
- Sign in with ChatGPT
- K-Ruoka
- optionally S-kaupat if stable enough
- weekly meal planning
- household staples
- basic price optimization
- basket filling
- basket verification
- manual checkout

Do not include in v1:

- autonomous payment
- autonomous checkout
- mobile clients
- cloud synchronization
- family multi-user accounts
- perfect pantry inventory
- dozens of AI providers
- overly complex nutritional optimization

---

# 21. v2 Possibilities

Potential later features:

- S-kaupat if not in v1
- local LLM support
- Anthropic/OpenAI API-key mode
- Hermes integration
- Korikone MCP server
- mobile companion app
- shared family meal planning
- meal recommendations from purchase history
- budget targets
- nutritional goals
- price history
- automatic sale detection
- multiple-store comparison
- recipe import
- calendar integration
- school/daycare meal awareness
- household stock suggestions
- optional cloud sync

---

# 22. Key Technical Decisions

## Decision 1

**Tauri instead of Electron for production.**

Reason:

- lower resource use
- stronger native boundary
- smaller distribution
- better fit for local-first consumer software

Electron remains acceptable for prototyping.

## Decision 2

**Browser extension instead of embedded supermarket login UI.**

Reason:

- user stays in their normal browser
- supermarket credentials remain outside Korikone
- existing authenticated sessions can be reused
- better trust story

## Decision 3

**MCP as the tool boundary.**

Reason:

- reusable integrations
- model/provider independence
- testable contracts
- easy future agent integration

## Decision 4

**Do not make the browser extension an MCP host.**

Reason:

- browser lifecycle is unreliable for that role
- local native processes are a better MCP environment
- easier security and debugging

## Decision 5

**Use Codex app-server only behind a KorikoneAgent abstraction.**

Reason:

- fast initial development
- no permanent architectural lock-in
- can later replace with a Korikone-native agent loop

## Decision 6

**No checkout tool in v1.**

Reason:

- safer
- easier browser-store review
- easier user trust
- avoids payment/SCA complexity
- most time savings come before checkout anyway

---

# 23. Recommended First Development Sprint

The first sprint should prove the architecture, not the AI.

Implement:

1. pnpm monorepo
2. React/Tauri desktop app
3. WXT browser extension
4. local native messaging host
5. shared versioned protocol
6. Demo Store
7. StoreAdapter
8. simple basket UI
9. extension side panel
10. desktop ↔ core ↔ extension roundtrip

Concrete milestone:

From the desktop app:

```text
Search "milk"
```

should flow:

```text
Desktop UI
  ↓
Korikone Core
  ↓
StoreAdapter
  ↓
native bridge
  ↓
extension
  ↓
Demo Store
  ↓
results
  ↓
desktop UI
```

Then:

```text
Add product
```

must update the Demo Store basket and be visible in both:

- desktop app
- extension side panel

Only after that foundation works should AI be added.

---

# 24. Second Development Sprint

Add:

- household profile
- weekly planner
- normalized ingredients
- basic staple system
- deterministic product matching
- Sign in with ChatGPT
- KorikoneAgent abstraction
- initial agent implementation

Milestone:

User types:

> Monday spaghetti bolognese, Tuesday salmon soup, Wednesday tacos. We already have pasta. Add dishwasher tablets.

Korikone:

1. understands the week
2. generates requirements
3. omits pasta
4. adds dishwasher tablets
5. searches Demo Store
6. creates basket
7. shows review UI

---

# 25. Third Development Sprint

Integrate the first real retailer.

Recommended order:

1. K-Ruoka
2. S-kaupat

Do not attempt both at once.

Milestone:

A real authenticated store session can be used to:

- search
- add items
- adjust quantities
- read actual basket
- reconcile against Korikone's expected basket
- open final checkout page

---

# 26. Definition of a Successful MVP

A non-technical person should be able to:

1. install Korikone
2. sign in with ChatGPT
3. enable browser integration
4. log into their grocery store normally
5. describe next week's meals
6. tell Korikone what is already at home
7. click **Build basket**
8. review a sensible basket
9. correct obvious mistakes
10. open the store checkout
11. place the order manually

without ever seeing:

- API keys
- terminals
- MCP configuration
- JSON
- model configuration
- browser automation controls
- developer settings

---

# 27. Final Recommended Direction

For the best balance of development speed, consumer UX, maintainability, and future flexibility:

```text
Desktop
    Tauri 2 + React + TypeScript

Extension
    WXT + React + TypeScript

Core
    Rust + SQLite

AI login
    Sign in with ChatGPT

Initial agent runtime
    Codex app-server behind KorikoneAgent abstraction

Long-term agent runtime
    lightweight Korikone-owned orchestration

Tool ecosystem
    MCP

Store access
    browser extension + Native Messaging

Store authentication
    user's normal browser session

Checkout
    manual on retailer website
```

This design lets Korikone begin as a relatively small hobby project while preserving a credible path toward a polished consumer application.

The most important architectural rule is:

> **Keep Korikone's domain model, store adapters, and MCP contracts independent of the AI runtime.**

If that boundary stays clean, Codex, OpenAI Responses, Claude, Hermes, or local models can change later without requiring the grocery-shopping product itself to be rewritten.
