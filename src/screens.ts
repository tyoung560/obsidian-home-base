/** Every screen of the view. Each draws into `c` from the view's state and the workspace. */
import { firstStatus } from "./model/actions";
import { matches, sortItems } from "./model/filter";
import { isOpen } from "./model/items";
import { addDays, daysUntil, isoDate } from "./parse";
import { dateLabel, el, emptyRow, head, icon, section, spaceName } from "./ui";
import type { HomeBaseView } from "./view";
import type { VItem } from "./vault";
import type { HomeSection, Meaning, SavedFilter, Workspace } from "./workspace/schema";

/* ---------- home ---------- */

export function drawHome(v: HomeBaseView, c: HTMLElement): void {
  const ws = v.ws as Workspace;
  const items = v.items();
  const fresh = items.filter((i) => i.status?.meaning === "new");
  const lensName = v.lens === "all" ? "" : ` · ${ws.space.values.find((s) => s.value === v.lens)?.label ?? v.lens}`;
  const h = head(c, `${v.today.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}${lensName}`, v.narrow ? "Today" : "Home");
  if (!v.narrow) {
    const tb = el(h, "div", { cls: "hb-toolbar" });
    el(tb, "button", { cls: "hb-btn", text: "Board", onClick: () => v.go("board") });
  }
  v.lensBar(c);

  const grid = el(c, "div", { cls: "hb-home-grid" });
  const main = el(grid, "div", { cls: "hb-col" });
  const side = el(grid, "div", { cls: "hb-col" });
  for (const s of ws.home) {
    const col = s.kind === "next" ? c : v.narrow ? main : s.column === "side" ? side : main;
    if (s.kind === "next") drawNext(v, c, items, fresh.length, grid);
    else drawSection(v, col, s, items);
  }
}

function drawNext(v: HomeBaseView, c: HTMLElement, items: VItem[], freshCount: number, before: HTMLElement): void {
  const overdue = items.filter((i) => isOpen(i) && i.due && (daysUntil(i.due, v.today) ?? 0) < 0).sort((a, b) => a.due.localeCompare(b.due));
  const next = el(c, "div", { cls: "hb-next" });
  c.insertBefore(next, before);
  el(next, "div", { cls: "hb-next-label", text: "Next step" });
  const acts = () => el(next, "div", { cls: "hb-next-acts" });
  const o = overdue[0];
  if (o) {
    el(next, "div", { cls: "hb-next-title", text: `${o.title} is ${-(daysUntil(o.due, v.today) ?? 0)} days overdue` });
    el(next, "div", { cls: "hb-next-text", text: overdue.length > 1 ? `${overdue.length - 1} more overdue after it.` : "It's the only overdue item." });
    const a = acts();
    el(a, "button", { cls: "hb-btn mod-cta", text: "Open it", onClick: () => v.select({ kind: "item", path: o.path }) });
    if (freshCount) el(a, "button", { cls: "hb-btn", text: `Review (${freshCount})`, onClick: () => v.startReview() });
  } else if (freshCount) {
    el(next, "div", { cls: "hb-next-title", text: `${freshCount} ${freshCount === 1 ? "item is" : "items are"} waiting for review` });
    el(next, "div", { cls: "hb-next-text", text: "Approve, keep or drop each one." });
    el(acts(), "button", { cls: "hb-btn mod-cta", text: "Review them", onClick: () => v.startReview() });
  } else {
    el(next, "div", { cls: "hb-next-title", text: "Nothing needs you right now" });
    el(next, "div", { cls: "hb-next-text", text: "Nothing is overdue or waiting for review." });
  }
}

