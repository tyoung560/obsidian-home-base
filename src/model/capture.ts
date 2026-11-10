/** Quick capture parsing from the workspace: space aliases, type words, flags and due dates. Pure. */
import { addDays, isoDate, resolveDueWord } from "../parse";
import type { ItemType, Workspace } from "../workspace/schema";

export interface Capture {
  title: string;
  /** Space value, or null when the text didn't name one. */
  space: string | null;
  /** Item type id, or null for the default type. */
  type: string | null;
  due: string;
  /** Extra properties set by flag words. */
  set: Record<string, string>;
}

export function itemTypes(ws: Workspace): ItemType[] {
  return ws.types.filter((t) => t.kind === "item");
}

/**
 * Parses text such as "gd vendor remittance email due fri".
 * - a space alias as the first word, or @alias anywhere, picks the space
 * - an item type's id or label as the first word after the space, or #id anywhere, picks the type
 * - a flag word from `capture.flags`, as #flag anywhere or as the first word after the space, sets properties
 * - "due <word>" sets the due date ("due next week" works too)
 */
export function parseCapture(text: string, ws: Workspace, today: Date): Capture {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const spaces = new Map<string, string>();
  for (const s of ws.space.values) for (const a of [...s.aliases, s.value.toLowerCase(), s.label.toLowerCase()]) spaces.set(a, s.value);
  const types = new Map<string, string>();
  for (const t of itemTypes(ws)) for (const a of [t.id.toLowerCase(), t.label.toLowerCase()]) types.set(a, t.id);

  let space: string | null = null;
  let type: string | null = null;
  let due = "";
  const set: Record<string, string> = {};
  const rest: string[] = [];
  let lead = true;

  for (let i = 0; i < words.length; i++) {
    const raw = words[i] as string;
    const lower = raw.toLowerCase();
    const sigil = lower[0] === "@" || lower[0] === "#";
    const key = sigil ? lower.slice(1) : lower;
    if (!space && (i === 0 || lower[0] === "@") && spaces.has(key)) { space = spaces.get(key) ?? null; continue; }
    if (!type && (lead || lower[0] === "#") && types.has(key)) { type = types.get(key) ?? null; continue; }
    if ((lead || lower[0] === "#") && ws.flags[key]) { Object.assign(set, ws.flags[key]); continue; }
    if (lower === "due" && i + 1 < words.length) {
      const next = (words[i + 1] as string).toLowerCase();
      if (next === "next" && words[i + 2]?.toLowerCase() === "week") { due = isoDate(addDays(today, 7)); i += 2; continue; }
      const d = resolveDueWord(next, today);
      if (d) { due = d; i += 1; continue; }
    }
    lead = false;
    rest.push(raw);
  }
  const title = rest.join(" ");
  return { title: title.charAt(0).toUpperCase() + title.slice(1), space, type, due, set };
}
