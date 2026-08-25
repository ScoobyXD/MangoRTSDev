import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const schema = join(repoRoot, "backend", "db", "schema.sql");
const migration = join(repoRoot, "backend", "db", "migrations", "20260810_zzzz_raci_tabs.sql");
const targetedMigration = join(repoRoot, "backend", "db", "migrations", "20260811_zz_targeted_raci_tabs.sql");
const postgresStoreSource = readFileSync(join(repoRoot, "backend", "internal", "store", "postgres_raci_tabs.go"), "utf8");

function goSQLConstant(name) {
  const match = postgresStoreSource.match(new RegExp("const " + name + " = `([\\s\\S]*?)`"));
  if (!match) throw new Error(`missing Go SQL constant ${name}`);
  return match[1];
}

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
const external = Boolean(process.env.RACI_TABS_POSTGRES17_HOST?.trim());
const initdb = external ? null : postgresBinary("initdb");
const pgCtl = external ? null : postgresBinary("pg_ctl");
const root = external ? null : mkdtempSync(join(tmpdir(), "mangorts-raci-tabs-pg-"));
const data = root && join(root, "data");
const log = root && join(root, "postgres.log");
const host = process.env.RACI_TABS_POSTGRES17_HOST?.trim() || "127.0.0.1";
let port = Number(process.env.RACI_TABS_POSTGRES17_PORT || 0);
if (!external) {
  const socket = createServer();
  await new Promise((accept, reject) => socket.listen(0, host, (error) => error ? reject(error) : accept()));
  port = socket.address().port;
  await new Promise((accept) => socket.close(accept));
}
const database = process.env.RACI_TABS_POSTGRES17_DATABASE?.trim() || "postgres";
const user = process.env.RACI_TABS_POSTGRES17_USER?.trim() || "postgres";
const env = { ...process.env, PGCONNECT_TIMEOUT: "5", PGPASSWORD: process.env.RACI_TABS_POSTGRES17_PASSWORD || process.env.PGPASSWORD || "" };
let started = false;

function run(binary, args, options = {}) {
  return execFileSync(binary, args, { encoding: "utf8", ...options });
}

function sql(statement, expectFailure = false) {
  const result = spawnSync(psql, ["-X", "-h", host, "-p", String(port), "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1", "-c", statement], { encoding: "utf8", timeout: 30_000, env });
  if (result.error) throw result.error;
  if (!expectFailure && result.status !== 0) throw new Error(result.stderr || result.stdout);
  if (expectFailure && result.status === 0) throw new Error(`expected SQL to fail: ${statement}`);
  return `${result.stdout}\n${result.stderr}`;
}

