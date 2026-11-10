# Home Base design: a configurable workspace

Status: reviewed 2026-11-10; decisions are listed at the end. Nothing here is built yet.

Home Base 0.1 works, but it only works for one vault. The note types, the statuses, the `app`
property, the `## Work` and `## Steps` checklists and the daily log format are all written into
the code. This document describes how to move that knowledge out of the code and into a
**workspace definition** that lives in the vault, so the plugin reads the schema instead of
assuming it.

Nobody else is going to use Home Base. The test this design has to pass is still "could someone
with a different vault set it up without changing code?", because a design that passes it is also
one where changing my own vault (a new note type, a renamed status, a new app) is a one-line edit
instead of a release.

## What Home Base is for

The vault holds more than work: tasks, but also recipes, saved links, personal notes
and a wiki for the apps. Home Base shouldn't try to turn all of that into tasks, and it shouldn't
ignore it either. It has two tiers.

**It manages work and attention.** Anything with a status or a date that I act on: tasks
(including admin and recurring jobs), meetings (decisions and open questions), the daily log, quick fixes. For these, Home Base is
the main way in. It shows what needs doing, what's due and what's waiting, and it changes them
(status, due date, checkboxes, Mark done).

**It surfaces everything else.** Recipes, links, notes and wiki pages have no workflow. For these,
Home Base is a fast way to *find* things, not to edit them: browse a collection as cards, search
it, see what changed recently, pin a few notes to Home. Opening one goes to the normal Obsidian
note, where editing happens.

The test for whether something belongs in the first tier is whether it has a state that changes
("in progress", "due Friday", "done"). A recipe I want to cook this week isn't a recipe with a
status; it's a task ("Make the chili") that links to the recipe.

That split decides what the plugin doesn't do: no recipe fields, link previews, wiki tree or note
editor. Obsidian, Bases and the Web Clipper already do those. Home Base's job for the second tier
is getting me to the right note in one or two taps, especially on the phone, where finding a note
is slower than on the desktop.

## Goals

- The schema lives in one vault note. The plugin has no built-in note types, statuses or
  property names, only defaults.
- My current vault keeps working with no changes to any note. Upgrading to the configurable
  version writes a definition that describes the vault exactly as it is today.
- Every screen works with any configuration: Home, board, upcoming, review, capture, the item
  sheet, on desktop and phone.
- Bad configuration fails loudly and locally: the view says which line is wrong and keeps working
  with the last good definition.
- Notes stay plain markdown that a person, Claude and GitHub can read without the plugin.

## Non-goals

- Several people working in one vault: no assignees, permissions or edit locking.
- A general database like Bases or Dataview. Home Base is opinionated about work items, and
  the definition only has to describe things that behave like tasks, meetings and journals.
- Presets and a first-run setup screen. The design leaves room for them (a preset is just a
  definition note), but they aren't in scope.
- A visual editor for every option in the first version. The note is the editor; the settings tab
  covers the common edits.

## What changes, at a glance

| Today, in code | In the workspace definition |
|---|---|
| Two work-item types, `task` and `ops`, plus `meeting`, `log` and `quick-list` | Any number of **item types**, each with a kind: `item`, `meeting`, `journal` or `checklist` |
| `app` with four values | One **space** property (any name) with any values, each with a label, color and capture aliases |
| Six statuses with meanings scattered through the code | A **workflow**: your statuses in order, each tagged with one of five fixed meanings |
| `due`, `repeat`, `last_done`, `issue`, `pr`, `area`, `source` read by name | **Field roles** mapped to property names, per item type |
| `## Work`, `## Steps`, `## Open questions`, `## Did` and so on read by name | **Section roles** mapped to heading text, per item type |
| Home's sections fixed in code | **Home** as an ordered list of sections, each with its own filter |
| Capture keywords fixed in code | Capture rules derived from the definition |

## Concepts

### Workspace

One vault has one workspace definition. It names the item types, the space, the workflow and the
Home layout. Everything the plugin knows about the vault comes from it.

