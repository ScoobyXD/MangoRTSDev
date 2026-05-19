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
      return new Response(streamFrom([`event: workspace\nid: ${id}\ndata: {}\n\n`]), {
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
