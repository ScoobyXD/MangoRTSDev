import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const frontendRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function argumentValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1]?.trim() : undefined;
}

function promptForPassword(user) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Database password is required. Run interactively for a hidden prompt, or set PGPASSWORD for this process.");
  }
  return new Promise((resolvePassword, rejectPassword) => {
    let muted = false;
    let settled = false;
    const hiddenOutput = new Writable({
      write(chunk, encoding, callback) {
        if (!muted) process.stdout.write(chunk, encoding);
        callback();
      },
    });
    const prompt = createInterface({ input: process.stdin, output: hiddenOutput, terminal: true });
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      muted = false;
      process.stdout.write("\n");
      prompt.close();
      callback();
    };

    process.stdout.write(`Database password for ${user || "configured user"}: `);
    muted = true;
    prompt.once("SIGINT", () => finish(() => rejectPassword(new Error("Password prompt cancelled."))));
    prompt.question("", (password) => finish(() => {
      if (!password) rejectPassword(new Error("Database password cannot be empty."));
      else resolvePassword(password);
    }));
  });
}

const databaseUser = argumentValue(process.argv.slice(2), "--user") ?? process.env.PGUSER ?? process.env.DB_USER;
let databasePassword;
if (process.stdin.isTTY && process.stdout.isTTY) {
  databasePassword = await promptForPassword(databaseUser);
} else {
  databasePassword = process.env.PGPASSWORD || process.env.DB_PASSWORD;
  if (!databasePassword) {
    throw new Error("Database password is required. Run interactively for a hidden prompt, or set PGPASSWORD for this process.");
  }
}
const childEnvironment = { ...process.env, PGPASSWORD: databasePassword };
const temporaryDirectory = mkdtempSync(join(tmpdir(), "mangorts-editor-history-cutover-"));
const output = join(temporaryDirectory, "cutover.mjs");

try {
  buildSync({
    entryPoints: [resolve(frontendRoot, "scripts/mango-editor-history-cutover.ts")],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    banner: { js: 'import { createRequire as __mangoCreateRequire } from "node:module"; const require = __mangoCreateRequire(import.meta.url);' },
    target: "node20",
    sourcemap: false,
  });
  const result = spawnSync(process.execPath, [output, ...process.argv.slice(2)], {
    cwd: frontendRoot,
    env: childEnvironment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  childEnvironment.PGPASSWORD = "";
  databasePassword = "";
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
