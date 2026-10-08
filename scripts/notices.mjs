import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const notices = [
  "Korikone third-party notices\n\nKorikone source is Apache-2.0. Dependencies retain their own licenses.\nK-Ruoka worker licensing is in resources/vendor/k-ruoka/LICENSE.\nThe S-kaupat worker (s-kaupat-mcp, Apache-2.0) is in resources/vendor/s-kaupat/LICENSE; its bundled dependencies are listed in its source repository, https://github.com/Vkuparin/s-kaupat-mcp.\nElectron and Chromium notices accompany the packaged runtime.",
];
for (const [directory, metadata] of Object.entries(lock.packages).sort(
  ([a], [b]) => a.localeCompare(b),
)) {
  if (!directory || metadata.dev) continue;
  let pkg;
  try {
    pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  } catch {
    continue;
  }
  notices.push(
    `\n${"=".repeat(72)}\n${pkg.name} ${pkg.version}\nLicense: ${pkg.license ?? metadata.license ?? "See package source"}\nSource: ${typeof pkg.repository === "string" ? pkg.repository : (pkg.repository?.url ?? metadata.resolved ?? "")}\n`,
  );
  const files = (await readdir(directory))
    .filter((name) => /^(license|licence|copying|notice)(\.|$)/i.test(name))
    .sort();
  for (const file of files)
    try {
      notices.push(`${file}\n${await readFile(join(directory, file), "utf8")}`);
    } catch {
      /* Directory rather than a notice file. */
    }
}
await writeFile("THIRD_PARTY_NOTICES.txt", notices.join("\n"), "utf8");
