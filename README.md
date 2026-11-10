# Home Base

An Obsidian plugin that turns a vault's notes into a task and project workspace: Home, a board,
quick capture, inbox review, ops jobs, meetings and daily logs. Every change writes to a markdown
note, so the vault stays the database and nothing is stored anywhere else.

It works on desktop and on phones. On a phone, or in a narrow pane, it switches to a bottom tab
bar, bottom sheets and swipe actions.

## The workspace note

Home Base has no built-in note types, statuses or property names. It reads them from a
**workspace note** in the vault, `System/Home Base.md` by default, in a fenced code block with the
language `homebase`. Saving the note applies the change straight away. If the block has a problem,
Home Base shows it and keeps using the last version that worked.

The definition names:

- **space**: the property that splits the vault into areas (`app`, `project`, `client`) and its
  values, each with a label, color and capture aliases
- **workflow**: the statuses in order, each with a meaning: `new`, `todo`, `doing`, `waiting` or
  `closed`. Screens use meanings, so any status names work.
- **types**: how to recognise each kind of note (a property value, a folder, or both), where new
  ones go, the template, and which properties and headings hold the due date, recurrence,
  checklist and so on. Kinds are `item` (has a status), `meeting`, `journal` (one note per day)
  and `checklist` (quick fixes).
- **filters**: saved filters; one with `rail: true` gets its own screen
- **home**: the Home screen's sections, in order
- **capture.flags**: words that set a property when typed in capture

`test/fixtures/` has two complete examples: the author's vault and a household list that uses
different names for everything. The full format, with the reasoning behind it, is in
[docs/design.md](docs/design.md).

On first run with no workspace note, Home Base writes one, from the 0.1 settings if they exist.
It never overwrites an existing note. The settings tab lists notes whose type, status or space
value isn't in the definition.

## What it writes

- Status, due date, last done: frontmatter only, through Obsidian's `processFrontMatter`, using
  the property names the workspace maps them to.
- Checkboxes: the one line that was ticked.
- Capture: a new note in the type's folder, from its template when it has one. `{{title}}` and
  `{{date}}` or `{{date:YYYY-MM-DD}}` are filled in, then the type, space, first status, due date
  and created date are set.
- Journal lines: appended to today's journal note, created if missing.
- Mark done on an item with a repeat interval (`90 days`, `2 weeks`, `monthly`, `yearly`): sets
  last done, moves the due date forward and unticks the checklist. Without one, it sets the first
  closed status.

## Quick capture

Type `gd vendor remittance email due fri` and press Enter.

- The first word picks the space when it matches an alias from the workspace. `@alias` works
  anywhere in the line.
- A type's id or label right after the space, or `#id` anywhere, picks the type when the
  workspace has more than one item type.
- A capture flag word right after the space, or `#flag` anywhere, sets its properties.
- `due today`, `due tomorrow`, `due fri`, `due next week`, `due 11/20` or `due 2026-11-20` sets
  the due date.

On a phone, the capture sheet has one-tap chips for the space, the type and the due date.

## Commands

- **Home Base: Open**
- **Home Base: Capture a task**
- **Home Base: Review inbox**
- **Home Base: Open today's journal note**
- **Home Base: Open the workspace note**

## Settings

The workspace note's path, open on startup, the workspace's problems if it has any, and the notes
that don't match it. Everything else is in the workspace note.

## Install with BRAT

1. Install the BRAT community plugin.
2. BRAT: Add a beta plugin, then enter `tyoung560/obsidian-home-base`.
3. Enable Home Base under Community plugins.

## Development

```bash
npm install
npm run dev        # rebuilds main.js on change
npm test           # unit tests: parsing, the workspace definition, model and actions
npm run build      # typecheck and production build
```

Copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/home-base/` to try a build.

### Harness

`harness/` runs the plugin in a browser against a copy of a vault folder, with a small stand-in
for the Obsidian API. Use it to check layouts and writes without Obsidian:

```bash
node harness/build.mjs /path/to/vault
node harness/build.mjs harness/fixtures/household household
```

Then open `harness/out/index.html` or `harness/out/household.html`. Add `?phone` for the phone layout and `?dark` for the dark
theme. Writes go to an in-memory copy; the vault folder is never changed. The page exposes
`window.HB.app.vault.files` so a test can read what was written.

## Release

Every push to `main` builds and tests the plugin. When `manifest.json` has a version with no
release yet, the release workflow publishes one, tagged with the bare version (for example
`0.1.1`), with `main.js`, `manifest.json` and `styles.css` attached. BRAT installs and updates
from those releases.

To ship a change, bump `version` in `manifest.json`, `package.json` and `versions.json` (the
workflow fails if they disagree), then merge to `main`. Pushing to `main` without a version bump
builds and tests but publishes nothing. You can also run the workflow by hand from the Actions tab.