### Item types

An item type is a kind of note. Each has:

- `id` and `label`, for example `task` / "Task".
- `kind`, which decides how the plugin treats it:
  - `item`: a unit of work with a status. Shows on the board, in review, in upcoming.
  - `meeting`: a dated note with decisions, open questions and linked items.
  - `journal`: one note per day (the daily log).
  - `checklist`: a note whose checkboxes are each a small to-do (Quick fixes). Today that means
    notes marked `type: quick-list`; collecting unticked boxes from other notes as well is a
    possible later option.
  - `collection`: notes with no workflow that Home Base only surfaces: recipes, links, notes, wiki
    pages. See "Collections" below.
- `match`: how to recognise one. A property value (`type: task`), a folder (`Chores/`), or both.
  The property form is the default because it survives notes being moved.
- `folder` and `template`: where a new one goes and what it starts with. The template is a normal
  note in the vault, so it's edited like any other note, and `{{title}}`, `{{date}}`, `{{space}}`
  and `{{due}}` are filled in.
- `fields` and `sections`: the role mappings below.
- `icon` and `color`, for chips and the rail.

### Tasks and ops jobs are one type

0.1 has two work types: tasks (a code change in an app repo, which becomes a GitHub issue and PR)
and ops jobs (no code: sign a BAA, move DNS, rotate a key, some of them repeating). They behave the
same way: both have a status, a due date and a checklist. So they become one `task` type:

- **Repeating** is a task with a `repeat` value. Mark done on any task with `repeat` sets
  `last_done` and moves `due` forward; without `repeat`, it closes the task.
- **Code or not** is an optional `work` property: `work: ops` for jobs with no code change. A task
  with no `work` is a code task. This is what Claude reads to know which tasks it can build.
- All of them live in `Tasks/`. The Ops screen becomes a Home section and a rail entry that filter
  `work: ops`, so it's configuration, not a special case: any saved filter can get a rail entry
  with `rail: true`.

A type can still opt out of the board with `board: false`, for types that aren't worked through
statuses.

### Space

The space is the property that splits the vault into areas. For me it's `app`. For someone else
it might be `project`, `client`, `person` or `area`. There is exactly one space property per
workspace. Each value has:

- `value`: what's written in the note (`Global Distributors`)
- `label`: the short form on chips (`GD`)
- `color`
- `aliases`: words that pick it in capture (`gd`)

Notes with no space value, or a value that isn't listed, still show. They're grouped under the
value's own text and get a neutral color, and the settings tab offers to add the value.

Choosing one space instead of "any number of grouping properties" keeps the rail, the lens chips
on the phone and capture simple. Other properties can still be used in a Home section's filter.

### Workflow

A workflow is the ordered list of statuses for `item` types. Each status has a `value` (written
to the note), a `label`, an optional `color`, and a **meaning** from a fixed set:

| Meaning | What the plugin does with it |
|---|---|
| `new` | Shows in review and on Home's "waiting for review". Capture sets the first `new` status. |
| `todo` | Approved and waiting. Review moves `new` items here. |
| `doing` | Shows in "In progress". |
| `waiting` | Shows in "In progress" with a warning stripe. |
| `closed` | Hidden from everything except the board's last column. Can be marked as `done` or `dropped` for counts. |

Every screen uses meanings, never status names. My six statuses map like this: `inbox`→new,
`ready`→todo, `in-progress`→doing, `blocked`→waiting, `done`→closed (done), `dropped`→closed
(dropped). A household list could be `To do`→todo, `Doing`→doing, `Done`→closed, with no `new`
status at all, in which case review is hidden and capture uses the first `todo` status.

Rules about who may move what (in my vault, only I move `inbox` to `ready`) stay in the vault's
CLAUDE.md. The plugin is used by me, so it doesn't enforce them.

### Field roles

Each item type maps roles to the property that holds them. Roles the plugin understands:

