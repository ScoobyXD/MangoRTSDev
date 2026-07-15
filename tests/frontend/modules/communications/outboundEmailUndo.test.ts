import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getPendingOutboundEmailSends,
  isOutboundEmailUndoneError,
  scheduleOutboundEmailDispatch,
  sendOutboundEmailNow,
  undoAllOutboundEmailSends,
  undoOutboundEmailSend,
} from "../../../../frontend/src/modules/communications/outboundEmailUndo.js";

test("undo rejects the queued send without dispatching", async () => {
  undoAllOutboundEmailSends();
  let dispatchCount = 0;
  const pending = scheduleOutboundEmailDispatch(async () => {
    dispatchCount += 1;
    return "sent";
  }, { label: "Quarterly update" });

  const [queued] = getPendingOutboundEmailSends();
  assert.ok(queued);
  assert.equal(queued.label, "Quarterly update");
  assert.equal(dispatchCount, 0);
  assert.equal(undoOutboundEmailSend(queued.id), true);
  assert.equal(undoOutboundEmailSend(queued.id), false);
  await assert.rejects(pending, isOutboundEmailUndoneError);
  assert.equal(dispatchCount, 0);
  assert.deepEqual(getPendingOutboundEmailSends(), []);
});

test("expiry dispatches exactly once after the full ten-second window", async (t: any) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  undoAllOutboundEmailSends();
  let dispatchCount = 0;
  const pending = scheduleOutboundEmailDispatch(async () => {
    dispatchCount += 1;
    return "sent";
  });
  t.mock.timers.tick(9_999);
  assert.equal(dispatchCount, 0);
  t.mock.timers.tick(1);
  const result = await pending;
  assert.equal(result, "sent");
  assert.equal(dispatchCount, 1);
  assert.deepEqual(getPendingOutboundEmailSends(), []);
});

test("send now dispatches only the selected attempt immediately and cancels its timer", async (t: any) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  undoAllOutboundEmailSends();
  let dispatchCount = 0;
  const pending = scheduleOutboundEmailDispatch(async () => {
    dispatchCount += 1;
    return "sent-now";
  }, { label: "Immediate update" });
  const untouched = scheduleOutboundEmailDispatch(async () => {
    dispatchCount += 1;
    return "unexpected";
  }, { label: "Still undoable" });

  const [queued, untouchedQueued] = getPendingOutboundEmailSends();
  assert.ok(queued);
  assert.ok(untouchedQueued);
  assert.equal(dispatchCount, 0);
  assert.equal(sendOutboundEmailNow(queued.id), true);
  assert.equal(sendOutboundEmailNow(queued.id), false);
  assert.equal(await pending, "sent-now");
  assert.equal(dispatchCount, 1);
  assert.deepEqual(getPendingOutboundEmailSends().map((item) => item.id), [untouchedQueued.id]);
  assert.equal(undoOutboundEmailSend(untouchedQueued.id), true);
  await assert.rejects(untouched, isOutboundEmailUndoneError);
  assert.deepEqual(getPendingOutboundEmailSends(), []);

  t.mock.timers.tick(10_000);
  assert.equal(dispatchCount, 1);
});

test("expiry and send now each dispatch once and preserve the same backend failure", async (t: any) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  undoAllOutboundEmailSends();
  const backendError = Object.assign(new Error("attachment_storage_failed"), { code: "attachment_storage_failed" });
  let delayedDispatches = 0;
  let immediateDispatches = 0;
  const delayed = scheduleOutboundEmailDispatch(async () => {
    delayedDispatches += 1;
    throw backendError;
  }, { label: "Delayed failure" });
  const immediate = scheduleOutboundEmailDispatch(async () => {
    immediateDispatches += 1;
    throw backendError;
  }, { label: "Immediate failure" });

  const [, immediatePending] = getPendingOutboundEmailSends();
  assert.ok(immediatePending);
  assert.equal(sendOutboundEmailNow(immediatePending.id), true);
  await assert.rejects(immediate, (error: unknown) => error === backendError);
  assert.equal(immediateDispatches, 1);
  assert.equal(delayedDispatches, 0);

  t.mock.timers.tick(10_000);
  await assert.rejects(delayed, (error: unknown) => error === backendError);
  assert.equal(delayedDispatches, 1);
  assert.equal(immediateDispatches, 1);
  assert.deepEqual(getPendingOutboundEmailSends(), []);
});

test("multiple sends remain independently undoable", async () => {
  undoAllOutboundEmailSends();
  let dispatchCount = 0;
  const first = scheduleOutboundEmailDispatch(async () => {
    dispatchCount += 1;
    return "first";
  }, { label: "First" });
  const second = scheduleOutboundEmailDispatch(async () => {
    dispatchCount += 1;
    return "second";
  }, { label: "Second" });

  assert.equal(getPendingOutboundEmailSends().length, 2);
  assert.equal(undoAllOutboundEmailSends(), 2);
  const settled = await Promise.allSettled([first, second]);
  assert.ok(settled.every((item) => item.status === "rejected" && isOutboundEmailUndoneError(item.reason)));
  assert.equal(dispatchCount, 0);
});

test("all send APIs enforce the shared window and every send surface exposes the neutral countdown", () => {
  const api = readFileSync(resolve(process.cwd(), "frontend/src/modules/communications/communicationsApi.ts"), "utf8");
  const banner = readFileSync(resolve(process.cwd(), "frontend/src/modules/communications/OutboundEmailUndoBanner.tsx"), "utf8");
  const home = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeMailWorkspace.tsx"), "utf8");
  const homePage = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomePage.tsx"), "utf8");
  const node = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"), "utf8");

  assert.match(api, /export async function sendEmail\(input: SendEmailInput\)/);
  assert.match(api, /export async function sendEmailCollaborationDraft\(input:/);
  assert.doesNotMatch(api, /undoWindowMs/);
  const scheduler = readFileSync(resolve(process.cwd(), "frontend/src/modules/communications/outboundEmailUndo.ts"), "utf8");
  assert.doesNotMatch(scheduler, /undoWindowMs\?:/);
  assert.match(scheduler, /export function sendOutboundEmailNow\(sendID: string\)/);
  assert.match(scheduler, /clearTimeout\(pending\.timer\)/);
  assert.match(banner, /window\.setInterval/);
  assert.match(banner, /width: `\$\{progress \* 100\}%`/);
  assert.match(banner, /onClick=\{\(\) => sendOutboundEmailNow\(pending\.id\)\}/);
  assert.match(banner, />\s*Send now\s*<\/button>/);
  assert.match(banner, />\s*Undo\s*<\/button>/);
  assert.doesNotMatch(banner, /#22c55e|#16a34a|#15803d/);
  assert.match(home, /<OutboundEmailUndoBanner \/>/);
  assert.match(node, /<OutboundEmailUndoBanner \/>/);
  assert.match(homePage, /const unscheduledCompose = \{ \.\.\.homeMailDraftToCompose\(draft\), scheduledAt: "" \}/);
  assert.match(homePage, /syncHomeMailDraftFromCompose\(companyID, currentUserID, unscheduledCompose, ""\)/);
});
