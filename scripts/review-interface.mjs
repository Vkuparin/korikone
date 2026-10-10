import { _electron as electron } from "@playwright/test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const appearance = process.argv[3] ?? "dark";
if (!["system", "light", "dark"].includes(appearance))
  throw new Error("Choose system, light or dark");
const profile = process.argv[2]
  ? resolve(process.argv[2])
  : await mkdtemp(join(tmpdir(), "korikone-interface-review-"));
const marker = join(profile, "interface-review.json");
if (process.argv[2]) {
  if (!profile.startsWith(resolve(tmpdir()) + sep))
    throw new Error("Review profiles must stay in the temporary directory");
  if (
    JSON.parse(await readFile(marker, "utf8")).kind !==
    "isolated-interface-review"
  )
    throw new Error("This is not an interface review profile");
} else
  await writeFile(
    marker,
    JSON.stringify({ kind: "isolated-interface-review" }),
  );
const env = {
  ...process.env,
  KORIKONE_TEST_DATA: profile,
  KORIKONE_TEST_HIDDEN: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
let app = await electron.launch({ args: ["."], env });
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.korikone);
  await page.evaluate(
    async ({ fresh, appearance }) => {
      const api = window.korikone;
      if (fresh) {
        const state = (await api.load()).value.state;
        state.onboarded = state.setupComplete = true;
        state.staples = [];
        state.note = "Paikallinen esimerkkilista";
        state.recipes = [
          {
            id: "review-meal",
            name: "Pitkän nimen ateria (paikallinen testiaineisto)",
            servings: 2,
            instructions: "",
            kind: "meal",
            ingredients: [
              {
                id: "layout-long",
                name: "layout-long",
                amount: 500,
                unit: "g",
              },
            ],
          },
        ];
        state.meals = [
          {
            id: "review-serving",
            recipeId: "review-meal",
            day: 0,
            servings: 2,
            leftovers: false,
          },
        ];
        state.extras = [
          "layout-unknown-pack",
          "layout-unknown-price",
          "carrot",
        ].map((id) => ({ id, name: id, amount: 500, unit: "g" }));
        const saved = await api.save(state);
        if (!saved.ok) throw new Error(saved.error);
        await api.signInAI();
      }
      const changed = await api.setAppearance(appearance);
      if (!changed.ok) throw new Error(changed.error);
    },
    { fresh: !process.argv[2], appearance },
  );
} finally {
  await app.close();
}
delete env.KORIKONE_TEST_HIDDEN;
app = await electron.launch({ args: ["."], env });
const page = await app.firstWindow();
const bootstrap = await page.evaluate(() =>
  window.korikone.getAppearanceBootstrap(),
);
process.stdout.write(
  `Isolated development review open: ${profile}\nAppearance: ${bootstrap.preference} / ${bootstrap.resolved}\nRestart this profile: node scripts/review-interface.mjs "${profile}" system\nZero live AI requests or retailer writes; all accounts and products are fixtures.\n`,
);
await new Promise((resolve) => app.on("close", resolve));
