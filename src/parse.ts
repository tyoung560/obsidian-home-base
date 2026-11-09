/**
 * Pure functions: dates, quick-capture parsing, repeat intervals, note bodies and templates.
 * Nothing here touches Obsidian, so it is all covered by unit tests.
 */
import type { AppDef, ChecklistItem, LogSection } from "./schema";

/* ---------- dates (local, YYYY-MM-DD) ---------- */

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseIsoDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() + n);
  return r;
}

/** Whole days from `today` to `date`; negative when overdue. Null for a missing or bad date. */
export function daysUntil(date: string, today: Date): number | null {
  const d = parseIsoDate(date);
  if (!d) return null;
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((d.getTime() - t.getTime()) / 86_400_000);
}

/** Frontmatter dates arrive as strings, or as Date objects when YAML parses them. */
export function normalizeDate(v: unknown): string {
  if (v instanceof Date && !isNaN(v.getTime())) return isoDate(v);
  if (typeof v === "string") return parseIsoDate(v) ? v.trim() : "";
  return "";
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Resolves "today", "tomorrow", "fri", "next week", "2026-11-20" or "11/20" to an ISO date. */
export function resolveDueWord(word: string, today: Date): string | null {
  const w = word.toLowerCase();
  if (w === "today") return isoDate(today);
  if (w === "tomorrow" || w === "tmr") return isoDate(addDays(today, 1));
  if (parseIsoDate(w)) return w;
  const md = /^(\d{1,2})\/(\d{1,2})$/.exec(w);
  if (md) {
    let d = new Date(today.getFullYear(), Number(md[1]) - 1, Number(md[2]));
    if (d < new Date(today.getFullYear(), today.getMonth(), today.getDate())) d = new Date(today.getFullYear() + 1, Number(md[1]) - 1, Number(md[2]));
    return isoDate(d);
  }
  const k = WEEKDAYS.findIndex((x) => w.startsWith(x));
  if (k >= 0 && w.length >= 3) {
    const add = (k - today.getDay() + 7) % 7 || 7;
    return isoDate(addDays(today, add));
  }
  return null;
}

/* ---------- quick capture ---------- */

export interface Capture {
  title: string;
  app: string | null;
  type: "task" | "ops";
  due: string;
}

/**
 * Parses quick-capture text such as "gd vendor remittance email due fri".
 * - an app alias as the first word, or anywhere as @alias, picks the app
 * - the word "ops" (or #ops) makes it an ops job
 * - "due <word>" sets the due date; "due next week" works too
 */
export function parseCapture(text: string, apps: AppDef[], today: Date): Capture {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const byAlias = new Map<string, string>();
  for (const a of apps) for (const al of [...a.aliases, a.name, a.short]) byAlias.set(al.toLowerCase(), a.name);

  let app: string | null = null;
  let type: "task" | "ops" = "task";
  let due = "";
  const rest: string[] = [];

  for (let i = 0; i < words.length; i++) {
    const raw = words[i] as string;
    const lower = raw.toLowerCase();
    const tagged = lower.startsWith("@");
    const key = lower.replace(/^[@#]/, "");
    if (!app && (i === 0 || tagged) && byAlias.has(key)) {
      app = byAlias.get(key) ?? null;
      continue;
    }
    if (key === "ops" && (lower.startsWith("#") || i === 0 || (i === 1 && app))) {
      type = "ops";
      continue;
    }
    if (lower === "due" && i + 1 < words.length) {
      const next = (words[i + 1] as string).toLowerCase();
      if (next === "next" && words[i + 2]?.toLowerCase() === "week") {
        due = isoDate(addDays(today, 7));
        i += 2;
        continue;
      }
      const d = resolveDueWord(next, today);
      if (d) {
        due = d;
        i += 1;
        continue;
      }
    }
    rest.push(raw);
  }
  const title = rest.join(" ");
  return { title: title.charAt(0).toUpperCase() + title.slice(1), app, type, due };
}

/** Strips characters that can't appear in a file name. */
export function safeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|#^[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
}

/* ---------- repeat intervals ---------- */

/** Parses `repeat` values like "90 days", "2 weeks", "monthly", "yearly". Null when unrecognized. */
export function parseRepeat(repeat: string): { n: number; unit: "day" | "week" | "month" | "year" } | null {
  const r = repeat.trim().toLowerCase();
  if (!r) return null;
  const words: Record<string, { n: number; unit: "day" | "week" | "month" | "year" }> = {
    daily: { n: 1, unit: "day" },
    weekly: { n: 1, unit: "week" },
    fortnightly: { n: 2, unit: "week" },
    monthly: { n: 1, unit: "month" },
    quarterly: { n: 3, unit: "month" },
    yearly: { n: 1, unit: "year" },
    annually: { n: 1, unit: "year" },
  };
  if (words[r]) return words[r] ?? null;
  const m = /^(?:every\s+)?(\d+)\s*(d|days?|w|weeks?|m|months?|y|years?)$/.exec(r);
  if (!m) return null;
  const u = (m[2] as string)[0];
  const unit = u === "d" ? "day" : u === "w" ? "week" : u === "m" ? "month" : "year";
  return { n: Number(m[1]), unit };
}

export function nextDue(from: Date, repeat: string): string | null {
  const p = parseRepeat(repeat);
  if (!p) return null;
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  if (p.unit === "day") d.setDate(d.getDate() + p.n);
  if (p.unit === "week") d.setDate(d.getDate() + 7 * p.n);
  if (p.unit === "month") d.setMonth(d.getMonth() + p.n);
  if (p.unit === "year") d.setFullYear(d.getFullYear() + p.n);
  return isoDate(d);
}

/* ---------- note bodies ---------- */

export interface Section {
  heading: string;
  /** Line number of the heading. */
  start: number;
  /** Line number after the section's last line. */
  end: number;
}

/** Splits a note into its `##` sections. Frontmatter lines keep their line numbers. */
export function sections(text: string): { lines: string[]; sections: Section[] } {
  const lines = text.split("\n");
  const out: Section[] = [];
  let inFront = lines[0]?.trim() === "---";
  for (let i = inFront ? 1 : 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (inFront) {
      if (line.trim() === "---") inFront = false;
      continue;
    }
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      const prev = out[out.length - 1];
      if (prev) prev.end = i;
      out.push({ heading: (m[1] as string).toLowerCase(), start: i, end: lines.length });
    }
  }
  return { lines, sections: out };
}

function findSection(all: Section[], names: string[]): Section | undefined {
  return all.find((s) => names.includes(s.heading));
}

const CHECK = /^(\s*)[-*+]\s+\[( |x|X)\]\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(?!\[[ xX]\])(.*)$/;

/** Top-level checklist items inside the named sections. */
export function checklistIn(text: string, names: string[]): ChecklistItem[] {
  const { lines, sections: secs } = sections(text);
  const s = findSection(secs, names);
  if (!s) return [];
  const out: ChecklistItem[] = [];
  for (let i = s.start + 1; i < s.end; i++) {
    const m = CHECK.exec(lines[i] as string);
    if (m && (m[1] as string).length === 0 && (m[3] as string).trim()) out.push({ text: plain((m[3] as string).trim()), done: m[2] !== " ", line: i });
  }
  return out;
}

/** Top-level plain bullets inside the named section. */
export function bulletsIn(text: string, names: string[]): string[] {
  const { lines, sections: secs } = sections(text);
  const s = findSection(secs, names);
  if (!s) return [];
  const out: string[] = [];
  for (let i = s.start + 1; i < s.end; i++) {
    const line = lines[i] as string;
    if (/^\s/.test(line)) continue;
    const m = BULLET.exec(line);
    if (m && (m[1] as string).trim()) out.push(plain((m[1] as string).trim()));
  }
  return out;
}

/** True when the section exists and has any non-blank line. */
export function sectionHasContent(text: string, names: string[]): boolean {
  const { lines, sections: secs } = sections(text);
  const s = findSection(secs, names);
  if (!s) return false;
  for (let i = s.start + 1; i < s.end; i++) if ((lines[i] as string).trim()) return true;
  return false;
}

/** Inline markdown to display text: wikilinks to their label, code ticks and emphasis removed. */
export function plain(s: string): string {
  return s
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, (_, t: string) => t.split("/").pop() as string)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/==(.+?)==/g, "$1");
}

