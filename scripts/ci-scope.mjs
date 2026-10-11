import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const unitPath = /^tests\/(?!ui\/)[a-zA-Z0-9_./-]+\.test\.ts$/;
const uiPath = /^tests\/ui\/[a-zA-Z0-9_./-]+\.spec\.ts$/;
const targets = (input, pattern) => {
  const files = [...new Set(input.split(/\s+/).filter(Boolean))];
  if (files.some((file) => file.includes("..") || !pattern.test(file)))
    throw new Error("Only repository test-file paths are allowed");
  return files;
};
export function ciScope({
  mode = "fast",
  changed = [],
  unit = "",
  ui = "",
} = {}) {
  if (!["fast", "release", "focused"].includes(mode))
    throw new Error("Invalid CI mode");
  if (mode === "release") return { full: true, unit: [], ui: [] };
  const selected =
    mode === "focused"
      ? { full: false, unit: targets(unit, unitPath), ui: targets(ui, uiPath) }
      : {
          full: false,
          unit: changed.filter((file) => unitPath.test(file)),
          ui: changed.filter((file) => uiPath.test(file)),
        };
  if (mode === "focused" && !selected.unit.length && !selected.ui.length)
    throw new Error("Focused mode requires at least one test file");
  return selected;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const mode = process.env.CI_MODE || "fast";
  const changed =
    mode === "fast"
      ? execFileSync(
          "git",
          [
            "diff",
            "--name-only",
            "--diff-filter=ACMR",
            process.env.CI_BASE || "HEAD^",
            "HEAD",
          ],
          { encoding: "utf8" },
        )
          .trim()
          .split(/\r?\n/)
      : [];
  const scope = ciScope({
    mode,
    changed,
    unit: process.env.CI_UNIT,
    ui: process.env.CI_UI,
  });
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `full=${scope.full}\nunit=${JSON.stringify(scope.unit)}\nui=${JSON.stringify(scope.ui)}\n`,
  );
  console.log(JSON.stringify(scope));
}
