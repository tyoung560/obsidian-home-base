/** Writes a first workspace note: from 0.1 settings when they exist, otherwise a plain default. Pure. */

export interface LegacySettings {
  tasksFolder?: string;
  opsFolder?: string;
  logsFolder?: string;
  templatesFolder?: string;
  apps?: { name: string; short: string; aliases: string[]; color: string }[];
}

const q = (s: string) => JSON.stringify(s);

export function initialWorkspaceNote(legacy: LegacySettings | null): string {
  const fromLegacy = !!legacy?.apps?.length;
  const apps = legacy?.apps ?? [];
  const space = fromLegacy
    ? ["space:", "  property: app", "  values:", ...apps.map((a) => `    - { value: ${q(a.name)}, label: ${q(a.short || a.name)}, color: ${q(a.color)}, aliases: [${a.aliases.map(q).join(", ")}] }`)]
    : ["space:", "  property: project", "  values: []"];
  const workflow = fromLegacy
    ? ["workflow:", "  - { value: inbox, label: Inbox, meaning: new }", "  - { value: ready, label: Ready, meaning: todo }", "  - { value: in-progress, label: In progress, meaning: doing }",
      "  - { value: blocked, label: Blocked, meaning: waiting }", "  - { value: done, label: Done, meaning: closed }", "  - { value: dropped, label: Dropped, meaning: closed, outcome: dropped }"]
    : ["workflow:", "  - { value: inbox, label: Inbox, meaning: new }", "  - { value: todo, label: To do, meaning: todo }", "  - { value: doing, label: Doing, meaning: doing }",
      "  - { value: waiting, label: Waiting, meaning: waiting }", "  - { value: done, label: Done, meaning: closed }", "  - { value: dropped, label: Dropped, meaning: closed, outcome: dropped }"];
  const tasks = legacy?.tasksFolder || "Tasks";
  const logs = legacy?.logsFolder || "Logs";
  const templates = legacy?.templatesFolder || "Templates";
  const block = [
    "version: 1", "", ...space, "", ...workflow, "",
    "types:",
    "  - id: task", "    label: Task", "    kind: item", "    match: { property: type, value: task }", `    folder: ${q(tasks)}`, "    sections: { checklist: [Work, Steps] }", "",
    "  - id: meeting", "    label: Meeting", "    kind: meeting", "    match: { property: type, value: meeting }", "    folder: Meetings", "",
    "  - id: log", "    label: Daily log", "    kind: journal", "    match: { property: type, value: log }", `    folder: ${q(logs)}`, '    name: "{{date}}"', "",
    "  - id: quick", "    label: Quick fixes", "    kind: checklist", "    match: { property: type, value: quick-list }", "",
    `ignore: [${q(templates)}, System]`, "",
    "filters:", "  - { id: recurring, label: Recurring, icon: repeat, rail: true, where: { has: repeat }, sort: due }",
  ];
  return [
    "# Home Base", "",
    "This note configures the Home Base plugin: the note types it reads, the property that splits the",
    "vault into spaces, the statuses and what each means, and the Home screen. Edit the block and save;",
    "the plugin applies the change straight away. The format is described in the plugin's",
    "`docs/design.md`.", "",
    "```homebase", ...block, "```", "",
  ].join("\n");
}
