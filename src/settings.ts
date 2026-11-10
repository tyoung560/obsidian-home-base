import { App, PluginSettingTab, Setting } from "obsidian";
import type HomeBasePlugin from "./main";
import type { LegacySettings } from "./workspace/migrate";

export interface HomeBaseSettings {
  workspacePath: string;
  openOnStartup: boolean;
}

export const DEFAULT_SETTINGS: HomeBaseSettings = { workspacePath: "System/Home Base.md", openOnStartup: false };

/** Splits saved data into current settings and any 0.1 keys, which only the first-run migration reads. */
export function readSettings(saved: Record<string, unknown> | null): { settings: HomeBaseSettings; legacy: LegacySettings | null } {
  const s = saved ?? {};
  const legacyKeys = ["tasksFolder", "opsFolder", "logsFolder", "templatesFolder", "apps"];
  const hasLegacy = legacyKeys.some((k) => k in s);
  return {
    settings: {
      workspacePath: typeof s.workspacePath === "string" && s.workspacePath.trim() ? s.workspacePath.trim() : DEFAULT_SETTINGS.workspacePath,
      openOnStartup: s.openOnStartup === true,
    },
    legacy: hasLegacy ? (s as LegacySettings) : null,
  };
}

export class HomeBaseSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: HomeBasePlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const p = this.plugin;

    new Setting(containerEl).setName("Open Home Base on startup").addToggle((t) =>
      t.setValue(p.settings.openOnStartup).onChange(async (v) => {
        p.settings.openOnStartup = v;
        await p.saveSettings();
      }),
    );

    new Setting(containerEl)
      .setName("Workspace note")
      .setDesc("The note whose homebase block defines note types, spaces, statuses and Home. Everything else is configured there.")
      .addText((t) =>
        t.setValue(p.settings.workspacePath).onChange(async (v) => {
          p.settings.workspacePath = v.trim() || "System/Home Base.md";
          await p.saveSettings();
        }),
      )
      .addButton((b) => b.setButtonText("Open").onClick(() => void p.openWorkspaceNote()));

    const store = p.store;
    new Setting(containerEl).setName("Workspace").setHeading();
    if (store.errors.length) {
      containerEl.createEl("p", { text: store.workspace ? "The workspace note has problems, so Home Base is using the last version that worked:" : "The workspace note has problems:" });
      const ul = containerEl.createEl("ul");
      for (const e of store.errors) ul.createEl("li", { text: e });
    } else if (store.workspace) {
      const ws = store.workspace;
      containerEl.createEl("p", {
        cls: "setting-item-description",
        text: `${ws.types.length} note types, ${ws.workflow.length} statuses, ${ws.space.values.length} values of "${ws.space.property}".`,
      });
    }
    for (const w of store.warnings) containerEl.createEl("p", { cls: "setting-item-description", text: w });

    new Setting(containerEl).setName("Notes that don't match the workspace").setHeading();
    const problems = p.index.problems;
    if (!problems.length) {
      containerEl.createEl("p", { cls: "setting-item-description", text: "Every note's type, status and space is in the workspace definition." });
      return;
    }
    containerEl.createEl("p", { cls: "setting-item-description", text: "Add the value to the workspace note, or fix the note." });
    const ul = containerEl.createEl("ul");
    for (const pr of problems.slice(0, 50)) ul.createEl("li", { text: `${pr.path}: ${pr.message}` });
    if (problems.length > 50) containerEl.createEl("p", { text: `…and ${problems.length - 50} more.` });
  }
}
