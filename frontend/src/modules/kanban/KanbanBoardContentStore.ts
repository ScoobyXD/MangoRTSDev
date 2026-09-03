import {
  clearResourceMissing,
  markResourceMissing,
  TerminalResourceNotFoundError,
  throwIfResourceMarkedMissing,
} from "../api/missingResources.js";
import { isHTTPNotFoundError, requestJSON } from "../api/requestJSON.js";
import type { CommittedEntityTitleUpdate } from "../realtime/committedEntityTitleUpdates.js";
import { reconcileCommittedKanbanCardTitles } from "./kanbanRealtimeRefresh.js";
import type {
  KanbanBoard,
  KanbanCard,
  KanbanColumn,
  LogicGateArenaLogicGate,
  LogicGateArenaPermissions,
  LogicGateArenaView,
} from "./shared.js";
import { logicGateIDFromKanbanBoardID, logicGateKanbanBoardID } from "./shared.js";

export type KanbanBoardContents = {
  logicGate?: LogicGateArenaLogicGate;
  permissions?: LogicGateArenaPermissions;
  board?: KanbanBoard;
  columns: KanbanColumn[];
  cards: KanbanCard[];
};

export type KanbanBoardContentsCacheSnapshot = {
  contents: KanbanBoardContents;
  stale: boolean;
};

type ContentCacheEntry = KanbanBoardContentsCacheSnapshot;

type ContentInflightEntry = {
  cacheKey: string;
  controller: AbortController;
  promise: Promise<KanbanBoardContents>;
  callers: Set<symbol>;
  settled: boolean;
};

const contentCache = new Map<string, ContentCacheEntry>();
const contentInflight = new Map<string, ContentInflightEntry>();
const contentVersions = new Map<string, number>();

function key(apiBase: string, companyID: string, boardID: string): string {
  return `${apiBase}:${companyID}:${boardID}`;
}

function cloneContents(contents: KanbanBoardContents): KanbanBoardContents {
  return {
    logicGate: contents.logicGate ? { ...contents.logicGate } : undefined,
    permissions: contents.permissions ? { ...contents.permissions } : undefined,
    board: contents.board ? { ...contents.board } : undefined,
    columns: contents.columns.map((column) => ({ ...column })),
    cards: contents.cards.map((card) => ({
      ...card,
      accounts: card.accounts?.map((account) => ({ ...account })),
    })),
  };
}

function contentVersion(cacheKey: string): number {
  return contentVersions.get(cacheKey) ?? 0;
}

function bumpContentVersion(cacheKey: string): number {
  const next = contentVersion(cacheKey) + 1;
  contentVersions.set(cacheKey, next);
  return next;
}

function retireContentInflight(cacheKey: string): void {
  const inflight = contentInflight.get(cacheKey);
  if (!inflight) return;
  contentInflight.delete(cacheKey);
  if (!inflight.settled) inflight.controller.abort();
}

function supersededContentRequestError(): DOMException {
  return new DOMException("The Kanban board contents request was superseded.", "AbortError");
}

export function hasKanbanBoardContentsCache(apiBase: string, companyID: string, boardID: string): boolean {
  return contentCache.has(key(apiBase, companyID, boardID));
}

export function peekKanbanBoardContentsCache(apiBase: string, companyID: string, boardID: string): KanbanBoardContentsCacheSnapshot | null {
  const entry = contentCache.get(key(apiBase, companyID, boardID));
  return entry ? { contents: cloneContents(entry.contents), stale: entry.stale } : null;
}

export function primeKanbanBoardContentsCache(apiBase: string, companyID: string, boardID: string, contents: KanbanBoardContents): void {
  const cacheKey = key(apiBase, companyID, boardID);
  clearResourceMissing({ apiBase, companyID, resourceType: "kanban_board", resourceID: boardID });
  bumpContentVersion(cacheKey);
  contentCache.set(cacheKey, { contents: cloneContents(contents), stale: false });
}

export function reconcileKanbanBoardContentsCache(
  apiBase: string,
  companyID: string,
  boardID: string,
  reconcile: (contents: KanbanBoardContents) => KanbanBoardContents,
): KanbanBoardContents | null {
  const cached = contentCache.get(key(apiBase, companyID, boardID));
  if (!cached) return null;
  const next = reconcile(cloneContents(cached.contents));
  primeKanbanBoardContentsCache(apiBase, companyID, boardID, next);
  return cloneContents(next);
}

