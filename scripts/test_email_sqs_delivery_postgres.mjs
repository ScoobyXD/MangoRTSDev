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
  "status text", "provider_message_id text", "ingestion_job_id uuid primary key", "updated_timestamp timestamptz", "company_id uuid",
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
const unsafeDuplicateFixtures = [
	{
		label: "active duplicate",
		columns: "status",
		values: "'completed'),('70000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','unsafe','processing'",
		preflightStop: "STOP: 1 duplicate row(s) are not inactive completed/failed legacy history",
		applyStop: "legacy database-delivered email item(s) must finish",
	},
	{
		label: "unknown-status duplicate",
		columns: "status",
		values: "'completed'),('70000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','unsafe','unknown'",
		preflightStop: "STOP: 1 duplicate row(s) are not inactive completed/failed legacy history",
		applyStop: "STOP: 1 duplicate stable identity row(s) are not inactive completed/failed legacy history",
	},
	{
		label: "conflicting email thread duplicate",
		columns: "status,email_thread_id",
		values: "'completed','71000000-0000-0000-0000-000000000001'),('70000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','unsafe','failed','71000000-0000-0000-0000-000000000002'",
		preflightStop: "STOP: 1 duplicate stable identity group(s) contain conflicting non-null email_thread_id values",
		applyStop: "STOP: 1 duplicate stable identity group(s) contain conflicting non-null email_thread_id values",
	},
	{
		label: "conflicting provider thread duplicate",
		columns: "status,provider_thread_id",
		values: "'completed','provider-thread-a'),('70000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','unsafe','failed','provider-thread-b'",
		preflightStop: "STOP: 1 duplicate stable identity group(s) contain conflicting nonblank provider_thread_id values",
		applyStop: "STOP: 1 duplicate stable identity group(s) contain conflicting nonblank provider_thread_id values",
	},
];

function installShape({ final = false, ingestionFinal = final, archiveFinal = final, partial = false, extra = false, missing = false, skipIngestionStatusConstraint = false } = {}) {
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
	if (!skipIngestionStatusConstraint) {
		const statuses = ingestionFinal
			? "'accepted','processing','completed','parked','exhausted'"
			: "'pending','retry','processing','completed','failed'";
		sql(`alter table email_ingestion_jobs add constraint email_ingestion_jobs_status_chk check (status in (${statuses}))`);
	}
}

function requireText(output, value, label) {
  if (!output.includes(value)) throw new Error(`${label}: missing ${JSON.stringify(value)}\n${output}`);
}

function rowCount(table) {
	return Number(sql(`select count(*) from ${table}`).match(/\b(\d+)\b/)?.[1]);
}

function installLegacyDuplicateHistory() {
	installShape();
	const rows = [];
	for (const [group, size] of [2, 2, 4, 4, 2, 5].entries()) {
		for (let item = 1; item <= size; item += 1) {
			const jobID = `00000000-0000-0000-0000-${String((group + 1) * 100 + item).padStart(12, "0")}`;
			const connectionID = `10000000-0000-0000-0000-${String(group + 1).padStart(12, "0")}`;
			const completed = group < 2 && item === 1;
			const synthetic = group === 1 && item === 1;
			const emailThreadID = (group === 2 && item === 3) || (group === 5 && item === 5)
				? `'90000000-0000-0000-0000-${String(group + 1).padStart(12, "0")}'`
				: "null";
			const providerThreadID = (group === 3 && item >= 3) || (group === 5 && item === 5)
				? `'provider-thread-${group + 1}'`
				: "null";
			rows.push(`('${jobID}','20000000-0000-0000-0000-000000000001','${connectionID}','provider-${group + 1}',${emailThreadID},${providerThreadID},'${completed ? "completed" : "failed"}',8,'${synthetic ? "superseded_by_email_ingestion_cutover" : "email_attachment_download_failed"}','2026-02-${String(20 - item).padStart(2, "0")}T00:00:00Z','2026-01-${String(item).padStart(2, "0")}T00:00:00Z')`);
		}
	}
	sql(`insert into email_ingestion_jobs(ingestion_job_id,company_id,email_connection_id,provider_message_id,email_thread_id,provider_thread_id,status,attempt_count,last_error,updated_timestamp,created_timestamp) values ${rows.join(",")}`);
	sql(`
		create table email_threads(email_thread_id uuid primary key,provider_truth bytea not null);
		create table email_messages(email_message_id uuid primary key,email_thread_id uuid not null references email_threads(email_thread_id),provider_truth bytea not null);
		create table attachments(attachment_id uuid primary key,metadata bytea not null);
		create table attachment_relationships(attachment_relationship_id uuid primary key,attachment_id uuid not null references attachments(attachment_id),metadata bytea not null);
		insert into email_threads values ('30000000-0000-0000-0000-000000000001',decode('000102ff','hex'));
		insert into email_messages values ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',decode('656d61696c00ff','hex'));
		insert into attachments values ('50000000-0000-0000-0000-000000000001',decode('6174746163686d656e7400ff','hex'));
		insert into attachment_relationships values ('60000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',decode('72656c6174696f6e00ff','hex'))
	`);
}

