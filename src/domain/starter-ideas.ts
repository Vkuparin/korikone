import { z } from "zod";
export const starterThemeSchema = z.enum([
  "weekday",
  "vegetarian",
  "family",
  "breakfast",
]);
export type StarterTheme = z.infer<typeof starterThemeSchema>;
export const starterThemes = [
  { id: "weekday", fi: "Arkiviikon helpot ruoat", en: "Easy weekday meals" },
  { id: "vegetarian", fi: "Kasvisviikko", en: "Vegetarian week" },
  { id: "family", fi: "Lapsiperheen viikko", en: "Family meals" },
  {
    id: "breakfast",
    fi: "Aamupalat ja iltapalat",
    en: "Breakfast and evening food",
  },
] as const;
