import { App, PluginSettingTab, Setting } from "obsidian";
import type { AppDef } from "./schema";
import type HomeBasePlugin from "./main";

export interface HomeBaseSettings {
  tasksFolder: string;
  opsFolder: string;
  logsFolder: string;
  templatesFolder: string;
  openOnStartup: boolean;
  apps: AppDef[];
}

export const DEFAULT_SETTINGS: HomeBaseSettings = {
  tasksFolder: "Tasks",
  opsFolder: "Ops",
  logsFolder: "Logs",
  templatesFolder: "Templates",
  openOnStartup: false,
  apps: [
    { name: "SpotDME", short: "SpotDME", aliases: ["spot", "spotdme"], color: "#0e8a8c" },
    { name: "Global Distributors", short: "GD", aliases: ["gd"], color: "#c07a18" },
    { name: "Sylo", short: "Sylo", aliases: ["sylo"], color: "#0088cc" },
    { name: "General", short: "Personal", aliases: ["me", "personal"], color: "#7663b0" },
  ],
};

export class HomeBaseSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: HomeBasePlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const save = async () => {
      await this.plugin.saveSettings();
    };

    new Setting(containerEl).setName("Open Home Base on startup").addToggle((t) =>
      t.setValue(s.openOnStartup).onChange(async (v) => {
        s.openOnStartup = v;
        await save();
      }),
    );

    new Setting(containerEl).setName("Folders").setHeading();
    const folder = (name: string, desc: string, key: "tasksFolder" | "opsFolder" | "logsFolder" | "templatesFolder") =>
      new Setting(containerEl).setName(name).setDesc(desc).addText((t) =>
        t.setValue(s[key]).onChange(async (v) => {
          s[key] = v.trim();
          await save();
        }),
      );
    folder("Tasks", "Where new task notes go.", "tasksFolder");
    folder("Ops", "Where new ops notes go.", "opsFolder");
    folder("Daily logs", "Where today's log is created, as YYYY-MM-DD.md.", "logsFolder");
    folder("Templates", "Notes in this folder are ignored, so templates never show as tasks.", "templatesFolder");

    new Setting(containerEl).setName("Apps").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Each app is a value of the app property. Aliases are the words that pick it in quick capture, separated by commas.",
    });
    s.apps.forEach((a, i) => {
      new Setting(containerEl)
        .setName(a.name)
        .addText((t) =>
          t.setPlaceholder("Short label").setValue(a.short).onChange(async (v) => {
            a.short = v.trim() || a.name;
            await save();
          }),
        )
        .addText((t) =>
          t.setPlaceholder("Aliases").setValue(a.aliases.join(", ")).onChange(async (v) => {
            a.aliases = v.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
            await save();
          }),
        )
        .addColorPicker((c) =>
          c.setValue(a.color).onChange(async (v) => {
            a.color = v;
            await save();
          }),
        )
        .addExtraButton((b) =>
          b.setIcon("trash").setTooltip("Remove app").onClick(async () => {
            s.apps.splice(i, 1);
            await save();
            this.display();
          }),
        );
    });
    let newName = "";
    new Setting(containerEl)
      .setName("Add an app")
      .addText((t) => t.setPlaceholder("App property value").onChange((v) => (newName = v.trim())))
      .addButton((b) =>
        b.setButtonText("Add").onClick(async () => {
          if (!newName || s.apps.some((a) => a.name === newName)) return;
          s.apps.push({ name: newName, short: newName, aliases: [newName.toLowerCase()], color: "#6b7280" });
          await save();
          this.display();
        }),
      );
  }
}
