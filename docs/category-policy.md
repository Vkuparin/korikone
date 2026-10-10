# Initial category policy proposal

F15.5 owner review, 10 October 2026. Proposed policy; awaiting acceptance. This document does not enable defaults or persist preferences. The existing owner decisions remain: whole-pack total cost, plain cow milk of any fat content, one optional grouped review, explicit Remember consent, automatic resolver with an off switch and ordinary row corrections outside Advanced.

## Generic requests

These boundaries apply only when the current request and an applicable remembered rule do not specify a type. Product evidence must establish the category; unknown attributes cannot satisfy a specified qualifier. Household exclusions always filter candidates.

| Request | Proposed default boundary                           | Needs a specific request/rule or review                                                                       |
| ------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Milk    | Plain cow milk, any fat content                     | Plant drinks, flavoured drinks and cooking substitutes are excluded                                           |
| Bread   | Ordinary rye, wheat or wholegrain bread/rolls       | Crispbread, tortillas and sweet buns are excluded                                                             |
| Eggs    | Whole hen eggs, any size or housing label           | Liquid egg and other bird eggs are excluded                                                                   |
| Mince   | Beef, pork or beef-pork mince                       | Chicken/turkey require a specified meat type; meat substitutes are excluded                                   |
| Onion   | Yellow onion                                        | Red, shallot or spring onion require a specified type                                                         |
| Rice    | Dry, unseasoned white/brown/jasmine/basmati rice    | Ready-to-eat/seasoned rice and other grains are excluded                                                      |
| Cream   | No silent choice between cooking and whipping cream | Ask through the optional review unless a valid request/rule supplies the type; plant substitutes are excluded |
| Coffee  | Ground filter coffee                                | Beans/instant require a specified form; coffee drinks and capsules are excluded                               |

Within the allowed boundary, select the lowest total cost for enough whole packs after applicable constraints and the existing brand preference. A proposed default is visible as a default, never relabelled as something the shopper explicitly requested. A model-added meat/fat/coffee qualifier does not create a hard requirement. Unsupported categories keep their existing conservative matcher until assigned coverage lands.

## Remembered requirements and preferences

The review offers Use once, Remember and Leave unresolved. Remember additionally asks for **Required** or **Preferred** in plain language; it never infers permanence from buying, approving a substitution or dismissing a dialog.

- Required: a candidate must have evidence for every saved qualifier. Unavailable or unknown leaves the row unresolved. The app cannot substitute a conflicting type.
- Preferred: first select among suitable products matching every preferred qualifier. If none exists, offer a suitable category alternative through the optional review. Do not silently replace the preferred type.
- A validated explicit qualifier in the current note overrides the corresponding saved field for that operation, including a saved Required field. A generic category request does not erase saved qualifiers. Household exclusions remain mandatory. Using a current override never changes the remembered rule unless the shopper explicitly chooses Remember.
- Unknown qualifier evidence is not a match for either strength. Review cannot override an exclusion, make unknown evidence into dietary certainty or select an incompatible quantity/unit.

Advanced shows the category, requested type and Required/Preferred, with Edit, Forget and Reset actions. Keep one remembered rule per category initially. Editing replaces that rule only after an explicit save; forgetting returns the category to the accepted default boundary. Store-specific product selections remain separate from portable category rules.

## Proposed implementation handoff after acceptance

F15.3 owns a backward-compatible `categoryPreferences` array, default empty, of at most eight strict rules. Each rule has `category: Category`, unique `qualifiers: {kind, value}[]` from `qualifierValues`, and `strength: "required" | "preferred"`. At least one category-applicable qualifier is required; category-only rules do not represent a type preference. Eggs have no remembered type field in this first schema; size/housing preferences need a later assigned schema. No note spans, retailer identifiers, raw text, inferred purchase data or numeric confidence belong in these portable rules.

Remember writes only through a dedicated explicit service action; normal interpretation/approval/quote cannot write memory. F15.3 must name the actual schema, service actions and backup migration in its landed contract before F15.13 UI implementation. Context receives only validated rules and remembered provenance, replacing the provisional classification-only option in `src/ai/context.ts`.

F15.6 review tests must cover dismissal without changes, Use once without persistence, explicit Remember for both strengths, unavailable Required, Preferred fallback needing approval, and mandatory exclusion filtering. F15.13 Advanced tests must cover keyboard edit/forget/reset, restart and real backup restore with no automatic generation. F15.2/F15.3 tests must cover generic versus explicit qualifiers, per-field overrides without memory changes, both chains, missing evidence and forbidden category look-alikes. Expectations must be authored independently from model replies.

Owner acceptance is required before these proposed defaults and preference rules become implementation policy. Retailer evidence normalization and bounded search contracts can proceed independently.
