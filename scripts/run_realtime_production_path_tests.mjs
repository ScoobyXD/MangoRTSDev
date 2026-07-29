import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");
const backend = resolve(root, "backend");
const windows = process.platform === "win32";
const exeSuffix = windows ? ".exe" : "";
const pgBin = process.env.POSTGRES_BIN || (windows ? "C:\\Program Files\\PostgreSQL\\18\\bin" : "");
const pgTools = Object.fromEntries(["initdb", "pg_ctl", "createdb", "psql"].map((name) => [
  name,
  pgBin ? join(pgBin, name + exeSuffix) : name,
]));

for (const path of Object.values(pgTools)) {
  if (pgBin && !existsSync(path)) throw new Error("PostgreSQL executable missing: " + path);
}

const tempRoot = mkdtempSync(join(tmpdir(), "mangorts-realtime-production-path-"));
const pgData = join(tempRoot, "postgres");
const pgLog = join(tempRoot, "postgres.log");
const migrationDir = join(tempRoot, "migrations");
const legacyMigrationDir = join(tempRoot, "legacy-migrations");
const goBuildParent = join(backend, "go-build-cache");
mkdirSync(goBuildParent, { recursive: true });
const goBuildRoot = mkdtempSync(join(goBuildParent, "realtime-production-path-"));
const migrateExe = join(goBuildRoot, "miraeopus-migrate" + exeSuffix);
const password = "mangorts-disposable-test-only";
let pgStarted = false;
const useWindowsGoToolchainRunner = windows;

