import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import {
  assemble,
  cells,
  parseTasks,
  readDashboard,
  statusOf,
} from "./model.mjs";
import { createDashboardServer } from "./server.mjs";
import { projectRegistry } from "./projects.mjs";
import { fixtureFiles, tasksFixture } from "./fixtures.mjs";

test("existing table variants retain evidence, feature grouping and prerequisite states", () => {
  const data = assemble(
    Object.entries(fixtureFiles).map(([path, text]) => ({ path, text })),
  );
  assert.deepEqual(data.issues, []);
  assert.equal(data.currentRelease.version, "0.6.0");
  assert.equal(data.activeRelease, "0.7.0");
  const release = data.releases.find((item) => item.key === "0.7.0");
  assert.equal(release.features.length, 1);
  assert.equal(release.counts.scope, 5);
  assert.equal(release.counts.done, 2);
  assert.equal(release.counts.percent, 40);
  assert.equal(release.counts.dropped, 1);
  const done = data.tasks.find((task) => task.id === "F15.1");
  assert.match(done.evidence, /Owner acceptance remains/);
  assert.equal(done.integration, "Integration reported");
  assert.equal(
    data.tasks.find((task) => task.id === "F15.6").integration,
    "Local only reported",
  );
  assert.deepEqual(data.tasks.find((task) => task.id === "F15.3").waitingFor, [
    "F15.2",
  ]);
  assert.deepEqual(
    data.tasks.find((task) => task.id === "F15.2").waitingFor,
    [],
  );
  assert.equal(
    data.releases.find((item) => item.version === "1.0.0").counts.percent,
    null,
  );
});

test("workflow starter templates produce a compatible project without extra dashboard metadata", async () => {
  const load = async (file) =>
    (
      await readFile(
        new URL(`../../docs/workflow/${file}`, import.meta.url),
        "utf8",
      )
    )
      .replaceAll("{{PROJECT_NAME}}", "New project")
      .replaceAll("{{INITIAL_VERSION}}", "0.1.0")
      .replaceAll("{{INITIAL_RELEASE_GOAL}}", "First useful feature")
      .replaceAll(
        "{{INITIAL_RELEASE_CRITERION}}",
        "Focused fixtures and owner acceptance",
      )
      .replaceAll("{{FEATURE_NAME}}", "First feature");
  const data = assemble([
    { path: "docs/roadmap.md", text: await load("roadmap.template.md") },
    { path: "docs/tasks/0.1.0.md", text: await load("version.template.md") },
    { path: "docs/tasks/later.md", text: await load("later.template.md") },
  ]);
  assert.deepEqual(data.issues, []);
  assert.equal(data.currentRelease, null);
  assert.equal(data.activeRelease, "0.1.0");
  assert.equal(data.tasks.length, 2);
  assert.deepEqual(data.tasks.find((task) => task.id === "F1.2").waitingFor, [
    "F1.1",
  ]);
});

test("project choices persist outside checkouts and real API isolates projects and source files", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "dashboard-projects-"));
  const alpha = join(temporary, "alpha");
  const beta = join(temporary, "beta-ä");
  const registryFile = join(temporary, "preferences/projects.json");
  for (const root of [alpha, beta]) {
    await mkdir(join(root, "docs/tasks"), { recursive: true });
    for (const [path, text] of Object.entries(fixtureFiles))
      await writeFile(
        join(root, path),
        root === beta
          ? text
              .replaceAll("Better product matching", "Beta release goal")
              .replace(
                "In progress: Agent One, branch codex/matcher",
                "Done: beta only",
              )
          : text,
      );
  }
  const before = await readFile(join(alpha, "docs/tasks/0.7.0.md"), "utf8");
  const server = createDashboardServer({
    root: alpha,
    registryFile,
    picker: async () => beta,
    git: async (root) => ({ commit: root === alpha ? "alpha" : "beta" }),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) =>
    fetch(`${url}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  try {
    const initial = await (await fetch(`${url}/api/dashboard`)).json();
    assert.equal(initial.project.name, "alpha");
    const picked = await (await post("/api/projects/pick", {})).json();
    assert.equal(picked.path, beta);
    const added = await (
      await post("/api/projects", { path: picked.path })
    ).json();
    assert.equal(added.projects.length, 2);
    const betaId = added.selected;
    const betaData = await (
      await fetch(`${url}/api/dashboard?project=${betaId}`)
    ).json();
    assert.equal(betaData.project.name, "beta-ä");
    assert.equal(
      betaData.releases.find((release) => release.key === "0.7.0").goal,
      "Beta release goal",
    );
    assert.equal(
      betaData.tasks.find((task) => task.id === "F15.2").status,
      "done",
    );
    const alphaData = await (
      await fetch(`${url}/api/dashboard?project=${initial.project.id}`)
    ).json();
    assert.equal(
      alphaData.tasks.find((task) => task.id === "F15.2").status,
      "active",
    );
    assert.match(
      await (
        await fetch(`${url}/api/source?path=docs/roadmap.md&project=${betaId}`)
      ).text(),
      /Beta release goal/,
    );
    assert.equal(
      (await post("/api/projects", { path: temporary })).status,
      400,
    );
    assert.equal(
      (await post("/api/projects/select", { id: "not-registered" })).status,
      400,
    );
    assert.equal(
      (
        await post(
          "/api/projects/select",
          { id: betaId },
          { Origin: "https://outside.example" },
        )
      ).status,
      403,
    );
    const restarted = projectRegistry({ root: alpha, file: registryFile });
    assert.equal((await restarted.get()).id, betaId);
    assert.equal((await restarted.list()).projects.length, 2);
    await post("/api/projects/select", { id: initial.project.id });
    assert.equal(
      (await (await fetch(`${url}/api/dashboard`)).json()).project.name,
      "alpha",
    );
    assert.equal(
      await readFile(join(alpha, "docs/tasks/0.7.0.md"), "utf8"),
      before,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(temporary, { recursive: true, force: true });
  }
});

test("escaped/code pipes and optional Agent/Depends columns use header names", () => {
  assert.deepEqual(cells("| A.1 | Use `a | b` and c\\|d | Done |"), [
    "A.1",
    "Use `a | b` and c|d",
    "Done",
  ]);
  const data = parseTasks(
    `## A. Checks\n| ID | Status | Task |\n| --- | --- | --- |\n| A.1 | Planned. Later check | Test a result |`,
    "alpha.md",
    "0.2.x",
  );
  assert.equal(data.tasks[0].description, "Test a result");
  assert.equal(data.tasks[0].status, "planned");
  assert.equal(data.tasks[0].agent, "Unspecified");
  assert.equal(statusOf("Almost done"), "unknown");
});

