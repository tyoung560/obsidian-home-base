/**
 * What each action writes, as frontmatter patches. Pure, so the rules (which status Ready means,
 * what Mark done does to a repeating task) are tested without Obsidian.
 */
import { addDays, isoDate, nextDue, parseIsoDate } from "../parse";
import type { Meaning, StatusDef, Workspace } from "../workspace/schema";
import type { Item } from "./items";

/** A frontmatter patch: a string sets the property, null removes it. */
export type Patch = Record<string, string | null>;

export function firstStatus(ws: Workspace, meaning: Meaning, outcome?: "done" | "dropped"): StatusDef | null {
  return ws.workflow.find((s) => s.meaning === meaning && (!outcome || s.outcome === outcome)) ?? null;
}

/** The status a captured item starts with: the first `new` status, else the first `todo`. */
export function startStatus(ws: Workspace): StatusDef {
  return (firstStatus(ws, "new") ?? firstStatus(ws, "todo")) as StatusDef;
}

export function statusPatch(item: Item, status: StatusDef): Patch {
  return { [item.type.fields.status]: status.value };
}

export function duePatch(item: Item, due: string): Patch {
  return { [item.type.fields.due]: due || null };
}

export function snoozePatch(item: Item, today: Date, days = 7): Patch {
  const current = parseIsoDate(item.due);
  const from = current && current > today ? current : today;
  return duePatch(item, isoDate(addDays(from, days)));
}

export interface Completion { patch: Patch; resetChecklist: boolean; nextDue: string | null }

/**
 * Mark done. A repeating item records today as last done, moves its due date by the interval and
 * goes back to the first todo status if it was new or closed. Anything else gets the first closed
 * status with a done outcome.
 */
export function completion(item: Item, ws: Workspace, today: Date): Completion {
  const f = item.type.fields;
  const next = item.repeat ? nextDue(today, item.repeat) : null;
  if (next) {
    const patch: Patch = { [f.lastDone]: isoDate(today), [f.due]: next };
    const m = item.status?.meaning;
    const todo = firstStatus(ws, "todo");
    if ((!m || m === "new" || m === "closed") && todo) patch[f.status] = todo.value;
    return { patch, resetChecklist: true, nextDue: next };
  }
  const done = firstStatus(ws, "closed", "done") ?? firstStatus(ws, "closed");
  return { patch: done ? { [f.status]: done.value } : {}, resetChecklist: false, nextDue: null };
}

/** The properties a captured note starts with. */
export function captureProps(ws: Workspace, typeId: string, space: string, due: string, set: Record<string, string>, today: Date): Record<string, string> {
  const t = ws.types.find((x) => x.id === typeId);
  if (!t) throw new Error(`No type "${typeId}"`);
  const props: Record<string, string> = {};
  if (t.match.property && t.match.value) props[t.match.property] = t.match.value;
  if (space) props[ws.space.property] = space;
  props[t.fields.status] = startStatus(ws).value;
  if (due) props[t.fields.due] = due;
  props[t.fields.created] = isoDate(today);
  return { ...props, ...set };
}
