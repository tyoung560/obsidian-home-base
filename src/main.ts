import { Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, HomeBaseSettingTab, readSettings, type HomeBaseSettings } from "./settings";
import { VaultIndex } from "./vault";
import { HomeBaseView, VIEW_TYPE } from "./view";
import { WorkspaceStore } from "./workspace/store";

export default class HomeBasePlugin extends Plugin {
  settings: HomeBaseSettings = DEFAULT_SETTINGS;
  store!: WorkspaceStore;
  index!: VaultIndex;

  async onload(): Promise<void> {
    const { settings, legacy } = readSettings((await this.loadData()) as Record<string, unknown> | null);
    this.settings = settings;
    this.store = new WorkspaceStore(this.app, () => this.settings.workspacePath);
    this.index = new VaultIndex(this.app, () => this.store.workspace);
    this.registerView(VIEW_TYPE, (leaf) => new HomeBaseView(leaf, this));

    this.addRibbonIcon("layout-dashboard", "Open Home Base", () => void this.activate());
    this.addCommand({ id: "open", name: "Open", callback: () => void this.activate() });
    this.addCommand({ id: "capture", name: "Capture a task", callback: async () => (await this.activate()).openCapture() });
    this.addCommand({ id: "review-inbox", name: "Review inbox", callback: async () => (await this.activate()).startReview() });
    this.addCommand({ id: "log-today", name: "Open today's journal note", callback: async () => {
      try {
        await this.app.workspace.getLeaf(false).openFile(await this.index.ensureTodayJournal());
      } catch (e) {
        new Notice(`Home Base: ${e instanceof Error ? e.message : String(e)}`);
      }
    } });
    this.addCommand({ id: "open-workspace", name: "Open the workspace note", callback: () => void this.openWorkspaceNote() });
    this.addSettingTab(new HomeBaseSettingTab(this.app, this));

    this.registerEvent(this.store.on("changed", () => this.index.schedule()));
    const changed = (path: string) => {
      if (this.store.isWorkspaceNote(path)) void this.store.load();
      else this.index.schedule();
    };
    this.registerEvent(this.app.metadataCache.on("changed", (f) => changed(f.path)));
    this.registerEvent(this.app.vault.on("delete", (f) => changed(f.path)));
    this.registerEvent(this.app.vault.on("rename", (f, old) => { if (f instanceof TFile) { changed(old); changed(f.path); } }));

    this.app.workspace.onLayoutReady(async () => {
      if (await this.store.createIfMissing(legacy)) new Notice(`Home Base: wrote ${this.store.notePath}. It defines your note types and statuses.`);
      if (legacy) await this.saveSettings();
      await this.store.load();
      await this.index.rebuild();
      if (this.settings.openOnStartup) await this.activate();
    });
  }

  onunload(): void {}

  async activate(): Promise<HomeBaseView> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
    return leaf.view as HomeBaseView;
  }

  async openWorkspaceNote(): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(this.store.notePath);
    if (f instanceof TFile) await this.app.workspace.getLeaf("tab").openFile(f);
    else new Notice(`Home Base: no note at ${this.store.notePath}`);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    await this.store.load();
  }
}