| Role | Type | Used for |
|---|---|---|
| `status` | workflow value | board column, filters, review |
| `space` | space value | chips, lens, capture |
| `due` | date | upcoming, overdue, due soon, snooze |
| `repeat` | interval | Mark done moves `due` forward |
| `lastDone` | date | set by Mark done |
| `created` | date | age, sorting |
| `area` | text | the small label on cards |
| `source` | links | "from this meeting" |
| `links` | list of named properties | shown as links in the sheet, for example `issue` and `pr` turned into GitHub URLs with a pattern |
| `people` | list | meeting attendees |

Unmapped properties aren't lost: the item sheet lists every other frontmatter property under
"More", read-only at first.

Each role has a default property name equal to the role (`due`, `status` and so on), so a vault
that uses those names needs no mapping at all.

### Section roles

Some of what the plugin shows comes from the note body. Each item type maps body roles to headings:

| Role | Default heading | Used for |
|---|---|---|
| `summary` | first paragraph after the title | cards, review, sheet |
| `checklist` | `Work` | progress bar, sheet checklist, ticking |
| `questions` | `Open questions` | the "Open questions" chip |
| `decisions` | `Decisions` | meetings |
| `unresolved` | `Unresolved` | meetings |
| `items` | `Items` | meetings: links to the tasks that came from them |
| journal lines | `Did`, `Notes`, `Next` | the daily log, configurable as a list of `{ heading, kind: bullets | checklist }` |

Headings match case-insensitively and a role can list several (`[Work, Steps]`), which is how ops
jobs keep `## Steps`.

### Collections

A collection is an item type with `kind: collection`. Home Base reads it but never changes it.
Each collection has:

- `match`: a folder (`Recipes/`), a tag (`#recipe`), a property (`type: recipe`), or a mix. Folder
  matching is the common case here, since the Web Clipper and most notes don't set a `type`.
- `card`: what a card shows. A title, an optional subtitle property (`source` for a link, `cuisine`
  for a recipe), an optional image property (`image`, which the Web Clipper already sets), and a
  line of the summary.
- `sort`: `modified` (default), `created`, `title`, or a property.
- `facets`: up to two properties or tags to filter by in the collection's screen, for example
  `tags` and `course` for recipes.

Collections get a **Library** screen: a list of collections with counts, each opening a card grid
(a list on the phone) with search and the facets. Search is title and summary within the
collection. Searching the whole vault stays with Obsidian's own search, which the Library links to.

Home can show collections too, through two section kinds:

- `recent`: notes edited recently, across all collections or some
- `pinned`: a short list of notes I pin from their card's menu, stored as links in the workspace
  note so pins sync and show in git history

Collections can also come from a `.base` file: `source: Recipes.base` reads the base's results
through Bases instead of Home Base's own matching. That keeps richer filtering and formulas in
Bases, where they already work, and Home Base only draws the cards.

For my vault the first collections would be:

| Collection | Match | Card |
|---|---|---|
| Links | folder `Clippings/` | title, `source` host, `image`, `created` |
| Personal notes | folder `Personal/` | title, modified date |
| App wiki | folder `Apps/` minus hub and Quick fixes notes | title, the app from the folder |
| Recipes | folder `Recipes/` (new) | title, `image`, tags |

### Home

Home is an ordered list of sections. Each section has a `kind` and options:

- `next`: the one most useful action: something overdue, then review, then "nothing needs you"
- `list`: a filtered, sorted list of items with a title, for example "Due this week" or
  "Open ops"
- `journal`: today's journal, with its checklist section and an add box
- `meetings`: recent meetings
- `spaces`: a summary per space, counting by meaning
- `recent` and `pinned`: notes from collections (see "Collections")

The desktop layout puts sections in two columns using a `column: main | side` option; the phone
stacks them in order.

### Filters

Home sections, the board and the lens need filters. Rather than a formula language, filters are a
small object, so they validate cleanly and are easy to write by hand:

