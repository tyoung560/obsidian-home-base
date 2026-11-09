# CLAUDE.md

Home Base is an Obsidian plugin (TypeScript, esbuild, no UI framework) that reads and writes the
notes in `tyoung560/obsidian`. That vault's `CLAUDE.md` is the schema: note types, folders and
frontmatter properties. When the vault schema changes, change `src/schema.ts`, `src/parse.ts`
and the README's tables to match.

## Layout

```
src/schema.ts     types and constants for the vault schema
src/parse.ts      pure functions: capture parsing, dates, repeat intervals, note bodies, templates
src/parse.test.ts unit tests (Vitest) for parse.ts
src/vault.ts      VaultIndex: reads notes, refreshes on vault changes, and every write
src/view.ts       HomeBaseView: every screen, wide and narrow layouts, sheets, review
src/settings.ts   settings and the settings tab
src/main.ts       plugin entry: view, commands, events
styles.css        all styles; only Obsidian theme variables, no fixed colors except app dots
harness/          browser harness with a stand-in for the Obsidian API (dev only)
```

## Rules

- The vault is the database. Never store task data in plugin settings or local storage.
- Write frontmatter only through `app.fileManager.processFrontMatter`, and bodies only through
  `app.vault.process` with a pure function from `parse.ts`. Change the smallest part of the note.
- Keep logic that doesn't need Obsidian in `parse.ts`, with a test.
- Use Obsidian's CSS variables so the plugin follows the user's theme, light and dark. Class names
  start with `hb-`. Obsidian styles every `button`, so override inside `.hb-root`.
- Build DOM with `createEl` and `setText`; never `innerHTML` with note content.
- Mobile matters as much as desktop. The view switches to the narrow layout under 720px or on a
  phone (`.hb-narrow`). Check both in the harness before pushing.

## Commands

```bash
npm test
npm run build
node harness/build.mjs /home/user/obsidian   # then screenshot harness/out/index.html (?phone, ?dark)
```

Commit to the session's branch and open a PR to `main`. Tag a version to release.
