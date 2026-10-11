import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readDashboard } from "./model.mjs";
import { chooseDirectory, projectRegistry } from "./projects.mjs";

const run = promisify(execFile);
const directory = dirname(fileURLToPath(import.meta.url));
const assets = new Map([
  ["/", ["index.html", "text/html"]],
  ["/app.js", ["app.js", "text/javascript"]],
  ["/style.css", ["style.css", "text/css"]],
]);

async function gitInfo(root) {
  try {
    const options = {
      cwd: root,
      windowsHide: true,
      timeout: 3000,
      maxBuffer: 128 * 1024,
    };
    const [head, dirty] = await Promise.all([
      run("git", ["rev-parse", "--short", "HEAD"], options),
      run(
        "git",
        ["status", "--porcelain", "--", "docs/roadmap.md", "docs/tasks"],
        options,
      ),
    ]);
    return {
      commit: head.stdout.trim(),
      dirty: Boolean(dirty.stdout.trim()),
      remoteChecked: false,
    };
  } catch {
    return { commit: null, dirty: null, remoteChecked: false };
  }
}

export function createDashboardServer({
  root = resolve(directory, "../.."),
  read = readDashboard,
  git = gitInfo,
  registryFile = null,
  picker = chooseDirectory,
} = {}) {
  const registry = projectRegistry({ root, file: registryFile });
  const gitCache = new Map();
  return createServer(async (request, response) => {
    const send = (status, type, body) => {
      response.writeHead(status, {
        "Content-Type": `${type}; charset=utf-8`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      });
      response.end(request.method === "HEAD" ? "" : body);
    };
    if (
      !/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(request.headers.host || "")
    )
      return send(403, "text/plain", "Local access only");
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (
        request.method === "POST" &&
        [
          "/api/projects",
          "/api/projects/select",
          "/api/projects/pick",
        ].includes(url.pathname)
      ) {
        const origin = request.headers.origin;
        if (
          (origin && new URL(origin).host !== request.headers.host) ||
          request.headers["sec-fetch-site"] === "cross-site" ||
          !request.headers["content-type"]?.startsWith("application/json")
        )
          return send(
            403,
            "application/json",
            JSON.stringify({
              error: "Project choices require a same-origin JSON request.",
            }),
          );
        request.setEncoding("utf8");
        let body = "";
        for await (const chunk of request) {
          body += chunk;
          if (body.length > 16384)
            return send(
              413,
              "application/json",
              JSON.stringify({ error: "Project request is too large." }),
            );
        }
        try {
          const input = JSON.parse(body || "{}");
          const value =
            url.pathname === "/api/projects/pick"
              ? { path: await picker() }
              : url.pathname === "/api/projects/select"
                ? await registry.select(input.id)
                : await registry.add(input.path);
          return send(200, "application/json", JSON.stringify(value));
        } catch (error) {
          return send(
            400,
            "application/json",
            JSON.stringify({ error: error.message }),
          );
        }
      }
      if (!["GET", "HEAD"].includes(request.method))
        return send(405, "text/plain", "Repository sources are read-only");
      if (url.pathname === "/api/projects")
        return send(
          200,
          "application/json",
          JSON.stringify(await registry.list()),
        );
      if (url.pathname === "/api/dashboard") {
        const project = await registry.get(url.searchParams.get("project"));
        const data = await read(project.path);
        let cached = gitCache.get(project.id);
        if (!cached || Date.now() - cached.at > 5000) {
          cached = { value: await git(project.path), at: Date.now() };
          gitCache.set(project.id, cached);
        }
        const choices = await registry.list();
        return send(
          200,
          "application/json",
          JSON.stringify({
            ...data,
            checkout: cached.value,
            root: project.path,
            project,
            projects: choices.projects,
            registryWarning: choices.warning,
            refreshedAt: new Date().toISOString(),
          }),
        );
      }
      if (url.pathname === "/api/source") {
        const path = url.searchParams.get("path");
        if (
          path !== "docs/roadmap.md" &&
          !/^docs\/tasks\/(?:\d+\.\d+\.(?:\d+|x)|later)\.md$/.test(path || "")
        )
          return send(404, "text/plain", "Source not available");
        const project = await registry.get(url.searchParams.get("project"));
        return send(
          200,
          "text/plain",
          await readFile(resolve(project.path, path), "utf8"),
        );
      }
      if (url.pathname === "/favicon.ico") return send(204, "text/plain", "");
      const asset = assets.get(url.pathname);
      if (!asset) return send(404, "text/plain", "Not found");
      return send(
        200,
        asset[1],
        await readFile(resolve(directory, asset[0]), "utf8"),
      );
    } catch {
      return send(
        500,
        "text/plain",
        "Could not read the dashboard source. Try again shortly.",
      );
    }
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(
    process.env.DEVELOPMENT_DASHBOARD_PORT ||
      process.env.KORIKONE_DASHBOARD_PORT ||
      4317,
  );
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("DEVELOPMENT_DASHBOARD_PORT must be 1–65535.");
  const rootIndex = process.argv.indexOf("--root");
  if (rootIndex >= 0 && !process.argv[rootIndex + 1])
    throw new Error("--root needs a checkout path.");
  const root =
    rootIndex >= 0 ? process.argv[rootIndex + 1] : resolve(directory, "../..");
  const registryFile = resolve(
    process.env.DEVELOPMENT_DASHBOARD_DATA ||
      process.env.LOCALAPPDATA ||
      resolve(homedir(), ".local/share"),
    "roadmap-dashboard/projects.json",
  );
  const server = createDashboardServer({ root, registryFile });
  server.on("error", (error) => {
    console.error(`Dashboard could not start: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(
      `Development dashboard: ${url}\nSelect a local checkout. Roadmap and task files refresh every two seconds. Ctrl+C stops the server.`,
    );
    if (process.argv.includes("--open")) {
      const command =
        process.platform === "win32"
          ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
          : process.platform === "darwin"
            ? ["open", [url]]
            : ["xdg-open", [url]];
      execFile(command[0], command[1], { windowsHide: true }, (error) => {
        if (error) console.log(`Open ${url} in your browser.`);
      });
    }
  });
}