test("unknown/malformed/duplicate/missing rows remain visible and cannot count as Done", () => {
  const text =
    tasksFixture.replace("Planned |", "Finished maybe |") +
    "\n| F15.99 | Broken row |\n| ID | Task | Status |\n| --- | --- | --- |\n| strange | not a card | Planned |\nF15.100 | Missing leading delimiter | Done |\n";
  const files = Object.entries(fixtureFiles).map(([path, contents]) => ({
    path,
    text: path.endsWith("0.7.0.md") ? text : contents,
  }));
  files.push({
    path: "docs/tasks/0.12.0.md",
    text: "| ID | Task | Depends on | Status |\n| --- | --- | --- | --- |\n| F15.1 | Duplicate | F99.1 | Done |",
  });
  const data = assemble(files);
  assert.equal(
    data.tasks.find((task) => task.id === "F15.3").status,
    "unknown",
  );
  assert.equal(
    data.tasks.find((task) => task.id === "F15.99").status,
    "unknown",
  );
  assert.equal(
    data.tasks.find((task) => task.id === "F15.100").status,
    "unknown",
  );
  for (const message of [
    /unrecognized status/,
    /malformed table/,
    /Duplicate task/,
    /missing dependency/,
    /not linked/,
    /Unrecognized task row/,
  ])
    assert.ok(
      data.issues.some((issue) => message.test(issue.message)),
      String(message),
    );
});

test("missing roadmap/task sources report source problems", async () => {
  const root = await mkdtemp(join(tmpdir(), "korikone-dashboard-missing-"));
  try {
    const data = await readDashboard(root);
    assert.equal(data.tasks.length, 0);
    assert.ok(data.issues.some((issue) => issue.source === "docs/roadmap.md"));
    assert.ok(data.issues.some((issue) => issue.source === "docs/tasks"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real read-only server reflects task and roadmap edits and restricts file access", async () => {
  const root = await mkdtemp(join(tmpdir(), "korikone-dashboard-server-"));
  await mkdir(join(root, "docs/tasks"), { recursive: true });
  for (const [path, text] of Object.entries(fixtureFiles))
    await writeFile(join(root, path), text);
  const server = createDashboardServer({
    root,
    git: async () => ({ commit: "fixture", dirty: true, remoteChecked: false }),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const first = await (await fetch(`${url}/api/dashboard`)).json();
    assert.equal(first.checkout.dirty, true);
    await writeFile(
      join(root, "docs/tasks/0.7.0.md"),
      tasksFixture.replace(
        "In progress: Agent One, branch codex/matcher",
        "Done: fixture integration",
      ),
    );
    await writeFile(
      join(root, "docs/roadmap.md"),
      fixtureFiles["docs/roadmap.md"].replace(
        "Better product matching",
        "Matching improved",
      ),
    );
    const second = await (await fetch(`${url}/api/dashboard`)).json();
    assert.notEqual(second.revision, first.revision);
    assert.equal(
      second.tasks.find((task) => task.id === "F15.2").status,
      "done",
    );
    assert.equal(
      second.releases.find((release) => release.key === "0.7.0").goal,
      "Matching improved",
    );
    const home = await fetch(url);
    assert.match(
      home.headers.get("content-security-policy"),
      /default-src 'self'/,
    );
    assert.match(await home.text(), /Development dashboard/);
    assert.equal(
      (await fetch(`${url}/api/source?path=docs/tasks/0.7.0.md`)).status,
      200,
    );
    for (const path of [
      "scratch/receipts/private.pdf",
      "docs/tasks/../../AGENTS.md",
      "package.json",
    ])
      assert.equal(
        (await fetch(`${url}/api/source?path=${encodeURIComponent(path)}`))
          .status,
        404,
      );
    assert.equal((await fetch(url, { method: "POST" })).status, 405);
    const outsideHost = await new Promise((resolve, reject) => {
      const probe = request(
        url,
        { headers: { host: "outside.example" } },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      probe.on("error", reject);
      probe.end();
    });
    assert.equal(outsideHost, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
