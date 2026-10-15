import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const source = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const installed = process.env.ZCODE_PLUGIN_INSTALL_DIR;
if (!installed) throw new Error("Run pnpm build from the repository root");
await rm(join(installed, "ui/dist"), { recursive: true, force: true });
await mkdir(join(installed, "ui/dist"), { recursive: true });
await cp(join(source, "ui/dist/panel.html"), join(installed, "ui/dist/panel.html"));
await rm(join(installed, "blender"), { recursive: true, force: true });
await cp(join(source, "blender"), join(installed, "blender"), {
  recursive: true,
  filter: (path) => !relative(source, path).split(/[\\/]/).includes("__pycache__"),
});
