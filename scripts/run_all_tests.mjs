import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const defaultGoCache = resolve(repoRoot, "backend", "go-build-cache");
const powerShell =
  process.platform === "win32"
    ? `"${resolve(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")}"`
    : "pwsh";

function run(step, command, cwd) {
  console.log(`\n=== ${step} ===`);
  execSync(command, {
    cwd,
    stdio: "inherit",
    // Keep Go's build cache in the repo on restricted Windows sandboxes; the path is gitignored.
    env: { ...process.env, GOCACHE: process.env.GOCACHE ?? defaultGoCache },
  });
}

for (const suite of ["unit", "allocator", "scope", "hook", "installer"]) {
  run(
    `Codex app worktree naming ${suite} tests`,
    `${powerShell} -NoLogo -NoProfile -ExecutionPolicy Bypass -File scripts/codex/mango_worktree_naming.${suite}.test.ps1`,
    repoRoot,
  );
}
run("Frontend relationship semantics tests", "npm run test:node-relationships", resolve(repoRoot, "frontend"));
run("Frontend production build", "npm run build", resolve(repoRoot, "frontend"));
run("Backend Go tests", "go test ./...", resolve(repoRoot, "backend"));
run("Infrastructure attachment contract tests", "node --test infra/tests/attachment_direct_upload.test.mjs", repoRoot);

console.log("\nAll test suites passed.");
