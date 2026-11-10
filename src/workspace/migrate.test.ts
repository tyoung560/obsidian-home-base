import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { initialWorkspaceNote } from "./migrate";
import { extractBlock, validateWorkspace } from "./validate";

const load = (note: string) => validateWorkspace(parse(extractBlock(note) ?? ""));

describe("first workspace note", () => {
  it("carries 0.1 settings over: apps, colors, aliases and folders", () => {
    const r = load(initialWorkspaceNote({
      tasksFolder: "Work", logsFolder: "Journal", templatesFolder: "Tpl",
      apps: [{ name: "Global Distributors", short: "GD", aliases: ["gd"], color: "#c07a18" }, { name: "General", short: "Personal", aliases: ["me"], color: "#7663b0" }],
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.workspace.space).toEqual({ property: "app", values: [
      { value: "Global Distributors", label: "GD", color: "#c07a18", aliases: ["gd"] },
      { value: "General", label: "Personal", color: "#7663b0", aliases: ["me"] },
    ] });
    expect(r.workspace.types.find((t) => t.id === "task")?.folder).toBe("Work");
    expect(r.workspace.types.find((t) => t.id === "log")?.folder).toBe("Journal");
    expect(r.workspace.ignore).toEqual(["Tpl", "System"]);
    expect(r.workspace.workflow.map((s) => s.value)).toEqual(["inbox", "ready", "in-progress", "blocked", "done", "dropped"]);
  });

  it("writes a valid default for a vault that never used 0.1", () => {
    const r = load(initialWorkspaceNote(null));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.workspace.space).toEqual({ property: "project", values: [] });
  });
});
