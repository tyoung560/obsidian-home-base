/** Overlays: capture (bar on desktop, sheet on phones), item and meeting detail, and inbox review. */
import { Notice } from "obsidian";
import { firstStatus, startStatus } from "./model/actions";
import { itemTypes, parseCapture, type Capture } from "./model/capture";
import { itemsFromMeeting, meetingFor } from "./model/items";
import { addDays, isoDate } from "./parse";
import { dueChip, el, icon, spaceChip } from "./ui";
import type { CaptureDraft, HomeBaseView } from "./view";
import type { VItem, VMeeting } from "./vault";
import type { Workspace } from "./workspace/schema";

/* ---------- capture ---------- */

interface Resolved extends Capture { typeId: string; folder: string }

function resolve(v: HomeBaseView, d: CaptureDraft): Resolved {
  const ws = v.ws as Workspace;
  const p = parseCapture(d.text, ws, v.today);
  const types = itemTypes(ws);
  const typeId = d.type ?? p.type ?? types[0]?.id ?? "";
  const type = ws.types.find((t) => t.id === typeId);
  return { ...p, space: d.space ?? p.space, due: d.due ?? p.due, type: typeId, typeId, folder: type?.folder || "/" };
}

/** What's missing before the draft can be saved, or null when it's ready. */
function missing(v: HomeBaseView, r: Resolved): string | null {
  const ws = v.ws as Workspace;
  if (!r.title) return "Type a name first";
  if (!r.typeId) return "The workspace has no item type to create";
  if (ws.space.values.length && !r.space) return `Pick ${ws.space.property === "app" ? "an" : "a"} ${ws.space.property}, or start with one: ${ws.space.values.map((s) => s.aliases[0] ?? s.label).join(", ")}`;
  return null;
}

async function submit(v: HomeBaseView): Promise<void> {
  if (!v.draft) return;
  const r = resolve(v, v.draft);
  const why = missing(v, r);
  if (why) { new Notice(why); return; }
  try {
    const file = await v.index.create({ ...r, space: r.space ?? "", type: r.typeId });
    new Notice(`Added ${file.basename} as ${startStatus(v.ws as Workspace).label}`);
    v.draft = null;
    if (v.narrow) v.drawOverlay();
    else v.draw();
  } catch (e) {
    new Notice(`Home Base: ${e instanceof Error ? e.message : "couldn't create the note"}`);
  }
}

function pickers(v: HomeBaseView, c: HTMLElement, d: CaptureDraft, r: Resolved, repaint: () => void, labels: boolean): void {
  const ws = v.ws as Workspace;
  const row = (label: string) => {
    if (!labels) return c;
    el(c, "div", { cls: "hb-label", text: label });
    return el(c, "div", { cls: "hb-chips-scroll" });
  };
  if (ws.space.values.length) {
    const sp = row(ws.space.property.charAt(0).toUpperCase() + ws.space.property.slice(1));
    for (const s of ws.space.values) {
      const b = el(sp, "button", { cls: ["hb-pick", r.space === s.value ? "is-active" : ""], onClick: () => { d.space = s.value; repaint(); } });
      el(b, "span", { cls: "hb-dot", style: { background: s.color } });
      b.appendText(s.label);
    }
  }
  const types = itemTypes(ws);
  if (types.length > 1) {
    const tr = row("Kind");
    for (const t of types) el(tr, "button", { cls: ["hb-pick", r.typeId === t.id ? "is-active" : ""], text: t.label, onClick: () => { d.type = t.id; repaint(); } });
  }
  if (labels) {
    const dues = row("Due");
    const t = v.today;
    const fri = addDays(t, (5 - t.getDay() + 7) % 7 || 7);
    for (const [val, l] of [["", "No date"], [isoDate(t), "Today"], [isoDate(addDays(t, 1)), "Tomorrow"], [isoDate(fri), `Friday ${fri.getDate()}`], [isoDate(addDays(t, 7)), "Next week"]] as const) {
      el(dues, "button", { cls: ["hb-pick", r.due === val ? "is-active" : ""], text: l, onClick: () => { d.due = val; repaint(); } });
    }
  } else if (r.due) dueChip(c, r.due, v.today);
  for (const [k, val] of Object.entries(r.set)) el(c, "span", { cls: "hb-chip", text: `${k}: ${val}` });
  el(c, "div", { cls: "hb-path", text: `→ ${r.folder === "/" ? "" : `${r.folder}/`}${r.title || "…"}.md` });
}

