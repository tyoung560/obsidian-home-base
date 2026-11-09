import { describe, expect, it } from "vitest";
import {
  appendToLog, checklistIn, bulletsIn, daysUntil, linkTargets, logNoteText, nextDue, normalizeDate,
  parseCapture, parseRepeat, resetChecklist, resolveDueWord, sectionHasContent, setCheckbox, summaryOf, taskNoteText,
} from "./parse";
import type { AppDef } from "./schema";

const APPS: AppDef[] = [
  { name: "SpotDME", short: "SpotDME", aliases: ["spot"], color: "" },
  { name: "Global Distributors", short: "GD", aliases: ["gd"], color: "" },
  { name: "Sylo", short: "Sylo", aliases: [], color: "" },
  { name: "General", short: "Personal", aliases: ["me", "personal"], color: "" },
];
const MON = new Date(2026, 10, 9); // Monday 9 Nov 2026

describe("parseCapture", () => {
  it("reads app, due day and title", () => {
    expect(parseCapture("gd vendor remittance email due fri", APPS, MON)).toEqual({ title: "Vendor remittance email", app: "Global Distributors", type: "task", due: "2026-11-13" });
  });
  it("takes @alias anywhere and ops as the second word", () => {
    expect(parseCapture("spot ops sign the BAAs", APPS, MON)).toMatchObject({ app: "SpotDME", type: "ops", title: "Sign the BAAs" });
    expect(parseCapture("rotate keys @me due 2026-12-01", APPS, MON)).toMatchObject({ app: "General", due: "2026-12-01", title: "Rotate keys" });
  });
  it("leaves words that only look like keywords", () => {
    expect(parseCapture("fix the gd export due", APPS, MON)).toMatchObject({ app: null, title: "Fix the gd export due", due: "" });
    expect(parseCapture("review ops dashboard", APPS, MON)).toMatchObject({ type: "task", title: "Review ops dashboard" });
  });
  it("understands due next week and tomorrow", () => {
    expect(parseCapture("sylo call due next week", APPS, MON).due).toBe("2026-11-16");
    expect(parseCapture("sylo call due tomorrow", APPS, MON).due).toBe("2026-11-10");
  });
});

describe("dates", () => {
  it("rolls a weekday to the next one, never today", () => {
    expect(resolveDueWord("mon", MON)).toBe("2026-11-16");
    expect(resolveDueWord("11/2", MON)).toBe("2027-11-02");
  });
  it("counts days and normalizes YAML dates", () => {
    expect(daysUntil("2026-11-06", MON)).toBe(-3);
    expect(daysUntil("", MON)).toBeNull();
    expect(normalizeDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(normalizeDate("soon")).toBe("");
  });
});

describe("repeat", () => {
  it("parses intervals and moves due forward", () => {
    expect(parseRepeat("90 days")).toEqual({ n: 90, unit: "day" });
    expect(parseRepeat("yearly")).toEqual({ n: 1, unit: "year" });
    expect(parseRepeat("whenever")).toBeNull();
    expect(nextDue(MON, "90 days")).toBe("2027-02-07");
    expect(nextDue(MON, "monthly")).toBe("2026-12-09");
  });
});

const TASK = `---
type: task
app: SpotDME
status: inbox
---
# Track hospice rentals

Build hospice tracking so the Hospice tab shows real data.

## Context
Some context.

## Work
- [ ] Decide what marks a rental as hospice
	- [ ] nested detail
- [x] Fill the Hospice tab

## Open questions
- Are the Activity tabs still wanted?
`;

describe("note bodies", () => {
  it("reads the summary, top-level work items and open questions", () => {
    expect(summaryOf(TASK)).toBe("Build hospice tracking so the Hospice tab shows real data.");
    expect(checklistIn(TASK, ["work"])).toEqual([
      { text: "Decide what marks a rental as hospice", done: false, line: 13 },
      { text: "Fill the Hospice tab", done: true, line: 15 },
    ]);
    expect(sectionHasContent(TASK, ["open questions"])).toBe(true);
    expect(sectionHasContent(TASK, ["done when"])).toBe(false);
    expect(bulletsIn(TASK, ["open questions"])).toEqual(["Are the Activity tabs still wanted?"]);
  });
  it("toggles one box and resets a section", () => {
    const t = setCheckbox(TASK, 13, true);
    expect(checklistIn(t, ["work"]).map((c) => c.done)).toEqual([true, true]);
    expect(setCheckbox(TASK, 12, true)).toBe(TASK);
    expect(checklistIn(resetChecklist(t, ["work"]), ["work"]).every((c) => !c.done)).toBe(true);
  });
  it("finds wikilink targets in source values", () => {
    expect(linkTargets(["[[Meetings/2026-11-05 Collections review|Review]]", "Legacy TODO.md", "[[Inbox]]"])).toEqual(["2026-11-05 Collections review", "Inbox"]);
  });
});

describe("templates and logs", () => {
  it("writes task and ops notes in the vault's format", () => {
    const t = taskNoteText({ title: "Fix login", app: "SpotDME", type: "task", due: "" }, "2026-11-09");
    expect(t).toContain("type: task\napp: SpotDME\nstatus: inbox");
    expect(t).not.toContain("due:");
    expect(taskNoteText({ title: "Renew", app: "General", type: "ops", due: "2026-12-01" }, "2026-11-09")).toContain("due: 2026-12-01\nrepeat:");
  });
  it("appends to log sections, replacing an empty template bullet", () => {
    let log = logNoteText("2026-11-09");
    log = appendToLog(log, "did", "Shipped the board");
    log = appendToLog(log, "did", "Fixed sync");
    log = appendToLog(log, "next", "Call Ben");
    expect(bulletsIn(log, ["did"])).toEqual(["Shipped the board", "Fixed sync"]);
    expect(checklistIn(log, ["next"]).map((c) => c.text)).toEqual(["Call Ben"]);
    const tpl = "# 2026-11-09\n\n## Did\n- \n\n## Notes\n- \n\n## Next\n- [ ] \n";
    expect(appendToLog(tpl, "next", "Write docs")).toContain("## Next\n- [ ] Write docs\n");
  });
});

describe("plain", () => {
  it("turns inline markdown into display text", async () => {
    const { plain } = await import("./parse");
    expect(plain("Set `SENDGRID_API_KEY` per [[Ops/Finish the GD go-live|go-live]] and **today**")).toBe("Set SENDGRID_API_KEY per go-live and today");
    expect(plain("see [[Homelab server]]")).toBe("see Homelab server");
  });
});
