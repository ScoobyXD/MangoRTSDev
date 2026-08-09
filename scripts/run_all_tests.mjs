import { execFileSync, execSync } from "node:child_process";
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

function runBackendGoTests() {
  const backendDir = resolve(repoRoot, "backend");
  if (process.platform !== "win32") {
    run("Backend Go tests", "go test ./...", backendDir);
    return;
  }

  console.log("\n=== Backend Go tests (WSL2 Ubuntu) ===");
  execFileSync(
    "wsl.exe",
    [
      "--distribution",
      "Ubuntu",
      "--cd",
      backendDir,
      "--exec",
      "/usr/local/go/bin/go",
      "test",
      "./...",
    ],
    { cwd: repoRoot, stdio: "inherit" },
  );
}

run("Frontend relationship semantics tests", "npm run test:node-relationships", resolve(repoRoot, "frontend"));
run("Frontend production build", "npm run build", resolve(repoRoot, "frontend"));
run("Email SQS disposable PostgreSQL contract", "node scripts/test_email_sqs_delivery_postgres.mjs", repoRoot);
run("Node email relationship disposable PostgreSQL contract", "node scripts/test_node_email_relationships_postgres.mjs", repoRoot);
runBackendGoTests();
run("Infrastructure contract tests", "node --test infra/tests/attachment_direct_upload.test.mjs infra/tests/ci_workflow.test.mjs infra/tests/email_sqs.test.mjs infra/tests/valkey_realtime.test.mjs", repoRoot);

console.log("\nAll test suites passed.");