export function drawCaptureBar(v: HomeBaseView, c: HTMLElement): void {
  const ws = v.ws as Workspace;
  const wrap = el(c, "div", { cls: "hb-capture" });
  const box = el(wrap, "div", { cls: "hb-capture-box" });
  icon(box, "plus");
  const example = `${ws.space.values[0]?.aliases[0] ?? ""} call about the quote due fri`.trim();
  const input = el(box, "input", { attr: { type: "text", placeholder: `Capture: ${example}`, "aria-label": "Capture" } });
  input.value = v.draft?.text ?? "";
  el(box, "kbd", { text: "Enter" });
  const preview = el(wrap, "div", { cls: "hb-capture-preview" });
  const paint = () => {
    preview.empty();
    const d = v.draft;
    if (!d || !d.text.trim()) {
      preview.toggleClass("is-hint", true);
      const aliases = ws.space.values.map((s) => s.aliases[0] ?? s.label.toLowerCase());
      preview.setText(`${aliases.length ? `Start with ${aliases.join(", ")}. ` : ""}Add "due fri" or "due 2026-11-20" for a date.`);
      return;
    }
    preview.toggleClass("is-hint", false);
    pickers(v, preview, d, resolve(v, d), () => { paint(); input.focus(); }, false);
  };
  input.addEventListener("input", () => {
    v.draft = v.draft ?? { text: "", space: null, type: null, due: null };
    v.draft.text = input.value;
    paint();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void submit(v);
    if (e.key === "Escape") { v.draft = null; input.value = ""; paint(); }
  });
  paint();
}

