import { App, Events, Notice, TFile, TFolder, normalizePath } from "obsidian";
import {
  appendToLog, bulletsIn, checklistIn, allChecklist, isoDate, linkTargets, logNoteText, nextDue, normalizeDate,
  parseIsoDate, addDays, resetChecklist, safeFileName, sectionHasContent, setCheckbox, summaryOf, taskNoteText, type Capture,
} from "./parse";
import { isStatus, type DailyLog, type LogSection, type Meeting, type QuickList, type Status, type WorkItem } from "./schema";
import type { HomeBaseSettings } from "./settings";

function str(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  return "";
}
function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(str).filter(Boolean);
  const s = str(v);
  return s ? s.split(",").map((x) => x.trim()).filter(Boolean) : [];
}

/**
 * Reads task, ops, meeting, log and quick-list notes into memory and keeps them current.
 * Emits "updated" (debounced) whenever the vault changes.
 */
export class VaultIndex extends Events {
  items: WorkItem[] = [];
  meetings: Meeting[] = [];
  logs: DailyLog[] = [];
  quickLists: QuickList[] = [];
  ready = false;
  private timer: number | null = null;

  constructor(private app: App, private settings: () => HomeBaseSettings) {
    super();
  }

  today(): Date {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }

  schedule(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.rebuild();
    }, 250);
  }

  async rebuild(): Promise<void> {
    const items: WorkItem[] = [];
    const meetings: Meeting[] = [];
    const logs: DailyLog[] = [];
    const quickLists: QuickList[] = [];
    const s = this.settings();
    const templates = normalizePath(s.templatesFolder);

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (templates && (file.path === templates || file.path.startsWith(`${templates}/`))) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      const type = str(fm?.type);
      if (!fm || !["task", "ops", "meeting", "log", "quick-list"].includes(type)) continue;
      const text = await this.app.vault.cachedRead(file);

      if (type === "task" || type === "ops") {
        const status = isStatus(fm.status) ? fm.status : "inbox";
        items.push({
          file, path: file.path, title: file.basename, type, app: str(fm.app) || "General", status,
          area: str(fm.area), due: normalizeDate(fm.due), repeat: str(fm.repeat), lastDone: normalizeDate(fm.last_done),
          issue: str(fm.issue), pr: str(fm.pr), created: normalizeDate(fm.created), sources: linkTargets(fm.source),
          summary: summaryOf(text), hasOpenQuestions: sectionHasContent(text, ["open questions"]),
          checklist: checklistIn(text, type === "ops" ? ["steps"] : ["work"]),
        });
      } else if (type === "meeting") {
        const fromName = /^(\d{4}-\d{2}-\d{2})\s+(.*)$/.exec(file.basename);
        meetings.push({
          file, path: file.path, title: fromName ? (fromName[2] as string) : file.basename,
          date: normalizeDate(fm.created) || (fromName ? (fromName[1] as string) : ""), app: str(fm.app) || "General",
          attendees: list(fm.attendees), summary: summaryOf(text), decisions: bulletsIn(text, ["decisions"]),
          unresolved: bulletsIn(text, ["unresolved"]), linked: linkTargets(bulletsIn(text, ["items"])),
        });
      } else if (type === "log") {
        logs.push({
          file, date: normalizeDate(fm.created) || file.basename, did: bulletsIn(text, ["did"]),
          notes: bulletsIn(text, ["notes"]), next: checklistIn(text, ["next"]),
        });
      } else {
        quickLists.push({ file, app: str(fm.app) || "General", items: allChecklist(text) });
      }
    }
    this.items = items;
    this.meetings = meetings.sort((a, b) => b.date.localeCompare(a.date));
    this.logs = logs.sort((a, b) => b.date.localeCompare(a.date));
    this.quickLists = quickLists;
    this.ready = true;
    this.trigger("updated");
  }

  /* ---------- lookups ---------- */

  meetingFor(item: WorkItem): Meeting | undefined {
    return this.meetings.find((m) => item.sources.includes(m.file.basename) || m.linked.includes(item.title));
  }

  itemsFromMeeting(m: Meeting): WorkItem[] {
    return this.items.filter((i) => i.sources.includes(m.file.basename) || m.linked.includes(i.title));
  }

  todayLog(): DailyLog | undefined {
    const key = isoDate(this.today());
    return this.logs.find((l) => l.date === key);
  }

  /* ---------- writes (frontmatter through processFrontMatter, bodies through vault.process) ---------- */

  async setStatus(item: WorkItem, status: Status): Promise<void> {
    await this.app.fileManager.processFrontMatter(item.file, (fm) => {
      fm.status = status;
    });
  }

  async setDue(item: WorkItem, due: string): Promise<void> {
    await this.app.fileManager.processFrontMatter(item.file, (fm) => {
      if (due) fm.due = due;
      else delete fm.due;
    });
  }

  async snooze(item: WorkItem, days = 7): Promise<string> {
    const base = parseIsoDate(item.due);
    const from = base && base > this.today() ? base : this.today();
    const due = isoDate(addDays(from, days));
    await this.setDue(item, due);
    return due;
  }

  /** Recurring ops: set last_done, move due by repeat and clear the steps. Otherwise mark done. */
  async complete(item: WorkItem): Promise<string> {
    const today = this.today();
    const next = item.type === "ops" && item.repeat ? nextDue(today, item.repeat) : null;
    await this.app.fileManager.processFrontMatter(item.file, (fm) => {
      if (item.type === "ops") fm.last_done = isoDate(today);
      if (next) {
        fm.due = next;
        if (fm.status === "inbox" || fm.status === "done") fm.status = "ready";
      } else fm.status = "done";
    });
    if (next) {
      await this.app.vault.process(item.file, (t) => resetChecklist(t, ["steps"]));
      return `Done. Next due ${next}`;
    }
    return "Marked done";
  }

  async toggleLine(file: TFile, line: number, done: boolean): Promise<void> {
    await this.app.vault.process(file, (t) => setCheckbox(t, line, done));
  }

  async create(c: Capture & { app: string }): Promise<TFile> {
    const s = this.settings();
    const folder = normalizePath(c.type === "ops" ? s.opsFolder : s.tasksFolder);
    await this.ensureFolder(folder);
    const base = safeFileName(c.title) || "Untitled";
    let path = normalizePath(`${folder}/${base}.md`);
    for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${folder}/${base} ${n}.md`);
    return this.app.vault.create(path, taskNoteText(c, isoDate(this.today())));
  }

  async logAppend(section: LogSection, value: string): Promise<void> {
    const file = await this.ensureTodayLog();
    await this.app.vault.process(file, (t) => appendToLog(t, section, value));
  }

  async ensureTodayLog(): Promise<TFile> {
    const key = isoDate(this.today());
    const folder = normalizePath(this.settings().logsFolder);
    const path = normalizePath(`${folder}/${key}.md`);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return existing;
    await this.ensureFolder(folder);
    return this.app.vault.create(path, logNoteText(key));
  }

  private async ensureFolder(folder: string): Promise<void> {
    if (!folder || folder === "/") return;
    const f = this.app.vault.getAbstractFileByPath(folder);
    if (f instanceof TFolder) return;
    if (f) {
      new Notice(`Home Base: ${folder} is a file, not a folder`);
      throw new Error(`${folder} is not a folder`);
    }
    await this.app.vault.createFolder(folder);
  }
}
