import { App, Events, Notice, TFile, TFolder, normalizePath } from "obsidian";
import { captureProps, completion, duePatch, snoozePatch, statusPatch, type Patch } from "./model/actions";
import type { Capture } from "./model/capture";
import { readItem, readJournal, readMeeting, readQuickList, str, typeOf, type Item, type Journal, type Meeting, type QuickList } from "./model/items";
import { appendLine, defaultNoteText, fillTemplate, isoDate, resetChecklist, safeFileName, setCheckbox } from "./parse";
import type { ItemType, StatusDef, Workspace } from "./workspace/schema";

export type VItem = Item<TFile>;
export type VMeeting = Meeting<TFile>;
export type VJournal = Journal<TFile>;
export type VQuickList = QuickList<TFile>;
export interface Problem { path: string; message: string }

/**
 * Reads the vault's notes through the workspace definition and keeps them current. Emits "updated"
 * (debounced) whenever notes or the definition change. Every write to a note goes through here.
 */
export class VaultIndex extends Events {
  items: VItem[] = [];
  meetings: VMeeting[] = [];
  journals: VJournal[] = [];
  quickLists: VQuickList[] = [];
  problems: Problem[] = [];
  ready = false;
  private timer: number | null = null;

  constructor(private app: App, private ws: () => Workspace | null) {
    super();
  }

  get workspace(): Workspace | null {
    return this.ws();
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
    const ws = this.ws();
    const items: VItem[] = [], meetings: VMeeting[] = [], journals: VJournal[] = [], quickLists: VQuickList[] = [], problems: Problem[] = [];
    if (ws) {
      const typeProps = new Set(ws.types.map((t) => t.match.property).filter((p): p is string => !!p));
      const typeValues = new Set(ws.types.map((t) => `${t.match.property}=${t.match.value}`));
      for (const file of this.app.vault.getMarkdownFiles()) {
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
        const type = typeOf(ws, file.path, fm);
        if (!type) {
          if (fm && !ws.ignore.some((f) => file.path === f || file.path.startsWith(`${f}/`))) {
            for (const p of typeProps) {
              const v = str(fm[p]);
              if (v && !typeValues.has(`${p}=${v}`)) problems.push({ path: file.path, message: `${p} "${v}" isn't a note type in the workspace` });
            }
          }
          continue;
        }
        const text = await this.app.vault.cachedRead(file);
        if (type.kind === "item") {
          const it = readItem(ws, type, file, file.path, fm, text);
          if (!it.status) problems.push({ path: file.path, message: it.statusValue ? `status "${it.statusValue}" isn't in the workflow` : "has no status" });
          if (it.spaceValue && !it.space) problems.push({ path: file.path, message: `${ws.space.property} "${it.spaceValue}" isn't a listed space` });
          items.push(it);
        } else if (type.kind === "meeting") meetings.push(readMeeting(ws, type, file, file.path, fm, text));
        else if (type.kind === "journal") journals.push(readJournal(type, file, file.path, fm, text));
        else if (type.kind === "checklist") quickLists.push(readQuickList(ws, file, file.path, fm, text));
      }
    }
    this.items = items;
    this.meetings = meetings.sort((a, b) => b.date.localeCompare(a.date));
    this.journals = journals.sort((a, b) => b.date.localeCompare(a.date));
    this.quickLists = quickLists.sort((a, b) => a.path.localeCompare(b.path));
    this.problems = problems;
    this.ready = true;
    this.trigger("updated");
  }

  journalType(): ItemType | null {
    return this.ws()?.types.find((t) => t.kind === "journal") ?? null;
  }

  todayJournal(): VJournal | undefined {
    const key = isoDate(this.today());
    return this.journals.find((j) => j.date === key);
  }

  /* ---------- writes ---------- */