/** First paragraph after the `# Title` line, before any `##` section. */
export function summaryOf(text: string): string {
  const { lines, sections: secs } = sections(text);
  const firstSection = secs[0]?.start ?? lines.length;
  let i = 0;
  if (lines[0]?.trim() === "---") {
    i = 1;
    while (i < lines.length && (lines[i] as string).trim() !== "---") i++;
    i++;
  }
  const para: string[] = [];
  for (; i < firstSection; i++) {
    const line = (lines[i] as string).trim();
    if (line.startsWith("# ")) continue;
    if (!line) {
      if (para.length) break;
      continue;
    }
    para.push(line);
  }
  return plain(para.join(" "));
}

/** Every checklist line in the file, at any depth (used for Quick fixes notes). */
export function allChecklist(text: string): ChecklistItem[] {
  return text.split("\n").flatMap((line, i) => {
    const m = CHECK.exec(line);
    if (!m || (m[1] as string).length > 0) return [];
    return [{ text: plain((m[3] as string).trim()), done: m[2] !== " ", line: i }];
  });
}

/** Returns the text with the checkbox on `line` set. Leaves other lines untouched. */
export function setCheckbox(text: string, line: number, done: boolean): string {
  const lines = text.split("\n");
  const cur = lines[line];
  if (cur === undefined || !CHECK.test(cur)) return text;
  lines[line] = cur.replace(/\[( |x|X)\]/, done ? "[x]" : "[ ]");
  return lines.join("\n");
}

