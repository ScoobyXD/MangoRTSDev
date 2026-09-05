import assert from "node:assert/strict";
import test from "node:test";
import { APIHTTPError, requestJSON } from "../../../../frontend/src/modules/api/requestJSON.js";
import {
  ASSISTANT_DEFAULT_REASONING_EFFORT, ASSISTANT_MAX_TRACE_BYTES, assistantErrorMessage, assistantHistoryError, consumeAssistantStream, getAssistantTrace, getAssistantResult,
  isAssistantReasoningEffort, streamAssistantChat, type AssistantEvent,
} from "../../../../frontend/src/modules/assistant/assistantApi.js";

function streamResponse(chunks: Uint8Array[]): Response {
  return new Response(new ReadableStream({ start(controller) { chunks.forEach((chunk) => controller.enqueue(chunk)); controller.close(); } }), {
    headers: { "Content-Type": "text/event-stream" },
  });
}

test("inspection requires opt-in and retains complete initial and final continuation requests beyond the old limit", async () => {
  const first = { type: "trace", trace: { sequence: 1, kind: "provider_request", status: "prepared", time: "2026-09-05T00:00:00Z", data: { invocation: 1, body: { model: "test-model", instructions: "Pi-added instructions", input: [{ role: "developer", content: "a".repeat(3 * 1024 * 1024) }], tools: [], max_output_tokens: 4096, store: false, parallel_tool_calls: false } } } };
  const continuation = { type: "trace", trace: { sequence: 2, kind: "provider_request", status: "dispatched", time: "2026-09-05T00:00:01Z", data: { invocation: 17, body: { model: "test-model", instructions: "Pi-added instructions", input: [{ role: "user", content: "Please act" }, { type: "function_call_output", output: "Saved" }] } } } };
  const bytes = new TextEncoder().encode(`data: ${JSON.stringify(first)}\n\ndata: ${JSON.stringify(continuation)}\n\ndata: {"type":"done"}\n\n`);
  await assert.rejects(consumeAssistantStream(streamResponse([bytes]), () => undefined));
  const events: AssistantEvent[] = [];
  await consumeAssistantStream(streamResponse([bytes]), (event) => events.push(event), true);
  assert.deepEqual(events, [first, continuation, { type: "done" }]);
  for (const invalid of [{ ...first.trace, sequence: 0 }, { ...first.trace, sequence: 2 }, { ...first.trace, data: null }, { ...first.trace, data: [] }, { ...first.trace, status: "success" }, { ...first.trace, time: "invalid" }]) {
    const malformed = new TextEncoder().encode(`data: ${JSON.stringify({ type: "trace", trace: invalid })}\n\n`);
    await assert.rejects(consumeAssistantStream(streamResponse([malformed]), () => undefined, true));
  }
  await assert.rejects(consumeAssistantStream(streamResponse([new TextEncoder().encode('data: {"type":"context","context":{"step":1,"input":[],"omitted_reasoning_items":0}}\n\n')]), () => undefined, true), "obsolete delta events are not accepted");
  await assert.rejects(consumeAssistantStream(streamResponse([new Uint8Array(ASSISTANT_MAX_TRACE_BYTES + 512_000 + 256 * 1024 + 1)]), () => undefined, true));
});

test("trace recovery uses the exact company/request and validates the complete event sequence", async () => {
  const originalFetch = globalThis.fetch;
  let snapshot: unknown = { events: [{ sequence: 1, kind: "tool", status: "saved", time: "2026-09-05T00:00:00Z", data: { result: "Saved before cancellation" } }], finished: true, process: { id: "process-a", name: "Saved Process" }, node_id: "node-a" };
  globalThis.fetch = async (input) => {
    assert.equal(String(input), "https://api.example.test/v1/assistant/trace?company_id=company-a&request_id=request-a");
    return new Response(JSON.stringify(snapshot), { headers: { "Content-Type": "application/json" } });
  };
  try {
    assert.deepEqual(await getAssistantTrace("https://api.example.test", "company-a", "request-a", new AbortController().signal), snapshot);
    snapshot = { events: [{ sequence: 2, kind: "termination", status: "stopped", time: "2026-09-05T00:00:00Z", data: {} }], finished: true };
    await assert.rejects(getAssistantTrace("https://api.example.test", "company-a", "request-a", new AbortController().signal));
    snapshot = { events: [], finished: true, node_id: "unbound-node" };
    await assert.rejects(getAssistantTrace("https://api.example.test", "company-a", "request-a", new AbortController().signal));
  } finally { globalThis.fetch = originalFetch; }
});

test("regular result recovery accepts only saved resource metadata and requires no Inspect opt-in", async () => {
  const originalFetch = globalThis.fetch;
  let snapshot: unknown = { finished: true, process: { id: "saved-process", name: "Actual Process name" }, node_id: "saved-node" };
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.example.test/v1/assistant/result?company_id=company-a&request_id=request-a");
    assert.equal(init?.method ?? "GET", "GET");
    assert.equal(init?.body, undefined);
    return new Response(JSON.stringify(snapshot), { headers: { "Content-Type": "application/json" } });
  };
  try {
    assert.deepEqual(await getAssistantResult("https://api.example.test", "company-a", "request-a", new AbortController().signal), snapshot);
    snapshot = { finished: true, node_id: "saved-node-moved-by-human" };
    assert.deepEqual(await getAssistantResult("https://api.example.test", "company-a", "request-a", new AbortController().signal), snapshot, "a saved accessible Node does not require access to its original Process");
    for (const invalid of [{ finished: true, events: [] }, { finished: true, context: "private" }, { finished: "yes" }, { finished: true, node_id: " " }]) {
      snapshot = invalid;
      await assert.rejects(getAssistantResult("https://api.example.test", "company-a", "request-a", new AbortController().signal));
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("context inspection request sends only its opt-in, never a client-authored context", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.inspect_context, true);
    assert.deepEqual(Object.keys(body).sort(), ["inspect_context", "messages", "reasoning_effort", "request_id"]);
    return streamResponse([new TextEncoder().encode('data: {"type":"done"}\n\n')]);
  };
  try {
    await streamAssistantChat("https://api.example.test", "company-a", crypto.randomUUID(), [{ role: "user", content: "Hello" }], "medium", new AbortController().signal, () => undefined, undefined, true);
  } finally { globalThis.fetch = originalFetch; }
});

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

test("discovered Process bindings carry the saved identity and name before the Node event", async () => {
  const process = { type: "process", process_id: "process-b", name: "Changed saved Process name" };
  const node = { type: "node", node_id: "node-b", process_id: "process-b" };
  const events: AssistantEvent[] = [];
  const bytes = new TextEncoder().encode([process, node, { type: "done" }].map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
  await consumeAssistantStream(streamResponse([bytes]), (event) => events.push(event));
  assert.deepEqual(events, [process, node, { type: "done" }]);
  for (const invalid of [{ ...process, name: " " }, { ...process, process_id: undefined }]) {
    await assert.rejects(consumeAssistantStream(streamResponse([new TextEncoder().encode(`data: ${JSON.stringify(invalid)}\n\n`)]), () => undefined));
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
    await streamAssistantChat("https://api.example.test", "company-a", crypto.randomUUID(), messages, "medium", new AbortController().signal, () => undefined, "11111111-1111-4111-8111-111111111111");
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
    await assert.rejects(streamAssistantChat("https://api.example.test", "company-a", crypto.randomUUID(), [{ role: "user", content: "Create a process" }], "xhigh", new AbortController().signal, () => undefined));
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
