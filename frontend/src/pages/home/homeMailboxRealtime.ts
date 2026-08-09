import type { EmailMailbox } from "../../modules/communications/communicationsApi.js";
import { realtimePersonalMailboxScope, realtimeSharedMailboxScope } from "../../modules/realtime/realtimeWebSocket.js";

export type HomeMailboxRealtimeTarget = {
  companyID: string;
  scope: string;
  sharedInboxID: string;
  accountEmail: string;
};

export type HomeMailboxRealtimeSelection = {
  messageID?: string;
  threadID?: string;
};

export type HomeMailboxRealtimeSignal = {
  scope: string;
  trigger: string;
  message_id?: string;
  thread_id?: string;
  shared_inbox_id?: string;
};

export type HomeMailboxRealtimeRefreshPlan = {
  folders: boolean;
  messages: boolean;
  selectedDetail: boolean;
};

export type HomeMailboxLocalMutationEchoRegistry = Map<string, {
  count: number;
  expiresAt: number;
}>;

export type HomeMailboxRequestOwner = Readonly<{
  requestKey: string;
  mailboxScopeKey: string;
}>;
export type HomeMailboxFolderOwner = Pick<HomeMailboxRequestOwner, "mailboxScopeKey">;

export type HomeArchiveStatusJob = {
  jobID: string;
  realtimeScope: string;
  messageIDs: readonly string[];
};

export type HomeMailboxCountOverrideKey = "primary" | "starred";
export type HomeMailboxCountOverrides = Record<string, Partial<Record<HomeMailboxCountOverrideKey, number>>>;

type ScheduledRefresh = {
  requestKey: string;
  plan: HomeMailboxRealtimeRefreshPlan;
  detailOwner: HomeMailboxRealtimeSelection | null;
};

type TimerHandle = ReturnType<typeof setTimeout>;

type HomeMailboxRealtimeCoordinatorOptions = {
  target: HomeMailboxRealtimeTarget;
  getRequestKey: () => string;
  getSelection: () => HomeMailboxRealtimeSelection;
  isRequestCurrent: (requestKey: string) => boolean;
  isLocalMutationEcho?: (signal: HomeMailboxRealtimeSignal) => boolean;
  invalidate: (signal?: HomeMailboxRealtimeSignal) => void;
  reconcile: (plan: HomeMailboxRealtimeRefreshPlan, requestKey: string) => void | Promise<void>;
  onError?: (cause: unknown) => void;
  delayMs?: number;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (timer: TimerHandle) => void;
};

type HomeMailboxFolderLoadCoordinatorOptions = {
  isOwnerCurrent: (owner: HomeMailboxFolderOwner) => boolean;
  load: (owner: HomeMailboxFolderOwner, refresh: boolean) => boolean | Promise<boolean>;
  onError?: (cause: unknown) => void;
};

type HomeMailboxFolderLoadRequest = {
  owner: HomeMailboxFolderOwner;
  refresh: boolean;
};

type HomeArchiveStatusCoordinatorOptions = {
  target: HomeMailboxRealtimeTarget;
  getActiveJobs: () => readonly HomeArchiveStatusJob[];
  revalidate: (jobID: string) => void | Promise<void>;
  onError?: (cause: unknown) => void;
  delayMs?: number;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (timer: TimerHandle) => void;
};

type HomeMailboxFolderLoadState = {
  inFlight: (HomeMailboxFolderLoadRequest & { promise: Promise<boolean> }) | null;
  queued: (HomeMailboxFolderLoadRequest & { waiters: Array<(loaded: boolean) => void> }) | null;
};

const EMPTY_PLAN: HomeMailboxRealtimeRefreshPlan = {
  folders: false,
  messages: false,
  selectedDetail: false,
};

const LOCAL_MUTATION_ECHO_TTL_MS = 5 * 60_000;

export function homeMailboxRequestOwnerIsCurrent(
  owner: HomeMailboxRequestOwner,
  current: HomeMailboxRequestOwner,
): boolean {
  return !!owner.requestKey
    && !!owner.mailboxScopeKey
    && owner.requestKey === current.requestKey
    && owner.mailboxScopeKey === current.mailboxScopeKey;
}

export function homeMailboxFolderOwnerIsCurrent(
  owner: HomeMailboxFolderOwner,
  current: HomeMailboxFolderOwner,
): boolean {
  const mailboxScopeKey = owner.mailboxScopeKey.trim();
  return !!mailboxScopeKey && mailboxScopeKey === current.mailboxScopeKey.trim();
}

