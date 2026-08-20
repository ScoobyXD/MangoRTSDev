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
const sharedDraftMigration = join(repoRoot, "backend", "db", "migrations", "20260819_shared_email_drafts.sql");

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
    create table companies (
      company_id uuid primary key
    );
    create table nodes (
      company_id uuid not null,
      node_id uuid not null,
      primary key(company_id,node_id),
      foreign key(company_id) references companies(company_id) on delete cascade
    );
    create table projects (
      company_id uuid not null,
      project_id uuid not null,
      primary key(company_id,project_id),
      foreign key(company_id) references companies(company_id) on delete cascade
    );
    create table email_relationships (
      company_id uuid not null,
      email_message_id uuid not null,
      resource_type text not null,
      resource_id uuid not null,
      resource_textbox_id uuid
    );
    create table attachment_upload_jobs (
      attachment_upload_job_id uuid primary key
    );
    create table recycle_bin_items (
      company_id uuid not null,
      restore_payload jsonb not null
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
      foreign key(company_id) references companies(company_id) on delete cascade,
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

    insert into companies values ('10000000-0000-4000-8000-000000000001');
    insert into nodes values
      ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
    insert into projects values
      ('10000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001');
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
  runFile(cleanupMigration);
  expectScalar("select count(*) from email_drafts", "3", "cleanup rerun is idempotent");
  expectScalar("select count(*) from attachment_relationships where deleted_timestamp is not null", "5", "cleanup rerun preserves retired links");

  sql(`alter table email_drafts
    add column kind text not null default 'reply',
    add column scheduled_send_timestamp timestamptz;`);
  sql(`insert into email_relationships(company_id,email_message_id,resource_type,resource_id) values
    ('10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000005','node','20000000-0000-4000-8000-000000000001'),
    ('10000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000005','project','21000000-0000-4000-8000-000000000001');`);
  runFile(sharedDraftMigration);
  sql(`
    insert into email_drafts(
      company_id,draft_id,source_email_message_id,email_account_type,personal_user_id,
      personal_account_email,created_by_user_id,shared_resource_type,shared_resource_id,kind
    ) values (
      '10000000-0000-4000-8000-000000000001','shared-node','60000000-0000-4000-8000-000000000005',
      'personal_email_account','30000000-0000-4000-8000-000000000001','owner@example.com',
      '30000000-0000-4000-8000-000000000002','node','20000000-0000-4000-8000-000000000001','reply'
    );
    insert into email_drafts(
      company_id,draft_id,source_email_message_id,email_account_type,personal_user_id,
      personal_account_email,created_by_user_id,shared_resource_type,shared_resource_id,kind
    ) values (
      '10000000-0000-4000-8000-000000000001','shared-project','60000000-0000-4000-8000-000000000005',
      'personal_email_account','30000000-0000-4000-8000-000000000001','owner@example.com',
      '30000000-0000-4000-8000-000000000003','project','21000000-0000-4000-8000-000000000001','reply'
    );
    do $$ begin
      begin
        insert into email_drafts(
          company_id,draft_id,source_email_message_id,email_account_type,personal_user_id,
          personal_account_email,created_by_user_id,shared_resource_type,shared_resource_id,kind
        ) values (
          '10000000-0000-4000-8000-000000000001','duplicate-shared-node','60000000-0000-4000-8000-000000000005',
          'personal_email_account','30000000-0000-4000-8000-000000000001','owner@example.com',
          '30000000-0000-4000-8000-000000000004','node','20000000-0000-4000-8000-000000000001','reply'
        );
        raise exception 'duplicate shared Node identity was accepted';
      exception when unique_violation then null;
      end;
    end $$;
    do $$ begin
      begin
        update email_drafts set revision=0 where draft_id='shared-project';
        raise exception 'zero shared draft revision was accepted';
      exception when check_violation then null;
      end;
    end $$;
    do $$ begin
      begin
        insert into email_drafts(
          company_id,draft_id,source_email_message_id,email_account_type,personal_user_id,
          personal_account_email,created_by_user_id,shared_resource_id,kind
        ) values (
          '10000000-0000-4000-8000-000000000001','half-shared-owner','60000000-0000-4000-8000-000000000005',
          'personal_email_account','30000000-0000-4000-8000-000000000001','owner@example.com',
          '30000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001','reply'
        );
        raise exception 'half-populated shared owner was accepted';
      exception when check_violation then null;
      end;
    end $$;
    do $$ begin
      begin
        insert into email_drafts(
          company_id,draft_id,source_email_message_id,email_account_type,personal_user_id,
          personal_account_email,created_by_user_id,shared_resource_type,shared_resource_id,kind
        ) values (
          '10000000-0000-4000-8000-000000000001','bad-owner-type','60000000-0000-4000-8000-000000000005',
          'personal_email_account','30000000-0000-4000-8000-000000000001','owner@example.com',
          '30000000-0000-4000-8000-000000000004','logic_gate','20000000-0000-4000-8000-000000000001','reply'
        );
        raise exception 'invalid shared resource type was accepted';
      exception when check_violation then null;
      end;
    end $$;
    do $$ begin
      begin
        insert into email_drafts(
          company_id,draft_id,source_email_message_id,email_account_type,personal_user_id,
          personal_account_email,created_by_user_id,shared_resource_type,shared_resource_id,kind
        ) values (
          '10000000-0000-4000-8000-000000000001','missing-owner','60000000-0000-4000-8000-000000000005',
          'personal_email_account','30000000-0000-4000-8000-000000000001','owner@example.com',
          '30000000-0000-4000-8000-000000000004','node','20000000-0000-4000-8000-000000000099','reply'
        );
        raise exception 'missing same-company shared owner was accepted';
      exception when foreign_key_violation then null;
      end;
    end $$;
    do $$ begin
      begin
        delete from nodes where company_id='10000000-0000-4000-8000-000000000001'
          and node_id='20000000-0000-4000-8000-000000000001';
        raise exception 'active shared draft did not protect its Node owner';
      exception when foreign_key_violation then null;
      end;
    end $$;
    do $$ begin
      begin
        delete from email_relationships
        where company_id='10000000-0000-4000-8000-000000000001'
          and resource_type='node' and resource_id='20000000-0000-4000-8000-000000000001';
        set constraints all immediate;
        raise exception 'active shared draft did not protect its source relationship';
      exception when foreign_key_violation then null;
      end;
    end $$;
  `);
  expectScalar("select count(*) from email_drafts where source_email_message_id='60000000-0000-4000-8000-000000000005' and deleted_timestamp is null", "3", "personal, Node-shared, and Project-shared drafts coexist");
  expectScalar("with changed as (update email_drafts set revision=revision+1 where draft_id='shared-node' and revision=1 returning revision) select revision from changed", "2", "fresh revision compare-and-swap succeeds");
  expectScalar("with stale as (update email_drafts set revision=revision+1 where draft_id='shared-node' and revision=1 returning 1) select count(*) from stale", "0", "stale revision compare-and-swap changes nothing");
  sql(`begin;
    select coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::jsonb)
    from (select * from email_drafts where shared_resource_type='node' order by draft_id for update) row_data;
    rollback;`);
  sql(`
    insert into recycle_bin_items(company_id,restore_payload) values (
      '10000000-0000-4000-8000-000000000001',
      '{"attachments":[{"attachment_id":"79999999-0000-4000-8000-000000000001"}]}'::jsonb
    );
    prepare recyclable_attachment_owned(uuid,uuid) as
    select exists(
      select 1 from attachment_relationships
      where company_id=$1 and attachment_id=$2 and deleted_timestamp is null
      union all
      select 1 from recycle_bin_items recycle,
        lateral jsonb_array_elements(coalesce(recycle.restore_payload->'attachments','[]'::jsonb)) restored
      where recycle.company_id=$1 and restored->>'attachment_id'=$2::text
    );
    execute recyclable_attachment_owned(
      '10000000-0000-4000-8000-000000000001','79999999-0000-4000-8000-000000000001'
    );
    deallocate recyclable_attachment_owned;
  `);
  sql(`begin;
    select * from recycle_bin_items
    where company_id='10000000-0000-4000-8000-000000000001'
    order by company_id for update;
    rollback;`);
  expectScalar("select count(*) from pg_attribute where attrelid='email_drafts'::regclass and attname in ('email_thread_id','origin_node_id','is_shared','send_state','send_claim_token','send_idempotency_key','sent_email_message_id') and attnum>0 and not attisdropped", "0", "obsolete Node draft columns removed");
  expectScalar("select count(*) from pg_attribute where attrelid='email_drafts'::regclass and attname='collaboration_id' and attnum>0 and not attisdropped", "0", "obsolete collaboration identity removed");
  sql("delete from companies where company_id='10000000-0000-4000-8000-000000000001'");
  expectScalar("select count(*) from nodes", "0", "company cascade removes Node despite shared draft guard");
  expectScalar("select count(*) from email_drafts", "0", "company cascade removes shared drafts");
  console.log(`Email draft scope disposable PostgreSQL contract passed on server_version_num=${version}`);
} finally {
  if (started) spawnSync(pgCtl, ["-D", data, "-m", "fast", "-w", "stop"], { encoding: "utf8" });
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
