import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const schema = join(repoRoot, "backend", "db", "schema.sql");

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

const psql = postgresBinary("psql");
const createdb = postgresBinary("createdb");
const dropdb = postgresBinary("dropdb");
const externalHost = process.env.QA_COPY_POSTGRES17_HOST?.trim()
  || process.env.EMAIL_SQS_POSTGRES17_HOST?.trim();
const external = Boolean(externalHost);
const initdb = external ? null : postgresBinary("initdb");
const pgCtl = external ? null : postgresBinary("pg_ctl");
const root = external ? null : mkdtempSync(join(tmpdir(), "mangorts-qa-copy-pg-"));
const data = root && join(root, "data");
const log = root && join(root, "postgres.log");
const host = externalHost || "127.0.0.1";
let port = Number(
  process.env.QA_COPY_POSTGRES17_PORT
  || process.env.EMAIL_SQS_POSTGRES17_PORT
  || 0,
);
if (!external) {
  const socket = createServer();
  await new Promise((accept, reject) => socket.listen(0, host, (error) => error ? reject(error) : accept()));
  port = socket.address().port;
  await new Promise((accept) => socket.close(accept));
}
const adminDatabase = process.env.QA_COPY_POSTGRES17_DATABASE?.trim()
  || process.env.EMAIL_SQS_POSTGRES17_DATABASE?.trim()
  || "postgres";
const user = process.env.QA_COPY_POSTGRES17_USER?.trim()
  || process.env.EMAIL_SQS_POSTGRES17_USER?.trim()
  || "postgres";
const password = process.env.QA_COPY_POSTGRES17_PASSWORD
  || process.env.EMAIL_SQS_POSTGRES17_PASSWORD
  || process.env.PGPASSWORD
  || "";
const database = `mangorts_qa_raw_20000101_contract_${process.pid}`;
const postgresEnv = { ...process.env, PGCONNECT_TIMEOUT: "5", PGPASSWORD: password };
let started = false;
let databaseCreated = false;

function run(binary, args, options = {}) {
  return execFileSync(binary, args, { encoding: "utf8", ...options });
}

function scalar(targetDatabase, statement) {
  const result = spawnSync(
    psql,
    ["-X", "-t", "-A", "-h", host, "-p", String(port), "-U", user, "-d", targetDatabase, "-v", "ON_ERROR_STOP=1", "-c", statement],
    { encoding: "utf8", timeout: 30_000, env: postgresEnv },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

function runFile(targetDatabase, path) {
  const result = spawnSync(
    psql,
    ["-X", "-h", host, "-p", String(port), "-U", user, "-d", targetDatabase, "-v", "ON_ERROR_STOP=1", "-f", path],
    { encoding: "utf8", timeout: 120_000, env: postgresEnv },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

try {
  if (!external) {
    run(initdb, ["-D", data, "-A", "trust", "-U", "postgres", "--no-locale"], { stdio: "pipe" });
    run(pgCtl, ["-D", data, "-l", log, "-o", `-p ${port} -h ${host}`, "-w", "start"], { stdio: "ignore" });
    started = true;
  }

  const version = Number(scalar(adminDatabase, "show server_version_num"));
  if (external && (version < 170000 || version >= 180000)) {
    throw new Error(`CI QA-copy service must be PostgreSQL 17.x, found server_version_num=${version}`);
  }
  if (!external && (version < 170000 || version >= 190000)) {
    throw new Error(`unsupported local disposable PostgreSQL version ${version}`);
  }

  run(
    createdb,
    ["-h", host, "-p", String(port), "-U", user, "--maintenance-db", adminDatabase, database],
    { env: postgresEnv, stdio: "pipe" },
  );
  databaseCreated = true;
  runFile(database, schema);
  scalar(database, "create table public.schema_migrations(version text primary key, applied_at timestamptz not null default now())");

  const authority = password
    ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}`
    : encodeURIComponent(user);
  const dsn = `postgresql://${authority}@${host}:${port}/${database}?sslmode=disable`;
  const python = process.platform === "win32" ? "python" : "python3";
  run(
    python,
    ["-m", "unittest", "-v", "tests.scripts.test_qa_dev_copy_sql_contracts.QADevCopyPostgresIntegration"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        MANGORTS_QA_COPY_TEST_DSN: dsn,
        MANGORTS_QA_COPY_TEST_PSQL: psql,
        MANGORTS_QA_COPY_TEST_ALLOW_PG18: version >= 180000 ? "1" : "0",
      },
      stdio: "inherit",
    },
  );
  console.log(`QA Dev-copy disposable PostgreSQL contract passed on server_version_num=${version}`);
} finally {
  if (databaseCreated) {
    spawnSync(
      dropdb,
      ["-h", host, "-p", String(port), "-U", user, "--maintenance-db", adminDatabase, database],
      { encoding: "utf8", timeout: 30_000, env: postgresEnv },
    );
  }
  if (started) spawnSync(pgCtl, ["-D", data, "-m", "fast", "-w", "stop"], { encoding: "utf8" });
  if (root) {
    const tempPrefix = resolve(tmpdir()) + sep;
    if (!resolve(root).startsWith(tempPrefix) || !basename(root).startsWith("mangorts-qa-copy-pg-")) {
      throw new Error(`refusing unexpected disposable PostgreSQL cleanup target: ${root}`);
    }
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
