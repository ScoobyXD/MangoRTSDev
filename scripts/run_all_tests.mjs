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
run("Email draft scope disposable PostgreSQL contract", "node scripts/test_email_draft_scope_postgres.mjs", repoRoot);
run("RACI Tabs disposable PostgreSQL contract", "node scripts/test_raci_tabs_postgres.mjs", repoRoot);
run("Huddle Explorer disposable PostgreSQL contract", "node scripts/test_huddle_explorer_postgres.mjs", repoRoot);
run("Process Map disposable PostgreSQL gate", "node scripts/test_process_map_postgres.mjs", repoRoot);
run("QA Dev-copy disposable PostgreSQL contract", "node scripts/test_qa_dev_copy_postgres.mjs", repoRoot);
run(
  "Schema inventory comparator tests",
  `${process.platform === "win32" ? "python" : "python3"} -m unittest tests.scripts.test_compare_schema_inventory tests.scripts.test_prepare_prod_db_schema_copy tests.scripts.test_qa_dev_copy_sql_contracts tests.scripts.test_sanitize_pg_dump_schema tests.scripts.test_schema_alignment_contracts`,
  repoRoot,
);
runBackendGoTests();
run("Infrastructure contract tests", "node --test infra/tests/attachment_direct_upload.test.mjs infra/tests/ci_workflow.test.mjs infra/tests/email_sqs.test.mjs infra/tests/qa_environment.test.mjs infra/tests/valkey_realtime.test.mjs", repoRoot);

console.log("\nAll test suites passed.");