```yaml
where:
  type: task             # item type id, or a list of ids
  meaning: [todo, doing] # workflow meanings
  status: blocked        # exact status values
  space: SpotDME
  due: { within: 7 }     # also: overdue, none, any, before/after a date
  field: { work: ops }   # any property, exact value
sort: due                # or created, title, status
limit: 6
```

A filter can be saved under `filters:` with an `id`, and then used by name: a Home section takes
`filter: ops`, and a saved filter with `rail: true` gets its own entry in the rail (and under More
on the phone). That's how the Ops screen works after ops jobs merge into tasks.

Anything more complex belongs in a `.base` file; see "Bases" below.

### Capture

Capture reads its rules from the definition:

- a space alias as the first word, or `@alias` anywhere, sets the space
- an item type id or label as a word (`chore`) sets the type; the default type is the first
  `item` type
- a flag word sets a property, as defined under `capture.flags`: in my vault `ops` sets
  `work: ops`
- `due <word>` sets the role mapped to `due`
- the rest is the title

The phone sheet's chips (space, type, due) are built from the same lists.

## The workspace note

The definition is a note in the vault, `System/Home Base.md` by default (the path is a plugin
setting). `System/` is for notes that configure the vault rather than hold content.
The definition itself is a fenced code block with the language `homebase`:

````markdown
# Home Base

This note configures the Home Base plugin. Edit the block below, or use the plugin's settings.

```homebase
version: 1
space: …
```
````

Why a code block in a note:

- it syncs, diffs and shows in git history like every other note
- Claude can read and edit it with the vault's other notes
- the note can carry prose around the block: why a status exists, what a space means
- Obsidian's properties panel can't edit nested YAML, so frontmatter would be awkward to edit by hand
- the plugin registers a renderer for `homebase` blocks, so in reading view the block shows as a
  readable summary (types, statuses with colors, spaces) with an "Edit in settings" button

The plugin parses it with Obsidian's `parseYaml`, validates it, and watches the note: saving the
note applies the change straight away. If the block has an error, the view shows a banner with the
problem and the line ("workflow: status `blocked` has unknown meaning `stuck`") and keeps using the
last valid definition. With no note at all, the plugin offers to create one.

### My vault's definition

This is what the upgrade would write for `tyoung560/obsidian`, and it's the full example of the
format:

```homebase
version: 1

space:
  property: app
  values:
    - { value: SpotDME, label: SpotDME, color: "#0e8a8c", aliases: [spot] }
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
      area: area
      repeat: repeat
      lastDone: last_done
      links:
        - { property: issue, label: Issue, url: "https://github.com/{owner}/{repo}/issues/{number}" }
        - { property: pr, label: PR, url: "https://github.com/{owner}/{repo}/pull/{number}" }
    sections: { checklist: [Work, Steps], questions: [Open questions] }

  - id: meeting
    label: Meeting
    kind: meeting
    match: { property: type, value: meeting }
    folder: Meetings
    fields: { people: attendees }

  - id: log
    label: Daily log
    kind: journal
    match: { property: type, value: log }
    folder: Logs
    name: "{{date}}"
    template: Templates/Daily log.md
    sections:
      lines:
        - { heading: Did, kind: bullets }
        - { heading: Notes, kind: bullets }
        - { heading: Next, kind: checklist }

  - id: quick
    label: Quick fixes
    kind: checklist
    match: { property: type, value: quick-list }

  - id: links
    label: Links
    kind: collection
    match: { folder: Clippings }
    card: { subtitle: source, image: image, date: created }

  - id: notes
    label: Personal notes
    kind: collection
    match: { folder: Personal }

  - id: wiki
    label: App wiki
    kind: collection
    match: { folder: Apps, notType: [quick, hub] }

ignore: [Templates, System]

capture:
  flags:
    ops: { work: ops }

filters:
  - { id: ops, label: Ops, icon: repeat, rail: true, where: { field: { work: ops } }, sort: due }

pinned: []

home:
  - { kind: next }
  - { kind: list, title: Overdue and due this week, column: main, where: { due: { within: 7 } }, sort: due }
  - { kind: list, title: In progress and blocked, column: side, where: { meaning: [doing, waiting] } }
  - { kind: list, title: Open ops, column: main, filter: ops, limit: 6 }
  - { kind: journal, column: side }
  - { kind: meetings, column: side, limit: 2 }
  - { kind: spaces, column: side }
  - { kind: recent, column: side, limit: 5 }
```