function run(label, file, args, options = {}) {
  if (useWindowsGoToolchainRunner && file === migrateExe) {
    return run(label, "go", ["run", "./cmd/miraeopus-migrate", ...args], options);
  }
  process.stdout.write("\n--- " + label + " ---\n");
  const resolvedFile = typeof file === "string" ? resolve(file) : "";
  const disposableWindowsExecutable = windows
    && typeof file === "string"
    && [tempRoot, goBuildRoot].some((parent) => resolvedFile.startsWith(resolve(parent) + sep))
    && file.toLowerCase().endsWith(".exe");
  for (let attempt = 0; ; attempt += 1) {
    try {
      return execFileSync(file, args, {
        cwd: options.cwd || root,
        env: options.env || process.env,
        input: options.input,
        encoding: "utf8",
        stdio: options.stdio || ["pipe", "inherit", "inherit"],
      });
    } catch (cause) {
      const transientLaunchBlock = disposableWindowsExecutable
        && cause?.status === null
        && (cause?.code === "UNKNOWN" || cause?.code === "EPERM" || cause?.code === "EBUSY");
      if (!transientLaunchBlock || attempt >= 19) throw cause;
      if (attempt === 0) process.stderr.write("Windows temporarily blocked the disposable test executable; retrying.\n");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
}

function capture(file, args, options = {}) {
  return execFileSync(file, args, {
    cwd: options.cwd || root,
    env: options.env || process.env,
    input: options.input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

async function freePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

function databaseEnv(port, database) {
  return {
    ...process.env,
    PGHOST: "127.0.0.1",
    PGPORT: String(port),
    PGUSER: "postgres",
    PGPASSWORD: password,
    DB_HOST: "127.0.0.1",
    DB_PORT: String(port),
    DB_USER: "postgres",
    DB_PASSWORD: password,
    DB_NAME: database,
    DB_SSLMODE: "disable",
    DB_CONNECT_TIMEOUT_SECONDS: "5",
  };
}

function psql(port, database, sql) {
  return capture(pgTools.psql, ["-X", "-v", "ON_ERROR_STOP=1", "-At", "-d", database], {
    env: databaseEnv(port, database),
    input: sql,
  });
}

const COMPANY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_A = "11111111-1111-4111-8111-111111111111";
const NODE_A = "aaaaaaaa-0000-4000-8000-000000000001";
const DOC_A = "aaaaaaaa-0000-4000-8000-000000000301";
const INITIAL_RICH_EDITOR_HTML = '<!-- mango-editor-html-v1 --><p><strong><span style="font-size:16px">nice prompt </span></strong><span style="font-size:14px">review everything</span></p><p>second row</p><p><br></p>';
const STALE_STRUCTURED_EDITOR_STATE = JSON.stringify({ ops: [{ insert: "stale structured collaboration content" }] });

async function main() {
  const pgPort = await freePort();
  mkdirSync(pgData, { recursive: true });
  mkdirSync(migrationDir, { recursive: true });
  mkdirSync(legacyMigrationDir, { recursive: true });

  run("Initialize disposable PostgreSQL", pgTools.initdb, [
    "-D", pgData, "--username=postgres", "--auth=trust", "--encoding=UTF8", "--no-locale",
  ]);
  const postgresOptions = ["-p", String(pgPort), "-h", "127.0.0.1"];
  if (!windows) postgresOptions.push("-k", tempRoot);
  try {
    run("Start disposable PostgreSQL", pgTools.pg_ctl, [
      "-D", pgData, "-l", pgLog, "-o", postgresOptions.join(" "), "-w", "start",
    ]);
  } catch (cause) {
    if (existsSync(pgLog)) {
      process.stderr.write("\nPostgreSQL startup log:\n" + readFileSync(pgLog, "utf8"));
    }
    throw cause;
  }
  pgStarted = true;
  for (const database of ["mangorts_realtime_test", "mangorts_realtime_legacy"]) {
    run("Create " + database, pgTools.createdb, [database], { env: databaseEnv(pgPort, "postgres") });
  }

  run("Build migration runner", "go", ["build", "-o", migrateExe, "./cmd/miraeopus-migrate"], { cwd: backend });
  for (const name of ["20260715_unified_realtime_collaboration.sql", "20260715_zz_edit_or_no_access.sql"]) {
    copyFileSync(resolve(backend, "db", "migrations", name), resolve(migrationDir, name));
    copyFileSync(resolve(backend, "db", "migrations", name), resolve(legacyMigrationDir, name));
  }

  const cleanEnv = databaseEnv(pgPort, "mangorts_realtime_test");
  run("Apply canonical schema to clean database", migrateExe, [
    "-mode", "schema", "-schema", resolve(backend, "db", "schema.sql"), "-migrations", migrationDir,
  ], { cwd: backend, env: cleanEnv });
  run("Record the two historical collaboration migrations on the clean canonical schema", migrateExe, [
    "-mode", "migrate", "-migrations", migrationDir,
  ], { cwd: backend, env: cleanEnv });
  copyFileSync(resolve(backend, "db", "migrations", "20260716_restore_rich_html_collaboration.sql"), resolve(migrationDir, "20260716_restore_rich_html_collaboration.sql"));
  run("Apply the rich HTML collaboration migration on the clean canonical schema", migrateExe, [
    "-mode", "migrate", "-migrations", migrationDir,
  ], { cwd: backend, env: cleanEnv });
  copyFileSync(resolve(backend, "db", "migrations", "20260718_tiptap_json_foundation.sql"), resolve(migrationDir, "20260718_tiptap_json_foundation.sql"));
  run("Apply the inactive Tiptap JSON foundation migration on the clean canonical schema", migrateExe, [
    "-mode", "migrate", "-migrations", migrationDir,
  ], { cwd: backend, env: cleanEnv });
  copyFileSync(resolve(backend, "db", "migrations", "20260719_zz_tiptap_annotation_positions.sql"), resolve(migrationDir, "20260719_zz_tiptap_annotation_positions.sql"));
  run("Apply revision-bound Tiptap annotation positions on the clean canonical schema", migrateExe, [
    "-mode", "migrate", "-migrations", migrationDir,
  ], { cwd: backend, env: cleanEnv });
  copyFileSync(resolve(backend, "db", "migrations", "20260728_durable_email_thread_download_jobs.sql"), resolve(migrationDir, "20260728_durable_email_thread_download_jobs.sql"));
  run("Apply durable email-thread download jobs on the clean canonical schema", migrateExe, [
    "-mode", "migrate", "-migrations", migrationDir,
  ], { cwd: backend, env: cleanEnv });
  run("Prove recorded migration rerun is idempotent", migrateExe, [
    "-mode", "migrate", "-migrations", migrationDir,
  ], { cwd: backend, env: cleanEnv });
  assert.equal(psql(pgPort, "mangorts_realtime_test", "select count(*) from schema_migrations where version like '20260715%';"), "2");
  assert.equal(psql(pgPort, "mangorts_realtime_test", "select count(*) from schema_migrations where version like '20260716%';"), "1");
  assert.equal(psql(pgPort, "mangorts_realtime_test", "select count(*) from schema_migrations where version like '20260718%';"), "1");
  assert.equal(psql(pgPort, "mangorts_realtime_test", "select count(*) from schema_migrations where version='20260719_zz_tiptap_annotation_positions.sql';"), "1");
  assert.equal(psql(pgPort, "mangorts_realtime_test", "select count(*) from information_schema.columns where table_name in ('editor_json_documents','editor_json_operations','editor_json_versions') and column_name='canonical_annotations';"), "3");
  assert.equal(psql(pgPort, "mangorts_realtime_test", "select count(*) from schema_migrations where version='20260728_durable_email_thread_download_jobs.sql';"), "1");
  assert.equal(psql(pgPort, "mangorts_realtime_test", "select count(*) from information_schema.columns where table_name='communications_email_threads' and column_name in ('download_status','last_download_error');"), "2");
  assert.equal(psql(pgPort, "mangorts_realtime_test", "select count(*) from information_schema.tables where table_name='communications_email_thread_download_jobs';"), "1");
  assert.equal(psql(pgPort, "mangorts_realtime_test", "select count(*) from workspace_editor_formats;"), "0");
  assert.equal(psql(pgPort, "mangorts_realtime_test", "select count(*) from information_schema.tables where table_name in ('workspace_editor_formats','editor_json_documents','editor_json_operations','editor_json_versions');"), "4");
  assert.equal(psql(pgPort, "mangorts_realtime_test", "select count(*) from pg_constraint where conname in ('editor_collaboration_documents_model_version_chk','editor_collaboration_operations_kind_chk');"), "0");
  assert.equal(psql(pgPort, "mangorts_realtime_test", "select count(*) from information_schema.columns where table_name='editor_collaboration_documents' and column_name='canonical_html';"), "1");
  assert.equal(psql(pgPort, "mangorts_realtime_test", "select count(*) from information_schema.columns where table_name='editor_collaboration_operations' and column_name in ('patch','requires_snapshot');"), "2");

  const legacySQL = [
    "create type information_type as enum ('Text box');",
    "create table companies(company_id uuid primary key,name text not null);",
    "create table users(user_id uuid primary key,cognito_subject text not null unique,email text not null,display_name text not null);",
    "create table node_projection_table(company_id uuid not null,node_id uuid not null,information_id uuid not null,type information_type not null,information text not null,is_deleted boolean not null default false,revision bigint not null default 1,created_timestamp timestamptz not null default now(),updated_timestamp timestamptz not null default now(),primary key(company_id,node_id,information_id));",
    "create table logic_gate_projection_table(company_id uuid not null,logic_gate_id uuid not null,information_id uuid not null,type information_type not null,information text not null,is_deleted boolean not null default false,revision bigint not null default 1,created_timestamp timestamptz not null default now(),updated_timestamp timestamptz not null default now(),primary key(company_id,logic_gate_id,information_id));",
    "create table project_projection_table(company_id uuid not null,project_id uuid not null,information_id uuid not null,type information_type not null,information text not null,created_timestamp timestamptz not null default now(),updated_timestamp timestamptz not null default now(),primary key(company_id,project_id,information_id));",
    "create unique index idx_logic_gate_projection_table_one_text_box on logic_gate_projection_table(company_id,logic_gate_id,type) where type='Text box'::information_type;",
    "create table resource_permissions(company_id uuid not null,resource_type text not null,resource_id uuid not null,subject_type text not null default 'user',subject_id uuid not null,user_id uuid,access_level text not null,created_timestamp timestamptz not null default now(),updated_timestamp timestamptz not null default now(),constraint resource_permissions_access_level_chk check(access_level in('no_access','view','edit','admin')),primary key(company_id,resource_type,resource_id,subject_type,subject_id));",
    "create table resource_permission_subtree_applications(application_id bigserial primary key,policy_sequence bigint not null,company_id uuid not null,ancestor_resource_type text not null,ancestor_resource_id uuid not null,rule_key text not null,subject_type text,subject_id uuid,access_level text,deleted boolean not null default false,created_timestamp timestamptz not null default now(),constraint resource_permission_subtree_applications_access_level_chk check(access_level is null or access_level in('no_access','view','edit','admin')),constraint resource_permission_subtree_applications_rule_shape_chk check((rule_key='__default__' and subject_type is null and subject_id is null and access_level in('view','edit','admin','no_access') and not deleted) or (rule_key<>'__default__' and subject_type in('user','group') and subject_id is not null and (deleted or access_level in('view','edit','admin','no_access')))));",
    "insert into companies values('" + COMPANY_A + "','Legacy company');",
    "insert into users values('" + USER_A + "','legacy-user','legacy@example.test','Legacy User');",
    "insert into resource_permissions values('" + COMPANY_A + "','node','" + NODE_A + "','user','" + USER_A + "','" + USER_A + "','view',now(),now());",
    "insert into resource_permission_subtree_applications(policy_sequence,company_id,ancestor_resource_type,ancestor_resource_id,rule_key,subject_type,subject_id,access_level) values(1,'" + COMPANY_A + "','node','" + NODE_A + "','__default__',null,null,'admin'),(1,'" + COMPANY_A + "','node','" + NODE_A + "','user:" + USER_A + "','user','" + USER_A + "','view');",
  ].join("\n");
  psql(pgPort, "mangorts_realtime_legacy", legacySQL);
  run("Run the historical migrations against the legacy fixture", migrateExe, [
    "-mode", "migrate", "-migrations", legacyMigrationDir,
  ], { cwd: backend, env: databaseEnv(pgPort, "mangorts_realtime_legacy") });
  assert.equal(psql(pgPort, "mangorts_realtime_legacy", "select string_agg(access_level,',' order by access_level) from resource_permissions;"), "edit");
  assert.equal(psql(pgPort, "mangorts_realtime_legacy", "select string_agg(access_level,',' order by application_id) from resource_permission_subtree_applications;"), "edit,edit");
  assert.equal(psql(pgPort, "mangorts_realtime_legacy", "select mangorts_access_level_rank('no_access')||','||mangorts_access_level_rank('edit')||','||mangorts_access_level_rank('view');"), "0,1,0");
  assert.equal(psql(pgPort, "mangorts_realtime_legacy", "select to_regclass('idx_logic_gate_projection_table_one_text_box') is null and to_regclass('idx_logic_gate_projection_table_text_boxes') is not null;"), "t");

  psql(pgPort, "mangorts_realtime_legacy", [
    "insert into node_projection_table(company_id,node_id,information_id,type,information,is_deleted,revision) values('" + COMPANY_A + "','" + NODE_A + "','" + DOC_A + "','Text box','" + INITIAL_RICH_EDITOR_HTML.replaceAll("'", "''") + "',false,7);",
    "insert into editor_collaboration_documents(company_id,resource_type,resource_id,document_id,revision,snapshot_revision,snapshot_state) values('" + COMPANY_A + "','node','" + NODE_A + "','" + DOC_A + "',1,0,'" + STALE_STRUCTURED_EDITOR_STATE.replaceAll("'", "''") + "'::jsonb);",
    "insert into editor_collaboration_operations(company_id,resource_type,resource_id,document_id,revision,operation_id,client_id,base_revision,delta,event_id) values('" + COMPANY_A + "','node','" + NODE_A + "','" + DOC_A + "',1,'legacy-operation','legacy-client',0,'{\"ops\":[{\"insert\":\"stale\"}]}'::jsonb,'44444444-4444-4444-8444-444444444444');",
  ].join("\n"));
  copyFileSync(resolve(backend, "db", "migrations", "20260716_restore_rich_html_collaboration.sql"), resolve(legacyMigrationDir, "20260716_restore_rich_html_collaboration.sql"));
  run("Migrate legacy structured state to authoritative projection rich HTML", migrateExe, [
    "-mode", "migrate", "-migrations", legacyMigrationDir,
  ], { cwd: backend, env: databaseEnv(pgPort, "mangorts_realtime_legacy") });
  run("Prove legacy commands are safe before the Node V2 schema exists", "go", [
    "test", "./internal/store", "-run", "TestPostgresPreV2TimelineBridgeIsCapabilityGated", "-count=1", "-v",
  ], { cwd: backend, env: { ...databaseEnv(pgPort, "mangorts_realtime_legacy"), MANGORTS_PRE_V2_POSTGRES_TEST: "1" } });

  copyFileSync(resolve(backend, "db", "migrations", "20260718_tiptap_json_foundation.sql"), resolve(legacyMigrationDir, "20260718_tiptap_json_foundation.sql"));
  run("Add the inactive Tiptap JSON foundation without converting the legacy fixture", migrateExe, [
    "-mode", "migrate", "-migrations", legacyMigrationDir,
  ], { cwd: backend, env: databaseEnv(pgPort, "mangorts_realtime_legacy") });
  copyFileSync(resolve(backend, "db", "migrations", "20260719_zz_tiptap_annotation_positions.sql"), resolve(legacyMigrationDir, "20260719_zz_tiptap_annotation_positions.sql"));
  run("Add revision-bound Tiptap annotation positions without converting the legacy fixture", migrateExe, [
    "-mode", "migrate", "-migrations", legacyMigrationDir,
  ], { cwd: backend, env: databaseEnv(pgPort, "mangorts_realtime_legacy") });
  assert.equal(psql(pgPort, "mangorts_realtime_legacy", "select count(*) from information_schema.columns where table_name in ('editor_json_documents','editor_json_operations','editor_json_versions') and column_name='canonical_annotations';"), "3");
  assert.equal(psql(pgPort, "mangorts_realtime_legacy", "select canonical_html from editor_collaboration_documents where company_id='" + COMPANY_A + "' and resource_id='" + NODE_A + "' and document_id='" + DOC_A + "';"), INITIAL_RICH_EDITOR_HTML);
  assert.equal(psql(pgPort, "mangorts_realtime_legacy", "select count(*) from workspace_editor_formats;"), "0");
  assert.equal(psql(pgPort, "mangorts_realtime_legacy", "select count(*) from editor_json_documents;"), "0");
  assert.equal(psql(pgPort, "mangorts_realtime_legacy", "select (patch->>'start_utf8')||','||(patch->>'delete_utf8')||','||(patch->>'insert')||','||requires_snapshot::text from editor_collaboration_operations where operation_id='legacy-operation';"), "0,0,,true");
  assert.equal(psql(pgPort, "mangorts_realtime_legacy", "select count(*) from information_schema.columns where table_name in ('editor_collaboration_documents','editor_collaboration_operations') and column_name in ('model_version','snapshot_revision','snapshot_state','accumulated_delta_bytes','operation_kind','delta');"), "0");

  run("Real PostgreSQL producer atomicity and retry tests", "go", [
    "test", "./internal/store", "./internal/http", "-run", "TestPostgresRealtime", "-count=1", "-v",
  ], { cwd: backend, env: { ...cleanEnv, MANGORTS_REALTIME_POSTGRES_TEST: "1" } });

  process.stdout.write("\nProduction-path PostgreSQL tests passed.\n");
}

try {
  await main();
} finally {
  if (pgStarted) {
    try {
      execFileSync(pgTools.pg_ctl, ["-D", pgData, "-m", "fast", "-w", "stop"], { stdio: "ignore" });
    } catch {
      if (existsSync(pgLog)) process.stderr.write(readFileSync(pgLog, "utf8"));
    }
  }
  const resolved = resolve(tempRoot);
  const parent = resolve(tmpdir());
  if (!(resolved.startsWith(parent + "\\") || resolved.startsWith(parent + "/"))) {
    throw new Error("Refusing to remove unexpected integration path: " + resolved);
  }
  if (!resolved.includes("mangorts-realtime-production-path-")) {
    throw new Error("Refusing to remove unrecognized integration path: " + resolved);
  }
  rmSync(resolved, { recursive: true, force: true });
  const resolvedGoBuildRoot = resolve(goBuildRoot);
  const resolvedGoBuildParent = resolve(goBuildParent);
  if (!(resolvedGoBuildRoot.startsWith(resolvedGoBuildParent + "\\") || resolvedGoBuildRoot.startsWith(resolvedGoBuildParent + "/"))) {
    throw new Error("Refusing to remove unexpected Go build path: " + resolvedGoBuildRoot);
  }
  if (!resolvedGoBuildRoot.includes("realtime-production-path-")) {
    throw new Error("Refusing to remove unrecognized Go build path: " + resolvedGoBuildRoot);
  }
  rmSync(resolvedGoBuildRoot, { recursive: true, force: true });
}
