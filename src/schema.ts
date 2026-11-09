import type { TFile } from "obsidian";

/** The vault schema Home Base reads and writes. Matches the property table in the vault's CLAUDE.md. */

export type NoteType = "task" | "ops" | "meeting" | "log" | "quick-list";

export const STATUSES = ["inbox", "ready", "in-progress", "blocked", "done", "dropped"] as const;
export type Status = (typeof STATUSES)[number];

export const BOARD_STATUSES: { id: Status; label: string; hint: string }[] = [
  { id: "inbox", label: "Inbox", hint: "Waiting for review" },
  { id: "ready", label: "Ready", hint: "Approved for building" },
  { id: "in-progress", label: "In progress", hint: "Issue or PR open" },
  { id: "blocked", label: "Blocked", hint: "Waiting on someone" },
  { id: "done", label: "Done", hint: "Finished" },
];

export function statusLabel(s: string): string {
  if (s === "dropped") return "Dropped";
  return BOARD_STATUSES.find((x) => x.id === s)?.label ?? s;
}

export function isStatus(v: unknown): v is Status {
  return typeof v === "string" && (STATUSES as readonly string[]).includes(v);
}

export interface AppDef {
  /** Value of the `app` property. */
  name: string;
  /** Short label for chips. */
  short: string;
  /** Words that pick this app in quick capture, e.g. "gd". */
  aliases: string[];
  /** CSS color for the app's dot and chip. */
  color: string;
}

export interface ChecklistItem {
  text: string;
  done: boolean;
  /** Zero-based line number in the file, used to toggle the box. */
  line: number;
}

export interface WorkItem {
  file: TFile;
  path: string;
  title: string;
  type: "task" | "ops";
  app: string;
  status: Status;
  area: string;
  due: string;
  repeat: string;
  lastDone: string;
  issue: string;
  pr: string;
  created: string;
  sources: string[];
  summary: string;
  hasOpenQuestions: boolean;
  checklist: ChecklistItem[];
}

export interface Meeting {
  file: TFile;
  path: string;
  title: string;
  date: string;
  app: string;
  attendees: string[];
  summary: string;
  decisions: string[];
  unresolved: string[];
  /** Basenames of notes linked from the meeting's Items section. */
  linked: string[];
}

export interface DailyLog {
  file: TFile;
  date: string;
  did: string[];
  notes: string[];
  next: ChecklistItem[];
}

export interface QuickList {
  file: TFile;
  app: string;
  items: ChecklistItem[];
}

export const LOG_SECTIONS = ["did", "notes", "next"] as const;
export type LogSection = (typeof LOG_SECTIONS)[number];
