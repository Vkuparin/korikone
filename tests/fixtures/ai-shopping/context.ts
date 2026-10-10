import { shoppingCaseSchema, type ShoppingCase } from "./schema";
import type { Category, Qualifier } from "../../../src/domain/categories";

type Product = { id: string; name: string; price: number | null };
type Specification = {
  id: string;
  note: string;
  name: string;
  category: Category;
  amount: number;
  unit: "g" | "ml" | "pcs";
  admissible: string[];
  forbidden: string[];
  products: Product[];
  exclusions?: string;
  dietary?: boolean;
};
const p = (id: string, name: string, price = 1): Product => ({
  id,
  name,
  price,
});

// Expectations describe the note and accepted category policy, independently of replies.
const specifications: Specification[] = [
  {
    id: "plain-milk-plant",
    note: "Maitoa 1 l",
    name: "Maito",
    category: "milk",
    amount: 1000,
    unit: "ml",
    admissible: ["cow"],
    forbidden: ["plant"],
    products: [p("plant", "Kauramaito 1 l", 0.5), p("cow", "Maito 1 l", 2)],
  },
  {
    id: "plain-milk-flavoured",
    note: "One litre of plain milk",
    name: "Maito",
    category: "milk",
    amount: 1000,
    unit: "ml",
    admissible: ["plain"],
    forbidden: ["flavoured"],
    products: [
      p("flavoured", "Maito suklaa 1 l", 0.5),
      p("plain", "Maito 1 l", 2),
    ],
  },
  {
    id: "whole-milk",
    note: "Täysmaitoa 1 l",
    name: "Täysmaito",
    category: "milk",
    amount: 1000,
    unit: "ml",
    admissible: ["whole"],
    forbidden: ["skim"],
    products: [
      p("skim", "Rasvaton maito 1 l", 0.5),
      p("whole", "Täysmaito 1 l", 2),
    ],
  },
  {
    id: "skim-milk",
    note: "One litre skimmed milk",
    name: "Rasvaton maito",
    category: "milk",
    amount: 1000,
    unit: "ml",
    admissible: ["skim"],
    forbidden: ["whole"],
    products: [
      p("whole", "Täysmaito 1 l", 0.5),
      p("skim", "Rasvaton maito 1 l", 2),
    ],
  },
  {
    id: "lactose-free",
    note: "Laktoositonta maitoa 1 l",
    name: "Laktoositon maito",
    category: "milk",
    amount: 1000,
    unit: "ml",
    admissible: ["free"],
    forbidden: ["ordinary"],
    products: [
      p("ordinary", "Maito 1 l", 0.5),
      p("free", "Laktoositon maito 1 l", 2),
    ],
  },
  {
    id: "lactose-unknown",
    note: "Milk 1 l, lactose free required",
    name: "Maito",
    category: "milk",
    amount: 1000,
    unit: "ml",
    admissible: [],
    forbidden: ["unknown"],
    products: [p("unknown", "Maito 1 l")],
    exclusions: "laktoosi",
    dietary: true,
  },
  {
    id: "bread-not-sweet",
    note: "Leipää 500 g",
    name: "Leipä",
    category: "bread",
    amount: 500,
    unit: "g",
    admissible: ["bread"],
    forbidden: ["sweet"],
    products: [
      p("sweet", "Leipä makea pulla 500 g", 0.5),
      p("bread", "Leipä 500 g", 2),
    ],
  },
  {
    id: "rye-bread",
    note: "Rye bread 500 g",
    name: "Ruisleipä",
    category: "bread",
    amount: 500,
    unit: "g",
    admissible: ["rye"],
    forbidden: ["wheat"],
    products: [
      p("wheat", "Vehnäleipä 500 g", 0.5),
      p("rye", "Ruisleipä 500 g", 2),
    ],
  },
  {
    id: "eggs-not-liquid",
    note: "Kananmunia 6 kpl",
    name: "Kananmuna",
    category: "eggs",
    amount: 6,
    unit: "pcs",
    admissible: ["eggs"],
    forbidden: ["liquid"],
    products: [
      p("liquid", "Kananmuna neste 500 ml", 0.5),
      p("eggs", "Kananmuna 6 kpl", 2),
    ],
  },
  {
    id: "eggs-pack-cost",
    note: "Twelve eggs",
    name: "Kananmuna",
    category: "eggs",
    amount: 12,
    unit: "pcs",
    admissible: ["twelve"],
    forbidden: ["six"],
    products: [
      p("six", "Kananmuna 6 kpl", 1.5),
      p("twelve", "Kananmuna 12 kpl", 2.5),
    ],
  },
  {
    id: "beef-mince",
    note: "Naudan jauhelihaa 400 g",
    name: "Naudan jauheliha",
    category: "mince",
    amount: 400,
    unit: "g",
    admissible: ["beef"],
    forbidden: ["pork"],
    products: [
      p("pork", "Sian jauheliha 400 g", 0.5),
      p("beef", "Naudan jauheliha 400 g", 2),
    ],
  },
  {
    id: "chicken-mince",
    note: "Chicken mince 400 g",
    name: "Broilerin jauheliha",
    category: "mince",
    amount: 400,
    unit: "g",
    admissible: ["chicken"],
    forbidden: ["beef"],
    products: [
      p("beef", "Naudan jauheliha 400 g", 0.5),
      p("chicken", "Broilerin jauheliha 400 g", 2),
    ],
  },
  {
    id: "mince-not-spice",
    note: "Jauhelihaa 400 g",
    name: "Jauheliha",
    category: "mince",
    amount: 400,
    unit: "g",
    admissible: ["mince"],
    forbidden: ["spice"],
    products: [
      p("spice", "Jauhelihamauste 400 g", 0.5),
      p("mince", "Jauheliha 400 g", 2),
    ],
  },
  {
    id: "onion-not-garlic",
    note: "Onion 300 g",
    name: "Sipuli",
    category: "onion",
    amount: 300,
    unit: "g",
    admissible: ["onion"],
    forbidden: ["garlic"],
    products: [
      p("garlic", "Valkosipuli 300 g", 0.5),
      p("onion", "Sipuli 500 g", 2),
    ],
  },
  {
    id: "rice-not-ready",
    note: "Riisiä 500 g",
    name: "Riisi",
    category: "rice",
    amount: 500,
    unit: "g",
    admissible: ["dry"],
    forbidden: ["ready"],
    products: [
      p("ready", "Riisi valmis 500 g", 0.5),
      p("dry", "Riisi 500 g", 2),
    ],
  },
  {
    id: "coffee-ground",
    note: "Ground coffee 500 g",
    name: "Suodatinkahvi",
    category: "coffee",
    amount: 500,
    unit: "g",
    admissible: ["ground"],
    forbidden: ["beans"],
    products: [
      p("beans", "Kahvipapu 500 g", 0.5),
      p("ground", "Suodatinkahvi 500 g", 2),
    ],
  },
  {
    id: "coffee-beans",
    note: "Kahvipapuja 500 g",
    name: "Kahvipapu",
    category: "coffee",
    amount: 500,
    unit: "g",
    admissible: ["beans"],
    forbidden: ["ground"],
    products: [
      p("ground", "Suodatinkahvi 500 g", 0.5),
      p("beans", "Kahvipapu 500 g", 2),
    ],
  },
  {
    id: "coffee-incompatible-pack",
    note: "Coffee 500 g",
    name: "Kahvi",
    category: "coffee",
    amount: 500,
    unit: "g",
    admissible: [],
    forbidden: ["drink"],
    products: [p("drink", "Kahvi 500 ml")],
  },
  {
    id: "exclude-brand",
    note: "Maitoa 1 l, ei BrandX",
    name: "Maito",
    category: "milk",
    amount: 1000,
    unit: "ml",
    admissible: ["other"],
    forbidden: ["excluded"],
    products: [
      p("excluded", "BrandX maito 1 l", 0.5),
      p("other", "Maito 1 l", 2),
    ],
    exclusions: "BrandX",
  },
  {
    id: "dietary-unknown",
    note: "Bread 500 g, must be gluten free",
    name: "Leipä",
    category: "bread",
    amount: 500,
    unit: "g",
    admissible: [],
    forbidden: ["unknown"],
    products: [p("unknown", "Leipä 500 g")],
    exclusions: "gluteeni",
    dietary: true,
  },
];

