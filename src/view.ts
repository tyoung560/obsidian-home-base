import { ItemView, Notice, Platform, TFile, WorkspaceLeaf } from "obsidian";
import { firstStatus } from "./model/actions";
import { matches } from "./model/filter";
import { isOpen } from "./model/items";
import { daysUntil } from "./parse";
import { drawCaptureBar, drawCaptureSheet, drawItemDetail, drawMeetingDetail, drawReview } from "./sheets";
import { drawBoard, drawFilter, drawHome, drawJournal, drawMeetings, drawMore, drawQuick, drawUpcoming } from "./screens";
import { dueChip, el, emptyRow, icon, spaceChip, spaceName, statusText, wireRow } from "./ui";
import type { VItem, VMeeting } from "./vault";
import type { SavedFilter, SpaceValue, Workspace } from "./workspace/schema";
import type HomeBasePlugin from "./main";

export const VIEW_TYPE = "home-base";

/** "filter:<id>" is a saved filter with rail: true. */
export type Screen = "home" | "board" | "upcoming" | "meetings" | "journal" | "quick" | "more" | `filter:${string}`;
export type Selected = { kind: "item"; path: string } | { kind: "meeting"; path: string } | null;
export interface Review { queue: string[]; i: number; counts: { ready: number; kept: number; dropped: number } }
export interface CaptureDraft { text: string; space: string | null; type: string | null; due: string | null }

/**
 * The Home Base view: navigation, the screen, and the overlay (detail, capture sheet, review).
 * Method names avoid Obsidian's own View internals (open, close, render, load): see CLAUDE.md.
 */
