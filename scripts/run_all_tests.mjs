import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const defaultGoCache = resolve(repoRoot, "backend", "go-build-cache");

function run(step, command, cwd) {
  console.log(`\n=== ${step} ===`);
  execSync(command, {
    cwd,
    stdio: "inherit",
    // Keep Go's build cache in the repo on restricted Windows sandboxes; the path is gitignored.
    env: { ...process.env, GOCACHE: process.env.GOCACHE ?? defaultGoCache },
  });
}

run("Frontend relationship semantics tests", "npm run test:node-relationships", resolve(repoRoot, "frontend"));
run("Node v2 PostgreSQL-backed Yjs durability proof", "npm run test:node-v2-yjs-poc", resolve(repoRoot, "frontend"));
run("Node v2 Phase 2 executable frontend coverage", "npm run test:node-v2-phase2", resolve(repoRoot, "frontend"));
run("Mango legacy HTML to Tiptap JSON converter", "npm run test:mango-html-to-json", resolve(repoRoot, "frontend"));
run("Frontend production build", "npm run build", resolve(repoRoot, "frontend"));
run("Backend Go tests", "go test ./...", resolve(repoRoot, "backend"));
run("Realtime production-path PostgreSQL and browser tests", "node scripts/run_realtime_production_path_tests.mjs", repoRoot);
run("Infrastructure contract tests", "node --test infra/tests/attachment_direct_upload.test.mjs infra/tests/ci_workflow.test.mjs", repoRoot);

console.log("\nAll test suites passed.");
