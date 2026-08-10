import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const migration = join(repoRoot, "backend", "db", "migrations", "20260808_node_priority_not_assigned.sql");

function postgresBinary(name) {
  const suffix = process.platform === "win32" ? ".exe" : "";
  const configured = process.env.POSTGRES_BIN?.trim();
  const candidates = [
    configured && join(configured, `${name}${suffix}`),
    process.platform === "win32" && `C:\\Program Files\\PostgreSQL\\18\\bin\\${name}.exe`,
    process.platform === "win32" && `C:\\Program Files\\PostgreSQL\\17\\bin\\${name}.exe`,
  ].filter(Boolean);
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  const lookup = spawnSync(process.platform === "win32" ? "where.exe" : "sh", process.platform === "win32" ? [name] : ["-c", `command -v ${name}`], { encoding: "utf8" });
  const found = lookup.status === 0 ? lookup.stdout.trim().split(/\r?\n/)[0] : "";
  if (!found) throw new Error(`PostgreSQL executable ${name} was not found; set POSTGRES_BIN`);
  return found;
}

const psql = postgresBinary("psql");
const external = Boolean(process.env.NODE_EMAIL_POSTGRES17_HOST?.trim());
const initdb = external ? null : postgresBinary("initdb");
const pgCtl = external ? null : postgresBinary("pg_ctl");
const root = external ? null : mkdtempSync(join(tmpdir(), "mangorts-node-email-pg-"));
const data = root && join(root, "data");
const log = root && join(root, "postgres.log");
const host = process.env.NODE_EMAIL_POSTGRES17_HOST?.trim() || "127.0.0.1";
let port = Number(process.env.NODE_EMAIL_POSTGRES17_PORT || 0);
if (!external) {
  const socket = createServer();
  await new Promise((accept, reject) => socket.listen(0, host, (error) => error ? reject(error) : accept()));
  port = socket.address().port;
  await new Promise((accept) => socket.close(accept));
}
const database = process.env.NODE_EMAIL_POSTGRES17_DATABASE?.trim() || "postgres";
const user = process.env.NODE_EMAIL_POSTGRES17_USER?.trim() || "postgres";
const env = { ...process.env, PGCONNECT_TIMEOUT: "5", PGPASSWORD: process.env.NODE_EMAIL_POSTGRES17_PASSWORD || process.env.PGPASSWORD || "" };
let started = false;

function run(binary, args, options = {}) {
  return execFileSync(binary, args, { encoding: "utf8", ...options });
}

function sql(statement, expectFailure = false) {
  const result = spawnSync(psql, ["-X", "-h", host, "-p", String(port), "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1", "-c", statement], { encoding: "utf8", timeout: 20_000, env });
  if (result.error) throw result.error;
  if (!expectFailure && result.status !== 0) throw new Error(result.stderr || result.stdout);
  if (expectFailure && result.status === 0) throw new Error(`expected SQL to fail: ${statement}`);
  return `${result.stdout}\n${result.stderr}`;
}

function runMigration(expectFailure = false) {
  const result = spawnSync(psql, ["-X", "-h", host, "-p", String(port), "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1", "-f", migration], { encoding: "utf8", timeout: 20_000, env });
  if (result.error) throw result.error;
  if (!expectFailure && result.status !== 0) throw new Error(result.stderr || result.stdout);
  if (expectFailure && result.status === 0) throw new Error("expected Node email migration to fail");
  return `${result.stdout}\n${result.stderr}`;
}

