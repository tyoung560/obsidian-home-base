/* Builds harness/out/<name>.html: the plugin running against a copy of a vault folder.
   Usage: node harness/build.mjs /path/to/vault [name]   (name defaults to index)
   The household workspace: node harness/build.mjs harness/fixtures/household household */
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const vaultDir = process.argv[2];
const outName = process.argv[3] ?? "index";
if (!vaultDir) { console.error("usage: node harness/build.mjs <vault folder>"); process.exit(1); }
const seed = {};
const walk = (d) => { for (const n of fs.readdirSync(d)) { if (n.startsWith(".")) continue; const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p); else if (n.endsWith(".md")) seed[path.relative(vaultDir, p).split(path.sep).join("/")] = fs.readFileSync(p, "utf8"); } };
walk(vaultDir);

const here = path.dirname(new URL(import.meta.url).pathname);
const out = path.join(here, "out");
fs.mkdirSync(out, { recursive: true });
const r = await esbuild.build({ entryPoints: [path.join(here, "entry.ts")], bundle: true, write: false, format: "iife", target: "es2020", alias: { obsidian: path.join(here, "obsidian-shim.ts") }, define: { VAULT: JSON.stringify(seed) } });
const css = fs.readFileSync(path.join(here, "..", "styles.css"), "utf8");
const theme = fs.readFileSync(path.join(here, "theme.css"), "utf8");
fs.writeFileSync(path.join(out, `${outName}.html`), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Home Base harness</title><style>${theme}\n${css}</style>
<script>window.HB_PHONE = new URLSearchParams(location.search).has("phone");</script>
<body class="${"theme-light"}"><div id="mount"></div><script>if (new URLSearchParams(location.search).has("dark")) document.body.className = "theme-dark";</script><script>${r.outputFiles[0].text}</script></body>`);
console.log(`harness/out/${outName}.html: ${Object.keys(seed).length} notes`);
