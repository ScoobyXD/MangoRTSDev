import assert from "node:assert/strict";
import test from "node:test";

import {
  clearKanbanBoardContentsCache,
  peekKanbanBoardContentsCache,
  primeKanbanBoardContentsCache,
} from "../../../../frontend/src/modules/kanban/KanbanBoardContentStore.js";
import { invalidateKanbanBoardListCache, listKanbanBoards, moveLogicGateAssignment } from "../../../../frontend/src/modules/kanban/kanbanApi.js";
import {
  EVENT_KANBAN_BOARD_CONTENTS_UPDATED,
  logicGateKanbanBoardID,
  type KanbanBoardContentsUpdatedDetail,
} from "../../../../frontend/src/modules/kanban/shared.js";

type MutableTestGlobal = {
  window?: unknown;
  CustomEvent?: unknown;
  fetch: typeof fetch;
};

function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(payload), { ...init, headers });
}

function installTestWindow(): {
  events: CustomEvent<KanbanBoardContentsUpdatedDetail>[];
  restore: () => void;
} {
  const mutableGlobal = globalThis as unknown as MutableTestGlobal;
  const originalWindow = mutableGlobal.window;
  const originalCustomEvent = mutableGlobal.CustomEvent;
  const events: CustomEvent<KanbanBoardContentsUpdatedDetail>[] = [];
  if (!originalCustomEvent) {
    class TestCustomEvent<T = unknown> extends Event {
      detail: T;

      constructor(type: string, init?: CustomEventInit<T>) {
        super(type);
        this.detail = init?.detail as T;
      }
    }
    mutableGlobal.CustomEvent = TestCustomEvent as unknown as typeof CustomEvent;
  }
  mutableGlobal.window = {
    location: { origin: "https://app.example.test" },
    dispatchEvent(event: Event): boolean {
      events.push(event as CustomEvent<KanbanBoardContentsUpdatedDetail>);
      return true;
    },
  } as Window;
  return {
    events,
    restore() {
      if (originalWindow) mutableGlobal.window = originalWindow;
      else delete mutableGlobal.window;
      if (originalCustomEvent) mutableGlobal.CustomEvent = originalCustomEvent;
      else delete mutableGlobal.CustomEvent;
    },
  };
}

function assignmentResponse(destinationBoardID: string) {
  return {
    card: {
      company_id: "company-1",
      board_id: destinationBoardID,
      card_id: "card-1",
      column_id: "requested",
      node_id: "node-1",
      node_title: "Moved node",
      position: 1000,
      created_timestamp: "2026-07-13T00:00:00.000Z",
      updated_timestamp: "2026-07-13T00:00:01.000Z",
    },
    node: {
      company_id: "company-1",
      node_id: "node-1",
      name: "Moved node",
      logic_gate_ids: ["gate-b"],
      created_timestamp: "2026-07-13T00:00:00.000Z",
    },
    gvic_projection_rows: [],
  };
}

test("simultaneous board-list reads share one request", async () => {
  const apiBase = "https://board-list-dedup.test";
  const companyID = "company-dedup";
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  globalThis.fetch = (async () => {
    fetchCount += 1;
    await gate;
    return jsonResponse({ boards: [{ company_id: companyID, board_id: "board-1", title: "Board", position: 1000 }] });
  }) as typeof fetch;

  try {
    invalidateKanbanBoardListCache(apiBase, companyID);
    const first = listKanbanBoards(apiBase, companyID);
    const second = listKanbanBoards(apiBase, companyID);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(fetchCount, 1);
    release();
    const [firstBoards, secondBoards] = await Promise.all([first, second]);
    assert.deepEqual(firstBoards, secondBoards);
  } finally {
    release();
    globalThis.fetch = originalFetch;
    invalidateKanbanBoardListCache(apiBase, companyID);
  }
});

test("cross-Logic-Gate assignment success invalidates and announces both canonical boards", async () => {
  const apiBase = "https://api.test";
  const companyID = "company-1";
  const sourceLogicGateID = "gate-a";
  const destinationLogicGateID = "gate-b";
  const sourceBoardID = logicGateKanbanBoardID(sourceLogicGateID);
  const destinationBoardID = logicGateKanbanBoardID(destinationLogicGateID);
  const originalFetch = globalThis.fetch;
  const { events, restore } = installTestWindow();
  let requestBody: Record<string, unknown> | undefined;
  primeKanbanBoardContentsCache(apiBase, companyID, sourceBoardID, { columns: [], cards: [] });
  primeKanbanBoardContentsCache(apiBase, companyID, destinationBoardID, { columns: [], cards: [] });
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return jsonResponse(assignmentResponse(destinationBoardID));
  }) as typeof fetch;

  try {
    await moveLogicGateAssignment({
      apiBase,
      companyID,
      logicGateID: " gate-b ",
      fromLogicGateID: " gate-a ",
      nodeID: "node-1",
      status: "requested",
    });

    assert.equal(requestBody?.to_logic_gate_id, destinationLogicGateID);
    assert.equal(requestBody?.from_logic_gate_id, sourceLogicGateID);
    assert.equal(peekKanbanBoardContentsCache(apiBase, companyID, sourceBoardID)?.stale, true);
    assert.equal(peekKanbanBoardContentsCache(apiBase, companyID, destinationBoardID)?.stale, true);
    assert.deepEqual(
      events
        .filter((event) => event.type === EVENT_KANBAN_BOARD_CONTENTS_UPDATED)
        .map((event) => event.detail),
      [
        { companyID, boardID: sourceBoardID, logicGateID: sourceLogicGateID },
        { companyID, boardID: destinationBoardID, logicGateID: destinationLogicGateID },
      ],
    );
  } finally {
    globalThis.fetch = originalFetch;
    restore();
    clearKanbanBoardContentsCache(apiBase, companyID, sourceBoardID);
    clearKanbanBoardContentsCache(apiBase, companyID, destinationBoardID);
  }
});

test("failed cross-Logic-Gate assignment keeps rendered board snapshots and emits no false convergence", async () => {
  const apiBase = "https://api-failure.test";
  const companyID = "company-failure";
  const sourceBoardID = logicGateKanbanBoardID("gate-source");
  const destinationBoardID = logicGateKanbanBoardID("gate-destination");
  const originalFetch = globalThis.fetch;
  const { events, restore } = installTestWindow();
  primeKanbanBoardContentsCache(apiBase, companyID, sourceBoardID, { columns: [], cards: [] });
  primeKanbanBoardContentsCache(apiBase, companyID, destinationBoardID, { columns: [], cards: [] });
  globalThis.fetch = (async () => jsonResponse({ error: "move_failed" }, { status: 500 })) as typeof fetch;

  try {
    await assert.rejects(
      moveLogicGateAssignment({
        apiBase,
        companyID,
        logicGateID: "gate-destination",
        fromLogicGateID: "gate-source",
        nodeID: "node-failure",
      }),
      /move_failed/,
    );
    assert.equal(peekKanbanBoardContentsCache(apiBase, companyID, sourceBoardID)?.stale, false);
    assert.equal(peekKanbanBoardContentsCache(apiBase, companyID, destinationBoardID)?.stale, false);
    assert.equal(events.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
    clearKanbanBoardContentsCache(apiBase, companyID, sourceBoardID);
    clearKanbanBoardContentsCache(apiBase, companyID, destinationBoardID);
  }
});
