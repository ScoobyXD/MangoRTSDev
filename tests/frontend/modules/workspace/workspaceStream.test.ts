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
