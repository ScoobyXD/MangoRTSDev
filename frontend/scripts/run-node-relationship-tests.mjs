import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(scriptDir, "..");
const testsRoot = resolve(frontendRoot, ".test-dist/modules/node-map");
const packageFile = resolve(frontendRoot, ".test-dist/package.json");

function run(command) {
  execSync(command, {
    cwd: frontendRoot,
    stdio: "inherit",
    env: process.env,
  });
}

function walk(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      results.push(...walk(full));
      continue;
    }
    if (extname(full) === ".js" && full.endsWith(".test.js")) results.push(full);
  }
  return results;
}

run("npx tsc -p tsconfig.node-tests.json");

for (const testFile of walk(testsRoot)) {
  let contents = readFileSync(testFile, "utf8");
  contents = contents
    .replaceAll('"./relationshipProjection"', '"./relationshipProjection.js"')
    .replaceAll('"./selectionGeometry"', '"./selectionGeometry.js"');
  writeFileSync(testFile, contents, "utf8");
}

mkdirSync(resolve(frontendRoot, ".test-dist"), { recursive: true });
writeFileSync(packageFile, '{"type":"module"}\n', "utf8");

run(`"${process.execPath}" --test .test-dist/modules/node-map/*.test.js`);