function durableEmailSnapshot() {
	return sql(`select json_build_object(
		'thread',(select encode(provider_truth,'hex') from email_threads),
		'message',(select encode(provider_truth,'hex') from email_messages),
		'attachment',(select encode(metadata,'hex') from attachments),
		'relationship',(select encode(metadata,'hex') from attachment_relationships)
	)::text`);
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

	console.log("checking aggregate-only safe legacy duplicate preflight");
	installLegacyDuplicateHistory();
	output = runFile(preflight);
	requireText(output, "READY: legacy migration will collapse exactly 13 redundant inactive ingestion job metadata row(s)", "safe legacy duplicate aggregate");
	if (!/^\s*6\s*\|\s*13\s*\|\s*0\s*\|\s*1\s*\|\s*0\s*\|\s*0\s*\|\s*0\s*\|/m.test(output)) {
		throw new Error(`safe legacy aggregate did not report groups/redundant/unsafe/synthetic/thread-conflict/FK counts\n${output}`);
	}
	for (const privateIdentity of ["provider-1", "10000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000101"]) {
		if (output.includes(privateIdentity)) throw new Error(`aggregate preflight exposed private identity ${privateIdentity}`);
	}

	for (const fixture of unsafeDuplicateFixtures) {
		console.log(`checking ${fixture.label} rejection before any write`);
		installShape({ skipIngestionStatusConstraint: fixture.label === "unknown-status duplicate" });
		sql(`insert into email_ingestion_jobs(ingestion_job_id,company_id,email_connection_id,provider_message_id,${fixture.columns}) values ('70000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','unsafe',${fixture.values})`);
		output = runFile(preflight);
		requireText(output, fixture.preflightStop, `${fixture.label} preflight`);
		if (version >= 170000 && version < 180000) {
			output = runFile(apply, true);
			requireText(output, fixture.applyStop, `${fixture.label} apply`);
			if (shapeCounts() !== "[13, 16, 12]" || rowCount("email_ingestion_jobs") !== 2) throw new Error(`${fixture.label} STOP wrote changes`);
		}
	}

	console.log("checking foreign-key-dependent duplicate rejection before any write");
	installShape();
	sql("insert into email_ingestion_jobs(ingestion_job_id,company_id,email_connection_id,provider_message_id,status) values ('72000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','unsafe-reference','completed'),('72000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','unsafe-reference','failed'); create table ingestion_job_dependency(ingestion_job_id uuid references email_ingestion_jobs(ingestion_job_id)); insert into ingestion_job_dependency values ('72000000-0000-0000-0000-000000000002')");
	output = runFile(preflight);
	requireText(output, "STOP: 1 foreign key(s) reference email_ingestion_jobs", "foreign-key-dependent duplicate preflight");
	if (version >= 170000 && version < 180000) {
		output = runFile(apply, true);
		requireText(output, "STOP: cannot collapse redundant ingestion metadata because 1 foreign key(s) reference public.email_ingestion_jobs", "foreign-key-dependent duplicate apply");
		if (shapeCounts() !== "[13, 16, 12]" || rowCount("email_ingestion_jobs") !== 2 || rowCount("ingestion_job_dependency") !== 1) throw new Error("foreign-key-dependent duplicate STOP wrote changes");
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
		console.log("checking deterministic inactive legacy identity collapse");
		installLegacyDuplicateHistory();
		output = runFile(preflight);
		requireText(output, "13", "exact redundant legacy row count");
		requireText(output, "READY: legacy migration will collapse exactly 13 redundant inactive ingestion job metadata row(s)", "safe legacy duplicate history");
		const durableBefore = durableEmailSnapshot();
		if (rowCount("email_ingestion_jobs") !== 19) throw new Error("legacy duplicate fixture did not contain 19 job metadata rows");
		runFile(apply);
		if (shapeCounts() !== "[13, 19, 13]") throw new Error(`PostgreSQL 17 apply did not produce final shape: ${shapeCounts()}`);
		if (rowCount("email_ingestion_jobs") !== 6) throw new Error("migration did not collapse exactly 13 redundant job metadata rows");
		const retained = sql("select string_agg(ingestion_job_id::text,',' order by provider_message_id) from email_ingestion_jobs");
		for (const retainedID of [101, 202, 303, 403, 501, 605]) {
			requireText(retained, String(retainedID).padStart(12, "0"), `retained winner ${retainedID}`);
		}
		if (durableEmailSnapshot() !== durableBefore) throw new Error("migration changed email thread/message/attachment bytes while collapsing job metadata");
		output = runFile(preflight);
		requireText(output, "READY: all three email SQS tables are in the coherent final shape", "PostgreSQL 17 migrated state");
		requireText(output, "READY: stable ingestion identities are unique in the final shape", "PostgreSQL 17 stable identity index state");
		output = sql("select pg_get_indexdef(indexrelid) from pg_index where indexrelid='public.idx_email_ingestion_jobs_stable_message'::regclass");
		requireText(output, "CREATE UNIQUE INDEX idx_email_ingestion_jobs_stable_message ON public.email_ingestion_jobs", "PostgreSQL 17 stable identity index definition");
		runFile(apply);
		if (shapeCounts() !== "[13, 19, 13]") throw new Error(`PostgreSQL 17 idempotent rerun changed final shape: ${shapeCounts()}`);
		if (rowCount("email_ingestion_jobs") !== 6 || durableEmailSnapshot() !== durableBefore) throw new Error("PostgreSQL 17 idempotent rerun changed migrated data");

		console.log("checking final-shape duplicate rejection before any write");
		installShape({ final: true });
		sql("insert into email_ingestion_jobs(ingestion_job_id,company_id,email_connection_id,provider_message_id,status) values ('80000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','unsafe-final','completed'),('80000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','unsafe-final','completed')");
		output = runFile(preflight);
		requireText(output, "STOP: final schema contains 1 duplicate stable identity group(s) and 1 redundant row(s)", "final duplicate preflight");
		output = runFile(apply, true);
		requireText(output, "STOP: final email_ingestion_jobs contains 1 duplicate stable identity group(s) and 1 redundant row(s)", "final duplicate apply");
		if (shapeCounts() !== "[13, 19, 13]" || rowCount("email_ingestion_jobs") !== 2) throw new Error("final duplicate STOP wrote changes");

		console.log("restoring a valid PostgreSQL 17 final schema for repository integration tests");
		installLegacyDuplicateHistory();
		runFile(apply);
		if (shapeCounts() !== "[13, 19, 13]" || rowCount("email_ingestion_jobs") !== 6) throw new Error("final PostgreSQL 17 integration fixture is not ready");
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
