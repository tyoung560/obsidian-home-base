/**
 * Turns the parsed `homebase` block into a Workspace, filling defaults and collecting every problem
 * with the path to it ("workflow[3].meaning"). Pure: the caller supplies the YAML parser.
 */
import {
  KINDS, MEANINGS, ROLE_DEFAULTS, SECTION_DEFAULTS,
  type DueFilter, type FieldRoles, type HomeSection, type ItemType, type JournalLine, type Kind, type LinkField, type Meaning,
  type SavedFilter, type SectionRoles, type SortKey, type SpaceValue, type StatusDef, type Where, type Workspace,
} from "./schema";

export type ValidateResult = { ok: true; workspace: Workspace; warnings: string[] } | { ok: false; errors: string[] };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const SORTS: SortKey[] = ["due", "created", "title", "status"];

/** Finds the first ```homebase block in a note. Returns its text, or null when there is none. */
export function extractBlock(note: string): string | null {
  const m = /^(`{3,}|~{3,})homebase[ \t]*\n([\s\S]*?)\n\1[ \t]*$/m.exec(note);
  return m ? (m[2] as string) : null;
}

export function validateWorkspace(raw: unknown): ValidateResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const err = (path: string, msg: string) => errors.push(`${path}: ${msg}`);

  const text = (v: unknown, path: string, fallback?: string): string => {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
    if (fallback !== undefined) return fallback;
    err(path, "is required");
    return "";
  };
  const optText = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
  const textList = (v: unknown): string[] => list(v).map((x) => optText(x)).filter((x): x is string => !!x);
  const lower = (xs: string[]) => xs.map((x) => x.toLowerCase());

  if (!isObj(raw)) return { ok: false, errors: ["The homebase block must be a YAML mapping (keys and values)."] };
  if (raw.version !== undefined && raw.version !== 1) err("version", `must be 1, found ${String(raw.version)}`);

  /* space */
  const spaceRaw = isObj(raw.space) ? raw.space : {};
  if (!isObj(raw.space)) err("space", "is required, with a property and its values");
  const spaceValues: SpaceValue[] = list(spaceRaw.values).map((v, i) => {
    const p = `space.values[${i}]`;
    if (!isObj(v)) { err(p, "must be a mapping with a value"); return { value: "", label: "", color: "", aliases: [] }; }
    const value = text(v.value, `${p}.value`);
    return { value, label: text(v.label, `${p}.label`, value), color: text(v.color, `${p}.color`, "var(--text-faint)"), aliases: lower(textList(v.aliases)) };
  });
  const space = { property: text(spaceRaw.property, "space.property", "project"), values: spaceValues };

  /* workflow */
  const workflow: StatusDef[] = list(raw.workflow).map((v, i) => {
    const p = `workflow[${i}]`;
    if (!isObj(v)) { err(p, "must be a mapping with value and meaning"); return { value: "", label: "", meaning: "todo", outcome: null, color: null }; }
    const value = text(v.value, `${p}.value`);
    const meaning = text(v.meaning, `${p}.meaning`) as Meaning;
    if (meaning && !MEANINGS.includes(meaning)) err(`${p}.meaning`, `"${meaning}" isn't one of ${MEANINGS.join(", ")}`);
    const outcomeRaw = optText(v.outcome);
    if (outcomeRaw && outcomeRaw !== "done" && outcomeRaw !== "dropped") err(`${p}.outcome`, `must be done or dropped`);
    if (outcomeRaw && meaning !== "closed") err(`${p}.outcome`, "only applies to closed statuses");
    const outcome = meaning === "closed" ? ((outcomeRaw as "done" | "dropped" | null) ?? "done") : null;
    return { value, label: text(v.label, `${p}.label`, value), meaning, outcome, color: optText(v.color) };
  });
  if (!workflow.length) err("workflow", "needs at least one status");
  if (workflow.length && !workflow.some((s) => s.meaning === "todo")) err("workflow", "needs at least one todo status");
  if (workflow.length && !workflow.some((s) => s.meaning === "closed")) err("workflow", "needs at least one closed status");
  dupes(workflow.map((s) => s.value), "workflow", err);

  /* types */
  const types: ItemType[] = list(raw.types).map((v, i) => readType(v, `types[${i}]`));
  if (!types.length) err("types", "needs at least one type");
  dupes(types.map((t) => t.id), "types (id)", err);
  if (types.length && !types.some((t) => t.kind === "item")) warnings.push("types: no item type, so the board and review stay empty");
  for (const t of types) if (!t.match.property && !t.match.folder) err(`types.${t.id}.match`, "needs a property and value, a folder, or both");

  function readType(v: unknown, p: string): ItemType {
    const o = isObj(v) ? v : {};
    if (!isObj(v)) err(p, "must be a mapping");
    const id = text(o.id, `${p}.id`);
    const kind = text(o.kind, `${p}.kind`, "item") as Kind;
    if (!KINDS.includes(kind)) err(`${p}.kind`, `"${kind}" isn't one of ${KINDS.join(", ")}`);
    const m = isObj(o.match) ? o.match : {};
    const match = { property: optText(m.property), value: optText(m.value), folder: optText(m.folder)?.replace(/^\/|\/$/g, "") ?? null };
    if (match.property && !match.value) err(`${p}.match`, "has a property but no value");
    const f = isObj(o.fields) ? o.fields : {};
    const links: LinkField[] = list(f.links).map((l, j) => {
      const lp = `${p}.fields.links[${j}]`;
      const lo = isObj(l) ? l : {};
      const property = text(lo.property, `${lp}.property`);
      return { property, label: text(lo.label, `${lp}.label`, property), url: optText(lo.url) };
    });
    const fields: FieldRoles = { ...ROLE_DEFAULTS, links };
    for (const k of Object.keys(ROLE_DEFAULTS) as (keyof typeof ROLE_DEFAULTS)[]) {
      const val = optText(f[k]);
      if (val) fields[k] = val;
    }
    for (const k of Object.keys(f)) if (!(k in ROLE_DEFAULTS) && k !== "links") err(`${p}.fields.${k}`, `isn't a field role (roles: ${Object.keys(ROLE_DEFAULTS).join(", ")}, links)`);
    const s = isObj(o.sections) ? o.sections : {};
    const heads = (k: keyof Omit<SectionRoles, "lines">) => (s[k] === undefined ? SECTION_DEFAULTS[k] : lower(textList(s[k])));
    const lines: JournalLine[] = s.lines === undefined ? SECTION_DEFAULTS.lines : list(s.lines).map((l, j) => {
      const lo = isObj(l) ? l : {};
      const k = text(lo.kind, `${p}.sections.lines[${j}].kind`, "bullets");
      if (k !== "bullets" && k !== "checklist") err(`${p}.sections.lines[${j}].kind`, "must be bullets or checklist");
      return { heading: text(lo.heading, `${p}.sections.lines[${j}].heading`).toLowerCase(), kind: k === "checklist" ? "checklist" : "bullets" };
    });
    const sections: SectionRoles = { checklist: heads("checklist"), questions: heads("questions"), decisions: heads("decisions"), unresolved: heads("unresolved"), items: heads("items"), lines };
    const folder = (optText(o.folder) ?? match.folder ?? "").replace(/^\/|\/$/g, "");
    return {
      id, label: text(o.label, `${p}.label`, id), kind, match, folder, template: optText(o.template), name: optText(o.name),
      board: o.board === undefined ? kind === "item" : o.board === true, icon: optText(o.icon), fields, sections,
    };
  }

  /* filters */
  const typeIds = new Set(types.map((t) => t.id));
  const statusValues = new Set(workflow.map((s) => s.value));
  const spaceSet = new Set(spaceValues.map((s) => s.value));

  function readWhere(v: unknown, p: string): Where {
    const o = isObj(v) ? v : {};
    if (v !== undefined && !isObj(v)) err(p, "must be a mapping");
    const known = ["type", "meaning", "status", "space", "due", "field", "has"];
    for (const k of Object.keys(o)) if (!known.includes(k)) err(`${p}.${k}`, `isn't a filter key (keys: ${known.join(", ")})`);
    const type = o.type === undefined ? null : textList(o.type);
    type?.forEach((t) => { if (!typeIds.has(t)) err(`${p}.type`, `no type with id "${t}"`); });
    const meaning = o.meaning === undefined ? null : (textList(o.meaning) as Meaning[]);
    meaning?.forEach((mn) => { if (!MEANINGS.includes(mn)) err(`${p}.meaning`, `"${mn}" isn't a meaning`); });
    const status = o.status === undefined ? null : textList(o.status);
    status?.forEach((st) => { if (!statusValues.has(st)) err(`${p}.status`, `no status "${st}" in the workflow`); });
    const sp = o.space === undefined ? null : textList(o.space);
    sp?.forEach((x) => { if (!spaceSet.has(x)) warnings.push(`${p}.space: "${x}" isn't a listed space value`); });
    let due: DueFilter | null = null;
    if (o.due !== undefined) {
      if (o.due === "overdue" || o.due === "none" || o.due === "any") due = o.due;
      else if (isObj(o.due) && typeof o.due.within === "number") due = { within: o.due.within };
      else if (isObj(o.due) && typeof o.due.before === "string") due = { before: o.due.before };
      else if (isObj(o.due) && typeof o.due.after === "string") due = { after: o.due.after };
      else err(`${p}.due`, "must be overdue, none, any, { within: days }, { before: date } or { after: date }");
    }
    let field: Record<string, string> | null = null;
    if (o.field !== undefined) {
      if (!isObj(o.field)) err(`${p}.field`, "must be a mapping of property: value");
      else field = Object.fromEntries(Object.entries(o.field).map(([k, x]) => [k, String(x)]));
    }
    const has = o.has === undefined ? null : textList(o.has);
    return { type, meaning, status, space: sp, due, field, has };
  }
  const sortOf = (v: unknown, p: string, d: SortKey): SortKey => {
    if (v === undefined) return d;
    if (SORTS.includes(v as SortKey)) return v as SortKey;
    err(p, `must be one of ${SORTS.join(", ")}`);
    return d;
  };

  const filters: SavedFilter[] = list(raw.filters).map((v, i) => {
    const p = `filters[${i}]`;
    const o = isObj(v) ? v : {};
    const id = text(o.id, `${p}.id`);
    return { id, label: text(o.label, `${p}.label`, id), icon: text(o.icon, `${p}.icon`, "filter"), rail: o.rail === true, where: readWhere(o.where, `${p}.where`), sort: sortOf(o.sort, `${p}.sort`, "due") };
  });
  dupes(filters.map((f) => f.id), "filters (id)", err);

  /* capture flags */
  const flags: Record<string, Record<string, string>> = {};
  const cap = isObj(raw.capture) ? raw.capture : {};
  if (cap.flags !== undefined) {
    if (!isObj(cap.flags)) err("capture.flags", "must be a mapping of word: { property: value }");
    else for (const [word, set] of Object.entries(cap.flags)) {
      if (!isObj(set)) { err(`capture.flags.${word}`, "must be a mapping of property: value"); continue; }
      flags[word.toLowerCase()] = Object.fromEntries(Object.entries(set).map(([k, x]) => [k, String(x)]));
    }
  }

  /* home */
  const homeRaw = raw.home === undefined ? null : list(raw.home);
  const home: HomeSection[] = homeRaw === null ? defaultHome(filters) : homeRaw.map((v, i) => {
    const p = `home[${i}]`;
    const o = isObj(v) ? v : {};
    const kind = text(o.kind, `${p}.kind`);
    const column = o.column === "side" ? "side" : "main";
    if (o.column !== undefined && o.column !== "side" && o.column !== "main") err(`${p}.column`, "must be main or side");
    if (kind === "next") return { kind };
    if (kind === "journal" || kind === "spaces") return { kind, column };
    if (kind === "meetings") return { kind, column, limit: typeof o.limit === "number" ? o.limit : 3 };
    if (kind === "list") {
      let where = readWhere(o.where, `${p}.where`);
      let sort = sortOf(o.sort, `${p}.sort`, "due");
      let title = optText(o.title);
      if (o.filter !== undefined) {
        const f = filters.find((x) => x.id === optText(o.filter));
        if (!f) err(`${p}.filter`, `no saved filter with id "${String(o.filter)}"`);
        else { where = f.where; sort = o.sort === undefined ? f.sort : sort; title = title ?? f.label; }
      }
      return { kind, title: title ?? text(undefined, `${p}.title`), column, where, sort, limit: typeof o.limit === "number" ? o.limit : null, hideEmpty: o.hideEmpty === true };
    }
    err(`${p}.kind`, `"${kind}" isn't one of next, list, journal, meetings, spaces`);
    return { kind: "next" };
  });

  const ignore = textList(raw.ignore).map((x) => x.replace(/^\/|\/$/g, ""));
  for (const k of Object.keys(raw)) if (!["version", "space", "workflow", "types", "ignore", "filters", "capture", "home"].includes(k)) warnings.push(`${k}: unknown key, ignored`);

  if (errors.length) return { ok: false, errors };
  return { ok: true, workspace: { version: 1, space, workflow, types, ignore, filters, flags, home }, warnings };
}

function dupes(values: string[], path: string, err: (p: string, m: string) => void): void {
  const seen = new Set<string>();
  for (const v of values) {
    if (v && seen.has(v)) err(path, `"${v}" appears twice`);
    seen.add(v);
  }
}

function defaultHome(filters: SavedFilter[]): HomeSection[] {
  const none: Where = { type: null, meaning: null, status: null, space: null, due: null, field: null, has: null };
  return [
    { kind: "next" },
    { kind: "list", title: "Overdue and due this week", column: "main", where: { ...none, due: { within: 7 } }, sort: "due", limit: null, hideEmpty: false },
    { kind: "list", title: "In progress and blocked", column: "side", where: { ...none, meaning: ["doing", "waiting"] }, sort: "status", limit: null, hideEmpty: false },
    ...filters.filter((f) => f.rail).map((f): HomeSection => ({ kind: "list", title: f.label, column: "main", where: f.where, sort: f.sort, limit: 6, hideEmpty: true })),
    { kind: "journal", column: "side" },
    { kind: "meetings", column: "side", limit: 2 },
    { kind: "spaces", column: "side" },
  ];
}
