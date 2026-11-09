# Home Base

An Obsidian plugin that turns a vault's notes into a task and project workspace: Home, a board,
quick capture, inbox review, ops jobs, meetings and daily logs. Every change writes to a markdown
note, so the vault stays the database and nothing is stored anywhere else.

It works on desktop and on phones. On a phone, or in a narrow pane, it switches to a bottom tab
bar, bottom sheets and swipe actions.

## What it reads

Notes with a `type` property in their frontmatter:

| `type` | Shown in | Fields used |
|---|---|---|
| `task` | Home, Board, Upcoming | `app`, `status`, `area`, `due`, `issue`, `pr`, `source`, `created` |
| `ops` | Home, Ops, Upcoming | `app`, `status`, `due`, `repeat`, `last_done` |
| `meeting` | Meetings | `app`, `created`, `attendees` |
| `log` | Daily log | `created` |
| `quick-list` | Quick fixes | `app` |

`status` is one of `inbox`, `ready`, `in-progress`, `blocked`, `done`, `dropped`.

From note bodies it reads:

- the first paragraph under the `# Title` line, as the summary
- the checklist under `## Work` (tasks) or `## Steps` (ops)
- whether `## Open questions` has anything in it
- `## Decisions`, `## Unresolved` and links under `## Items` in meetings
- `## Did`, `## Notes` and `## Next` in daily logs

Notes in the templates folder are skipped.

## What it writes

- Status, due date, `last_done`: frontmatter only, through Obsidian's `processFrontMatter`.
- Checkboxes: the one line that was ticked.
- Capture: a new note in the tasks or ops folder, with `status: inbox`.
- Daily log lines: appended to today's `Logs/YYYY-MM-DD.md`, created if missing.
- Mark done on an ops job with a `repeat` (for example `90 days` or `yearly`): sets `last_done`
  to today, moves `due` forward by the interval and unticks the steps. Without a `repeat`, it
  sets `status: done`.

## Quick capture

Type `gd vendor remittance email due fri` and press Enter.

- The first word picks the app when it matches an alias (`spot`, `gd`, `sylo`, `me` by
  default). `@alias` works anywhere in the line.
- `ops` as the first word after the app makes an ops job.
- `due today`, `due tomorrow`, `due fri`, `due next week`, `due 11/20` or `due 2026-11-20` sets
  the due date.

On a phone, the capture sheet has one-tap chips for the app, the kind and the due date.

## Commands

- **Home Base: Open**
- **Home Base: Capture a task**
- **Home Base: Review inbox**
- **Home Base: Open today's log note**

## Settings

Folders for tasks, ops, logs and templates; open on startup; and the list of apps with their
short label, capture aliases and color.

## Install with BRAT

1. Install the BRAT community plugin.
2. BRAT: Add a beta plugin, then enter `tyoung560/obsidian-home-base`.
3. Enable Home Base under Community plugins.

## Development

```bash
npm install
npm run dev        # rebuilds main.js on change
npm test           # unit tests for parsing, dates and templates
npm run build      # typecheck and production build
```

Copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/home-base/` to try a build.

### Harness

`harness/` runs the plugin in a browser against a copy of a vault folder, with a small stand-in
for the Obsidian API. Use it to check layouts and writes without Obsidian:

```bash
node harness/build.mjs /path/to/vault
```

Then open `harness/out/index.html`. Add `?phone` for the phone layout and `?dark` for the dark
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
