import { App, Events, TFile, TFolder, normalizePath, parseYaml } from "obsidian";
import { initialWorkspaceNote, type LegacySettings } from "./migrate";
import type { Workspace } from "./schema";
import { extractBlock, validateWorkspace } from "./validate";

/**
 * Holds the current workspace definition. Reads the workspace note, keeps the last valid definition
 * when the note has errors, and emits "changed" whenever the definition or its errors change.
 */
export class WorkspaceStore extends Events {
  workspace: Workspace | null = null;
  errors: string[] = [];
  warnings: string[] = [];

  constructor(private app: App, private path: () => string) {
    super();
  }

  get notePath(): string {
    return normalizePath(this.path());
  }

  isWorkspaceNote(path: string): boolean {
    return normalizePath(path) === this.notePath;
  }

  async load(): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(this.notePath);
    if (!(file instanceof TFile)) {
      this.errors = [`No workspace note at ${this.notePath}.`];
      this.trigger("changed");
      return;
    }
    const text = await this.app.vault.read(file);
    const block = extractBlock(text);
    if (block === null) {
      this.errors = [`${this.notePath} has no homebase code block.`];
      this.trigger("changed");
      return;
    }
    let raw: unknown;
    try {
      raw = parseYaml(block);
    } catch (e) {
      this.errors = [`The homebase block isn't valid YAML: ${e instanceof Error ? e.message : String(e)}`];
      this.trigger("changed");
      return;
    }
    const r = validateWorkspace(raw);
    if (r.ok) {
      this.workspace = r.workspace;
      this.errors = [];
      this.warnings = r.warnings;
    } else {
      this.errors = r.errors;
    }
    this.trigger("changed");
  }

  /** Writes a first workspace note when none exists. Never overwrites. Returns true when it wrote one. */
  async createIfMissing(legacy: LegacySettings | null): Promise<boolean> {
    if (this.app.vault.getAbstractFileByPath(this.notePath)) return false;
    const folder = this.notePath.includes("/") ? this.notePath.slice(0, this.notePath.lastIndexOf("/")) : "";
    if (folder && !(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) await this.app.vault.createFolder(folder);
    await this.app.vault.create(this.notePath, initialWorkspaceNote(legacy));
    return true;
  }
}