export class HomeBaseView extends ItemView {
  screen: Screen = "home";
  lens = "all";
  selected: Selected = null;
  review: Review | null = null;
  boardPage = 0;
  draft: CaptureDraft | null = null;
  narrow = false;
  dragPath: string | null = null;
  private overlayEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, readonly plugin: HomeBasePlugin) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "Home Base"; }
  getIcon(): string { return "layout-dashboard"; }

  get index() { return this.plugin.index; }
  get ws(): Workspace | null { return this.plugin.store.workspace; }
  get today(): Date { return this.index.today(); }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("hb-root");
    this.registerEvent(this.index.on("updated", () => this.draw()));
    this.registerEvent(this.plugin.store.on("changed", () => this.draw()));
    const measure = () => Platform.isPhone || this.contentEl.clientWidth < 720;
    const ro = new ResizeObserver(() => {
      if (measure() !== this.narrow) { this.narrow = measure(); this.draw(); }
    });
    ro.observe(this.contentEl);
    this.register(() => ro.disconnect());
    this.narrow = measure();
    this.draw();
  }

  /* ---------- entry points for commands ---------- */

  openCapture(): void {
    this.draft = { text: "", space: this.lens !== "all" ? this.lens : null, type: null, due: null };
    if (this.narrow) this.drawOverlay();
    else this.contentEl.querySelector<HTMLInputElement>(".hb-capture input")?.focus();
  }

  startReview(): void {
    const queue = this.items().filter((i) => i.status?.meaning === "new").map((i) => i.path);
    if (!queue.length) { new Notice("Nothing waiting for review"); return; }
    this.review = { queue, i: 0, counts: { ready: 0, kept: 0, dropped: 0 } };
    this.selected = null;
    this.drawOverlay();
  }

  /* ---------- shared state helpers ---------- */

  /** Items in the current space lens. */
  items(): VItem[] {
    return this.index.items.filter((i) => this.lens === "all" || i.spaceValue === this.lens);
  }
  meetings(): VMeeting[] {
    return this.index.meetings.filter((m) => this.lens === "all" || m.spaceValue === this.lens);
  }
  filterItems(f: SavedFilter): VItem[] {
    return this.items().filter((i) => matches(i, f.where, this.today));
  }
  railFilters(): SavedFilter[] {
    return this.ws?.filters.filter((f) => f.rail) ?? [];
  }
  hasKind(kind: string): boolean {
    return !!this.ws?.types.some((t) => t.kind === kind);
  }
  item(path: string): VItem | undefined { return this.index.items.find((i) => i.path === path); }
  meeting(path: string): VMeeting | undefined { return this.index.meetings.find((m) => m.path === path); }

  async act(p: Promise<unknown>, msg?: string): Promise<void> {
    try {
      const r = await p;
      const text = typeof r === "string" ? r : msg;
      if (text) new Notice(text);
    } catch (e) {
      console.error("Home Base", e);
      new Notice(`Home Base: ${e instanceof Error ? e.message : "that didn't work"}`);
    }
  }
  openFile(file: TFile): void {
    void this.app.workspace.getLeaf(Platform.isMobile ? false : "tab").openFile(file);
  }
  select(s: Selected): void {
    this.selected = s;
    this.drawOverlay();
  }
  go(s: Screen): void {
    this.screen = s;
    this.selected = null;
    this.draw();
    this.contentEl.querySelector(".hb-screen")?.scrollTo(0, 0);
  }
  setLens(id: string): void {
    this.lens = id;
    this.draw();
  }

  /* ---------- drawing ---------- */

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
    const store = this.plugin.store;
    if (!this.ws) {
      const box = el(root, "div", { cls: "hb-error" });
      el(box, "h3", { text: store.errors.length ? "Home Base needs a valid workspace note" : "Reading the workspace…" });
      if (store.errors.length) {
        const ul = el(box, "ul");
        for (const e of store.errors) el(ul, "li", { text: e });
        el(box, "button", { cls: "hb-btn mod-cta", text: "Open the workspace note", onClick: () => void this.plugin.openWorkspaceNote() });
      }
      return;
    }
    if (!this.index.ready) { el(root, "div", { cls: "hb-empty", text: "Reading the vault…" }); return; }
    if (this.screen.startsWith("filter:") && !this.railFilters().some((f) => `filter:${f.id}` === this.screen)) this.screen = "home";
    if (this.screen !== "home" && this.screen !== "board" && this.screen !== "upcoming" && this.screen !== "more" && !this.screen.startsWith("filter:")) {
      const need = ({ meetings: "meeting", journal: "journal", quick: "checklist" } as Record<string, string>)[this.screen];
      if (need && !this.hasKind(need)) this.screen = "home";
    }

    const screenEl = this.narrow ? el(root, "div", { cls: "hb-screen" }) : (() => {
      const shell = el(root, "div", { cls: "hb-shell" });
      this.drawRail(el(shell, "nav", { cls: "hb-rail" }));
      return el(shell, "div", { cls: "hb-screen hb-main" });
    })();
    if (store.errors.length) {
      const b = el(screenEl, "div", { cls: "hb-banner" });
      el(b, "span", { text: `The workspace note has ${store.errors.length === 1 ? "a problem" : `${store.errors.length} problems`}, so Home Base is using the last version that worked. ${store.errors[0]}` });
      el(b, "button", { cls: "hb-link", text: "Open note", onClick: () => void this.plugin.openWorkspaceNote() });
    }
    if (!this.narrow) drawCaptureBar(this, screenEl);
    const body = el(screenEl, "div", { cls: "hb-body" });
    const s = this.screen;
    if (s === "home") drawHome(this, body);
    else if (s === "board") drawBoard(this, body);
    else if (s === "upcoming") drawUpcoming(this, body);
    else if (s === "meetings") drawMeetings(this, body);
    else if (s === "journal") drawJournal(this, body);
    else if (s === "quick") drawQuick(this, body);
    else if (s === "more") drawMore(this, body);
    else {
      const f = this.railFilters().find((x) => `filter:${x.id}` === s);
      if (f) drawFilter(this, body, f);
    }
    if (this.narrow) this.drawTabbar(root);
    screenEl.scrollTop = prevScroll;
    this.overlayEl = el(root, "div", { cls: "hb-overlay" });
    this.drawOverlay();
  }

  /** Screens in the rail and under More, in order, for the current workspace. */
  screens(): { id: Screen; label: string; icon: string; count?: number }[] {
    const items = this.items();
    const out: { id: Screen; label: string; icon: string; count?: number }[] = [
      { id: "home", label: "Home", icon: "home" },
      { id: "board", label: "Board", icon: "kanban", count: items.filter((i) => i.type.board && isOpen(i)).length },
      { id: "upcoming", label: "Upcoming", icon: "calendar", count: items.filter((i) => i.due && isOpen(i)).length },
    ];
    for (const f of this.railFilters()) out.push({ id: `filter:${f.id}`, label: f.label, icon: f.icon, count: this.filterItems(f).length });
    if (this.hasKind("meeting")) out.push({ id: "meetings", label: "Meetings", icon: "users", count: this.meetings().length });
    if (this.hasKind("journal")) out.push({ id: "journal", label: this.index.journalType()?.label ?? "Journal", icon: "pen-line" });
    if (this.hasKind("checklist")) {
      const t = this.ws?.types.find((x) => x.kind === "checklist");
      const n = this.index.quickLists.filter((q) => this.lens === "all" || q.spaceValue === this.lens).reduce((a, q) => a + q.items.filter((x) => !x.done).length, 0);
      out.push({ id: "quick", label: t?.label ?? "Checklists", icon: "list-checks", count: n });
    }
    return out;
  }

  private lensOptions(): { id: string; label: string; color: string; space: SpaceValue | null }[] {
    return [{ id: "all", label: "All", color: "", space: null }, ...(this.ws?.space.values ?? []).map((s) => ({ id: s.value, label: s.label, color: s.color, space: s }))];
  }

  private drawRail(rail: HTMLElement): void {
    const brand = el(rail, "div", { cls: "hb-brand" });
    el(brand, "div", { cls: "hb-brand-name", text: "Home Base" });
    el(brand, "div", { cls: "hb-brand-sub", text: this.today.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) });
    const views = el(rail, "div", { cls: "hb-rail-group" });
    el(views, "div", { cls: "hb-rail-label", text: "Views" });
    for (const s of this.screens()) {
      const b = el(views, "button", { cls: ["hb-nav", this.screen === s.id ? "is-active" : ""], onClick: () => this.go(s.id) });
      icon(b, s.icon);
      el(b, "span", { text: s.label });
      if (s.count != null) el(b, "span", { cls: "hb-count", text: String(s.count) });
    }
    const opts = this.lensOptions();
    if (opts.length > 1) {
      const lenses = el(rail, "div", { cls: "hb-rail-group" });
      el(lenses, "div", { cls: "hb-rail-label", text: this.spaceTitle() });
      for (const o of opts) {
        const n = this.index.items.filter((i) => isOpen(i) && (o.id === "all" || i.spaceValue === o.id)).length;
        const b = el(lenses, "button", { cls: ["hb-nav", this.lens === o.id ? "is-active" : ""], onClick: () => this.setLens(o.id) });
        el(b, "span", { cls: "hb-dot", style: { background: o.color || "var(--text-normal)" } });
        el(b, "span", { text: o.id === "all" ? `All ${this.spaceTitle().toLowerCase()}` : o.space ? spaceName(o.space) : o.label });
        el(b, "span", { cls: "hb-count", text: String(n) });
      }
    }
  }

  /** "Apps" for space property `app`, "Projects" for `project`. */
  spaceTitle(): string {
    const p = this.ws?.space.property ?? "space";
    return `${p.charAt(0).toUpperCase()}${p.slice(1)}${p.endsWith("s") ? "" : "s"}`;
  }

  lensBar(c: HTMLElement): void {
    if (!this.narrow) return;
    const opts = this.lensOptions();
    if (opts.length < 2) return;
    const bar = el(c, "div", { cls: "hb-lenses" });
    for (const o of opts) {
      const n = this.index.items.filter((i) => isOpen(i) && (o.id === "all" || i.spaceValue === o.id)).length;
      const b = el(bar, "button", { cls: ["hb-lens", this.lens === o.id ? "is-active" : ""], onClick: () => this.setLens(o.id) });
      if (o.color) el(b, "span", { cls: "hb-dot", style: { background: o.color } });
      el(b, "span", { text: o.label });
      el(b, "span", { cls: "hb-n", text: String(n) });
    }
  }

  private drawTabbar(root: HTMLElement): void {
    const bar = el(root, "nav", { cls: "hb-tabbar" });
    const inbox = this.index.items.filter((i) => i.status?.meaning === "new").length;
    const hasJournal = this.hasKind("journal");
    const tab = (id: Screen, label: string, ic: string, badge?: number) => {
      const more = !["home", "board", hasJournal ? "journal" : "upcoming"].includes(this.screen);
      const active = this.screen === id || (id === "more" && more);
      const b = el(bar, "button", { cls: ["hb-tab", active ? "is-active" : ""], onClick: () => this.go(id) });
      icon(b, ic);
      el(b, "span", { text: label });
      if (badge) el(b, "span", { cls: "hb-badge", text: String(badge) });
    };
    tab("home", "Today", "home");
    tab("board", "Board", "kanban", inbox);
    const fab = el(bar, "button", { cls: "hb-fab", attr: { "aria-label": "Capture" }, onClick: () => this.openCapture() });
    icon(fab, "plus");
    if (hasJournal) tab("journal", "Log", "pen-line");
    else tab("upcoming", "Upcoming", "calendar");
    tab("more", "More", "more-horizontal");
  }

  backToMore(c: HTMLElement): void {
    if (!this.narrow) return;
    const b = el(c, "button", { cls: "hb-back", onClick: () => this.go("more") });
    icon(b, "chevron-left");
    el(b, "span", { text: "More" });
  }

  drawOverlay(): void {
    const o = this.overlayEl;
    if (!o) return;
    o.empty();
    const close = () => this.select(null);
    if (this.draft && this.narrow) drawCaptureSheet(this, o);
    else if (this.selected?.kind === "item") {
      const i = this.item(this.selected.path);
      if (i) drawItemDetail(this, o, i, close);
    } else if (this.selected?.kind === "meeting") {
      const m = this.meeting(this.selected.path);
      if (m) drawMeetingDetail(this, o, m, close);
    }
    if (this.review) drawReview(this, o);
  }

  /* ---------- rows and cards ---------- */

  row(c: HTMLElement, i: VItem): void {
    const ws = this.ws as Workspace;
    const wrap = el(c, "div", { cls: "hb-swipe" });
    const acts = el(wrap, "div", { cls: "hb-swipe-acts" });
    if (i.repeat) {
      el(acts, "button", { cls: "is-snooze", text: "Snooze", onClick: () => void this.act(this.index.snooze(i)) });
      el(acts, "button", { cls: "is-done", text: "Done", onClick: () => void this.act(this.index.complete(i)) });
    } else if (i.status?.meaning === "new" && firstStatus(ws, "todo")) {
      const todo = firstStatus(ws, "todo")!;
      el(acts, "button", { cls: "is-ready", text: todo.label, onClick: () => void this.act(this.index.setStatus(i, todo), `Moved to ${todo.label}`) });
    } else {
      el(acts, "button", { cls: "is-done", text: "Done", onClick: () => void this.act(this.index.complete(i)) });
    }
    const n = i.due ? daysUntil(i.due, this.today) : null;
    const r = el(wrap, "div", { cls: "hb-row", attr: { role: "button", tabindex: "0" } });
    el(r, "span", { cls: ["hb-stripe", n == null ? "" : n <= 0 ? "is-late" : n <= 7 ? "is-soon" : "", i.status?.meaning === "waiting" ? "is-late" : ""] });
    const main = el(r, "div", { cls: "hb-row-main" });
    el(main, "div", { cls: "hb-row-title", text: i.title });
    const meta = el(main, "div", { cls: "hb-meta" });
    spaceChip(meta, i.space, i.spaceValue);
    dueChip(meta, i.due, this.today);
    const bits = [i.area || (ws.types.filter((t) => t.kind === "item").length > 1 ? i.type.label : ""), statusText(i), i.repeat ? `every ${i.repeat}` : ""].filter(Boolean);
    el(meta, "span", { cls: "hb-faint", text: bits.join(" · ") });
    if (!this.narrow && i.repeat) {
      el(r, "button", { cls: "hb-btn hb-btn-small", text: "Mark done", onClick: (e) => { e.stopPropagation(); void this.act(this.index.complete(i)); } });
    }
    if (this.narrow) icon(r, "chevron-right", "hb-chev");
    wireRow(r, acts, this.narrow, () => this.select({ kind: "item", path: i.path }));
  }

  card(c: HTMLElement, i: VItem): void {
    const card = el(c, "div", { cls: "hb-card", attr: { draggable: this.narrow ? "false" : "true", role: "button", tabindex: "0" }, onClick: () => this.select({ kind: "item", path: i.path }) });
    el(card, "div", { cls: "hb-card-title", text: i.title });
    const meta = el(card, "div", { cls: "hb-meta" });
    spaceChip(meta, i.space, i.spaceValue);
    if (i.area) el(meta, "span", { cls: "hb-chip", text: i.area });
    if (i.hasQuestions) el(meta, "span", { cls: "hb-chip is-q", text: "Open questions" });
    dueChip(meta, i.due, this.today);
    const done = i.checklist.filter((x) => x.done).length;
    const foot = el(card, "div", { cls: "hb-card-foot" });
    const prog = el(foot, "div", { cls: "hb-progress" });
    el(prog, "span", { style: { width: `${i.checklist.length ? (done / i.checklist.length) * 100 : 0}%` } });
    el(foot, "span", { cls: "hb-mono", text: `${done}/${i.checklist.length}` });
    for (const l of i.links) el(foot, "span", { cls: "hb-mono", text: l.value.includes("#") ? `#${l.value.split("#")[1]}` : l.value });
    card.addEventListener("dragstart", (e) => { this.dragPath = i.path; card.addClass("is-dragging"); e.dataTransfer?.setData("text/plain", i.path); });
    card.addEventListener("dragend", () => card.removeClass("is-dragging"));
    card.addEventListener("keydown", (e) => { if (e.key === "Enter") card.click(); });
  }

  meetingRow(c: HTMLElement, m: VMeeting): void {
    const r = el(c, "div", { cls: "hb-meet", attr: { role: "button", tabindex: "0" }, onClick: () => this.select({ kind: "meeting", path: m.path }) });
    const date = el(r, "div", { cls: "hb-meet-date" });
    const [y, mo, d] = m.date.split("-").map(Number);
    const dt = y && mo && d ? new Date(y, mo - 1, d) : null;
    el(date, "div", { cls: "hb-meet-mo", text: dt ? dt.toLocaleDateString(undefined, { month: "short" }) : "" });
    el(date, "div", { cls: "hb-meet-d", text: dt ? String(dt.getDate()) : "?" });
    const main = el(r, "div", { cls: "hb-row-main" });
    el(main, "div", { cls: "hb-row-title", text: m.title });
    const meta = el(main, "div", { cls: "hb-meta" });
    spaceChip(meta, m.space, m.spaceValue);
    if (m.attendees.length) el(meta, "span", { cls: "hb-faint", text: m.attendees.join(", ") });
    const tasks = this.index.items.filter((i) => i.sources.includes(m.path.split("/").pop()!.replace(/\.md$/, "")) || m.linked.includes(i.title));
    const counts = this.narrow ? meta : el(r, "div", { cls: "hb-meta" });
    if (!this.narrow) {
      el(counts, "span", { cls: "hb-chip", text: `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}` });
      el(counts, "span", { cls: "hb-chip is-ok", text: `${m.decisions.length} decided` });
    }
    if (m.unresolved.length) el(counts, "span", { cls: "hb-chip is-q", text: `${m.unresolved.length} unresolved` });
  }

  emptyFor(c: HTMLElement, text: string): void {
    emptyRow(c, text);
  }
}
