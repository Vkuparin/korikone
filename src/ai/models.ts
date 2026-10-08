export type AvailableModel = { slug: string; name: string };

// Use the live account catalogue, never a pinned model identifier. Preserve
// server order within a size tier and when the catalogue uses unfamiliar names.
export function chooseModel(
  models: AvailableModel[],
  override = "auto",
): string {
  if (!models.length) throw new Error("modelsUnavailable");
  if (override !== "auto") {
    if (!models.some((model) => model.slug === override))
      throw new Error("modelUnavailable");
    return override;
  }
  const small = models.find((model) =>
    /(?:^|[\s._-])(luna|nano|mini|small|lite|flash)(?:$|[\s._-])/i.test(
      `${model.slug} ${model.name}`,
    ),
  );
  return (small ?? models[0]).slug;
}
