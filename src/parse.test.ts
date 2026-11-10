import { describe, expect, it } from "vitest";
import {
  appendLine, checklistIn, bulletsIn, daysUntil, defaultNoteText, fillTemplate, linkTargets, nextDue, normalizeDate,
  parseRepeat, resetChecklist, resolveDueWord, sectionHasContent, setCheckbox, summaryOf,
} from "./parse";

const MON = new Date(2026, 10, 9); // Monday 9 Nov 2026

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

describe("templates and journals", () => {
  it("fills core-template placeholders and leaves unknown ones", () => {
    expect(fillTemplate("created: {{date:YYYY-MM-DD}}\n# {{title}}\n{{weather}}", { title: "Fix login" }, MON)).toBe("created: 2026-11-09\n# Fix login\n{{weather}}");
  });
  it("writes a note with no template from its properties", () => {
    expect(defaultNoteText({ type: "task", app: "Global Distributors", status: "inbox" }, "Fix login", "work")).toBe(
      "---\ntype: task\napp: Global Distributors\nstatus: inbox\n---\n# Fix login\n\n## Work\n- [ ] \n");
  });
  it("appends to sections, replacing an empty template bullet and creating a missing section", () => {
    const tpl = "# 2026-11-09\n\n## Did\n- \n\n## Notes\n- \n\n## Next\n- [ ] \n";
    let log = appendLine(tpl, "did", "bullets", "Shipped the board");
    log = appendLine(log, "Did", "bullets", "Fixed sync");
    log = appendLine(log, "next", "checklist", "Call Ben");
    expect(bulletsIn(log, ["did"])).toEqual(["Shipped the board", "Fixed sync"]);
    expect(checklistIn(log, ["next"]).map((c) => c.text)).toEqual(["Call Ben"]);
    expect(appendLine("# Day\n", "wins", "bullets", "Ran 5k")).toBe("# Day\n\n## Wins\n- Ran 5k\n");
  });
  it("keeps markdown in raw bullets so links can be read", () => {
    expect(bulletsIn("## Items\n- [[Fix login]] (01:19)\n", ["items"], true)).toEqual(["[[Fix login]] (01:19)"]);
    expect(bulletsIn("## Items\n- [[Fix login]] (01:19)\n", ["items"])).toEqual(["Fix login (01:19)"]);
  });
});

describe("plain", () => {
  it("turns inline markdown into display text", async () => {
    const { plain } = await import("./parse");
    expect(plain("Set `SENDGRID_API_KEY` per [[Ops/Finish the GD go-live|go-live]] and **today**")).toBe("Set SENDGRID_API_KEY per go-live and today");
    expect(plain("see [[Homelab server]]")).toBe("see Homelab server");
  });
});
