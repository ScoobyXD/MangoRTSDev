import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { appendFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// This command always owns a fresh disposable cluster. It accepts no live DSN.
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const backendDir = join(repoRoot, "backend");
const database = "mangorts_attachment_cleanup_test";
const adminHost = "127.0.0.1";
function postgresBinary(name) {
  const suffix = process.platform === "win32" ? ".exe" : "";
  const candidates = [
    process.env.POSTGRES_BIN && join(process.env.POSTGRES_BIN, `${name}${suffix}`),
    process.platform === "win32" && `C:\\Program Files\\PostgreSQL\\18\\bin\\${name}.exe`,
    process.platform === "win32" && `C:\\Program Files\\PostgreSQL\\17\\bin\\${name}.exe`,
  ].filter(Boolean);
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return name;
}
const socket = createServer();
await new Promise((accept, reject) => socket.once("error", reject).listen(0, "0.0.0.0", accept));
const port = socket.address().port;
await new Promise((accept) => socket.close(accept));
let testHost = adminHost;
let client = null;
if (process.platform === "win32") {
  const route = execFileSync("wsl.exe", ["--distribution", "Ubuntu", "--exec", "ip", "route", "show", "default"], { encoding: "utf8" });
  testHost = route.match(/\bvia\s+(\d+\.\d+\.\d+\.\d+)\b/)?.[1];
  const addresses = execFileSync("wsl.exe", ["--distribution", "Ubuntu", "--exec", "hostname", "-I"], { encoding: "utf8" });
  client = addresses.match(/\b(\d+\.\d+\.\d+\.\d+)\b/)?.[1];
  if (!testHost || !client) throw new Error("could not resolve private Windows/WSL test network");
}
const fixtureRoot = mkdtempSync(join(tmpdir(), "mangorts-attachment-cleanup-pg-"));
const data = join(fixtureRoot, "data");
const log = join(fixtureRoot, "postgres.log");
const pgCtl = postgresBinary("pg_ctl");
let started = false;
try {
  execFileSync(postgresBinary("initdb"), ["-D", data, "-A", "trust", "-U", "postgres", "--no-locale", "--encoding=UTF8"], { stdio: "pipe" });
  if (client) appendFileSync(join(data, "pg_hba.conf"), `\nhost all all ${client}/32 trust\n`);
  execFileSync(pgCtl, ["-D", data, "-l", log, "-o", `-p ${port} -h ${client ? `${adminHost},${testHost}` : adminHost}`, "-w", "start"], { stdio: "ignore" });
  started = true;
  execFileSync(postgresBinary("psql"), ["-X", "-h", adminHost, "-p", String(port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `create database ${database}`], { stdio: "pipe", env: { ...process.env, PGPASSWORD: "" } });
  const testEnv = {
    MANGORTS_ATTACHMENT_CLEANUP_TEST_DATABASE_URL: `postgresql://postgres@${testHost}:${port}/${database}?sslmode=disable`,
    MANGORTS_ATTACHMENT_CLEANUP_TEST_PRIVATE_HOST_ACK: testHost,
  };
  const args = ["test", "./internal/store", "-run", "^TestPostgresAttachmentCleanupLifecycle$", "-count=1", "-v"];
  if (process.platform === "win32") {
    execFileSync("wsl.exe", ["--distribution", "Ubuntu", "--cd", backendDir, "--exec", "/usr/bin/env",
      ...Object.entries(testEnv).map(([name, value]) => `${name}=${value}`), "/usr/local/go/bin/go", ...args], { stdio: "inherit" });
  } else {
    execFileSync("go", args, { cwd: backendDir, stdio: "inherit", env: { ...process.env, ...testEnv } });
  }
} finally {
  if (started) {
    const stopped = spawnSync(pgCtl, ["-D", data, "-m", "fast", "-w", "stop"], { encoding: "utf8" });
    if (stopped.status !== 0) throw new Error(`could not stop disposable cluster at ${fixtureRoot}: ${stopped.stderr}`);
  }
  if (dirname(resolve(fixtureRoot)) !== resolve(tmpdir()) || !basename(fixtureRoot).startsWith("mangorts-attachment-cleanup-pg-")) {
    throw new Error(`refusing cleanup outside the generated disposable fixture directory: ${fixtureRoot}`);
  }
  rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
