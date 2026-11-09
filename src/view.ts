import { ItemView, Notice, Platform, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { addDays, daysUntil, isoDate, parseCapture, parseIsoDate, type Capture } from "./parse";
import { BOARD_STATUSES, statusLabel, type AppDef, type ChecklistItem, type Meeting, type Status, type WorkItem } from "./schema";
import type HomeBasePlugin from "./main";

export const VIEW_TYPE = "home-base";

type Screen = "home" | "board" | "upcoming" | "ops" | "meetings" | "log" | "quick" | "more";
type Selected = { kind: "item"; path: string } | { kind: "meeting"; path: string } | null;
interface Review { queue: string[]; i: number; counts: { ready: number; kept: number; dropped: number } }
interface CaptureDraft { text: string; app: string | null; type: "task" | "ops" | null; due: string | null }

const SCREENS: { id: Screen; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "home" },
  { id: "board", label: "Board", icon: "kanban" },
  { id: "upcoming", label: "Upcoming", icon: "calendar" },
  { id: "ops", label: "Ops", icon: "repeat" },
  { id: "meetings", label: "Meetings", icon: "users" },
  { id: "log", label: "Daily log", icon: "pen-line" },
  { id: "quick", label: "Quick fixes", icon: "list-checks" },
];

type Attrs = { cls?: string | string[]; text?: string; attr?: Record<string, string>; style?: Record<string, string>; onClick?: (e: MouseEvent) => void };

function el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, a: Attrs = {}): HTMLElementTagNameMap[K] {
  const cls = Array.isArray(a.cls) ? a.cls.filter(Boolean) : a.cls || undefined;
  const e = parent.createEl(tag, { cls, text: a.text, attr: a.attr });
  if (a.style) for (const [k, v] of Object.entries(a.style)) e.style.setProperty(k, v);
  if (a.onClick) e.addEventListener("click", a.onClick as EventListener);
  return e;
}
function icon(parent: HTMLElement, name: string, cls = "hb-icon"): HTMLElement {
  const s = parent.createSpan({ cls });
  setIcon(s, name);
  return s;
}

