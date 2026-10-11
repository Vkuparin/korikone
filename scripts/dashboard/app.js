let data;
let view = "overview";
let releaseKey = "";
let filter = "all";
let query = "";
let selectedTask = null;
let refreshing = false;
let lastRevision = "";
let projectId = "";
let selectionEpoch = 0;
let requestController;
const expanded = new Set();
const names = {
  planned: "Planned",
  active: "In progress",
  decision: "Needs decision",
  done: "Done",
  dropped: "Dropped",
  unknown: "Unrecognized",
};
const $ = (selector) => document.querySelector(selector);
const escape = (value = "") =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const sourceLink = (path) =>
  `/api/source?path=${encodeURIComponent(path)}&project=${encodeURIComponent(projectId)}`;
function markdown(text) {
  return escape(text)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) =>
      /^https?:\/\//.test(url)
        ? `<a href="${url}" target="_blank" rel="noreferrer">${label}</a>`
        : label,
    )
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}
const badge = (status) =>
  `<span class="badge ${status}"><i></i>${names[status]}</span>`;
const shortFeature = (feature) => feature.replace(/^[A-Z]+\d*\.\s*/, "");
function progress(counts, label = "") {
  if (!counts.scope)
    return `<p class="subtle">${counts.total ? "All cards dropped" : "Release gates; no implementation cards"}</p>`;
  return `<div class="progress-caption"><span>${escape(label || `${counts.done} of ${counts.scope} cards complete`)}</span><strong>${counts.percent}%</strong></div><div class="progress" role="progressbar" aria-label="Completed cards" aria-valuenow="${counts.done}" aria-valuemin="0" aria-valuemax="${counts.scope}"><span class="done" data-width="${(counts.done / counts.scope) * 100}"></span><span class="active" data-width="${(counts.active / counts.scope) * 100}"></span><span class="decision" data-width="${(counts.decision / counts.scope) * 100}"></span></div>`;
}

function activeRelease() {
  return data.releases.find((release) => release.key === data.activeRelease);
}
function releaseSummary(release, compact = false) {
  const isPublished = release.version === data.currentRelease?.version;
  const isActive = release.key === data.activeRelease;
  const isEarlier =
    data.releases.indexOf(release) <
    data.releases.findIndex(
      (item) => item.version === data.currentRelease?.version,
    );
  const label = isPublished
    ? "Latest release recorded"
    : isActive
      ? "Current milestone"
      : isEarlier
        ? "Earlier milestone"
        : release.key === "later"
          ? "Unassigned"
          : "Roadmap target";
  return `<article class="release-card ${isActive ? "current" : ""}"><div class="card-top"><span class="version">${release.key === "later" ? "Later" : `v${escape(release.version)}`}</span><span class="release-label">${label}</span></div><h3>${escape(release.goal)}</h3>${progress(release.counts)}<p class="counts">${release.counts.active} in progress · ${release.counts.decision} need a decision${release.counts.unknown ? ` · ${release.counts.unknown} unrecognized` : ""}</p>${compact ? "" : `<details><summary>Release criteria</summary><p>${markdown(release.criterion)}</p></details>`}<button class="text-button" data-release="${escape(release.key)}">Explore work <span>→</span></button></article>`;
}

