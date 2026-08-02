import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const frontendRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temporaryDirectory = mkdtempSync(join(tmpdir(), "mangorts-html-to-json-test-"));
const testOutput = join(temporaryDirectory, "converter.test.mjs");
const backfillOutput = join(temporaryDirectory, "v3-node-textbox-backfill.mjs");

try {
  buildSync({
    entryPoints: [resolve(frontendRoot, "scripts/mango-html-to-json.test.ts")],
    outfile: testOutput,
    bundle: true,
    platform: "node",
    format: "esm",
    banner: { js: 'import { createRequire as __mangoCreateRequire } from "node:module"; const require = __mangoCreateRequire(import.meta.url);' },
    target: "node20",
    sourcemap: false,
  });
  buildSync({
    entryPoints: [resolve(frontendRoot, "scripts/v3-node-textbox-backfill.ts")],
    outfile: backfillOutput,
    bundle: true,
    platform: "node",
    format: "esm",
    banner: { js: 'import { createRequire as __mangoCreateRequire } from "node:module"; const require = __mangoCreateRequire(import.meta.url);' },
    target: "node20",
    sourcemap: false,
  });
  const result = spawnSync(process.execPath, ["--test", testOutput], { cwd: frontendRoot, stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