Fields that match the role name (`status`, `due`, `created`, `source`) aren't listed, because the
default mapping covers them.

The GitHub link pattern needs to know the repo for an issue like `sabertek-dev/SpotDME#2171`. The
value already carries `owner/repo#number`, so the pattern splits it; a value without an owner
shows as plain text.

### Relationship to the vault's CLAUDE.md

The vault's CLAUDE.md stays the source of truth for property names and allowed values, because
Claude reads it at the start of every session in the vault. The workspace note is the plugin's
machine-readable copy of the same schema. To keep the two from drifting:

- CLAUDE.md says that changing a property or value there means changing `System/Home Base.md` in
  the same commit, and the other way round.
- The plugin checks the vault against its definition and lists mismatches in the settings tab:
  notes whose `app` or `status` value isn't in the definition, and types it doesn't recognise. A
  value added in CLAUDE.md but forgotten in the note shows up there the first time a note uses it.

CLAUDE.md also keeps what a plugin can't enforce: when to make a task or a quick fix, note body
layout, who moves statuses, naming.

## Code structure

```
src/workspace/schema.ts     the definition's types, defaults and the fixed list of meanings and roles
src/workspace/validate.ts   parse the code block, apply defaults, return a Workspace or a list of errors with lines
src/workspace/load.ts       find and watch the note, keep the last good definition
src/workspace/migrate.ts    0.1 settings → a definition note
src/model/items.ts          read notes into Item, Meeting, Journal, Checklist using the definition
src/model/filter.ts         the `where` filter and sorting, pure
src/model/capture.ts        capture parsing from the definition, pure
src/parse.ts                body parsing, dates, intervals (as today)
src/vault.ts                the index and every write (as today, now driven by roles)
src/views/…                 one file per screen instead of one 1,000-line view.ts
src/render/homebase-block.ts the reading-view renderer for the code block
```

The model becomes:

```ts
interface Item {
  file: TFile;
  type: ItemType;          // from the definition
  title: string;
  status: Status | null;   // Status carries its meaning
  space: SpaceValue | null;
  due: string;             // via the due role, "" when unmapped or empty
  fields: Record<Role, unknown>;
  extra: Record<string, unknown>; // every other frontmatter property
  summary: string;
  checklist: ChecklistItem[];
  hasQuestions: boolean;
}
```

Screens ask questions through meanings (`item.status?.meaning === "doing"`) and roles
(`item.due`), never property names. `filter.ts` and `capture.ts` are pure and get unit tests with
two definitions: mine and a deliberately different one (a household list with `project` as the
space, three statuses and no `new`). That second definition is the extensibility test, run on
every build. The harness gains a `?workspace=household` option that renders a vault built for it,
so both layouts are checked by screenshot too.

## Upgrade from 0.1

On first load of the new version:

1. If the workspace note exists, use it.
2. If not, write `System/Home Base.md` from the 0.1 settings (folders, apps, aliases, colors) plus the
   defaults above, show a notice saying so, and open the note once.
3. Remove the old keys from the plugin settings, keeping only the note path and "open on startup".

The plugin doesn't change any task, meeting or log note.

Merging ops jobs into tasks is a vault change, done once by Claude in `tyoung560/obsidian` when
this version is released: move the `Ops/` notes into `Tasks/`, change `type: ops` to `type: task`
with `work: ops`, update the Ops template, the Templater scripts, `Tasks.base` and CLAUDE.md. The
0.1 plugin still treats `type: ops` specially, so this has to land with the new plugin version, not
before.

