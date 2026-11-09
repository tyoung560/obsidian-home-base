/* A small stand-in for the parts of Obsidian's API that Home Base uses. Dev harness only. */
type Cb = (...a: unknown[]) => unknown;

declare global {
  interface HTMLElement {
    createEl<K extends keyof HTMLElementTagNameMap>(tag: K, o?: { cls?: string | string[]; text?: string; attr?: Record<string, string> }): HTMLElementTagNameMap[K];
    createDiv(o?: { cls?: string | string[]; text?: string }): HTMLDivElement;
    createSpan(o?: { cls?: string | string[]; text?: string }): HTMLSpanElement;
    empty(): void;
    setText(t: string): void;
    addClass(...c: string[]): void;
    removeClass(...c: string[]): void;
    toggleClass(c: string, v: boolean): void;
    appendText(t: string): void;
  }
}
const P = HTMLElement.prototype as any;
P.createEl = function (tag: string, o: any = {}) {
  const e = document.createElement(tag);
  const cls = Array.isArray(o.cls) ? o.cls : o.cls ? String(o.cls).split(" ") : [];
  for (const c of cls) e.classList.add(c);
  if (o.text != null) e.textContent = o.text;
  if (o.attr) for (const [k, v] of Object.entries(o.attr)) e.setAttribute(k, String(v));
  this.appendChild(e);
  return e;
};
P.createDiv = function (o: any) { return this.createEl("div", o); };
P.createSpan = function (o: any) { return this.createEl("span", o); };
P.empty = function () { this.innerHTML = ""; };
P.setText = function (t: string) { this.textContent = t; };
P.addClass = function (...c: string[]) { this.classList.add(...c); };
P.removeClass = function (...c: string[]) { this.classList.remove(...c); };
P.toggleClass = function (c: string, v: boolean) { this.classList.toggle(c, v); };
P.appendText = function (t: string) { this.appendChild(document.createTextNode(t)); };

