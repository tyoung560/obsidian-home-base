import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { extractBlock, validateWorkspace } from "../src/workspace/validate";
import type { Workspace } from "../src/workspace/schema";

export function fixtureWorkspace(name: "vault" | "household"): Workspace {
  const note = fs.readFileSync(path.join(__dirname, "fixtures", `${name}-Home Base.md`), "utf8");
  const block = extractBlock(note);
  if (!block) throw new Error(`no homebase block in ${name}`);
  const r = validateWorkspace(parse(block));
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.workspace;
}
