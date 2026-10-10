import { readFile, mkdir, copyFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const source = join("test-results", "interface-audit");
const output = join("docs", "design", "0.6.0", "implementation");
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const cases = [];
await mkdir(output, { recursive: true });
for (const language of ["fi", "en"]) {
  for (const appearance of ["light", "dark"]) {
    for (const width of [1280, 800]) {
      const prefix = `${language}-${appearance}-${width}`;
      const entry = JSON.parse(
        await readFile(join(source, `${prefix}.json`), "utf8"),
      );
      if (
        !entry.developmentMode ||
        !entry.keyboardOnly ||
        !entry.reducedMotion ||
        entry.storeWrites !== 0
      )
        throw new Error(`Incomplete fixture evidence: ${prefix}`);
      for (const file of entry.captures) {
        if (!/^(fi|en)-(light|dark)-(1280|800)-[a-z-]+\.png$/.test(file))
          throw new Error("Invalid capture filename");
        await copyFile(join(source, file), join(output, file));
      }
      cases.push(entry);
    }
  }
}
const manifest = {
  sourceCommit: commit,
  date: new Date().toISOString(),
  kind: "source-development-fixtures",
  liveRequests: 0,
  cases,
};
await writeFile(
  join(output, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
await writeFile(
  join(output, "index.html"),
  `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Korikone v0.6.0 implementation review</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#f3f6f3;color:#203b2e;margin:0}main{max-width:1320px;margin:auto;padding:24px}h1{font-size:28px}label{display:inline-flex;flex-direction:column;margin:0 16px 16px 0;gap:4px}select,a{font:inherit}select{padding:8px;border:1px solid #76877c;border-radius:8px;background:white;color:inherit}img{display:block;max-width:100%;height:auto;border:1px solid #b6c6bb}a{color:#256343}p{max-width:1000px}code{overflow-wrap:anywhere}:focus-visible{outline:3px solid #126eab;outline-offset:3px}</style>
<main><h1>Korikone v0.6.0 source review</h1>
<p>Actual application captures from isolated development profiles. All eight configurations use keyboard interaction and reduced motion. One local pending generation was cancelled per configuration; no live ChatGPT request or retailer write was made. This gallery supports layout review. Startup flash needs observation in the app.</p>
<p>Source commit: <code>${commit}</code>. This is source implementation evidence, not a published v0.6.0 release or owner acceptance.</p>
<label>Language<select id="language"><option value="fi">Suomi</option><option value="en">English</option></select></label>
<label>Palette<select id="appearance"><option value="light">Light</option><option value="dark">Dark</option></select></label>
<label>Window<select id="width"><option value="1280">1280 × 800</option><option value="800">800 × 600</option></select></label>
<label>Screen<select id="screen"></select></label>
<p id="description" aria-live="polite"></p><p><a id="original">Open original image</a></p><img id="capture" alt="">
</main><script>
const evidence = ${JSON.stringify(cases)};
const labels = {"shopping-empty":"Shopping · empty","shopping-working":"Shopping · working composer","shopping-populated":"Shopping · populated viewport","shopping-list":"Shopping · complete list","shopping-unresolved":"Shopping · unresolved row","shopping-exception":"Shopping · transfer decision","settings-validation":"Settings · validation error","settings-general":"Settings · General","settings-household":"Settings · Household","settings-stores":"Settings · Stores","settings-ai":"Settings · ChatGPT and AI","settings-data":"Settings · Data","settings-advanced":"Settings · Advanced","settings-about":"Settings · About"};
const controls = ["language","appearance","width","screen"].map(id=>document.getElementById(id));
const screens = evidence[0].captures.map(file=>file.slice("fi-light-1280-".length,-4));
for(const value of screens){const option=document.createElement('option');option.value=value;option.textContent=labels[value]||value;controls[3].append(option)}
controls[3].value="shopping-populated";
function show(){const prefix=controls.slice(0,3).map(control=>control.value).join('-');const file=prefix+'-'+controls[3].value+'.png';const img=document.getElementById('capture');img.src=file;img.alt=(labels[controls[3].value]||controls[3].value)+' · '+prefix;const link=document.getElementById('original');link.href=file;document.getElementById('description').textContent=img.alt+'. Viewport captures retain the selected window size; region captures show the full region and may be taller.'}
for(const control of controls)control.addEventListener('change',show);show();
</script></html>`,
);
process.stdout.write(
  `Exported ${cases.length} configurations and ${cases.reduce((n, entry) => n + entry.captures.length, 0)} captures to ${output}\n`,
);
