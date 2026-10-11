import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export const statusNames = {
  planned: "Planned",
  active: "In progress",
  decision: "Needs decision",
  done: "Done",
  dropped: "Dropped",
  unknown: "Unrecognized",
};
const taskId = /^[A-Z]+\d*(?:\.\d+)+$/;

export function cells(line) {
  const result = [];
  let cell = "";
  let code = false;
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === "\\" && body[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (char === "`") {
      code = !code;
      cell += char;
    } else if (char === "|" && !code) {
      result.push(cell.trim());
      cell = "";
    } else cell += char;
  }
  result.push(cell.trim());
  return result;
}

export function plain(text) {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function statusOf(text) {
  if (/^In progress\b/i.test(text)) return "active";
  if (/^Needs decision\b/i.test(text)) return "decision";
  if (/^Done\b/i.test(text)) return "done";
  if (/^Dropped\b/i.test(text)) return "dropped";
  if (/^Planned\b/i.test(text)) return "planned";
  return "unknown";
}

export function counts(tasks) {
  const result = Object.fromEntries(
    Object.keys(statusNames).map((key) => [key, 0]),
  );
  for (const task of tasks) result[task.status]++;
  result.total = tasks.length;
  result.scope = result.total - result.dropped;
  result.percent = result.scope
    ? Math.round((result.done / result.scope) * 100)
    : null;
  return result;
}

function reportedIntegration(evidence) {
  if (/\b(?:local.only|unmerged|not merged)\b/i.test(evidence))
    return "Local only reported";
  const positive = evidence.replace(
    /\b(?:not|never)\s+(?:yet\s+)?(?:released|published)\b/gi,
    "",
  );
  if (/\b(?:released|published)\s+(?:as\s+|in\s+)?v?\d/i.test(positive))
    return "Release reported";
  if (/\b(?:merged|integrated (?:on|into) main)\b/i.test(positive))
    return "Integration reported";
  return null;
}

export function parseTasks(markdown, source, version) {
  const tasks = [];
  const issues = [];
  const headings = new Map();
  let heading = "Tasks";
  let headers = null;
  const lines = markdown.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (/^## /.test(line)) {
      heading = plain(line.slice(3));
      const featureId = heading.match(/^([A-Z]+\d*)\b/)?.[1];
      if (featureId && !headings.has(featureId))
        headings.set(featureId, heading);
    }
    const missingLeadingPipe = /^[A-Z]+\d*(?:\.\d+)+\s*\|/.test(line);
    if (!line.startsWith("|") && !missingLeadingPipe) {
      headers = null;
      continue;
    }
    const row = cells(line);
    if (row.every((value) => /^:?-+:?$/.test(value))) continue;
    if (row[0]?.toLowerCase() === "id") {
      headers = row.map((value) => value.toLowerCase());
      continue;
    }
    if (!taskId.test(row[0])) {
      if (headers)
        issues.push({
          source,
          line: index + 1,
          message: `Unrecognized task row: ${row[0] || "empty ID"}`,
        });
      continue;
    }
    const at = (prefix) =>
      headers?.findIndex((name) => name.startsWith(prefix)) ?? -1;
    const malformed =
      missingLeadingPipe ||
      !headers ||
      row.length !== headers.length ||
      at("task") < 0 ||
      at("status") < 0;
    if (malformed)
      issues.push({
        source,
        line: index + 1,
        message: `${row[0]} has missing headers or a malformed table row.`,
      });
    const description = malformed ? row.slice(1).join(" | ") : row[at("task")];
    const evidence = malformed
      ? "Unrecognized: malformed source row"
      : row[at("status")];
    const status = statusOf(evidence);
    if (!malformed && status === "unknown")
      issues.push({
        source,
        line: index + 1,
        message: `${row[0]} has an unrecognized status: ${evidence || "empty"}`,
      });
    const featureId = row[0].split(".")[0];
    const dependencyText =
      malformed || at("depends") < 0 ? "" : row[at("depends")];
    tasks.push({
      id: row[0],
      version,
      source,
      line: index + 1,
      featureId,
      feature: headings.get(featureId) || heading,
      title: plain(description).split(/\.\s+(?=[A-Z])/)[0],
      description,
      evidence,
      status,
      agent: malformed || at("agent") < 0 ? "Unspecified" : row[at("agent")],
      dependencyText,
      dependencies: [
        ...new Set(dependencyText.match(/\b[A-Z]+\d*(?:\.\d+)+\b/g) || []),
      ],
      integration: status === "done" ? reportedIntegration(evidence) : null,
    });
  }
  if (
    !tasks.length &&
    (version !== "later" || /^\|\s*ID\s*\|/im.test(markdown))
  )
    issues.push({
      source,
      line: 1,
      message: "No implementation cards could be read from this task file.",
    });
  return { tasks, issues };
}

