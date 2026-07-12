import test from "node:test";
import assert from "node:assert/strict";
import { clearResourceMissing, isTerminalResourceNotFoundError } from "../../../../frontend/src/modules/api/missingResources.js";
import {
  clearKanbanBoardContentsCache,
  createKanbanBoardLoadCoordinator,
  getKanbanBoardContentsSingleFlight,
  invalidateKanbanBoardContentsCache,
  peekKanbanBoardContentsCache,
  primeKanbanBoardContentsCache,
  reconcileKanbanBoardContentsCache,
  type KanbanBoardContents,
} from "../../../../frontend/src/modules/kanban/KanbanBoardContentStore.js";
import {
  logicGateKanbanBoardID,
  type KanbanBoard,
  type KanbanColumn,
} from "../../../../frontend/src/modules/kanban/shared.js";

function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload), { ...init, headers: { "Content-Type": "application/json" } });
}

test("Kanban board content store loads Logic Gate board contents from v2 work read", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const apiBase = "https://api.example.test";
  const companyID = "company-1";
  const logicGateID = "gate-1";
  const boardID = logicGateKanbanBoardID(logicGateID);
  clearKanbanBoardContentsCache(apiBase, companyID, boardID);

  const board: KanbanBoard = {
    company_id: companyID,
    board_id: boardID,
    logic_gate_id: logicGateID,
    title: "Gate",
    position: 1000,
    created_timestamp: "2026-01-01T00:00:00.000Z",
    updated_timestamp: "2026-01-01T00:00:00.000Z",
  };
  const columns: KanbanColumn[] = [{
    company_id: companyID,
    board_id: boardID,
    column_id: "pending",
    title: "Pending",
    position: 1000,
    width_px: 320,
    height_px: 420,
    item_color: "#fbb152",
    created_timestamp: "2026-01-01T00:00:00.000Z",
    updated_timestamp: "2026-01-01T00:00:00.000Z",
  }];
  const cards = [{
    card_id: "card-1",
    column_id: "pending",
    node_id: "node-1",
    node_title: "Node 1",
    position: 1000,
    created_timestamp: "2026-01-01T00:00:00.000Z",
    created_from_email: true,
  }];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = input.toString();
    calls.push(url);
    return jsonResponse({
      logic_gate: { logic_gate_id: logicGateID, header: "Gate", default_access: "edit", request_owner_user_id: "user-1" },
      permissions: { can_view: true, can_edit: true, can_admin: false },
      board,
      columns,
      cards,
      projection_sequence: 7,
    });
  }) as typeof fetch;

  try {
    const result = await getKanbanBoardContentsSingleFlight(apiBase, companyID, boardID);

    assert.deepEqual(result.columns.map((column) => column.column_id), ["pending"]);
    assert.deepEqual(result.cards.map((card) => card.card_id), ["card-1"]);
    assert.equal(result.cards[0]?.company_id, companyID);
    assert.equal(result.cards[0]?.board_id, boardID);
    assert.equal(result.cards[0]?.description_snapshot, "");
    assert.equal(result.cards[0]?.created_from_email, true);
    assert.equal(result.logicGate?.request_owner_user_id, "user-1");
    assert.equal(result.permissions?.can_edit, true);
    assert.equal(result.projectionSequence, 7);
    assert.equal(calls.length, 1);
    assert.match(calls[0] ?? "", /\/v2\/logic-gates\/gate-1\/work\?company_id=company-1$/);
    assert.equal(calls.some((url) => url.includes("/v1/kanban/cards")), false);
    assert.equal(calls.some((url) => url.includes("/v1/kanban/columns")), false);
  } finally {
    globalThis.fetch = originalFetch;
    clearKanbanBoardContentsCache(apiBase, companyID, boardID);
  }
});

test("Logic Gate board 404 is terminal and stops repeated work refetches", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const apiBase = "https://api.example.test/kanban-404";
  const companyID = "company-1";
  const logicGateID = "missing-gate";
  const boardID = logicGateKanbanBoardID(logicGateID);
  clearResourceMissing({ apiBase, companyID, resourceType: "logic_gate", resourceID: logicGateID });
  clearResourceMissing({ apiBase, companyID, resourceType: "kanban_board", resourceID: boardID });
  clearKanbanBoardContentsCache(apiBase, companyID, boardID);

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(input.toString());
    return jsonResponse({ error: "logic_gate_not_found" }, { status: 404, statusText: "Not Found" });
  }) as typeof fetch;

  try {
    await assert.rejects(
      getKanbanBoardContentsSingleFlight(apiBase, companyID, boardID),
      (error: unknown) => isTerminalResourceNotFoundError(error),
    );
    await assert.rejects(
      getKanbanBoardContentsSingleFlight(apiBase, companyID, boardID),
      (error: unknown) => isTerminalResourceNotFoundError(error),
    );
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    clearResourceMissing({ apiBase, companyID, resourceType: "logic_gate", resourceID: logicGateID });
    clearResourceMissing({ apiBase, companyID, resourceType: "kanban_board", resourceID: boardID });
    clearKanbanBoardContentsCache(apiBase, companyID, boardID);
  }
});

