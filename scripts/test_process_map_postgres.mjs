import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { appendFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const backendDir = join(repoRoot, "backend");
const adminHost = "127.0.0.1";
const testPattern = "^TestPostgres(MyWork|ActionItem|Huddle|RetiredRACITabs|ProcessSteps|ProcessMap|ObsoleteOperationalTables|CompanyMembershipProcessMap|PendingInvitationDowngradeInvalidatesGlobalDevAdmin)";

function postgresBinary(name) {
  const suffix = process.platform === "win32" ? ".exe" : "";
  const configured = process.env.POSTGRES_BIN?.trim();
  const candidates = [
    configured && join(configured, `${name}${suffix}`),
    process.platform === "win32" && `C:\\Program Files\\PostgreSQL\\18\\bin\\${name}.exe`,
    process.platform === "win32" && `C:\\Program Files\\PostgreSQL\\17\\bin\\${name}.exe`,
  ].filter(Boolean);
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  const lookup = spawnSync(
    process.platform === "win32" ? "where.exe" : "sh",
    process.platform === "win32" ? [name] : ["-c", `command -v ${name}`],
    { encoding: "utf8" },
  );
  const found = lookup.status === 0 ? lookup.stdout.trim().split(/\r?\n/)[0] : "";
  if (!found) throw new Error(`PostgreSQL executable ${name} was not found; set POSTGRES_BIN`);
  return found;
}

async function unusedLocalPort() {
  const socket = createServer();
  await new Promise((accept, reject) => socket.listen(0, "0.0.0.0", (error) => error ? reject(error) : accept()));
  const port = socket.address().port;
  await new Promise((accept) => socket.close(accept));
  return port;
}

function windowsWSLNetwork() {
  if (process.platform !== "win32") return null;
  const route = execFileSync("wsl.exe", ["--distribution", "Ubuntu", "--exec", "ip", "route", "show", "default"], { encoding: "utf8" });
  const gateway = route.match(/\bvia\s+(\d+\.\d+\.\d+\.\d+)\b/)?.[1];
  const addresses = execFileSync("wsl.exe", ["--distribution", "Ubuntu", "--exec", "hostname", "-I"], { encoding: "utf8" });
  const client = addresses.match(/\b(\d+\.\d+\.\d+\.\d+)\b/)?.[1];
  if (!gateway || !client) throw new Error("could not resolve the private Windows/WSL test network");
  return { gateway, client };
}

function runPostgresCommand(binary, args, options = {}) {
  return execFileSync(binary, args, { encoding: "utf8", ...options });
}

const psql = postgresBinary("psql");
const external = Boolean(process.env.PROCESS_MAP_POSTGRES17_HOST?.trim());
const initdb = external ? null : postgresBinary("initdb");
const pgCtl = external ? null : postgresBinary("pg_ctl");
const root = external ? null : mkdtempSync(join(tmpdir(), "mangorts-process-map-pg-"));
const data = root && join(root, "data");
const log = root && join(root, "postgres.log");
const host = process.env.PROCESS_MAP_POSTGRES17_HOST?.trim() || adminHost;
const port = external ? Number(process.env.PROCESS_MAP_POSTGRES17_PORT || 5432) : await unusedLocalPort();
const database = process.env.PROCESS_MAP_POSTGRES17_DATABASE?.trim() || "mangorts_process_map_test_gate";
const user = process.env.PROCESS_MAP_POSTGRES17_USER?.trim() || "postgres";
const password = process.env.PROCESS_MAP_POSTGRES17_PASSWORD || process.env.PGPASSWORD || "";
const wslNetwork = external ? null : windowsWSLNetwork();
const testHost = external ? host : wslNetwork?.gateway ?? host;
const listenAddresses = wslNetwork ? `${adminHost},${wslNetwork.gateway}` : adminHost;
const postgresEnv = { ...process.env, PGCONNECT_TIMEOUT: "5", PGPASSWORD: password };
const credentials = password
  ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}`
  : encodeURIComponent(user);
const dsn = `postgresql://${credentials}@${testHost}:${port}/${database}?sslmode=disable`;
let started = false;