function drawSection(v: HomeBaseView, col: HTMLElement, s: Exclude<HomeSection, { kind: "next" }>, items: VItem[]): void {
  const ws = v.ws as Workspace;
  if (s.kind === "list") {
    const list = sortItems(items.filter((i) => matches(i, s.where, v.today)), s.sort, ws);
    if (!list.length && s.hideEmpty) return;
    const g = section(col, s.title, list.length);
    if (!list.length) emptyRow(g, "Nothing here.");
    for (const i of s.limit ? list.slice(0, s.limit) : list) v.row(g, i);
    if (s.limit && list.length > s.limit) el(g, "button", { cls: "hb-more-row", text: `${list.length - s.limit} more`, onClick: () => moreFor(v, s.title) });
  } else if (s.kind === "journal") {
    if (v.hasKind("journal")) drawJournalPanel(v, col, true);
  } else if (s.kind === "meetings") {
    if (!v.hasKind("meeting")) return;
    const ms = v.meetings().slice(0, s.limit);
    const g = section(col, "Recent meetings", undefined, { label: "All meetings", go: () => v.go("meetings") });
    if (!ms.length) emptyRow(g, "No meetings yet.");
    for (const m of ms) v.meetingRow(g, m);
  } else if (s.kind === "spaces" && !v.narrow && ws.space.values.length) {
    const g = section(col, `By ${ws.space.property}`);
    const bars: [Meaning, string][] = [["new", "var(--text-faint)"], ["todo", "var(--interactive-accent)"], ["doing", "var(--color-green)"], ["waiting", "var(--color-red)"]];
    for (const sp of ws.space.values) {
      const ts = v.index.items.filter((i) => i.spaceValue === sp.value && isOpen(i));
      const r = el(g, "div", { cls: "hb-app-row", attr: { role: "button", tabindex: "0" }, onClick: () => v.setLens(sp.value) });
      const l = el(r, "div", { cls: "hb-row-main" });
      const nm = el(l, "div", { cls: "hb-app-name" });
      el(nm, "span", { cls: "hb-dot", style: { background: sp.color } });
      nm.appendText(spaceName(sp));
      const bar = el(l, "div", { cls: "hb-bar" });
      const total = ts.length || 1;
      const parts = bars.map(([m, col2]) => ({ m, col2, n: ts.filter((t) => t.status?.meaning === m).length })).filter((p) => p.n);
      for (const p of parts) el(bar, "span", { style: { width: `${(p.n / total) * 100}%`, background: p.col2 } });
      const label = parts.map((p) => `${p.n} ${ws.workflow.find((st) => st.meaning === p.m)?.label.toLowerCase() ?? p.m}`).join(" · ");
      el(r, "div", { cls: "hb-faint", text: label || "nothing open" });
    }
  }
}

function moreFor(v: HomeBaseView, title: string): void {
  const f = v.railFilters().find((x) => x.label === title);
  v.go(f ? `filter:${f.id}` : "upcoming");
}

/* ---------- board ---------- */

export function drawBoard(v: HomeBaseView, c: HTMLElement): void {
  const ws = v.ws as Workspace;
  const list = sortItems(v.items().filter((i) => i.type.board), "due", ws);
  const columns = ws.workflow.filter((s) => s.outcome !== "dropped").map((s) => ({ id: s.value, label: s.label, items: list.filter((i) => i.statusValue === s.value) }));
  const other = list.filter((i) => !i.status);
  if (other.length) columns.unshift({ id: "", label: "No status", items: other });
  const h = head(c, v.narrow ? "Swipe sideways for each status" : "Drag a card to change its status", "Board");
  v.lensBar(c);
  if (!v.narrow) {
    if (ws.space.values.length) {
      const seg = el(h, "div", { cls: "hb-seg" });
      for (const [id, label] of [["all", "All"], ...ws.space.values.map((s) => [s.value, s.label])] as [string, string][]) {
        el(seg, "button", { cls: v.lens === id ? "is-active" : "", text: label, onClick: () => v.setLens(id) });
      }
    }
    const board = el(el(c, "div", { cls: "hb-board-wrap" }), "div", { cls: "hb-board", style: { "--hb-cols": String(columns.length) } });
    const startId = (firstStatus(ws, "new") ?? firstStatus(ws, "todo"))?.value;
    for (const col of columns) {
      const colEl = el(board, "div", { cls: "hb-column" });
      const ch = el(colEl, "div", { cls: "hb-column-head" });
      el(ch, "span", { text: col.label });
      el(ch, "span", { cls: "hb-n", text: String(col.items.length) });
      const meaning = ws.workflow.find((s) => s.value === col.id)?.meaning;
      if (meaning) el(colEl, "div", { cls: "hb-column-hint", text: MEANING_HINT[meaning] });
      const body = el(colEl, "div", { cls: "hb-cards" });
      col.items.forEach((i) => v.card(body, i));
      if (col.id && col.id === startId) el(colEl, "button", { cls: "hb-add-card", text: "+ New", onClick: () => v.openCapture() });
      if (!col.id) continue;
      colEl.addEventListener("dragover", (e) => { e.preventDefault(); colEl.addClass("is-over"); });
      colEl.addEventListener("dragleave", () => colEl.removeClass("is-over"));
      colEl.addEventListener("drop", (e) => {
        e.preventDefault();
        colEl.removeClass("is-over");
        const it = v.dragPath ? v.item(v.dragPath) : undefined;
        const st = ws.workflow.find((s) => s.value === col.id);
        if (it && st && it.statusValue !== st.value) void v.act(v.index.setStatus(it, st), `${it.title}: ${st.label}`);
      });
    }
    return;
  }
  const tabs = el(c, "div", { cls: "hb-status-tabs", attr: { role: "tablist" } });
  const pager = el(c, "div", { cls: "hb-pager" });
  v.boardPage = Math.min(v.boardPage, columns.length - 1);
  columns.forEach((col, k) => {
    const t = el(tabs, "button", { cls: ["hb-stab", v.boardPage === k ? "is-active" : ""], attr: { role: "tab" }, onClick: () => {
      v.boardPage = k;
      pager.scrollTo({ left: k * pager.clientWidth, behavior: "smooth" });
      tabs.querySelectorAll(".hb-stab").forEach((b, j) => b.toggleClass("is-active", j === k));
    } });
    t.appendText(col.label);
    el(t, "span", { cls: "hb-n", text: String(col.items.length) });
    const page = el(pager, "div", { cls: "hb-page" });
    const meaning = ws.workflow.find((s) => s.value === col.id)?.meaning;
    if (meaning) el(page, "div", { cls: "hb-faint", text: MEANING_HINT[meaning] });
    if (col.items.length) col.items.forEach((i) => v.card(page, i));
    else emptyRow(page, "Nothing here.");
  });
  window.requestAnimationFrame(() => { pager.scrollLeft = v.boardPage * pager.clientWidth; });
  let tmr = 0;
  pager.addEventListener("scroll", () => {
    window.clearTimeout(tmr);
    tmr = window.setTimeout(() => {
      const k = Math.round(pager.scrollLeft / Math.max(1, pager.clientWidth));
      if (k !== v.boardPage) { v.boardPage = k; tabs.querySelectorAll(".hb-stab").forEach((b, j) => b.toggleClass("is-active", j === k)); }
    }, 80);
  });
}

