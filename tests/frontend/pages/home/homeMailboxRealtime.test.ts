import assert from "node:assert/strict";
import test from "node:test";

import {
  applyHomeMailboxCountDelta,
  consumeHomeMailboxLocalMutationEcho,
  cancelHomeMailboxListRequestTimers,
  createHomeArchiveStatusCoordinator,
  createHomeMailboxFolderLoadCoordinator,
  createHomeMailboxRealtimeCoordinator,
  forgetHomeMailboxLocalMutationEchoes,
  homeMailboxComposeSubmissionIsCurrent,
  homeMailboxCountKey,
  homeMailboxFolderOwnerIsCurrent,
  homeMailboxPendingMessageIDs,
  homeMailboxPendingMessageKey,
  homeMailboxRealtimeTargetKey,
  homeMailboxRequestOwnerIsCurrent,
  rememberHomeMailboxLocalMutationEchoes,
  homeMailboxRealtimeRefreshPlan,
  selectHomeMailboxRealtimeTarget,
  type HomeMailboxRealtimeRefreshPlan,
  type HomeMailboxFolderOwner,
  type HomeMailboxRealtimeTarget,
} from "../../../../frontend/src/pages/home/homeMailboxRealtime.js";

type MailboxOwner = Parameters<typeof homeMailboxRequestOwnerIsCurrent>[0];
type FolderOwner = HomeMailboxFolderOwner;

