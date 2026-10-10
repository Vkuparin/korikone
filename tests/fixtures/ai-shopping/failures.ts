import { shoppingCaseSchema, type ShoppingCase } from "./schema";

type CaseInput = {
  id: string;
  note: string;
  name: string;
  category: "milk" | "eggs" | "onion" | "mince" | "rice" | "coffee";
  amount: number;
  unit: "g" | "ml" | "pcs";
  products: {
    id: string;
    name: string;
    price: number | null;
    available?: boolean;
    weighed?: boolean;
  }[];
  boundaryFailure?: "search-error" | "malformed";
  completion?: "incomplete";
  replies?: string[];
  requiredCapabilities?: ShoppingCase["requiredCapabilities"];
};
const inputs: CaseInput[] = [
  {
    id: "stock-eggs",
    note: "Kananmunia 6 kpl",
    name: "Kananmuna",
    category: "eggs",
    amount: 6,
    unit: "pcs",
    products: [
      { id: "eggs", name: "Kananmuna 6 kpl", price: 2, available: false },
    ],
  },
  {
    id: "stock-milk",
    note: "One litre of milk",
    name: "Maito",
    category: "milk",
    amount: 1000,
    unit: "ml",
    products: [{ id: "milk", name: "Maito 1 l", price: 2, available: false }],
  },
  {
    id: "empty-onion",
    note: "Sipulia 300 g",
    name: "Sipuli",
    category: "onion",
    amount: 300,
    unit: "g",
    products: [],
  },
  {
    id: "empty-rice",
    note: "Rice 500 g",
    name: "Riisi",
    category: "rice",
    amount: 500,
    unit: "g",
    products: [],
  },
  {
    id: "search-error-milk",
    note: "Maitoa 2 litraa",
    name: "Maito",
    category: "milk",
    amount: 2000,
    unit: "ml",
    products: [],
    boundaryFailure: "search-error",
  },
  {
    id: "search-error-eggs",
    note: "Twelve eggs",
    name: "Kananmuna",
    category: "eggs",
    amount: 12,
    unit: "pcs",
    products: [],
    boundaryFailure: "search-error",
  },
  {
    id: "malformed-mince",
    note: "Jauhelihaa 400 g",
    name: "Jauheliha",
    category: "mince",
    amount: 400,
    unit: "g",
    products: [{ id: "mince", name: "Jauheliha 400 g", price: 3 }],
    boundaryFailure: "malformed",
  },
  {
    id: "malformed-coffee",
    note: "Coffee 500 g",
    name: "Kahvi",
    category: "coffee",
    amount: 500,
    unit: "g",
    products: [{ id: "coffee", name: "Kahvi 500 g", price: 4 }],
    boundaryFailure: "malformed",
  },
  {
    id: "unknown-price-milk",
    note: "Maitoa 1 litra",
    name: "Maito",
    category: "milk",
    amount: 1000,
    unit: "ml",
    products: [{ id: "milk", name: "Maito 1 l", price: null }],
  },
  {
    id: "unknown-price-rice",
    note: "One kilogram rice",
    name: "Riisi",
    category: "rice",
    amount: 1000,
    unit: "g",
    products: [{ id: "rice", name: "Riisi 1 kg", price: null }],
  },
  {
    id: "unknown-pack-mince",
    note: "Jauhelihaa 800 g",
    name: "Jauheliha",
    category: "mince",
    amount: 800,
    unit: "g",
    products: [{ id: "mince", name: "Jauheliha", price: 3 }],
  },
  {
    id: "weighed-onion",
    note: "Onion 400 g sold by weight",
    name: "Sipuli",
    category: "onion",
    amount: 400,
    unit: "g",
    products: [{ id: "onion", name: "Sipuli 1 kg", price: 2, weighed: true }],
    requiredCapabilities: ["weighed-pricing"],
  },
  {
    id: "weighed-mince",
    note: "Jauhelihaa 600 g irtomyynnistä",
    name: "Jauheliha",
    category: "mince",
    amount: 600,
    unit: "g",
    products: [
      { id: "mince", name: "Jauheliha 1 kg", price: 8, weighed: true },
    ],
    requiredCapabilities: ["weighed-pricing"],
  },
  {
    id: "incomplete-milk",
    note: "Milk 2 litres",
    name: "Maito",
    category: "milk",
    amount: 2000,
    unit: "ml",
    products: [],
    completion: "incomplete",
  },
  {
    id: "invalid-eggs",
    note: "Kananmunia 10 kpl",
    name: "Kananmuna",
    category: "eggs",
    amount: 10,
    unit: "pcs",
    products: [],
    replies: ["not JSON"],
  },
  {
    id: "cancel-milk",
    note: "Milk 1 litre, cancel while searching",
    name: "Maito",
    category: "milk",
    amount: 1000,
    unit: "ml",
    products: [{ id: "milk", name: "Maito 1 l", price: 2 }],
    requiredCapabilities: ["cancellation"],
  },
  {
    id: "stale-eggs",
    note: "Kananmunia 6, muuta määrä kesken päivityksen",
    name: "Kananmuna",
    category: "eggs",
    amount: 6,
    unit: "pcs",
    products: [{ id: "eggs", name: "Kananmuna 6 kpl", price: 2 }],
    requiredCapabilities: ["stale-run"],
  },
  {
    id: "change-store-rice",
    note: "Rice 500 g, change store before result",
    name: "Riisi",
    category: "rice",
    amount: 500,
    unit: "g",
    products: [{ id: "rice", name: "Riisi 500 g", price: 2 }],
    requiredCapabilities: ["store-change"],
  },
  {
    id: "preview-coffee",
    note: "Kahvia 500 g, näytä alustava tulos",
    name: "Kahvi",
    category: "coffee",
    amount: 500,
    unit: "g",
    products: [{ id: "coffee", name: "Kahvi 500 g", price: 4 }],
    requiredCapabilities: ["preview"],
  },
  {
    id: "unknown-milk-amount",
    note: "Some milk, amount unspecified",
    name: "Maito",
    category: "milk",
    amount: 1000,
    unit: "ml",
    products: [{ id: "milk", name: "Maito 1 l", price: 2 }],
    requiredCapabilities: ["unknown-quantity", "visible-unsearchable-request"],
  },
];

export const failureCases: ShoppingCase[] = inputs.map((c) =>
  shoppingCaseSchema.parse({
    id: `failure-${c.id}`,
    note: c.note,
    expected: [
      {
        id: "requested-grocery",
        kind: "grocery",
        names: [c.name],
        category: c.category,
        amount: c.id === "unknown-milk-amount" ? null : c.amount,
        unit: c.unit,
        admissible: c.products.map((p) => p.id),
      },
    ],
    replies: c.replies ?? [
      JSON.stringify({
        items: [
          { id: "model-item", name: c.name, amount: c.amount, unit: c.unit },
        ],
      }),
    ],
    catalogue: { "*": c.products },
    completion: c.completion,
    boundaryFailure: c.boundaryFailure,
    requiredCapabilities: c.requiredCapabilities,
  }),
);
