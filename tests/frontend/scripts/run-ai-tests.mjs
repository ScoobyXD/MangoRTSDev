import { build } from "../../../frontend/node_modules/esbuild/lib/main.js";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const tests = ["aiLive.test.ts", "aiApi.test.ts", "AIAgentPanel.test.tsx"];
for (const name of tests) {
  const outfile = resolve(root, "frontend/.test-dist/ai", name.replace(/\.tsx?$/, ".mjs"));
  await build({
    entryPoints: [resolve(root, "tests/frontend/modules/ai", name)], outfile,
    bundle: true, platform: "node", format: "esm", packages: "external", jsx: "automatic",
    define: { "import.meta.env": JSON.stringify({ DEV: true, VITE_AUTH_MODE: "disabled", VITE_API_BASE_URL: "http://localhost:8080", VITE_COMPANY_ID: "company-one" }) },
  });
  await import(pathToFileURL(outfile).href);
}
