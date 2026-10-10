import { matchingBaseline } from "../matching-baseline";
import { shoppingCaseSchema, type ShoppingCase } from "./schema";

/** F15.1 author-authored reference expectations; these are not inferred from replies. */
export const baselineShoppingCases: ShoppingCase[] = matchingBaseline.map((c) =>
  shoppingCaseSchema.parse({
    id: c.id,
    note: `${c.name} ${c.amount} ${c.unit}`,
    expected: [
      {
        id: c.id,
        kind: "grocery",
        names: [c.name],
        category: c.category === "onions" ? "onion" : c.category,
        amount: c.amount,
        unit: c.unit,
        admissible: c.admissible,
        forbidden: c.products
          .filter((p) => !c.admissible.includes(p.id))
          .map((p) => p.id),
      },
    ],
    replies: [
      JSON.stringify({
        items: [
          { id: "model-item", name: c.name, amount: c.amount, unit: c.unit },
        ],
      }),
    ],
    catalogue: { "*": c.products },
    requiredCapabilities: c.id === "onion-weighed" ? ["weighed-pricing"] : [],
  }),
);

export const coverageShoppingCase = shoppingCaseSchema.parse({
  id: "independent-two-groceries",
  note: "Maitoa 1 l ja kananmunia 6 kpl",
  expected: [
    {
      id: "requested-milk",
      kind: "grocery",
      names: ["Maito"],
      category: "milk",
      amount: 1000,
      unit: "ml",
      admissible: ["milk"],
    },
    {
      id: "requested-eggs",
      kind: "grocery",
      names: ["Kananmuna"],
      category: "eggs",
      amount: 6,
      unit: "pcs",
      admissible: ["eggs"],
    },
  ],
  replies: [
    '{"items":[{"id":"milk","name":"Maito","amount":1000,"unit":"ml"},{"id":"eggs","name":"Kananmuna","amount":6,"unit":"pcs"}]}',
  ],
  catalogue: {
    Maito: [{ id: "milk", name: "Maito 1 l", price: 1.2 }],
    Kananmuna: [{ id: "eggs", name: "Kananmunat M10", price: 2.5 }],
  },
});