const MEANING_HINT: Record<Meaning, string> = {
  new: "Waiting for review",
  todo: "Ready to start",
  doing: "Being worked on",
  waiting: "Waiting on someone",
  closed: "Finished",
};

/* ---------- upcoming ---------- */

export function drawUpcoming(v: HomeBaseView, c: HTMLElement): void {
  const dated = v.items().filter((i) => i.due && isOpen(i)).sort((a, b) => a.due.localeCompare(b.due));
  const undated = v.items().filter((i) => !i.due && isOpen(i)).length;
  v.backToMore(c);
  head(c, "Everything with a due date", "Upcoming");
  v.lensBar(c);
  if (!v.narrow) {
    const t = v.today;
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
        el(day, "button", { cls: "hb-cal-item", text: i.title, attr: { title: i.title }, style: { "--hb-app": i.space?.color ?? "var(--text-faint)" }, onClick: () => v.select({ kind: "item", path: i.path }) });
      }
    }
  }
  const groups = new Map<string, VItem[]>();
  for (const i of dated) groups.set(i.due, [...(groups.get(i.due) ?? []), i]);
  if (!groups.size) el(c, "div", { cls: "hb-empty", text: "Nothing has a due date." });
  for (const [d, list] of groups) {
    const n = daysUntil(d, v.today) ?? 0;
    const s = el(c, "section", { cls: "hb-section" });
    el(s, "div", { cls: ["hb-agenda-day", n < 0 ? "is-late" : ""], text: `${n < 0 ? "Overdue · " : n === 0 ? "Today · " : n === 1 ? "Tomorrow · " : ""}${dateLabel(d)}` });
    const g = el(s, "div", { cls: "hb-group" });
    list.forEach((i) => v.row(g, i));
  }
  if (undated) el(c, "div", { cls: "hb-note", text: `${undated} open ${undated === 1 ? "item has" : "items have"} no due date.` });
}

/* ---------- saved filter ---------- */

export function drawFilter(v: HomeBaseView, c: HTMLElement, f: SavedFilter): void {
  const ws = v.ws as Workspace;
  const list = sortItems(v.filterItems(f), f.sort, ws);
  v.backToMore(c);
  head(c, v.narrow && list.some((i) => i.repeat) ? "Swipe left for Done or Snooze" : "Saved filter", f.label);
  v.lensBar(c);
  const g = el(c, "div", { cls: "hb-group" });
  if (!list.length) emptyRow(g, "Nothing matches.");
  list.forEach((i) => v.row(g, i));
}

/* ---------- meetings ---------- */