/** Unchecks every box in the named sections (a recurring job starts over). */
export function resetChecklist(text: string, names: string[]): string {
  const { lines, sections: secs } = sections(text);
  const s = findSection(secs, names);
  if (!s) return text;
  for (let i = s.start + 1; i < s.end; i++) {
    const l = lines[i] as string;
    if (CHECK.test(l)) lines[i] = l.replace(/\[(x|X)\]/, "[ ]");
  }
  return lines.join("\n");
}

/** Basenames from wikilinks in strings like "[[Meetings/2026-11-05 Review|Review]]". */
export function linkTargets(values: unknown): string[] {
  const list = Array.isArray(values) ? values : values == null ? [] : [values];
  const out: string[] = [];
  for (const v of list) {
    if (typeof v !== "string") continue;
    for (const m of v.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) {
      const target = (m[1] as string).trim();
      out.push(target.split("/").pop() as string);
    }
  }
  return out;
}

/* ---------- templates ---------- */

export function taskNoteText(c: { title: string; app: string; type: "task" | "ops"; due: string }, created: string): string {
  if (c.type === "ops") {
    return [
      "---", "type: ops", `app: ${c.app}`, "status: inbox", `due: ${c.due}`, "repeat:", "last_done:", "source: []", `created: ${created}`, "---",
      `# ${c.title}`, "", "What it is, where it lives (service, dashboard, env var name), and who depends on it.", "Never paste the secret itself.", "",
      "## Steps", "- [ ] ", "", "## After", "- [ ] set `last_done` to today and move `due` forward by `repeat`", "",
    ].join("\n");
  }
  return [
    "---", "type: task", `app: ${c.app}`, "status: inbox", "area:", "source: []", `created: ${created}`, ...(c.due ? [`due: ${c.due}`] : []), "---",
    `# ${c.title}`, "", "What changes and why.", "", "## Work", "- [ ] ", "",
  ].join("\n");
}

export function logNoteText(date: string): string {
  return ["---", "type: log", "app: General", `created: ${date}`, "---", `# ${date}`, "", "## Did", "", "## Notes", "", "## Next", ""].join("\n");
}

const LOG_HEADINGS: Record<LogSection, string> = { did: "did", notes: "notes", next: "next" };

/** Inserts a line at the end of a daily log section, creating the section if it is missing. */
export function appendToLog(text: string, section: LogSection, value: string): string {
  const line = section === "next" ? `- [ ] ${value}` : `- ${value}`;
  const { lines, sections: secs } = sections(text);
  const s = findSection(secs, [LOG_HEADINGS[section]]);
  if (!s) {
    const base = text.endsWith("\n") ? text : `${text}\n`;
    return `${base}\n## ${section === "did" ? "Did" : section === "notes" ? "Notes" : "Next"}\n${line}\n`;
  }
  let at = s.start + 1;
  for (let i = s.start + 1; i < s.end; i++) {
    const l = (lines[i] as string).trim();
    if (l && !/^[-*+]\s+(\[\s?\]\s*)?$/.test(l)) at = i + 1;
    else if (/^[-*+]\s+(\[\s?\]\s*)?$/.test(l)) {
      // an empty template bullet such as "- " or "- [ ] ": replace it
      lines[i] = line;
      return lines.join("\n");
    }
  }
  lines.splice(at, 0, line);
  return lines.join("\n");
}
