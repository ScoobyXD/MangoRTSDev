import assert from "node:assert/strict";
import test from "node:test";
import { APIHTTPError, requestJSON } from "../../../../frontend/src/modules/api/requestJSON.js";
import {
  ASSISTANT_DEFAULT_REASONING_EFFORT, assistantErrorMessage, assistantHistoryError, consumeAssistantStream,
  isAssistantReasoningEffort, streamAssistantChat, type AssistantEvent,
} from "../../../../frontend/src/modules/assistant/assistantApi.js";

function streamResponse(chunks: Uint8Array[]): Response {
  return new Response(new ReadableStream({ start(controller) { chunks.forEach((chunk) => controller.enqueue(chunk)); controller.close(); } }), {
    headers: { "Content-Type": "text/event-stream" },
  });
}

test("assistant consumes fragmented UTF-8 SSE, comments, tool progress and explicit completion", async () => {
  const encoder = new TextEncoder();
  const body = encoder.encode(': connected\r\n\r\ndata: {"type":"text","text":"Mango 🥭"}\r\n\r\ndata: {"type":"tool","name":"get_me","status":"running"}\n\ndata: {"type":"done"}\n\ndata: {"type":"text","text":"ignored"}\n\n');
  const events: AssistantEvent[] = [];
  await consumeAssistantStream(streamResponse(Array.from(body, (byte) => new Uint8Array([byte]))), (event) => events.push(event));
  assert.deepEqual(events, [{ type: "text", text: "Mango 🥭" }, { type: "tool", name: "get_me", status: "running" }, { type: "done" }]);
});

test("an unfinished or malformed stream cannot become a successful reply", async () => {
  const encoder = new TextEncoder();
  for (const body of ['data: {"type":"text","text":"partial"}\n\n', 'data: {"type":"unexpected"}\n\n']) {
    const events: AssistantEvent[] = [];
    await assert.rejects(consumeAssistantStream(streamResponse([encoder.encode(body)]), (event) => events.push(event)));
    assert.equal(events.some((event) => event.type === "done"), false);
  }
});

test("assistant accepts the created Node event and rejects missing resource identities", async () => {
  const encoder = new TextEncoder();
  const node = { type: "node", node_id: "node-a", process_id: "process-a" };
  const events: AssistantEvent[] = [];
  await consumeAssistantStream(streamResponse([encoder.encode(`data: ${JSON.stringify(node)}\n\ndata: {"type":"done"}\n\n`)]), (event) => events.push(event));
  assert.deepEqual(events, [node, { type: "done" }]);
  for (const invalid of [{ type: "node", node_id: "node-a" }, { ...node, node_id: " " }, { ...node, process_id: null }]) {
    await assert.rejects(consumeAssistantStream(streamResponse([encoder.encode(`data: ${JSON.stringify(invalid)}\n\n`)]), () => undefined));
  }
});

test("Process chat sends the exact selected identity without injecting client-side instructions or credentials", async () => {
  const originalFetch = globalThis.fetch;
  const messages = [{ role: "user" as const, content: "Please perform #Order review" }];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.process_id, "11111111-1111-4111-8111-111111111111");
    assert.deepEqual(body.messages, messages);
    assert.deepEqual(Object.keys(body).sort(), ["messages", "process_id", "reasoning_effort", "request_id"]);
    return streamResponse([new TextEncoder().encode('data: {"type":"done"}\n\n')]);
  };
  try {
    await streamAssistantChat("https://api.example.test", "company-a", messages, "medium", new AbortController().signal, () => undefined, "11111111-1111-4111-8111-111111111111");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("assistant sends a company-scoped request once and never repeats an uncertain write", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (input, init) => {
    requests += 1;
    assert.equal(String(input), "https://api.example.test/v1/assistant/chat?company_id=company-a");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("Accept"), "text/event-stream");
    const body = JSON.parse(String(init?.body));
    assert.match(body.request_id, /^[0-9a-f-]{36}$/);
    assert.equal(body.reasoning_effort, "xhigh");
    assert.deepEqual(body.messages, [{ role: "user", content: "Create a process" }]);
    assert.deepEqual(Object.keys(body).sort(), ["messages", "reasoning_effort", "request_id"]);
    throw new Error("connection lost after server accepted request");
  };
  try {
    await assert.rejects(streamAssistantChat("https://api.example.test", "company-a", [{ role: "user", content: "Create a process" }], "xhigh", new AbortController().signal, () => undefined));
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("assistant exposes only the product reasoning choices and defaults to medium", () => {
  assert.equal(ASSISTANT_DEFAULT_REASONING_EFFORT, "medium");
  for (const effort of ["low", "medium", "high", "xhigh", "max"]) assert.equal(isAssistantReasoningEffort(effort), true);
  for (const effort of ["", "none", "minimal", "MEDIUM", "ultra"]) assert.equal(isAssistantReasoningEffort(effort), false);
});

test("the shared request timeout stays active while its stream body is consumed", async () => {
  let aborted = false;
  let responseSignal: AbortSignal | null | undefined;
  await assert.rejects(requestJSON("https://api.example.test", "/v1/assistant/chat", {
    auth: false,
    timeoutMs: 5,
    fetchImpl: async (_input, init) => { responseSignal = init?.signal; return new Response("ready"); },
    consumeResponse: async () => new Promise((_resolve, reject) => {
      responseSignal?.addEventListener("abort", () => { aborted = true; reject(responseSignal?.reason); }, { once: true });
    }),
  }), (error: unknown) => error instanceof DOMException && error.name === "TimeoutError");
  assert.equal(aborted, true);
});

test("chat errors hide raw response bodies and history obeys the server bounds", () => {
  assert.doesNotMatch(assistantErrorMessage(new APIHTTPError(500, "Error", "private provider details")), /private provider details/);
  assert.match(assistantErrorMessage(new APIHTTPError(503, "Unavailable", "private provider details")), /unavailable/);
  assert.equal(assistantHistoryError([{ role: "user", content: "a".repeat(48_000) }]), "");
  assert.match(assistantHistoryError([{ role: "user", content: "a".repeat(48_001) }]), /full/);
  assert.match(assistantHistoryError(Array.from({ length: 25 }, () => ({ role: "user", content: "x" }))), /full/);
});