  async patch(file: TFile, patch: Patch): Promise<void> {
    if (!Object.keys(patch).length) return;
    await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) delete fm[k];
        else fm[k] = v;
      }
    });
  }

  setStatus(item: VItem, status: StatusDef): Promise<void> {
    return this.patch(item.file, statusPatch(item, status));
  }

  setDue(item: VItem, due: string): Promise<void> {
    return this.patch(item.file, duePatch(item, due));
  }

  async snooze(item: VItem): Promise<string> {
    const p = snoozePatch(item, this.today());
    await this.patch(item.file, p);
    return `Snoozed to ${p[item.type.fields.due]}`;
  }

  async complete(item: VItem): Promise<string> {
    const ws = this.ws();
    if (!ws) throw new Error("The workspace isn't loaded");
    const c = completion(item, ws, this.today());
    await this.patch(item.file, c.patch);
    if (c.resetChecklist) await this.app.vault.process(item.file, (t) => resetChecklist(t, item.type.sections.checklist));
    return c.nextDue ? `Done. Next due ${c.nextDue}` : "Marked done";
  }

  async toggleLine(file: TFile, line: number, done: boolean): Promise<void> {
    await this.app.vault.process(file, (t) => setCheckbox(t, line, done));
  }

  async create(c: Capture & { space: string; type: string }): Promise<TFile> {
    const ws = this.ws();
    if (!ws) throw new Error("The workspace isn't loaded");
    const type = ws.types.find((t) => t.id === c.type);
    if (!type) throw new Error(`No type "${c.type}" in the workspace`);
    const today = this.today();
    const props = captureProps(ws, type.id, c.space, c.due, c.set, today);
    const file = await this.newNote(type, c.title, { title: c.title, space: c.space, due: c.due }, props);
    await this.patch(file, props);
    return file;
  }

  async journalAppend(section: number, value: string): Promise<void> {
    const type = this.journalType();
    const line = type?.sections.lines[section];
    if (!type || !line) throw new Error("No journal type in the workspace");
    const file = await this.ensureTodayJournal();
    await this.app.vault.process(file, (t) => appendLine(t, line.heading, line.kind, value));
  }

  async ensureTodayJournal(): Promise<TFile> {
    const ws = this.ws();
    const type = this.journalType();
    if (!ws || !type) throw new Error("No journal type in the workspace");
    const key = isoDate(this.today());
    const name = fillTemplate(type.name ?? "{{date}}", { title: key }, this.today());
    const existing = this.app.vault.getAbstractFileByPath(normalizePath(`${type.folder}/${name}.md`));
    if (existing instanceof TFile) return existing;
    const props: Record<string, string> = {};
    if (type.match.property && type.match.value) props[type.match.property] = type.match.value;
    props[type.fields.created] = key;
    const file = await this.newNote(type, name, { title: key }, props, true);
    await this.patch(file, props);
    return file;
  }

  private async newNote(type: ItemType, title: string, vars: Record<string, string>, props: Record<string, string>, exactName = false): Promise<TFile> {
    const folder = normalizePath(type.folder || "/");
    await this.ensureFolder(folder);
    const base = exactName ? title : safeFileName(title) || "Untitled";
    const at = (n: number) => normalizePath(`${folder === "/" ? "" : `${folder}/`}${base}${n > 1 ? ` ${n}` : ""}.md`);
    let n = 1;
    while (this.app.vault.getAbstractFileByPath(at(n))) n++;
    let text: string;
    const tpl = type.template ? this.app.vault.getAbstractFileByPath(normalizePath(type.template)) : null;
    if (tpl instanceof TFile) text = fillTemplate(await this.app.vault.read(tpl), vars, this.today());
    else {
      if (type.template) new Notice(`Home Base: template ${type.template} not found, using a blank note`);
      const heading = type.kind === "journal" ? null : type.sections.checklist[0] ?? null;
      text = defaultNoteText(props, title, heading);
      if (type.kind === "journal") text += type.sections.lines.map((l) => `\n## ${l.heading.charAt(0).toUpperCase()}${l.heading.slice(1)}\n`).join("");
    }
    return this.app.vault.create(at(n), text);
  }

  private async ensureFolder(folder: string): Promise<void> {
    if (!folder || folder === "/") return;
    const f = this.app.vault.getAbstractFileByPath(folder);
    if (f instanceof TFolder) return;
    if (f) throw new Error(`${folder} is a file, not a folder`);
    await this.app.vault.createFolder(folder);
  }
}
