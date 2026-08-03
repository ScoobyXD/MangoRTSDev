import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dir = mkdtempSync(join(tmpdir(), "mangorts-v3-preflight-"));
const output = join(dir, "preflight.mjs");
try {
  buildSync({ entryPoints: [resolve(root, "scripts/v3-cutover-preflight.ts")], outfile: output, bundle: true, platform: "node", format: "esm", target: "node20", banner: { js: 'import { createRequire as r } from "node:module"; const require=r(import.meta.url);' } });
  const result = spawnSync(process.execPath, [output], { cwd: root, env: process.env, stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally { rmSync(dir, { recursive: true, force: true }); }
