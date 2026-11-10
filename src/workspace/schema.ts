/**
 * The workspace definition: everything Home Base knows about a vault's notes. It is read from a
 * `homebase` code block in the workspace note and validated into these types. Nothing elsewhere in
 * the plugin names a property, status or heading directly.
 */

/** The fixed set of meanings a status can carry. Screens ask about meanings, never status names. */
export const MEANINGS = ["new", "todo", "doing", "waiting", "closed"] as const;
export type Meaning = (typeof MEANINGS)[number];

export const KINDS = ["item", "meeting", "journal", "checklist", "collection"] as const;
export type Kind = (typeof KINDS)[number];

export interface StatusDef {
  value: string;
  label: string;
  meaning: Meaning;
  /** For closed statuses: whether the work was finished or abandoned. */
  outcome: "done" | "dropped" | null;
  color: string | null;
}

export interface SpaceValue {
  value: string;
  label: string;
  color: string;
  aliases: string[];
}

export interface Space {
  /** The frontmatter property that splits the vault into areas, e.g. `app` or `project`. */
  property: string;
  values: SpaceValue[];
}

export interface Match {
  /** Property and value that identify the type, e.g. `type: task`. */
  property: string | null;
  value: string | null;
  /** Folder the notes must be in (including subfolders). */
  folder: string | null;
}

export interface LinkField {
  property: string;
  label: string;
  /** URL pattern with {owner}, {repo}, {number} or {value}. */
  url: string | null;
}

/** Property names for each role. */
export interface FieldRoles {
  status: string;
  due: string;
  repeat: string;
  lastDone: string;
  created: string;
  area: string;
  source: string;
  people: string;
  links: LinkField[];
}

export interface JournalLine {
  heading: string;
  kind: "bullets" | "checklist";
}

/** Headings (case-insensitive) for each body role. */
export interface SectionRoles {
  checklist: string[];
  questions: string[];
  decisions: string[];
  unresolved: string[];
  items: string[];
  lines: JournalLine[];
}

export interface ItemType {
  id: string;
  label: string;
  kind: Kind;
  match: Match;
  folder: string;
  template: string | null;
  /** File name pattern for new notes, e.g. "{{date}}" for journals. Defaults to the title. */
  name: string | null;
  board: boolean;
  icon: string | null;
  fields: FieldRoles;
  sections: SectionRoles;
}

export type DueFilter = { within: number } | "overdue" | "none" | "any" | { before: string } | { after: string };

export interface Where {
  type: string[] | null;
  meaning: Meaning[] | null;
  status: string[] | null;
  space: string[] | null;
  due: DueFilter | null;
  field: Record<string, string> | null;
  has: string[] | null;
}

export type SortKey = "due" | "created" | "title" | "status";

export interface SavedFilter {
  id: string;
  label: string;
  icon: string;
  rail: boolean;
  where: Where;
  sort: SortKey;
}

export type HomeSection =
  | { kind: "next" }
  | { kind: "list"; title: string; column: "main" | "side"; where: Where; sort: SortKey; limit: number | null; hideEmpty: boolean }
  | { kind: "journal"; column: "main" | "side" }
  | { kind: "meetings"; column: "main" | "side"; limit: number }
  | { kind: "spaces"; column: "main" | "side" };

export interface Workspace {
  version: 1;
  space: Space;
  workflow: StatusDef[];
  types: ItemType[];
  ignore: string[];
  filters: SavedFilter[];
  /** Capture flag words and the properties they set. */
  flags: Record<string, Record<string, string>>;
  home: HomeSection[];
}

export const ROLE_DEFAULTS: Omit<FieldRoles, "links"> = {
  status: "status",
  due: "due",
  repeat: "repeat",
  lastDone: "last_done",
  created: "created",
  area: "area",
  source: "source",
  people: "attendees",
};

export const SECTION_DEFAULTS: SectionRoles = {
  checklist: ["work"],
  questions: ["open questions"],
  decisions: ["decisions"],
  unresolved: ["unresolved"],
  items: ["items"],
  lines: [
    { heading: "did", kind: "bullets" },
    { heading: "notes", kind: "bullets" },
    { heading: "next", kind: "checklist" },
  ],
};
