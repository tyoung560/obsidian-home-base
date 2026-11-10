/**
 * Reading notes through the workspace definition. Pure: callers pass frontmatter and note text, and
 * a `file` handle that is carried through untouched.
 */
import { allChecklist, bulletsIn, checklistIn, linkTargets, normalizeDate, sectionHasContent, summaryOf } from "../parse";
import type { ChecklistItem } from "../parse";
import type { ItemType, Meaning, SpaceValue, StatusDef, Workspace } from "../workspace/schema";

export interface Link { label: string; value: string; url: string | null }

export interface Item<F = unknown> {
  file: F;
  path: string;
  title: string;
  type: ItemType;
  /** Raw status value from the note ("" when unset). */
  statusValue: string;
  /** The workflow status, or null when the value isn't in the workflow. */
  status: StatusDef | null;
  spaceValue: string;
  space: SpaceValue | null;
  due: string;
  repeat: string;
  lastDone: string;
  created: string;
  area: string;
  sources: string[];
  links: Link[];
  summary: string;
  hasQuestions: boolean;
  checklist: ChecklistItem[];
}

export interface Meeting<F = unknown> {
  file: F;
  path: string;
  title: string;
  date: string;
  spaceValue: string;
  space: SpaceValue | null;
  attendees: string[];
  summary: string;
  decisions: string[];
  unresolved: string[];
  linked: string[];
}

export interface JournalSection { heading: string; kind: "bullets" | "checklist"; bullets: string[]; checks: ChecklistItem[] }
export interface Journal<F = unknown> { file: F; path: string; date: string; sections: JournalSection[] }
export interface QuickList<F = unknown> { file: F; path: string; title: string; spaceValue: string; space: SpaceValue | null; items: ChecklistItem[] }

type FM = Record<string, unknown> | undefined;

export function str(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v) && v.length === 1) return str(v[0]);
  return "";
}
function strList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(str).filter(Boolean);
  const s = str(v);
  return s ? s.split(",").map((x) => x.trim()).filter(Boolean) : [];
}

function inFolder(path: string, folder: string): boolean {
  return !folder || path === folder || path.startsWith(`${folder}/`);
}

/** The item type a note belongs to, or null. A type's property match wins over folder-only types. */
export function typeOf(ws: Workspace, path: string, fm: FM): ItemType | null {
  if (ws.ignore.some((f) => inFolder(path, f))) return null;
  let folderOnly: ItemType | null = null;
  for (const t of ws.types) {
    const { property, value, folder } = t.match;
    if (folder && !inFolder(path, folder)) continue;
    if (property) {
      if (str(fm?.[property]) === value) return t;
      continue;
    }
    if (folder && !folderOnly) folderOnly = t;
  }
  return folderOnly;
}

export function spaceOf(ws: Workspace, v: string): SpaceValue | null {
  return ws.space.values.find((s) => s.value === v) ?? null;
}

export function statusOf(ws: Workspace, v: string): StatusDef | null {
  return ws.workflow.find((s) => s.value === v) ?? null;
}

export function meaningOf(item: Item): Meaning | null {
  return item.status?.meaning ?? null;
}

/** Items with no status, or a status outside the workflow, count as open. */
export function isOpen(item: Item): boolean {
  return item.status?.meaning !== "closed";
}

export function linkUrl(pattern: string | null, value: string): string | null {
  if (!pattern || !value) return null;
  const m = /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(value);
  if (pattern.includes("{owner}") || pattern.includes("{repo}") || pattern.includes("{number}")) {
    if (!m) return null;
    return pattern.replace("{owner}", m[1] as string).replace("{repo}", m[2] as string).replace("{number}", m[3] as string);
  }
  return pattern.replace("{value}", encodeURIComponent(value));
}

function baseName(path: string): string {
  return (path.split("/").pop() as string).replace(/\.md$/, "");
}

export function readItem<F>(ws: Workspace, type: ItemType, file: F, path: string, fm: FM, text: string): Item<F> {
  const f = type.fields;
  const statusValue = str(fm?.[f.status]);
  const spaceValue = str(fm?.[ws.space.property]);
  return {
    file, path, title: baseName(path), type, statusValue, status: statusOf(ws, statusValue), spaceValue, space: spaceOf(ws, spaceValue),
    due: normalizeDate(fm?.[f.due]), repeat: str(fm?.[f.repeat]), lastDone: normalizeDate(fm?.[f.lastDone]), created: normalizeDate(fm?.[f.created]),
    area: str(fm?.[f.area]), sources: linkTargets(fm?.[f.source]),
    links: f.links.map((l) => ({ label: l.label, value: str(fm?.[l.property]), url: linkUrl(l.url, str(fm?.[l.property])) })).filter((l) => l.value),
    summary: summaryOf(text), hasQuestions: sectionHasContent(text, type.sections.questions), checklist: checklistIn(text, type.sections.checklist),
  };
}

export function readMeeting<F>(ws: Workspace, type: ItemType, file: F, path: string, fm: FM, text: string): Meeting<F> {
  const name = baseName(path);
  const dated = /^(\d{4}-\d{2}-\d{2})\s+(.*)$/.exec(name);
  const spaceValue = str(fm?.[ws.space.property]);
  return {
    file, path, title: dated ? (dated[2] as string) : name, date: normalizeDate(fm?.[type.fields.created]) || (dated ? (dated[1] as string) : ""),
    spaceValue, space: spaceOf(ws, spaceValue), attendees: strList(fm?.[type.fields.people]), summary: summaryOf(text),
    decisions: bulletsIn(text, type.sections.decisions), unresolved: bulletsIn(text, type.sections.unresolved), linked: linkTargets(bulletsIn(text, type.sections.items, true)),
  };
}

export function readJournal<F>(type: ItemType, file: F, path: string, fm: FM, text: string): Journal<F> {
  return {
    file, path, date: normalizeDate(fm?.[type.fields.created]) || baseName(path),
    sections: type.sections.lines.map((l) => ({
      heading: l.heading, kind: l.kind,
      bullets: l.kind === "bullets" ? bulletsIn(text, [l.heading]) : [],
      checks: l.kind === "checklist" ? checklistIn(text, [l.heading]) : [],
    })),
  };
}

export function readQuickList<F>(ws: Workspace, file: F, path: string, fm: FM, text: string): QuickList<F> {
  const spaceValue = str(fm?.[ws.space.property]);
  return { file, path, title: baseName(path), spaceValue, space: spaceOf(ws, spaceValue), items: allChecklist(text) };
}

export function itemsFromMeeting<F>(items: Item<F>[], m: Meeting<F>): Item<F>[] {
  const name = baseName(m.path);
  return items.filter((i) => i.sources.includes(name) || m.linked.includes(i.title));
}

export function meetingFor<F>(meetings: Meeting<F>[], item: Item<F>): Meeting<F> | undefined {
  return meetings.find((m) => item.sources.includes(baseName(m.path)) || m.linked.includes(item.title));
}