function overview() {
  const release = activeRelease();
  const current = data.currentRelease;
  const cards = release
    ? data.tasks.filter((task) => task.source === release.taskFile)
    : [];
  const working = cards.filter((task) => task.status === "active");
  const needs = cards.filter(
    (task) => task.status === "decision" || task.status === "unknown",
  );
  return `<section class="spotlight"><div><p class="eyebrow">${release ? "CURRENT MILESTONE" : "DEVELOPMENT"}</p><h2>${release ? `v${escape(release.version)}` : "Your product roadmap"}</h2><p>${escape(release?.goal || "Read the release goals and recorded implementation status.")}</p><button class="spotlight-button" data-release="${escape(release?.key || "all")}">See current work →</button></div><div class="spotlight-progress"><div class="big-number">${release?.counts.percent ?? "—"}<span>${release?.counts.percent == null ? "" : "%"}</span></div><span>of implementation cards complete</span>${release ? progress(release.counts) : ""}<small>Release criteria still apply.</small></div></section>
    <div class="stat-grid"><article class="stat"><span>Latest release recorded</span><strong>${current ? `v${escape(current.version)}` : "Not recorded"}</strong>${current ? `<a href="${escape(current.url)}" target="_blank" rel="noreferrer">Release notes ↗</a>` : ""}</article><article class="stat"><span>In progress this milestone</span><strong>${working.length}</strong><small>${new Set(working.map((task) => task.featureId)).size} feature groups</small></article><article class="stat"><span>Decisions this milestone</span><strong>${needs.length}</strong><button class="text-button" data-view="attention">See attention items →</button></article><article class="stat"><span>Still planned this milestone</span><strong>${cards.filter((task) => task.status === "planned").length}</strong><small>Card counts, not effort estimates</small></article></div>
    <div class="section-heading"><h2>Work in motion</h2><button class="text-button" data-view="work">View feature groups →</button></div><div class="motion-grid">${working.length ? working.slice(0, 6).map(taskCard).join("") : `<div class="empty">No cards are currently marked In progress for this milestone.</div>`}</div>
    <div class="section-heading"><h2>Coming next</h2><button class="text-button" data-view="roadmap">Full roadmap →</button></div><div class="release-grid">${data.releases
      .filter(
        (item) =>
          item.key === data.activeRelease ||
          (data.releases.indexOf(item) >
            data.releases.findIndex((r) => r.key === data.activeRelease) &&
            item.key !== "later"),
      )
      .slice(0, 3)
      .map((item) => releaseSummary(item, true))
      .join("")}</div>`;
}

function taskCard(task) {
  return `<button class="task-card" data-task="${escape(task.id)}" data-source="${escape(task.source)}"><div class="card-top"><span class="task-id">${escape(task.id)}</span>${badge(task.status)}</div><h3>${escape(task.title)}</h3><p>${escape(shortFeature(task.feature))}</p><div class="task-meta"><span>${escape(task.agent)}</span>${task.integration ? `<span>${escape(task.integration)}</span>` : task.waitingFor.length ? `<span>${task.waitingFor.length} prerequisite${task.waitingFor.length === 1 ? "" : "s"} unfinished</span>` : ""}</div></button>`;
}

function toolbar(attention = false) {
  return `<div class="toolbar"><label>Release<select id="release-select"><option value="all" ${releaseKey === "all" ? "selected" : ""}>All work</option>${data.releases
    .filter((release) => release.taskFile)
    .map(
      (release) =>
        `<option value="${escape(release.key)}" ${releaseKey === release.key ? "selected" : ""}>${release.key === "later" ? "Later / unassigned" : `v${escape(release.version)}`}</option>`,
    )
    .join("")}</select></label>${
    attention
      ? ""
      : `<label>Status<select id="status-select"><option value="all">All statuses</option>${Object.entries(
          names,
        )
          .map(
            ([key, name]) =>
              `<option value="${key}" ${key === filter ? "selected" : ""}>${name}</option>`,
          )
          .join("")}</select></label>`
  }<label class="search-label">Find work<input id="filter-search" type="search" value="${escape(query)}" placeholder="Search features, tasks or IDs" /></label></div>`;
}

