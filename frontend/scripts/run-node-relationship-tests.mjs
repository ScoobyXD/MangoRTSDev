import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(scriptDir, "..");
const testFiles = [
  resolve(frontendRoot, ".test-dist/app/frameLinking.test.js"),
  resolve(frontendRoot, ".test-dist/modules/linkingGraph.test.js"),
  resolve(frontendRoot, ".test-dist/modules/node-map/relationshipProjection.test.js"),
  resolve(frontendRoot, ".test-dist/modules/node-map/relationshipSelection.test.js"),
  resolve(frontendRoot, ".test-dist/modules/node-map/NodeMapControls.test.js"),
  resolve(frontendRoot, ".test-dist/modules/node-map/relationshipDeleteSummary.test.js"),
];
const packageFile = resolve(frontendRoot, ".test-dist/package.json");

function run(command) {
  execSync(command, {
    cwd: frontendRoot,
    stdio: "inherit",
    env: process.env,
  });
}

run("npx tsc -p tsconfig.node-tests.json");

for (const testFile of testFiles) {
  let contents = readFileSync(testFile, "utf8");
  contents = contents.replaceAll('"./relationshipProjection"', '"./relationshipProjection.js"');
  contents = contents.replaceAll('"./relationshipSelection"', '"./relationshipSelection.js"');
  contents = contents.replaceAll('"./relationshipDeleteSummary"', '"./relationshipDeleteSummary.js"');
  writeFileSync(testFile, contents, "utf8");
}

mkdirSync(resolve(frontendRoot, ".test-dist"), { recursive: true });
writeFileSync(packageFile, '{"type":"module"}\n', "utf8");

const testSections = [
  {
    title: "Frontend feature tests: frame linking",
    files: [resolve(frontendRoot, ".test-dist/app/frameLinking.test.js")],
  },
  {
    title: "Frontend feature tests: linking graph",
    files: [resolve(frontendRoot, ".test-dist/modules/linkingGraph.test.js")],
  },
  {
    title: "Frontend feature tests: node relationship projection",
    files: [resolve(frontendRoot, ".test-dist/modules/node-map/relationshipProjection.test.js")],
  },
  {
    title: "Frontend feature tests: node relationship selection geometry",
    files: [resolve(frontendRoot, ".test-dist/modules/node-map/relationshipSelection.test.js")],
  },
  {
    title: "Frontend feature tests: node map multi-select controls",
    files: [resolve(frontendRoot, ".test-dist/modules/node-map/NodeMapControls.test.js")],
  },
  {
    title: "Frontend feature tests: node relationship delete summary",
    files: [resolve(frontendRoot, ".test-dist/modules/node-map/relationshipDeleteSummary.test.js")],
  },
];

for (const section of testSections) {
  console.log(`\n=== ${section.title} ===`);
  run(`"${process.execPath}" --test ${section.files.map((file) => `"${file}"`).join(" ")}`);
}
