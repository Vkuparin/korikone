/** Independently authored wire examples. These are not captured live retailer results. */
export const weighedSearch = {
  k: {
    results: [
      {
        ean: "synthetic-weighed",
        name: "Omena",
        price: 2.49,
        priceUnit: "kg",
        priceIsApproximate: true,
        isAvailable: true,
      },
    ],
  },
  s: {
    products: [
      {
        id: "synthetic-weighed",
        name: "Omena",
        price: 2.49,
        depositPrice: null,
        priceBasis: "per_weight",
        approximatePrice: true,
        quantityUnit: "KG",
        packSize: null,
      },
    ],
  },
};

export const weighedReadback = {
  k: {
    basketId: "synthetic-basket",
    account: "synthetic-account",
    store: { id: "fixture-store", name: "Synthetic store" },
    items: [
      {
        itemId: "synthetic-item",
        ean: "synthetic-weighed",
        name: "Omena",
        amount: 0.333,
        unit: "kg",
      },
    ],
  },
  s: {
    lists: [
      {
        id: "synthetic-list",
        name: "Korikone",
        items: [
          {
            productId: "synthetic-weighed",
            name: "Omena",
            quantity: 0.333,
            product: { priceBasis: "per_weight" },
          },
        ],
      },
    ],
  },
};