export function parseRoadmap(markdown, source = "docs/roadmap.md") {
  const releases = [];
  const issues = [];
  let headers = null;
  let section = "";
  let currentText = "";
  const sections = [];
  for (const [index, raw] of markdown.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (/^## /.test(line)) {
      section = line.slice(3);
      if (["Accepted direction", "Decisions still needed"].includes(section))
        sections.push({ title: section, lines: [] });
    } else {
      if (section === "Current release") currentText += `${line}\n`;
      if (
        ["Accepted direction", "Decisions still needed"].includes(section) &&
        line
      )
        sections.at(-1)?.lines.push(line);
    }
    if (!line.startsWith("|")) {
      headers = null;
      continue;
    }
    const row = cells(line);
    if (row.every((value) => /^:?-+:?$/.test(value))) continue;
    if (row[0]?.toLowerCase() === "version") {
      headers = row.map((value) => value.toLowerCase());
      continue;
    }
    if (!headers) continue;
    if (row.length !== headers.length) {
      issues.push({
        source,
        line: index + 1,
        message: `Malformed roadmap row: ${row[0]}`,
      });
    }
    const get = (name) => row[headers.indexOf(name)] || "";
    const file = get("canonical tasks").match(/\]\((tasks\/[^)]+\.md)\)/)?.[1];
    releases.push({
      version: get("version"),
      goal: plain(get("goal")),
      criterion: get("release criterion"),
      taskFile: file ? `docs/${file}` : null,
      source,
      line: index + 1,
    });
  }
  if (!releases.length)
    issues.push({
      source,
      line: 1,
      message: "Roadmap delivery table is missing or unrecognized.",
    });
  const release = currentText.match(
    /\[v(\d+\.\d+\.\d+)\]\((https:\/\/[^)]+\/releases\/tag\/[^)]+)\)/,
  );
  return {
    releases,
    issues,
    currentRelease: release
      ? { version: release[1], url: release[2], text: currentText.trim() }
      : null,
    sections,
  };
}

export function assemble(sources) {
  const roadmap = sources.find((file) => file.path === "docs/roadmap.md");
  const parsed = parseRoadmap(roadmap?.text || "");
  const issues = [...parsed.issues];
  const tasks = [];
  for (const source of sources.filter((file) =>
    file.path.startsWith("docs/tasks/"),
  )) {
    const version = source.path.split("/").at(-1).replace(/\.md$/, "");
    const result = parseTasks(source.text, source.path, version);
    tasks.push(...result.tasks);
    issues.push(...result.issues);
  }
  const byId = new Map();
  for (const task of tasks) {
    if (byId.has(task.id))
      issues.push({
        source: task.source,
        line: task.line,
        message: `Duplicate task ID ${task.id}; counts include both source rows.`,
      });
    byId.set(task.id, task);
  }
  for (const task of tasks) {
    task.waitingFor = task.dependencies.filter(
      (id) => byId.get(id)?.status !== "done",
    );
    for (const id of task.dependencies.filter((id) => !byId.has(id)))
      issues.push({
        source: task.source,
        line: task.line,
        message: `${task.id} references missing dependency ${id}.`,
      });
  }
  const releases = parsed.releases.map((release) => {
    const cards = tasks.filter((task) => task.source === release.taskFile);
    const groups = new Map();
    for (const task of cards) {
      if (!groups.has(task.featureId))
        groups.set(task.featureId, {
          id: task.featureId,
          name: task.feature,
          tasks: [],
        });
      groups.get(task.featureId).tasks.push(task);
    }
    return {
      ...release,
      key: release.version === "Unassigned" ? "later" : release.version,
      counts: counts(cards),
      features: [...groups.values()].map((group) => ({
        ...group,
        counts: counts(group.tasks),
      })),
    };
  });
  const knownSources = new Set(releases.map((release) => release.taskFile));
  for (const source of sources.filter(
    (file) =>
      file.path.startsWith("docs/tasks/") && !knownSources.has(file.path),
  )) {
    issues.push({
      source: source.path,
      line: 1,
      message:
        "Task file is not linked from the roadmap; its cards are still shown in All work.",
    });
  }
  const publishedIndex = releases.findIndex(
    (release) => release.version === parsed.currentRelease?.version,
  );
  const activeRelease =
    releases
      .slice(Math.max(publishedIndex + 1, 0))
      .find(
        (release) =>
          release.key !== "later" &&
          release.counts.scope &&
          release.counts.done < release.counts.scope,
      )?.key ||
    releases.find((release) => release.counts.active)?.key ||
    "later";
  return {
    ...parsed,
    issues,
    releases,
    tasks,
    counts: counts(tasks),
    activeRelease,
    sources: sources.map(({ text, ...file }) => file),
  };
}

export async function readDashboard(root) {
  const sources = [];
  const issues = [];
  let names = [];
  try {
    names = (await readdir(join(root, "docs/tasks")))
      .filter((name) => /^(?:\d+\.\d+\.(?:\d+|x)|later)\.md$/.test(name))
      .sort();
  } catch {
    issues.push({
      source: "docs/tasks",
      line: 1,
      message: "Task directory could not be read.",
    });
  }
  for (const path of [
    "docs/roadmap.md",
    ...names.map((name) => `docs/tasks/${name}`),
  ]) {
    try {
      const [text, info] = await Promise.all([
        readFile(join(root, path), "utf8"),
        stat(join(root, path)),
      ]);
      sources.push({ path, text, modifiedAt: info.mtime.toISOString() });
    } catch {
      issues.push({
        source: path,
        line: 1,
        message:
          "Source file could not be read; it may be changing or missing.",
      });
    }
  }
  const data = assemble(sources);
  data.issues.unshift(...issues);
  data.revision = createHash("sha256")
    .update(JSON.stringify(sources))
    .update(JSON.stringify(issues))
    .digest("hex");
  return data;
}
