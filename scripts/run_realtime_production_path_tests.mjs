import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");
const backend = resolve(root, "backend");
const frontend = resolve(root, "frontend");
const requireFromFrontend = createRequire(resolve(frontend, "package.json"));
const { chromium } = requireFromFrontend("playwright-core");
const { buildSync: buildWithEsbuild } = requireFromFrontend("esbuild");
const windows = process.platform === "win32";
const exeSuffix = windows ? ".exe" : "";
const pgBin = process.env.POSTGRES_BIN || (windows ? "C:\\Program Files\\PostgreSQL\\18\\bin" : "");
const browserExecutable = process.env.MANGORTS_BROWSER_EXECUTABLE ||
  (windows ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : "");
const pgTools = Object.fromEntries(["initdb", "pg_ctl", "createdb", "psql"].map((name) => [
  name,
  pgBin ? join(pgBin, name + exeSuffix) : name,
]));

for (const path of Object.values(pgTools)) {
  if (pgBin && !existsSync(path)) throw new Error("PostgreSQL executable missing: " + path);
}
if (browserExecutable && !existsSync(browserExecutable)) {
  throw new Error("Browser executable missing: " + browserExecutable);
}

const tempRoot = mkdtempSync(join(tmpdir(), "mangorts-realtime-production-path-"));
const pgData = join(tempRoot, "postgres");
const pgLog = join(tempRoot, "postgres.log");
const migrationDir = join(tempRoot, "migrations");
const legacyMigrationDir = join(tempRoot, "legacy-migrations");
const goBuildParent = join(backend, "go-build-cache");
mkdirSync(goBuildParent, { recursive: true });
const goBuildRoot = mkdtempSync(join(goBuildParent, "realtime-production-path-"));
const migrateExe = join(goBuildRoot, "miraeopus-migrate" + exeSuffix);
const apiExe = join(goBuildRoot, "miraeopus-api" + exeSuffix);
const collaborationBuildRoot = mkdtempSync(join(frontend, ".mangorts-realtime-production-path-"));
const collaborationService = join(collaborationBuildRoot, "node-v2-collaboration-server.mjs");
const password = "mangorts-disposable-test-only";
const processes = [];
let pgStarted = false;
let browser;
let stopping = false;
let windowsGoToolchainFallback = false;