try {
  if (!external) {
    runPostgresCommand(initdb, ["-D", data, "-A", "trust", "-U", user, "--no-locale"], { stdio: "pipe" });
    if (wslNetwork) {
      appendFileSync(join(data, "pg_hba.conf"), `\nhost all all ${wslNetwork.client}/32 trust\n`, "utf8");
    }
    runPostgresCommand(pgCtl, ["-D", data, "-l", log, "-o", `-p ${port} -h ${listenAddresses}`, "-w", "start"], { stdio: "ignore" });
    started = true;
  }

  const version = Number(runPostgresCommand(psql, [
    "-X", "-t", "-A", "-h", host, "-p", String(port), "-U", user, "-d", external ? database : "postgres",
    "-v", "ON_ERROR_STOP=1", "-c", "show server_version_num",
  ], { env: postgresEnv }).trim());
  if (version < 170000 || version >= 190000) {
    throw new Error(`unsupported disposable PostgreSQL version ${version}`);
  }
  if (!external) {
    runPostgresCommand(psql, [
      "-X", "-h", host, "-p", String(port), "-U", user, "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-c", `create database ${database}`,
    ], { env: postgresEnv, stdio: "pipe" });
  }

  console.log(`Running Process Map PostgreSQL integration tests on isolated PostgreSQL ${version}`);
  if (process.platform === "win32") {
    execFileSync("wsl.exe", [
      "--distribution", "Ubuntu",
      "--cd", backendDir,
      "--exec", "/usr/bin/env",
      `MANGORTS_MIGRATION_RUNNER_TEST_DATABASE_URL=${dsn}`,
      "MANGORTS_MIGRATION_RUNNER_TEST_RESET_ACK=DROP_DISPOSABLE_SCHEMA",
      `MANGORTS_MIGRATION_RUNNER_TEST_PRIVATE_HOST_ACK=${testHost}`,
      "/usr/local/go/bin/go", "test", "./cmd/miraeopus-migrate", "-run", "^TestMigrationRunnerPostgresAtomicityAndSupersession$", "-count=1",
    ], { cwd: repoRoot, stdio: "inherit" });
    execFileSync("wsl.exe", [
      "--distribution", "Ubuntu",
      "--cd", backendDir,
      "--exec", "/usr/bin/env",
      `MANGORTS_PROCESS_MAP_TEST_DATABASE_URL=${dsn}`,
      "MANGORTS_PROCESS_MAP_TEST_RESET_ACK=DROP_DISPOSABLE_SCHEMA",
      `MANGORTS_PROCESS_MAP_TEST_PRIVATE_HOST_ACK=${testHost}`,
      "/usr/local/go/bin/go", "test", "./internal/store", "-run", testPattern, "-count=1",
    ], { cwd: repoRoot, stdio: "inherit" });
  } else {
    execFileSync("go", ["test", "./cmd/miraeopus-migrate", "-run", "^TestMigrationRunnerPostgresAtomicityAndSupersession$", "-count=1"], {
      cwd: backendDir,
      stdio: "inherit",
      env: {
        ...process.env,
        MANGORTS_MIGRATION_RUNNER_TEST_DATABASE_URL: dsn,
        MANGORTS_MIGRATION_RUNNER_TEST_RESET_ACK: "DROP_DISPOSABLE_SCHEMA",
        MANGORTS_MIGRATION_RUNNER_TEST_PRIVATE_HOST_ACK: testHost,
      },
    });
    execFileSync("go", ["test", "./internal/store", "-run", testPattern, "-count=1"], {
      cwd: backendDir,
      stdio: "inherit",
      env: {
        ...process.env,
        MANGORTS_PROCESS_MAP_TEST_DATABASE_URL: dsn,
        MANGORTS_PROCESS_MAP_TEST_RESET_ACK: "DROP_DISPOSABLE_SCHEMA",
        MANGORTS_PROCESS_MAP_TEST_PRIVATE_HOST_ACK: testHost,
      },
    });
  }
  console.log("Process Map disposable PostgreSQL gate passed.");
} finally {
  if (started) {
    spawnSync(pgCtl, ["-D", data, "-m", "fast", "-w", "stop"], { encoding: "utf8" });
  }
  if (root) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
