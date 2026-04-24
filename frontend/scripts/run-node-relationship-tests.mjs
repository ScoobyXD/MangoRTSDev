import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(scriptDir, "..");
const testFile = resolve(frontendRoot, ".test-dist/modules/node/canvas/relationshipProjection.test.js");
const packageFile = resolve(frontendRoot, ".test-dist/package.json");

function run(command) {
  execSync(command, {
    cwd: frontendRoot,
    stdio: "inherit",
    env: process.env,
  });
}

run("npx tsc -p tsconfig.node-tests.json");

let contents = readFileSync(testFile, "utf8");
contents = contents.replace('"./relationshipProjection"', '"./relationshipProjection.js"');
writeFileSync(testFile, contents, "utf8");

mkdirSync(resolve(frontendRoot, ".test-dist"), { recursive: true });
writeFileSync(packageFile, '{"type":"module"}\n', "utf8");

run(`"${process.execPath}" --test .test-dist/modules/node/canvas/relationshipProjection.test.js`);
