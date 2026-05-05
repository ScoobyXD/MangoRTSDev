import test from "node:test";
import assert from "node:assert/strict";
import { connectAuthenticatedSse, createSseParser, SseEvent } from "../../../frontend/src/auth/authenticatedSse.js";

const encoder = new TextEncoder();

test("parses split SSE workspace events", () => {
  const parser = createSseParser();
  assert.deepEqual(parser.push("event: workspace\ndata: {\"type\""), []);
  const events = parser.push(":\"node_created\"}\nid: event-1\n\n");

  assert.deepEqual(events, [
    {
      event: "workspace",
      data: "{\"type\":\"node_created\"}",
      id: "event-1",
      retry: undefined,
    },
  ]);
});

test("joins multi-line SSE data fields", () => {
  const parser = createSseParser();
  const events = parser.push("event: workspace\ndata: first\ndata: second\n\n");

  assert.equal(events.length, 1);
  assert.equal(events[0].event, "workspace");
  assert.equal(events[0].data, "first\nsecond");
});

test("fetch SSE sends bearer token and reconnects after a closed stream", async () => {
  const events: SseEvent[] = [];
  const authorizationHeaders: Array<string | null> = [];
  const cacheControlHeaders: Array<string | null> = [];
  let fetchCalls = 0;
  let connection: ReturnType<typeof connectAuthenticatedSse> | null = null;

  const done = new Promise<void>((resolve, reject) => {
    connection = connectAuthenticatedSse("https://api.example.test/v1/workspace/stream?company_id=company-1", {
      getAccessToken: async () => `token-${fetchCalls + 1}`,
      fetchImpl: async (_input, init) => {
        fetchCalls += 1;
        const headers = new Headers(init?.headers);
        authorizationHeaders.push(headers.get("Authorization"));
        cacheControlHeaders.push(headers.get("Cache-Control"));
        const data = fetchCalls === 1 ? "one" : "two";
        return new Response(streamFrom([`event: workspace\ndata: ${data}\n\n`]), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      },
      retryDelayMs: 1,
      setTimeoutImpl: (handler) => {
        queueMicrotask(handler);
        return 1;
      },
      clearTimeoutImpl: () => undefined,
      onEvent: (event) => {
        events.push(event);
        if (events.length === 2) {
          connection?.close();
          resolve();
        }
      },
      onError: reject,
    });
  });

  await done;

  assert.equal(fetchCalls, 2);
  assert.deepEqual(authorizationHeaders, ["Bearer token-1", "Bearer token-2"]);
  assert.deepEqual(cacheControlHeaders, [null, null]);
  assert.deepEqual(events.map((event) => event.data), ["one", "two"]);
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
