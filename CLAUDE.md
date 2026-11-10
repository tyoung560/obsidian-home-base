# CLAUDE.md

Home Base is an Obsidian plugin (TypeScript, esbuild, no UI framework) that reads and writes the
notes in a vault, `tyoung560/obsidian` for its author. It knows nothing about a vault's note types,
statuses or property names: those come from the workspace note's `homebase` block, validated into
the types in `src/workspace/schema.ts`. `docs/design.md` explains the format and the reasoning.

## Layout

```
src/workspace/schema.ts    the workspace definition's types, meanings and role defaults
src/workspace/validate.ts  the homebase block to a Workspace, with every problem and its path
src/workspace/migrate.ts   the first workspace note, from 0.1 settings or a plain default
src/workspace/store.ts     loads and watches the workspace note, keeps the last good definition
src/model/items.ts         notes to items, meetings, journals and checklists, through roles
src/model/filter.ts        `where` filters and sorting
src/model/capture.ts       quick-capture parsing from the workspace
src/model/actions.ts       what each action writes, as frontmatter patches
src/parse.ts               dates, intervals, note bodies, templates
src/vault.ts               VaultIndex: reads notes, refreshes on changes, and every write
src/view.ts                HomeBaseView: navigation, rows, cards, overlay routing
src/screens.ts             every screen
src/sheets.ts              capture, item and meeting detail, review
src/ui.ts                  DOM helpers and shared chips and sections
src/settings.ts            settings and the settings tab
src/main.ts                plugin entry: store, index, view, commands, events
test/fixtures/             two workspace notes the tests and harness use
styles.css                 all styles; only Obsidian theme variables, no fixed colors except space dots
harness/                   browser harness with a stand-in for the Obsidian API (dev only)
docs/design.md             the workspace design; read it before changing the schema
```

## Rules

- The vault is the database. Never store task data in plugin settings or local storage.
- Write frontmatter only through `app.fileManager.processFrontMatter`, and bodies only through
  `app.vault.process` with a pure function from `parse.ts`. Change the smallest part of the note.
- Never name a property, status value or heading in plugin code. Read it from the workspace: a
  role (`item.due`, `type.fields.due`) or a meaning (`status.meaning === "doing"`).
- Keep logic that doesn't need Obsidian in `parse.ts`, `model/` or `workspace/`, with a test. Test
  behavior against both fixtures (`test/fixtures/`): the author's vault and the household list.
- Use Obsidian's CSS variables so the plugin follows the user's theme, light and dark. Class names
  start with `hb-`. Obsidian styles every `button`, so override inside `.hb-root`.
- Build DOM with `createEl` and `setText`; never `innerHTML` with note content.
- Don't give a View or Plugin subclass a method or field named like an Obsidian internal, even
  one missing from `obsidian.d.ts`. `open`, `close`, `render` and `load` are taken: a method named
  `open` on the view replaced Obsidian's own, `onOpen` never ran, and 0.1.0 showed a blank page.
  The harness calls `view.open()` the way Obsidian does, so it catches this one.
- Mobile matters as much as desktop. The view switches to the narrow layout under 720px or on a
  phone (`.hb-narrow`). Check both in the harness before pushing.

## Commands

```bash
npm test
npm run build
node harness/build.mjs /home/user/obsidian              # then screenshot harness/out/index.html (?phone, ?dark)
node harness/build.mjs harness/fixtures/household household
```

Commit to the session's branch and open a PR to `main`. A merge to `main` publishes a release
when the version in `manifest.json`, `package.json` and `versions.json` is new, so bump all three
in any PR that should reach BRAT users.
