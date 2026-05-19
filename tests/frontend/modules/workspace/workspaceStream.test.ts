import test from "node:test";
import assert from "node:assert/strict";
import { subscribeWorkspaceStream } from "../../../../frontend/src/modules/workspace/workspaceStream.js";

const encoder = new TextEncoder();

test("shares one authenticated workspace stream per company", async () => {
  const previousFetch = globalThis.fetch;
  const globalWithWindow = globalThis as unknown as { window?: unknown };
  const previousWindow = globalWithWindow.window;
  let fetchCalls = 0;
  let unsubscribeFirst: (() => void) | undefined;
  let unsubscribeSecond: (() => void) | undefined;
  const events: string[] = [];

  const done = new Promise<void>((resolve, reject) => {
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(streamFrom(["event: ready\ndata: {}\n\n"]), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as typeof fetch;
    globalWithWindow.window = {
      location: { origin: "https://app.example.test" },
    };

    const onEvent = (label: string) => () => {
      events.push(label);
      if (events.length === 2) {
        unsubscribeFirst?.();
        unsubscribeSecond?.();
        resolve();
      }
    };

    unsubscribeFirst = subscribeWorkspaceStream("https://api.example.test", "company-1", {
      onEvent: onEvent("first"),
      onError: reject,
    });
    unsubscribeSecond = subscribeWorkspaceStream("https://api.example.test", "company-1", {
      onEvent: onEvent("second"),
      onError: reject,
    });
  });

  try {
    await done;
    assert.equal(fetchCalls, 1);
    assert.deepEqual(events.sort(), ["first", "second"]);
  } finally {
    unsubscribeFirst?.();
    unsubscribeSecond?.();
    globalThis.fetch = previousFetch;
    globalWithWindow.window = previousWindow;
  }
});

test("in-order workspace events update the cursor without gap signals", async () => {
  const previousFetch = globalThis.fetch;
  const previousSetTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  const globalWithWindow = globalThis as unknown as { window?: unknown };
  const previousWindow = globalWithWindow.window;
  const requests: Array<{ url: string; lastEventID: string | null }> = [];
  const receivedIDs: string[] = [];
  let gaps = 0;
  let fetchCalls = 0;
  let unsubscribe: (() => void) | undefined;

  const done = new Promise<void>((resolve, reject) => {
    globalThis.fetch = (async (input, init) => {
      fetchCalls += 1;
      const headers = new Headers(init?.headers);
      requests.push({ url: String(input), lastEventID: headers.get("Last-Event-ID") });
      const chunks = fetchCalls === 1
        ? [workspaceEventChunk("1", "node_updated", { node_id: "node-1" }), workspaceEventChunk("2", "node_updated", { node_id: "node-2" })]
        : [workspaceEventChunk("3", "node_updated", { node_id: "node-3" })];
      return new Response(streamFrom(chunks), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as typeof fetch;
    globalThis.setTimeout = ((handler: TimerHandler, _timeout?: number, ...args: unknown[]) => {
      if (typeof handler === "function") queueMicrotask(() => handler(...args));
      return 1;
    }) as typeof setTimeout;
    globalThis.clearTimeout = (() => undefined) as typeof clearTimeout;
    globalWithWindow.window = {
      location: { origin: "https://app.example.test" },
    };

    unsubscribe = subscribeWorkspaceStream("https://api.example.test", "company-in-order", {
      onGap: () => { gaps += 1; },
      onEvent: (event) => {
        if (event.event !== "workspace" || !event.id) return;
        receivedIDs.push(event.id);
        if (event.id === "3") {
          unsubscribe?.();
          resolve();
        }
      },
      onError: reject,
    });
  });

  try {
    await done;
    assert.deepEqual(receivedIDs, ["1", "2", "3"]);
    assert.equal(gaps, 0);
    assert.equal(new URL(requests[1].url).searchParams.get("after_sequence"), "2");
    assert.equal(requests[1].lastEventID, "2");
  } finally {
    unsubscribe?.();
    globalThis.fetch = previousFetch;
    globalThis.setTimeout = previousSetTimeout;
    globalThis.clearTimeout = previousClearTimeout;
    globalWithWindow.window = previousWindow;
  }
});

test("duplicate and stale workspace events are ignored", async () => {
  const previousFetch = globalThis.fetch;
  const globalWithWindow = globalThis as unknown as { window?: unknown };
  const previousWindow = globalWithWindow.window;
  const receivedIDs: string[] = [];
  let gaps = 0;
  let unsubscribe: (() => void) | undefined;

  const done = new Promise<void>((resolve, reject) => {
    globalThis.fetch = (async () => new Response(streamFrom([
      workspaceEventChunk("5", "node_updated", { node_id: "node-5" }),
      workspaceEventChunk("5", "node_updated", { node_id: "node-5-duplicate" }),
      workspaceEventChunk("4", "node_updated", { node_id: "node-4-stale" }),
      workspaceEventChunk("6", "node_updated", { node_id: "node-6" }),
    ]), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    })) as typeof fetch;
    globalWithWindow.window = {
      location: { origin: "https://app.example.test" },
    };

    unsubscribe = subscribeWorkspaceStream("https://api.example.test", "company-duplicates", {
      onGap: () => { gaps += 1; },
      onEvent: (event) => {
        if (event.event !== "workspace" || !event.id) return;
        receivedIDs.push(event.id);
        if (event.id === "6") {
          unsubscribe?.();
          resolve();
        }
      },
      onError: reject,
    });
  });

  try {
    await done;
    assert.deepEqual(receivedIDs, ["5", "6"]);
    assert.equal(gaps, 0);
  } finally {
    unsubscribe?.();
    globalThis.fetch = previousFetch;
    globalWithWindow.window = previousWindow;
  }
});

test("sequence gaps emit scoped reconciliation metadata to subscribers", async () => {
  const previousFetch = globalThis.fetch;
  const globalWithWindow = globalThis as unknown as { window?: unknown };
  const previousWindow = globalWithWindow.window;
  let unsubscribe: (() => void) | undefined;
  const gapBoardIDs: string[] = [];
  const subscriberResponses: string[] = [];

  const done = new Promise<void>((resolve, reject) => {
    globalThis.fetch = (async () => new Response(streamFrom([
      "event: ready\ndata: {\"company_id\":\"company-gap\",\"after_sequence\":10}\n\n",
      workspaceEventChunk("12", "kanban_card_moved", { board_id: "board-A", card_id: "card-A" }),
    ]), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    })) as typeof fetch;
    globalWithWindow.window = {
      location: { origin: "https://app.example.test" },
    };

    unsubscribe = subscribeWorkspaceStream("https://api.example.test", "company-gap", {
      onGap: (gap) => {
        assert.equal(gap.previousSequence, 10);
        assert.equal(gap.receivedSequence, 12);
        assert.equal(gap.missingFrom, 11);
        assert.equal(gap.missingTo, 11);
        const boardScope = gap.scopes.find((scope) => scope.kind === "kanban_board");
        if (boardScope?.boardID) gapBoardIDs.push(boardScope.boardID);
        if (boardScope?.boardID === "board-A") subscriberResponses.push(`refresh:${boardScope.boardID}`);
      },
      onEvent: (event, context) => {
        if (event.id !== "12") return;
        assert.equal(context.gap?.receivedSequence, 12);
        unsubscribe?.();
        resolve();
      },
      onError: reject,
    });
  });

  try {
    await done;
    assert.deepEqual(gapBoardIDs, ["board-A"]);
    assert.deepEqual(subscriberResponses, ["refresh:board-A"]);
  } finally {
    unsubscribe?.();
    globalThis.fetch = previousFetch;
    globalWithWindow.window = previousWindow;
  }
});

test("uses received workspace id as after_sequence on reconnect", async () => {
  const previousFetch = globalThis.fetch;
  const previousSetTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  const globalWithWindow = globalThis as unknown as { window?: unknown };
  const previousWindow = globalWithWindow.window;
  const requests: Array<{ url: string; lastEventID: string | null }> = [];
  let fetchCalls = 0;
  let unsubscribe: (() => void) | undefined;

  const done = new Promise<void>((resolve, reject) => {
    globalThis.fetch = (async (input, init) => {
      fetchCalls += 1;
      const headers = new Headers(init?.headers);
      requests.push({ url: String(input), lastEventID: headers.get("Last-Event-ID") });
      const id = fetchCalls === 1 ? "7" : "8";
      return new Response(streamFrom([workspaceEventChunk(id, "node_updated", { node_id: `node-${id}` })]), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as typeof fetch;
    globalThis.setTimeout = ((handler: TimerHandler, _timeout?: number, ...args: unknown[]) => {
      if (typeof handler === "function") queueMicrotask(() => handler(...args));
      return 1;
    }) as typeof setTimeout;
    globalThis.clearTimeout = (() => undefined) as typeof clearTimeout;
    globalWithWindow.window = {
      location: { origin: "https://app.example.test" },
    };

    unsubscribe = subscribeWorkspaceStream("https://api.example.test", "company-replay", {
      onEvent: (event) => {
        if (event.id === "8") {
          unsubscribe?.();
          resolve();
        }
      },
      onError: reject,
    });
  });

  try {
    await done;
    assert.equal(requests.length, 2);
    const firstURL = new URL(requests[0].url);
    const secondURL = new URL(requests[1].url);
    assert.equal(firstURL.searchParams.get("company_id"), "company-replay");
    assert.equal(firstURL.searchParams.get("after_sequence"), null);
    assert.equal(requests[0].lastEventID, null);
    assert.equal(secondURL.searchParams.get("company_id"), "company-replay");
    assert.equal(secondURL.searchParams.get("after_sequence"), "7");
    assert.equal(requests[1].lastEventID, "7");
  } finally {
    unsubscribe?.();
    globalThis.fetch = previousFetch;
    globalThis.setTimeout = previousSetTimeout;
    globalThis.clearTimeout = previousClearTimeout;
    globalWithWindow.window = previousWindow;
  }
});

test("uses ready after_sequence as replay cursor on reconnect before workspace events", async () => {
  const previousFetch = globalThis.fetch;
  const previousSetTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  const globalWithWindow = globalThis as unknown as { window?: unknown };
  const previousWindow = globalWithWindow.window;
  const requests: Array<{ url: string; lastEventID: string | null }> = [];
  const replayBoundaries: number[] = [];
  let fetchCalls = 0;
  let unsubscribe: (() => void) | undefined;

  const done = new Promise<void>((resolve, reject) => {
    globalThis.fetch = (async (input, init) => {
      fetchCalls += 1;
      const headers = new Headers(init?.headers);
      requests.push({ url: String(input), lastEventID: headers.get("Last-Event-ID") });
      const chunks = fetchCalls === 1
        ? ["event: ready\ndata: {\"company_id\":\"company-ready-replay\",\"after_sequence\":7}\n\n"]
        : [workspaceEventChunk("8", "node_updated", { node_id: "node-8" })];
      return new Response(streamFrom(chunks), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as typeof fetch;
    globalThis.setTimeout = ((handler: TimerHandler, _timeout?: number, ...args: unknown[]) => {
      if (typeof handler === "function") queueMicrotask(() => handler(...args));
      return 1;
    }) as typeof setTimeout;
    globalThis.clearTimeout = (() => undefined) as typeof clearTimeout;
    globalWithWindow.window = {
      location: { origin: "https://app.example.test" },
    };

    unsubscribe = subscribeWorkspaceStream("https://api.example.test", "company-ready-replay", {
      onReplayBoundary: (boundary) => {
        replayBoundaries.push(boundary.afterSequence);
      },
      onEvent: (event) => {
        if (event.id === "8") {
          unsubscribe?.();
          resolve();
        }
      },
      onError: reject,
    });
  });

  try {
    await done;
    assert.deepEqual(replayBoundaries, [7]);
    assert.equal(new URL(requests[0].url).searchParams.get("after_sequence"), null);
    assert.equal(requests[0].lastEventID, null);
    assert.equal(new URL(requests[1].url).searchParams.get("after_sequence"), "7");
    assert.equal(requests[1].lastEventID, null);
  } finally {
    unsubscribe?.();
    globalThis.fetch = previousFetch;
    globalThis.setTimeout = previousSetTimeout;
    globalThis.clearTimeout = previousClearTimeout;
    globalWithWindow.window = previousWindow;
  }
});

function workspaceEventChunk(id: string, type: string, data: Record<string, unknown>): string {
  return `event: workspace\nid: ${id}\ndata: ${JSON.stringify({ company_id: "company", type, data })}\n\n`;
}

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}
