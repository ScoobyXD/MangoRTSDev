import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const migration = join(repoRoot, "backend", "db", "migrations", "20260811_zzz_email_draft_scope.sql");

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

const initdb = postgresBinary("initdb");
const pgCtl = postgresBinary("pg_ctl");
const psql = postgresBinary("psql");
const root = mkdtempSync(join(tmpdir(), "mangorts-email-draft-scope-pg-"));
const data = join(root, "data");
const log = join(root, "postgres.log");
const host = "127.0.0.1";
const socket = createServer();
await new Promise((accept, reject) => socket.listen(0, host, (error) => error ? reject(error) : accept()));
const port = socket.address().port;
await new Promise((accept) => socket.close(accept));
const env = { ...process.env, PGCONNECT_TIMEOUT: "5" };
let started = false;

function run(binary, args, options = {}) {
  return execFileSync(binary, args, { encoding: "utf8", ...options });
}

function sql(statement) {
  const result = spawnSync(
    psql,
    ["-X", "-h", host, "-p", String(port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", statement],
    { encoding: "utf8", timeout: 30_000, env },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

function scalar(statement) {
  const result = spawnSync(
    psql,
    ["-X", "-t", "-A", "-h", host, "-p", String(port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", statement],
    { encoding: "utf8", timeout: 30_000, env },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

function runFile(path) {
  const result = spawnSync(
    psql,
    ["-X", "-h", host, "-p", String(port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", path],
    { encoding: "utf8", timeout: 60_000, env },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

function expectScalar(statement, expected, message) {
  const actual = scalar(statement);
  if (actual !== expected) throw new Error(`${message}: got ${actual}, want ${expected}`);
}

try {
  run(initdb, ["-D", data, "-A", "trust", "-U", "postgres", "--no-locale"], { stdio: "pipe" });
  run(pgCtl, ["-D", data, "-l", log, "-o", `-p ${port} -h ${host}`, "-w", "start"], { stdio: "ignore" });
  started = true;
  const version = Number(scalar("show server_version_num"));
  if (version < 170000 || version >= 190000) throw new Error(`unsupported disposable PostgreSQL version ${version}`);

  sql(`
    create table nodes (
      company_id uuid not null,
      node_id uuid not null,
      primary key(company_id,node_id)
    );
    create table email_drafts (
      company_id uuid not null,
      draft_id text not null,
      email_thread_id uuid,
      origin_node_id uuid,
      source_email_message_id uuid,
      email_account_type text not null,
      personal_user_id uuid,
      personal_account_email text,
      shared_inbox_id uuid,
      created_by_user_id uuid,
      send_state text not null default 'draft',
      updated_timestamp timestamptz not null default now(),
      deleted_timestamp timestamptz,
      primary key(company_id,draft_id),
      constraint email_drafts_origin_node_fkey foreign key(company_id,origin_node_id)
        references nodes(company_id,node_id) on delete set null
    );
    create unique index idx_email_drafts_active_thread
      on email_drafts(company_id,email_thread_id)
      where deleted_timestamp is null and email_thread_id is not null;
    create table attachment_relationships (
      company_id uuid not null,
      attachment_relationship_id uuid not null,
      resource_type text not null,
      resource_id text not null,
      updated_timestamp timestamptz not null default now(),
      deleted_timestamp timestamptz,
      primary key(company_id,attachment_relationship_id)
    );

    insert into nodes values
      ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
    insert into email_drafts(
      company_id,draft_id,email_thread_id,origin_node_id,source_email_message_id,email_account_type,
      personal_user_id,personal_account_email,shared_inbox_id,created_by_user_id
    ) values
      ('10000000-0000-4000-8000-000000000001','valid-personal',null,null,null,'personal_email_account',
        '30000000-0000-4000-8000-000000000001','owner@example.com',null,null),
      ('10000000-0000-4000-8000-000000000001','ambiguous-personal',null,null,null,'shared_email_account',
        null,null,'40000000-0000-4000-8000-000000000001',null),
      ('10000000-0000-4000-8000-000000000001','ambiguous-node','50000000-0000-4000-8000-000000000001',null,
        '60000000-0000-4000-8000-000000000001','personal_email_account','30000000-0000-4000-8000-000000000001','owner@example.com',null,
        '30000000-0000-4000-8000-000000000001'),
      ('10000000-0000-4000-8000-000000000001','ambiguous-source','50000000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000001',null,'personal_email_account','30000000-0000-4000-8000-000000000001',
        'owner@example.com',null,'30000000-0000-4000-8000-000000000001'),
      ('10000000-0000-4000-8000-000000000001','valid-shared','50000000-0000-4000-8000-000000000003',
        '20000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000003','personal_email_account',
        '30000000-0000-4000-8000-000000000001','owner@example.com',null,'30000000-0000-4000-8000-000000000001');
    insert into attachment_relationships(company_id,attachment_relationship_id,resource_type,resource_id)
    select '10000000-0000-4000-8000-000000000001',
           ('70000000-0000-4000-8000-' || lpad(row_number() over ()::text,12,'0'))::uuid,
           'email_draft',draft_id
    from email_drafts;
  `);

  runFile(migration);
  expectScalar("select count(*) from email_drafts", "2", "only exact-scope drafts retained");
  expectScalar("select count(*) from email_drafts where draft_id='valid-personal' and created_by_user_id=personal_user_id", "1", "personal owner backfilled");
  expectScalar("select count(*) from email_drafts where draft_id='valid-shared'", "1", "valid shared draft retained");
  expectScalar("select count(*) from attachment_relationships where deleted_timestamp is null", "2", "valid draft attachment links retained");
  expectScalar("select count(*) from attachment_relationships where deleted_timestamp is not null", "3", "ambiguous draft attachment links retired");
  expectScalar("select count(*) from pg_constraint where conrelid='email_drafts'::regclass and conname='email_drafts_origin_node_fkey'", "0", "legacy set-null Node foreign key removed");
  expectScalar("select confdeltype from pg_constraint where conrelid='email_drafts'::regclass and conname='email_drafts_company_id_origin_node_id_fkey'", "c", "Node foreign key cascades");

  runFile(migration);
  expectScalar("select count(*) from email_drafts", "2", "migration rerun is idempotent");
  expectScalar("select count(*) from attachment_relationships where deleted_timestamp is not null", "3", "migration rerun preserves retired links");
  console.log(`Email draft scope disposable PostgreSQL contract passed on server_version_num=${version}`);
} finally {
  if (started) spawnSync(pgCtl, ["-D", data, "-m", "fast", "-w", "stop"], { encoding: "utf8" });
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