export function cancelHomeMailboxListRequestTimers(
  timerIDs: Set<number>,
  exactMutationTimerByKey: ReadonlyMap<string, number>,
  clearTimer: (timerID: number) => void,
): void {
  const exactMutationTimerIDs = new Set(exactMutationTimerByKey.values());
  for (const timerID of Array.from(timerIDs)) {
    if (exactMutationTimerIDs.has(timerID)) continue;
    clearTimer(timerID);
    timerIDs.delete(timerID);
  }
}

export function homeMailboxCountKey(mailboxScopeKey: string): string {
  return mailboxScopeKey.trim();
}

export function applyHomeMailboxCountDelta(
  previous: HomeMailboxCountOverrides,
  mailboxScopeKey: string,
  mailbox: HomeMailboxCountOverrideKey,
  delta: number,
  capturedBaseCount: number,
): HomeMailboxCountOverrides {
  const key = homeMailboxCountKey(mailboxScopeKey);
  if (!key || delta === 0) return previous;
  const currentEntry = previous[key] ?? {};
  const baseCount = Number.isFinite(capturedBaseCount) ? Math.max(0, Math.floor(capturedBaseCount)) : 0;
  const currentCount = currentEntry[mailbox] ?? baseCount;
  const nextCount = Math.max(0, Math.floor(currentCount + delta));
  if (currentEntry[mailbox] === nextCount) return previous;
  return {
    ...previous,
    [key]: {
      ...currentEntry,
      [mailbox]: nextCount,
    },
  };
}

export function createHomeMailboxFolderLoadCoordinator(options: HomeMailboxFolderLoadCoordinatorOptions) {
  const states = new Map<string, HomeMailboxFolderLoadState>();
  let disposed = false;

  const ownersMatch = (left: HomeMailboxFolderOwner, right: HomeMailboxFolderOwner) => (
    homeMailboxFolderOwnerIsCurrent(left, right)
  );
  const resolveQueued = (
    queued: HomeMailboxFolderLoadState["queued"],
    loaded: boolean,
  ) => {
    for (const resolve of queued?.waiters ?? []) resolve(loaded);
  };
  const start = (
    scopeKey: string,
    state: HomeMailboxFolderLoadState,
    request: HomeMailboxFolderLoadRequest,
  ): Promise<boolean> => {
    let promise: Promise<boolean>;
    try {
      promise = Promise.resolve(options.load(request.owner, request.refresh))
        .catch((cause) => {
          options.onError?.(cause);
          return false;
        });
    } catch (cause) {
      options.onError?.(cause);
      promise = Promise.resolve(false);
    }
    const inFlight = { ...request, promise };
    state.inFlight = inFlight;
    void promise.then(() => undefined, () => undefined).finally(() => {
      if (state.inFlight !== inFlight) return;
      state.inFlight = null;
      const queued = state.queued;
      state.queued = null;
      if (!queued) {
        if (!state.inFlight) states.delete(scopeKey);
        return;
      }
      if (disposed || !options.isOwnerCurrent(queued.owner)) {
        resolveQueued(queued, false);
        states.delete(scopeKey);
        return;
      }
      const finalLoad = start(scopeKey, state, queued);
      void finalLoad.then((loaded) => resolveQueued(queued, loaded));
    });
    return promise;
  };

  return {
    request(owner: HomeMailboxFolderOwner, refresh = false): Promise<boolean> {
      const scopeKey = homeMailboxCountKey(owner.mailboxScopeKey);
      if (disposed || !scopeKey || !options.isOwnerCurrent(owner)) return Promise.resolve(false);
      let state = states.get(scopeKey);
      if (!state) {
        state = { inFlight: null, queued: null };
        states.set(scopeKey, state);
      }
      if (!state.inFlight) return start(scopeKey, state, { owner, refresh });
      if (!refresh && ownersMatch(state.inFlight.owner, owner)) return state.inFlight.promise;
      return new Promise<boolean>((resolve) => {
        const queued = state?.queued;
        if (queued && ownersMatch(queued.owner, owner)) {
          queued.refresh = queued.refresh || refresh;
          queued.waiters.push(resolve);
          return;
        }
        resolveQueued(queued ?? null, false);
        if (state) state.queued = { owner, refresh, waiters: [resolve] };
      });
    },
    cancelObsolete(currentOwner: HomeMailboxFolderOwner) {
      for (const [scopeKey, state] of states) {
        if (state.queued && !ownersMatch(state.queued.owner, currentOwner)) {
          resolveQueued(state.queued, false);
          state.queued = null;
        }
        if (!state.inFlight && !state.queued) states.delete(scopeKey);
      }
    },
    dispose() {
      disposed = true;
      for (const state of states.values()) resolveQueued(state.queued, false);
      states.clear();
    },
  };
}