const ICONS: Record<string, string> = {
  plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>', "chevron-right": '<path d="M9 6l6 6-6 6"/>', "chevron-left": '<path d="M15 6l-6 6 6 6"/>',
  home: '<path d="M3 11l9-7 9 7v9H3z"/>', kanban: '<path d="M5 4v16M12 4v10M19 4v13"/>', calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/>',
  repeat: '<path d="M4 12a8 8 0 0 1 14-5M20 12a8 8 0 0 1-14 5"/>', users: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/>', "pen-line": '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  "list-checks": '<path d="M9 6h11M9 12h11M9 18h11"/>', "more-horizontal": '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>', inbox: '<path d="M4 13l2-8h12l2 8v6H4z"/>',
};
export function setIcon(el: HTMLElement, name: string): void {
  el.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? '<circle cx="12" cy="12" r="4"/>'}</svg>`;
}

export class Events {
  private h: Record<string, Cb[]> = {};
  on(n: string, cb: Cb) { (this.h[n] ??= []).push(cb); return { n, cb }; }
  off(n: string, cb: Cb) { this.h[n] = (this.h[n] ?? []).filter((x) => x !== cb); }
  trigger(n: string, ...a: unknown[]) { for (const cb of this.h[n] ?? []) cb(...a); }
}

export const Platform = { isMobile: (globalThis as any).HB_PHONE === true, isPhone: (globalThis as any).HB_PHONE === true, isDesktop: (globalThis as any).HB_PHONE !== true };

export class Notice {
  constructor(msg: string) {
    const n = document.createElement("div");
    n.className = "harness-notice";
    n.textContent = msg;
    document.body.appendChild(n);
    (window as any).HB_NOTICES = [...((window as any).HB_NOTICES ?? []), msg];
    setTimeout(() => n.remove(), 2500);
  }
}

export class TAbstractFile { constructor(public path: string) {} get name() { return this.path.split("/").pop() as string; } }
export class TFile extends TAbstractFile {
  get basename() { return this.name.replace(/\.md$/, ""); }
  get extension() { return "md"; }
}
export class TFolder extends TAbstractFile {}

export function normalizePath(p: string): string { return p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, ""); }

/* ---------- frontmatter: just enough YAML for the vault ---------- */
function parseValue(v: string): unknown {
  const t = v.trim();
  if (t === "") return null;
  if (t === "[]") return [];
  if (t.startsWith("[") && t.endsWith("]")) return t.slice(1, -1).split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  if (/^".*"$/.test(t) || /^'.*'$/.test(t)) return t.slice(1, -1);
  if (t === "true" || t === "false") return t === "true";
  return t;
}
export function parseFrontmatter(text: string): Record<string, unknown> | undefined {
  if (!text.startsWith("---\n")) return undefined;
  const end = text.indexOf("\n---", 4);
  if (end < 0) return undefined;
  const fm: Record<string, unknown> = {};
  let key = "";
  for (const line of text.slice(4, end).split("\n")) {
    const li = /^\s+-\s+(.*)$/.exec(line);
    if (li && key) { const cur = fm[key]; fm[key] = [...(Array.isArray(cur) ? cur : []), parseValue(li[1] as string)]; continue; }
    const kv = /^([\w-]+):\s?(.*)$/.exec(line);
    if (kv) { key = kv[1] as string; fm[key] = parseValue(kv[2] as string); }
  }
  return fm;
}
function dumpValue(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.length ? "\n" + v.map((x) => `  - ${JSON.stringify(String(x))}`).join("\n") : "[]";
  return String(v);
}
function writeFrontmatter(text: string, fm: Record<string, unknown>): string {
  const end = text.startsWith("---\n") ? text.indexOf("\n---", 4) : -1;
  const body = end >= 0 ? text.slice(end + 4).replace(/^\n/, "") : text;
  const lines = Object.entries(fm).map(([k, v]) => `${k}:${Array.isArray(v) && v.length ? "" : " "}${dumpValue(v)}`.replace(/: $/, ":"));
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

export class Vault extends Events {
  files = new Map<string, string>();
  private objs = new Map<string, TFile>();
  constructor(seed: Record<string, string>) { super(); for (const [p, t] of Object.entries(seed)) this.files.set(p, t); }
  file(p: string) { let f = this.objs.get(p); if (!f) { f = new TFile(p); this.objs.set(p, f); } return f; }
  getName() { return "obsidian"; }
  getMarkdownFiles() { return [...this.files.keys()].filter((p) => p.endsWith(".md")).map((p) => this.file(p)); }
  async cachedRead(f: TFile) { return this.files.get(f.path) ?? ""; }
  async read(f: TFile) { return this.cachedRead(f); }
  async modify(f: TFile, t: string) { this.files.set(f.path, t); this.trigger("modify", f); (this as any).cache?.trigger("changed", f); }
  async process(f: TFile, fn: (t: string) => string) { const t = fn(this.files.get(f.path) ?? ""); await this.modify(f, t); return t; }
  async create(p: string, t: string) { if (this.files.has(p)) throw new Error("exists"); this.files.set(p, t); const f = this.file(p); (this as any).cache?.trigger("changed", f); return f; }
  async createFolder(p: string) { (this as any).folders = [...((this as any).folders ?? []), p]; }
  getAbstractFileByPath(p: string) {
    if (this.files.has(p)) return this.file(p);
    if ([...this.files.keys()].some((k) => k.startsWith(p + "/")) || ((this as any).folders ?? []).includes(p)) return new TFolder(p);
    return null;
  }
}

export class WorkspaceLeaf { view: any = null; constructor(public app: any) {} async setViewState(s: { type: string }) { const factory = this.app.workspace.factories[s.type]; this.view = factory(this); this.app.workspace.leaves.push(this); this.app.workspace.mount(this.view); await this.view.onOpen(); } async openFile(f: TFile) { this.app.workspace.opened.push(f.path); new Notice(`Opened ${f.path}`); } }

export function makeApp(seed: Record<string, string>) {
  const vault = new Vault(seed);
  const cache = new Events() as any;
  (vault as any).cache = cache;
  cache.getFileCache = (f: TFile) => ({ frontmatter: parseFrontmatter(vault.files.get(f.path) ?? "") });
  const app: any = {
    vault, metadataCache: cache,
    fileManager: { async processFrontMatter(f: TFile, fn: (fm: any) => void) { const t = vault.files.get(f.path) ?? ""; const fm = parseFrontmatter(t) ?? {}; fn(fm); await vault.modify(f, writeFrontmatter(t, fm)); } },
    workspace: {
      factories: {} as Record<string, (l: WorkspaceLeaf) => any>, leaves: [] as WorkspaceLeaf[], opened: [] as string[], ready: [] as Cb[],
      onLayoutReady(cb: Cb) { this.ready.push(cb); },
      getLeavesOfType(t: string) { return this.leaves.filter((l: WorkspaceLeaf) => l.view?.getViewType() === t); },
      getLeaf() { return new WorkspaceLeaf(app); },
      async revealLeaf() {},
      mount(view: any) { document.getElementById("mount")?.appendChild(view.containerEl); },
    },
  };
  return app;
}

export class ItemView {
  app: any; containerEl: HTMLElement; contentEl: HTMLElement;
  constructor(public leaf: WorkspaceLeaf) { this.app = leaf.app; this.containerEl = document.createElement("div"); this.containerEl.className = "view-content-wrap"; this.contentEl = this.containerEl.createDiv({ cls: "view-content" }); }
  registerEvent(_r: unknown) {}
  register(_f: () => void) {}
}

export class Plugin {
  constructor(public app: any, public manifest: unknown) {}
  async loadData() { return null; }
  async saveData(_d: unknown) {}
  registerView(t: string, f: (l: WorkspaceLeaf) => any) { this.app.workspace.factories[t] = f; }
  addRibbonIcon() {}
  addCommand() {}
  addSettingTab() {}
  registerEvent(_r: unknown) {}
}
export class PluginSettingTab { containerEl = document.createElement("div"); constructor(public app: any, public plugin: unknown) {} }
export class Setting { constructor(_el: HTMLElement) {} setName() { return this; } setDesc() { return this; } setHeading() { return this; } addToggle() { return this; } addText() { return this; } addColorPicker() { return this; } addExtraButton() { return this; } addButton() { return this; } }
export type App = any;
