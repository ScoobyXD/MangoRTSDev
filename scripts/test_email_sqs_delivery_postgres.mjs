import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const preflight = join(repoRoot, "scripts", "email_sqs_delivery_preflight.sql");
const apply = join(repoRoot, "scripts", "email_sqs_delivery_apply.sql");
const forwardMigration = join(repoRoot, "backend", "db", "migrations", "20260809_zzzz_email_sqs_delivery_finalize.sql");

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
const ingestionIntermediateColumns = [
  "status text", "provider_message_id text", "ingestion_job_id uuid primary key", "updated_timestamp timestamptz", "company_id uuid",
  "email_connection_id uuid", "email_thread_id uuid", "provider_thread_id text", "priority smallint", "attempt_count integer",
  "provider_attempt_count integer", "attempt_token uuid", "enqueue_source_id text", "last_error text", "available_at timestamptz",
  "processing_started_at timestamptz", "completed_timestamp timestamptz", "failed_timestamp timestamptz", "created_timestamp timestamptz",
];
const ingestionFinalColumns = [
  "status text", "provider_message_id text", "ingestion_job_id uuid primary key", "updated_timestamp timestamptz", "company_id uuid",
  "email_connection_id uuid", "email_thread_id uuid", "provider_thread_id text", "priority smallint", "provider_attempt_count integer",
  "attempt_token uuid", "enqueue_source_id text", "sqs_accepted_timestamp timestamptz", "last_error text", "completed_timestamp timestamptz",
  "failed_timestamp timestamptz", "created_timestamp timestamptz",
];
const ingestionLegacyColumns = [
  "status text", "provider_message_id text", "ingestion_job_id uuid primary key", "updated_timestamp timestamptz", "company_id uuid",
  "email_connection_id uuid", "email_thread_id uuid", "provider_thread_id text", "priority smallint", "attempt_count integer",
  "last_error text", "available_at timestamptz", "processing_started_at timestamptz", "completed_timestamp timestamptz",
  "failed_timestamp timestamptz", "created_timestamp timestamptz",
];
const archiveIntermediateColumns = [
  "status text", "message_id text", "job_item_id uuid", "archive_job_id uuid", "attempt_count integer", "attempt_token uuid",
  "last_error text", "available_at timestamptz", "processing_started_at timestamptz", "archived_timestamp timestamptz",
  "failed_timestamp timestamptz", "created_timestamp timestamptz", "updated_timestamp timestamptz",
];
const archiveFinalColumns = [
  "status text", "message_id text", "job_item_id uuid", "archive_job_id uuid", "provider_attempt_count integer", "attempt_token uuid",
  "last_error text", "archived_timestamp timestamptz", "failed_timestamp timestamptz", "created_timestamp timestamptz",
  "updated_timestamp timestamptz",
];
const relationshipColumns = [
  "company_id uuid", "email_relationship_id uuid", "email_message_id uuid", "resource_type text",
  "resource_id uuid", "resource_textbox_id text",
];

function installShape({ state = "intermediate", ingestionState = state, archiveState = state, partial = false, extra = false, missing = false, skipStatusConstraints = false } = {}) {
  sql("drop schema public cascade; create schema public");
  const connections = [...connectionColumns];
  if (extra) connections.push("unexpected_column text");
  const ingestion = [...(ingestionState === "final" ? ingestionFinalColumns : ingestionState === "legacy" ? ingestionLegacyColumns : ingestionIntermediateColumns)];
  if (partial) ingestion.push("sqs_accepted_timestamp timestamptz");
  if (missing) ingestion.splice(ingestion.findIndex((column) => column.startsWith("last_error ")), 1);
  const archive = [...(archiveState === "final" ? archiveFinalColumns : archiveIntermediateColumns)];
  sql(`create table email_connections (${connections.join(",")}); create table email_ingestion_jobs (${ingestion.join(",")}); create table communications_email_archive_job_items (${archive.join(",")}); create table email_relationships (${relationshipColumns.join(",")})`);
  if (!skipStatusConstraints) {
    const ingestionStatuses = ingestionState === "legacy"
      ? "'pending','retry','processing','completed','failed'"
      : "'accepted','processing','completed','parked','exhausted'";
    sql(`alter table email_ingestion_jobs add constraint email_ingestion_jobs_status_chk check (status in (${ingestionStatuses})); alter table communications_email_archive_job_items add constraint communications_email_archive_job_items_status_chk check (status in ('pending','processing','archived','failed'))`);
  }
}