export function homeMailboxPendingMessageKey(mailboxScopeKey: string, messageID: string): string {
  const scope = mailboxScopeKey.trim();
  const id = messageID.trim();
  return scope && id ? `${scope.length}:${scope}${id}` : "";
}

export function homeMailboxPendingMessageIDs(
  scopedMessageKeys: readonly string[],
  mailboxScopeKey: string,
): Set<string> {
  const scope = mailboxScopeKey.trim();
  if (!scope) return new Set();
  const prefix = `${scope.length}:${scope}`;
  return new Set(scopedMessageKeys
    .filter((key) => key.startsWith(prefix) && key.length > prefix.length)
    .map((key) => key.slice(prefix.length)));
}

export function homeMailboxComposeSubmissionIsCurrent(
  current: { open: boolean; draftID: string; sharedInboxID: string; accountEmail: string },
  submitted: { open: boolean; draftID: string; sharedInboxID: string; accountEmail: string },
): boolean {
  if (!current.open) return false;
  const submittedDraftID = submitted.draftID.trim();
  if (!submittedDraftID) return current === submitted;
  return current.draftID.trim() === submittedDraftID
    && current.sharedInboxID.trim() === submitted.sharedInboxID.trim()
    && current.accountEmail.trim().toLowerCase() === submitted.accountEmail.trim().toLowerCase();
}

export function selectHomeMailboxRealtimeTarget(input: {
  companyID: string;
  userID: string;
  accountEmail: string;
  viewID: string;
  mailbox: EmailMailbox;
  mailBearing?: boolean;
  sharedInbox?: { id: string; mailBearing: boolean } | null;
}): HomeMailboxRealtimeTarget | null {
  const companyID = input.companyID.trim();
  const userID = input.userID.trim();
  const accountEmail = input.accountEmail.trim().toLowerCase();
  if (!companyID || !userID || input.mailBearing === false || input.mailbox === "drafts") return null;

  if (input.viewID === "my-triage" || input.viewID === "primary") {
    const scope = realtimePersonalMailboxScope(userID, accountEmail);
    return scope ? { companyID, scope, sharedInboxID: "", accountEmail } : null;
  }

  if (!input.viewID.startsWith("shared:") || !input.sharedInbox?.mailBearing) return null;
  const sharedInboxID = input.sharedInbox.id.trim();
  const scope = realtimeSharedMailboxScope(sharedInboxID);
  return scope ? { companyID, scope, sharedInboxID, accountEmail } : null;
}

export function homeMailboxRealtimeTargetKey(target: HomeMailboxRealtimeTarget | null): string {
  if (!target) return "";
  const companyID = target.companyID.trim();
  const scope = target.scope.trim();
  return companyID && scope ? `${companyID.length}:${companyID}${scope}` : "";
}

function homeMailboxLocalMutationEchoKey(scope: string, trigger: string, messageID: string): string {
  const cleanScope = scope.trim();
  const cleanTrigger = trigger.trim().toLowerCase();
  const cleanMessageID = messageID.trim();
  if (!cleanScope || !cleanTrigger || !cleanMessageID) return "";
  return `${cleanScope.length}:${cleanScope}${cleanTrigger.length}:${cleanTrigger}${cleanMessageID}`;
}

function pruneHomeMailboxLocalMutationEchoes(registry: HomeMailboxLocalMutationEchoRegistry, now: number): void {
  for (const [key, entry] of registry) {
    if (entry.expiresAt <= now || entry.count <= 0) registry.delete(key);
  }
}

export function rememberHomeMailboxLocalMutationEchoes(
  registry: HomeMailboxLocalMutationEchoRegistry,
  scope: string,
  trigger: string,
  messageIDs: readonly string[],
  now = Date.now(),
): void {
  pruneHomeMailboxLocalMutationEchoes(registry, now);
  for (const messageID of new Set(messageIDs.map((id) => id.trim()).filter(Boolean))) {
    const key = homeMailboxLocalMutationEchoKey(scope, trigger, messageID);
    if (!key) continue;
    const current = registry.get(key);
    registry.set(key, {
      count: (current?.count ?? 0) + 1,
      expiresAt: Math.max(current?.expiresAt ?? 0, now + LOCAL_MUTATION_ECHO_TTL_MS),
    });
  }
}

