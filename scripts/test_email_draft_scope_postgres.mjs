import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const scopeMigration = join(repoRoot, "backend", "db", "migrations", "20260811_zzz_email_draft_scope.sql");
const identityMigration = join(repoRoot, "backend", "db", "migrations", "20260813_email_draft_identity.sql");
const cleanupMigration = join(repoRoot, "backend", "db", "migrations", "20260816_remove_node_email_drafts.sql");

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
      collaboration_id uuid,
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
      attachment_id uuid not null,
      resource_type text not null,
      resource_id text not null,
      deleted_timestamp timestamptz,
      primary key(company_id,attachment_relationship_id)
    );
    create table attachments (
      company_id uuid not null,
      attachment_id uuid not null,
      deleted_timestamp timestamptz,
      primary key(company_id,attachment_id)
    );

    insert into nodes values
      ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
    insert into email_drafts(
      company_id,draft_id,email_thread_id,origin_node_id,source_email_message_id,email_account_type,
      personal_user_id,personal_account_email,shared_inbox_id,created_by_user_id
    ) values
      ('10000000-0000-4000-8000-000000000001','draft:reply:personal%3A30000000-0000-4000-8000-000000000001%3Aowner%40example.com:60000000-0000-4000-8000-000000000006',null,null,'60000000-0000-4000-8000-000000000006','personal_email_account',
        '30000000-0000-4000-8000-000000000001','owner@example.com',null,null),
      ('10000000-0000-4000-8000-000000000001','draft:reply:message:60000000-0000-4000-8000-000000000005:user:30000000-0000-4000-8000-000000000001:account:owner@example.com',null,null,'60000000-0000-4000-8000-000000000005','personal_email_account',
        '30000000-0000-4000-8000-000000000001','owner@example.com',null,'30000000-0000-4000-8000-000000000001'),
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
        '30000000-0000-4000-8000-000000000001','owner@example.com',null,'30000000-0000-4000-8000-000000000001'),
      ('10000000-0000-4000-8000-000000000001','valid-shared-only','50000000-0000-4000-8000-000000000004',
        '20000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000004','personal_email_account',
        '30000000-0000-4000-8000-000000000001','owner@example.com',null,'30000000-0000-4000-8000-000000000001');
    insert into attachment_relationships(company_id,attachment_relationship_id,attachment_id,resource_type,resource_id)
    select '10000000-0000-4000-8000-000000000001',
           ('70000000-0000-4000-8000-' || lpad(row_number() over ()::text,12,'0'))::uuid,
           ('71000000-0000-4000-8000-' || lpad(row_number() over ()::text,12,'0'))::uuid,
           'email_draft',draft_id
    from email_drafts;
    insert into attachment_relationships(company_id,attachment_relationship_id,attachment_id,resource_type,resource_id)
    select company_id,'80000000-0000-4000-8000-000000000001',attachment_id,'email_message','surviving-message-owner'
    from attachment_relationships
    where resource_type='email_draft' and resource_id='valid-shared';
    insert into attachments(company_id,attachment_id)
    select distinct company_id,attachment_id from attachment_relationships;
  `);

  runFile(scopeMigration);
  runFile(identityMigration);
  sql(`
    alter table email_drafts drop constraint email_drafts_origin_node_chk;
    insert into email_drafts(
      company_id,draft_id,email_thread_id,origin_node_id,source_email_message_id,is_shared,email_account_type,
      personal_user_id,personal_account_email,shared_inbox_id,created_by_user_id
    ) values (
      '10000000-0000-4000-8000-000000000001','mailbox-thread-marker-only',
      '50000000-0000-4000-8000-000000000009',null,'60000000-0000-4000-8000-000000000009',false,
      'personal_email_account','30000000-0000-4000-8000-000000000001','owner@example.com',null,
      '30000000-0000-4000-8000-000000000001'
    );
    insert into attachment_relationships(
      company_id,attachment_relationship_id,attachment_id,resource_type,resource_id
    ) values (
      '10000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000099',
      '71000000-0000-4000-8000-000000000099','email_draft','mailbox-thread-marker-only'
    );
    insert into attachments(company_id,attachment_id) values (
      '10000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000099'
    );
  `);
  runFile(cleanupMigration);
  expectScalar("select count(*) from email_drafts", "3", "mailbox-scoped drafts retained");
  expectScalar("select count(*) from email_drafts where draft_id='draft:reply:personal%3A30000000-0000-4000-8000-000000000001%3Aowner%40example.com:60000000-0000-4000-8000-000000000006' and created_by_user_id=personal_user_id", "1", "ordinary Triage reply draft preserved and personal owner backfilled");
  expectScalar("select count(*) from email_drafts where draft_id='draft:reply:message:60000000-0000-4000-8000-000000000005:user:30000000-0000-4000-8000-000000000001:account:owner@example.com'", "1", "mailbox-scoped Project attached-email reply preserved");
  expectScalar("select count(*) from email_drafts where draft_id='mailbox-thread-marker-only'", "1", "mailbox draft with only a legacy thread marker preserved");
  expectScalar("select count(*) from email_drafts where draft_id='valid-shared'", "0", "Node draft removed");
  expectScalar("select count(*) from attachment_relationships where deleted_timestamp is null", "4", "mailbox drafts and surviving message attachment links retained");
  expectScalar("select count(*) from attachment_relationships where deleted_timestamp is not null", "5", "discarded and Node draft attachment links retired");
  expectScalar("select count(*) from attachments where deleted_timestamp is not null", "1", "only the now-unowned Node draft attachment marked deleted");
  expectScalar("select count(*) from attachments attachment where attachment.deleted_timestamp is null and exists (select 1 from attachment_relationships relationship where relationship.company_id=attachment.company_id and relationship.attachment_id=attachment.attachment_id and relationship.resource_type='email_message' and relationship.deleted_timestamp is null)", "1", "attachment with a surviving owner preserved");
  expectScalar("select count(*) from pg_attribute where attrelid='email_drafts'::regclass and attname in ('email_thread_id','origin_node_id','is_shared','revision','send_state','send_claim_token','send_idempotency_key','sent_email_message_id') and attnum>0 and not attisdropped", "0", "Node draft columns removed");
  expectScalar("select count(*) from pg_attribute where attrelid='email_drafts'::regclass and attname='collaboration_id' and attnum>0 and not attisdropped", "0", "obsolete collaboration identity removed");

  runFile(cleanupMigration);
  expectScalar("select count(*) from email_drafts", "3", "cleanup rerun is idempotent");
  expectScalar("select count(*) from attachment_relationships where deleted_timestamp is not null", "5", "cleanup rerun preserves retired links");
  console.log(`Email draft scope disposable PostgreSQL contract passed on server_version_num=${version}`);
} finally {
  if (started) spawnSync(pgCtl, ["-D", data, "-m", "fast", "-w", "stop"], { encoding: "utf8" });
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