function filteredTasks() {
  const release = data.releases.find((item) => item.key === releaseKey);
  return data.tasks.filter(
    (task) =>
      (releaseKey === "all" || task.source === release?.taskFile) &&
      (filter === "all" || task.status === filter) &&
      `${task.id} ${task.feature} ${task.description} ${task.evidence}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
}

function work(attention = false) {
  const tasks = filteredTasks().filter(
    (task) =>
      !attention || task.status === "decision" || task.status === "unknown",
  );
  if (attention)
    return `${toolbar(true)}<p class="subtle">Explicit Needs decision and unrecognized statuses. Unfinished prerequisites are shown separately on task details.</p><div class="motion-grid">${tasks.map(taskCard).join("") || `<div class="empty">No decision or unrecognized-status cards match this view.</div>`}</div>`;
  const groups = new Map();
  for (const task of tasks) {
    const key = `${task.version}:${task.featureId}`;
    if (!groups.has(key))
      groups.set(key, {
        key,
        version: task.version,
        name: task.feature,
        tasks: [],
      });
    groups.get(key).tasks.push(task);
  }
  return `${toolbar()}<p class="subtle result-count">${tasks.length} matching cards · Open a feature to see its tasks.</p><div class="features">${
    [...groups.values()]
      .map((group) => {
        const all = data.tasks.filter(
          (task) =>
            task.version === group.version &&
            task.featureId === group.tasks[0].featureId,
        );
        const counts = {
          total: all.length,
          scope: all.filter((task) => task.status !== "dropped").length,
          done: all.filter((task) => task.status === "done").length,
          active: all.filter((task) => task.status === "active").length,
          decision: all.filter((task) => task.status === "decision").length,
        };
        counts.percent = counts.scope
          ? Math.round((counts.done / counts.scope) * 100)
          : null;
        return `<details class="feature" data-feature="${escape(group.key)}" ${expanded.has(group.key) || query || filter !== "all" ? "open" : ""}><summary><div><span class="feature-version">${group.version === "later" ? "Unassigned" : `v${escape(group.version)}`}</span><h2>${escape(shortFeature(group.name))}</h2><p>${counts.active} in progress · ${counts.decision} need a decision · ${group.tasks.length} visible cards</p></div><div class="feature-progress">${progress(counts)}</div><span class="chevron">⌄</span></summary><div class="feature-tasks">${group.tasks.map(taskCard).join("")}</div></details>`;
      })
      .join("") || `<div class="empty">No tasks match these filters.</div>`
  }</div>`;
}

function roadmap() {
  return `<p class="subtle">Release order and goals come directly from the roadmap. Targets have no implied dates.</p><div class="roadmap-grid">${data.releases.map((release) => releaseSummary(release)).join("")}</div><div class="section-heading"><h2>Product direction and open decisions</h2></div>${data.sections.map((section) => `<details class="direction"><summary>${escape(section.title)}</summary><div class="source-prose">${section.lines.map((line) => `<p>${markdown(line)}</p>`).join("")}</div></details>`).join("")}`;
}

function detail() {
  if (!selectedTask) return;
  const task = data.tasks.find(
    (item) =>
      item.id === selectedTask.id && item.source === selectedTask.source,
  );
  if (!task) {
    $("#task-detail").innerHTML =
      `<h2 id="detail-title">Task moved or removed</h2><p>The source changed. Close this panel and find the current card.</p>`;
    return;
  }
  $("#task-detail").innerHTML =
    `<p class="eyebrow">${escape(task.id)} · ${task.version === "later" ? "UNASSIGNED" : `v${escape(task.version)}`}</p><h2 id="detail-title">${escape(task.title)}</h2><div class="detail-badges">${badge(task.status)}<span>${escape(task.agent)}</span>${task.integration ? `<span>${escape(task.integration)}</span>` : ""}</div><h3>Scope and completion criteria</h3><p class="source-prose">${markdown(task.description)}</p><h3>Recorded status and evidence</h3><p class="source-prose">${markdown(task.evidence)}</p><h3>Dependencies</h3><p>${
      task.dependencies.length
        ? task.dependencies
            .map((id) => {
              const dependency = data.tasks.find((item) => item.id === id);
              return dependency
                ? `<button class="dependency ${dependency.status === "done" ? "satisfied" : ""}" data-task="${escape(id)}" data-source="${escape(dependency.source)}">${escape(id)} · ${names[dependency.status]}</button>`
                : `<span class="badge unknown">${escape(id)} · Missing</span>`;
            })
            .join(" ")
        : escape(task.dependencyText || "None recorded")
    }</p><p class="subtle">Statuses and integration notes are reported by the task file. This dashboard does not verify builds or owner acceptance.</p><a class="source-link" href="${sourceLink(task.source)}" target="_blank" rel="noreferrer">View source · ${escape(task.source)}:${task.line} ↗</a>`;
}

function render() {
  if (!data) return;
  const focus = document.activeElement;
  const focusId = focus?.id;
  const selection = focus?.selectionStart;
  const scroll = window.scrollY;
  const headings = {
    overview: [
      "THE BIG PICTURE",
      "Overview",
      "Release goals, current work and the decisions ahead.",
    ],
    roadmap: [
      "THE DIRECTION",
      "Roadmap",
      "A clear path through the planned releases.",
    ],
    work: [
      "THE BUILD",
      "Current work",
      "Feature progress with the implementation details one click away.",
    ],
    attention: [
      "YOUR INPUT",
      "Needs attention",
      "Recorded decisions and source problems that need a closer look.",
    ],
  };
  const heading = headings[view];
  $("#eyebrow").textContent = heading[0];
  $("#page-title").textContent = heading[1];
  $("#page-description").textContent = heading[2];
  document.querySelectorAll("nav [data-view]").forEach((button) => {
    if (button.dataset.view === view)
      button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  $("#content").innerHTML =
    view === "overview"
      ? overview()
      : view === "roadmap"
        ? roadmap()
        : work(view === "attention");
  document.querySelectorAll(".progress [data-width]").forEach((bar) => {
    bar.style.width = `${bar.dataset.width}%`;
  });
  $("#content").setAttribute("aria-busy", "false");
  const issues = $("#source-issues");
  issues.hidden = !data.issues.length;
  issues.innerHTML = data.issues.length
    ? `<details class="notice"><summary>${data.issues.length} source issue${data.issues.length === 1 ? "" : "s"} · Counts may be incomplete</summary><ul>${data.issues.map((issue) => `<li><a href="${sourceLink(issue.source)}" target="_blank" rel="noreferrer">${escape(issue.source)}:${issue.line}</a> · ${escape(issue.message)}</li>`).join("")}</ul></details>`
    : "";
  detail();
  if (focusId && document.getElementById(focusId)) {
    const target = document.getElementById(focusId);
    target.focus({ preventScroll: true });
    if (target instanceof HTMLInputElement && selection != null)
      target.setSelectionRange(selection, selection);
  }
  window.scrollTo(0, scroll);
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("button, .brand");
  if (!button) return;
  if (button.classList.contains("brand")) {
    view = "overview";
    render();
  }
  if (button.dataset.view) {
    view = button.dataset.view;
    filter = "all";
    render();
    window.scrollTo(0, 0);
  }
  if (button.dataset.release) {
    releaseKey = button.dataset.release;
    view = "work";
    filter = "all";
    query = "";
    render();
    window.scrollTo(0, 0);
  }
  if (button.dataset.task) {
    selectedTask = { id: button.dataset.task, source: button.dataset.source };
    detail();
    if (!$("#task-dialog").open) $("#task-dialog").showModal();
  }
});
document.addEventListener("change", (event) => {
  if (event.target.id === "project-select") chooseProject(event.target.value);
  if (event.target.id === "release-select") {
    releaseKey = event.target.value;
    render();
  }
  if (event.target.id === "status-select") {
    filter = event.target.value;
    render();
  }
});
document.addEventListener("input", (event) => {
  if (event.target.id === "filter-search") {
    query = event.target.value;
    render();
  }
});
document.addEventListener(
  "toggle",
  (event) => {
    const key = event.target.dataset?.feature;
    if (key) {
      if (event.target.open) expanded.add(key);
      else expanded.delete(key);
    }
  },
  true,
);
$("#close-detail").addEventListener("click", () => $("#task-dialog").close());
$("#task-dialog").addEventListener("close", () => {
  selectedTask = null;
});
$("#refresh").addEventListener("click", () => refresh(true));

async function projectRequest(path, input) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Could not save the checkout choice.");
  return result;
}

async function switchProject(id) {
  selectionEpoch++;
  requestController?.abort();
  refreshing = false;
  projectId = id;
  releaseKey = "";
  filter = "all";
  query = "";
  selectedTask = null;
  expanded.clear();
  lastRevision = "";
  data = null;
  $("#task-dialog").close();
  $("#source-issues").hidden = true;
  $("#content").innerHTML =
    '<div class="empty">Reading the selected checkout…</div>';
  $("#content").setAttribute("aria-busy", "true");
  await refresh(true);
}

async function chooseProject(id) {
  $("#project-select").disabled = true;
  try {
    await projectRequest("/api/projects/select", { id });
    await switchProject(id);
  } catch (error) {
    $("#load-error").hidden = false;
    $("#load-error").textContent = error.message;
    $("#project-select").value = projectId;
  } finally {
    $("#project-select").disabled = false;
  }
}

$("#add-project").addEventListener("click", () => {
  $("#project-error").hidden = true;
  $("#project-path").value = "";
  $("#project-dialog").showModal();
  $("#project-path").focus();
});
$("#cancel-project").addEventListener("click", () =>
  $("#project-dialog").close(),
);
$("#browse-project").addEventListener("click", async () => {
  $("#browse-project").disabled = true;
  $("#project-error").hidden = true;
  try {
    const result = await projectRequest("/api/projects/pick", {});
    if (result.path) $("#project-path").value = result.path;
  } catch (error) {
    $("#project-error").hidden = false;
    $("#project-error").textContent = error.message;
  } finally {
    $("#browse-project").disabled = false;
  }
});
$("#project-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#save-project").disabled = true;
  $("#project-error").hidden = true;
  try {
    const result = await projectRequest("/api/projects", {
      path: $("#project-path").value.trim(),
    });
    $("#project-dialog").close();
    await switchProject(result.selected);
  } catch (error) {
    $("#project-error").hidden = false;
    $("#project-error").textContent = error.message;
  } finally {
    $("#save-project").disabled = false;
  }
});

async function refresh(force = false) {
  if (refreshing) return;
  refreshing = true;
  const epoch = selectionEpoch;
  requestController = new AbortController();
  try {
    const response = await fetch(
      `/api/dashboard${projectId ? `?project=${encodeURIComponent(projectId)}` : ""}`,
      { cache: "no-store", signal: requestController.signal },
    );
    if (!response.ok) throw new Error(`Server returned ${response.status}`);
    const next = await response.json();
    if (epoch !== selectionEpoch) return;
    const changed = next.revision !== lastRevision;
    data = next;
    $("#project-notice").hidden = !data.registryWarning;
    $("#project-notice").textContent = data.registryWarning || "";
    projectId = data.project.id;
    const choices = data.projects
      .map(
        (project) =>
          `<option value="${escape(project.id)}">${escape(project.name)} · ${escape(project.path)}</option>`,
      )
      .join("");
    if ($("#project-select").innerHTML !== choices)
      $("#project-select").innerHTML = choices;
    $("#project-select").value = projectId;
    document.title = `${data.project.name} · Development dashboard`;
    if (!releaseKey) releaseKey = data.activeRelease;
    lastRevision = data.revision;
    $("#connection").textContent =
      `Live · refreshed ${new Date(data.refreshedAt).toLocaleTimeString()}`;
    $("#connection").className = "connected";
    $("#source-info").textContent =
      `${data.project.name} · local working files · ${data.checkout?.commit || "commit unavailable"} · ${data.checkout?.dirty ? "uncommitted documentation" : "remote sync not checked"} · ${data.root}`;
    $("#load-error").hidden = true;
    if (changed || force) render();
  } catch (error) {
    if (epoch !== selectionEpoch || error.name === "AbortError") return;
    $("#connection").textContent = "Disconnected · retrying";
    $("#connection").className = "disconnected";
    $("#load-error").hidden = false;
    $("#load-error").textContent =
      `Dashboard could not refresh. ${data ? "Showing the last loaded snapshot. " : ""}${error.message}`;
  } finally {
    if (epoch === selectionEpoch) refreshing = false;
  }
}
await refresh();
setInterval(() => refresh(), 2000);