function run(label, file, args, options = {}) {
  if (windowsGoToolchainFallback && file === migrateExe) {
    return run(label, "go", ["run", "./cmd/miraeopus-migrate", ...args], options);
  }
  process.stdout.write("\n--- " + label + " ---\n");
  const resolvedFile = typeof file === "string" ? resolve(file) : "";
  const disposableWindowsExecutable = windows
    && typeof file === "string"
    && [tempRoot, goBuildRoot].some((parent) => resolvedFile.startsWith(resolve(parent) + sep))
    && file.toLowerCase().endsWith(".exe");
  for (let attempt = 0; ; attempt += 1) {
    try {
      return execFileSync(file, args, {
        cwd: options.cwd || root,
        env: options.env || process.env,
        input: options.input,
        encoding: "utf8",
        stdio: options.stdio || ["pipe", "inherit", "inherit"],
      });
    } catch (cause) {
      const transientLaunchBlock = disposableWindowsExecutable
        && cause?.status === null
        && (cause?.code === "UNKNOWN" || cause?.code === "EPERM" || cause?.code === "EBUSY");
      if (transientLaunchBlock && file === migrateExe && attempt >= 3) {
        windowsGoToolchainFallback = true;
        process.stderr.write("Windows Application Control still blocks the migration executable; using the trusted Go toolchain fallback.\n");
        return run(label, "go", ["run", "./cmd/miraeopus-migrate", ...args], options);
      }
      if (!transientLaunchBlock || attempt >= 19) throw cause;
      if (attempt === 0) process.stderr.write("Windows temporarily blocked the disposable test executable; retrying.\n");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
}

function capture(file, args, options = {}) {
  return execFileSync(file, args, {
    cwd: options.cwd || root,
    env: options.env || process.env,
    input: options.input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

async function freePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

async function waitForURL(url, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error("HTTP " + response.status);
    } catch (cause) {
      lastError = cause;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Timed out waiting for " + url + ": " + String(lastError));
}

function databaseEnv(port, database) {
  return {
    ...process.env,
    PGHOST: "127.0.0.1",
    PGPORT: String(port),
    PGUSER: "postgres",
    PGPASSWORD: password,
    DB_HOST: "127.0.0.1",
    DB_PORT: String(port),
    DB_USER: "postgres",
    DB_PASSWORD: password,
    DB_NAME: database,
    DB_SSLMODE: "disable",
    DB_CONNECT_TIMEOUT_SECONDS: "5",
  };
}

function psql(port, database, sql) {
  return capture(pgTools.psql, ["-X", "-v", "ON_ERROR_STOP=1", "-At", "-d", database], {
    env: databaseEnv(port, database),
    input: sql,
  });
}

function startProcess(label, file, args, options) {
  const child = spawn(file, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const logs = [];
  const append = (chunk) => {
    logs.push(String(chunk));
    if (logs.length > 300) logs.shift();
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  let record;
  child.on("exit", (code) => {
    if (code && !stopping && !record?.intentionalStop) {
      process.stderr.write("\n" + label + " exited " + code + "\n" + logs.join(""));
    }
  });
  record = { child, label, logs, intentionalStop: false, terminateTree: options.terminateTree === true };
  processes.push(record);
  return record;
}

async function stopProcess(record) {
  if (!record || record.child.exitCode !== null) return;
  record.intentionalStop = true;
  if (windows && record.terminateTree) {
    try {
      execFileSync("taskkill.exe", ["/PID", String(record.child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      record.child.kill();
    }
  } else {
    record.child.kill();
  }
  await Promise.race([
    new Promise((resolveExit) => record.child.once("exit", resolveExit)),
    new Promise((resolveWait) => setTimeout(resolveWait, 3_000)),
  ]);
  if (record.child.exitCode === null && windows) {
    try {
      execFileSync("taskkill.exe", ["/PID", String(record.child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {}
  }
}

function startAPIProcess(label, options) {
  if (windowsGoToolchainFallback) {
    return startProcess(label, "go", ["run", "./cmd/miraeopus-api"], {
      ...options,
      terminateTree: true,
    });
  }
  return startProcess(label, apiExe, [], options);
}

const COMPANY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const USER_OTHER = "33333333-3333-4333-8333-333333333333";
const NODE_A = "aaaaaaaa-0000-4000-8000-000000000001";
const NODE_A_OTHER = "aaaaaaaa-0000-4000-8000-000000000002";
const NODE_B = "bbbbbbbb-0000-4000-8000-000000000001";
const GATE_A = "aaaaaaaa-0000-4000-8000-000000000101";
const PROJECT_A = "aaaaaaaa-0000-4000-8000-000000000201";
const DOC_A = "aaaaaaaa-0000-4000-8000-000000000301";
const DOC_NODE_OTHER = "aaaaaaaa-0000-4000-8000-000000000302";
const DOC_GATE = "aaaaaaaa-0000-4000-8000-000000000303";
const DOC_PROJECT = "aaaaaaaa-0000-4000-8000-000000000304";
const DOC_COMPANY_B = "bbbbbbbb-0000-4000-8000-000000000301";
const INITIAL_RICH_EDITOR_HTML = '<!-- mango-editor-html-v1 --><p><strong><span style="font-size:16px">nice prompt </span></strong><span style="font-size:14px">review everything</span></p><p>second row</p><p><br></p>';
const STALE_STRUCTURED_EDITOR_STATE = JSON.stringify({ ops: [{ insert: "stale structured collaboration content" }] });

function editorURL(frontendPort, apiPort, values) {
  const query = new URLSearchParams({
    api: "http://127.0.0.1:" + apiPort,
    company: values.company,
    subject: values.subject,
    resource_type: values.resourceType,
    resource: values.resource,
    document: values.document,
  });
  return "http://127.0.0.1:" + frontendPort + "/editor-textbox-sync-e2e.html?" + query;
}

async function openEditor(context, frontendPort, apiPort, values, frameLog) {
  const page = await context.newPage();
  if (frameLog) {
    page.on("websocket", (socket) => {
      socket.on("framesent", (event) => frameLog.push(String(event.payload)));
      socket.on("framereceived", (event) => frameLog.push("received:" + String(event.payload)));
    });
  }
  await page.goto(editorURL(frontendPort, apiPort, values));
  await page.waitForFunction(() => Boolean(window.__mangoE2E), null, { timeout: 20_000 });
  try {
    await page.waitForFunction(() => {
      const state = window.__mangoE2E?.getState();
      return state?.status === "Saved" && state.health === "connected";
    }, null, { timeout: 20_000 });
  } catch (cause) {
    const debug = await page.evaluate(() => ({ state: window.__mangoE2E?.getState(), body: document.body.innerText }));
    throw new Error("Editor did not become ready: " + JSON.stringify(debug), { cause });
  }
  return page;
}

async function state(page) {
  return await page.evaluate(() => window.__mangoE2E.getState());
}

async function setHTML(page, html) {
  await page.evaluate((value) => window.__mangoE2E.setHTML(value, true), html);
  await page.evaluate(() => window.__mangoE2E.flush());
}

async function waitUntil(predicate, description, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await predicate();
      if (last) return last;
    } catch (cause) {
      last = cause;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error("Timed out waiting for " + description + "; last=" + String(last));
}

async function waitConverged(pages) {
  let observed = [];
  try {
    return await waitUntil(async () => {
      observed = await Promise.all(pages.map(state));
      if (!observed.every((item) => item.status === "Saved")) return false;
      if (!observed.every((item) => item.html === observed[0].html)) return false;
      return observed[0].html;
    }, "visible editor convergence");
  } catch (cause) {
    throw new Error("Visible editor convergence failed: " + JSON.stringify(observed), { cause });
  }
}

async function browserMatrix(frontendPort, apiPorts, pgPort, restartAPI) {
  browser = await chromium.launch({
    executablePath: browserExecutable || undefined,
    headless: true,
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });
  const contexts = [];
  const makeContext = async () => {
    const context = await browser.newContext();
    contexts.push(context);
    return context;
  };
  const contextA = await makeContext();
  const contextB = await makeContext();
  const frames = [];
  const common = { company: COMPANY_A, resourceType: "node", resource: NODE_A, document: DOC_A };
  const pageA = await openEditor(contextA, frontendPort, apiPorts[0], { ...common, subject: "browser-user-a" }, frames);
  const pageB = await openEditor(contextB, frontendPort, apiPorts[1], { ...common, subject: "browser-user-b" });

  assert.equal(await pageA.locator("#editor").textContent(), "nice prompt review everything\nsecond row\n");
  assert.equal(await pageA.locator("#editor strong").count(), 1);
  assert.equal(await pageA.locator("#editor span").count(), 2);
  assert.equal(await pageA.locator("#editor").evaluate((element) => element.children.length), 3);
  assert.doesNotMatch(await pageA.locator("#editor").innerText(), /<\/?(?:strong|span)\b/);
  assert.equal(await pageB.locator("#editor").evaluate((element) => element.children.length), 3);
  assert.equal(psql(pgPort, "mangorts_realtime_test",
    "select canonical_html from editor_collaboration_documents where company_id='" + COMPANY_A + "'::uuid and resource_type='node' and resource_id='" + NODE_A + "'::uuid and document_id='" + DOC_A + "'::uuid;"), INITIAL_RICH_EDITOR_HTML);

  await setHTML(pageA, "<p>First row</p>");
  await waitConverged([pageA, pageB]);
  await pageA.locator("#editor").focus();
  await pageA.evaluate(() => {
    const root = document.querySelector("#editor");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let caretNode = walker.nextNode();
    for (let next = walker.nextNode(); next; next = walker.nextNode()) caretNode = next;
    const range = document.createRange();
    range.setStart(caretNode, caretNode.textContent.length);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await pageA.keyboard.press("Enter");
  await pageA.keyboard.type("N");
  const enteredHTML = await pageA.locator("#editor").innerHTML();
  await pageA.evaluate(() => window.__mangoE2E.flush());
  await waitUntil(async () => /First row[\s\S]*N/.test(await pageB.locator("#editor").innerText()), "Enter-created remote row");
  assert.equal(await pageA.locator("#editor").innerHTML(), enteredHTML, "acknowledgement must not flatten or rebuild Enter-created DOM");
  assert.match(await pageA.locator("#editor").innerText(), /First row[\s\S]*N/);
  assert.match(await pageB.locator("#editor").innerText(), /First row[\s\S]*N/, "broadcast must preserve the Enter-created remote row");

  const rich = '<h2 style="text-align:center">Roadmap</h2><p><strong>Bold</strong> <em>italic</em> <u>underline</u> <span style="font-size:18px;background-color:#fde68a">highlight</span> <a href="https://example.test">link</a> <span data-mango-mention="true" data-mango-mention-user-id="' +
    USER_B + '">@Browser B</span><br>next line</p><p><br></p><ul data-mango-editor-list="bullet"><li data-mango-editor-list-item="bullet">First</li></ul>' +
    '<ul data-mango-editor-list="checklist"><li data-mango-editor-list-item="checklist" data-mango-editor-checklist-checked="true">Checked</li></ul>' +
    '<ol><li>One</li><li style="margin-left:32px">Indented two</li></ol>' +
    '<table data-mango-editor-table="true" data-mango-editor-table-id="matrix"><tbody><tr><th>Owner</th><th>State</th></tr><tr><td>A</td><td>Ready</td></tr></tbody></table>' +
    '<p><span data-mango-editor-image="true" data-mango-editor-image-id="image-durable-001" data-mango-editor-attachment-id="attachment-durable-001"><img src="mango-attachment:attachment-durable-001" data-mango-attachment-id="attachment-durable-001" alt="Diagram" width="320"></span></p>';
  await setHTML(pageA, rich);
  const normalizedRich = await waitConverged([pageA, pageB]);
  assert.match(normalizedRich, /<table/);
  assert.match(normalizedRich, /data-mango-mention-user-id/);
  assert.match(normalizedRich, /mango-attachment:attachment-durable-001/);
  assert.doesNotMatch(normalizedRich.toLowerCase(), /base64|x-amz-credential|x-amz-signature/);
  assert.equal(await pageB.locator("#editor table").count(), 1);
  assert.equal(await pageB.locator("#editor ol").count(), 1);
  assert.equal(await pageB.locator('[data-mango-editor-checklist-checked="true"]').count(), 1);
  assert.ok(await pageB.locator("#editor br").count() >= 2);
  assert.equal(await pageB.locator("#editor [data-mango-editor-attachment-id='attachment-durable-001'] img").count(), 1);
  await waitUntil(async () => Promise.all([pageA, pageB].map(async (page) => (
    (await page.locator("#editor [data-mango-editor-attachment-id='attachment-durable-001'] img").getAttribute("src"))?.startsWith("blob:")
    && await page.locator('[data-mango-editor-image-id="image-durable-001"]').getAttribute("data-mango-editor-image-hydration") === "ready"
  ))).then((items) => items.every(Boolean)), "attachment images to hydrate through the established loader");

  const base = "x".repeat(5_000);
  await setHTML(pageA, "<p>" + base + "</p>");
  await waitConverged([pageA, pageB]);
  await Promise.all([
    pageA.evaluate(() => window.__mangoE2E.delayNextBroadcast(500)),
    pageB.evaluate(() => window.__mangoE2E.delayNextBroadcast(500)),
  ]);
  await Promise.all([
    setHTML(pageA, "<p>" + base.slice(0, 100) + "A" + base.slice(100) + "</p>"),
    setHTML(pageB, "<p>" + base.slice(0, 200) + "B" + base.slice(200) + "</p>"),
  ]);
  await waitConverged([pageA, pageB]);
  const largeText = await pageA.locator("#editor").innerText();
  assert.equal(largeText.length, 5_002);
  assert.equal((largeText.match(/A/g) || []).length, 1);
  assert.equal((largeText.match(/B/g) || []).length, 1);
  assert.ok(Math.max((await state(pageA)).maxAckConcurrentOperations, (await state(pageB)).maxAckConcurrentOperations) > 0,
    "one acknowledgement must carry the collaborator operation used for OT rebase");

  await setHTML(pageA, "<p>Alpha Beta</p>");
  await waitConverged([pageA, pageB]);
  await Promise.all([
    setHTML(pageA, "<p><strong>Alpha</strong> Beta</p>"),
    setHTML(pageB, "<p>Alpha <em>Beta</em></p>"),
  ]);
  await waitConverged([pageA, pageB]);
  assert.equal(await pageA.locator("#editor").innerText(), "Alpha Beta");
  assert.equal(await pageA.locator("#editor strong").count(), 1);
  assert.equal(await pageA.locator("#editor em").count(), 1);

  await pageA.evaluate(() => window.__mangoE2E.delayNextBroadcast(500));
  await setHTML(pageA, "<p>Acknowledgement before broadcast</p>");
  assert.equal((await state(pageA)).status, "Saved");
  await waitConverged([pageA, pageB]);

  await pageA.evaluate(() => window.__mangoE2E.delayNextAck(750));
  const pendingAck = setHTML(pageA, "<p>Broadcast before acknowledgement</p>");
  await waitUntil(async () => (await state(pageB)).html.includes("Broadcast before acknowledgement"), "broadcast before acknowledgement");
  await pendingAck;
  await waitConverged([pageA, pageB]);

  await pageA.evaluate(() => window.__mangoE2E.duplicateNextBroadcast());
  await setHTML(pageA, "<p>Duplicate delivery remains once</p>");
  await waitConverged([pageA, pageB]);
  assert.equal(((await pageB.locator("#editor").innerText()).match(/Duplicate delivery remains once/g) || []).length, 1);

  await pageB.evaluate(() => window.__mangoE2E.dropNextBroadcast());
  await setHTML(pageA, "<p>Gap first revision</p>");
  await setHTML(pageA, "<p>Gap recovery final revision</p>");
  await waitConverged([pageA, pageB]);

  await pageA.evaluate(() => {
    window.__mangoE2E.dropNextAck();
    window.__mangoE2E.dropNextBroadcast();
    window.__mangoE2E.setHTML("<p>Lost acknowledgement committed once</p>", true);
  });
  await pageA.evaluate(() => window.__mangoE2E.flush()).catch(() => {});
  await waitUntil(async () => (await state(pageA)).status.includes("Saving"), "durable lost acknowledgement");
  const tabIdentity = await pageA.evaluate(() => window.name);
  await pageA.reload();
  await pageA.waitForFunction(() => Boolean(window.__mangoE2E), null, { timeout: 20_000 });
  await pageA.waitForFunction(() => {
    const item = window.__mangoE2E?.getState();
    return item?.status === "Saved" && item.html.includes("Lost acknowledgement committed once");
  }, null, { timeout: 30_000 });
  assert.equal(await pageA.evaluate(() => window.name), tabIdentity);
  await waitConverged([pageA, pageB]);
  assert.equal(((await pageA.locator("#editor").innerText()).match(/Lost acknowledgement committed once/g) || []).length, 1);

  const pasteText = "Rich paste line ".repeat(28_000);
  await setHTML(pageA, "<h3>Large paste</h3><p><strong>" + pasteText + "</strong></p><ul><li>Tail one</li><li>Tail two</li></ul>");
  await waitConverged([pageA, pageB]);
  const pasted = await pageA.locator("#editor").textContent();
  assert.ok(pasted.startsWith("Large paste"));
  assert.equal((pasted.match(/Rich paste line /g) || []).length, 28_000);
  assert.equal((pasted.match(/Tail one/g) || []).length, 1);
  assert.equal((pasted.match(/Tail two/g) || []).length, 1);
  assert.equal(await pageA.locator("#editor strong").count(), 2);
  assert.equal(await pageA.locator("#editor strong").first().textContent(), "Large paste");
  assert.equal(await pageA.locator("#editor li").count(), 2);
  await pageA.evaluate(() => window.__mangoE2E.reconnect());
  await waitConverged([pageA, pageB]);
  const reconnectedPaste = await pageA.locator("#editor").textContent();
  assert.equal((reconnectedPaste.match(/Rich paste line /g) || []).length, 28_000);
  assert.equal((reconnectedPaste.match(/Tail one/g) || []).length, 1);
  assert.equal((reconnectedPaste.match(/Tail two/g) || []).length, 1);

  const pageTab = await openEditor(contextA, frontendPort, apiPorts[1], { ...common, subject: "browser-user-a" });
  const secondUserContext = await makeContext();
  const pageSecondContext = await openEditor(secondUserContext, frontendPort, apiPorts[0], { ...common, subject: "browser-user-a" });
  assert.notEqual(await pageTab.evaluate(() => window.name), await pageA.evaluate(() => window.name));
  await waitConverged([pageA, pageB, pageTab, pageSecondContext]);

  const beforeRestart = await pageA.locator("#editor").textContent();
  await restartAPI(0);
  await waitUntil(async () => {
    const [first, second] = await Promise.all([state(pageA), state(pageSecondContext)]);
    return first.health === "connected" && second.health === "connected" &&
      first.status === "Saved" && second.status === "Saved" &&
      first.html === second.html;
  }, "backend instance restart subscription and canonical recovery", 45_000);
  assert.equal(await pageA.locator("#editor").textContent(), beforeRestart);
  await setHTML(pageB, "<p>Backend restart cross-instance recovery</p>");
  await waitConverged([pageA, pageB, pageTab, pageSecondContext]);

  const isolationInputs = [
    { company: COMPANY_A, subject: "browser-user-a", resourceType: "node", resource: NODE_A_OTHER, document: DOC_NODE_OTHER },
    { company: COMPANY_A, subject: "browser-user-a", resourceType: "logic_gate", resource: GATE_A, document: DOC_GATE },
    { company: COMPANY_A, subject: "browser-user-a", resourceType: "project", resource: PROJECT_A, document: DOC_PROJECT },
    { company: COMPANY_B, subject: "browser-user-other", resourceType: "node", resource: NODE_B, document: DOC_COMPANY_B },
  ];
  const isolated = [];
  for (let index = 0; index < isolationInputs.length; index += 1) {
    isolated.push(await openEditor(await makeContext(), frontendPort, apiPorts[index % 2], isolationInputs[index]));
  }
  const before = await Promise.all(isolated.map(state));
  await setHTML(pageA, "<p>Exact node document only</p>");
  await waitConverged([pageA, pageB, pageTab, pageSecondContext]);
  const after = await Promise.all(isolated.map(state));
  assert.deepEqual(after.map((item) => item.html), before.map((item) => item.html));

  const probeScope = "editor:node:" + NODE_A_OTHER + ":" + DOC_NODE_OTHER;
  const frameStart = frames.length;
  const probes = await pageA.evaluate((scope) => [
    window.__mangoE2E.addProbe(scope),
    window.__mangoE2E.addProbe(scope),
  ], probeScope);
  await waitUntil(() => frames.slice(frameStart).filter((frame) => frame.includes('"type":"subscribe"') && frame.includes(probeScope)).length === 1, "one refcounted subscribe");
  await pageA.evaluate((id) => window.__mangoE2E.removeProbe(id), probes[0]);
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  assert.equal(frames.slice(frameStart).filter((frame) => frame.includes('"type":"unsubscribe"') && frame.includes(probeScope)).length, 0);
  await pageA.evaluate((id) => window.__mangoE2E.removeProbe(id), probes[1]);
  await waitUntil(() => frames.slice(frameStart).filter((frame) => frame.includes('"type":"unsubscribe"') && frame.includes(probeScope)).length === 1, "unsubscribe on last unmount");

  psql(pgPort, "mangorts_realtime_test", [
    "insert into resource_permissions (company_id,resource_type,resource_id,subject_type,subject_id,user_id,access_level)",
    "values ('" + COMPANY_A + "','node','" + NODE_A + "','user','" + USER_B + "','" + USER_B + "','no_access')",
    "on conflict (company_id,resource_type,resource_id,subject_type,subject_id)",
    "do update set access_level='no_access',updated_timestamp=now();",
  ].join(" "));
  const revokedState = await state(pageB);
  await setHTML(pageA, "<p>Revocation blocks this update</p>");
  await waitConverged([pageA, pageTab, pageSecondContext]);
  await new Promise((resolveWait) => setTimeout(resolveWait, 750));
  assert.equal((await state(pageB)).html, revokedState.html);
  await pageB.reload();
  await pageB.waitForFunction(() => Boolean(window.__mangoE2E), null, { timeout: 20_000 });
  await waitUntil(async () => {
    const item = await state(pageB);
    return item.health === "rejected" || item.errors.some((error) => /denied|rejected/.test(error));
  }, "permission revocation rejection");

  await Promise.all(contexts.map((context) => context.close()));
}

async function main() {
  const pgPort = await freePort();
  const apiPorts = [await freePort(), await freePort()];
  const frontendPort = await freePort();
  const s3Port = await freePort();
  const collaborationPort = await freePort();
  mkdirSync(pgData, { recursive: true });
  mkdirSync(migrationDir, { recursive: true });
  mkdirSync(legacyMigrationDir, { recursive: true });

  run("Initialize disposable PostgreSQL", pgTools.initdb, [
    "-D", pgData, "--username=postgres", "--auth=trust", "--encoding=UTF8", "--no-locale",
  ]);
  const postgresOptions = ["-p", String(pgPort), "-h", "127.0.0.1"];
  if (!windows) postgresOptions.push("-k", tempRoot);
  try {
    run("Start disposable PostgreSQL", pgTools.pg_ctl, [
      "-D", pgData, "-l", pgLog, "-o", postgresOptions.join(" "), "-w", "start",
    ]);
  } catch (cause) {
    if (existsSync(pgLog)) {
      process.stderr.write("\nPostgreSQL startup log:\n" + readFileSync(pgLog, "utf8"));
    }
    throw cause;
  }
  pgStarted = true;
  for (const database of ["mangorts_realtime_test", "mangorts_realtime_legacy"]) {
    run("Create " + database, pgTools.createdb, [database], { env: databaseEnv(pgPort, "postgres") });
  }

  run("Build migration runner", "go", ["build", "-o", migrateExe, "./cmd/miraeopus-migrate"], { cwd: backend });
  run("Build production API", "go", ["build", "-o", apiExe, "./cmd/miraeopus-api"], { cwd: backend });
  process.stdout.write("\n--- Build Node V2 collaboration service ---\n");
  buildWithEsbuild({
    entryPoints: [resolve(frontend, "scripts", "node-v2-collaboration-server.ts")],
    bundle: true,
    packages: "external",
    platform: "node",
    target: "node22",
    format: "esm",
    outfile: collaborationService,
    logLevel: "info",
  });
  for (const name of ["20260715_unified_realtime_collaboration.sql", "20260715_zz_edit_or_no_access.sql"]) {
    copyFileSync(resolve(backend, "db", "migrations", name), resolve(migrationDir, name));
    copyFileSync(resolve(backend, "db", "migrations", name), resolve(legacyMigrationDir, name));
  }

  const cleanEnv = databaseEnv(pgPort, "mangorts_realtime_test");
  run("Apply canonical schema to clean database", migrateExe, [
    "-mode", "schema", "-schema", resolve(backend, "db", "schema.sql"), "-migrations", migrationDir,
  ], { cwd: backend, env: cleanEnv });
  run("Record the two historical collaboration migrations on the clean canonical schema", migrateExe, [
    "-mode", "migrate", "-migrations", migrationDir,
  ], { cwd: backend, env: cleanEnv });
  copyFileSync(resolve(backend, "db", "migrations", "20260716_restore_rich_html_collaboration.sql"), resolve(migrationDir, "20260716_restore_rich_html_collaboration.sql"));
  run("Apply the rich HTML collaboration migration on the clean canonical schema", migrateExe, [
    "-mode", "migrate", "-migrations", migrationDir,
  ], { cwd: backend, env: cleanEnv });
  copyFileSync(resolve(backend, "db", "migrations", "20260718_tiptap_json_foundation.sql"), resolve(migrationDir, "20260718_tiptap_json_foundation.sql"));
  run("Apply the inactive Tiptap JSON foundation migration on the clean canonical schema", migrateExe, [
    "-mode", "migrate", "-migrations", migrationDir,
  ], { cwd: backend, env: cleanEnv });
  copyFileSync(resolve(backend, "db", "migrations", "20260719_zz_tiptap_annotation_positions.sql"), resolve(migrationDir, "20260719_zz_tiptap_annotation_positions.sql"));
  run("Apply revision-bound Tiptap annotation positions on the clean canonical schema", migrateExe, [
    "-mode", "migrate", "-migrations", migrationDir,
  ], { cwd: backend, env: cleanEnv });
  copyFileSync(resolve(backend, "db", "migrations", "20260728_durable_email_thread_download_jobs.sql"), resolve(migrationDir, "20260728_durable_email_thread_download_jobs.sql"));
  run("Apply durable email-thread download jobs on the clean canonical schema", migrateExe, [
    "-mode", "migrate", "-migrations", migrationDir,
  ], { cwd: backend, env: cleanEnv });
  run("Prove recorded migration rerun is idempotent", migrateExe, [
    "-mode", "migrate", "-migrations", migrationDir,
  ], { cwd: backend, env: cleanEnv });
  assert.equal(psql(pgPort, "mangorts_realtime_test", "select count(*) from schema_migrations where version like '20260715%';"), "2");
  assert.equal(psql(pgPort, "mangorts_realtime_test", "select count(*) from schema_migrations where version like '20260716%';"), "1");
  assert.equal(psql(pgPort, "mangorts_realtime_test", "select count(*) from schema_migrations where version like '20260718%';"), "1");
  assert.equal(psql(pgPort, "mangorts_realtime_test", "select count(*) from schema_migrations where version='20260719_zz_tiptap_annotation_positions.sql';"), "1");
  assert.equal(psql(pgPort, "mangorts_realtime_test", "select count(*) from information_schema.columns where table_name in ('editor_json_documents','editor_json_operations','editor_json_versions') and column_name='canonical_annotations';"), "3");
  assert.equal(psql(pgPort, "mangorts_realtime_test", "select count(*) from schema_migrations where version='20260728_durable_email_thread_download_jobs.sql';"), "1");
  assert.equal(psql(pgPort, "mangorts_realtime_test", "select count(*) from information_schema.columns where table_name='communications_email_threads' and column_name in ('download_status','last_download_error');"), "2");
  assert.equal(psql(pgPort, "mangorts_realtime_test", "select count(*) from information_schema.tables where table_name='communications_email_thread_download_jobs';"), "1");
  assert.equal(psql(pgPort, "mangorts_realtime_test", "select count(*) from workspace_editor_formats;"), "0");
  assert.equal(psql(pgPort, "mangorts_realtime_test", "select count(*) from information_schema.tables where table_name in ('workspace_editor_formats','editor_json_documents','editor_json_operations','editor_json_versions');"), "4");
  assert.equal(psql(pgPort, "mangorts_realtime_test", "select count(*) from pg_constraint where conname in ('editor_collaboration_documents_model_version_chk','editor_collaboration_operations_kind_chk');"), "0");
  assert.equal(psql(pgPort, "mangorts_realtime_test", "select count(*) from information_schema.columns where table_name='editor_collaboration_documents' and column_name='canonical_html';"), "1");
  assert.equal(psql(pgPort, "mangorts_realtime_test", "select count(*) from information_schema.columns where table_name='editor_collaboration_operations' and column_name in ('patch','requires_snapshot');"), "2");

  const legacySQL = [
    "create type information_type as enum ('Text box');",
    "create table companies(company_id uuid primary key,name text not null);",
    "create table users(user_id uuid primary key,cognito_subject text not null unique,email text not null,display_name text not null);",
    "create table node_projection_table(company_id uuid not null,node_id uuid not null,information_id uuid not null,type information_type not null,information text not null,is_deleted boolean not null default false,revision bigint not null default 1,created_timestamp timestamptz not null default now(),updated_timestamp timestamptz not null default now(),primary key(company_id,node_id,information_id));",
    "create table logic_gate_projection_table(company_id uuid not null,logic_gate_id uuid not null,information_id uuid not null,type information_type not null,information text not null,is_deleted boolean not null default false,revision bigint not null default 1,created_timestamp timestamptz not null default now(),updated_timestamp timestamptz not null default now(),primary key(company_id,logic_gate_id,information_id));",
    "create table project_projection_table(company_id uuid not null,project_id uuid not null,information_id uuid not null,type information_type not null,information text not null,created_timestamp timestamptz not null default now(),updated_timestamp timestamptz not null default now(),primary key(company_id,project_id,information_id));",
    "create unique index idx_logic_gate_projection_table_one_text_box on logic_gate_projection_table(company_id,logic_gate_id,type) where type='Text box'::information_type;",
    "create table resource_permissions(company_id uuid not null,resource_type text not null,resource_id uuid not null,subject_type text not null default 'user',subject_id uuid not null,user_id uuid,access_level text not null,created_timestamp timestamptz not null default now(),updated_timestamp timestamptz not null default now(),constraint resource_permissions_access_level_chk check(access_level in('no_access','view','edit','admin')),primary key(company_id,resource_type,resource_id,subject_type,subject_id));",
    "create table resource_permission_subtree_applications(application_id bigserial primary key,policy_sequence bigint not null,company_id uuid not null,ancestor_resource_type text not null,ancestor_resource_id uuid not null,rule_key text not null,subject_type text,subject_id uuid,access_level text,deleted boolean not null default false,created_timestamp timestamptz not null default now(),constraint resource_permission_subtree_applications_access_level_chk check(access_level is null or access_level in('no_access','view','edit','admin')),constraint resource_permission_subtree_applications_rule_shape_chk check((rule_key='__default__' and subject_type is null and subject_id is null and access_level in('view','edit','admin','no_access') and not deleted) or (rule_key<>'__default__' and subject_type in('user','group') and subject_id is not null and (deleted or access_level in('view','edit','admin','no_access')))));",
    "insert into companies values('" + COMPANY_A + "','Legacy company');",
    "insert into users values('" + USER_A + "','legacy-user','legacy@example.test','Legacy User');",
    "insert into resource_permissions values('" + COMPANY_A + "','node','" + NODE_A + "','user','" + USER_A + "','" + USER_A + "','view',now(),now());",
    "insert into resource_permission_subtree_applications(policy_sequence,company_id,ancestor_resource_type,ancestor_resource_id,rule_key,subject_type,subject_id,access_level) values(1,'" + COMPANY_A + "','node','" + NODE_A + "','__default__',null,null,'admin'),(1,'" + COMPANY_A + "','node','" + NODE_A + "','user:" + USER_A + "','user','" + USER_A + "','view');",
  ].join("\n");
  psql(pgPort, "mangorts_realtime_legacy", legacySQL);
  run("Run the historical migrations against the legacy fixture", migrateExe, [
    "-mode", "migrate", "-migrations", legacyMigrationDir,
  ], { cwd: backend, env: databaseEnv(pgPort, "mangorts_realtime_legacy") });
  assert.equal(psql(pgPort, "mangorts_realtime_legacy", "select string_agg(access_level,',' order by access_level) from resource_permissions;"), "edit");
  assert.equal(psql(pgPort, "mangorts_realtime_legacy", "select string_agg(access_level,',' order by application_id) from resource_permission_subtree_applications;"), "edit,edit");
  assert.equal(psql(pgPort, "mangorts_realtime_legacy", "select mangorts_access_level_rank('no_access')||','||mangorts_access_level_rank('edit')||','||mangorts_access_level_rank('view');"), "0,1,0");
  assert.equal(psql(pgPort, "mangorts_realtime_legacy", "select to_regclass('idx_logic_gate_projection_table_one_text_box') is null and to_regclass('idx_logic_gate_projection_table_text_boxes') is not null;"), "t");

  psql(pgPort, "mangorts_realtime_legacy", [
    "insert into node_projection_table(company_id,node_id,information_id,type,information,is_deleted,revision) values('" + COMPANY_A + "','" + NODE_A + "','" + DOC_A + "','Text box','" + INITIAL_RICH_EDITOR_HTML.replaceAll("'", "''") + "',false,7);",
    "insert into editor_collaboration_documents(company_id,resource_type,resource_id,document_id,revision,snapshot_revision,snapshot_state) values('" + COMPANY_A + "','node','" + NODE_A + "','" + DOC_A + "',1,0,'" + STALE_STRUCTURED_EDITOR_STATE.replaceAll("'", "''") + "'::jsonb);",
    "insert into editor_collaboration_operations(company_id,resource_type,resource_id,document_id,revision,operation_id,client_id,base_revision,delta,event_id) values('" + COMPANY_A + "','node','" + NODE_A + "','" + DOC_A + "',1,'legacy-operation','legacy-client',0,'{\"ops\":[{\"insert\":\"stale\"}]}'::jsonb,'44444444-4444-4444-8444-444444444444');",
  ].join("\n"));
  copyFileSync(resolve(backend, "db", "migrations", "20260716_restore_rich_html_collaboration.sql"), resolve(legacyMigrationDir, "20260716_restore_rich_html_collaboration.sql"));
  run("Migrate legacy structured state to authoritative projection rich HTML", migrateExe, [
    "-mode", "migrate", "-migrations", legacyMigrationDir,
  ], { cwd: backend, env: databaseEnv(pgPort, "mangorts_realtime_legacy") });
  run("Prove legacy commands are safe before the Node V2 schema exists", "go", [
    "test", "./internal/store", "-run", "TestPostgresPreV2TimelineBridgeIsCapabilityGated", "-count=1", "-v",
  ], { cwd: backend, env: { ...databaseEnv(pgPort, "mangorts_realtime_legacy"), MANGORTS_PRE_V2_POSTGRES_TEST: "1" } });

  copyFileSync(resolve(backend, "db", "migrations", "20260718_tiptap_json_foundation.sql"), resolve(legacyMigrationDir, "20260718_tiptap_json_foundation.sql"));
  run("Add the inactive Tiptap JSON foundation without converting the legacy fixture", migrateExe, [
    "-mode", "migrate", "-migrations", legacyMigrationDir,
  ], { cwd: backend, env: databaseEnv(pgPort, "mangorts_realtime_legacy") });
  copyFileSync(resolve(backend, "db", "migrations", "20260719_zz_tiptap_annotation_positions.sql"), resolve(legacyMigrationDir, "20260719_zz_tiptap_annotation_positions.sql"));
  run("Add revision-bound Tiptap annotation positions without converting the legacy fixture", migrateExe, [
    "-mode", "migrate", "-migrations", legacyMigrationDir,
  ], { cwd: backend, env: databaseEnv(pgPort, "mangorts_realtime_legacy") });
  assert.equal(psql(pgPort, "mangorts_realtime_legacy", "select count(*) from information_schema.columns where table_name in ('editor_json_documents','editor_json_operations','editor_json_versions') and column_name='canonical_annotations';"), "3");
  assert.equal(psql(pgPort, "mangorts_realtime_legacy", "select canonical_html from editor_collaboration_documents where company_id='" + COMPANY_A + "' and resource_id='" + NODE_A + "' and document_id='" + DOC_A + "';"), INITIAL_RICH_EDITOR_HTML);
  assert.equal(psql(pgPort, "mangorts_realtime_legacy", "select count(*) from workspace_editor_formats;"), "0");
  assert.equal(psql(pgPort, "mangorts_realtime_legacy", "select count(*) from editor_json_documents;"), "0");
  assert.equal(psql(pgPort, "mangorts_realtime_legacy", "select (patch->>'start_utf8')||','||(patch->>'delete_utf8')||','||(patch->>'insert')||','||requires_snapshot::text from editor_collaboration_operations where operation_id='legacy-operation';"), "0,0,,true");
  assert.equal(psql(pgPort, "mangorts_realtime_legacy", "select count(*) from information_schema.columns where table_name in ('editor_collaboration_documents','editor_collaboration_operations') and column_name in ('model_version','snapshot_revision','snapshot_state','accumulated_delta_bytes','operation_kind','delta');"), "0");

  run("Real PostgreSQL producer atomicity and retry tests", "go", [
    "test", "./internal/store", "./internal/http", "-run", "TestPostgresRealtime", "-count=1", "-v",
  ], { cwd: backend, env: { ...cleanEnv, MANGORTS_REALTIME_POSTGRES_TEST: "1" } });

  psql(pgPort, "mangorts_realtime_test", [
    "insert into companies(company_id,name) values('" + COMPANY_A + "','Browser Company A'),('" + COMPANY_B + "','Browser Company B');",
    "insert into users(user_id,cognito_subject,email,display_name) values('" + USER_A + "','browser-user-a','browser-user-a@mangorts.test','Browser User A'),('" + USER_B + "','browser-user-b','browser-user-b@mangorts.test','Browser User B'),('" + USER_OTHER + "','browser-user-other','browser-user-other@mangorts.test','Browser User Other');",
    "insert into company_memberships(company_id,user_id,role) values('" + COMPANY_A + "','" + USER_A + "','company_user'),('" + COMPANY_A + "','" + USER_B + "','company_user'),('" + COMPANY_B + "','" + USER_OTHER + "','company_user');",
    "insert into nodes(company_id,node_id,name,default_access,created_timestamp) values('" + COMPANY_A + "','" + NODE_A + "','Collaborative Node','edit',now()),('" + COMPANY_A + "','" + NODE_A_OTHER + "','Isolated Node','edit',now()),('" + COMPANY_B + "','" + NODE_B + "','Other Company Node','edit',now());",
    "insert into logic_gates(company_id,logic_gate_id,header,default_access,created_timestamp) values('" + COMPANY_A + "','" + GATE_A + "','Collaborative Logic Gate','edit',now());",
    "insert into projects(company_id,project_id,name,default_access) values('" + COMPANY_A + "','" + PROJECT_A + "','Collaborative Project','edit');",
    "insert into node_projection_table(company_id,node_id,information_id,type,information,is_deleted,revision,created_timestamp,updated_timestamp) values('" + COMPANY_A + "','" + NODE_A + "','" + DOC_A + "','Text box','" + INITIAL_RICH_EDITOR_HTML.replaceAll("'", "''") + "',false,1,now(),now());",
    "insert into editor_collaboration_documents(company_id,resource_type,resource_id,document_id,revision,canonical_html,is_deleted) values('" + COMPANY_A + "','node','" + NODE_A + "','" + DOC_A + "',0,'" + INITIAL_RICH_EDITOR_HTML.replaceAll("'", "''") + "',false);",
  ].join("\n"));
  psql(pgPort, "mangorts_realtime_test", [
    "insert into communications_email_threads(company_id,email_thread_id,scope_type,personal_user_id,personal_account_email,account_email,provider_thread_key,provider_thread_id,root_provider_message_id,download_status,history_complete) values('" + COMPANY_A + "','44444444-0000-4000-8000-000000000001','personal','" + USER_A + "','browser-user-a@mangorts.test','browser-user-a@mangorts.test','durable-browser-thread','durable-browser-thread','browser-provider-001','complete',true);",
    "insert into communications_email_messages(company_id,email_message_id,email_thread_id,provider_message_id,message_order,subject,message_timestamp,rich_html_body,text_fallback,snippet) select '" + COMPANY_A + "',('44444444-1000-4000-8000-'||lpad(series::text,12,'0'))::uuid,'44444444-0000-4000-8000-000000000001',('browser-provider-'||lpad(series::text,3,'0')),(series-1)/3,'Durable Node v2 email',1700000000+series,('<p>Durable independent HTML email body '||series||'<script>throw new Error(1)</script></p>'),('Durable independent HTML email body '||series),('Durable message '||series) from generate_series(1,35) series;",
    "insert into communications_node_email_threads(company_id,node_id,information_id,email_thread_id,selected_provider_message_id,created_by_user_id) values('" + COMPANY_A + "','" + NODE_A + "','44444444-2000-4000-8000-000000000001','44444444-0000-4000-8000-000000000001','browser-provider-001','" + USER_A + "');",
  ].join("\n"));


  const apiProcessOptions = (port) => ({
    cwd: backend,
    env: {
      ...cleanEnv,
      APP_ENV: "test",
      AUTH_MODE: "disabled",
      MANGORTS_ENABLE_TEST_AUTH_HEADER: "true",
      MANGORTS_REALTIME_TICKET_SECRET: "mangorts-realtime-browser-ticket-secret-32-bytes",
      MANGORTS_ALLOWED_ORIGIN: "http://127.0.0.1:" + frontendPort,
      MANGORTS_ADDR: "127.0.0.1:" + port,
      MANGORTS_ATTACHMENT_S3_BUCKET: "mangorts-disposable-browser",
      MANGORTS_ATTACHMENT_AWS_REGION: "us-west-1",
      MANGORTS_ATTACHMENT_S3_ENDPOINT: "http://127.0.0.1:" + s3Port,
      MANGORTS_ATTACHMENT_S3_PRESIGN_ENDPOINT: "http://127.0.0.1:" + s3Port,
      MANGORTS_ATTACHMENT_S3_SERVER_SIDE_ENCRYPTION: "none",
      AWS_ACCESS_KEY_ID: "disposable-test",
      AWS_SECRET_ACCESS_KEY: "disposable-test",
      AWS_EC2_METADATA_DISABLED: "true",
    },
  });
  const s3Record = startProcess("node-v2-s3", process.execPath, [
    resolve(frontend, "scripts", "node-v2-s3-mock.mjs"),
  ], { cwd: frontend, env: { ...process.env, MANGORTS_NODE_V2_S3_PORT: String(s3Port) } });
  const collaborationRecord = startProcess("node-v2-collaboration", process.execPath, [
    collaborationService,
  ], { cwd: frontend, env: {
    ...process.env,
    DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${pgPort}/mangorts_realtime_test`,
    MANGORTS_REALTIME_TICKET_SECRET: "mangorts-realtime-browser-ticket-secret-32-bytes",
    NODE_V2_COLLAB_ADDRESS: "127.0.0.1",
    NODE_V2_COLLAB_PORT: String(collaborationPort),
    NODE_V2_COLLAB_MATERIALIZE_MS: "100",
  } });
  let apiRecords = apiPorts.map((port, index) =>
    startAPIProcess("api-" + (index + 1), apiProcessOptions(port)));
  const restartAPI = async (index) => {
    await stopProcess(apiRecords[index]);
    apiRecords[index] = startAPIProcess("api-" + (index + 1) + "-restart", apiProcessOptions(apiPorts[index]));
    await waitForURL("http://127.0.0.1:" + apiPorts[index] + "/healthz");
  };
  const viteRecord = startProcess("vite", process.execPath, [
    resolve(frontend, "node_modules", "vite", "bin", "vite.js"),
    "--host", "127.0.0.1", "--port", String(frontendPort), "--strictPort",
  ], { cwd: frontend, env: { ...process.env, VITE_API_BASE_URL: "http://127.0.0.1:" + apiPorts[0], VITE_COMPANY_ID: COMPANY_A, VITE_AUTH_MODE: "disabled", VITE_NODE_V2_PHASE2: "true", VITE_NODE_V2_COLLAB_URL: "ws://127.0.0.1:" + collaborationPort } });
  try {
    await Promise.all(apiPorts.map((port) => waitForURL("http://127.0.0.1:" + port + "/healthz")));
    await waitForURL("http://127.0.0.1:" + s3Port + "/healthz");
    await waitForURL("http://127.0.0.1:" + collaborationPort + "/healthz");
    for (const port of apiPorts) {
      const response = await fetch("http://127.0.0.1:" + port + "/v1/me", {
        headers: { "X-Mango-Test-Subject": "browser-user-a" },
      });
      const body = await response.text();
      assert.equal(response.status, 200, "test-only auth boundary failed on API " + port + ": " + body + "\n" + apiRecords.map((item) => item.label + ":\n" + item.logs.join("")).join("\n"));
    }
    const inactiveResponse = await fetch("http://127.0.0.1:" + apiPorts[0] + "/v1/nodes/" + NODE_B + "/v2/availability?company_id=" + COMPANY_B, {
      headers: { "X-Mango-Test-Subject": "browser-user-other" },
    });
    assert.equal(inactiveResponse.status, 200);
    assert.equal((await inactiveResponse.json()).active, false, "unconverted workspace must retain the legacy editor");

    await waitForURL("http://127.0.0.1:" + frontendPort + "/editor-textbox-sync-e2e.html");
    try {
      await browserMatrix(frontendPort, apiPorts, pgPort, restartAPI);
      psql(pgPort, "mangorts_realtime_test", [
        "insert into editor_conversion_runs(conversion_run_id,company_id,owner_type,mode,status,batch_size,source_snapshot_timestamp,backup_reference,completed_timestamp) values('33333333-3333-4333-8333-333333333301','" + COMPANY_A + "','all','shadow_validate','completed',100,now(),'disposable browser proof',now());",
        "insert into editor_rollout_gates(company_id,owner_type,rollout_state,validation_run_id,validated_timestamp,activated_timestamp) select '" + COMPANY_A + "',owner_type,'active','33333333-3333-4333-8333-333333333301',now(),now() from unnest(array['node','project','logic_gate']) owner_type;",
        "insert into workspace_editor_formats(company_id,editor_format,migration_state,expected_document_count,converted_document_count,validated_timestamp,cutover_timestamp) values('" + COMPANY_A + "','tiptap_json','ready',0,0,now(),now());",
      ].join("\n"));
      for (let index = 0; index < 35; index++) {
        const response = await fetch("http://127.0.0.1:" + apiPorts[0] + "/v1/nodes/" + NODE_A + "/v2/textboxes?company_id=" + COMPANY_A, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Mango-Test-Subject": "browser-user-a" },
          body: JSON.stringify({ idempotency_key: "browser-seed-textbox-" + String(index).padStart(3, "0") }),
        });
        assert.equal(response.status, 201, "Node v2 browser seed " + index + ": " + await response.text());
      }
      run("Node v2 Phase 2 disposable PostgreSQL/API/Vite/S3 browser workflow", process.execPath, [
        resolve(frontend, "scripts", "node-v2-phase2-browser.test.mjs"),
      ], { cwd: frontend, env: {
        ...process.env,
        MANGORTS_NODE_V2_FRONTEND: "http://127.0.0.1:" + frontendPort,
        MANGORTS_NODE_V2_API: "http://127.0.0.1:" + apiPorts[0],
        MANGORTS_NODE_V2_COMPANY: COMPANY_A,
        MANGORTS_NODE_V2_NODE: NODE_A,
        MANGORTS_NODE_V2_SUBJECT: "browser-user-a",
        MANGORTS_BROWSER_EXECUTABLE: browserExecutable,
      } });

    } catch (cause) {
      process.stderr.write("\nBrowser matrix backend logs:\n" + apiRecords.map((item) => item.label + ":\n" + item.logs.join("")).join("\n"));
      process.stderr.write("\nNode V2 collaboration logs:\n" + collaborationRecord.logs.join(""));
      throw cause;
    }
  } finally {
    stopping = true;
    await browser?.close().catch(() => {});
    await stopProcess(viteRecord);
    for (const record of apiRecords) await stopProcess(record);
    await stopProcess(collaborationRecord);
    await stopProcess(s3Record);
  }
  process.stdout.write("\nProduction-path realtime collaboration tests passed.\n");
}

try {
  await main();
} finally {
  stopping = true;
  await browser?.close().catch(() => {});
  for (const record of [...processes].reverse()) await stopProcess(record);
  if (pgStarted) {
    try {
      execFileSync(pgTools.pg_ctl, ["-D", pgData, "-m", "fast", "-w", "stop"], { stdio: "ignore" });
    } catch {
      if (existsSync(pgLog)) process.stderr.write(readFileSync(pgLog, "utf8"));
    }
  }
  const resolved = resolve(tempRoot);
  const parent = resolve(tmpdir());
  if (!(resolved.startsWith(parent + "\\") || resolved.startsWith(parent + "/"))) {
    throw new Error("Refusing to remove unexpected integration path: " + resolved);
  }
  if (!resolved.includes("mangorts-realtime-production-path-")) {
    throw new Error("Refusing to remove unrecognized integration path: " + resolved);
  }
  rmSync(resolved, { recursive: true, force: true });
  const resolvedGoBuildRoot = resolve(goBuildRoot);
  const resolvedGoBuildParent = resolve(goBuildParent);
  if (!(resolvedGoBuildRoot.startsWith(resolvedGoBuildParent + "\\") || resolvedGoBuildRoot.startsWith(resolvedGoBuildParent + "/"))) {
    throw new Error("Refusing to remove unexpected Go build path: " + resolvedGoBuildRoot);
  }
  if (!resolvedGoBuildRoot.includes("realtime-production-path-")) {
    throw new Error("Refusing to remove unrecognized Go build path: " + resolvedGoBuildRoot);
  }
  rmSync(resolvedGoBuildRoot, { recursive: true, force: true });
  const resolvedCollaborationBuildRoot = resolve(collaborationBuildRoot);
  const collaborationBuildParent = resolve(frontend);
  if (!(resolvedCollaborationBuildRoot.startsWith(collaborationBuildParent + "\\") || resolvedCollaborationBuildRoot.startsWith(collaborationBuildParent + "/"))) {
    throw new Error("Refusing to remove unexpected collaboration build path: " + resolvedCollaborationBuildRoot);
  }
  if (!resolvedCollaborationBuildRoot.includes(".mangorts-realtime-production-path-")) {
    throw new Error("Refusing to remove unrecognized collaboration build path: " + resolvedCollaborationBuildRoot);
  }
  rmSync(resolvedCollaborationBuildRoot, { recursive: true, force: true });
}