export function drawCaptureSheet(v: HomeBaseView, o: HTMLElement): void {
  const d = v.draft as CaptureDraft;
  const cancel = () => { v.draft = null; v.drawOverlay(); };
  const s = sheet(v, o, null, cancel);
  const body = el(s, "div", { cls: "hb-sheet-body" });
  const input = el(body, "input", { cls: "hb-cap-input", attr: { type: "text", placeholder: "What needs doing?", enterkeyhint: "done" } });
  input.value = d.text;
  const picks = el(body, "div", { cls: "hb-pickers" });
  const foot = el(s, "div", { cls: "hb-sheet-foot" });
  el(foot, "button", { cls: "hb-btn", text: "Cancel", onClick: cancel });
  const save = el(foot, "button", { cls: "hb-btn mod-cta", text: "Add", onClick: () => void submit(v) });
  const paint = () => {
    picks.empty();
    const r = resolve(v, d);
    pickers(v, picks, d, r, paint, true);
    save.disabled = missing(v, r) !== null;
  };
  input.addEventListener("input", () => { d.text = input.value; paint(); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") void submit(v); });
  paint();
  window.setTimeout(() => input.focus(), 50);
}

/* ---------- detail ---------- */

function sheet(v: HomeBaseView, o: HTMLElement, title: string | null, onClose: () => void): HTMLElement {
  el(o, "div", { cls: "hb-scrim", onClick: onClose });
  const s = el(o, "div", { cls: v.narrow ? "hb-sheet" : "hb-drawer", attr: { role: "dialog", "aria-modal": "true" } });
  if (v.narrow) el(s, "div", { cls: "hb-grab" });
  if (title != null) {
    const h = el(s, "div", { cls: "hb-sheet-head" });
    el(h, "h4", { text: title });
    icon(el(h, "button", { cls: "hb-x", attr: { "aria-label": "Close" }, onClick: onClose }), "x");
  }
  return s;
}

export function drawItemDetail(v: HomeBaseView, o: HTMLElement, i: VItem, close: () => void): void {
  const ws = v.ws as Workspace;
  const s = sheet(v, o, i.title, close);
  const body = el(s, "div", { cls: "hb-sheet-body" });
  el(body, "div", { cls: "hb-label", text: "Status" });
  const chips = el(body, "div", { cls: "hb-chips-scroll" });
  for (const st of ws.workflow) {
    el(chips, "button", { cls: ["hb-pick", i.statusValue === st.value ? "is-active" : ""], text: st.label, onClick: () => void v.act(v.index.setStatus(i, st), `Status: ${st.label}`) });
  }
  const dl = el(body, "dl", { cls: "hb-props" });
  const prop = (k: string) => { el(dl, "dt", { text: k }); return el(dl, "dd"); };
  if (i.space || i.spaceValue) spaceChip(prop(cap(ws.space.property)), i.space, i.spaceValue);
  if (itemTypes(ws).length > 1) prop("Type").setText(i.type.label);
  if (i.area) prop("Area").setText(i.area);
  const dueIn = el(prop("Due"), "input", { attr: { type: "date" } });
  dueIn.value = i.due;
  dueIn.addEventListener("change", () => void v.act(v.index.setDue(i, dueIn.value), dueIn.value ? `Due ${dueIn.value}` : "Due date cleared"));
  if (i.repeat) prop("Repeats").setText(`Every ${i.repeat}`);
  if (i.lastDone) prop("Last done").setText(i.lastDone);
  for (const l of i.links) {
    const dd = prop(l.label);
    dd.addClass("hb-mono");
    if (l.url) el(dd, "a", { text: l.value, attr: { href: l.url, target: "_blank", rel: "noopener" } });
    else dd.setText(l.value);
  }
  const m = meetingFor(v.index.meetings, i);
  if (m) el(prop("Source"), "button", { cls: "hb-link", text: m.title, onClick: () => v.select({ kind: "meeting", path: m.path }) });
  if (i.summary) el(body, "div", { cls: "hb-summary", text: i.summary });
  if (i.checklist.length) {
    const done = i.checklist.filter((x) => x.done).length;
    el(body, "div", { cls: "hb-label", text: `${cap(i.type.sections.checklist[0] ?? "checklist")} · ${done}/${i.checklist.length}` });
    const list = el(body, "div", { cls: "hb-checklist" });
    for (const w of i.checklist) {
      const l = el(list, "label", { cls: w.done ? "is-done" : "" });
      const box = el(l, "input", { attr: { type: "checkbox" } });
      box.checked = w.done;
      box.addEventListener("change", () => void v.act(v.index.toggleLine(i.file, w.line, box.checked)));
      el(l, "span", { text: w.text });
    }
  }
  if (i.hasQuestions) {
    const q = el(body, "div", { cls: "hb-meta" });
    el(q, "span", { cls: "hb-chip is-q", text: "Open questions" });
    el(q, "span", { cls: "hb-faint", text: "Answer them before starting." });
  }
  el(body, "div", { cls: "hb-path", text: i.path });
  const foot = el(s, "div", { cls: "hb-sheet-foot" });
  el(foot, "button", { cls: "hb-btn", text: "Open note", onClick: () => v.openFile(i.file) });
  if (i.repeat) {
    el(foot, "button", { cls: "hb-btn", text: "Snooze a week", onClick: () => void v.act(v.index.snooze(i)) });
    el(foot, "button", { cls: "hb-btn mod-cta", text: "Mark done", onClick: () => { void v.act(v.index.complete(i)); close(); } });
  }
}

export function drawMeetingDetail(v: HomeBaseView, o: HTMLElement, m: VMeeting, close: () => void): void {
  const ws = v.ws as Workspace;
  const s = sheet(v, o, m.title, close);
  const body = el(s, "div", { cls: "hb-sheet-body" });
  const dl = el(body, "dl", { cls: "hb-props" });
  el(dl, "dt", { text: "Date" }); el(dl, "dd", { text: m.date });
  if (m.space || m.spaceValue) { el(dl, "dt", { text: cap(ws.space.property) }); spaceChip(el(dl, "dd"), m.space, m.spaceValue); }
  if (m.attendees.length) { el(dl, "dt", { text: "People" }); el(dl, "dd", { text: m.attendees.join(", ") }); }
  if (m.summary) el(body, "div", { cls: "hb-summary", text: m.summary });
  const listOf = (label: string, xs: string[]) => {
    if (!xs.length) return;
    el(body, "div", { cls: "hb-label", text: label });
    const ul = el(body, "ul", { cls: "hb-bullets" });
    for (const x of xs) el(ul, "li", { text: x });
  };
  listOf("Decisions", m.decisions);
  listOf("Unresolved", m.unresolved);
  const tasks = itemsFromMeeting(v.index.items, m);
  if (tasks.length) {
    el(body, "div", { cls: "hb-label", text: "From this meeting" });
    const g = el(body, "div", { cls: "hb-group" });
    tasks.forEach((i) => v.row(g, i));
  }
  el(body, "div", { cls: "hb-path", text: m.path });
  el(el(s, "div", { cls: "hb-sheet-foot" }), "button", { cls: "hb-btn", text: "Open note", onClick: () => v.openFile(m.file) });
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------- review ---------- */

export function drawReview(v: HomeBaseView, o: HTMLElement): void {
  const ws = v.ws as Workspace;
  const r = v.review!;
  const end = () => { v.review = null; v.drawOverlay(); };
  const todo = firstStatus(ws, "todo");
  const drop = firstStatus(ws, "closed", "dropped");
  const wrap = el(o, "div", { cls: "hb-review", attr: { role: "dialog", "aria-modal": "true" } });
  const top = el(wrap, "div", { cls: "hb-review-top" });
  const current = r.queue.slice(r.i).map((p) => v.item(p)).find((x) => x && x.status?.meaning === "new");
  if (current) r.i = r.queue.indexOf(current.path);
  el(top, "span", { cls: "hb-mono", text: current ? `${r.i + 1} / ${r.queue.length}` : "" });
  el(el(top, "div", { cls: "hb-progress" }), "span", { style: { width: `${(r.i / r.queue.length) * 100}%` } });
  icon(el(top, "button", { cls: "hb-x", attr: { "aria-label": "Close" }, onClick: end }), "x");
  const deck = el(wrap, "div", { cls: "hb-deck" });
  if (!current) {
    const card = el(deck, "div", { cls: "hb-rcard" });
    el(card, "h4", { text: "All reviewed" });
    el(card, "div", { cls: "hb-summary", text: `${r.counts.ready} moved to ${todo?.label ?? "to do"}, ${r.counts.kept} kept, ${r.counts.dropped} dropped.` });
    el(el(wrap, "div", { cls: "hb-review-acts" }), "button", { cls: "hb-btn mod-cta", text: "Done", onClick: end });
    return;
  }
  const decide = async (kind: "approve" | "keep" | "drop") => {
    if (kind === "approve" && todo) { r.counts.ready++; await v.act(v.index.setStatus(current, todo)); }
    else if (kind === "drop" && drop) { r.counts.dropped++; await v.act(v.index.setStatus(current, drop)); }
    else r.counts.kept++;
    r.i++;
    v.drawOverlay();
  };
  const card = el(deck, "div", { cls: "hb-rcard" });
  el(card, "span", { cls: "hb-stamp is-yes", text: todo?.label ?? "Keep" });
  if (drop) el(card, "span", { cls: "hb-stamp is-no", text: drop.label });
  const meta = el(card, "div", { cls: "hb-meta" });
  spaceChip(meta, current.space, current.spaceValue);
  if (current.area) el(meta, "span", { cls: "hb-chip", text: current.area });
  if (current.hasQuestions) el(meta, "span", { cls: "hb-chip is-q", text: "Open questions" });
  el(card, "h4", { text: current.title });
  if (current.summary) el(card, "div", { cls: "hb-summary", text: current.summary });
  const ul = el(card, "ul", { cls: "hb-bullets" });
  for (const w of current.checklist) el(ul, "li", { text: w.text });
  el(card, "button", { cls: "hb-link", text: "Open note", onClick: () => v.openFile(current.file) });
  const acts = el(wrap, "div", { cls: "hb-review-acts" });
  if (drop) el(acts, "button", { cls: "hb-btn", text: drop.label, onClick: () => void decide("drop") });
  el(acts, "button", { cls: "hb-btn", text: "Keep", onClick: () => void decide("keep") });
  if (todo) el(acts, "button", { cls: "hb-btn mod-cta", text: todo.label, onClick: () => void decide("approve") });

  let x0: number | null = null, dx = 0;
  const yes = card.querySelector<HTMLElement>(".is-yes"), no = card.querySelector<HTMLElement>(".is-no");
  card.addEventListener("pointerdown", (e) => { if ((e.target as HTMLElement).closest("button")) return; x0 = e.clientX; card.setPointerCapture(e.pointerId); card.style.transition = "none"; });
  card.addEventListener("pointermove", (e) => {
    if (x0 == null) return;
    dx = e.clientX - x0;
    if (dx < 0 && !drop) dx = 0;
    card.style.transform = `translateX(${dx}px) rotate(${dx / 24}deg)`;
    if (yes) yes.style.opacity = String(Math.max(0, dx / 110));
    if (no) no.style.opacity = String(Math.max(0, -dx / 110));
  });
  const up = () => {
    if (x0 == null) return;
    x0 = null;
    card.style.transition = "";
    if (Math.abs(dx) > 110) void decide(dx > 0 ? "approve" : "drop");
    else { card.style.transform = ""; if (yes) yes.style.opacity = "0"; if (no) no.style.opacity = "0"; }
    dx = 0;
  };
  card.addEventListener("pointerup", up);
  card.addEventListener("pointercancel", up);
}