function scalar(statement) {
  const result = spawnSync(psql, ["-X", "-t", "-A", "-h", host, "-p", String(port), "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1", "-c", statement], { encoding: "utf8", timeout: 30_000, env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

function runFile(path, expectFailure = false) {
  const result = spawnSync(psql, ["-X", "-h", host, "-p", String(port), "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1", "-f", path], { encoding: "utf8", timeout: 60_000, env });
  if (result.error) throw result.error;
  if (!expectFailure && result.status !== 0) throw new Error(result.stderr || result.stdout);
  if (expectFailure && result.status === 0) throw new Error(`expected ${path} to reject schema drift`);
  return `${result.stdout}\n${result.stderr}`;
}

function expectScalar(statement, expected, message) {
  const actual = scalar(statement);
  if (actual !== expected) throw new Error(`${message}: got ${actual}, want ${expected}`);
}

try {
  if (!external) {
    run(initdb, ["-D", data, "-A", "trust", "-U", "postgres", "--no-locale"], { stdio: "pipe" });
    run(pgCtl, ["-D", data, "-l", log, "-o", `-p ${port} -h ${host}`, "-w", "start"], { stdio: "ignore" });
    started = true;
  }
  const version = Number(scalar("show server_version_num"));
  if (version < 170000 || version >= 190000) throw new Error(`unsupported disposable PostgreSQL version ${version}`);

  runFile(schema);
  runFile(migration);
  runFile(targetedMigration);
  runFile(targetedMigration);
  expectScalar("select count(*) from information_schema.columns where table_schema='public' and table_name='raci_tabs_items'", "9", "raci_tabs_items exact column count");
  expectScalar("select count(*) from information_schema.columns where table_schema='public' and table_name='raci_tabs_folders'", "9", "raci_tabs_folders exact column count");

  sql(`
    insert into companies(company_id,name) values ('10000000-0000-4000-8000-000000000001','RACI Tabs Contract');
    insert into users(user_id,cognito_subject,email,display_name)
    select ('20000000-0000-4000-8000-' || lpad(value::text,12,'0'))::uuid,
           'raci-user-' || value,
           'raci-user-' || value || '@example.com',
           'RACI User ' || value
    from generate_series(1,20) value;
    insert into company_memberships(company_id,user_id,role)
    select '10000000-0000-4000-8000-000000000001',user_id,'company_user' from users where cognito_subject like 'raci-user-%';
    insert into company_user_groups(company_id,group_id,parent_group_id,name,position) values
      ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',null,'Delivery',1000),
      ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','Nested Delivery',1000);
    insert into company_user_group_members(company_id,group_id,user_id)
    select '10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002',user_id
    from users where cognito_subject like 'raci-user-%';
    insert into logic_gates(company_id,logic_gate_id,header,created_timestamp) values
      ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','Gate One','2026-08-10T00:00:00Z'),
      ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002','Gate Two','2026-08-10T00:00:01Z');
    insert into resource_gvic_settings(company_id,resource_type,resource_id,assignment_mode,customized_sequence,parent_link_sequence)
    values
      ('10000000-0000-4000-8000-000000000001','logic_gate','40000000-0000-4000-8000-000000000001','customized',nextval('resource_gvic_change_sequence'),0),
      ('10000000-0000-4000-8000-000000000001','logic_gate','40000000-0000-4000-8000-000000000002','customized',nextval('resource_gvic_change_sequence'),0);
    insert into resource_gvic_assignments(company_id,resource_type,resource_id,role,principal_type,principal_id) values
      ('10000000-0000-4000-8000-000000000001','logic_gate','40000000-0000-4000-8000-000000000001','consulted','group','30000000-0000-4000-8000-000000000001'),
      ('10000000-0000-4000-8000-000000000001','logic_gate','40000000-0000-4000-8000-000000000002','consulted','group','30000000-0000-4000-8000-000000000001');
  `);
  expectScalar("select count(*) from raci_tabs_items", "40", "twenty-member nested-group fan-out across two gates");

  sql("truncate raci_tabs_items");
  runFile(migration);
  runFile(targetedMigration);
  expectScalar("select count(*) from raci_tabs_items", "40", "deterministic migration backfill");
  expectScalar("select string_agg(position::text,',' order by position) from raci_tabs_items where user_id='20000000-0000-4000-8000-000000000001'", "1000,2000", "deterministic per-role root positions");
  runFile(migration);
  runFile(targetedMigration);
  expectScalar("select count(*) from raci_tabs_items", "40", "idempotent repeated migration");

  sql("update raci_tabs_items set name='UNRELATED SENTINEL' where user_id='20000000-0000-4000-8000-000000000001' and logic_gate_id='40000000-0000-4000-8000-000000000002'");
  sql("insert into resource_gvic_assignments(company_id,resource_type,resource_id,role,principal_type,principal_id) values ('10000000-0000-4000-8000-000000000001','logic_gate','40000000-0000-4000-8000-000000000001','responsible','user','20000000-0000-4000-8000-000000000001')");
  expectScalar("select role from raci_tabs_items where user_id='20000000-0000-4000-8000-000000000001' and logic_gate_id='40000000-0000-4000-8000-000000000001'", "responsible", "winning role priority");
  expectScalar("select name from raci_tabs_items where user_id='20000000-0000-4000-8000-000000000001' and logic_gate_id='40000000-0000-4000-8000-000000000002'", "UNRELATED SENTINEL", "a direct Gate One RACI change does not recalculate Gate Two");
  sql("select mangorts_sync_raci_tabs_logic_gate('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002')");
  sql("insert into raci_tabs_folders(company_id,folder_id,user_id,role,name,position) values ('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','responsible','Personal',1000); update raci_tabs_items set folder_id='50000000-0000-4000-8000-000000000001' where user_id='20000000-0000-4000-8000-000000000001' and logic_gate_id='40000000-0000-4000-8000-000000000001'");
  sql("update resource_gvic_assignments set role='accountable' where company_id='10000000-0000-4000-8000-000000000001' and resource_type='logic_gate' and resource_id='40000000-0000-4000-8000-000000000001' and principal_type='user' and principal_id='20000000-0000-4000-8000-000000000001'");
  expectScalar("select role || ':' || coalesce(folder_id::text,'root') from raci_tabs_items where user_id='20000000-0000-4000-8000-000000000001' and logic_gate_id='40000000-0000-4000-8000-000000000001'", "accountable:root", "winning-role change clears personal placement");
  sql(`prepare raci_tab_role_counts(uuid,uuid,text) as ${goSQLConstant("raciTabRoleCountsSQL")}; execute raci_tab_role_counts('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','accountable')`);
  const branchOutput = sql(`prepare raci_tab_branch(uuid,uuid,text,uuid,integer,integer) as ${goSQLConstant("raciTabBranchSQL")}; execute raci_tab_branch('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','accountable',null,0,51)`);
  if (!branchOutput.includes("Gate One")) throw new Error("the exact Go branch query did not return the effective root item");
  sql("begin; update resource_gvic_assignments set role='informed' where company_id='10000000-0000-4000-8000-000000000001' and resource_type='logic_gate' and resource_id='40000000-0000-4000-8000-000000000001' and principal_type='user' and principal_id='20000000-0000-4000-8000-000000000001'; rollback");
  expectScalar("select role from raci_tabs_items where user_id='20000000-0000-4000-8000-000000000001' and logic_gate_id='40000000-0000-4000-8000-000000000001'", "accountable", "RACI synchronization transaction rollback");

  sql("update logic_gates set header='Renamed Gate One' where company_id='10000000-0000-4000-8000-000000000001' and logic_gate_id='40000000-0000-4000-8000-000000000001'");
  expectScalar("select count(*) from raci_tabs_items where logic_gate_id='40000000-0000-4000-8000-000000000001' and name='Renamed Gate One'", "20", "Logic Gate rename fan-out");
  sql("update company_user_groups set parent_group_id=null where company_id='10000000-0000-4000-8000-000000000001' and group_id='30000000-0000-4000-8000-000000000002'");
  expectScalar("select count(*) from raci_tabs_items where logic_gate_id='40000000-0000-4000-8000-000000000001'", "1", "parent-group removal reconciliation");
  sql("update company_user_groups set parent_group_id='30000000-0000-4000-8000-000000000001' where company_id='10000000-0000-4000-8000-000000000001' and group_id='30000000-0000-4000-8000-000000000002'");
  expectScalar("select count(*) from raci_tabs_items where logic_gate_id='40000000-0000-4000-8000-000000000001'", "20", "parent-group restoration reconciliation");

  sql("delete from company_user_group_members where company_id='10000000-0000-4000-8000-000000000001' and group_id='30000000-0000-4000-8000-000000000002' and user_id='20000000-0000-4000-8000-000000000020'");
  expectScalar("select count(*) from raci_tabs_items where user_id='20000000-0000-4000-8000-000000000020'", "0", "group member removal reconciliation");
  sql("insert into company_user_group_members(company_id,group_id,user_id) values ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000020')");
  expectScalar("select count(*) from raci_tabs_items where user_id='20000000-0000-4000-8000-000000000020'", "2", "group member restoration reconciliation");

  sql("update raci_tabs_items set folder_id='50000000-0000-4000-8000-000000000001' where user_id='20000000-0000-4000-8000-000000000002' and logic_gate_id='40000000-0000-4000-8000-000000000001'", true);
  expectScalar("select count(*) from raci_tabs_items where user_id='20000000-0000-4000-8000-000000000002' and folder_id is not null", "0", "cross-user and cross-role folder move rollback");

  sql("delete from logic_gates where company_id='10000000-0000-4000-8000-000000000001' and logic_gate_id='40000000-0000-4000-8000-000000000002'");
  expectScalar("select count(*) from raci_tabs_items", "20", "Logic Gate deletion removes only matching copied items");
  expectScalar("select count(*) from raci_tabs_folders", "1", "Logic Gate deletion preserves personal folders");

  sql("delete from company_memberships where company_id='10000000-0000-4000-8000-000000000001' and user_id='20000000-0000-4000-8000-000000000001'");
  expectScalar("select count(*) from raci_tabs_items where user_id='20000000-0000-4000-8000-000000000001'", "0", "membership removal deletes only that user's prepared rows");
  sql("insert into company_memberships(company_id,user_id,role) values ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','company_user')");
  expectScalar("select role from raci_tabs_items where user_id='20000000-0000-4000-8000-000000000001' and logic_gate_id='40000000-0000-4000-8000-000000000001'", "accountable", "membership addition restores the user's direct assignment");
  expectScalar("select count(*) from raci_tabs_items where user_id='20000000-0000-4000-8000-000000000001'", "1", "membership addition recalculates only resources directly assigned to that user");

  sql("alter table raci_tabs_items add column unexpected_column text");
  const driftOutput = runFile(migration, true);
  if (!driftOutput.includes("raci_tabs_schema_drift")) throw new Error("migration did not report the exact RACI Tabs schema drift reason");
  expectScalar("select count(*) from information_schema.columns where table_name='raci_tabs_items' and column_name='unexpected_column'", "1", "schema drift preflight leaves existing data unchanged");

  console.log(`RACI Tabs disposable PostgreSQL contract passed on server_version_num=${version}`);
} finally {
  if (started) spawnSync(pgCtl, ["-D", data, "-m", "fast", "-w", "stop"], { encoding: "utf8" });
  if (root) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