export function invalidateKanbanBoardContentsCache(apiBase: string, companyID: string, boardID: string): void {
  const cacheKey = key(apiBase, companyID, boardID);
  bumpContentVersion(cacheKey);
  retireContentInflight(cacheKey);
  const cached = contentCache.get(cacheKey);
  if (cached) contentCache.set(cacheKey, { contents: cached.contents, stale: true });
}

export function invalidateKanbanBoardContentsForCompany(apiBase: string, companyID: string): void {
  const prefix = `${apiBase}:${companyID}:`;
  const matchingKeys = new Set([...contentCache.keys(), ...contentInflight.keys()]);
  for (const cacheKey of matchingKeys) {
    if (!cacheKey.startsWith(prefix)) continue;
    bumpContentVersion(cacheKey);
    retireContentInflight(cacheKey);
    const cached = contentCache.get(cacheKey);
    if (cached) contentCache.set(cacheKey, { contents: cached.contents, stale: true });
  }
}

export function reconcileKanbanBoardContentTitles(
  apiBase: string,
  companyID: string,
  update: CommittedEntityTitleUpdate,
): void {
  const cleanResourceID = update.resourceID.trim();
  const title = update.title.trim();
  if (!companyID.trim() || !cleanResourceID || !title) return;
  const prefix = `${apiBase}:${companyID}:`;
  const logicGateCacheKey = update.entityType === "logic_gate"
    ? key(apiBase, companyID, logicGateKanbanBoardID(cleanResourceID))
    : "";
  const matchingKeys = new Set([...contentCache.keys(), ...contentInflight.keys()]);
  for (const cacheKey of matchingKeys) {
    if (!cacheKey.startsWith(prefix)) continue;
    if (logicGateCacheKey && cacheKey !== logicGateCacheKey) continue;
    bumpContentVersion(cacheKey);
    retireContentInflight(cacheKey);
    const cached = contentCache.get(cacheKey);
    if (!cached) continue;
    let contents = cached.contents;
    if (update.entityType === "node") {
      const cards = reconcileCommittedKanbanCardTitles(contents.cards, update);
      if (cards !== contents.cards) contents = { ...contents, cards };
    } else {
      if (contents.logicGate?.logic_gate_id === cleanResourceID && contents.logicGate.header !== title) {
        contents = {
          ...contents,
          logicGate: { ...contents.logicGate, header: title },
        };
      }
      const boardLogicGateID = contents.board?.logic_gate_id?.trim()
        || logicGateIDFromKanbanBoardID(contents.board?.board_id ?? "");
      if (contents.board && boardLogicGateID === cleanResourceID && contents.board.title !== title) {
        contents = {
          ...contents,
          board: { ...contents.board, title },
        };
      }
    }
    contentCache.set(cacheKey, {
      contents,
      stale: cached.stale,
    });
  }
}

export function clearKanbanBoardContentsCache(apiBase: string, companyID: string, boardID: string): void {
  const cacheKey = key(apiBase, companyID, boardID);
  bumpContentVersion(cacheKey);
  retireContentInflight(cacheKey);
  contentCache.delete(cacheKey);
}

