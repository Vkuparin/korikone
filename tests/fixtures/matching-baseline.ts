import type { Unit } from "../../src/domain/model";

export type BaselineProduct = {
  id: string;
  name: string;
  price: number | null;
  available?: boolean;
  weighed?: boolean;
};
export type MatchingBaselineCase = {
  id: string;
  category: string;
  name: string;
  amount: number;
  unit: Unit;
  products: BaselineProduct[];
  baselineSelected: string | null;
  admissible: string[];
  cause:
    | "clear"
    | "name-boundary"
    | "unsafe-type"
    | "empty-search"
    | "stock"
    | "pack"
    | "price"
    | "unit"
    | "ranking";
};

// Independently authored synthetic requests/products; no private receipt or account data.
export const matchingBaseline: MatchingBaselineCase[] = [
  {
    id: "milk-compound",
    category: "milk",
    name: "Maito",
    amount: 1000,
    unit: "ml",
    products: [{ id: "cow", name: "Kevytmaito 1 l", price: 1.2 }],
    baselineSelected: null,
    admissible: ["cow"],
    cause: "name-boundary",
  },
  {
    id: "bread-compound",
    category: "bread",
    name: "Leipä",
    amount: 500,
    unit: "g",
    products: [{ id: "bread", name: "Ruisleipä 500 g", price: 1.5 }],
    baselineSelected: null,
    admissible: ["bread"],
    cause: "name-boundary",
  },
  {
    id: "eggs-count",
    category: "eggs",
    name: "Kananmuna",
    amount: 6,
    unit: "pcs",
    products: [{ id: "eggs", name: "Kananmunat M10 630 g", price: 2.5 }],
    baselineSelected: "eggs",
    admissible: ["eggs"],
    cause: "clear",
  },
  {
    id: "mince-generic",
    category: "mince",
    name: "Jauheliha",
    amount: 400,
    unit: "g",
    products: [
      { id: "beef", name: "Naudan jauheliha 400 g", price: 4 },
      { id: "blend", name: "Sika-nauta jauheliha 400 g", price: 3 },
      { id: "chicken", name: "Kanan jauheliha 400 g", price: 2 },
    ],
    baselineSelected: "blend",
    admissible: ["beef", "blend"],
    cause: "clear",
  },
  {
    id: "onion-compound",
    category: "onions",
    name: "Sipuli",
    amount: 500,
    unit: "g",
    products: [{ id: "onion", name: "Keltasipuli 500 g", price: 1 }],
    baselineSelected: null,
    admissible: ["onion"],
    cause: "name-boundary",
  },
  {
    id: "rice-compound",
    category: "rice",
    name: "Riisi",
    amount: 500,
    unit: "g",
    products: [{ id: "rice", name: "Jasmiiniriisi 1 kg", price: 2 }],
    baselineSelected: null,
    admissible: ["rice"],
    cause: "name-boundary",
  },
  {
    id: "cream-compound",
    category: "cream",
    name: "Kerma",
    amount: 200,
    unit: "ml",
    products: [{ id: "cream", name: "Ruokakerma 2 dl", price: 1 }],
    baselineSelected: null,
    admissible: ["cream"],
    cause: "name-boundary",
  },
  {
    id: "coffee-plain",
    category: "coffee",
    name: "Kahvi",
    amount: 500,
    unit: "g",
    products: [
      { id: "ground", name: "Kahvi 500 g", price: 5 },
      { id: "instant", name: "Pikakahvi 100 g", price: 1 },
    ],
    baselineSelected: "ground",
    admissible: ["ground"],
    cause: "clear",
  },
  {
    id: "milk-name-only-unsafe",
    category: "milk",
    name: "Maito",
    amount: 1000,
    unit: "ml",
    products: [
      { id: "cow", name: "Maito 1 l", price: 2 },
      { id: "almond", name: "Manteli maito 1 l", price: 1 },
    ],
    baselineSelected: "almond",
    admissible: ["cow"],
    cause: "unsafe-type",
  },
  {
    id: "rice-empty",
    category: "rice",
    name: "Riisi",
    amount: 500,
    unit: "g",
    products: [],
    baselineSelected: null,
    admissible: [],
    cause: "empty-search",
  },
  {
    id: "eggs-unavailable",
    category: "eggs",
    name: "Kananmuna",
    amount: 6,
    unit: "pcs",
    products: [
      { id: "eggs", name: "Kananmunat M10", price: 2.5, available: false },
    ],
    baselineSelected: null,
    admissible: [],
    cause: "stock",
  },
  {
    id: "mince-unknown-pack",
    category: "mince",
    name: "Jauheliha",
    amount: 400,
    unit: "g",
    products: [{ id: "mince", name: "Jauheliha", price: 3 }],
    baselineSelected: null,
    admissible: [],
    cause: "pack",
  },
  {
    id: "coffee-unknown-price",
    category: "coffee",
    name: "Kahvi",
    amount: 500,
    unit: "g",
    products: [{ id: "coffee", name: "Kahvi 500 g", price: null }],
    baselineSelected: null,
    admissible: [],
    cause: "price",
  },
  {
    id: "milk-incompatible-unit",
    category: "milk",
    name: "Maito",
    amount: 1000,
    unit: "ml",
    products: [{ id: "powder", name: "Maito 500 g", price: 1 }],
    baselineSelected: null,
    admissible: [],
    cause: "unit",
  },
  {
    id: "onion-weighed",
    category: "onions",
    name: "Sipuli",
    amount: 500,
    unit: "g",
    products: [{ id: "onion", name: "Sipuli 1 kg", price: 2, weighed: true }],
    baselineSelected: null,
    admissible: [],
    cause: "price",
  },
  {
    id: "coffee-whole-pack-cost",
    category: "coffee",
    name: "Kahvi",
    amount: 400,
    unit: "g",
    products: [
      { id: "small", name: "Kahvi 500 g", price: 2 },
      { id: "large", name: "Kahvi 1 kg", price: 3 },
    ],
    baselineSelected: "small",
    admissible: ["small"],
    cause: "ranking",
  },
];
