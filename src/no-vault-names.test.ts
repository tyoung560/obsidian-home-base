import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The plugin reads every property, status and type name from the workspace note. These names
 * belong to one vault; seeing one in plugin code means a screen assumes that vault again.
 * workspace/migrate.ts is exempt: writing the 0.1 user's first workspace note is its job.
 */
const FORBIDDEN = ['"inbox"', '"ready"', '"in-progress"', '"blocked"', '"ops"', '"quick-list"', '"SpotDME"', '"Global Distributors"', "fm.app", "fm.status", "fm.due", ".last_done"];
const EXEMPT = new Set(["workspace/migrate.ts"]);

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
  });
}

describe("plugin code", () => {
  it("names no vault-specific property, status or type", () => {
    const src = path.join(__dirname);
    const hits = files(src).flatMap((f) => {
      const rel = path.relative(src, f).split(path.sep).join("/");
      if (EXEMPT.has(rel)) return [];
      return fs.readFileSync(f, "utf8").split("\n").flatMap((line, i) => line.includes("icon(") ? [] : FORBIDDEN.filter((w) => line.includes(w)).map((w) => `${rel}:${i + 1} ${w}`));
    });
    expect(hits).toEqual([]);
  });
});
