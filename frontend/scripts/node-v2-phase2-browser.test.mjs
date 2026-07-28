import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const frontendBase = process.env.MANGORTS_NODE_V2_FRONTEND ?? "http://127.0.0.1:5177";
const apiBase = process.env.MANGORTS_NODE_V2_API ?? "http://127.0.0.1:18082";
const companyID = process.env.MANGORTS_NODE_V2_COMPANY ?? "11111111-1111-1111-1111-111111111111";
const nodeID = process.env.MANGORTS_NODE_V2_NODE ?? "22222222-2222-4222-8222-222222222222";
const subject = process.env.MANGORTS_NODE_V2_SUBJECT ?? "browser-user-a";
const browserExecutable = process.env.MANGORTS_BROWSER_EXECUTABLE
  ?? (process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : "");

if (browserExecutable && !existsSync(browserExecutable)) throw new Error(`Browser executable missing: ${browserExecutable}`);

const browser = await chromium.launch({ executablePath: browserExecutable || undefined, headless: true, args: ["--disable-dev-shm-usage", "--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const failures = [];
let lastNodeOpenDuration = 0;

await context.route("**/*", async (route) => {
  const request = route.request();
  if (!request.url().startsWith(apiBase)) return route.continue();
  await route.continue({ headers: { ...request.headers(), "X-Mango-Test-Subject": subject } });
});

async function openNode() {
  const startedAt = performance.now();
  const page = await context.newPage();
  page.on("pageerror", (cause) => failures.push(`pageerror: ${cause.message}`));
  page.on("response", (response) => {
    // The existing shell probes this disabled legacy route in every editor mode.
    if (response.status() === 404 && response.request().method() === "PUT" && new URL(response.url()).pathname === "/v1/map-layout") return;
    if (response.url().startsWith(apiBase) && response.status() >= 400) failures.push(`${response.status()} ${response.request().method()} ${response.url()}`);
  });
  await page.goto(`${frontendBase}/nodes/${nodeID}`, { waitUntil: "domcontentloaded" });
  try {
    await page.getByTestId("node-v2-workspace").waitFor({ state: "visible", timeout: 30_000 });
  } catch (cause) {
    const diagnostic = (await page.locator("body").innerText()).slice(0, 2_000);
    console.error(`Node v2 workspace did not become visible. Failures: ${failures.join("; ")}\nBody: ${diagnostic}`);
    throw cause;
  }
  lastNodeOpenDuration = performance.now() - startedAt;
  return page;
}

async function waitSaved(page) {
  await page.locator(".node-v2-save-state").filter({ hasText: "Saved" }).waitFor({ timeout: 20_000 });
}

let page = await openNode();
assert.match(await page.getByTestId("node-v2-workspace").innerText(), /Node v2/i);

const firstPriorActiveID = await page.locator(".node-v2-textbox-card.is-active").getAttribute("data-node-v2-textbox-id");
await page.getByRole("button", { name: "New text box" }).click();
await page.waitForFunction((prior) => document.querySelector(".node-v2-textbox-card.is-active")?.getAttribute("data-node-v2-textbox-id") !== prior, firstPriorActiveID);
await page.locator(".node-v2-textbox-card.is-active").getByRole("textbox", { name: "Node text box" }).waitFor({ state: "visible", timeout: 20_000 });
const firstTextboxID = await page.locator(".node-v2-textbox-card.is-active").getAttribute("data-node-v2-textbox-id");
const firstText = `Phase 2 browser text ${Date.now()}`;
await page.getByRole("textbox", { name: "Node text box" }).fill(firstText);
await waitSaved(page);

const secondPriorActiveID = await page.locator(".node-v2-textbox-card.is-active").getAttribute("data-node-v2-textbox-id");
await page.getByRole("button", { name: "New text box" }).click();
await page.waitForFunction((prior) => document.querySelector(".node-v2-textbox-card.is-active")?.getAttribute("data-node-v2-textbox-id") !== prior, secondPriorActiveID);
await page.locator(".node-v2-textbox-card.is-active").getByRole("textbox", { name: "Node text box" }).waitFor({ state: "visible", timeout: 20_000 });
const secondText = `Independent second document ${Date.now()}`;
await page.getByRole("textbox", { name: "Node text box" }).click();
await page.getByRole("textbox", { name: "Node text box" }).type(secondText);
await waitSaved(page);
assert.equal(await page.getByRole("textbox", { name: "Node text box" }).count(), 1, "exactly one active Tiptap editor");
assert.ok(await page.getByTestId("node-v2-static-textbox").count() >= 1, "inactive text boxes render statically");
assert.ok(await page.locator(".node-v2-textbox-card").count() >= 30, "target-scale Node renders dozens of bounded text-box cards");
assert.ok(await page.locator(".node-v2-virtual-placeholder").count() >= 1, "offscreen text boxes are virtualized");
assert.ok(lastNodeOpenDuration < 10_000, `target-scale Node opened in ${lastNodeOpenDuration.toFixed(1)}ms`);
assert.equal(await page.getByRole("textbox", { name: "Node text box" }).getAttribute("aria-label"), "Node text box", "active editor has an accessible name");

await page.waitForTimeout(600);
await page.getByRole("button", { name: "Undo" }).click();
await page.waitForFunction((expected) => document.querySelector('[aria-label="Node text box"]')?.textContent?.trim() !== expected, secondText);
await waitSaved(page);
await page.getByRole("button", { name: "Redo" }).click();
await page.waitForFunction((expected) => document.querySelector('[aria-label="Node text box"]')?.textContent?.trim() === expected, secondText);
assert.equal((await page.getByRole("textbox", { name: "Node text box" }).innerText()).trim(), secondText);
await waitSaved(page);

await page.getByRole("textbox", { name: "Node text box" }).press("Control+A");
await page.getByLabel(/Chat about this text box/).fill("Anchored browser comment");
await page.getByRole("button", { name: "Add comment" }).click();
await page.locator(".node-v2-comment-thread").filter({ hasText: "Anchored browser comment" }).waitFor({ timeout: 20_000 });
await page.locator(".node-v2-comment-thread").filter({ hasText: "Anchored browser comment" }).getByPlaceholder("Reply").fill("Browser reply");
await page.locator(".node-v2-comment-thread").filter({ hasText: "Anchored browser comment" }).getByRole("button", { name: "Reply" }).click();
await page.locator(".node-v2-comment-thread").filter({ hasText: "Browser reply" }).waitFor({ timeout: 20_000 });

await page.getByRole("button", { name: "Timeline" }).click();
assert.ok(await page.getByText("Text box created", { exact: true }).count() >= 2);
await page.getByRole("button", { name: "Chat" }).click();

const activeCard = page.locator(".node-v2-textbox-card.is-active");
const secondTextboxID = await activeCard.getAttribute("data-node-v2-textbox-id");
await activeCard.getByRole("button", { name: "Archive", exact: true }).click();
await page.locator(".node-v2-archived").waitFor({ state: "visible", timeout: 20_000 });
await page.locator(".node-v2-archived > summary").click();
await page.locator(`.node-v2-archived > div[data-node-v2-textbox-id="${secondTextboxID}"]`).getByRole("button", { name: "Restore" }).click();
await page.locator('[data-node-v2-textbox-id="' + secondTextboxID + '"]').waitFor({ state: "attached", timeout: 20_000 });

await page.reload({ waitUntil: "domcontentloaded" });
await page.getByTestId("node-v2-workspace").waitFor({ timeout: 30_000 });
await page.getByRole("button", { name: "Load more text boxes" }).click();
await page.locator('[data-node-v2-textbox-id="' + firstTextboxID + '"]').waitFor({ state: "attached", timeout: 20_000 });
await page.locator('[data-node-v2-textbox-id="' + firstTextboxID + '"]').getByRole("button", { name: /Text box/ }).click();
await page.waitForFunction((expected) => document.querySelector('[aria-label="Node text box"]')?.textContent?.includes(expected), firstText);
await page.locator('[data-node-v2-textbox-id="' + secondTextboxID + '"]').getByRole("button", { name: /Text box/ }).click();
await page.waitForFunction((expected) => document.querySelector('[aria-label="Node text box"]')?.textContent?.includes(expected), secondText);


const firstCard = page.locator('[data-node-v2-textbox-id="' + firstTextboxID + '"]');
await firstCard.getByRole("button", { name: /Text box/ }).click();
await page.waitForFunction((expected) => document.querySelector(".node-v2-textbox-card.is-active")?.getAttribute("data-node-v2-textbox-id") === expected, firstTextboxID);
await page.locator(".node-v2-textbox-card.is-active").getByRole("textbox", { name: "Node text box" }).waitFor({ timeout: 20_000 });
await context.setOffline(true);
const offlineSuffix = ` offline recovery ${Date.now()}`;
await page.getByRole("textbox", { name: "Node text box" }).press("End");
await page.getByRole("textbox", { name: "Node text box" }).type(offlineSuffix);
await page.locator(".node-v2-save-state").filter({ hasText: "Saving" }).waitFor({ timeout: 10_000 });
await page.locator(".node-v2-save-state").filter({ hasText: "Offline" }).waitFor({ timeout: 10_000 });
await page.close();
await context.setOffline(false);
page = await openNode();
await page.locator('[data-node-v2-textbox-id="' + firstTextboxID + '"]').getByRole("button", { name: /Text box/ }).click();
await page.waitForFunction((expected) => document.querySelector(".node-v2-textbox-card.is-active")?.getAttribute("data-node-v2-textbox-id") === expected, firstTextboxID);
await page.locator(".node-v2-textbox-card.is-active").getByRole("textbox", { name: "Node text box" }).waitFor({ timeout: 20_000 });
await page.waitForFunction((expected) => document.querySelector('[aria-label="Node text box"]')?.textContent?.includes(expected), firstText + offlineSuffix);
await waitSaved(page);

await page.getByRole("button", { name: "Files" }).click();
assert.equal(await page.getByRole("button", { name: "Attach file" }).count(), 1);
const attachmentFilename = `phase-2-attachment-${Date.now()}.txt`;
const inlineImageFilename = `phase-2-inline-${Date.now()}.png`;
const attachmentInputs = page.locator('section[aria-label="Node attachments"] input[type="file"]');
await attachmentInputs.nth(0).setInputFiles({ name: attachmentFilename, mimeType: "text/plain", buffer: Buffer.from("Node v2 textbox-owned attachment") });
await page.getByText(attachmentFilename, { exact: true }).waitFor({ timeout: 30_000 });
await attachmentInputs.nth(1).setInputFiles({
  name: inlineImageFilename,
  mimeType: "image/png",
  buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2pWQAAAAASUVORK5CYII=", "base64"),
});
await page.getByText(inlineImageFilename, { exact: true }).waitFor({ timeout: 30_000 });
await page.locator(".node-v2-inline-image").last().waitFor({ state: "attached", timeout: 30_000 });
await page.getByRole("button", { name: `Select image ${inlineImageFilename}` }).click();
const imageActions = page.locator(".node-v2-inline-image.is-selected .node-v2-inline-image-actions");
await imageActions.getByRole("button", { name: "Preview" }).click();
await page.getByRole("dialog", { name: `Image preview: ${inlineImageFilename}` }).waitFor({ state: "visible" });
await page.getByRole("button", { name: "Close image preview" }).click();
await imageActions.getByRole("button", { name: "Align left" }).click();
const downloadPromise = page.waitForEvent("download");
await imageActions.getByRole("button", { name: "Download" }).click();
assert.equal((await downloadPromise).suggestedFilename(), inlineImageFilename);
await waitSaved(page);


const email = page.locator(".node-v2-email").filter({ hasText: "Durable Node v2 email" });
await email.waitFor({ timeout: 20_000 });
assert.equal(await page.locator(".node-v2-email").count(), 1, "Node-wide email aggregate is deduplicated");
assert.equal(await page.locator(".node-v2-email-message").count(), 0, "email bodies are lazy");
await email.getByRole("button", { name: "Load message bodies" }).click();
await email.getByText("Durable independent HTML email body", { exact: false }).first().waitFor({ timeout: 20_000 });
assert.equal(await email.locator("script").count(), 0, "durable email HTML is sanitized only for presentation");
await email.getByRole("button", { name: "Link to this text box" }).click();
await page.waitForFunction(() => document.querySelector(".node-v2-email button")?.hasAttribute("disabled"), undefined, { timeout: 20_000 });
assert.equal(await email.locator(".node-v2-email-message").count(), 30, "email message bodies are bounded to one page");
await email.getByRole("button", { name: "Load more messages" }).click();
await page.waitForFunction(() => document.querySelectorAll(".node-v2-email-message").length === 35);
const providerIDs = await email.locator(".node-v2-email-message").evaluateAll((items) => items.map((item) => item.getAttribute("data-provider-message-id")));
assert.equal(new Set(providerIDs).size, 35, "tied-order email continuation has no duplicates");
assert.equal(providerIDs.length, 35, "all email messages are reachable");
assert.equal(await email.getByRole("button", { name: "Link to this text box" }).isDisabled(), true, "textbox context is durable after reload");
const emailTextboxIDBefore = await page.locator(".node-v2-textbox-card.is-active").getAttribute("data-node-v2-textbox-id");
await email.getByRole("button", { name: "Create text box for this email" }).first().click();
await page.waitForFunction(
  (priorID) => document.querySelector(".node-v2-textbox-card.is-active.is-email-linked")?.getAttribute("data-node-v2-textbox-id") !== priorID,
  emailTextboxIDBefore,
);
const emailCreatedCard = page.locator(".node-v2-textbox-card.is-active.is-email-linked");
await emailCreatedCard.waitFor({ state: "visible", timeout: 20_000 });
assert.equal(await emailCreatedCard.getAttribute("data-linked-email-thread-id"), "44444444-0000-4000-8000-000000000001", "message-to-textbox keeps exact email context");

assert.deepEqual(failures, [], `browser/API failures: ${failures.join("; ")}`);
await context.close();
await browser.close();
console.log("Node v2 Phase 2 PostgreSQL-backed Mango browser workflow passed.");
