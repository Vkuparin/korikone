import { inferredClassification, type Category } from "./categories";
import type { ProductEvidence, ProductFamily } from "./product-evidence";

/** Supported name facts without assigning request or retailer provenance. */
export function foodNameFacts(
  name: string,
): Pick<ProductEvidence, "category" | "family" | "qualifiers"> {
  const text = name.toLocaleLowerCase("fi").normalize("NFC");
  const has = (pattern: RegExp) =>
    new RegExp(
      `(?<![\\p{L}])${pattern.source.slice(2, -2)}(?![\\p{L}])`,
      "u",
    ).test(text);
  let category: Category | null = null;
  let family: ProductFamily | null = null;
  // Reject ingredient-containing products before recognizing the ingredient head word.
  if (has(/\b[\p{L}-]*(?:leikkuri|keitin|veitsi|suodatinpussi|equipment)\b/u))
    family = "equipment";
  else if (has(/\b[\p{L}-]*(?:juusto|munakas|jauho|omelette|flour)\b/u))
    family = "other-food";
  else if (
    has(/\b(?:kondensoitu|tiivistetty|condensed|evaporated)[\p{L}-]*\b/u)
  )
    family = "other-food";
  else if (has(/\b[\p{L}-]*(?:mauste|mausteseos|seasoning)\b/u))
    family = "seasoning";
  else if (
    has(/\b[\p{L}-]*(?:keitto|laatikko|kastike|pizza|salaatti|ateria)\b/u)
  )
    family = "prepared-food";
  else if (has(/\b(?:valkosipul[\p{L}]*|garlic)\b/u)) family = "garlic";
  else if (has(/\b[\p{L}-]*(?:maito|milk)[\p{L}]*\b/u)) {
    category = "milk";
    family = has(
      /\b(?:kaura|soija|manteli|riisi|kookos|kasvi|oat|soy|almond|coconut)[\p{L}-]*\b/u,
    )
      ? "plant-drink"
      : has(
            /\b(?:suklaa|kaakao|mansikka|vanilja|chocolate|strawberry|flavou?red)[\p{L}-]*\b/u,
          )
        ? "flavoured-milk"
        : has(/\b(?:maito|kevytmaito|täysmaito|rasvaton\s+maito|milk)\b/u)
          ? "plain-milk"
          : null;
  } else if (has(/\b(?:[\p{L}-]*näkkileip[\p{L}]*|crispbread)\b/u)) {
    category = "bread";
    family = "crispbread";
  } else if (has(/\b(?:tortilla[\p{L}]*|wraps?)\b/u)) {
    category = "bread";
    family = "tortilla";
  } else if (has(/\b(?:pulla[\p{L}]*|briossi[\p{L}]*|sweet\s+bread)\b/u)) {
    category = "bread";
    family = "sweet-bread";
  } else if (
    has(
      /\b(?:[\p{L}-]*leip[äa][\p{L}]*|[\p{L}-]*sämpyl[\p{L}]*|ruispala[\p{L}]*|bread|rolls?)\b/u,
    )
  ) {
    category = "bread";
    family = "bread";
  } else if (
    has(
      /\b(?:viiriäis[\p{L}]*|ankan\s+mun[\p{L}]*|quail\s+eggs?|duck\s+eggs?)\b/u,
    )
  ) {
    category = "eggs";
    family = "other-egg";
  } else if (
    has(
      /\b(?:[\p{L}-]*munajauhe|munamassa|munavalkuainen|valkuais[\p{L}]*|liquid\s+egg|egg\s+white)\b/u,
    )
  ) {
    category = "eggs";
    family = "egg-product";
  } else if (has(/\b(?:kanan\s*mun(?:a|at|ia)|kananmun[\p{L}]*|eggs?)\b/u)) {
    category = "eggs";
    family = "hen-egg";
  } else if (has(/\b[\p{L}-]*(?:jauheliha|mince)\b/u)) {
    category = "mince";
    family = has(/\b(?:kasvis|kasvi|soija|herne|vegan|plant)[\p{L}-]*\b/u)
      ? "plant-mince"
      : null;
  } else if (has(/\b(?:[\p{L}-]*sipul(?:i|it|ia)|onions?|shallots?)\b/u)) {
    category = "onion";
    family = "onion";
  } else if (has(/\b(?:[\p{L}-]*riisi|rice)\b/u)) {
    category = "rice";
    family = has(
      /\b(?:valmis|mikro|keitetty|maustettu|ready|cooked|seasoned)[\p{L}-]*\b/u,
    )
      ? "prepared-rice"
      : null;
  } else if (has(/\b(?:[\p{L}-]*kerma|cream)\b/u)) {
    category = "cream";
    family = has(/\b(?:kaura|soija|kasvi|vegan|oat|soy|plant)[\p{L}-]*\b/u)
      ? "plant-cream"
      : null;
  } else if (
    has(
      /\b(?:[\p{L}-]*kahvi[\p{L}]*|coffee|suodatinjauhatus|espressojauhatus)\b/u,
    )
  ) {
    category = "coffee";
    family = has(/\b(?:kapseli[\p{L}]*|capsules?)\b/u)
      ? "coffee-capsule"
      : has(/\b(?:juoma|latte|cappuccino)[\p{L}-]*\b/u)
        ? "coffee-drink"
        : null;
  }
  const categoryName = {
    milk: "Maito",
    bread: "Leipä",
    eggs: "Kananmuna",
    mince: "Jauheliha",
    onion: "Sipuli",
    rice: "Riisi",
    cream: "Kerma",
    coffee: "Kahvi",
  };
  const inferred = inferredClassification(
    category ? `${categoryName[category]} ${name}` : name,
    "model-assumed",
  );
  const qualifiers =
    inferred?.category === category
      ? inferred.qualifiers.map(({ kind, value }) => ({ kind, value }))
      : [];
  const value = (kind: string) =>
    qualifiers.find((q) => q.kind === kind)?.value;
  if (category === "mince" && family !== "plant-mince" && value("meat"))
    family = "meat-mince";
  if (category === "cream" && family !== "plant-cream" && value("cream"))
    family = "dairy-cream";
  if (
    category === "rice" &&
    !family &&
    (value("rice") || has(/\b(?:kuiva|pitkäjyväinen|dry)[\p{L}-]*\b/u))
  )
    family = "dry-rice";
  if (category === "coffee" && !family)
    family =
      (
        {
          ground: "ground-coffee",
          beans: "coffee-beans",
          instant: "instant-coffee",
        } as const
      )[value("coffee") as "ground" | "beans" | "instant"] ?? null;
  return { category, family, qualifiers };
}