function scalar(statement) {
  const result = spawnSync(psql, ["-X", "-t", "-A", "-h", host, "-p", String(port), "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1", "-c", statement], { encoding: "utf8", timeout: 20_000, env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

function installShape({ extraRelationshipColumn = false, duplicateEdge = false, legacyChats = false, conflictingLegacyChats = false, unsafeConflictingLegacyChats = false } = {}) {
  sql("drop schema public cascade; create schema public");
  sql(`
    create table email_threads(company_id uuid not null,email_thread_id uuid not null,primary key(company_id,email_thread_id));
    create table email_messages(email_message_id uuid not null,company_id uuid not null,email_thread_id uuid not null,
      primary key(company_id,email_message_id),unique(company_id,email_thread_id,email_message_id),
      foreign key(company_id,email_thread_id) references email_threads(company_id,email_thread_id));
    create table nodes(node_id uuid not null,company_id uuid not null,priority smallint,primary key(company_id,node_id));
    create table node_textboxes(textbox_id uuid not null,company_id uuid not null,node_id uuid not null,
      body_json jsonb not null default '{"format":"mango-tiptap-json","schema_version":"1","document":{"type":"doc","content":[{"type":"paragraph"}]},"annotations":[]}',
      revision bigint not null default 1,display_order bigint not null default 0,created_timestamp timestamptz not null default now(),
      updated_timestamp timestamptz not null default now(),deleted_timestamp timestamptz,
      primary key(company_id,node_id,textbox_id),foreign key(company_id,node_id) references nodes(company_id,node_id));
    create table node_logic_gate_assignments(company_id uuid);
    create table email_relationships(
      resource_type text not null,email_message_id uuid not null,company_id uuid not null,created_timestamp timestamptz not null default now(),
      resource_textbox_id text,resource_id uuid not null,email_thread_id uuid not null,email_relationship_id uuid not null${extraRelationshipColumn ? ",unexpected_column text" : ""},
      primary key(company_id,email_relationship_id),
      foreign key(company_id,email_thread_id,email_message_id) references email_messages(company_id,email_thread_id,email_message_id));
    create table node_textbox_chats(
      message text not null default '',company_id uuid not null,node_id uuid not null,textbox_id uuid not null,chat_id uuid not null,
      parent_chat_id uuid,selection_source text not null default 'text',selection_textbox_id uuid,selection_email_message_id uuid,
      selection_quote text not null default '',selection_start integer,selection_end integer,author_user_id uuid,
      author_display_name text not null default '',edited_timestamp timestamptz,entity_links jsonb not null default '[]',
      mentioned_user_ids uuid[] not null default '{}',mentioned_group_ids uuid[] not null default '{}',revision bigint not null default 1,
      created_timestamp timestamptz not null default now(),updated_timestamp timestamptz not null default now(),deleted_timestamp timestamptz,
      primary key(company_id,chat_id));
    create table email_drafts(company_id uuid not null,draft_id text not null,email_relationship_id uuid,
      deleted_timestamp timestamptz,updated_timestamp timestamptz not null default now(),primary key(company_id,draft_id),
      constraint email_drafts_email_relationship_id_fkey foreign key(company_id,email_relationship_id) references email_relationships(company_id,email_relationship_id));
    insert into email_threads values
      ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001'),
      ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002');
    insert into email_messages values
      ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001'),
      ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002');
    insert into nodes values
      ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',null),
      ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',null);
    insert into node_textboxes(textbox_id,company_id,node_id) values
      ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001'),
      ('50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001'),
      ('50000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002');
    insert into email_relationships(resource_type,email_message_id,company_id,resource_id,email_thread_id,email_relationship_id) values
      ('node','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001'),
      ('node','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000002');
  `);
  if (duplicateEdge) sql("insert into email_relationships select resource_type,email_message_id,company_id,created_timestamp,resource_textbox_id,resource_id,email_thread_id,'60000000-0000-0000-0000-000000000099' from email_relationships where email_relationship_id='60000000-0000-0000-0000-000000000001'");
  if (legacyChats || conflictingLegacyChats || unsafeConflictingLegacyChats) sql(`
    insert into node_textbox_chats(company_id,chat_id,node_id,textbox_id,selection_source,selection_email_message_id,message) values
      ('10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000010','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','email','30000000-0000-0000-0000-000000000001','legacy A'),
      ('10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000011','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','email','30000000-0000-0000-0000-000000000001','legacy B')
  `);
  if (legacyChats) sql(`
    insert into node_textbox_chats(company_id,chat_id,node_id,textbox_id,selection_source,selection_email_message_id,message) values
      ('10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000012','40000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000003','email','30000000-0000-0000-0000-000000000001','legacy other Node')
  `);
  if (conflictingLegacyChats || unsafeConflictingLegacyChats) sql(`
    insert into node_textbox_chats(company_id,chat_id,node_id,textbox_id,selection_source,selection_email_message_id,message) values
      ('10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000013','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002','email','30000000-0000-0000-0000-000000000001','conflicting legacy chat')
  `);
  if (unsafeConflictingLegacyChats) sql(`
    update node_textboxes
    set body_json='{"format":"mango-tiptap-json","schema_version":"1","document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"keep this work"}]}]},"annotations":[]}'
    where textbox_id='50000000-0000-0000-0000-000000000002'
  `);
}

try {
  if (!external) {
    run(initdb, ["-D", data, "-A", "trust", "-U", "postgres", "--no-locale"], { stdio: "pipe" });
    run(pgCtl, ["-D", data, "-l", log, "-o", `-p ${port} -h ${host}`, "-w", "start"], { stdio: "ignore" });
    started = true;
  }
  const version = Number(sql("show server_version_num").match(/\b(\d{6})\b/)?.[1]);
  if (version < 170000 || version >= 190000) throw new Error(`unsupported disposable PostgreSQL version ${version}`);

  console.log("checking reordered columns and valid existing multi-Node thread");
  installShape();
  runMigration();
  if (scalar("select count(distinct resource_id) from email_relationships where email_thread_id='20000000-0000-0000-0000-000000000001'") !== "2") throw new Error("valid multi-Node thread was not preserved");
  runMigration();

  console.log("checking safe repair of older email chats");
  installShape({ legacyChats: true });
  runMigration();
  if (scalar("select count(*) from email_relationships where resource_type='node' and resource_textbox_id is not null") !== "2") throw new Error("older email chats did not create exactly two missing textbox relationships");
  if (scalar("select count(*) from node_textbox_chats where selection_source='email'") !== "3") throw new Error("older email chats were changed during relationship repair");
  runMigration();
  if (scalar("select count(*) from email_relationships where resource_type='node' and resource_textbox_id is not null") !== "2") throw new Error("repeated migration duplicated repaired textbox relationships");

  console.log("checking safe consolidation of duplicate older chat textboxes");
  installShape({ conflictingLegacyChats: true });
  runMigration();
  if (scalar("select count(distinct textbox_id) from node_textbox_chats where selection_source='email'") !== "1") throw new Error("duplicate older chat textboxes were not safely consolidated");
  if (scalar("select count(*) from node_textbox_chats where selection_source='email'") !== "3") throw new Error("safe chat textbox consolidation removed a chat");
  if (scalar("select count(*) from node_textboxes") !== "3") throw new Error("safe chat textbox consolidation removed a textbox");
  if (scalar("select count(*) from email_relationships where resource_textbox_id is not null") !== "1") throw new Error("safe chat textbox consolidation did not create one exact relationship");

  console.log("checking nonempty conflicting textbox rollback");
  installShape({ unsafeConflictingLegacyChats: true });
  const unsafeConflictingOutput = runMigration(true);
  if (!unsafeConflictingOutput.includes("email_message_chat_textbox_repair_requires_review")) throw new Error("nonempty conflicting textbox did not stop with the expected reason");
  if (scalar("select count(distinct textbox_id) from node_textbox_chats where selection_source='email'") !== "2") throw new Error("nonempty conflicting textbox STOP moved a chat");
  if (scalar("select count(*) from email_relationships where resource_textbox_id is not null") !== "0") throw new Error("nonempty conflicting textbox STOP changed relationships");

  installShape();
  runMigration();

  sql("insert into email_relationships values ('node','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',now(),'50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000003')");
  sql("insert into email_relationships values ('node','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',now(),'50000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000004')");
  sql("insert into email_relationships values ('node','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',now(),'50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000005')", true);
  sql("insert into email_relationships values ('node','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',now(),'50000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000006')", true);
  sql("insert into email_relationships values ('node','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',now(),null,'40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000007')", true);
  sql("insert into node_textbox_chats(company_id,chat_id,node_id,textbox_id,selection_source,selection_email_message_id,message) values ('10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','email','30000000-0000-0000-0000-000000000001','A'),('10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000003','email','30000000-0000-0000-0000-000000000001','B')");
  sql("insert into node_textbox_chats(company_id,chat_id,node_id,textbox_id,selection_source,selection_email_message_id,message) values ('10000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002','email','30000000-0000-0000-0000-000000000001','invalid')", true);
  sql("begin; delete from email_relationships where email_relationship_id='60000000-0000-0000-0000-000000000003'; commit", true);
  if (scalar("select count(*) from email_relationships where email_relationship_id='60000000-0000-0000-0000-000000000003'") !== "1") throw new Error("failed deferred delete did not roll back");

  console.log("checking duplicate semantic-edge rollback");
  installShape({ duplicateEdge: true });
  runMigration(true);
  if (scalar("select count(*) from email_relationships") !== "3") throw new Error("duplicate-edge STOP changed data");

  console.log("checking exact-shape drift rollback");
  installShape({ extraRelationshipColumn: true });
  runMigration(true);
  if (scalar("select count(*) from information_schema.columns where table_name='email_drafts' and column_name='email_thread_id'") !== "0") throw new Error("shape STOP did not roll back draft DDL");

  console.log(`Node email relationship disposable PostgreSQL contract passed on server_version_num=${version}`);
} finally {
  if (started) spawnSync(pgCtl, ["-D", data, "-m", "fast", "-w", "stop"], { encoding: "utf8" });
  if (root) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