test("deduplicates concurrent Logic Gate work reads and returns isolated clones", async () => {
  const originalFetch = globalThis.fetch;
  const apiBase = "https://api.example.test/single-flight";
  const companyID = "company-1";
  const logicGateID = "gate-single";
  const boardID = logicGateKanbanBoardID(logicGateID);
  clearKanbanBoardContentsCache(apiBase, companyID, boardID);
  let calls = 0;
  let releaseFetch!: () => void;
  const fetchGate = new Promise<void>((resolve) => { releaseFetch = resolve; });

  globalThis.fetch = (async () => {
    calls += 1;
    await fetchGate;
    return jsonResponse(workViewPayload(companyID, logicGateID, "card-single", 11));
  }) as typeof fetch;

  try {
    const first = getKanbanBoardContentsSingleFlight(apiBase, companyID, boardID);
    const second = getKanbanBoardContentsSingleFlight(apiBase, companyID, boardID);
    await Promise.resolve();
    assert.equal(calls, 1);
    releaseFetch();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.equal(firstResult.cards[0]?.card_id, "card-single");
    assert.notEqual(firstResult, secondResult);
    firstResult.cards[0]!.node_title = "mutated caller clone";
    assert.equal(secondResult.cards[0]?.node_title, "Card card-single");
    assert.equal(peekKanbanBoardContentsCache(apiBase, companyID, boardID)?.contents.cards[0]?.node_title, "Card card-single");
  } finally {
    globalThis.fetch = originalFetch;
    clearKanbanBoardContentsCache(apiBase, companyID, boardID);
  }
});

test("keeps invalidated snapshots for synchronous cache-first rendering", () => {
  const apiBase = "https://api.example.test/cache-first";
  const companyID = "company-1";
  const boardID = logicGateKanbanBoardID("gate-cache");
  const cached = boardContents(companyID, "gate-cache", "card-cache", 3);
  primeKanbanBoardContentsCache(apiBase, companyID, boardID, cached);

  invalidateKanbanBoardContentsCache(apiBase, companyID, boardID);
  const snapshot = peekKanbanBoardContentsCache(apiBase, companyID, boardID);
  assert.equal(snapshot?.stale, true);
  assert.equal(snapshot?.contents.cards[0]?.card_id, "card-cache");
  snapshot!.contents.cards[0]!.node_title = "caller mutation";
  assert.equal(peekKanbanBoardContentsCache(apiBase, companyID, boardID)?.contents.cards[0]?.node_title, "Card card-cache");

  clearKanbanBoardContentsCache(apiBase, companyID, boardID);
});

test("removes an aborted last-caller flight immediately so A to B to A starts a fresh A request", async () => {
  const originalFetch = globalThis.fetch;
  const apiBase = "https://api.example.test/abort-retry";
  const companyID = "company-1";
  const logicGateID = "gate-A";
  const boardID = logicGateKanbanBoardID(logicGateID);
  clearKanbanBoardContentsCache(apiBase, companyID, boardID);
  let calls = 0;

  globalThis.fetch = ((_: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    if (calls === 1) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    }
    return Promise.resolve(jsonResponse(workViewPayload(companyID, logicGateID, "card-A2", 2)));
  }) as typeof fetch;

  try {
    const firstController = new AbortController();
    const first = getKanbanBoardContentsSingleFlight(apiBase, companyID, boardID, 500, firstController.signal);
    await Promise.resolve();
    firstController.abort();
    const second = getKanbanBoardContentsSingleFlight(apiBase, companyID, boardID);
    await assert.rejects(first, (cause: unknown) => cause instanceof Error && cause.name === "AbortError");
    assert.equal((await second).cards[0]?.card_id, "card-A2");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    clearKanbanBoardContentsCache(apiBase, companyID, boardID);
  }
});

test("forced and live selection calls converge on one guarded load and one apply", async () => {
  const coordinator = createKanbanBoardLoadCoordinator();
  const pending = deferred<KanbanBoardContents>();
  let loads = 0;
  const applied: string[] = [];
  let cached: KanbanBoardContents | null = null;
  const input = {
    key: "logic-gate:gate-1",
    readCached: () => cached ? { contents: cached, stale: false } : null,
    load: async () => {
      loads += 1;
      cached = await pending.promise;
      return cached;
    },
    apply: (contents: KanbanBoardContents) => applied.push(contents.cards[0]?.card_id ?? ""),
  };

  const forced = coordinator.load(input);
  const live = coordinator.load(input);
  assert.equal(forced, live);
  assert.equal(loads, 1);
  pending.resolve(boardContents("company-1", "gate-1", "card-1", 1));
  await Promise.all([forced, live]);
  assert.deepEqual(applied, ["card-1"]);

  await coordinator.load(input);
  assert.deepEqual(applied, ["card-1"], "same logical selection must not reapply a fresh snapshot");
});

