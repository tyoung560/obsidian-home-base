# Home Base

This note configures the Home Base plugin (`tyoung560/obsidian-home-base`). It is the source of
truth for the vault's note types, apps and statuses: the vault's CLAUDE.md points here instead of
listing them. Edit the block below and save; the plugin applies the change straight away. If a line
is wrong, Home Base shows the problem and keeps using the last good version.

- `space` is the property that splits the vault into areas. Here it's `app`.
- `workflow` lists the statuses in order. Each has a meaning (new, todo, doing, waiting, closed),
  which is what the screens use.
- `types` says how to recognise each kind of note, where new ones go, and which properties and
  headings hold what.
- `filters` are saved filters. One with `rail: true` gets its own screen.
- `home` lists the sections on the Home screen, in order.

The format is described in the plugin's `docs/design.md`.

```homebase
version: 1

space:
  property: app
  values:
    - { value: SpotDME, label: SpotDME, color: "#0e8a8c", aliases: [spot, spotdme] }
    - { value: Global Distributors, label: GD, color: "#c07a18", aliases: [gd] }
    - { value: Sylo, label: Sylo, color: "#0088cc", aliases: [sylo] }
    - { value: General, label: Personal, color: "#7663b0", aliases: [me, personal] }

workflow:
  - { value: inbox, label: Inbox, meaning: new }
  - { value: ready, label: Ready, meaning: todo }
  - { value: in-progress, label: In progress, meaning: doing }
  - { value: blocked, label: Blocked, meaning: waiting }
  - { value: done, label: Done, meaning: closed }
  - { value: dropped, label: Dropped, meaning: closed, outcome: dropped }

types:
  - id: task
    label: Task
    kind: item
    match: { property: type, value: task }
    folder: Tasks
    template: Templates/Task.md
    fields:
      links:
        - { property: issue, label: Issue, url: "https://github.com/{owner}/{repo}/issues/{number}" }
        - { property: pr, label: PR, url: "https://github.com/{owner}/{repo}/pull/{number}" }
    sections: { checklist: [Work, Steps] }

  - id: meeting
    label: Meeting
    kind: meeting
    match: { property: type, value: meeting }
    folder: Meetings
    template: Templates/Meeting.md

  - id: log
    label: Daily log
    kind: journal
    match: { property: type, value: log }
    folder: Logs
    name: "{{date}}"
    template: Templates/Daily log.md

  - id: quick
    label: Quick fixes
    kind: checklist
    match: { property: type, value: quick-list }

ignore: [Templates, System]

filters:
  - { id: recurring, label: Recurring, icon: repeat, rail: true, where: { has: repeat }, sort: due }

home:
  - { kind: next }
  - { kind: list, title: Overdue and due this week, column: main, where: { due: { within: 7 } }, sort: due }
  - { kind: list, title: In progress and blocked, column: side, where: { meaning: [doing, waiting] }, sort: status }
  - { kind: list, filter: recurring, column: main, limit: 6, hideEmpty: true }
  - { kind: journal, column: side }
  - { kind: meetings, column: side, limit: 2 }
  - { kind: spaces, column: side }
```
