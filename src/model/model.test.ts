import { describe, expect, it } from "vitest";
import { fixtureWorkspace } from "../../test/load";
import { captureProps, completion, snoozePatch, startStatus } from "./actions";
import { parseCapture } from "./capture";
import { EVERYTHING, matches, sortItems } from "./filter";
import { isOpen, linkUrl, readItem, readMeeting, typeOf, itemsFromMeeting } from "./items";
import type { Workspace } from "../workspace/schema";

const MON = new Date(2026, 10, 9);
const vault = fixtureWorkspace("vault");
const house = fixtureWorkspace("household");

function item(ws: Workspace, path: string, fm: Record<string, unknown>, body = "# T\n\nSummary.\n\n## Work\n- [ ] one\n- [x] two\n") {
  const t = typeOf(ws, path, fm);
  if (!t) throw new Error(`no type for ${path}`);
  return readItem(ws, t, null, path, fm, body);
}

describe("reading notes", () => {
  it("finds a note's type by property or folder, and skips ignored folders", () => {
    expect(typeOf(vault, "Tasks/Fix login.md", { type: "task" })?.id).toBe("task");
    expect(typeOf(vault, "Apps/SpotDME/Quick fixes.md", { type: "quick-list" })?.id).toBe("quick");
    expect(typeOf(vault, "Templates/Task.md", { type: "task" })).toBeNull();
    expect(typeOf(vault, "Recipes/Chili.md", {})).toBeNull();
    expect(typeOf(house, "Chores/Mow.md", {})?.id).toBe("chore");
    expect(typeOf(house, "Notes/Mow.md", {})).toBeNull();
  });

  it("reads roles through each workspace's property names", () => {
    const t = item(vault, "Tasks/Rotate tokens.md", { type: "task", app: "General", status: "ready", due: "2026-11-24", repeat: "90 days", issue: "sabertek-dev/SpotDME#2171" });
    expect(t).toMatchObject({ title: "Rotate tokens", statusValue: "ready", due: "2026-11-24", repeat: "90 days", spaceValue: "General" });
    expect(t.status?.meaning).toBe("todo");
    expect(t.space?.label).toBe("Personal");
    expect(t.links).toEqual([{ label: "Issue", value: "sabertek-dev/SpotDME#2171", url: "https://github.com/sabertek-dev/SpotDME/issues/2171" }]);
    expect(t.checklist.map((c) => c.done)).toEqual([false, true]);
    const c = item(house, "Chores/Mow.md", { project: "Garden", status: "Doing", when: "2026-11-10", every: "weekly" }, "# Mow\n\n## Steps\n- [ ] edge\n");
    expect(c).toMatchObject({ due: "2026-11-10", repeat: "weekly", spaceValue: "Garden" });
    expect(c.status?.meaning).toBe("doing");
    expect(c.checklist.map((x) => x.text)).toEqual(["edge"]);
  });

  it("treats a status outside the workflow as open", () => {
    const t = item(vault, "Tasks/Old.md", { type: "task", status: "someday" });
    expect(t.status).toBeNull();
    expect(isOpen(t)).toBe(true);
  });

  it("links meetings and tasks through source and Items links", () => {
    const m = readMeeting(vault, vault.types.find((x) => x.id === "meeting")!, null, "Meetings/2026-11-05 Review.md", { type: "meeting", attendees: ["Tim", "Ben"] },
      "# Review\n\nSummary.\n\n## Items\n- [[Fix login]] (01:19)\n\n## Decisions\n- Ship it\n");
    expect(m).toMatchObject({ title: "Review", date: "2026-11-05", attendees: ["Tim", "Ben"], decisions: ["Ship it"], linked: ["Fix login"] });
    const a = item(vault, "Tasks/Fix login.md", { type: "task" });
    const b = item(vault, "Tasks/Other.md", { type: "task", source: ["[[2026-11-05 Review]]"] });
    const c = item(vault, "Tasks/Unrelated.md", { type: "task" });
    expect(itemsFromMeeting([a, b, c], m).map((i) => i.title)).toEqual(["Fix login", "Other"]);
  });

  it("builds link URLs only when the value fits the pattern", () => {
    expect(linkUrl("https://github.com/{owner}/{repo}/pull/{number}", "tyoung560/obsidian#2")).toBe("https://github.com/tyoung560/obsidian/pull/2");
    expect(linkUrl("https://github.com/{owner}/{repo}/pull/{number}", "#2")).toBeNull();
    expect(linkUrl("https://example.com/t/{value}", "zendesk 704")).toBe("https://example.com/t/zendesk%20704");
  });
});