## Polish and workflow (the pass after the schema)

From using 0.1 on desktop:

- Show the capture hint only while the box has focus.
- Hide empty Home sections, or collapse them to one line, instead of showing an empty box.
- Show "Mark done" on hover on desktop; keep the swipe on the phone.
- Make the spaces summary count by meaning, so it says something when everything is new.
- Drop the second "Review inbox" button when the next-step card already offers it.
- A context menu on every row and card (right-click, or long-press on the phone): status, due,
  space, open beside, open in new tab, copy link.
- Keyboard: `c` capture, `j`/`k` move between rows, `Enter` open, `e` status, `d` due, `x` done.
- Undo on every change, in the notice that confirms it.
- Rename an item and add or edit checklist lines from the sheet.
- Open notes in a split beside Home Base on desktop instead of a new tab.
- Hover a row with the modifier key for Obsidian's page preview.

These depend only on roles and meanings, so they work for any definition.

## Bases

Obsidian 1.10 lets plugins add view types to Bases (`registerBasesView`). Home Base would register
three: Board (columns from a property, drag to change it), Agenda (dated list), and Review (one card
at a time). In a `.base` file, someone picks the view and chooses the status and date properties in
its options; Bases supplies filtering, sorting and formulas.

This is a later phase. Home Base's own view stays the main surface, because the rail, capture,
review and the phone tab bar are what make it feel like an app, and Bases views live inside a
`.base` file's toolbar. Building the board and review as components that take a list of items
(not the whole index) now makes registering them as Bases views later a small step.

## Phases

1. **Definition and model.** Workspace schema, validation, the note and its loader, the migration,
   roles and meanings throughout the existing screens, the split of `view.ts`, the household test
   definition, ops merged into tasks (plugin and vault together). The UI looks the same apart from
   Ops becoming a saved filter; everything underneath reads the definition.
2. **Home sections and capture from the definition.** Home built from `home:`, filters, capture
   rules from types and spaces, the reading-view renderer for the block.
3. **Library.** Collections, the Library screen, `recent` and `pinned` on Home, `.base` sources.
4. **Polish and workflow.** The list above.
5. **Settings editor.** Edit spaces, statuses and types from the settings tab (writing the note),
   so the common changes don't need YAML.
6. **Bases views.** Board, agenda and review as Bases view types.

Each phase ships as its own release.

## Decisions

Settled in review on 2026-11-10:

1. **Source of truth for values:** the vault's CLAUDE.md. The workspace note mirrors it, CLAUDE.md
   tells Claude to change both together, and the plugin lists mismatches (see "Relationship to the
   vault's CLAUDE.md").
2. **Workspace note location:** `System/Home Base.md`.
3. **Ops jobs:** merged into the task type, with `work: ops` and an optional `repeat` (see "Tasks
   and ops jobs are one type").
4. **Quick fixes:** stay a `checklist` kind with their own screen, for now.
5. **Statuses:** one workflow for every `item` type, until a real need for two appears.
6. **Personal notes:** `Personal/` splits into subfolders by kind as it grows.
7. **The vault's CLAUDE.md:** says the vault also holds recipes, links, personal notes and app
   wiki pages, which Claude keeps as notes and doesn't sort into tasks. Done in
   `tyoung560/obsidian` alongside this review.

## Open questions

1. **Quick fixes from anywhere.** Should the Quick fixes screen also collect unticked checkboxes
   from other notes (for example a task's checklist, or a line in the inbox), or only from
   `quick-list` notes as now?
2. **Promoting a quick fix.** Turning one checkbox into a task from its row (creating the note and
   ticking or linking the line) would bridge the two. Worth adding in the polish phase?
3. **The `work` property name and values.** `work: ops` reads naturally next to the old type. An
   alternative is `kind: admin` or a `code: false` flag. Any preference before notes are migrated?