const explicitQualifiers: Record<string, Pick<Qualifier, "kind" | "value">[]> =
  {
    "whole-milk": [{ kind: "fat", value: "whole" }],
    "skim-milk": [{ kind: "fat", value: "skimmed" }],
    "lactose-free": [{ kind: "lactose", value: "free" }],
    "rye-bread": [{ kind: "grain", value: "rye" }],
    "beef-mince": [{ kind: "meat", value: "beef" }],
    "chicken-mince": [{ kind: "meat", value: "chicken" }],
    "coffee-ground": [{ kind: "coffee", value: "ground" }],
    "coffee-beans": [{ kind: "coffee", value: "beans" }],
  };
// Only source-backed qualifiers claim explicit-note provenance; no dietary guarantees.
export const contextCases: ShoppingCase[] = specifications.map((s) =>
  shoppingCaseSchema.parse({
    id: `context-${s.id}`,
    note: s.note,
    expected: [
      {
        id: "requested-grocery",
        kind: "grocery",
        names: [s.name],
        category: s.category,
        amount: s.amount,
        unit: s.unit,
        admissible: s.admissible,
        forbidden: s.forbidden,
      },
    ],
    replies: [
      JSON.stringify({
        items: [
          {
            id: "model-item",
            name: s.name,
            amount: s.amount,
            unit: s.unit,
            ...(explicitQualifiers[s.id]
              ? {
                  classification: {
                    category: s.category,
                    provenance: "explicit-note",
                    evidence: { start: 0, end: s.note.length, quote: s.note },
                    qualifiers: explicitQualifiers[s.id].map((q) => ({
                      ...q,
                      provenance: "explicit-note",
                      evidence: { start: 0, end: s.note.length, quote: s.note },
                    })),
                  },
                }
              : {}),
          },
        ],
      }),
    ],
    catalogue: { "*": s.products },
    contextSetup: {
      household: { servings: 2, budget: 10000, exclusions: s.exclusions ?? "" },
    },
    requiredCapabilities: s.dietary
      ? ["dietary-evidence", "compact-context"]
      : ["compact-context"],
  }),
);
