import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { fixtureWorkspace } from "../../test/load";
import { extractBlock, validateWorkspace } from "./validate";

describe("workspace definition", () => {
  it("reads the vault's definition with its roles, statuses and Home sections", () => {
    const ws = fixtureWorkspace("vault");
    expect(ws.space.property).toBe("app");
    expect(ws.space.values.map((v) => v.label)).toEqual(["SpotDME", "GD", "Sylo", "Personal"]);
    expect(ws.workflow.find((s) => s.value === "dropped")).toMatchObject({ meaning: "closed", outcome: "dropped" });
    expect(ws.workflow.find((s) => s.value === "done")?.outcome).toBe("done");
    const task = ws.types.find((t) => t.id === "task");
    expect(task?.fields).toMatchObject({ status: "status", due: "due", repeat: "repeat", lastDone: "last_done" });
    expect(task?.sections.checklist).toEqual(["work", "steps"]);
    expect(task?.board).toBe(true);
    expect(ws.types.find((t) => t.id === "log")?.sections.lines.map((l) => l.heading)).toEqual(["did", "notes", "next"]);
    const recurring = ws.home.find((h) => h.kind === "list" && h.title === "Recurring");
    expect(recurring).toMatchObject({ limit: 6, hideEmpty: true, where: { has: ["repeat"] } });
  });

  it("reads a workspace with different names for everything", () => {
    const ws = fixtureWorkspace("household");
    expect(ws.space.property).toBe("project");
    expect(ws.types[0]).toMatchObject({ id: "chore", folder: "Chores", match: { property: null, folder: "Chores" } });
    expect(ws.types[0]?.fields).toMatchObject({ due: "when", repeat: "every", lastDone: "done_on" });
    expect(ws.flags.urgent).toEqual({ priority: "high" });
    expect(ws.home.map((h) => h.kind)).toEqual(["next", "list", "list", "journal", "meetings", "spaces"]);
  });

  it("lists every problem with its path", () => {
    const r = validateWorkspace(parse(`
space: { property: app }
workflow:
  - { value: open, meaning: todo }
  - { value: stuck, meaning: frozen }
types:
  - { id: task, kind: thing, match: { property: type }, fields: { deadline: due } }
home:
  - { kind: list, filter: nope }
`));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual(expect.arrayContaining([
      'workflow[1].meaning: "frozen" isn\'t one of new, todo, doing, waiting, closed',
      "workflow: needs at least one closed status",
      'types[0].kind: "thing" isn\'t one of item, meeting, journal, checklist, collection',
      "types[0].match: has a property but no value",
      expect.stringMatching(/^types\[0\]\.fields\.deadline: isn't a field role/),
      'home[0].filter: no saved filter with id "nope"',
    ]));
  });

  it("finds the block in a note and rejects a note without one", () => {
    expect(extractBlock("# Notes\n\n```homebase\nversion: 1\n```\n")).toBe("version: 1");
    expect(extractBlock("# Notes\n\n```yaml\nversion: 1\n```\n")).toBeNull();
    expect(validateWorkspace("just text")).toEqual({ ok: false, errors: ["The homebase block must be a YAML mapping (keys and values)."] });
  });
});
