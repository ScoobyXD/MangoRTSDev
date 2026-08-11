import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const schema = join(repoRoot, "backend", "db", "schema.sql");
const migration = join(repoRoot, "backend", "db", "migrations", "20260811_z_huddle_explorer_logic_gates_only.sql");

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

const initdb = postgresBinary("initdb");
const pgCtl = postgresBinary("pg_ctl");
const psql = postgresBinary("psql");
const root = mkdtempSync(join(tmpdir(), "mangorts-huddle-explorer-pg-"));
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

function sql(statement, expectFailure = false) {
  const result = spawnSync(psql, ["-X", "-h", host, "-p", String(port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", statement], { encoding: "utf8", timeout: 30_000, env });
  if (result.error) throw result.error;
  if (!expectFailure && result.status !== 0) throw new Error(result.stderr || result.stdout);
  if (expectFailure && result.status === 0) throw new Error(`expected SQL to fail: ${statement}`);
  return `${result.stdout}\n${result.stderr}`;
}

function scalar(statement) {
  const result = spawnSync(psql, ["-X", "-t", "-A", "-h", host, "-p", String(port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", statement], { encoding: "utf8", timeout: 30_000, env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

function runFile(path) {
  const result = spawnSync(psql, ["-X", "-h", host, "-p", String(port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", path], { encoding: "utf8", timeout: 60_000, env });
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

  runFile(schema);
  sql("alter table huddle_explorer_items drop constraint huddle_explorer_items_huddle_type_chk; alter table huddle_explorer_items add constraint huddle_explorer_items_huddle_type_chk check (huddle_type in ('huddle_logic_gate','huddle_node'))");
  sql(`
    insert into companies(company_id,name) values ('10000000-0000-4000-8000-000000000001','Huddle Explorer Contract');
    insert into huddle_logic_gates(company_id,huddle_logic_gate_id,header) values
      ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Daily Huddle'),
      ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','Weekly Huddle');
    insert into huddle_nodes(company_id,huddle_node_id,huddle_logic_gate_id,name) values
      ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Old Node Placement');
    insert into huddle_explorer_items(company_id,huddle_explorer_item_id,huddle_type,resource_huddle_resource_id) values
      ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','huddle_logic_gate','20000000-0000-4000-8000-000000000001'),
      ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002','huddle_node','30000000-0000-4000-8000-000000000001');
    insert into recycle_bin_items(company_id,recycle_bin_item_id,object_kind,object_id,object_label,restore_payload) values
      ('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','huddle_node','30000000-0000-4000-8000-000000000001','Deleted Node','{"huddle_nodes":[{"huddle_node_id":"30000000-0000-4000-8000-000000000001"}],"huddle_explorer_items":[{"huddle_type":"huddle_node"}]}'::jsonb),
      ('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002','huddle_explorer_item','40000000-0000-4000-8000-000000000002','Old Node Placement','{"huddle_explorer_items":[{"huddle_type":"huddle_node"}]}'::jsonb);
  `);

  runFile(migration);
  expectScalar("select count(*) from huddle_explorer_items where huddle_type='huddle_logic_gate'", "1", "Huddle Logic Gate placement retained");
  expectScalar("select count(*) from huddle_explorer_items where huddle_type='huddle_node'", "0", "live Huddle Node placements removed");
  expectScalar("select count(*) from information_schema.columns where table_schema='public' and table_name='huddle_explorer_items' and column_name='huddle_type'", "1", "typed discriminator column retained");
  expectScalar("select count(*) from recycle_bin_items where object_kind='huddle_node' and not (restore_payload ? 'huddle_explorer_items')", "1", "Huddle Node recycle payload placement removed");
  expectScalar("select count(*) from recycle_bin_items where object_kind='huddle_explorer_item'", "0", "obsolete Huddle Node placement recycle row removed");
  expectScalar("select position('huddle_node' in pg_get_functiondef('mangorts_validate_huddle_explorer_item()'::regprocedure))", "0", "Huddle Node validator branch removed");
  sql("insert into huddle_explorer_items(company_id,huddle_explorer_item_id,huddle_type,resource_huddle_resource_id) values ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000003','huddle_logic_gate','20000000-0000-4000-8000-000000000002')");
  sql("insert into huddle_explorer_items(company_id,huddle_explorer_item_id,huddle_type,resource_huddle_resource_id) values ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000004','huddle_node','30000000-0000-4000-8000-000000000001')", true);

  runFile(migration);
  expectScalar("select count(*) from huddle_explorer_items", "2", "idempotent migration retains only Huddle Logic Gates");
  console.log(`Huddle Explorer disposable PostgreSQL contract passed on server_version_num=${version}`);
} finally {
  if (started) spawnSync(pgCtl, ["-D", data, "-m", "fast", "-w", "stop"], { encoding: "utf8" });
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
