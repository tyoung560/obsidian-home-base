/** Small DOM helpers and the pieces every screen shares: chips, rows, cards and sections. */
import { setIcon } from "obsidian";
import { daysUntil, parseIsoDate } from "./parse";
import type { SpaceValue, StatusDef } from "./workspace/schema";
import type { VItem } from "./vault";

export type Attrs = { cls?: string | string[]; text?: string; attr?: Record<string, string>; style?: Record<string, string>; onClick?: (e: MouseEvent) => void };

export function el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, a: Attrs = {}): HTMLElementTagNameMap[K] {
  const cls = Array.isArray(a.cls) ? a.cls.filter(Boolean) : a.cls || undefined;
  const e = parent.createEl(tag, { cls, text: a.text, attr: a.attr });
  if (a.style) for (const [k, v] of Object.entries(a.style)) e.style.setProperty(k, v);
  if (a.onClick) e.addEventListener("click", a.onClick as EventListener);
  return e;
}

export function icon(parent: HTMLElement, name: string, cls = "hb-icon"): HTMLElement {
  const s = parent.createSpan({ cls });
  setIcon(s, name);
  return s;
}

export function dateLabel(iso: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }): string {
  const d = parseIsoDate(iso);
  return d ? d.toLocaleDateString(undefined, opts) : iso;
}

/** The fuller of a space's value and label, for the rail and summaries: the value when the label is an abbreviation. */
export function spaceName(s: SpaceValue): string {
  return s.label.length >= s.value.length ? s.label : s.value;
}

export function spaceChip(c: HTMLElement, space: SpaceValue | null, raw: string): void {
  if (!space && !raw) return;
  const ch = el(c, "span", { cls: "hb-chip hb-chip-app", style: { "--hb-app": space?.color ?? "var(--text-faint)" } });
  el(ch, "span", { cls: "hb-dot" });
  ch.appendText(space?.label ?? raw);
}

export function dueChip(c: HTMLElement, due: string, today: Date): void {
  if (!due) return;
  const n = daysUntil(due, today);
  if (n == null) return;
  if (n < 0) el(c, "span", { cls: "hb-chip is-late", text: `${-n}d overdue` });
  else if (n === 0) el(c, "span", { cls: "hb-chip is-late", text: "Due today" });
  else if (n <= 7) el(c, "span", { cls: "hb-chip is-soon", text: dateLabel(due) });
  else el(c, "span", { cls: "hb-chip", text: dateLabel(due) });
}

export function statusText(item: VItem): string {
  return item.status?.label ?? (item.statusValue || "No status");
}

export function statusDot(c: HTMLElement, s: StatusDef | null): void {
  if (s?.color) el(c, "span", { cls: "hb-dot", style: { background: s.color } });
}

export function section(c: HTMLElement, title: string, count?: number, more?: { label: string; go: () => void }): HTMLElement {
  const s = el(c, "section", { cls: "hb-section" });
  const h = el(s, "div", { cls: "hb-section-head" });
  el(h, "h3", { text: title });
  if (count != null) el(h, "span", { cls: "hb-n", text: String(count) });
  if (more) el(h, "button", { cls: "hb-link", text: more.label, onClick: more.go });
  return el(s, "div", { cls: "hb-group" });
}

export function emptyRow(c: HTMLElement, text: string): void {
  el(c, "div", { cls: "hb-empty", text });
}

export function head(c: HTMLElement, eyebrow: string, title: string): HTMLElement {
  const h = el(c, "div", { cls: "hb-head" });
  const t = el(h, "div");
  el(t, "div", { cls: "hb-eyebrow", text: eyebrow });
  el(t, "h2", { cls: "hb-title", text: title });
  return h;
}

/** Tap opens; on narrow screens a left swipe reveals the row's actions. */
export function wireRow(row: HTMLElement, acts: HTMLElement, narrow: boolean, onOpen: () => void): void {
  let x0: number | null = null, y0 = 0, dx = 0, moved = false, opened = false;
  row.addEventListener("click", () => {
    if (moved) { moved = false; return; }
    if (opened) { opened = false; row.style.transform = ""; return; }
    onOpen();
  });
  row.addEventListener("keydown", (e) => { if (e.key === "Enter") onOpen(); });
  if (!narrow) return;
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