export function forgetHomeMailboxLocalMutationEchoes(
  registry: HomeMailboxLocalMutationEchoRegistry,
  scope: string,
  trigger: string,
  messageIDs: readonly string[],
): void {
  for (const messageID of new Set(messageIDs.map((id) => id.trim()).filter(Boolean))) {
    const key = homeMailboxLocalMutationEchoKey(scope, trigger, messageID);
    if (!key) continue;
    const current = registry.get(key);
    if (!current || current.count <= 1) registry.delete(key);
    else registry.set(key, { ...current, count: current.count - 1 });
  }
}

export function consumeHomeMailboxLocalMutationEcho(
  registry: HomeMailboxLocalMutationEchoRegistry,
  signal: HomeMailboxRealtimeSignal,
  now = Date.now(),
): boolean {
  pruneHomeMailboxLocalMutationEchoes(registry, now);
  const key = homeMailboxLocalMutationEchoKey(signal.scope, signal.trigger, signal.message_id ?? "");
  if (!key) return false;
  const current = registry.get(key);
  if (!current) return false;
  if (current.count <= 1) registry.delete(key);
  else registry.set(key, { ...current, count: current.count - 1 });
  return true;
}

export function homeMailboxRealtimeRefreshPlan(
  signal: HomeMailboxRealtimeSignal,
  selection: HomeMailboxRealtimeSelection,
): HomeMailboxRealtimeRefreshPlan {
  const trigger = signal.trigger.trim().toLowerCase();
  const isMessageChange = trigger === "message.created"
    || trigger === "message.updated"
    || trigger === "message.deleted";
  const isFolderChange = trigger === "folder.created"
    || trigger === "folder.updated"
    || trigger === "folder.deleted";
  const isReceiptChange = trigger === "message.opened";
  const messageID = signal.message_id?.trim() ?? "";
  const threadID = signal.thread_id?.trim() ?? "";
  const selectedDetail = (isMessageChange || isReceiptChange) && (
    (!!messageID && messageID === (selection.messageID?.trim() ?? ""))
    || (!!threadID && threadID === (selection.threadID?.trim() ?? ""))
  );
  return {
    folders: isMessageChange || isFolderChange,
    messages: isMessageChange,
    selectedDetail,
  };
}

export function createHomeMailboxRealtimeCoordinator(options: HomeMailboxRealtimeCoordinatorOptions) {
  const delayMs = options.delayMs ?? 120;
  const setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  let disposed = false;
  let timer: TimerHandle | null = null;
  let pending: ScheduledRefresh | null = null;
  let queued: ScheduledRefresh | null = null;
  let inFlight = false;

  const mergeScheduled = (current: ScheduledRefresh | null, next: ScheduledRefresh): ScheduledRefresh => {
    if (!current) return next;
    if (current.requestKey !== next.requestKey) {
      return {
        ...next,
        plan: {
          ...next.plan,
          folders: current.plan.folders || next.plan.folders,
          messages: current.plan.messages || next.plan.messages,
        },
      };
    }
    return {
      requestKey: current.requestKey,
      plan: mergePlans(current.plan, next.plan),
      detailOwner: next.detailOwner ?? current.detailOwner,
    };
  };

  const start = (scheduled: ScheduledRefresh) => {
    if (disposed) return;
    if (inFlight) {
      queued = mergeScheduled(queued, scheduled);
      return;
    }
    const requestIsCurrent = options.isRequestCurrent(scheduled.requestKey);
    const plan = {
      folders: scheduled.plan.folders,
      messages: scheduled.plan.messages && requestIsCurrent,
      selectedDetail: scheduled.plan.selectedDetail
        && requestIsCurrent
        && selectionMatches(scheduled.detailOwner, options.getSelection()),
    };
    if (!hasRefreshWork(plan)) return;
    inFlight = true;
    let result: void | Promise<void>;
    try {
      result = options.reconcile(plan, scheduled.requestKey);
    } catch (cause) {
      options.onError?.(cause);
      result = undefined;
    }
    void Promise.resolve(result)
      .catch((cause) => options.onError?.(cause))
      .finally(() => {
        inFlight = false;
        const finalRefresh = queued;
        queued = null;
        if (finalRefresh) start(finalRefresh);
      });
  };

  const schedule = (
    plan: HomeMailboxRealtimeRefreshPlan,
    detailOwner: HomeMailboxRealtimeSelection | null = null,
  ) => {
    if (disposed || !hasRefreshWork(plan)) return;
    const requestKey = options.getRequestKey();
    if (!requestKey || !options.isRequestCurrent(requestKey)) return;
    pending = mergeScheduled(pending, { requestKey, plan, detailOwner });
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      const scheduled = pending;
      pending = null;
      if (scheduled) start(scheduled);
    }, delayMs);
  };

  return {
    accepted() {
      if (disposed) return;
      options.invalidate();
      schedule({ folders: true, messages: true, selectedDetail: false });
    },
    changed(signal: HomeMailboxRealtimeSignal) {
      if (disposed || signal.scope.trim() !== options.target.scope) return;
      if (options.isLocalMutationEcho?.(signal)) return;
      const selection = options.getSelection();
      const plan = homeMailboxRealtimeRefreshPlan(signal, selection);
      if (!hasRefreshWork(plan)) return;
      options.invalidate(signal);
      schedule(plan, plan.selectedDetail ? selection : null);
    },
    dispose() {
      disposed = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
      pending = null;
      queued = null;
    },
  };
}

