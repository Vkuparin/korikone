import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export async function inspectProject(path) {
  if (typeof path !== "string" || !isAbsolute(path))
    throw new Error("Enter an absolute path to a local checkout.");
  let root;
  try {
    root = await realpath(path.trim());
    if (
      !(await stat(join(root, "docs/roadmap.md"))).isFile() ||
      !(await stat(join(root, "docs/tasks"))).isDirectory()
    )
      throw new Error();
  } catch {
    throw new Error(
      "This folder needs docs/roadmap.md and a docs/tasks directory. Use the workflow starter kit for a new project.",
    );
  }
  const identity = process.platform === "win32" ? root.toLowerCase() : root;
  return {
    id: createHash("sha256").update(identity).digest("hex").slice(0, 16),
    name: basename(root),
    path: root,
  };
}

export async function chooseDirectory() {
  if (process.platform !== "win32")
    throw new Error(
      "Paste the checkout path below; the native folder picker is available on Windows.",
    );
  const script = `Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select a checkout with docs/roadmap.md and docs/tasks'
$dialog.ShowNewFolderButton = $false
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
try {
  if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
    Write-Output $dialog.SelectedPath
  }
} finally { $dialog.Dispose(); $owner.Dispose() }`;
  const { stdout } = await promisify(execFile)(
    "powershell.exe",
    ["-NoProfile", "-STA", "-Command", script],
    { windowsHide: true, timeout: 120000, maxBuffer: 16384 },
  );
  return stdout.trim() || null;
}

export function projectRegistry({ root, file = null }) {
  let state;
  let loading;
  let queued = Promise.resolve();
  const load = async () => {
    if (state) return state;
    if (loading) return loading;
    loading = (async () => {
      const initial = await inspectProject(root);
      let saved = { projects: [], selected: initial.id };
      let warning = null;
      if (file) {
        try {
          saved = JSON.parse(await readFile(file, "utf8"));
          if (!Array.isArray(saved.projects))
            throw new Error("Invalid project list");
        } catch (error) {
          if (error.code !== "ENOENT")
            warning =
              "Saved project list could not be read. It will be replaced when you save a project choice.";
          saved = { projects: [], selected: initial.id };
        }
      }
      const projects = saved.projects.filter(
        (project) =>
          typeof project?.id === "string" &&
          typeof project?.name === "string" &&
          typeof project?.path === "string" &&
          isAbsolute(project.path),
      );
      if (!projects.some((project) => project.id === initial.id))
        projects.unshift(initial);
      state = {
        projects,
        selected: projects.some((project) => project.id === saved.selected)
          ? saved.selected
          : initial.id,
        warning,
      };
      return state;
    })();
    try {
      return await loading;
    } finally {
      loading = null;
    }
  };
  const save = async (next) => {
    if (file) {
      await mkdir(dirname(file), { recursive: true });
      const temporary = `${file}.${process.pid}.tmp`;
      await writeFile(
        temporary,
        JSON.stringify(
          { projects: next.projects, selected: next.selected },
          null,
          2,
        ),
        "utf8",
      );
      await rename(temporary, file);
    }
    state = { ...next, warning: null };
    return state;
  };
  const update = (operation) => {
    const next = queued.then(async () => operation(await load()));
    queued = next.catch(() => {});
    return next;
  };
  return {
    list: load,
    get: async (id) => {
      const current = await load();
      const project = current.projects.find(
        (project) => project.id === (id || current.selected),
      );
      if (!project) throw new Error("Select a registered checkout.");
      return project;
    },
    add: (path) =>
      update(async (current) => {
        const project = await inspectProject(path);
        const projects = current.projects.some((item) => item.id === project.id)
          ? current.projects
          : [...current.projects, project];
        return save({ ...current, projects, selected: project.id });
      }),
    select: (id) =>
      update(async (current) => {
        if (!current.projects.some((project) => project.id === id))
          throw new Error("Select a registered checkout.");
        return save({ ...current, selected: id });
      }),
  };
}
