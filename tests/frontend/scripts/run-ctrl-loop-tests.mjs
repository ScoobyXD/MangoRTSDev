import { build } from "../../../frontend/node_modules/esbuild/lib/main.js";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
for (const name of ["ctrlLoopApi.test.ts", "CtrlLoopPage.test.tsx", "CtrlLoopEmailPreview.test.tsx"]) {
  const outfile = resolve(root, "frontend/.test-dist/ctrl-loop", name.replace(/\.tsx?$/, ".mjs"));
  await build({
    entryPoints: [resolve(root, "tests/frontend/modules/ctrl-loop", name)], outfile,
    bundle: true, platform: "node", format: "esm", packages: "external", jsx: "automatic", loader: { ".css": "empty" },
    define: { "import.meta.env": JSON.stringify({ DEV: true, VITE_AUTH_MODE: "disabled", VITE_API_BASE_URL: "http://localhost:8080", VITE_COMPANY_ID: "company-one" }) },
  });
  await import(pathToFileURL(outfile).href);
}
