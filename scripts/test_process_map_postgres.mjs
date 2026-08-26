import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { appendFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const backendDir = join(repoRoot, "backend");
const database = "mangorts_process_map_test_gate";
const adminHost = "127.0.0.1";
const user = "postgres";
const testPattern = "^TestPostgres(ProcessMap|CompanyMembershipProcessMap|PendingInvitationDowngradeInvalidatesGlobalDevAdmin)";

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

const initdb = postgresBinary("initdb");
const pgCtl = postgresBinary("pg_ctl");
const psql = postgresBinary("psql");
const root = mkdtempSync(join(tmpdir(), "mangorts-process-map-pg-"));
const data = join(root, "data");
const log = join(root, "postgres.log");
const port = await unusedLocalPort();
const wslNetwork = windowsWSLNetwork();
const testHost = wslNetwork?.gateway ?? adminHost;
const listenAddresses = wslNetwork ? `${adminHost},${wslNetwork.gateway}` : adminHost;
const postgresEnv = { ...process.env, PGCONNECT_TIMEOUT: "5", PGPASSWORD: "" };
const dsn = `postgresql://${user}@${testHost}:${port}/${database}?sslmode=disable`;
let started = false;

try {
  runPostgresCommand(initdb, ["-D", data, "-A", "trust", "-U", user, "--no-locale"], { stdio: "pipe" });
  if (wslNetwork) {
    appendFileSync(join(data, "pg_hba.conf"), `\nhost all all ${wslNetwork.client}/32 trust\n`, "utf8");
  }
  runPostgresCommand(pgCtl, ["-D", data, "-l", log, "-o", `-p ${port} -h ${listenAddresses}`, "-w", "start"], { stdio: "ignore" });
  started = true;

  const version = Number(runPostgresCommand(psql, [
    "-X", "-t", "-A", "-h", adminHost, "-p", String(port), "-U", user, "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-c", "show server_version_num",
  ], { env: postgresEnv }).trim());
  if (version < 170000 || version >= 190000) {
    throw new Error(`unsupported disposable PostgreSQL version ${version}`);
  }
  runPostgresCommand(psql, [
    "-X", "-h", adminHost, "-p", String(port), "-U", user, "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-c", `create database ${database}`,
  ], { env: postgresEnv, stdio: "pipe" });

  console.log(`Running Process Map PostgreSQL integration tests on isolated PostgreSQL ${version}`);
  if (process.platform === "win32") {
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
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
