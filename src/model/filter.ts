/** The `where` filter and sorting from the workspace definition. Pure. */
import { daysUntil, parseIsoDate } from "../parse";
import type { SortKey, Where, Workspace } from "../workspace/schema";
import { isOpen, str, type Item } from "./items";

export const EVERYTHING: Where = { type: null, meaning: null, status: null, space: null, due: null, field: null, has: null };

/**
 * Whether an item passes a filter. Closed items only pass when the filter asks for a closed meaning
 * or status, so lists show open work by default.
 */
export function matches(item: Item, where: Where, today: Date, fm?: Record<string, unknown>): boolean {
  if (where.type && !where.type.includes(item.type.id)) return false;
  if (where.status) {
    if (!where.status.includes(item.statusValue)) return false;
  } else if (where.meaning) {
    if (!item.status || !where.meaning.includes(item.status.meaning)) return false;
  } else if (!isOpen(item)) return false;
  if (where.space && !where.space.includes(item.spaceValue)) return false;
  if (where.due) {
    const n = item.due ? daysUntil(item.due, today) : null;
    const d = where.due;
    if (d === "none" && item.due) return false;
    if (d === "any" && !item.due) return false;
    if (d === "overdue" && !(n != null && n < 0)) return false;
    if (typeof d === "object" && "within" in d && !(n != null && n <= d.within)) return false;
    if (typeof d === "object" && "before" in d && !(item.due && item.due < d.before)) return false;
    if (typeof d === "object" && "after" in d && !(item.due && item.due > d.after)) return false;
  }
  if (where.has) {
    for (const p of where.has) if (!hasValue(item, p, fm)) return false;
  }
  if (where.field) {
    for (const [p, v] of Object.entries(where.field)) if (fieldValue(item, p, fm) !== v) return false;
  }
  return true;
}

/** Role names resolve through the item; anything else reads the note's frontmatter when given. */
function fieldValue(item: Item, prop: string, fm?: Record<string, unknown>): string {
  const roles: Record<string, string> = { repeat: item.repeat, due: item.due, area: item.area, created: item.created, last_done: item.lastDone };
  const f = item.type.fields;
  if (prop === f.repeat) return item.repeat;
  if (prop === f.due) return item.due;
  if (prop === f.area) return item.area;
  if (prop === f.created) return item.created;
  if (prop === f.lastDone) return item.lastDone;
  if (fm) return str(fm[prop]);
  return roles[prop] ?? "";
}
function hasValue(item: Item, prop: string, fm?: Record<string, unknown>): boolean {
  return fieldValue(item, prop, fm) !== "";
}

export function sortItems<T extends Item>(items: T[], key: SortKey, ws: Workspace): T[] {
  const order = new Map(ws.workflow.map((s, i) => [s.value, i]));
  const byTitle = (a: T, b: T) => a.title.localeCompare(b.title);
  const cmp: Record<SortKey, (a: T, b: T) => number> = {
    due: (a, b) => (a.due || "9999").localeCompare(b.due || "9999") || byTitle(a, b),
    created: (a, b) => (b.created || "").localeCompare(a.created || "") || byTitle(a, b),
    title: byTitle,
    status: (a, b) => (order.get(a.statusValue) ?? 99) - (order.get(b.statusValue) ?? 99) || byTitle(a, b),
  };
  return [...items].sort(cmp[key]);
}

export function isValidDate(s: string): boolean {
  return parseIsoDate(s) !== null;
}