export class HomeBaseView extends ItemView {
  private screen: Screen = "home";
  private lens = "all";
  private selected: Selected = null;
  private review: Review | null = null;
  private boardPage = 0;
  private draft: CaptureDraft | null = null;
  private narrow = false;
  private dragPath: string | null = null;
  private overlayEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private plugin: HomeBasePlugin) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "Home Base"; }
  getIcon(): string { return "layout-dashboard"; }

  private get index() { return this.plugin.index; }
  private get apps(): AppDef[] { return this.plugin.settings.apps; }
  private get today(): Date { return this.index.today(); }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("hb-root");
    this.registerEvent(this.index.on("updated", () => this.draw()));
    const ro = new ResizeObserver(() => {
      const n = Platform.isPhone || this.contentEl.clientWidth < 720;
      if (n !== this.narrow) {
        this.narrow = n;
        this.draw();
      }
    });
    ro.observe(this.contentEl);
    this.register(() => ro.disconnect());
    this.narrow = Platform.isPhone || this.contentEl.clientWidth < 720;
    try {
      if (!this.index.ready) await this.index.rebuild();
    } catch (e) {
      this.showError(e);
      return;
    }
    this.draw();
  }

  /* ---------- public entry points for commands ---------- */

  openCapture(): void {
    this.draft = { text: "", app: this.lens !== "all" ? this.lens : null, type: null, due: null };
    if (this.narrow) this.renderOverlay();
    else this.contentEl.querySelector<HTMLInputElement>(".hb-capture input")?.focus();
  }

  startReview(): void {
    const queue = this.items().filter((i) => i.status === "inbox").map((i) => i.path);
    if (!queue.length) {
      new Notice("Nothing in the inbox to review");
      return;
    }
    this.review = { queue, i: 0, counts: { ready: 0, kept: 0, dropped: 0 } };
    this.selected = null;
    this.renderOverlay();
  }

  /* ---------- data helpers ---------- */

  private items(): WorkItem[] {
    return this.index.items.filter((i) => this.lens === "all" || i.app === this.lens);
  }
  private isOpenItem(i: WorkItem): boolean { return i.status !== "done" && i.status !== "dropped"; }
  private appDef(name: string): AppDef {
    return this.apps.find((a) => a.name === name) ?? { name, short: name, aliases: [], color: "var(--text-faint)" };
  }
  private item(path: string): WorkItem | undefined { return this.index.items.find((i) => i.path === path); }
  private meeting(path: string): Meeting | undefined { return this.index.meetings.find((m) => m.path === path); }

  private async act(p: Promise<unknown>, msg?: string): Promise<void> {
    try {
      const r = await p;
      const text = typeof r === "string" ? r : msg;
      if (text) new Notice(text);
    } catch (e) {
      console.error("Home Base", e);
      new Notice(`Home Base: ${e instanceof Error ? e.message : "that didn't work"}`);
    }
  }
  private openFile(file: TFile): void {
    void this.app.workspace.getLeaf(Platform.isMobile ? false : "tab").openFile(file);
  }

  /* ---------- render ---------- */

  /** Named draw, not render or open: Obsidian's View uses those names internally. */
  draw(): void {
    try {
      this.drawUnsafe();
    } catch (e) {
      this.showError(e);
    }
  }

  private showError(e: unknown): void {
    console.error("Home Base", e);
    const root = this.contentEl;
    root.empty();
    const box = el(root, "div", { cls: "hb-error" });
    el(box, "h3", { text: "Home Base couldn't draw this view" });
    el(box, "p", { text: e instanceof Error ? e.message : String(e) });
    el(box, "p", { cls: "hb-faint", text: "Details are in the developer console. Reopening the view tries again." });
  }

  private drawUnsafe(): void {
    const root = this.contentEl;
    const prevScroll = root.querySelector(".hb-screen")?.scrollTop ?? 0;
    root.empty();
    root.toggleClass("hb-narrow", this.narrow);
    if (!this.index.ready) {
      el(root, "div", { cls: "hb-empty", text: "Reading the vault…" });
      return;
    }
    if (this.narrow) {
      const screen = el(root, "div", { cls: "hb-screen" });
      this.renderScreen(screen);
      this.renderTabbar(root);
      screen.scrollTop = prevScroll;
    } else {
      const shell = el(root, "div", { cls: "hb-shell" });
      this.renderRail(el(shell, "nav", { cls: "hb-rail" }));
      const main = el(shell, "div", { cls: "hb-screen hb-main" });
      this.renderCaptureBar(main);
      this.renderScreen(main);
      main.scrollTop = prevScroll;
    }
    this.overlayEl = el(root, "div", { cls: "hb-overlay" });
    this.renderOverlay();
  }

  private go(s: Screen): void {
    this.screen = s;
    this.selected = null;
    this.draw();
    this.contentEl.querySelector(".hb-screen")?.scrollTo(0, 0);
  }

  private renderRail(rail: HTMLElement): void {
    const brand = el(rail, "div", { cls: "hb-brand" });
    el(brand, "div", { cls: "hb-brand-name", text: "Home Base" });
    el(brand, "div", { cls: "hb-brand-sub", text: this.today.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) });
    const counts: Partial<Record<Screen, number>> = {
      board: this.items().filter((i) => i.type === "task" && this.isOpenItem(i)).length,
      ops: this.items().filter((i) => i.type === "ops" && this.isOpenItem(i)).length,
      upcoming: this.items().filter((i) => i.due && this.isOpenItem(i)).length,
      quick: this.index.quickLists.filter((q) => this.lens === "all" || q.app === this.lens).reduce((n, q) => n + q.items.filter((x) => !x.done).length, 0),
    };
    const views = el(rail, "div", { cls: "hb-rail-group" });
    el(views, "div", { cls: "hb-rail-label", text: "Views" });
    for (const s of SCREENS) {
      const b = el(views, "button", { cls: ["hb-nav", this.screen === s.id ? "is-active" : ""], onClick: () => this.go(s.id) });
      icon(b, s.icon);
      el(b, "span", { text: s.label });
      if (counts[s.id] != null) el(b, "span", { cls: "hb-count", text: String(counts[s.id]) });
    }
    const lenses = el(rail, "div", { cls: "hb-rail-group" });
    el(lenses, "div", { cls: "hb-rail-label", text: "Apps" });
    for (const [id, label, color] of [["all", "All apps", "var(--text-normal)"], ...this.apps.map((a) => [a.name, a.short === a.name ? a.name : a.short, a.color])] as [string, string, string][]) {
      const n = this.index.items.filter((i) => this.isOpenItem(i) && (id === "all" || i.app === id)).length;
      const b = el(lenses, "button", { cls: ["hb-nav", this.lens === id ? "is-active" : ""], onClick: () => { this.lens = id; this.draw(); } });
      el(b, "span", { cls: "hb-dot", style: { background: color } });
      el(b, "span", { text: id === "General" ? "Personal" : id === "all" ? label : id });
      el(b, "span", { cls: "hb-count", text: String(n) });
    }
  }

  private renderTabbar(root: HTMLElement): void {
    const bar = el(root, "nav", { cls: "hb-tabbar" });
    const inbox = this.index.items.filter((i) => i.status === "inbox").length;
    const tab = (id: Screen, label: string, ic: string, badge?: number) => {
      const active = this.screen === id || (id === "more" && ["upcoming", "ops", "meetings", "quick"].includes(this.screen));
      const b = el(bar, "button", { cls: ["hb-tab", active ? "is-active" : ""], onClick: () => this.go(id) });
      icon(b, ic);
      el(b, "span", { text: label });
      if (badge) el(b, "span", { cls: "hb-badge", text: String(badge) });
    };
    tab("home", "Today", "home");
    tab("board", "Board", "kanban", inbox);
    const fab = el(bar, "button", { cls: "hb-fab", attr: { "aria-label": "Capture" }, onClick: () => this.openCapture() });
    icon(fab, "plus");
    tab("log", "Log", "pen-line");
    tab("more", "More", "more-horizontal");
  }

  private renderScreen(c: HTMLElement): void {
    const body = el(c, "div", { cls: "hb-body" });
    ({ home: () => this.renderHome(body), board: () => this.renderBoard(body), upcoming: () => this.renderUpcoming(body), ops: () => this.renderOps(body), meetings: () => this.renderMeetings(body), log: () => this.renderLog(body), quick: () => this.renderQuick(body), more: () => this.renderMore(body) })[this.screen]();
  }

  /* ---------- shared pieces ---------- */

  private head(c: HTMLElement, eyebrow: string, title: string, back = false): HTMLElement {
    if (back && this.narrow) {
      const b = el(c, "button", { cls: "hb-back", onClick: () => this.go("more") });
      icon(b, "chevron-left");
      el(b, "span", { text: "More" });
    }
    const h = el(c, "div", { cls: "hb-head" });
    const t = el(h, "div");
    el(t, "div", { cls: "hb-eyebrow", text: eyebrow });
    el(t, "h2", { cls: "hb-title", text: title });
    return h;
  }

  private lensBar(c: HTMLElement): void {
    if (!this.narrow) return;
    const bar = el(c, "div", { cls: "hb-lenses" });
    for (const [id, label, color] of [["all", "All", ""], ...this.apps.map((a) => [a.name, a.short, a.color])] as [string, string, string][]) {
      const n = this.index.items.filter((i) => this.isOpenItem(i) && (id === "all" || i.app === id)).length;
      const b = el(bar, "button", { cls: ["hb-lens", this.lens === id ? "is-active" : ""], onClick: () => { this.lens = id; this.draw(); } });
      if (color) el(b, "span", { cls: "hb-dot", style: { background: color } });
      el(b, "span", { text: label });
      el(b, "span", { cls: "hb-n", text: String(n) });
    }
  }

  private appChip(c: HTMLElement, app: string): void {
    const a = this.appDef(app);
    const ch = el(c, "span", { cls: "hb-chip hb-chip-app", style: { "--hb-app": a.color } });
    el(ch, "span", { cls: "hb-dot" });
    ch.appendText(a.short);
  }

  private dueChip(c: HTMLElement, due: string): void {
    if (!due) return;
    const n = daysUntil(due, this.today);
    if (n == null) return;
    const d = parseIsoDate(due) as Date;
    const label = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    if (n < 0) el(c, "span", { cls: "hb-chip is-late", text: `${-n}d overdue` });
    else if (n === 0) el(c, "span", { cls: "hb-chip is-late", text: "Due today" });
    else if (n <= 7) el(c, "span", { cls: "hb-chip is-soon", text: label });
    else el(c, "span", { cls: "hb-chip", text: label });
  }

  private section(c: HTMLElement, title: string, count?: number, more?: { label: string; go: () => void }): HTMLElement {
    const s = el(c, "section", { cls: "hb-section" });
    const h = el(s, "div", { cls: "hb-section-head" });
    el(h, "h3", { text: title });
    if (count != null) el(h, "span", { cls: "hb-n", text: String(count) });
    if (more) el(h, "button", { cls: "hb-link", text: more.label, onClick: more.go });
    return el(s, "div", { cls: "hb-group" });
  }

  private emptyRow(c: HTMLElement, text: string): void { el(c, "div", { cls: "hb-empty", text }); }

  private row(c: HTMLElement, i: WorkItem): void {
    const wrap = el(c, "div", { cls: "hb-swipe" });
    const acts = el(wrap, "div", { cls: "hb-swipe-acts" });
    if (i.type === "ops") {
      el(acts, "button", { cls: "is-snooze", text: "Snooze", onClick: () => void this.act(this.index.snooze(i).then((d) => `Snoozed to ${d}`)) });
      el(acts, "button", { cls: "is-done", text: "Done", onClick: () => void this.act(this.index.complete(i)) });
    } else if (i.status === "inbox") {
      el(acts, "button", { cls: "is-ready", text: "Ready", onClick: () => void this.act(this.index.setStatus(i, "ready"), "Moved to Ready") });
    } else {
      el(acts, "button", { cls: "is-done", text: "Done", onClick: () => void this.act(this.index.setStatus(i, "done"), "Marked done") });
    }
    const n = i.due ? daysUntil(i.due, this.today) : null;
    const r = el(wrap, "div", { cls: "hb-row", attr: { role: "button", tabindex: "0" } });
    el(r, "span", { cls: ["hb-stripe", n == null ? "" : n <= 0 ? "is-late" : n <= 7 ? "is-soon" : ""] });
    const main = el(r, "div", { cls: "hb-row-main" });
    el(main, "div", { cls: "hb-row-title", text: i.title });
    const meta = el(main, "div", { cls: "hb-meta" });
    this.appChip(meta, i.app);
    this.dueChip(meta, i.due);
    el(meta, "span", { cls: "hb-faint", text: `${i.type === "ops" ? "Ops" : i.area || "Task"} · ${statusLabel(i.status)}${i.repeat ? ` · every ${i.repeat}` : ""}` });
    if (!this.narrow && i.type === "ops") {
      el(r, "button", { cls: "hb-btn hb-btn-small", text: "Mark done", onClick: (e) => { e.stopPropagation(); void this.act(this.index.complete(i)); } });
    }
    if (this.narrow) icon(r, "chevron-right", "hb-chev");
    this.wireRow(r, acts, () => { this.selected = { kind: "item", path: i.path }; this.renderOverlay(); });
  }

  /** Tap opens; on narrow screens a left swipe reveals the row's actions. */
  private wireRow(row: HTMLElement, acts: HTMLElement, onOpen: () => void): void {
    let x0: number | null = null, y0 = 0, dx = 0, moved = false, opened = false;
    row.addEventListener("click", () => {
      if (moved) { moved = false; return; }
      if (opened) { opened = false; row.style.transform = ""; return; }
      onOpen();
    });
    row.addEventListener("keydown", (e) => { if (e.key === "Enter") onOpen(); });
    if (!this.narrow) return;
    row.addEventListener("pointerdown", (e) => { x0 = e.clientX; y0 = e.clientY; dx = 0; moved = false; row.addClass("is-dragging"); });
    row.addEventListener("pointermove", (e) => {
      if (x0 == null) return;
      const ddx = e.clientX - x0, ddy = e.clientY - y0;
      if (!moved && Math.abs(ddy) > Math.abs(ddx) && Math.abs(ddy) > 6) { x0 = null; row.removeClass("is-dragging"); return; }
      if (Math.abs(ddx) > 8) { moved = true; row.setPointerCapture(e.pointerId); }
      if (!moved) return;
      const w = acts.offsetWidth;
      dx = Math.min(0, Math.max(-w - 24, ddx + (opened ? -w : 0)));
      row.style.transform = `translateX(${dx}px)`;
    });
    const end = () => {
      if (x0 == null) return;
      x0 = null;
      row.removeClass("is-dragging");
      if (!moved) return;
      opened = dx < -acts.offsetWidth / 2;
      row.style.transform = opened ? `translateX(${-acts.offsetWidth}px)` : "";
    };
    row.addEventListener("pointerup", end);
    row.addEventListener("pointercancel", end);
  }

  /* ---------- capture ---------- */

  private resolveDraft(d: CaptureDraft): Capture & { appResolved: string | null } {
    const p = parseCapture(d.text, this.apps, this.today);
    return { ...p, type: d.type ?? p.type, due: d.due ?? p.due, appResolved: d.app ?? p.app };
  }

  private async submitDraft(): Promise<void> {
    const d = this.draft;
    if (!d) return;
    const c = this.resolveDraft(d);
    if (!c.title) { new Notice("Type a name first"); return; }
    if (!c.appResolved) { new Notice("Pick an app, or start with one: gd, spot, sylo, me"); return; }
    try {
      const file = await this.index.create({ ...c, app: c.appResolved });
      new Notice(`Added ${file.basename} to the inbox`);
      this.draft = null;
      if (this.narrow) this.renderOverlay();
      else this.draw();
    } catch (e) {
      new Notice(`Home Base: ${e instanceof Error ? e.message : "couldn't create the note"}`);
    }
  }

  private renderCaptureBar(c: HTMLElement): void {
    const wrap = el(c, "div", { cls: "hb-capture" });
    const box = el(wrap, "div", { cls: "hb-capture-box" });
    icon(box, "plus");
    const input = el(box, "input", { attr: { type: "text", placeholder: "Capture: gd vendor remittance email due fri", "aria-label": "Capture a task" } });
    input.value = this.draft?.text ?? "";
    el(box, "kbd", { text: "Enter" });
    const preview = el(wrap, "div", { cls: "hb-capture-preview" });
    const paint = () => {
      preview.empty();
      const d = this.draft;
      if (!d || !d.text.trim()) {
        preview.setText("Start with an app (" + this.apps.map((a) => a.aliases[0] ?? a.short).join(", ") + "), add ops for a job with no code, and due fri or due 2026-11-20 for a date.");
        return;
      }
      const r = this.resolveDraft(d);
      for (const a of this.apps) {
        const b = el(preview, "button", { cls: ["hb-pick", r.appResolved === a.name ? "is-active" : ""], onClick: () => { d.app = a.name; paint(); input.focus(); } });
        el(b, "span", { cls: "hb-dot", style: { background: a.color } });
        b.appendText(a.short);
      }
      el(preview, "span", { cls: "hb-chip", text: r.type === "ops" ? "Ops job" : "Task" });
      if (r.due) this.dueChip(preview, r.due);
      el(preview, "span", { cls: "hb-path", text: `→ ${r.type === "ops" ? this.plugin.settings.opsFolder : this.plugin.settings.tasksFolder}/${r.title || "…"}.md` });
    };
    input.addEventListener("input", () => {
      this.draft = this.draft ?? { text: "", app: null, type: null, due: null };
      this.draft.text = input.value;
      paint();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void this.submitDraft();
      if (e.key === "Escape") { this.draft = null; input.value = ""; paint(); }
    });
    paint();
  }

  private renderCaptureSheet(o: HTMLElement): void {
    const d = this.draft as CaptureDraft;
    const sheet = this.sheet(o, null, () => { this.draft = null; this.renderOverlay(); });
    const body = el(sheet, "div", { cls: "hb-sheet-body" });
    const input = el(body, "input", { cls: "hb-cap-input", attr: { type: "text", placeholder: "What needs doing?", enterkeyhint: "done" } });
    input.value = d.text;
    const picks = el(body, "div");
    const footBtn = { el: null as HTMLButtonElement | null };
    const paint = () => {
      picks.empty();
      const r = this.resolveDraft(d);
      const row = (label: string) => { el(picks, "div", { cls: "hb-label", text: label }); return el(picks, "div", { cls: "hb-chips-scroll" }); };
      const apps = row("App");
      for (const a of this.apps) {
        const b = el(apps, "button", { cls: ["hb-pick", r.appResolved === a.name ? "is-active" : ""], onClick: () => { d.app = a.name; paint(); } });
        el(b, "span", { cls: "hb-dot", style: { background: a.color } });
        b.appendText(a.short);
      }
      const kinds = row("Kind");
      for (const [k, l] of [["task", "Task"], ["ops", "Ops job"]] as const) el(kinds, "button", { cls: ["hb-pick", r.type === k ? "is-active" : ""], text: l, onClick: () => { d.type = k; paint(); } });
      const dues = row("Due");
      const t = this.today;
      const fri = addDays(t, (5 - t.getDay() + 7) % 7 || 7);
      for (const [v, l] of [["", "No date"], [isoDate(t), "Today"], [isoDate(addDays(t, 1)), "Tomorrow"], [isoDate(fri), `Friday ${fri.getDate()}`], [isoDate(addDays(t, 7)), "Next week"]] as const) {
        el(dues, "button", { cls: ["hb-pick", r.due === v ? "is-active" : ""], text: l, onClick: () => { d.due = v; paint(); } });
      }
      el(picks, "div", { cls: "hb-path", text: `→ ${r.type === "ops" ? this.plugin.settings.opsFolder : this.plugin.settings.tasksFolder}/${r.title || "…"}.md · status: inbox` });
      if (footBtn.el) footBtn.el.disabled = !(r.title && r.appResolved);
    };
    input.addEventListener("input", () => { d.text = input.value; paint(); });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") void this.submitDraft(); });
    const foot = el(sheet, "div", { cls: "hb-sheet-foot" });
    el(foot, "button", { cls: "hb-btn", text: "Cancel", onClick: () => { this.draft = null; this.renderOverlay(); } });
    footBtn.el = el(foot, "button", { cls: "hb-btn mod-cta", text: "Add to inbox", onClick: () => void this.submitDraft() });
    paint();
    window.setTimeout(() => input.focus(), 50);
  }

  /* ---------- home ---------- */

  private renderHome(c: HTMLElement): void {
    const items = this.items();
    const inbox = items.filter((i) => i.status === "inbox");
    const due = items.filter((i) => this.isOpenItem(i) && i.due && (daysUntil(i.due, this.today) ?? 99) <= 7).sort((a, b) => a.due.localeCompare(b.due));
    const overdue = due.filter((i) => (daysUntil(i.due, this.today) ?? 0) < 0);
    const ops = items.filter((i) => i.type === "ops" && this.isOpenItem(i) && !due.includes(i)).sort((a, b) => (a.due || "9").localeCompare(b.due || "9"));
    const active = items.filter((i) => i.status === "in-progress" || i.status === "blocked");
    const lensName = this.lens === "all" ? "" : ` · ${this.appDef(this.lens).short}`;

    const h = this.head(c, `${this.today.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}${lensName}`, this.narrow ? "Today" : "Home");
    if (!this.narrow) {
      const tb = el(h, "div", { cls: "hb-toolbar" });
      el(tb, "button", { cls: "hb-btn", text: "Board", onClick: () => this.go("board") });
      const rv = el(tb, "button", { cls: "hb-btn", text: `Review inbox (${inbox.length})`, onClick: () => this.startReview() });
      rv.disabled = !inbox.length;
    }
    this.lensBar(c);

    const next = el(c, "div", { cls: "hb-next" });
    el(next, "div", { cls: "hb-next-label", text: "Next step" });
    const acts = (() => {
      if (overdue[0]) {
        const o = overdue[0];
        el(next, "div", { cls: "hb-next-title", text: `${o.title} is ${-(daysUntil(o.due, this.today) ?? 0)} days overdue` });
        el(next, "div", { cls: "hb-next-text", text: overdue.length > 1 ? `${overdue.length - 1} more overdue after it.` : "It's the only overdue item." });
        const a = el(next, "div", { cls: "hb-next-acts" });
        el(a, "button", { cls: "hb-btn mod-cta", text: "Open it", onClick: () => { this.selected = { kind: "item", path: o.path }; this.renderOverlay(); } });
        return a;
      }
      if (inbox.length) {
        el(next, "div", { cls: "hb-next-title", text: `${inbox.length} ${inbox.length === 1 ? "item is" : "items are"} waiting for review` });
        el(next, "div", { cls: "hb-next-text", text: "Approve, keep or drop each one." });
        const a = el(next, "div", { cls: "hb-next-acts" });
        el(a, "button", { cls: "hb-btn mod-cta", text: "Review them", onClick: () => this.startReview() });
        return a;
      }
      el(next, "div", { cls: "hb-next-title", text: "Nothing needs you right now" });
      el(next, "div", { cls: "hb-next-text", text: "Everything open is ready or moving." });
      return el(next, "div", { cls: "hb-next-acts" });
    })();
    if (overdue[0] && inbox.length) el(acts, "button", { cls: "hb-btn", text: `Review inbox (${inbox.length})`, onClick: () => this.startReview() });

    const grid = el(c, "div", { cls: "hb-home-grid" });
    const left = el(grid, "div", { cls: "hb-col" });
    const right = el(grid, "div", { cls: "hb-col" });

    const dueG = this.section(left, "Overdue and due this week", due.length, { label: "Upcoming", go: () => this.go("upcoming") });
    due.length ? due.forEach((i) => this.row(dueG, i)) : this.emptyRow(dueG, "Nothing due in the next 7 days.");

    if (active.length || !this.narrow) {
      const actG = this.section(this.narrow ? left : right, "In progress and blocked", active.length, { label: "Board", go: () => { this.boardPage = 2; this.go("board"); } });
      active.length ? active.forEach((i) => this.row(actG, i)) : this.emptyRow(actG, "Nothing in progress.");
    }

    const opsG = this.section(left, "Open ops", ops.length, { label: "All ops", go: () => this.go("ops") });
    ops.length ? ops.slice(0, this.narrow ? 3 : 6).forEach((i) => this.row(opsG, i)) : this.emptyRow(opsG, "No other open ops.");

    this.renderLogPanel(this.narrow ? left : right, true);

    const meets = this.index.meetings.filter((m) => this.lens === "all" || m.app === this.lens).slice(0, 2);
    const mG = this.section(this.narrow ? left : right, "Recent meetings", undefined, { label: "All meetings", go: () => this.go("meetings") });
    meets.length ? meets.forEach((m) => this.meetingRow(mG, m)) : this.emptyRow(mG, "No meetings yet. Process a transcript with /process-meeting.");

    if (!this.narrow) {
      const aG = this.section(right, "By app");
      for (const a of this.apps) {
        const ts = this.index.items.filter((i) => i.app === a.name && this.isOpenItem(i));
        const r = el(aG, "div", { cls: "hb-app-row", attr: { role: "button", tabindex: "0" }, onClick: () => { this.lens = a.name; this.draw(); } });
        const l = el(r, "div", { cls: "hb-row-main" });
        const nm = el(l, "div", { cls: "hb-app-name" });
        el(nm, "span", { cls: "hb-dot", style: { background: a.color } });
        nm.appendText(a.name === "General" ? "Personal" : a.name);
        const bar = el(l, "div", { cls: "hb-bar" });
        const total = ts.length || 1;
        for (const [s, col] of [["inbox", "var(--text-faint)"], ["ready", "var(--interactive-accent)"], ["in-progress", "var(--color-green)"], ["blocked", "var(--color-red)"]] as const) {
          el(bar, "span", { style: { width: `${(ts.filter((t) => t.status === s).length / total) * 100}%`, background: col } });
        }
        el(r, "div", { cls: "hb-faint hb-mono", text: `${ts.length} open` });
      }
    }
  }

  /* ---------- board ---------- */

  private renderBoard(c: HTMLElement): void {
    const list = this.items().filter((i) => i.type === "task");
    const h = this.head(c, this.narrow ? "Swipe sideways for each status" : "Drag a card to change its status", "Board");
    this.lensBar(c);
    if (!this.narrow) {
      const seg = el(h, "div", { cls: "hb-seg" });
      for (const [id, label] of [["all", "All"], ...this.apps.map((a) => [a.name, a.short])] as [string, string][]) {
        el(seg, "button", { cls: this.lens === id ? "is-active" : "", text: label, onClick: () => { this.lens = id; this.draw(); } });
      }
      const wrap = el(c, "div", { cls: "hb-board-wrap" });
      const board = el(wrap, "div", { cls: "hb-board" });
      for (const s of BOARD_STATUSES) {
        const cards = list.filter((i) => i.status === s.id);
        const col = el(board, "div", { cls: "hb-column" });
        const ch = el(col, "div", { cls: "hb-column-head" });
        el(ch, "span", { text: s.label });
        el(ch, "span", { cls: "hb-n", text: String(cards.length) });
        el(col, "div", { cls: "hb-column-hint", text: s.hint });
        const body = el(col, "div", { cls: "hb-cards" });
        cards.forEach((i) => this.card(body, i));
        if (s.id === "inbox") el(col, "button", { cls: "hb-add-card", text: "+ New task", onClick: () => this.openCapture() });
        col.addEventListener("dragover", (e) => { e.preventDefault(); col.addClass("is-over"); });
        col.addEventListener("dragleave", () => col.removeClass("is-over"));
        col.addEventListener("drop", (e) => {
          e.preventDefault();
          col.removeClass("is-over");
          const it = this.dragPath ? this.item(this.dragPath) : undefined;
          if (it && it.status !== s.id) void this.act(this.index.setStatus(it, s.id), `${it.title}: ${s.label}`);
        });
      }
      return;
    }
    const tabs = el(c, "div", { cls: "hb-status-tabs", attr: { role: "tablist" } });
    const pager = el(c, "div", { cls: "hb-pager" });
    BOARD_STATUSES.forEach((s, k) => {
      const cards = list.filter((i) => i.status === s.id);
      const t = el(tabs, "button", { cls: ["hb-stab", this.boardPage === k ? "is-active" : ""], attr: { role: "tab" }, onClick: () => { this.boardPage = k; pager.scrollTo({ left: k * pager.clientWidth, behavior: "smooth" }); tabs.querySelectorAll(".hb-stab").forEach((b, j) => b.toggleClass("is-active", j === k)); } });
      t.appendText(s.label);
      el(t, "span", { cls: "hb-n", text: String(cards.length) });
      const page = el(pager, "div", { cls: "hb-page" });
      el(page, "div", { cls: "hb-faint", text: s.hint });
      cards.length ? cards.forEach((i) => this.card(page, i)) : this.emptyRow(page, "Nothing here.");
    });
    window.requestAnimationFrame(() => { pager.scrollLeft = this.boardPage * pager.clientWidth; });
    let tmr = 0;
    pager.addEventListener("scroll", () => {
      window.clearTimeout(tmr);
      tmr = window.setTimeout(() => {
        const k = Math.round(pager.scrollLeft / Math.max(1, pager.clientWidth));
        if (k !== this.boardPage) { this.boardPage = k; tabs.querySelectorAll(".hb-stab").forEach((b, j) => b.toggleClass("is-active", j === k)); }
      }, 80);
    });
  }

  private card(c: HTMLElement, i: WorkItem): void {
    const card = el(c, "div", { cls: "hb-card", attr: { draggable: this.narrow ? "false" : "true", role: "button", tabindex: "0" }, onClick: () => { this.selected = { kind: "item", path: i.path }; this.renderOverlay(); } });
    el(card, "div", { cls: "hb-card-title", text: i.title });
    const meta = el(card, "div", { cls: "hb-meta" });
    this.appChip(meta, i.app);
    if (i.area) el(meta, "span", { cls: "hb-chip", text: i.area });
    if (i.hasOpenQuestions) el(meta, "span", { cls: "hb-chip is-q", text: "Open questions" });
    this.dueChip(meta, i.due);
    const done = i.checklist.filter((x) => x.done).length;
    const foot = el(card, "div", { cls: "hb-card-foot" });
    const prog = el(foot, "div", { cls: "hb-progress" });
    el(prog, "span", { style: { width: `${i.checklist.length ? (done / i.checklist.length) * 100 : 0}%` } });
    el(foot, "span", { cls: "hb-mono", text: `${done}/${i.checklist.length}` });
    if (i.issue) el(foot, "span", { cls: "hb-mono", text: `#${i.issue.split("#")[1] ?? i.issue}` });
    card.addEventListener("dragstart", (e) => { this.dragPath = i.path; card.addClass("is-dragging"); e.dataTransfer?.setData("text/plain", i.path); });
    card.addEventListener("dragend", () => card.removeClass("is-dragging"));
    card.addEventListener("keydown", (e) => { if (e.key === "Enter") card.click(); });
  }

  /* ---------- upcoming ---------- */

  private renderUpcoming(c: HTMLElement): void {
    const dated = this.items().filter((i) => i.due && this.isOpenItem(i)).sort((a, b) => a.due.localeCompare(b.due));
    const undated = this.items().filter((i) => !i.due && this.isOpenItem(i)).length;
    this.head(c, "Tasks and ops jobs with a due date", "Upcoming", true);
    this.lensBar(c);
    if (!this.narrow) {
      const t = this.today;
      const first = new Date(t.getFullYear(), t.getMonth(), 1);
      const start = addDays(first, -((first.getDay() + 6) % 7));
      const box = el(c, "div", { cls: "hb-group hb-cal-wrap" });
      el(box, "div", { cls: "hb-cal-month", text: t.toLocaleDateString(undefined, { month: "long", year: "numeric" }) });
      const cal = el(box, "div", { cls: "hb-cal" });
      for (const d of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) el(cal, "div", { cls: "hb-cal-dow", text: d });
      for (let k = 0; k < 42; k++) {
        const d = addDays(start, k);
        if (k >= 35 && d.getMonth() !== t.getMonth()) break;
        const day = el(cal, "div", { cls: ["hb-cal-day", d.getMonth() !== t.getMonth() ? "is-other" : "", isoDate(d) === isoDate(t) ? "is-today" : ""] });
        el(day, "span", { cls: "hb-cal-n", text: String(d.getDate()) });
        for (const i of dated.filter((x) => x.due === isoDate(d))) {
          el(day, "button", { cls: "hb-cal-item", text: i.title, attr: { title: i.title }, style: { "--hb-app": this.appDef(i.app).color }, onClick: () => { this.selected = { kind: "item", path: i.path }; this.renderOverlay(); } });
        }
      }
    }
    const groups = new Map<string, WorkItem[]>();
    for (const i of dated) groups.set(i.due, [...(groups.get(i.due) ?? []), i]);
    if (!groups.size) el(c, "div", { cls: "hb-empty", text: "Nothing has a due date." });
    for (const [d, list] of groups) {
      const n = daysUntil(d, this.today) ?? 0;
      const label = `${n < 0 ? "Overdue · " : n === 0 ? "Today · " : n === 1 ? "Tomorrow · " : ""}${(parseIsoDate(d) as Date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`;
      const s = el(c, "section", { cls: "hb-section" });
      el(s, "div", { cls: ["hb-agenda-day", n < 0 ? "is-late" : ""], text: label });
      const g = el(s, "div", { cls: "hb-group" });
      list.forEach((i) => this.row(g, i));
    }
    if (undated) el(c, "div", { cls: "hb-note", text: `${undated} open items have no due date. Give an ops job a date when it has a real deadline.` });
  }

  /* ---------- ops ---------- */

  private renderOps(c: HTMLElement): void {
    const ops = this.items().filter((i) => i.type === "ops" && this.isOpenItem(i)).sort((a, b) => (a.due || "9").localeCompare(b.due || "9"));
    this.head(c, this.narrow ? "Swipe left for Done or Snooze" : "Jobs with no code change", "Ops", true);
    this.lensBar(c);
    const g = el(c, "div", { cls: "hb-group" });
    ops.length ? ops.forEach((i) => this.row(g, i)) : this.emptyRow(g, "No open ops jobs.");
  }

  /* ---------- meetings ---------- */

  private meetingRow(c: HTMLElement, m: Meeting): void {
    const d = parseIsoDate(m.date);
    const r = el(c, "div", { cls: "hb-meet", attr: { role: "button", tabindex: "0" }, onClick: () => { this.selected = { kind: "meeting", path: m.path }; this.renderOverlay(); } });
    const date = el(r, "div", { cls: "hb-meet-date" });
    el(date, "div", { cls: "hb-meet-mo", text: d ? d.toLocaleDateString(undefined, { month: "short" }) : "" });
    el(date, "div", { cls: "hb-meet-d", text: d ? String(d.getDate()) : "?" });
    const main = el(r, "div", { cls: "hb-row-main" });
    el(main, "div", { cls: "hb-row-title", text: m.title });
    const meta = el(main, "div", { cls: "hb-meta" });
    this.appChip(meta, m.app);
    if (m.attendees.length) el(meta, "span", { cls: "hb-faint", text: m.attendees.join(", ") });
    const tasks = this.index.itemsFromMeeting(m);
    if (!this.narrow) {
      const counts = el(r, "div", { cls: "hb-meta" });
      el(counts, "span", { cls: "hb-chip", text: `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}` });
      el(counts, "span", { cls: "hb-chip is-ok", text: `${m.decisions.length} decided` });
      if (m.unresolved.length) el(counts, "span", { cls: "hb-chip is-q", text: `${m.unresolved.length} unresolved` });
    } else if (m.unresolved.length) el(meta, "span", { cls: "hb-chip is-q", text: `${m.unresolved.length} unresolved` });
  }

  private renderMeetings(c: HTMLElement): void {
    const ms = this.index.meetings.filter((m) => this.lens === "all" || m.app === this.lens);
    this.head(c, "Processed from Meetings/raw by /process-meeting", "Meetings", true);
    this.lensBar(c);
    const grid = el(c, "div", { cls: "hb-home-grid" });
    const g = this.section(el(grid, "div", { cls: "hb-col" }), "Recent", ms.length);
    ms.length ? ms.forEach((m) => this.meetingRow(g, m)) : this.emptyRow(g, "No meeting notes yet.");
    const un = ms.flatMap((m) => m.unresolved.map((u) => ({ m, u })));
    const ug = this.section(el(grid, "div", { cls: "hb-col" }), "Unresolved", un.length);
    if (!un.length) this.emptyRow(ug, "Nothing unresolved.");
    for (const { m, u } of un) {
      const r = el(ug, "div", { cls: "hb-meet", attr: { role: "button", tabindex: "0" }, onClick: () => { this.selected = { kind: "meeting", path: m.path }; this.renderOverlay(); } });
      const main = el(r, "div", { cls: "hb-row-main" });
      el(main, "div", { text: u });
      el(main, "div", { cls: "hb-faint", text: `${m.title} · ${m.date}` });
    }
  }

  /* ---------- daily log ---------- */

  private renderLogPanel(c: HTMLElement, compact: boolean): void {
    const log = this.index.todayLog();
    const next = log?.next ?? [];
    const g = this.section(c, compact ? "Today's log" : "Next", compact ? undefined : next.length, compact ? { label: "Open log", go: () => this.go("log") } : undefined);
    const shown = compact ? next.filter((n) => !n.done) : next;
    for (const n of shown) this.logCheck(g, log?.file ?? null, n);
    if (compact && !shown.length) el(g, "div", { cls: "hb-empty", text: log ? `${log.did.length} done today. Nothing queued for next.` : "No log for today yet." });
    this.logInput(g, "next", "+ Add to Next");
  }

  private logCheck(c: HTMLElement, file: TFile | null, n: ChecklistItem): void {
    const l = el(c, "label", { cls: ["hb-log-line", n.done ? "is-done" : ""] });
    const box = el(l, "input", { attr: { type: "checkbox" } });
    box.checked = n.done;
    box.addEventListener("change", () => { if (file) void this.act(this.index.toggleLine(file, n.line, box.checked)); });
    el(l, "span", { cls: "hb-grow", text: n.text });
    if (!n.done) el(l, "button", { cls: "hb-link", text: "Make task", onClick: (e) => { e.preventDefault(); this.draft = { text: n.text, app: null, type: null, due: null }; if (this.narrow) this.renderOverlay(); else { this.draw(); this.contentEl.querySelector<HTMLInputElement>(".hb-capture input")?.focus(); } } });
  }

  private logInput(c: HTMLElement, section: "did" | "notes" | "next", placeholder: string): void {
    const input = el(c, "input", { cls: "hb-log-add", attr: { type: "text", placeholder, enterkeyhint: "done" } });
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || !input.value.trim()) return;
      const v = input.value.trim();
      input.value = "";
      void this.act(this.index.logAppend(section, v));
    });
  }

  private renderLog(c: HTMLElement): void {
    const log = this.index.todayLog();
    const key = isoDate(this.today);
    this.head(c, `${this.plugin.settings.logsFolder}/${key}.md`, this.narrow ? "Log" : "Daily log");
    const grid = el(c, "div", { cls: "hb-home-grid" });
    const left = el(grid, "div", { cls: "hb-col" });
    const right = el(grid, "div", { cls: "hb-col" });
    const did = this.section(left, "Did", log?.did.length ?? 0);
    for (const d of log?.did ?? []) { const l = el(did, "div", { cls: "hb-log-line" }); el(l, "span", { cls: "hb-faint", text: "–" }); el(l, "span", { text: d }); }
    this.logInput(did, "did", "+ What got done");
    const notes = this.section(left, "Notes", log?.notes.length ?? 0);
    for (const d of log?.notes ?? []) { const l = el(notes, "div", { cls: "hb-log-line" }); el(l, "span", { cls: "hb-faint", text: "–" }); el(l, "span", { text: d }); }
    this.logInput(notes, "notes", "+ Worth remembering");
    this.renderLogPanel(left, false);

    const days: string[] = [];
    for (let k = 13; k >= 0; k--) days.push(isoDate(addDays(this.today, -k)));
    const have = new Set(this.index.logs.map((l) => l.date));
    let streak = 0;
    for (let k = days.length - 1; k >= 0 && have.has(days[k] as string); k--) streak++;
    const sg = this.section(right, "Last 14 days", undefined);
    const strip = el(sg, "div", { cls: "hb-streak" });
    for (const d of days) el(strip, "span", { cls: [have.has(d) ? "is-on" : "", d === key ? "is-today" : ""], attr: { title: d } });
    el(sg, "div", { cls: "hb-faint hb-pad", text: `${streak}-day streak` });
    const past = this.index.logs.filter((l) => l.date !== key).slice(0, 30);
    const pg = this.section(right, "Earlier", past.length);
    if (!past.length) this.emptyRow(pg, "No earlier logs.");
    for (const l of past) {
      const det = el(pg, "details", { cls: "hb-past" });
      const sum = el(det, "summary");
      el(sum, "span", { cls: "hb-mono hb-faint", text: l.date });
      el(sum, "span", { cls: "hb-grow hb-ellipsis", text: l.did[0] ?? l.notes[0] ?? "" });
      const b = el(det, "div", { cls: "hb-past-body" });
      for (const d of l.did) el(b, "div", { text: `– ${d}` });
      for (const d of l.notes) el(b, "div", { text: `Note: ${d}` });
      el(b, "button", { cls: "hb-link", text: "Open note", onClick: () => this.openFile(l.file) });
    }
  }

  /* ---------- quick fixes ---------- */

  private renderQuick(c: HTMLElement): void {
    this.head(c, "One-liners from each app's Quick fixes note", "Quick fixes", true);
    this.lensBar(c);
    const lists = this.index.quickLists.filter((q) => this.lens === "all" || q.app === this.lens);
    if (!lists.length) el(c, "div", { cls: "hb-empty", text: "No quick-list notes for this app." });
    for (const q of lists) {
      const open = q.items.filter((x) => !x.done).length;
      const g = this.section(c, this.appDef(q.app).name === "General" ? "Personal" : q.app, open, { label: "Open note", go: () => this.openFile(q.file) });
      if (!q.items.length) this.emptyRow(g, "Nothing here.");
      for (const it of q.items) {
        const l = el(g, "label", { cls: ["hb-log-line", it.done ? "is-done" : ""] });
        const box = el(l, "input", { attr: { type: "checkbox" } });
        box.checked = it.done;
        box.addEventListener("change", () => void this.act(this.index.toggleLine(q.file, it.line, box.checked)));
        el(l, "span", { cls: "hb-grow", text: it.text });
      }
    }
  }

  /* ---------- more (narrow only) ---------- */

  private renderMore(c: HTMLElement): void {
    this.head(c, this.app.vault.getName(), "More");
    const g = el(c, "div", { cls: "hb-group" });
    const items: [Screen, string, string, string, number][] = [
      ["ops", "Ops", "Jobs with no code change", "repeat", this.items().filter((i) => i.type === "ops" && this.isOpenItem(i)).length],
      ["meetings", "Meetings", "Decisions and open questions", "users", this.index.meetings.length],
      ["upcoming", "Upcoming", "Everything with a due date", "calendar", this.items().filter((i) => i.due && this.isOpenItem(i)).length],
      ["quick", "Quick fixes", "One-liners per app", "list-checks", this.index.quickLists.reduce((n, q) => n + q.items.filter((x) => !x.done).length, 0)],
    ];
    for (const [id, label, sub, ic, n] of items) {
      const b = el(g, "button", { cls: "hb-menu-item", onClick: () => this.go(id) });
      icon(b, ic, "hb-menu-icon");
      const t = el(b, "span", { cls: "hb-grow" });
      el(t, "div", { text: label });
      el(t, "div", { cls: "hb-faint", text: sub });
      el(b, "span", { cls: "hb-mono hb-faint", text: String(n) });
    }
    const g2 = el(c, "div", { cls: "hb-group" });
    const rv = el(g2, "button", { cls: "hb-menu-item", onClick: () => this.startReview() });
    icon(rv, "inbox", "hb-menu-icon");
    const t = el(rv, "span", { cls: "hb-grow" });
    el(t, "div", { text: "Review inbox" });
    el(t, "div", { cls: "hb-faint", text: "Swipe through new tasks" });
    el(rv, "span", { cls: "hb-mono hb-faint", text: String(this.index.items.filter((i) => i.status === "inbox").length) });
  }

  /* ---------- overlays: detail, capture sheet, review ---------- */

  private sheet(o: HTMLElement, title: string | null, onClose: () => void): HTMLElement {
    el(o, "div", { cls: "hb-scrim", onClick: onClose });
    const s = el(o, "div", { cls: this.narrow ? "hb-sheet" : "hb-drawer", attr: { role: "dialog", "aria-modal": "true" } });
    if (this.narrow) el(s, "div", { cls: "hb-grab" });
    if (title != null) {
      const h = el(s, "div", { cls: "hb-sheet-head" });
      el(h, "h4", { text: title });
      const x = el(h, "button", { cls: "hb-x", attr: { "aria-label": "Close" }, onClick: onClose });
      icon(x, "x");
    }
    return s;
  }

  private renderOverlay(): void {
    const o = this.overlayEl;
    if (!o) return;
    o.empty();
    const close = () => { this.selected = null; this.renderOverlay(); };
    if (this.draft && this.narrow) this.renderCaptureSheet(o);
    else if (this.selected?.kind === "item") {
      const i = this.item(this.selected.path);
      if (i) this.renderItemDetail(o, i, close);
    } else if (this.selected?.kind === "meeting") {
      const m = this.meeting(this.selected.path);
      if (m) this.renderMeetingDetail(o, m, close);
    }
    if (this.review) this.renderReview(o);
  }

  private renderItemDetail(o: HTMLElement, i: WorkItem, close: () => void): void {
    const s = this.sheet(o, i.title, close);
    const body = el(s, "div", { cls: "hb-sheet-body" });
    el(body, "div", { cls: "hb-label", text: "Status" });
    const chips = el(body, "div", { cls: "hb-chips-scroll" });
    for (const st of [...BOARD_STATUSES.map((b) => b.id), "dropped" as Status]) {
      el(chips, "button", { cls: ["hb-pick", i.status === st ? "is-active" : ""], text: statusLabel(st), onClick: () => void this.act(this.index.setStatus(i, st), `Status: ${statusLabel(st)}`) });
    }
    const dl = el(body, "dl", { cls: "hb-props" });
    const prop = (k: string) => { el(dl, "dt", { text: k }); return el(dl, "dd"); };
    this.appChip(prop("App"), i.app);
    prop("Type").setText(i.type === "ops" ? "Ops job" : "Task");
    if (i.area) prop("Area").setText(i.area);
    const dueIn = el(prop("Due"), "input", { attr: { type: "date" } });
    dueIn.value = i.due;
    dueIn.addEventListener("change", () => void this.act(this.index.setDue(i, dueIn.value), dueIn.value ? `Due ${dueIn.value}` : "Due date cleared"));
    if (i.repeat) prop("Repeat").setText(`Every ${i.repeat}`);
    if (i.lastDone) prop("Last done").setText(i.lastDone);
    for (const [k, v] of [["Issue", i.issue], ["PR", i.pr]] as const) {
      if (!v) continue;
      const dd = prop(k);
      dd.addClass("hb-mono");
      dd.setText(v);
    }
    const m = this.index.meetingFor(i);
    if (m) el(prop("Source"), "button", { cls: "hb-link", text: m.title, onClick: () => { this.selected = { kind: "meeting", path: m.path }; this.renderOverlay(); } });
    if (i.summary) el(body, "div", { cls: "hb-summary", text: i.summary });
    if (i.checklist.length) {
      const done = i.checklist.filter((x) => x.done).length;
      el(body, "div", { cls: "hb-label", text: `${i.type === "ops" ? "Steps" : "Work"} · ${done}/${i.checklist.length}` });
      const list = el(body, "div", { cls: "hb-checklist" });
      for (const w of i.checklist) {
        const l = el(list, "label", { cls: w.done ? "is-done" : "" });
        const box = el(l, "input", { attr: { type: "checkbox" } });
        box.checked = w.done;
        box.addEventListener("change", () => void this.act(this.index.toggleLine(i.file, w.line, box.checked)));
        el(l, "span", { text: w.text });
      }
    }
    if (i.hasOpenQuestions) {
      const q = el(body, "div", { cls: "hb-meta" });
      el(q, "span", { cls: "hb-chip is-q", text: "Open questions" });
      el(q, "span", { cls: "hb-faint", text: "Answer them before moving this to Ready." });
    }
    el(body, "div", { cls: "hb-path", text: i.path });
    const foot = el(s, "div", { cls: "hb-sheet-foot" });
    el(foot, "button", { cls: "hb-btn", text: "Open note", onClick: () => this.openFile(i.file) });
    if (i.type === "ops") {
      el(foot, "button", { cls: "hb-btn", text: "Snooze a week", onClick: () => void this.act(this.index.snooze(i).then((d) => `Snoozed to ${d}`)) });
      el(foot, "button", { cls: "hb-btn mod-cta", text: "Mark done", onClick: () => { void this.act(this.index.complete(i)); close(); } });
    }
  }

  private renderMeetingDetail(o: HTMLElement, m: Meeting, close: () => void): void {
    const s = this.sheet(o, m.title, close);
    const body = el(s, "div", { cls: "hb-sheet-body" });
    const dl = el(body, "dl", { cls: "hb-props" });
    el(dl, "dt", { text: "Date" }); el(dl, "dd", { text: m.date });
    el(dl, "dt", { text: "App" }); this.appChip(el(dl, "dd"), m.app);
    if (m.attendees.length) { el(dl, "dt", { text: "People" }); el(dl, "dd", { text: m.attendees.join(", ") }); }
    if (m.summary) el(body, "div", { cls: "hb-summary", text: m.summary });
    const listOf = (label: string, items: string[]) => {
      if (!items.length) return;
      el(body, "div", { cls: "hb-label", text: label });
      const ul = el(body, "ul", { cls: "hb-bullets" });
      for (const x of items) el(ul, "li", { text: x });
    };
    listOf("Decisions", m.decisions);
    listOf("Unresolved", m.unresolved);
    const tasks = this.index.itemsFromMeeting(m);
    if (tasks.length) {
      el(body, "div", { cls: "hb-label", text: "Tasks from this meeting" });
      const g = el(body, "div", { cls: "hb-group" });
      tasks.forEach((i) => this.row(g, i));
    }
    el(body, "div", { cls: "hb-path", text: m.path });
    const foot = el(s, "div", { cls: "hb-sheet-foot" });
    el(foot, "button", { cls: "hb-btn", text: "Open note", onClick: () => this.openFile(m.file) });
  }

  private renderReview(o: HTMLElement): void {
    const r = this.review as Review;
    const end = () => { this.review = null; this.renderOverlay(); };
    const wrap = el(o, "div", { cls: "hb-review", attr: { role: "dialog", "aria-modal": "true" } });
    const top = el(wrap, "div", { cls: "hb-review-top" });
    const current = r.queue.slice(r.i).map((p) => this.item(p)).find((x) => x && x.status === "inbox");
    if (current) r.i = r.queue.indexOf(current.path);
    el(top, "span", { cls: "hb-mono", text: current ? `${r.i + 1} / ${r.queue.length}` : "" });
    const prog = el(top, "div", { cls: "hb-progress" });
    el(prog, "span", { style: { width: `${(r.i / r.queue.length) * 100}%` } });
    const x = el(top, "button", { cls: "hb-x", attr: { "aria-label": "Close" }, onClick: end });
    icon(x, "x");
    const deck = el(wrap, "div", { cls: "hb-deck" });
    if (!current) {
      const card = el(deck, "div", { cls: "hb-rcard" });
      el(card, "h4", { text: "Inbox reviewed" });
      el(card, "div", { cls: "hb-summary", text: `${r.counts.ready} approved, ${r.counts.kept} kept, ${r.counts.dropped} dropped.` });
      const acts = el(wrap, "div", { cls: "hb-review-acts" });
      el(acts, "button", { cls: "hb-btn mod-cta", text: "Done", onClick: end });
      return;
    }
    const decide = async (kind: "ready" | "keep" | "drop") => {
      if (kind === "ready") { r.counts.ready++; await this.act(this.index.setStatus(current, "ready")); }
      else if (kind === "drop") { r.counts.dropped++; await this.act(this.index.setStatus(current, "dropped")); }
      else r.counts.kept++;
      r.i++;
      this.renderOverlay();
    };
    const card = el(deck, "div", { cls: "hb-rcard" });
    el(card, "span", { cls: "hb-stamp is-yes", text: "Ready" });
    el(card, "span", { cls: "hb-stamp is-no", text: "Drop" });
    const meta = el(card, "div", { cls: "hb-meta" });
    this.appChip(meta, current.app);
    el(meta, "span", { cls: "hb-chip", text: current.type === "ops" ? "Ops job" : current.area || "Task" });
    if (current.hasOpenQuestions) el(meta, "span", { cls: "hb-chip is-q", text: "Open questions" });
    el(card, "h4", { text: current.title });
    if (current.summary) el(card, "div", { cls: "hb-summary", text: current.summary });
    const ul = el(card, "ul", { cls: "hb-bullets" });
    for (const w of current.checklist) el(ul, "li", { text: w.text });
    el(card, "button", { cls: "hb-link", text: "Open note", onClick: () => this.openFile(current.file) });
    const acts = el(wrap, "div", { cls: "hb-review-acts" });
    el(acts, "button", { cls: "hb-btn", text: "Drop", onClick: () => void decide("drop") });
    el(acts, "button", { cls: "hb-btn", text: "Keep in inbox", onClick: () => void decide("keep") });
    el(acts, "button", { cls: "hb-btn mod-cta", text: "Ready", onClick: () => void decide("ready") });

    // swipe: right for Ready, left to drop
    let x0: number | null = null, dx = 0;
    const yes = card.querySelector<HTMLElement>(".is-yes"), no = card.querySelector<HTMLElement>(".is-no");
    card.addEventListener("pointerdown", (e) => { if ((e.target as HTMLElement).closest("button")) return; x0 = e.clientX; card.setPointerCapture(e.pointerId); card.style.transition = "none"; });
    card.addEventListener("pointermove", (e) => {
      if (x0 == null) return;
      dx = e.clientX - x0;
      card.style.transform = `translateX(${dx}px) rotate(${dx / 24}deg)`;
      if (yes) yes.style.opacity = String(Math.max(0, dx / 110));
      if (no) no.style.opacity = String(Math.max(0, -dx / 110));
    });
    const up = () => {
      if (x0 == null) return;
      x0 = null;
      card.style.transition = "";
      if (Math.abs(dx) > 110) void decide(dx > 0 ? "ready" : "drop");
      else { card.style.transform = ""; if (yes) yes.style.opacity = "0"; if (no) no.style.opacity = "0"; }
      dx = 0;
    };
    card.addEventListener("pointerup", up);
    card.addEventListener("pointercancel", up);
  }
}