export function drawMeetings(v: HomeBaseView, c: HTMLElement): void {
  const ms = v.meetings();
  v.backToMore(c);
  head(c, "Decisions and open questions", "Meetings");
  v.lensBar(c);
  const grid = el(c, "div", { cls: "hb-home-grid" });
  const g = section(el(grid, "div", { cls: "hb-col" }), "Recent", ms.length);
  if (!ms.length) emptyRow(g, "No meeting notes yet.");
  ms.forEach((m) => v.meetingRow(g, m));
  const un = ms.flatMap((m) => m.unresolved.map((u) => ({ m, u })));
  const ug = section(el(grid, "div", { cls: "hb-col" }), "Unresolved", un.length);
  if (!un.length) emptyRow(ug, "Nothing unresolved.");
  for (const { m, u } of un) {
    const r = el(ug, "div", { cls: "hb-meet", attr: { role: "button", tabindex: "0" }, onClick: () => v.select({ kind: "meeting", path: m.path }) });
    const main = el(r, "div", { cls: "hb-row-main" });
    el(main, "div", { text: u });
    el(main, "div", { cls: "hb-faint", text: `${m.title} · ${m.date}` });
  }
}

/* ---------- journal ---------- */

function journalInput(v: HomeBaseView, c: HTMLElement, sectionIndex: number, placeholder: string): void {
  const input = el(c, "input", { cls: "hb-log-add", attr: { type: "text", placeholder, enterkeyhint: "done" } });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !input.value.trim()) return;
    const value = input.value.trim();
    input.value = "";
    void v.act(v.index.journalAppend(sectionIndex, value));
  });
}

function journalChecks(v: HomeBaseView, c: HTMLElement, onlyOpen: boolean, sectionIndex: number): number {
  const j = v.index.todayJournal();
  const sec = j?.sections[sectionIndex];
  const checks = (sec?.checks ?? []).filter((x) => !onlyOpen || !x.done);
  for (const n of checks) {
    const l = el(c, "label", { cls: ["hb-log-line", n.done ? "is-done" : ""] });
    const box = el(l, "input", { attr: { type: "checkbox" } });
    box.checked = n.done;
    box.addEventListener("change", () => { if (j) void v.act(v.index.toggleLine(j.file, n.line, box.checked)); });
    el(l, "span", { cls: "hb-grow", text: n.text });
    if (!n.done) el(l, "button", { cls: "hb-link", text: "Make task", onClick: (e) => { e.preventDefault(); v.draft = { text: n.text, space: null, type: null, due: null }; v.narrow ? v.drawOverlay() : (v.draw(), v.contentEl.querySelector<HTMLInputElement>(".hb-capture input")?.focus()); } });
  }
  return checks.length;
}

