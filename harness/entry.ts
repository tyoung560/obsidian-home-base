import { makeApp } from "./obsidian-shim";
import HomeBasePlugin from "../src/main";

declare const VAULT: Record<string, string>;

(async () => {
  const app = makeApp(VAULT);
  const plugin = new HomeBasePlugin(app, { id: "home-base" });
  await plugin.onload();
  for (const cb of app.workspace.ready) await cb();
  await plugin.activate();
  (window as any).HB = { app, plugin };
  document.body.dataset.ready = "1";
})();