export async function getKanbanBoardContentsSingleFlight(
  apiBase: string,
  companyID: string,
  boardID: string,
  cardLimit = 500,
  signal?: AbortSignal,
): Promise<KanbanBoardContents> {
  const cacheKey = key(apiBase, companyID, boardID);
  throwIfAborted(signal);
  throwIfResourceMarkedMissing({ apiBase, companyID, resourceType: "kanban_board", resourceID: boardID });
  const cached = contentCache.get(cacheKey);
  if (cached && !cached.stale) return cloneContentsWithLimit(cached.contents, cardLimit);
  const inflight = contentInflight.get(cacheKey);
  if (inflight) return subscribeToInflight(inflight, signal, cardLimit);

  const version = contentVersion(cacheKey);
  const logicGateID = logicGateIDFromKanbanBoardID(boardID);
  if (logicGateID) {
    throwIfResourceMarkedMissing({ apiBase, companyID, resourceType: "logic_gate", resourceID: logicGateID });
  }
  const controller = new AbortController();
  let entry: ContentInflightEntry;
  const promise = (logicGateID
    ? requestLogicGateWorkView(apiBase, companyID, logicGateID, controller.signal)
      .then((view) => normalizeLogicGateWorkView(view, companyID, boardID, logicGateID))
    : Promise.resolve({ columns: [], cards: [] })
  ).then((contents) => {
    if (contentVersion(cacheKey) !== version) throw supersededContentRequestError();
    clearResourceMissing({ apiBase, companyID, resourceType: "kanban_board", resourceID: boardID });
    if (logicGateID) clearResourceMissing({ apiBase, companyID, resourceType: "logic_gate", resourceID: logicGateID });
    contentCache.set(cacheKey, { contents: cloneContents(contents), stale: false });
    return contents;
  }).catch((cause) => {
    if (contentVersion(cacheKey) !== version) throw supersededContentRequestError();
    if (isHTTPNotFoundError(cause)) {
      markResourceMissing({ apiBase, companyID, resourceType: "kanban_board", resourceID: boardID });
      if (logicGateID) markResourceMissing({ apiBase, companyID, resourceType: "logic_gate", resourceID: logicGateID });
      clearKanbanBoardContentsCache(apiBase, companyID, boardID);
      throw new TerminalResourceNotFoundError("kanban_board", boardID);
    }
    throw cause;
  }).finally(() => {
    entry.settled = true;
    if (contentInflight.get(cacheKey) === entry) contentInflight.delete(cacheKey);
  });

  entry = { cacheKey, controller, promise, callers: new Set(), settled: false };
  contentInflight.set(cacheKey, entry);
  return subscribeToInflight(entry, signal, cardLimit);
}

function requestLogicGateWorkView(apiBase: string, companyID: string, logicGateID: string, signal: AbortSignal): Promise<LogicGateArenaView> {
  const params = new URLSearchParams({ company_id: companyID });
  return requestJSON<LogicGateArenaView>(
    apiBase,
    `/v2/logic-gates/${encodeURIComponent(logicGateID)}/work?${params}`,
    { signal },
  );
}

function normalizeLogicGateWorkView(
  view: LogicGateArenaView,
  companyID: string,
  boardID: string,
  logicGateID: string,
): KanbanBoardContents {
  const board = {
    ...view.board,
    company_id: view.board.company_id || companyID,
    board_id: view.board.board_id || boardID,
    logic_gate_id: view.board.logic_gate_id ?? logicGateID,
  };
  const cards = (view.cards ?? []).map((card): KanbanCard => {
    const projectionUpdated = card.projection_updated_timestamp?.trim() || "";
    const created = card.created_timestamp?.trim() || projectionUpdated;
    return {
      company_id: companyID,
      board_id: board.board_id,
      logic_gate_id: logicGateID,
      card_id: card.card_id,
      column_id: card.column_id,
      node_id: card.node_id,
      requested_by_user_id: card.requested_by_user_id,
      placed_by_user_id: card.placed_by_user_id,
      node_title: card.node_title,
      description_snapshot: "",
      is_issue: card.is_issue === true,
      position: card.position,
      due_date: card.due_date,
      priority: card.priority,
      created_from_email: card.created_from_email === true,
      has_project: card.has_project === true,
      accounts: card.accounts?.map((account) => ({ ...account })) ?? [],
      projection_updated_timestamp: projectionUpdated || undefined,
      created_timestamp: created,
      updated_timestamp: projectionUpdated || created,
    };
  });
  return {
    logicGate: { ...view.logic_gate, logic_gate_id: view.logic_gate.logic_gate_id || logicGateID },
    permissions: { ...view.permissions },
    board,
    columns: (view.columns ?? []).map((column) => ({ ...column })),
    cards,
  };
}

function cloneContentsWithLimit(contents: KanbanBoardContents, cardLimit: number): KanbanBoardContents {
  const cloned = cloneContents(contents);
  cloned.cards = cloned.cards.slice(0, Math.max(0, cardLimit));
  return cloned;
}