test("guarded loader renders stale cache first and then reconciles network contents", async () => {
  const coordinator = createKanbanBoardLoadCoordinator();
  const network = deferred<KanbanBoardContents>();
  const order: string[] = [];
  const stale = boardContents("company-1", "gate-1", "cached-card", 4);
  const pending = coordinator.load({
    key: "logic-gate:gate-1",
    readCached: () => ({ contents: stale, stale: true }),
    load: () => network.promise,
    apply: (contents, source) => order.push(`${source}:${contents.cards[0]?.card_id}`),
  });

  assert.deepEqual(order, ["cache:cached-card"]);
  network.resolve(boardContents("company-1", "gate-1", "network-card", 5));
  await pending;
  assert.deepEqual(order, ["cache:cached-card", "network:network-card"]);
});

test("guarded loader cancels obsolete generations and applies only the final A in A to B to A", async () => {
  const coordinator = createKanbanBoardLoadCoordinator();
  const loads: Array<{ key: string; signal: AbortSignal; pending: ReturnType<typeof deferred<KanbanBoardContents>> }> = [];
  const applied: string[] = [];
  const run = (key: string) => coordinator.load({
    key,
    readCached: () => null,
    load: (signal) => {
      const pending = deferred<KanbanBoardContents>();
      loads.push({ key, signal, pending });
      signal.addEventListener("abort", () => pending.reject(new DOMException("aborted", "AbortError")), { once: true });
      return pending.promise;
    },
    apply: (contents) => applied.push(contents.cards[0]?.card_id ?? ""),
  });

  const firstA = run("logic-gate:A");
  const b = run("logic-gate:B");
  const finalA = run("logic-gate:A");
  assert.equal(loads.length, 3);
  assert.equal(loads[0]?.signal.aborted, true);
  assert.equal(loads[1]?.signal.aborted, true);
  loads[2]!.pending.resolve(boardContents("company-1", "A", "final-A", 8));
  await Promise.all([firstA, b, finalA]);
  assert.deepEqual(applied, ["final-A"]);
});

test("realtime reconciliation updates cached cards and projection sequence atomically", () => {
  const apiBase = "https://api.example.test/realtime-cache";
  const companyID = "company-1";
  const boardID = logicGateKanbanBoardID("gate-1");
  primeKanbanBoardContentsCache(apiBase, companyID, boardID, boardContents(companyID, "gate-1", "old-card", 4));
  invalidateKanbanBoardContentsCache(apiBase, companyID, boardID);

  reconcileKanbanBoardContentsCache(apiBase, companyID, boardID, (contents) => ({
    ...contents,
    cards: [{ ...contents.cards[0]!, card_id: "new-card", created_from_email: true }],
    projectionSequence: 5,
  }));
  const reconciled = peekKanbanBoardContentsCache(apiBase, companyID, boardID);
  assert.equal(reconciled?.stale, false);
  assert.equal(reconciled?.contents.cards[0]?.card_id, "new-card");
  assert.equal(reconciled?.contents.cards[0]?.created_from_email, true);
  assert.equal(reconciled?.contents.projectionSequence, 5);

  clearKanbanBoardContentsCache(apiBase, companyID, boardID);
});

function boardContents(companyID: string, logicGateID: string, cardID: string, projectionSequence: number): KanbanBoardContents {
  const boardID = logicGateKanbanBoardID(logicGateID);
  return {
    logicGate: { logic_gate_id: logicGateID, header: `Gate ${logicGateID}`, default_access: "edit", request_owner_user_id: "user-1" },
    permissions: { can_view: true, can_edit: true, can_admin: false },
    board: {
      company_id: companyID,
      board_id: boardID,
      logic_gate_id: logicGateID,
      title: `Gate ${logicGateID}`,
      position: 1000,
      created_timestamp: "2026-01-01T00:00:00.000Z",
      updated_timestamp: "2026-01-01T00:00:00.000Z",
    },
    columns: [],
    cards: [{
      company_id: companyID,
      board_id: boardID,
      logic_gate_id: logicGateID,
      card_id: cardID,
      column_id: "pending",
      node_id: `node-${cardID}`,
      node_title: `Card ${cardID}`,
      description_snapshot: "",
      position: 1000,
      created_timestamp: "2026-01-01T00:00:00.000Z",
      updated_timestamp: "2026-01-01T00:00:00.000Z",
    }],
    projectionSequence,
  };
}

function workViewPayload(companyID: string, logicGateID: string, cardID: string, projectionSequence: number): Record<string, unknown> {
  const contents = boardContents(companyID, logicGateID, cardID, projectionSequence);
  const card = contents.cards[0]!;
  return {
    logic_gate: {
      logic_gate_id: logicGateID,
      header: contents.logicGate!.header,
      default_access: contents.logicGate!.default_access,
      request_owner_user_id: contents.logicGate!.request_owner_user_id,
    },
    permissions: contents.permissions,
    board: contents.board,
    columns: contents.columns,
    cards: [{
      card_id: card.card_id,
      column_id: card.column_id,
      node_id: card.node_id,
      node_title: card.node_title,
      position: card.position,
      created_timestamp: card.created_timestamp,
    }],
    projection_sequence: projectionSequence,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (cause: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