function installIntermediateData() {
  installShape();
  sql(`
    create index idx_email_ingestion_jobs_claim on email_ingestion_jobs(available_at);
    create index idx_communications_email_archive_job_items_claim on communications_email_archive_job_items(available_at);
    create unique index idx_email_ingestion_jobs_stable_message on email_ingestion_jobs(company_id,email_connection_id,provider_message_id);
    create function mangorts_enforce_one_node_per_email_thread() returns trigger language plpgsql as $$ begin return new; end $$;
    create trigger trg_email_relationships_one_node_per_thread before insert or update on email_relationships for each row execute function mangorts_enforce_one_node_per_email_thread();
    insert into email_ingestion_jobs(ingestion_job_id,company_id,email_connection_id,provider_message_id,provider_thread_id,priority,status,attempt_count,provider_attempt_count,attempt_token,enqueue_source_id,last_error,available_at,created_timestamp,updated_timestamp)
    values ('70000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','provider-message','provider-thread',30,'accepted',7,2,'71000000-0000-0000-0000-000000000001','webhook:source','',now(),now(),now());
    insert into communications_email_archive_job_items(job_item_id,archive_job_id,message_id,status,attempt_count,attempt_token,last_error,available_at,archived_timestamp,created_timestamp,updated_timestamp)
    values ('72000000-0000-0000-0000-000000000001','73000000-0000-0000-0000-000000000001','provider-message','archived',8,'74000000-0000-0000-0000-000000000001','',now(),now(),now(),now())
  `);
}

function requireText(output, value, label) {
  if (!output.includes(value)) throw new Error(`${label}: missing ${JSON.stringify(value)}\n${output}`);
}

function shapeCounts() {
  return sql("select json_build_array((select count(*) from information_schema.columns where table_schema='public' and table_name='email_connections'),(select count(*) from information_schema.columns where table_schema='public' and table_name='email_ingestion_jobs'),(select count(*) from information_schema.columns where table_schema='public' and table_name='communications_email_archive_job_items'))::text").match(/\[\d+,\s*\d+,\s*\d+\]/)?.[0];
}

function normalizedMigrationBody(path) {
  const body = readFileSync(path, "utf8").replace(/\r\n/g, "\n").toLowerCase();
  const start = body.indexOf("do $migration$");
  const end = body.indexOf("$migration$;", start);
  if (start < 0 || end < 0) throw new Error(`${path} is missing the migration block`);
  return body.slice(start, end + "$migration$;".length).replace(/\s+/g, " ").trim();
}

if (normalizedMigrationBody(forwardMigration) !== normalizedMigrationBody(apply)) {
  throw new Error("forward migration and DBeaver apply script have different migration bodies");
}