function subscribeToInflight(entry: ContentInflightEntry, signal: AbortSignal | undefined, cardLimit: number): Promise<KanbanBoardContents> {
  const caller = Symbol("kanban-board-content-caller");
  entry.callers.add(caller);
  return new Promise<KanbanBoardContents>((resolve, reject) => {
    let finished = false;
    const release = () => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener("abort", onAbort);
      entry.callers.delete(caller);
      if (!entry.settled && entry.callers.size === 0) {
        if (contentInflight.get(entry.cacheKey) === entry) contentInflight.delete(entry.cacheKey);
        entry.controller.abort();
      }
    };
    const settle = (callback: () => void) => {
      if (finished) return;
      release();
      callback();
    };
    const onAbort = () => settle(() => reject(abortReason(signal)));
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    entry.promise.then(
      (contents) => settle(() => resolve(cloneContentsWithLimit(contents, cardLimit))),
      (cause) => settle(() => reject(cause)),
    );
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

function abortReason(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new DOMException("The request was aborted.", "AbortError");
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException
    ? cause.name === "AbortError"
    : cause instanceof Error && cause.name === "AbortError";
}

export type KanbanBoardLoadCoordinatorInput = {
  key: string;
  readCached: () => KanbanBoardContentsCacheSnapshot | null;
  load: (signal: AbortSignal) => Promise<KanbanBoardContents>;
  apply: (contents: KanbanBoardContents, source: "cache" | "network") => void;
  onCacheMiss?: () => void;
  onLoading?: (loading: boolean) => void;
  onError?: (cause: unknown) => void;
};

export type KanbanBoardLoadCoordinator = {
  load: (input: KanbanBoardLoadCoordinatorInput) => Promise<void>;
  cancel: (notify?: boolean) => void;
};

export function createKanbanBoardLoadCoordinator(): KanbanBoardLoadCoordinator {
  let generation = 0;
  let lastAppliedKey = "";
  let loadingReported = false;
  let loadingVisible = false;
  let current: {
    key: string;
    generation: number;
    controller: AbortController;
    promise: Promise<void>;
    onLoading?: (loading: boolean) => void;
  } | null = null;

  const cancelCurrent = (notify: boolean, resetLastKey = false) => {
    generation += 1;
    const previous = current;
    current = null;
    previous?.controller.abort();
    if (notify && loadingVisible) {
      previous?.onLoading?.(false);
      loadingVisible = false;
      loadingReported = true;
    }
    if (resetLastKey) lastAppliedKey = "";
  };

  return {
    load(input) {
      if (current?.key === input.key) return current.promise;
      cancelCurrent(false);
      const loadGeneration = generation + 1;
      generation = loadGeneration;
      const cached = input.readCached();
      const cacheAlreadyApplied = lastAppliedKey === input.key;
      if (cached && !cacheAlreadyApplied) {
        input.apply(cached.contents, "cache");
        lastAppliedKey = input.key;
      } else if (!cached) {
        input.onCacheMiss?.();
        lastAppliedKey = input.key;
      }
      const nextLoadingVisible = !cached;
      if (!loadingReported || loadingVisible !== nextLoadingVisible) {
        input.onLoading?.(nextLoadingVisible);
        loadingReported = true;
        loadingVisible = nextLoadingVisible;
      }
      if (cached && !cached.stale) {
        return Promise.resolve();
      }

      const controller = new AbortController();
      const promise = input.load(controller.signal)
        .then((contents) => {
          if (current?.generation !== loadGeneration) return;
          input.apply(contents, "network");
          lastAppliedKey = input.key;
        })
        .catch((cause) => {
          if (current?.generation !== loadGeneration || isAbortError(cause)) return;
          input.onError?.(cause);
        })
        .finally(() => {
          if (current?.generation !== loadGeneration) return;
          current = null;
          if (loadingVisible) {
            input.onLoading?.(false);
            loadingVisible = false;
            loadingReported = true;
          }
        });
      current = { key: input.key, generation: loadGeneration, controller, promise, onLoading: input.onLoading };
      return promise;
    },
    cancel: (notify = true) => cancelCurrent(notify, true),
  };
}
