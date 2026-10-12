import { expect, test } from "vitest";
import {
  candidateSuitability,
  matchRequirement,
  matchingPolicy,
} from "../src/domain/matching";
import { inferredClassification } from "../src/domain/categories";
import type { Product, Requirement } from "../src/domain/model";
import { retailerEvidence } from "../src/stores/candidates";
import { createFixtureService } from "./fixtures/ai-shopping/environment";
import { Service } from "../src/application/service";
const requirement: Requirement = {
  id: "onion",
  name: "Keltasipuli",
  amount: 100,
  unit: "g",
  sources: ["meal"],
  classification: inferredClassification("Keltasipuli", "recipe-inferred"),
};
const product = (name: string): Product => ({
  id: name,
  providerId: "k-ruoka",
  storeId: "synthetic-store",
  ingredientId: "onion",
  name,
  packAmount: 1000,
  unit: "g",
  price: 100,
  deposit: 0,
  available: true,
  nativeUnit: "kpl",
  increment: 1,
  observedAt: "2026-10-13T00:00:00Z",
  evidence: retailerEvidence(name),
});
test.each([
  "Sipuli 1 kg",
  "Pirkka Sipuli Suomi 1kg",
  "Sipulit 500 g",
  "Yellow onion 1 kg",
  "Keltasipuli 1 kg",
])(
  "recipe-inferred yellow onion accepts equivalent ordinary product %s",
  (name) => {
    const p = product(name),
      observed = structuredClone(p.evidence);
    const line = matchRequirement(requirement, [p], {
      sourceNote: "Uunimakkaraa",
    });
    expect(line.product?.id).toBe(p.id);
    expect(line.matching).toMatchObject({
      status: "resolved",
      defaulted: true,
    });
    expect(p.evidence).toEqual(observed);
    expect(matchingPolicy(requirement).required).toEqual([]);
  },
);
test.each([
  "Punasipuli 1 kg",
  "Salottisipuli 1 kg",
  "Kevätsipuli 1 kg",
  "Valkosipuli 1 kg",
  "Valkoinen sipuli 1 kg",
  "Kuivattu sipuli 1 kg",
  "Sipulijauhe 1 kg",
  "Sipuli mausteseos 1 kg",
  "Paahdettu sipuli 1 kg",
])("ordinary-onion default never silently substitutes %s", (name) => {
  expect(matchRequirement(requirement, [product(name)]).product).toBeNull();
});
test("explicit or remembered red/shallot and organic requirements stay strict; missing evidence remains unknown", () => {
  for (const type of ["Punasipuli", "Salottisipuli", "Kevätsipuli"]) {
    const evidence = { start: 0, end: type.length, quote: type };
    const classification = inferredClassification(type, "recipe-inferred")!;
    const request = {
      ...requirement,
      name: type,
      classification: {
        ...classification,
        provenance: "explicit-note" as const,
        evidence,
        qualifiers: classification.qualifiers.map((q) => ({
          ...q,
          provenance: "explicit-note" as const,
          evidence,
        })),
      },
    };
    expect(
      matchRequirement(request, [product("Sipuli 1 kg")], { sourceNote: type })
        .product,
    ).toBeNull();
    expect(
      matchRequirement(request, [product(`${type} 1 kg`)], { sourceNote: type })
        .product?.name,
    ).toContain(type);
  }
  const note = "Luomu keltasipuli";
  const inferred = inferredClassification(note, "recipe-inferred")!;
  const evidence = { start: 0, end: note.length, quote: note };
  const organic = {
    ...requirement,
    name: note,
    classification: {
      ...inferred,
      provenance: "explicit-note" as const,
      evidence,
      qualifiers: inferred.qualifiers.map((q) => ({
        ...q,
        provenance: "explicit-note" as const,
        evidence,
      })),
    },
  };
  expect(
    candidateSuitability(organic, product("Sipuli 1 kg"), { sourceNote: note })
      .reason,
  ).toBe("qualifier-unknown");
  expect(
    matchRequirement(organic, [product("Luomu Sipuli 1 kg")], {
      sourceNote: note,
    }).product?.name,
  ).toContain("Luomu");
  expect(() =>
    matchRequirement(organic, [product("Luomu Sipuli 1 kg")], {
      sourceNote: "ei luomu keltasipulia",
    }),
  ).toThrow();
  expect(
    matchRequirement({ ...requirement, classification: inferred }, [
      product("Sipuli 1 kg"),
    ]).product?.name,
  ).toBe("Sipuli 1 kg");
  expect(
    matchRequirement(requirement, [product("Sipuli 1 kg")], {
      preferences: [
        {
          category: "onion",
          strength: "required",
          qualifiers: [{ kind: "organic", value: "organic" }],
        },
      ],
    }).product,
  ).toBeNull();
  expect(
    matchRequirement(requirement, [product("Sipuli 1 kg")], {
      preferences: [
        {
          category: "onion",
          strength: "required",
          qualifiers: [{ kind: "onion", value: "red" }],
        },
      ],
    }).product,
  ).toBeNull();
  expect(
    matchRequirement(requirement, [product("Punasipuli 1 kg")], {
      preferences: [
        {
          category: "onion",
          strength: "required",
          qualifiers: [{ kind: "onion", value: "red" }],
        },
      ],
    }).product?.name,
  ).toContain("Punasipuli");
  const unknown = { ...product("Ruokasipuli 1 kg"), evidence: undefined };
  expect(candidateSuitability(requirement, unknown).reason).toBe(
    "unknown-category",
  );
  expect(
    candidateSuitability(requirement, product("Ruokasipuli 1 kg")).reason,
  ).toBe("default-review");
});
test.each(["k-ruoka", "s-kaupat"] as const)(
  "%s ordinary onion reaches a real validated retained quote without a synonym guess",
  async (chain) => {
    const env = await createFixtureService(chain, {
      sipuli: [{ id: "ordinary", name: "Sipuli Suomi 1 kg", price: 1 }],
    });
    await env.service.save({
      ...env.service.state,
      note: "Uunimakkaraa",
      extras: [{ ...requirement, sources: undefined }],
    });
    await env.service.buildBasket();
    expect(env.service.basket[0]).toMatchObject({
      product: { id: "ordinary" },
      packs: 1,
      total: 100,
      matching: { defaulted: true, status: "resolved" },
    });
    expect(
      env.normalized.get("onion")![0].evidence!.qualifiers,
    ).not.toContainEqual({ kind: "onion", value: "yellow" });
    const restarted = new Service(env.storage);
    restarted.developmentMode = true;
    restarted.registry.register(env.service.registry.get(chain));
    await restarted.init();
    expect(restarted.basket[0].product?.id).toBe("ordinary");
    expect(env.tools.filter((tool) => tool === "search_products")).toHaveLength(
      2,
    );
    expect(
      env.tools.every((tool) =>
        ["search_products", "check_basket", "get_delivery_options"].includes(
          tool,
        ),
      ),
    ).toBe(true);
  },
);
