import type { StarterTheme } from "../domain/starter-ideas";

/** Synthetic alternatives for a real theme request, never a production menu. */
export function starterFixtureReply(input: {
  theme: StarterTheme;
  avoid: string[];
}) {
  const choices: Record<StarterTheme, string[][]> = {
    weekday: [
      ["Nakkikeitto", "Kanapasta", "Makaronilaatikko"],
      ["Uunimakkara", "Kasviskeitto", "Tomaattipasta"],
    ],
    vegetarian: [
      ["Kasviskeitto", "Tomaattipasta", "Kaurapuuro"],
      ["Linssikeitto", "Kasvispasta", "Uunipuuro"],
    ],
    family: [
      ["Makaronilaatikko", "Nakkikeitto", "Kanapasta"],
      ["Uunimakkara", "Tomaattipasta", "Kasviskeitto"],
    ],
    breakfast: [
      ["Jogurtti ja banaanit", "Kaurapuuro", "Munakas"],
      ["Uunipuuro", "Marjajogurtti", "Juustoleivät"],
    ],
  };
  return {
    names:
      choices[input.theme].find((names) =>
        names.some((n) => !input.avoid.includes(n)),
      ) ?? choices[input.theme][0],
  };
}
