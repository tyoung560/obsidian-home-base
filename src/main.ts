import { Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, HomeBaseSettingTab, type HomeBaseSettings } from "./settings";
import { VaultIndex } from "./vault";
import { HomeBaseView, VIEW_TYPE } from "./view";

export default class HomeBasePlugin extends Plugin {
  settings: HomeBaseSettings = DEFAULT_SETTINGS;
  index!: VaultIndex;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.index = new VaultIndex(this.app, () => this.settings);
    this.registerView(VIEW_TYPE, (leaf) => new HomeBaseView(leaf, this));

    this.addRibbonIcon("layout-dashboard", "Open Home Base", () => void this.activate());
    this.addCommand({ id: "open", name: "Open", callback: () => void this.activate() });
    this.addCommand({ id: "capture", name: "Capture a task", callback: async () => (await this.activate()).openCapture() });
    this.addCommand({ id: "review-inbox", name: "Review inbox", callback: async () => (await this.activate()).startReview() });
    this.addCommand({ id: "log-today", name: "Open today's log note", callback: async () => {
      const f = await this.index.ensureTodayLog();
      await this.app.workspace.getLeaf(false).openFile(f);
    } });
    this.addSettingTab(new HomeBaseSettingTab(this.app, this));

    const refresh = () => this.index.schedule();
    this.registerEvent(this.app.metadataCache.on("changed", refresh));
    this.registerEvent(this.app.vault.on("delete", refresh));
    this.registerEvent(this.app.vault.on("rename", (f) => { if (f instanceof TFile) refresh(); }));

    this.app.workspace.onLayoutReady(async () => {
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

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<HomeBaseSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...saved, apps: saved?.apps ?? DEFAULT_SETTINGS.apps.map((a) => ({ ...a, aliases: [...a.aliases] })) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.index.schedule();
  }
}