function fakeTimers() {
  let nextID = 1;
  const callbacks = new Map<number, () => void>();
  return {
    setTimer(callback: () => void) {
      const id = nextID++;
      callbacks.set(id, callback);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer(id: ReturnType<typeof setTimeout>) {
      callbacks.delete(id as unknown as number);
    },
    runNext() {
      const next = callbacks.entries().next().value as [number, () => void] | undefined;
      if (!next) return false;
      callbacks.delete(next[0]);
      next[1]();
      return true;
    },
    get size() {
      return callbacks.size;
    },
  };
}

function personalTarget(accountEmail = "owner@example.com"): HomeMailboxRealtimeTarget {
  const target = selectHomeMailboxRealtimeTarget({
    companyID: "company-1",
    userID: "user-1",
    accountEmail,
    viewID: "my-triage",
    mailbox: "primary",
  });
  if (!target) throw new Error("expected_personal_mailbox_target");
  return target;
}

function sharedTarget(sharedInboxID = "inbox-1"): HomeMailboxRealtimeTarget {
  const target = selectHomeMailboxRealtimeTarget({
    companyID: "company-1",
    userID: "user-1",
    accountEmail: "shared@example.com",
    viewID: `shared:${sharedInboxID}`,
    mailbox: "primary",
    sharedInbox: { id: sharedInboxID, mailBearing: true },
  });
  if (!target) throw new Error("expected_shared_mailbox_target");
  return target;
}

test("selects only the exact active mail-bearing personal account or shared inbox", () => {
  assert.equal(
    personalTarget().scope,
    "mailbox:personal:account:user-1:owner@example.com",
  );
  assert.equal(
    personalTarget("second@example.com").scope,
    "mailbox:personal:account:user-1:second@example.com",
  );
  assert.equal(selectHomeMailboxRealtimeTarget({
    companyID: "company-1",
    userID: "user-1",
    accountEmail: "owner@example.com",
    viewID: "my-triage",
    mailbox: "primary",
    mailBearing: false,
  }), null, "a disconnected or reauthorization-blocked personal mailbox has no subscription");
  assert.equal(selectHomeMailboxRealtimeTarget({
    companyID: "company-1",
    userID: "user-1",
    accountEmail: "shared@example.com",
    viewID: "shared:inbox-1",
    mailbox: "primary",
    sharedInbox: { id: "inbox-1", mailBearing: true },
  })?.scope, "mailbox:shared:inbox-1");

  for (const input of [
    { viewID: "shared-root", mailbox: "primary" as const },
    { viewID: "shared:heading-1", mailbox: "primary" as const, sharedInbox: { id: "heading-1", mailBearing: false } },
    { viewID: "my-triage", mailbox: "drafts" as const },
    { viewID: "my-work", mailbox: "primary" as const },
  ]) {
    assert.equal(selectHomeMailboxRealtimeTarget({
      companyID: "company-1",
      userID: "user-1",
      accountEmail: "owner@example.com",
      ...input,
    }), null);
  }
});

test("equivalent mailbox metadata replacements keep one subscription lifetime", () => {
  const firstSharedTarget = sharedTarget("inbox-1");
  const replacementSharedTarget = sharedTarget("inbox-1");
  assert.notEqual(firstSharedTarget, replacementSharedTarget);
  assert.equal(homeMailboxRealtimeTargetKey(firstSharedTarget), homeMailboxRealtimeTargetKey(replacementSharedTarget));

  let installedKey = "";
  let subscriptionCount = 0;
  const install = (target: HomeMailboxRealtimeTarget | null) => {
    const key = homeMailboxRealtimeTargetKey(target);
    if (key === installedKey) return;
    installedKey = key;
    subscriptionCount += key ? 1 : 0;
  };

  install(firstSharedTarget);
  install(replacementSharedTarget);
  install({ ...replacementSharedTarget });
  assert.equal(subscriptionCount, 1, "replacing an unchanged shared-inbox resource does not resubscribe");

  install(sharedTarget("inbox-2"));
  assert.equal(subscriptionCount, 2, "navigating to a different exact mailbox does resubscribe");
});

test("subscription acceptance closes the initial-list race with one canonical folder and message reload", () => {
  const timers = fakeTimers();
  let invalidations = 0;
  let providerReads = 0;
  const coordinator = createHomeMailboxRealtimeCoordinator({
    target: personalTarget(),
    getRequestKey: () => "mailbox-A",
    getSelection: () => ({}),
    isRequestCurrent: (key) => key === "mailbox-A",
    invalidate: () => { invalidations += 1; },
    reconcile: () => { providerReads += 1; },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  coordinator.accepted();
  assert.equal(invalidations, 1, "acceptance invalidates reads that may have raced the subscription");
  assert.equal(timers.size, 1);
  assert.equal(providerReads, 0);
  coordinator.accepted();
  assert.equal(invalidations, 2, "reconnect also invalidates cached reads");
  assert.equal(timers.size, 1, "repeat acceptance coalesces with the pending canonical reload");
  timers.runNext();
  assert.equal(providerReads, 1);
  coordinator.dispose();
});

test("local archive, send, update, and delete echoes cause zero invalidations or provider reads", () => {
  const timers = fakeTimers();
  const target = personalTarget();
  const registry = new Map();
  const archiveIDs = Array.from({ length: 12 }, (_, index) => `archive-${index + 1}`);
  rememberHomeMailboxLocalMutationEchoes(registry, target.scope, "message.updated", archiveIDs, 1_000);
  rememberHomeMailboxLocalMutationEchoes(registry, target.scope, "message.created", ["sent-1"], 1_000);
  rememberHomeMailboxLocalMutationEchoes(registry, target.scope, "message.updated", ["star-1", "read-1"], 1_000);
  rememberHomeMailboxLocalMutationEchoes(registry, target.scope, "message.deleted", ["deleted-1"], 1_000);
  let invalidations = 0;
  let providerReads = 0;
  const coordinator = createHomeMailboxRealtimeCoordinator({
    target,
    getRequestKey: () => "mailbox-A",
    getSelection: () => ({}),
    isRequestCurrent: () => true,
    isLocalMutationEcho: (signal) => consumeHomeMailboxLocalMutationEcho(registry, signal, 1_001),
    invalidate: () => { invalidations += 1; },
    reconcile: () => { providerReads += 1; },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  for (const messageID of archiveIDs) {
    coordinator.changed({ scope: target.scope, trigger: "message.updated", message_id: messageID });
  }
  coordinator.changed({ scope: target.scope, trigger: "message.created", message_id: "sent-1" });
  coordinator.changed({ scope: target.scope, trigger: "message.updated", message_id: "star-1" });
  coordinator.changed({ scope: target.scope, trigger: "message.updated", message_id: "read-1" });
  coordinator.changed({ scope: target.scope, trigger: "message.deleted", message_id: "deleted-1" });
  assert.equal(invalidations, 0);
  assert.equal(timers.size, 0);
  assert.equal(providerReads, 0, "the complete local action confirmation burst performs no GET");

  rememberHomeMailboxLocalMutationEchoes(registry, target.scope, "message.updated", ["failed-1"], 1_000);
  forgetHomeMailboxLocalMutationEchoes(registry, target.scope, "message.updated", ["failed-1"]);
  coordinator.changed({ scope: target.scope, trigger: "message.updated", message_id: "failed-1" });
  assert.equal(invalidations, 1, "a failed local command does not hide a later external change");
  assert.equal(timers.runNext(), true);
  assert.equal(providerReads, 1);

  rememberHomeMailboxLocalMutationEchoes(registry, target.scope, "message.updated", ["expired-1"], 1_000);
  assert.equal(consumeHomeMailboxLocalMutationEcho(registry, {
    scope: target.scope,
    trigger: "message.updated",
    message_id: "expired-1",
  }, 1_000 + 5 * 60_000 + 1), false, "expired local mutations cannot suppress later external changes");
  coordinator.dispose();
});

test("an account B hint cannot invalidate or read the active account A mailbox", async () => {
  const timers = fakeTimers();
  const accountA = personalTarget("account-a@example.com");
  const accountB = personalTarget("account-b@example.com");
  let invalidations = 0;
  let providerReads = 0;
  const coordinator = createHomeMailboxRealtimeCoordinator({
    target: accountA,
    getRequestKey: () => "account-A-request",
    getSelection: () => ({}),
    isRequestCurrent: (key) => key === "account-A-request",
    invalidate: () => { invalidations += 1; },
    reconcile: () => { providerReads += 1; },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  coordinator.changed({
    scope: accountB.scope,
    trigger: "message.created",
    message_id: "account-b-message",
  });
  assert.equal(invalidations, 0);
  assert.equal(timers.size, 0);
  assert.equal(providerReads, 0, "an inactive personal account never wakes the active account");

  coordinator.changed({
    scope: accountA.scope,
    trigger: "message.created",
    message_id: "account-a-message",
  });
  assert.equal(timers.runNext(), true);
  await Promise.resolve();
  assert.equal(invalidations, 1);
  assert.equal(providerReads, 1, "the exact active account still reconciles normally");
  coordinator.dispose();
});

test("Shared Triage root installs no mailbox coordinator and socket hints cause zero provider reads", () => {
  const timers = fakeTimers();
  let providerReads = 0;
  const target = selectHomeMailboxRealtimeTarget({
    companyID: "company-1",
    userID: "user-1",
    accountEmail: "owner@example.com",
    viewID: "shared-root",
    mailbox: "primary",
  });
  const coordinator = target
    ? createHomeMailboxRealtimeCoordinator({
      target,
      getRequestKey: () => "unexpected-mailbox-request",
      getSelection: () => ({}),
      isRequestCurrent: () => true,
      invalidate: () => undefined,
      reconcile: () => { providerReads += 1; },
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    })
    : null;

  // A non-mail-bearing Shared Triage view has no subscription owner, so neither
  // an acceptance callback nor a shared-mailbox hint can schedule a provider GET.
  coordinator?.accepted();
  coordinator?.changed({
    scope: "mailbox:shared:inbox-1",
    trigger: "message.created",
    message_id: "shared-message",
  });
  while (timers.runNext()) {
    // Drain any erroneously scheduled work to make the no-read contract explicit.
  }
  assert.equal(target, null);
  assert.equal(providerReads, 0);
});

test("the exact active Shared Triage inbox reconciles while a different shared inbox stays off-view", async () => {
  const timers = fakeTimers();
  const active = sharedTarget("inbox-1");
  const inactive = sharedTarget("inbox-2");
  let invalidations = 0;
  let providerReads = 0;
  const coordinator = createHomeMailboxRealtimeCoordinator({
    target: active,
    getRequestKey: () => "shared-inbox-1-request",
    getSelection: () => ({}),
    isRequestCurrent: (key) => key === "shared-inbox-1-request",
    invalidate: () => { invalidations += 1; },
    reconcile: () => { providerReads += 1; },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  coordinator.accepted();
  assert.equal(invalidations, 1, "acceptance invalidates only the active shared mailbox cache");
  assert.equal(providerReads, 0);
  timers.runNext();
  await Promise.resolve();
  assert.equal(providerReads, 1, "acceptance reloads the visible shared-inbox list and folders once");

  coordinator.changed({ scope: inactive.scope, trigger: "message.created", message_id: "off-view" });
  assert.equal(timers.size, 0);
  assert.equal(invalidations, 1);
  assert.equal(providerReads, 1, "an off-view shared inbox never starts another provider read");

  coordinator.changed({ scope: active.scope, trigger: "message.updated", message_id: "active-message" });
  timers.runNext();
  await Promise.resolve();
  assert.equal(invalidations, 2);
  assert.equal(providerReads, 2, "an external active-inbox hint reconciles the visible list and folder metadata");
  coordinator.dispose();
});

test("external bursts coalesce visible-list, folder, and selected-detail work", async () => {
  const timers = fakeTimers();
  const resolvers: Array<() => void> = [];
  const plans: HomeMailboxRealtimeRefreshPlan[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const coordinator = createHomeMailboxRealtimeCoordinator({
    target: personalTarget(),
    getRequestKey: () => "mailbox-A",
    getSelection: () => ({ messageID: "selected", threadID: "thread-selected" }),
    isRequestCurrent: (key) => key === "mailbox-A",
    invalidate: () => undefined,
    reconcile: (plan) => {
      plans.push(plan);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise<void>((resolve) => {
        resolvers.push(() => {
          inFlight -= 1;
          resolve();
        });
      });
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  coordinator.accepted();
  coordinator.changed({ scope: personalTarget().scope, trigger: "message.created", message_id: "new-1" });
  coordinator.changed({ scope: personalTarget().scope, trigger: "folder.updated" });
  assert.equal(timers.size, 1);
  timers.runNext();
  assert.equal(plans.length, 1, "the external event burst starts one metadata reconciliation");
  assert.equal(maxInFlight, 1);

  coordinator.changed({ scope: personalTarget().scope, trigger: "message.updated", message_id: "selected" });
  coordinator.changed({ scope: personalTarget().scope, trigger: "message.deleted", message_id: "selected" });
  timers.runNext();
  assert.equal(plans.length, 1, "signals during the active read do not run in parallel");
  resolvers.shift()?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(plans.length, 2, "the active read is followed by one final merged reconciliation");
  assert.equal(plans[1].selectedDetail, true);
  assert.equal(maxInFlight, 1);
  resolvers.shift()?.();
  await Promise.resolve();
  coordinator.dispose();
});

test("presentation navigation drops stale list work but preserves exact-scope folder reconciliation", () => {
  const timers = fakeTimers();
  let requestKey = "account-A:primary";
  const plans: HomeMailboxRealtimeRefreshPlan[] = [];
  const coordinator = createHomeMailboxRealtimeCoordinator({
    target: personalTarget(),
    getRequestKey: () => requestKey,
    getSelection: () => ({}),
    isRequestCurrent: (key) => key === requestKey,
    invalidate: () => undefined,
    reconcile: (plan) => { plans.push(plan); },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  coordinator.changed({ scope: personalTarget().scope, trigger: "message.created", message_id: "new-1" });
  requestKey = "account-A:starred:q=urgent";
  assert.equal(timers.runNext(), true);
  assert.deepEqual(plans, [{ folders: true, messages: false, selectedDetail: false }]);

  coordinator.changed({ scope: personalTarget().scope, trigger: "message.created", message_id: "new-2" });
  coordinator.dispose();
  assert.equal(timers.size, 0);
  assert.equal(plans.length, 1, "scope disposal cancels pending work");
});

test("archive status uses one active pass plus one queued final pass for relevant hints only", async () => {
  const timers = fakeTimers();
  const target = personalTarget();
  const passes: string[] = [];
  const completions: Array<() => void> = [];
  const coordinator = createHomeArchiveStatusCoordinator({
    target,
    getActiveJobs: () => [{
      jobID: "archive-job-1",
      realtimeScope: target.scope,
      messageIDs: ["message-1"],
    }],
    revalidate: (jobID) => new Promise<void>((resolve) => {
      passes.push(jobID);
      completions.push(resolve);
    }),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  coordinator.revalidate("archive-job-1");
  assert.deepEqual(passes, ["archive-job-1"]);
  for (let index = 0; index < 20; index += 1) {
    coordinator.changed({ scope: target.scope, trigger: "message.updated", message_id: "message-1" });
  }
  coordinator.changed({ scope: target.scope, trigger: "message.updated", message_id: "unrelated-message" });
  coordinator.changed({ scope: personalTarget("other@example.com").scope, trigger: "message.updated", message_id: "message-1" });
  assert.equal(timers.size, 1, "twenty relevant hints share one delayed final pass");
  assert.equal(timers.runNext(), true);
  assert.deepEqual(passes, ["archive-job-1"], "the final pass waits behind the active read");

  completions.shift()?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(passes, ["archive-job-1", "archive-job-1"]);
  completions.shift()?.();
  await Promise.resolve();
  coordinator.dispose();
  assert.equal(timers.size, 0);
});

test("archive subscription acceptance reads only active jobs for the selected exact mailbox", () => {
  const timers = fakeTimers();
  const target = sharedTarget("inbox-1");
  const passes: string[] = [];
  const coordinator = createHomeArchiveStatusCoordinator({
    target,
    getActiveJobs: () => [
      { jobID: "selected-job", realtimeScope: target.scope, messageIDs: ["selected-message"] },
      { jobID: "other-job", realtimeScope: sharedTarget("inbox-2").scope, messageIDs: ["other-message"] },
    ],
    revalidate: (jobID) => { passes.push(jobID); },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  coordinator.accepted();
  assert.equal(timers.runNext(), true);
  assert.deepEqual(passes, ["selected-job"]);
  coordinator.dispose();
});

test("mailbox-owned timers and async completions cannot mutate a newly selected mailbox", async () => {
  const timers = fakeTimers();
  const ownerA: MailboxOwner = {
    requestKey: "company-1:account-a:primary",
    mailboxScopeKey: "company-1:user-1:account-a@example.com",
  };
  const ownerB: MailboxOwner = {
    requestKey: "company-1:account-b:primary",
    mailboxScopeKey: "company-1:user-1:account-b@example.com",
  };
  let currentOwner = ownerA;
  const applied: string[] = [];
  const applyIfOwned = (owner: MailboxOwner, value: string) => {
    if (homeMailboxRequestOwnerIsCurrent(owner, currentOwner)) applied.push(value);
  };

  timers.setTimer(() => applyIfOwned(ownerA, "timer-A"));
  let completeA!: () => void;
  const staleCompletion = new Promise<void>((resolve) => {
    completeA = () => {
      applyIfOwned(ownerA, "completion-A");
      resolve();
    };
  });

  currentOwner = ownerB;
  assert.equal(timers.runNext(), true);
  completeA();
  await staleCompletion;
  assert.deepEqual(applied, [], "mailbox A cannot apply delayed or completed work to mailbox B");

  timers.setTimer(() => applyIfOwned(ownerB, "timer-B"));
  assert.equal(timers.runNext(), true);
  applyIfOwned(ownerB, "completion-B");
  assert.deepEqual(applied, ["timer-B", "completion-B"], "the current mailbox still applies its own work");
});

test("list request cleanup preserves captured exact-scope mark-read timers", () => {
  const timerIDs = new Set([11, 12, 13]);
  const markReadTimers = new Map([["account-A:message-1", 12]]);
  const cleared: number[] = [];
  cancelHomeMailboxListRequestTimers(
    timerIDs,
    markReadTimers,
    (timerID) => { cleared.push(timerID); },
  );
  assert.deepEqual(cleared, [11, 13]);
  assert.deepEqual([...timerIDs], [12]);
  assert.equal(markReadTimers.get("account-A:message-1"), 12);
});

test("request ownership requires both the exact list key and exact account or shared-inbox scope", () => {
  const current: MailboxOwner = {
    requestKey: "company-1:primary:query=urgent",
    mailboxScopeKey: "company-1:user-1:account-a@example.com",
  };
  assert.equal(homeMailboxRequestOwnerIsCurrent(current, current), true);
  assert.equal(homeMailboxRequestOwnerIsCurrent({ ...current, requestKey: "company-1:archive:query=urgent" }, current), false);
  assert.equal(homeMailboxRequestOwnerIsCurrent({ ...current, mailboxScopeKey: "company-1:user-1:account-b@example.com" }, current), false);
  assert.equal(homeMailboxRequestOwnerIsCurrent({ ...current, mailboxScopeKey: "company-1:shared:inbox-1" }, current), false);
  assert.equal(homeMailboxRequestOwnerIsCurrent({ requestKey: "", mailboxScopeKey: current.mailboxScopeKey }, current), false);
});

test("folder ownership is the exact company-scoped mailbox key, independent of presentation filters", () => {
  const current: FolderOwner = { mailboxScopeKey: "company-1:user-1:account-a@example.com" };
  assert.equal(homeMailboxFolderOwnerIsCurrent(current, current), true);
  assert.equal(homeMailboxFolderOwnerIsCurrent({ mailboxScopeKey: "company-2:user-1:account-a@example.com" }, current), false);
  assert.equal(homeMailboxFolderOwnerIsCurrent({ mailboxScopeKey: "company-1:shared:inbox-1" }, current), false);
});

test("a pending folder load is rejected after the exact mailbox scope changes", async () => {
  const owner: FolderOwner = {
    mailboxScopeKey: "company-1:user-1:account-a@example.com",
  };
  let currentOwner = owner;
  let finish!: () => void;
  const coordinator = createHomeMailboxFolderLoadCoordinator({
    isOwnerCurrent: (candidate) => homeMailboxFolderOwnerIsCurrent(candidate, currentOwner),
    load: (candidate) => new Promise<boolean>((resolve) => {
      finish = () => resolve(homeMailboxFolderOwnerIsCurrent(candidate, currentOwner));
    }),
  });
  const loading = coordinator.request(owner);
  currentOwner = { mailboxScopeKey: "company-1:user-1:account-b@example.com" };
  coordinator.cancelObsolete(currentOwner);
  finish();
  assert.equal(await loading, false);
  coordinator.dispose();
});

test("an external metadata refresh queues once behind the initial folder load", async () => {
  const owner: FolderOwner = {
    mailboxScopeKey: "company-1:user-1:account-a@example.com",
  };
  let currentOwner = owner;
  let activeLoads = 0;
  let maxActiveLoads = 0;
  const loads: Array<{ refresh: boolean; resolve: (loaded: boolean) => void }> = [];
  const coordinator = createHomeMailboxFolderLoadCoordinator({
    isOwnerCurrent: (candidate) => homeMailboxFolderOwnerIsCurrent(candidate, currentOwner),
    load: (_candidate, refresh) => new Promise<boolean>((resolve) => {
      activeLoads += 1;
      maxActiveLoads = Math.max(maxActiveLoads, activeLoads);
      loads.push({
        refresh,
        resolve: (loaded) => {
          activeLoads -= 1;
          resolve(loaded);
        },
      });
    }),
  });

  const initial = coordinator.request(owner);
  const externalRefresh = coordinator.request(owner, true);
  const duplicateExternalRefresh = coordinator.request(owner, true);
  assert.deepEqual(loads.map((load) => load.refresh), [false], "an external metadata refresh must not overlap the initial provider read");

  loads[0].resolve(true);
  await initial;
  await Promise.resolve();
  assert.deepEqual(loads.map((load) => load.refresh), [false, true], "one final canonical refresh follows the initial read");
  assert.equal(maxActiveLoads, 1);

  loads[1].resolve(true);
  assert.equal(await externalRefresh, true);
  assert.equal(await duplicateExternalRefresh, true);
  assert.equal(loads.length, 2, "duplicate external refresh signals coalesce into the same final refresh");

  currentOwner = { mailboxScopeKey: "other" };
  coordinator.dispose();
});

test("pending star ownership keeps identical provider message IDs isolated by mailbox", () => {
  const accountAScope = "company-1:user-1:account-a@example.com";
  const accountBScope = "company-1:user-1:account-b@example.com";
  const sharedScope = "company-1:shared:inbox-1";
  const pendingKeys = [
    homeMailboxPendingMessageKey(accountAScope, "same-provider-message-id"),
    homeMailboxPendingMessageKey(accountBScope, "same-provider-message-id"),
    homeMailboxPendingMessageKey(sharedScope, "same-provider-message-id"),
  ];

  assert.deepEqual([...homeMailboxPendingMessageIDs(pendingKeys, accountAScope)], ["same-provider-message-id"]);
  assert.deepEqual([...homeMailboxPendingMessageIDs(pendingKeys, accountBScope)], ["same-provider-message-id"]);
  const afterAccountACompletes = pendingKeys.filter((key) => key !== homeMailboxPendingMessageKey(accountAScope, "same-provider-message-id"));
  assert.deepEqual([...homeMailboxPendingMessageIDs(afterAccountACompletes, accountAScope)], []);
  assert.deepEqual(
    [...homeMailboxPendingMessageIDs(afterAccountACompletes, accountBScope)],
    ["same-provider-message-id"],
    "account A's completion cannot clear account B's pending-star UI",
  );
  assert.deepEqual([...homeMailboxPendingMessageIDs(afterAccountACompletes, sharedScope)], ["same-provider-message-id"]);
});

test("a late personal-account count completion cannot change the active account's counters", async () => {
  const accountAScope = "company-1:user-1:account-a@example.com";
  const accountBScope = "company-1:user-1:account-b@example.com";
  let activeScope = accountAScope;
  let overrides: Parameters<typeof applyHomeMailboxCountDelta>[0] = {
    [homeMailboxCountKey(accountBScope)]: { primary: 20 },
  };
  let completeAccountA!: () => void;
  const accountARequest = new Promise<void>((resolve) => { completeAccountA = resolve; });
  const lateCompletion = accountARequest.then(() => {
    overrides = applyHomeMailboxCountDelta(overrides, accountAScope, "primary", -1, 8);
  });

  activeScope = accountBScope;
  completeAccountA();
  await lateCompletion;

  assert.equal(overrides[homeMailboxCountKey(accountAScope)]?.primary, 7);
  assert.equal(overrides[homeMailboxCountKey(accountBScope)]?.primary, 20);
  assert.equal(overrides[homeMailboxCountKey(activeScope)]?.primary, 20, "account A's late completion cannot corrupt account B");
});

test("compose completion closes only the submitted draft in its exact mailbox", () => {
  const submitted = {
    open: true,
    draftID: "draft-1",
    sharedInboxID: "",
    accountEmail: "account-a@example.com",
  };
  assert.equal(homeMailboxComposeSubmissionIsCurrent(submitted, submitted), true);
  assert.equal(homeMailboxComposeSubmissionIsCurrent({ ...submitted, accountEmail: "account-b@example.com" }, submitted), false);
  assert.equal(homeMailboxComposeSubmissionIsCurrent({ ...submitted, sharedInboxID: "shared-1", accountEmail: "" }, submitted), false);
  assert.equal(homeMailboxComposeSubmissionIsCurrent({ ...submitted, draftID: "newer-draft" }, submitted), false);
  assert.equal(homeMailboxComposeSubmissionIsCurrent({ ...submitted, open: false }, submitted), false);

  const unsaved = { ...submitted, draftID: "" };
  assert.equal(homeMailboxComposeSubmissionIsCurrent(unsaved, unsaved), true);
  assert.equal(homeMailboxComposeSubmissionIsCurrent({ ...unsaved }, unsaved), false, "a no-id completion cannot close a newer clone");
});

test("provider event mapping reloads the visible list for message changes and scopes detail refreshes", () => {
  const selected = { messageID: "selected", threadID: "thread-selected" };
  assert.deepEqual(homeMailboxRealtimeRefreshPlan({
    scope: personalTarget().scope,
    trigger: "message.created",
    message_id: "unrelated",
    thread_id: "unrelated-thread",
  }, selected), { folders: true, messages: true, selectedDetail: false });
  for (const trigger of ["message.updated", "message.deleted"]) {
    assert.deepEqual(homeMailboxRealtimeRefreshPlan({
      scope: personalTarget().scope,
      trigger,
      message_id: "selected",
    }, selected), { folders: true, messages: true, selectedDetail: true });
  }
  assert.deepEqual(homeMailboxRealtimeRefreshPlan({
    // Nylas represents a folder move as a message.updated notification.
    scope: "mailbox:personal:account:user-1:me@example.test",
    trigger: "message.updated",
    message_id: "moved-message",
  }, selected), { folders: true, messages: true, selectedDetail: false });
  assert.deepEqual(homeMailboxRealtimeRefreshPlan({
    scope: personalTarget().scope,
    trigger: "message.created",
    message_id: "new-thread-message",
    thread_id: "thread-selected",
  }, selected), { folders: true, messages: true, selectedDetail: true });
  for (const trigger of ["folder.created", "folder.updated", "folder.deleted"]) {
    assert.deepEqual(homeMailboxRealtimeRefreshPlan({
      scope: personalTarget().scope,
      trigger,
    }, selected), { folders: true, messages: false, selectedDetail: false });
  }
  assert.deepEqual(homeMailboxRealtimeRefreshPlan({
    scope: personalTarget().scope,
    trigger: "message.opened",
    message_id: "selected",
    thread_id: "thread-selected",
  }, selected), { folders: false, messages: false, selectedDetail: true });
  assert.deepEqual(homeMailboxRealtimeRefreshPlan({
    scope: personalTarget().scope,
    trigger: "message.opened",
    message_id: "unrelated",
    thread_id: "unrelated-thread",
  }, selected), { folders: false, messages: false, selectedDetail: false });
});

test("read-receipt hints refresh only a directly affected selected detail", () => {
  const timers = fakeTimers();
  let invalidations = 0;
  const plans: HomeMailboxRealtimeRefreshPlan[] = [];
  const coordinator = createHomeMailboxRealtimeCoordinator({
    target: personalTarget(),
    getRequestKey: () => "mailbox-A",
    getSelection: () => ({ messageID: "selected", threadID: "thread-selected" }),
    isRequestCurrent: () => true,
    invalidate: () => { invalidations += 1; },
    reconcile: (plan) => { plans.push(plan); },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  coordinator.changed({
    scope: personalTarget().scope,
    trigger: "message.opened",
    message_id: "selected",
    thread_id: "thread-selected",
  });
  assert.equal(invalidations, 1);
  assert.equal(timers.size, 1);
  timers.runNext();
  assert.deepEqual(plans, [{ folders: false, messages: false, selectedDetail: true }]);
  coordinator.changed({
    scope: personalTarget().scope,
    trigger: "message.opened",
    message_id: "unrelated",
    thread_id: "unrelated-thread",
  });
  assert.equal(invalidations, 1);
  assert.equal(timers.size, 0);
  coordinator.dispose();
});

test("a detail hint cannot wake a different selection before the debounce runs", () => {
  const timers = fakeTimers();
  let selection = { messageID: "selected-A", threadID: "thread-A" };
  const plans: HomeMailboxRealtimeRefreshPlan[] = [];
  const coordinator = createHomeMailboxRealtimeCoordinator({
    target: personalTarget(),
    getRequestKey: () => "mailbox-A",
    getSelection: () => selection,
    isRequestCurrent: () => true,
    invalidate: () => undefined,
    reconcile: (plan) => { plans.push(plan); },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  coordinator.changed({
    scope: personalTarget().scope,
    trigger: "message.opened",
    message_id: "selected-A",
    thread_id: "thread-A",
  });
  selection = { messageID: "selected-B", threadID: "thread-B" };
  assert.equal(timers.runNext(), true);
  assert.deepEqual(plans, [], "the stale hint performs no canonical detail read for selection B");
  coordinator.dispose();
});

test("a queued detail hint cannot wake a different selection after an in-flight reconciliation", async () => {
  const timers = fakeTimers();
  let selection = { messageID: "selected-A", threadID: "thread-A" };
  const plans: HomeMailboxRealtimeRefreshPlan[] = [];
  let finishInitial!: () => void;
  const coordinator = createHomeMailboxRealtimeCoordinator({
    target: personalTarget(),
    getRequestKey: () => "mailbox-A",
    getSelection: () => selection,
    isRequestCurrent: () => true,
    invalidate: () => undefined,
    reconcile: (plan) => {
      plans.push(plan);
      if (plans.length === 1) return new Promise<void>((resolve) => { finishInitial = resolve; });
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  coordinator.changed({
    scope: personalTarget().scope,
    trigger: "folder.updated",
  });
  assert.equal(timers.runNext(), true);
  assert.equal(plans.length, 1);
  coordinator.changed({
    scope: personalTarget().scope,
    trigger: "message.opened",
    message_id: "selected-A",
    thread_id: "thread-A",
  });
  assert.equal(timers.runNext(), true);
  selection = { messageID: "selected-B", threadID: "thread-B" };
  finishInitial();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(plans.length, 1, "the queued stale detail hint is discarded after selection changes");
  coordinator.dispose();
});