export function createHomeArchiveStatusCoordinator(options: HomeArchiveStatusCoordinatorOptions) {
  const delayMs = options.delayMs ?? 120;
  const setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  let disposed = false;
  let timer: TimerHandle | null = null;
  let pending = new Set<string>();
  let queued = new Set<string>();
  let inFlight = false;

  const activeJobIDs = (messageID = ""): string[] => {
    const cleanMessageID = messageID.trim();
    return options.getActiveJobs()
      .filter((job) => job.realtimeScope.trim() === options.target.scope)
      .filter((job) => !cleanMessageID || job.messageIDs.some((id) => id.trim() === cleanMessageID))
      .map((job) => job.jobID.trim())
      .filter(Boolean);
  };

  const start = (jobIDs: Set<string>) => {
    if (disposed || jobIDs.size === 0) return;
    if (inFlight) {
      for (const jobID of jobIDs) queued.add(jobID);
      return;
    }
    inFlight = true;
    void (async () => {
      for (const jobID of jobIDs) await options.revalidate(jobID);
    })()
      .catch((cause) => options.onError?.(cause))
      .finally(() => {
        inFlight = false;
        const finalPass = queued;
        queued = new Set<string>();
        if (finalPass.size > 0) start(finalPass);
      });
  };

  const schedule = (jobIDs: readonly string[], immediate = false) => {
    if (disposed) return;
    for (const jobID of jobIDs) {
      const cleanJobID = jobID.trim();
      if (cleanJobID) pending.add(cleanJobID);
    }
    if (pending.size === 0) return;
    if (immediate && timer === null) {
      const next = pending;
      pending = new Set<string>();
      start(next);
      return;
    }
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      const next = pending;
      pending = new Set<string>();
      start(next);
    }, delayMs);
  };

  return {
    accepted() {
      schedule(activeJobIDs());
    },
    changed(signal: HomeMailboxRealtimeSignal) {
      if (disposed || signal.scope.trim() !== options.target.scope) return;
      const trigger = signal.trigger.trim().toLowerCase();
      if (trigger !== "message.updated" && trigger !== "message.deleted") return;
      const messageID = signal.message_id?.trim() ?? "";
      if (!messageID) return;
      schedule(activeJobIDs(messageID));
    },
    revalidate(jobID: string) {
      schedule([jobID], true);
    },
    dispose() {
      disposed = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
      pending.clear();
      queued.clear();
    },
  };
}

function selectionMatches(
  expected: HomeMailboxRealtimeSelection | null,
  current: HomeMailboxRealtimeSelection,
): boolean {
  if (!expected) return false;
  const expectedMessageID = expected.messageID?.trim() ?? "";
  const expectedThreadID = expected.threadID?.trim() ?? "";
  return (!!expectedMessageID && expectedMessageID === (current.messageID?.trim() ?? ""))
    || (!!expectedThreadID && expectedThreadID === (current.threadID?.trim() ?? ""));
}

function mergePlans(
  left: HomeMailboxRealtimeRefreshPlan = EMPTY_PLAN,
  right: HomeMailboxRealtimeRefreshPlan = EMPTY_PLAN,
): HomeMailboxRealtimeRefreshPlan {
  return {
    folders: left.folders || right.folders,
    messages: left.messages || right.messages,
    selectedDetail: left.selectedDetail || right.selectedDetail,
  };
}

function hasRefreshWork(plan: HomeMailboxRealtimeRefreshPlan): boolean {
  return plan.folders || plan.messages || plan.selectedDetail;
}