function drawJournalPanel(v: HomeBaseView, c: HTMLElement, compact: boolean): void {
  const type = v.index.journalType();
  if (!type) return;
  const idx = type.sections.lines.findIndex((l) => l.kind === "checklist");
  const j = v.index.todayJournal();
  const label = idx >= 0 ? cap(type.sections.lines[idx]!.heading) : "";
  const g = section(c, compact ? `Today's ${type.label.toLowerCase()}` : label, undefined, compact ? { label: "Open", go: () => v.go("journal") } : undefined);
  if (idx < 0) {
    const bullets = j?.sections.reduce((n, s) => n + s.bullets.length, 0) ?? 0;
    emptyRow(g, j ? `${bullets} lines today.` : "Nothing written today.");
    return;
  }
  const shown = journalChecks(v, g, compact, idx);
  if (compact && !shown) emptyRow(g, j ? `Nothing queued under ${label}.` : "Nothing written today.");
  journalInput(v, g, idx, `+ Add to ${label}`);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function drawJournal(v: HomeBaseView, c: HTMLElement): void {
  const type = v.index.journalType();
  if (!type) return;
  const j = v.index.todayJournal();
  const key = isoDate(v.today);
  head(c, `${type.folder}/${key}.md`, type.label);
  const grid = el(c, "div", { cls: "hb-home-grid" });
  const left = el(grid, "div", { cls: "hb-col" });
  const right = el(grid, "div", { cls: "hb-col" });
  type.sections.lines.forEach((line, k) => {
    const sec = j?.sections[k];
    if (line.kind === "checklist") {
      const g = section(left, cap(line.heading), sec?.checks.length ?? 0);
      journalChecks(v, g, false, k);
      journalInput(v, g, k, `+ Add to ${cap(line.heading)}`);
      return;
    }
    const g = section(left, cap(line.heading), sec?.bullets.length ?? 0);
    for (const b of sec?.bullets ?? []) { const l = el(g, "div", { cls: "hb-log-line" }); el(l, "span", { cls: "hb-faint", text: "–" }); el(l, "span", { text: b }); }
    journalInput(v, g, k, `+ ${cap(line.heading)}`);
  });

  const days: string[] = [];
  for (let k = 13; k >= 0; k--) days.push(isoDate(addDays(v.today, -k)));
  const have = new Set(v.index.journals.map((x) => x.date));
  let streak = 0;
  for (let k = days.length - 1; k >= 0 && have.has(days[k] as string); k--) streak++;
  const sg = section(right, "Last 14 days");
  const strip = el(sg, "div", { cls: "hb-streak" });
  for (const d of days) el(strip, "span", { cls: [have.has(d) ? "is-on" : "", d === key ? "is-today" : ""], attr: { title: d } });
  el(sg, "div", { cls: "hb-faint hb-pad", text: `${streak}-day streak` });
  const past = v.index.journals.filter((x) => x.date !== key).slice(0, 30);
  const pg = section(right, "Earlier", past.length);
  if (!past.length) emptyRow(pg, "Nothing earlier.");
  for (const p of past) {
    const det = el(pg, "details", { cls: "hb-past" });
    const sum = el(det, "summary");
    el(sum, "span", { cls: "hb-mono hb-faint", text: p.date });
    const first = p.sections.flatMap((s) => [...s.bullets, ...s.checks.map((x) => x.text)])[0] ?? "";
    el(sum, "span", { cls: "hb-grow hb-ellipsis", text: first });
    const b = el(det, "div", { cls: "hb-past-body" });
    p.sections.forEach((s) => {
      for (const x of s.bullets) el(b, "div", { text: `${cap(s.heading)}: ${x}` });
      for (const x of s.checks) el(b, "div", { text: `${x.done ? "✓" : "○"} ${x.text}` });
    });
    el(b, "button", { cls: "hb-link", text: "Open note", onClick: () => v.openFile(p.file) });
  }
}

/* ---------- checklists (quick fixes) ---------- */

export function drawQuick(v: HomeBaseView, c: HTMLElement): void {
  const type = v.ws?.types.find((t) => t.kind === "checklist");
  v.backToMore(c);
  head(c, "Checkboxes from every list note", type?.label ?? "Checklists");
  v.lensBar(c);
  const lists = v.index.quickLists.filter((q) => v.lens === "all" || q.spaceValue === v.lens);
  if (!lists.length) el(c, "div", { cls: "hb-empty", text: "No list notes here." });
  for (const q of lists) {
    const open = q.items.filter((x) => !x.done).length;
    const g = section(c, q.space ? spaceName(q.space) : q.title, open, { label: "Open note", go: () => v.openFile(q.file) });
    if (!q.items.length) emptyRow(g, "Nothing here.");
    for (const it of q.items) {
      const l = el(g, "label", { cls: ["hb-log-line", it.done ? "is-done" : ""] });
      const box = el(l, "input", { attr: { type: "checkbox" } });
      box.checked = it.done;
      box.addEventListener("change", () => void v.act(v.index.toggleLine(q.file, it.line, box.checked)));
      el(l, "span", { cls: "hb-grow", text: it.text });
    }
  }
}

/* ---------- more (narrow only) ---------- */

export function drawMore(v: HomeBaseView, c: HTMLElement): void {
  head(c, v.app.vault.getName(), "More");
  const g = el(c, "div", { cls: "hb-group" });
  const tabbed = new Set(["home", "board", v.hasKind("journal") ? "journal" : "upcoming"]);
  for (const s of v.screens()) {
    if (tabbed.has(s.id)) continue;
    const b = el(g, "button", { cls: "hb-menu-item", onClick: () => v.go(s.id) });
    icon(b, s.icon, "hb-menu-icon");
    el(el(b, "span", { cls: "hb-grow" }), "div", { text: s.label });
    if (s.count != null) el(b, "span", { cls: "hb-mono hb-faint", text: String(s.count) });
  }
  const fresh = v.index.items.filter((i) => i.status?.meaning === "new").length;
  const g2 = el(c, "div", { cls: "hb-group" });
  if (fresh) {
    const rv = el(g2, "button", { cls: "hb-menu-item", onClick: () => v.startReview() });
    icon(rv, "inbox", "hb-menu-icon");
    el(el(rv, "span", { cls: "hb-grow" }), "div", { text: "Review" });
    el(rv, "span", { cls: "hb-mono hb-faint", text: String(fresh) });
  }
  const ws = el(g2, "button", { cls: "hb-menu-item", onClick: () => void v.plugin.openWorkspaceNote() });
  icon(ws, "settings", "hb-menu-icon");
  el(el(ws, "span", { cls: "hb-grow" }), "div", { text: "Workspace note" });
}
