# Development dashboard

From the repository directory, run:

```powershell
npm run dashboard
```

This starts a local server and opens `http://127.0.0.1:4317` in your browser. Keep the terminal running; Ctrl+C stops it. You can also open that address in Codex's browser panel. Node.js 24 or newer is sufficient; the dashboard does not need an application build, retailer connection or AI account.

## Choose a project

The header's checkout selector switches between projects. **Add checkout** opens a small form: choose a folder with the Windows picker or paste its absolute path, then **Open project**. The selected folder must contain `docs/roadmap.md` and `docs/tasks/` using the shared workflow. Project names come from checkout folder names. Roadmap, release goals, features, counts, dependencies and evidence all come from the selected project's files.

Project choices and the last selected project are saved locally at `%LOCALAPPDATA%/roadmap-dashboard/projects.json` on Windows (under `~/.local/share/roadmap-dashboard/` on other platforms). This file is outside the repositories. `DEVELOPMENT_DASHBOARD_DATA` can select a different preferences directory. The dashboard never initializes or writes selected projects, scans for other checkouts or uploads their contents. Only explicitly added projects are read. On non-Windows systems, use the path entry.

Use the [workflow starter kit](workflow.md) to prepare future projects. One dashboard installation can serve all compatible checkouts; no per-project dashboard reporting is needed.

The Overview shows the next unfinished milestone after the latest release recorded in the roadmap, its completed-card count, active work and upcoming releases. Roadmap shows all release goals and criteria, plus expandable product decisions. Current work groups tasks by feature with release/status/search filters. Needs attention shows explicit Needs decision and unrecognized statuses. Click a task for its scope, dependencies and recorded evidence.

## Automatic updates

The browser rereads the selected checkout's `docs/roadmap.md` and version files in `docs/tasks/` every two seconds. New version files are discovered automatically. Filters, search text, open feature groups and task details survive source updates within the same project. Switching projects resets those task filters and closes old details so different projects cannot mix. Changes outside a checkout appear when the usual agent publishing/synchronization or your Git update brings them there. The dashboard does not fetch, merge or modify Git state.

Agents keep the existing reporting workflow. No extra summaries, metadata fields, dashboard edits or AI calls are needed. The dashboard reads files and renders them deterministically; it does not write a second task register. Private `scratch/` material is never read or served. Assets stay local, with no external fonts, analytics or scripts.

The header shows the last successful refresh time; the footer identifies the checkout and uncommitted documentation. GitHub synchronization is not verified by the dashboard. The latest published release is the one recorded in the roadmap, not inferred from task percentages or package metadata.

## Reading progress honestly

Completion percentages count Done cards out of all cards except Dropped. Cards have different sizes, so percentages are not estimates of effort, time or release readiness. Done evidence stays visible, including local-only work, reported integration and remaining owner acceptance. Integration badges summarize explicit wording; they do not independently verify commits, tests or releases.

Unfinished prerequisites are shown on cards and task details; they do not silently change a Planned card to Blocked. Unknown statuses, malformed rows, duplicate IDs, missing dependencies and task files not linked from the roadmap produce a visible source warning. Unknown cards remain in the counts and never count as complete. A failed refresh retains the last loaded snapshot with a disconnected warning.

## Commands and checks

Use `node scripts/dashboard/server.mjs` to start without opening a browser. To use another port:

```powershell
$env:DEVELOPMENT_DASHBOARD_PORT = '4318'
npm run dashboard
```

The server binds only to `127.0.0.1` and serves a fixed set of dashboard assets and roadmap/task sources from the selected checkout. Local project-choice endpoints save only dashboard preferences and open the requested folder picker; repository sources remain read-only. Hosted publication is separate future scope. The original `KORIKONE_DASHBOARD_PORT` variable remains supported.

To start from another checkout, use `node scripts/dashboard/server.mjs --root D:/repos/another-project --open`. See the starter kit for copying the tooling into an independent project.

Focused deterministic checks:

```powershell
npm run test:dashboard
# Use installed Edge for the one browser fixture journey on Windows:
$env:KORIKONE_DASHBOARD_BROWSER_CHANNEL = 'msedge'
npm run test:dashboard:ui
```

Parser/server fixtures cover current table variants, grouping, statuses, malformed sources, dependencies, refresh, restricted access, project persistence/isolation and starter-template compatibility. The browser fixture uses temporary synthetic checkouts and covers task/roadmap updates, retained filters/expanded features/details, project switching/reload, source warnings, narrow layout and disconnection. It stubs only the native folder picker and makes zero AI or retailer requests. These commands do not run Korikone's full release flow.
