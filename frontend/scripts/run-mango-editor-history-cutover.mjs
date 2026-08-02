import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const frontendRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temporaryDirectory = mkdtempSync(join(tmpdir(), "mangorts-editor-history-cutover-"));
const output = join(temporaryDirectory, "cutover.mjs");

try {
  buildSync({
    entryPoints: [resolve(frontendRoot, "scripts/mango-editor-history-cutover.ts")],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    banner: { js: 'import { createRequire as __mangoCreateRequire } from "node:module"; const require = __mangoCreateRequire(import.meta.url);' },
    target: "node20",
    sourcemap: false,
  });
  const result = spawnSync(process.execPath, [output, ...process.argv.slice(2)], {
    cwd: frontendRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
