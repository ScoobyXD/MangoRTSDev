import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const COUNTED_EXTENSIONS = new Set([
  ".css",
  ".go",
  ".hcl",
  ".html",
  ".json",
  ".ps1",
  ".sh",
  ".sql",
  ".tf",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);
const COUNTED_BASENAMES = new Set(["Dockerfile", "go.mod"]);
const EXCLUDED_DIRECTORIES = new Set([
  "build",
  "coverage",
  "dist",
  "docs",
  "node_modules",
  "tmp",
]);
const EXCLUDED_BASENAMES = new Set([
  ".terraform.lock.hcl",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const COMMENT_RULES = new Map([
  [".css", { block: ["/*", "*/"] }],
  [".go", { line: ["//"], block: ["/*", "*/"] }],
  [".hcl", { line: ["#", "//"], block: ["/*", "*/"] }],
  [".html", { block: ["<!--", "-->"] }],
  [".ps1", { line: ["#"], block: ["<#", "#>"] }],
  [".sh", { line: ["#"] }],
  [".sql", { line: ["--"], block: ["/*", "*/"] }],
  [".tf", { line: ["#", "//"], block: ["/*", "*/"] }],
  [".ts", { line: ["//"], block: ["/*", "*/"] }],
  [".tsx", { line: ["//"], block: ["/*", "*/"] }],
  [".yaml", { line: ["#"] }],
  [".yml", { line: ["#"] }],
  ["Dockerfile", { line: ["#"] }],
  ["go.mod", { line: ["//"] }],
]);

function normalizePath(filePath) {
  return filePath.replaceAll("\\", "/");
}

function isCountedFile(filePath) {
  const parts = filePath.split("/");
  const basename = parts.at(-1);
  const extension = path.posix.extname(filePath).toLowerCase();

  if (parts.some((part) => EXCLUDED_DIRECTORIES.has(part))) {
    return false;
  }
  if (
    EXCLUDED_BASENAMES.has(basename) ||
    basename === ".env" ||
    basename.startsWith(".env.")
  ) {
    return false;
  }
  return COUNTED_EXTENSIONS.has(extension) || COUNTED_BASENAMES.has(basename);
}

function isTestFile(filePath) {
  const parts = filePath.split("/");
  const basename = parts.at(-1);
  return (
    parts.some((part) => part === "test" || part === "tests") ||
    basename.endsWith("_test.go") ||
    /\.(test|spec)\.(ts|tsx)$/.test(basename)
  );
}

function countLogicLines(filePath) {
  const basename = path.posix.basename(filePath);
  const extension = path.posix.extname(filePath).toLowerCase();
  const rules = COMMENT_RULES.get(extension) ?? COMMENT_RULES.get(basename) ?? {};
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  let logicLines = 0;
  let inBlockComment = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (inBlockComment) {
      if (trimmed.includes(rules.block[1])) {
        inBlockComment = false;
      }
      continue;
    }
    if (rules.line?.some((marker) => trimmed.startsWith(marker))) {
      continue;
    }
    if (rules.block && trimmed.startsWith(rules.block[0])) {
      if (!trimmed.includes(rules.block[1])) {
        inBlockComment = true;
      }
      continue;
    }
    logicLines += 1;
  }
  return logicLines;
}

function areaFor(filePath) {
  if (filePath.startsWith("frontend/")) return "Frontend";
  if (filePath.startsWith("backend/")) return "Backend";
  if (filePath.startsWith("scripts/")) return "Scripts";
  if (filePath.startsWith("infra/")) return "Infra";
  if (filePath.startsWith(".github/")) return "CI";
  return "Other";
}

function subcategoryFor(filePath) {
  const parts = filePath.split("/");

  if (parts[0] === "backend") {
    if (parts[1] === "internal" && parts.length >= 4) {
      return parts.slice(0, 3).join("/");
    }
    if (parts[1] === "db") {
      return parts[2] === "migrations" ? "backend/db/migrations" : "backend/db/root";
    }
    if (parts[1] === "cmd" && parts.length >= 4) {
      return parts.slice(0, 3).join("/");
    }
    return "backend/root";
  }

  if (parts[0] === "frontend") {
    if (parts[1] !== "src") {
      return parts.length === 2 ? "frontend/config-root" : parts.slice(0, 2).join("/");
    }
    if (parts.length === 3) {
      return "frontend/src/root";
    }
    if ((parts[2] === "modules" || parts[2] === "pages") && parts.length >= 4) {
      return path.posix.extname(parts[3])
        ? parts.slice(0, 4).join("/")
        : parts.slice(0, 4).join("/");
    }
    return parts.slice(0, 3).join("/");
  }

  if (parts[0] === ".github") {
    return parts.length >= 3 ? parts.slice(0, 2).join("/") : ".github";
  }
  if (parts[0] === "infra") {
    return parts.length >= 3 ? parts.slice(0, 2).join("/") : "infra/root";
  }
  return parts.length >= 2 ? parts[0] : filePath;
}

function aggregate(rows, keyFor) {
  const values = new Map();
  for (const row of rows) {
    const key = keyFor(row);
    const current = values.get(key) ?? { name: key, files: 0, logicLines: 0 };
    current.files += 1;
    current.logicLines += row.logicLines;
    values.set(key, current);
  }
  return [...values.values()].sort(
    (left, right) =>
      right.logicLines - left.logicLines || left.name.localeCompare(right.name),
  );
}

function formatInteger(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatShare(value, total) {
  return `${((value / total) * 100).toFixed(1)}%`;
}

function markdownTable(headers, rows) {
  const divider = headers.map((_, index) => (index === 0 ? "---" : "---:"));
  return [
    `| ${headers.join(" | ")} |`,
    `|${divider.join("|")}|`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
})
  .split("\0")
  .filter(Boolean)
  .map(normalizePath)
  .filter(isCountedFile);

const files = trackedFiles.map((filePath) => ({
  filePath,
  isTest: isTestFile(filePath),
  logicLines: countLogicLines(filePath),
}));
const testFiles = files.filter((file) => file.isTest);
const nonTestFiles = files.filter((file) => !file.isTest);
const totalLogicLines = files.reduce((sum, file) => sum + file.logicLines, 0);
const testLogicLines = testFiles.reduce((sum, file) => sum + file.logicLines, 0);
const nonTestLogicLines = nonTestFiles.reduce((sum, file) => sum + file.logicLines, 0);
const areas = aggregate(nonTestFiles, (file) => areaFor(file.filePath));
const subcategories = aggregate(nonTestFiles, (file) => subcategoryFor(file.filePath));
const largestFiles = [...files]
  .filter((file) => file.logicLines > 1_500)
  .sort(
    (left, right) =>
      right.logicLines - left.logicLines || left.filePath.localeCompare(right.filePath),
  );

const report = {
  nonTestLogicLines,
  totalLogicLines,
  countedFiles: files.length,
  testLogicLines,
  testFiles: testFiles.length,
  areas,
  subcategories,
  largestFiles,
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

console.log("## Non-Test Logic Lines by Area\n");
console.log(
  markdownTable(
    ["Area", "Files", "Logic lines", "Share"],
    areas.map((area) => [
      area.name,
      formatInteger(area.files),
      formatInteger(area.logicLines),
      formatShare(area.logicLines, nonTestLogicLines),
    ]),
  ),
);
console.log("\n## Non-Test Logic Lines by Subcategory\n");
console.log(
  markdownTable(
    ["Subcategory", "Files", "Logic lines", "Share"],
    subcategories.map((subcategory) => [
      `\`${subcategory.name}\``,
      formatInteger(subcategory.files),
      formatInteger(subcategory.logicLines),
      formatShare(subcategory.logicLines, nonTestLogicLines),
    ]),
  ),
);
console.log("\n## Files Over 1,500 Logic Lines\n");
console.log(
  markdownTable(
    ["Logic lines", "File", "Test file"],
    largestFiles.map((file) => [
      formatInteger(file.logicLines),
      `\`${file.filePath}\``,
      file.isTest ? "Yes" : "No",
    ]),
  ),
);
