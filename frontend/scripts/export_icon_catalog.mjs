import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const frontendDir = resolve(scriptsDir, "..");
const repositoryDir = resolve(frontendDir, "..");
const bundlePath = resolve(frontendDir, ".mangorts-export-icon-catalog.cjs");

try {
  await build({
    entryPoints: [resolve(scriptsDir, "export_icon_catalog.tsx")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: bundlePath,
    logLevel: "warning",
  });
  const result = spawnSync(process.execPath, [bundlePath], {
    cwd: repositoryDir,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  rmSync(bundlePath, { force: true });
}