export type AvailableModel = { slug: string; name: string };

// Use the live account catalogue, never a pinned model identifier. Preserve
// server order within a size tier. Names imply size, not verified prices.
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
  if (!small) throw new Error("modelSelectionRequired");
  return small.slug;
}
