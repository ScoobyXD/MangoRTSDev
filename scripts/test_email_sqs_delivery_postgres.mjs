import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const preflight = join(repoRoot, "scripts", "email_sqs_delivery_preflight.sql");
const apply = join(repoRoot, "scripts", "email_sqs_delivery_apply.sql");

function postgresBinary(name) {
  const suffix = process.platform === "win32" ? ".exe" : "";
  const configured = process.env.POSTGRES_BIN?.trim();
  const candidates = [
    configured && join(configured, `${name}${suffix}`),
    process.platform === "win32" && `C:\\Program Files\\PostgreSQL\\18\\bin\\${name}.exe`,
    process.platform === "win32" && `C:\\Program Files\\PostgreSQL\\17\\bin\\${name}.exe`,
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  const lookup = spawnSync(process.platform === "win32" ? "where.exe" : "sh", process.platform === "win32" ? [name] : ["-c", `command -v ${name}`], { encoding: "utf8" });
  const found = lookup.status === 0 ? lookup.stdout.trim().split(/\r?\n/)[0] : "";
  if (!found) throw new Error(`PostgreSQL executable ${name} was not found; set POSTGRES_BIN`);
  return found;
}

const psql = postgresBinary("psql");
const externalPostgres17 = Boolean(process.env.EMAIL_SQS_POSTGRES17_HOST?.trim());
const initdb = externalPostgres17 ? null : postgresBinary("initdb");
const pgCtl = externalPostgres17 ? null : postgresBinary("pg_ctl");
const root = externalPostgres17 ? null : mkdtempSync(join(tmpdir(), "mangorts-email-sqs-pg-"));
const data = root && join(root, "data");
const log = root && join(root, "postgres.log");
const host = process.env.EMAIL_SQS_POSTGRES17_HOST?.trim() || "127.0.0.1";
let port = Number(process.env.EMAIL_SQS_POSTGRES17_PORT || 0);
if (!externalPostgres17) {
	const socket = createServer();
	await new Promise((accept, reject) => socket.listen(0, host, (error) => error ? reject(error) : accept()));
	port = socket.address().port;
	await new Promise((accept) => socket.close(accept));
}
const database = process.env.EMAIL_SQS_POSTGRES17_DATABASE?.trim() || "postgres";
const user = process.env.EMAIL_SQS_POSTGRES17_USER?.trim() || "postgres";
const postgresEnv = {
	...process.env,
	PGCONNECT_TIMEOUT: "5",
	PGPASSWORD: process.env.EMAIL_SQS_POSTGRES17_PASSWORD || process.env.PGPASSWORD || "",
};
let started = false;

function run(binary, args, options = {}) {
  return execFileSync(binary, args, { encoding: "utf8", ...options });
}

function sql(statement, expectFailure = false) {
  const args = ["-X", "-h", host, "-p", String(port), "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1", "-c", statement];
  const result = spawnSync(psql, args, { encoding: "utf8", timeout: 15_000, env: postgresEnv });
	if (result.error) throw result.error;
  if (!expectFailure && result.status !== 0) throw new Error(result.stderr || result.stdout);
  if (expectFailure && result.status === 0) throw new Error("expected PostgreSQL command to fail");
  return `${result.stdout}\n${result.stderr}`;
}

function runFile(path, expectFailure = false) {
  const result = spawnSync(psql, ["-X", "-h", host, "-p", String(port), "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1", "-f", path], { encoding: "utf8", timeout: 15_000, env: postgresEnv });
	if (result.error) throw result.error;
  if (!expectFailure && result.status !== 0) throw new Error(result.stderr || result.stdout);
  if (expectFailure && result.status === 0) throw new Error(`expected ${path} to fail`);
  return `${result.stdout}\n${result.stderr}`;
}

const connectionColumns = [
  "status text", "email_connection_id uuid", "updated_timestamp timestamptz", "company_id uuid",
  "account_email text", "connection_type text", "personal_user_id uuid", "provider text", "grant_id text",
  "connected_by_user_id uuid", "ingestion_started_at timestamptz", "last_successful_scan_at timestamptz", "created_timestamp timestamptz",
];
const ingestionLegacy = [
  "status text", "provider_message_id text", "ingestion_job_id uuid", "updated_timestamp timestamptz", "company_id uuid",
  "email_connection_id uuid", "email_thread_id uuid", "provider_thread_id text", "priority smallint", "attempt_count integer",
  "last_error text", "available_at timestamptz", "processing_started_at timestamptz", "completed_timestamp timestamptz",
  "failed_timestamp timestamptz", "created_timestamp timestamptz",
];
const ingestionFinalAdditions = ["enqueue_source_id text", "attempt_token uuid", "provider_attempt_count integer"];
const archiveLegacy = [
  "status text", "message_id text", "job_item_id uuid", "archive_job_id uuid", "attempt_count integer", "last_error text",
  "available_at timestamptz", "processing_started_at timestamptz", "archived_timestamp timestamptz", "failed_timestamp timestamptz",
  "created_timestamp timestamptz", "updated_timestamp timestamptz",
];

function installShape({ final = false, ingestionFinal = final, archiveFinal = final, partial = false, extra = false, missing = false } = {}) {
  sql("drop schema public cascade; create schema public");
  const connections = [...connectionColumns];
  if (extra) connections.push("unexpected_column text");
  const ingestion = [...ingestionLegacy];
  if (ingestionFinal) ingestion.splice(4, 0, ...ingestionFinalAdditions);
  if (partial) ingestion.splice(4, 0, ingestionFinalAdditions[0]);
  if (missing) ingestion.splice(ingestion.findIndex((column) => column.startsWith("last_error ")), 1);
  const archive = [...archiveLegacy];
  if (archiveFinal) archive.splice(3, 0, "attempt_token uuid");
  sql(`create table email_connections (${connections.join(",")}); create table email_ingestion_jobs (${ingestion.join(",")}); create table communications_email_archive_job_items (${archive.join(",")})`);
}

function requireText(output, value, label) {
  if (!output.includes(value)) throw new Error(`${label}: missing ${JSON.stringify(value)}\n${output}`);
}

function shapeCounts() {
	return sql("select json_build_array((select count(*) from information_schema.columns where table_schema='public' and table_name='email_connections'),(select count(*) from information_schema.columns where table_schema='public' and table_name='email_ingestion_jobs'),(select count(*) from information_schema.columns where table_schema='public' and table_name='communications_email_archive_job_items'))::text").match(/\[\d+,\s*\d+,\s*\d+\]/)?.[0];
}

try {
	if (externalPostgres17) {
		console.log("using the disposable PostgreSQL 17 CI service");
	} else {
		console.log("initializing disposable local PostgreSQL");
		run(initdb, ["-D", data, "-A", "trust", "-U", "postgres", "--no-locale"], { stdio: "pipe" });
		// Ignore inherited stdio here: on Windows the postgres child keeps pipe
		// handles open after pg_ctl exits, which would make execFileSync wait forever.
		run(pgCtl, ["-D", data, "-l", log, "-o", `-p ${port} -h ${host}`, "-w", "start"], { stdio: "ignore" });
		started = true;
	}
  const version = Number(sql("show server_version_num").match(/\b(\d{6})\b/)?.[1]);
	if (externalPostgres17 && (version < 170000 || version >= 180000)) {
		throw new Error(`CI success service must be PostgreSQL 17.x, found server_version_num=${version}`);
	}

	console.log("checking reordered legacy shape");
  installShape();
  let output = runFile(preflight);
  requireText(output, "READY: exact approved legacy 16-column shape", "reordered legacy ingestion");
  requireText(output, "READY: exact approved legacy 12-column shape", "reordered legacy archive");
	requireText(output, "READY: all three email SQS tables are in the coherent legacy shape", "coherent legacy state");

	console.log("checking reordered final shape");
  installShape({ final: true });
  output = runFile(preflight);
  requireText(output, "READY: exact approved final 19-column shape", "reordered final ingestion");
  requireText(output, "READY: exact approved final 13-column shape", "reordered final archive");
	requireText(output, "READY: all three email SQS tables are in the coherent final shape", "coherent final state");

	for (const [label, shape] of [
		["final ingestion with legacy archive", { ingestionFinal: true, archiveFinal: false }],
		["legacy ingestion with final archive", { ingestionFinal: false, archiveFinal: true }],
	]) {
		console.log(`checking mixed cross-table state rejection: ${label}`);
		installShape(shape);
		const before = shapeCounts();
		output = runFile(preflight);
		requireText(output, "STOP: email SQS tables must be coherently all-legacy or all-final", label);
		if (shapeCounts() !== before) throw new Error(`${label} read-only preflight STOP changed schema`);
		if (version >= 170000 && version < 180000) {
			output = runFile(apply, true);
			requireText(output, "STOP: email SQS tables must be coherently all-legacy or all-final", `${label} apply`);
			if (shapeCounts() !== before) throw new Error(`${label} apply STOP wrote schema changes`);
		}
	}

  for (const [label, shape] of [["extra", { extra: true }], ["partial", { partial: true }], ["missing", { missing: true }]]) {
	console.log(`checking ${label} drift rejection`);
    installShape(shape);
		const before = shapeCounts();
    output = runFile(preflight);
    requireText(output, "STOP: expected exact approved", `${label} drift`);
		if (shapeCounts() !== before) throw new Error(`${label} read-only preflight STOP changed schema`);
		if (version >= 170000 && version < 180000) {
			output = runFile(apply, true);
			if (shapeCounts() !== before) throw new Error(`${label} apply STOP wrote schema changes`);
		}
  }

  if (version >= 180000 || version < 170000) {
	console.log("checking unsupported-version STOP and rollback");
    installShape();
		const before = shapeCounts();
    output = runFile(preflight);
    requireText(output, "STOP: this script supports PostgreSQL 17.x only", "unsupported version preflight");
    output = runFile(apply, true);
    requireText(output, "STOP: DEV email SQS migration requires PostgreSQL 17.x", "unsupported version apply");
		if (shapeCounts() !== before) throw new Error("unsupported-version STOP wrote schema changes");
  } else {
		installShape({ partial: true });
		const before = shapeCounts();
		output = runFile(apply, true);
		requireText(output, "STOP: email_ingestion_jobs must be exact legacy 16 or exact final 19 columns", "partial-drift apply");
		if (shapeCounts() !== before) throw new Error("partial-drift apply STOP wrote schema changes");
    installShape();
    runFile(apply);
		if (shapeCounts() !== "[13, 19, 13]") throw new Error(`PostgreSQL 17 apply did not produce final shape: ${shapeCounts()}`);
		output = runFile(preflight);
		requireText(output, "READY: all three email SQS tables are in the coherent final shape", "PostgreSQL 17 migrated state");
		runFile(apply);
		if (shapeCounts() !== "[13, 19, 13]") throw new Error(`PostgreSQL 17 idempotent rerun changed final shape: ${shapeCounts()}`);
  }

  console.log(`email SQS disposable PostgreSQL contract passed on server_version_num=${version}`);
} finally {
  if (started) spawnSync(pgCtl, ["-D", data, "-m", "fast", "-w", "stop"], { encoding: "utf8" });
	if (root) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

// Keep the version guard executable and visible even when this machine happens
// to provide PostgreSQL 17 rather than an unsupported disposable server.
if (!readFileSync(preflight, "utf8").includes("STOP: this script supports PostgreSQL 17.x only")) {
  throw new Error("preflight unsupported-version STOP guard is missing");
}