describe("filters", () => {
  const a = item(vault, "Tasks/A.md", { type: "task", status: "inbox", due: "2026-11-06" });
  const b = item(vault, "Tasks/B.md", { type: "task", status: "blocked", due: "2026-11-30", repeat: "monthly" });
  const c = item(vault, "Tasks/C.md", { type: "task", status: "done", due: "2026-11-08" });
  const d = item(vault, "Tasks/D.md", { type: "task", status: "in-progress", app: "Sylo" });
  const all = [a, b, c, d];
  const pick = (where: Partial<typeof EVERYTHING>) => all.filter((i) => matches(i, { ...EVERYTHING, ...where }, MON)).map((i) => i.title);

  it("shows open work by default and closed work only when asked", () => {
    expect(pick({})).toEqual(["A", "B", "D"]);
    expect(pick({ meaning: ["closed"] })).toEqual(["C"]);
    expect(pick({ status: ["done"] })).toEqual(["C"]);
  });
  it("filters by meaning, due window, space and set properties", () => {
    expect(pick({ meaning: ["doing", "waiting"] })).toEqual(["B", "D"]);
    expect(pick({ due: { within: 7 } })).toEqual(["A"]);
    expect(pick({ due: "overdue" })).toEqual(["A"]);
    expect(pick({ due: "none" })).toEqual(["D"]);
    expect(pick({ space: ["Sylo"] })).toEqual(["D"]);
    expect(pick({ has: ["repeat"] })).toEqual(["B"]);
  });
  it("sorts by due date with undated items last, and by workflow order", () => {
    expect(sortItems([d, b, a], "due", vault).map((i) => i.title)).toEqual(["A", "B", "D"]);
    expect(sortItems([b, d, a], "status", vault).map((i) => i.title)).toEqual(["A", "D", "B"]);
  });
});

describe("capture", () => {
  it("reads space, due date and title with the vault's aliases", () => {
    expect(parseCapture("gd vendor remittance email due fri", vault, MON)).toEqual({ title: "Vendor remittance email", space: "Global Distributors", type: null, due: "2026-11-13", set: {} });
    expect(parseCapture("rotate keys @me due next week", vault, MON)).toMatchObject({ space: "General", due: "2026-11-16", title: "Rotate keys" });
  });
  it("reads another workspace's aliases, type words and flags", () => {
    expect(parseCapture("g chore urgent fix the fence due tomorrow", house, MON)).toEqual({ title: "Fix the fence", space: "Garden", type: "chore", due: "2026-11-10", set: { priority: "high" } });
    expect(parseCapture("clean the gutters #urgent", house, MON)).toMatchObject({ space: null, set: { priority: "high" }, title: "Clean the gutters" });
  });
  it("leaves words that only look like keywords", () => {
    expect(parseCapture("fix the gd export due", vault, MON)).toMatchObject({ space: null, title: "Fix the gd export due" });
    expect(parseCapture("call about urgent repair", house, MON)).toMatchObject({ set: {}, title: "Call about urgent repair" });
  });
  it("starts a captured note with the type's properties and the first new or todo status", () => {
    expect(captureProps(vault, "task", "Sylo", "", {}, MON)).toEqual({ type: "task", app: "Sylo", status: "inbox", created: "2026-11-09" });
    expect(captureProps(house, "chore", "House", "2026-11-12", { priority: "high" }, MON)).toEqual({ project: "House", status: "To do", when: "2026-11-12", created: "2026-11-09", priority: "high" });
    expect(startStatus(house).value).toBe("To do");
  });
});

describe("actions", () => {
  it("moves a repeating item forward and reopens it", () => {
    const t = item(vault, "Tasks/R.md", { type: "task", status: "inbox", repeat: "90 days" });
    expect(completion(t, vault, MON)).toEqual({ patch: { last_done: "2026-11-09", due: "2027-02-07", status: "ready" }, resetChecklist: true, nextDue: "2027-02-07" });
    const c = item(house, "Chores/Mow.md", { status: "Doing", every: "weekly" });
    expect(completion(c, house, MON).patch).toEqual({ done_on: "2026-11-09", when: "2026-11-16" });
  });
  it("closes anything else with the first done status", () => {
    expect(completion(item(vault, "Tasks/X.md", { type: "task", status: "ready" }), vault, MON).patch).toEqual({ status: "done" });
    expect(completion(item(house, "Chores/X.md", { status: "To do" }), house, MON).patch).toEqual({ status: "Done" });
  });
  it("snoozes from today, or from a future due date", () => {
    expect(snoozePatch(item(vault, "Tasks/X.md", { type: "task", due: "2026-11-01" }), MON)).toEqual({ due: "2026-11-16" });
    expect(snoozePatch(item(house, "Chores/X.md", { when: "2026-11-20" }), MON)).toEqual({ when: "2026-11-27" });
  });
});