try {
  if (externalPostgres17) {
    console.log("using the disposable PostgreSQL 17 CI service");
  } else {
    console.log("initializing disposable local PostgreSQL");
    run(initdb, ["-D", data, "-A", "trust", "-U", "postgres", "--no-locale"], { stdio: "pipe" });
    run(pgCtl, ["-D", data, "-l", log, "-o", `-p ${port} -h ${host}`, "-w", "start"], { stdio: "ignore" });
    started = true;
  }
  const version = Number(sql("show server_version_num").match(/\b(\d{6})\b/)?.[1]);
  if (externalPostgres17 && (version < 170000 || version >= 180000)) {
    throw new Error(`CI success service must be PostgreSQL 17.x, found server_version_num=${version}`);
  }
  let contractApply = apply;
  if (version >= 180000 || version < 170000) {
    console.log("checking unsupported-version STOP and rollback");
    installIntermediateData();
    const before = shapeCounts();
    let unsupportedOutput = runFile(preflight);
    requireText(unsupportedOutput, "STOP: this script supports PostgreSQL 17.x only", "unsupported preflight");
    unsupportedOutput = runFile(apply, true);
    requireText(unsupportedOutput, "STOP: DEV email SQS finalizer requires PostgreSQL 17.x", "unsupported apply");
    if (shapeCounts() !== before) throw new Error("unsupported-version STOP changed schema");

    contractApply = join(root, "email_sqs_delivery_apply_contract.sql");
    const guardedApply = readFileSync(apply, "utf8");
    const executableApply = guardedApply.replace(
      "if current_setting('server_version_num')::integer < 170000\r\n     or current_setting('server_version_num')::integer >= 180000 then",
      "if false then",
    ).replace(
      "if current_setting('server_version_num')::integer < 170000\n     or current_setting('server_version_num')::integer >= 180000 then",
      "if false then",
    );
    if (executableApply === guardedApply) throw new Error("could not isolate the version guard for disposable semantic testing");
    writeFileSync(contractApply, executableApply);
  }

  console.log("checking reordered previously-applied shape");
  installShape();
  let output = runFile(preflight);
  requireText(output, "READY: exact previously-applied 19-column shape", "intermediate ingestion");
  requireText(output, "READY: exact previously-applied 13-column shape", "intermediate archive");
  requireText(output, "READY: all email SQS tables are in the coherent previously-applied shape", "coherent intermediate state");

  console.log("checking reordered final shape");
  installShape({ state: "final" });
  output = runFile(preflight);
  requireText(output, "READY: exact approved final 17-column shape", "final ingestion");
  requireText(output, "READY: exact approved final 11-column shape", "final archive");
  requireText(output, "READY: all email SQS tables are in the coherent final shape", "coherent final state");

  console.log("checking untouched legacy shape rejection");
  installShape({ ingestionState: "legacy", archiveState: "intermediate" });
  output = runFile(preflight);
  requireText(output, "STOP: expected exact previously-applied 19 or final 17-column shape", "legacy finalizer preflight");

  for (const [label, shape] of [
    ["final ingestion with intermediate archive", { ingestionState: "final", archiveState: "intermediate" }],
    ["intermediate ingestion with final archive", { ingestionState: "intermediate", archiveState: "final" }],
  ]) {
    console.log(`checking mixed cross-table state rejection: ${label}`);
    installShape(shape);
    const before = shapeCounts();
    output = runFile(preflight);
    requireText(output, "STOP: email SQS tables must be coherently all previously-applied or all-final", label);
    if (shapeCounts() !== before) throw new Error(`${label} preflight changed schema`);
    output = runFile(contractApply, true);
    requireText(output, "STOP: email SQS tables must be coherently all previously-applied or all-final", `${label} apply`);
    if (shapeCounts() !== before) throw new Error(`${label} apply STOP changed schema`);
  }

  for (const [label, shape] of [["extra", { extra: true }], ["partial", { partial: true }], ["missing", { missing: true }]]) {
    console.log(`checking ${label} drift rejection`);
    installShape(shape);
    const before = shapeCounts();
    output = runFile(preflight);
    requireText(output, "STOP: expected exact", `${label} drift`);
    if (shapeCounts() !== before) throw new Error(`${label} preflight changed schema`);
    runFile(contractApply, true);
    if (shapeCounts() !== before) throw new Error(`${label} apply STOP changed schema`);
  }

  console.log("checking invalid status rejection before any write");
  installShape({ skipStatusConstraints: true });
  sql("insert into email_ingestion_jobs(ingestion_job_id,company_id,email_connection_id,provider_message_id,status) values ('76000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','invalid-status','failed')");
  output = runFile(preflight);
  requireText(output, "STOP: one or more email SQS rows use a status outside the final approved sets", "invalid status preflight");
  output = runFile(contractApply, true);
  requireText(output, "email SQS row(s) have a status outside the final approved sets", "invalid status apply");
  if (shapeCounts() !== "[13, 19, 13]") throw new Error("invalid status STOP changed schema");

  console.log("checking active work rejection before any write");
  installShape();
  sql("insert into email_ingestion_jobs(ingestion_job_id,company_id,email_connection_id,provider_message_id,status) values ('77000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','active-work','processing')");
  output = runFile(preflight);
  requireText(output, "STOP: ingestion jobs must finish or receive deliberate operator review", "active work preflight");
  output = runFile(contractApply, true);
  requireText(output, "database-delivered email item(s) must finish or receive deliberate operator review", "active work apply");
  if (shapeCounts() !== "[13, 19, 13]") throw new Error("active work STOP changed schema");

  console.log("checking relationship cardinality rejection before any write");
  installShape();
  sql("insert into email_relationships(company_id,email_relationship_id,email_message_id,resource_type,resource_id,resource_textbox_id) values ('20000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001','node','93000000-0000-0000-0000-000000000001','textbox-a'),('20000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000002','92000000-0000-0000-0000-000000000001','node','93000000-0000-0000-0000-000000000001','textbox-b')");
  output = runFile(preflight);
  requireText(output, "STOP: one or more exact email messages are linked to multiple textboxes in the same Node", "relationship cardinality preflight");
  output = runFile(contractApply, true);
  requireText(output, "exact email message/Node pair(s) are linked to more than one textbox", "relationship cardinality apply");
  if (shapeCounts() !== "[13, 19, 13]") throw new Error("relationship STOP changed schema");

  console.log("checking exact previously-applied to final migration");
  installIntermediateData();
  runFile(contractApply);
  if (shapeCounts() !== "[13, 17, 11]") throw new Error(`finalizer did not produce canonical shape: ${shapeCounts()}`);
  output = sql("select provider_attempt_count,attempt_token::text,enqueue_source_id,sqs_accepted_timestamp is null from email_ingestion_jobs");
  requireText(output, "webhook:source", "ingestion producer fingerprint preservation");
  requireText(output, "71000000-0000-0000-0000-000000000001", "ingestion attempt token preservation");
  if (!/\b2\s*\|/.test(output) || !/\|\s*t\s*$/m.test(output)) throw new Error(`ingestion final fields were not preserved truthfully\n${output}`);
  output = sql("select provider_attempt_count,attempt_token::text from communications_email_archive_job_items");
  requireText(output, "74000000-0000-0000-0000-000000000001", "archive attempt token preservation");
  if (!/\b0\s*\|/.test(output)) throw new Error(`archive provider attempt count was not initialized at zero\n${output}`);
  output = sql("select count(*) from information_schema.columns where table_schema='public' and table_name in ('email_ingestion_jobs','communications_email_archive_job_items') and column_name in ('attempt_count','available_at','processing_started_at')");
  if (!/\b0\b/.test(output)) throw new Error("finalizer retained a retired database-delivery column");
  output = sql("select count(*) from pg_trigger where tgname='trg_email_relationships_one_node_per_thread' and not tgisinternal");
  if (!/\b0\b/.test(output)) throw new Error("finalizer retained the obsolete one-thread/one-Node trigger");
  output = sql("select pg_get_indexdef(indexrelid) from pg_index where indexrelid='public.idx_email_relationships_one_node_textbox_per_message'::regclass");
  requireText(output, "(company_id, email_message_id, resource_id)", "Node-local textbox index");
  output = runFile(preflight);
  requireText(output, "READY: all email SQS tables are in the coherent final shape", "migrated state");
  runFile(contractApply);
  if (shapeCounts() !== "[13, 17, 11]") throw new Error("idempotent finalizer changed final shape");

  console.log("checking final-shape duplicate rejection");
  installShape({ state: "final" });
  sql("insert into email_ingestion_jobs(ingestion_job_id,company_id,email_connection_id,provider_message_id,status) values ('80000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','duplicate','completed'),('80000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','duplicate','completed')");
  output = runFile(contractApply, true);
  requireText(output, "duplicate stable identity group(s)", "final duplicate apply");
  if (shapeCounts() !== "[13, 17, 11]") throw new Error("duplicate STOP changed final schema");
  console.log("restoring the coherent final shape for downstream readiness");
  sql("delete from email_ingestion_jobs where ingestion_job_id='80000000-0000-0000-0000-000000000002'");
  runFile(contractApply);
  requireText(runFile(preflight), "READY: all email SQS tables are in the coherent final shape", "downstream readiness");
  console.log(`email SQS disposable PostgreSQL contract passed on server_version_num=${version}`);
} finally {
  if (started) spawnSync(pgCtl, ["-D", data, "-m", "fast", "-w", "stop"], { encoding: "utf8" });
  if (root) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

if (!readFileSync(preflight, "utf8").includes("STOP: this script supports PostgreSQL 17.x only")) {
  throw new Error("preflight unsupported-version STOP guard is missing");
}
