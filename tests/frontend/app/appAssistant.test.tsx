import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { Simulate } from "react-dom/test-utils";
import { JSDOM } from "jsdom";
import { consumeAssistantEvents } from "../../../frontend/src/modules/assistant/assistantApi.js";

async function harness(respond: (url: string, init: RequestInit) => Promise<Response> | Response = () => Response.json({ conversations: [] })) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://localhost/" });
  const restores: Array<() => void> = [];
  for (const [name, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator, sessionStorage: dom.window.sessionStorage,
    localStorage: dom.window.localStorage, Event: dom.window.Event, CustomEvent: dom.window.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    restores.push(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as Record<string, unknown>)[name]; });
  }
  Object.assign(dom.window.HTMLElement.prototype, { attachEvent() {}, detachEvent() {} });
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input); requests.push({ url, init }); return respond(url, init);
  };
  const [{ createRoot }, { AppAssistant }, { setActiveCompanyID }, { resetTerminalAuthFailure, markTerminalAuthFailure }] = await Promise.all([
    import("react-dom/client"), import("../../../frontend/src/app/AppAssistant.tsx"), import("../../../frontend/src/auth/currentCompany.ts"), import("../../../frontend/src/auth/cognitoAuth.ts"),
  ]);
  resetTerminalAuthFailure();
  setActiveCompanyID("company-a");
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const render = (userID = "user-a") => root.render(<AppAssistant apiBase="http://localhost:8080" userID={userID} bottomInset={62} />);
  const button = (label: string) => {
    const item = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
      ?? [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
    assert.ok(item, `Missing button: ${label}`); return item;
  };
  const click = async (label: string) => { await act(async () => { button(label).click(); }); };
  const input = () => container.querySelector<HTMLTextAreaElement>('[aria-label="Message Mango"]')!;
  await act(async () => { render(); });
  return {
    dom, container, requests, button, click, input,
    setText: async (text: string) => { await act(async () => { input().value = text; Simulate.change(input()); }); },
    company: async () => { await act(async () => { setActiveCompanyID("company-b"); }); },
    account: async () => { await act(async () => { render("user-b"); }); },
    logout: async () => { await act(async () => { markTerminalAuthFailure("logout"); }); },
    dispose: async () => {
      await act(async () => { root.unmount(); }); resetTerminalAuthFailure(); globalThis.fetch = originalFetch;
      restores.reverse().forEach((restore) => restore()); dom.window.close();
    },
  };
}

function eventStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel() { cancelled = true; } });
  return {
    response: new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
    emit: async (event: object) => { await act(async () => { if (!cancelled) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)); }); },
    close: async () => { await act(async () => { if (!cancelled) controller.close(); }); },
  };
}

test("chat keeps accessible toggles and only explicit Send starts a run", async () => {
  const h = await harness();
  try {
    const assistant = h.container.querySelector<HTMLElement>('[aria-label="Mango chat"]')!;
    const expand = h.button("Expand Mango chat");
    const collapse = h.button("Collapse Mango chat");
    const panel = h.dom.window.document.getElementById(expand.getAttribute("aria-controls")!)!;
    const expanded = panel.closest<HTMLDivElement>(".mango-assistant-expanded")!;
    assert.equal(assistant.style.bottom, "62px");
    assert.equal(expanded.hidden, true);
    assert.equal(h.requests.length, 0, "collapsed initial chat does not request history");
    await h.click("Expand Mango chat");
    assert.equal(expanded.hidden, false);
    assert.equal(h.dom.window.document.activeElement, collapse);
    assert.equal(h.button("Send").disabled, true);
    await h.setText("Draft\nwith a new line");
    assert.equal(h.button("Send").disabled, false);
    await act(async () => { h.input().focus(); h.input().dispatchEvent(new h.dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    assert.ok(h.requests.every(({ init }) => !init.method || init.method === "GET"));
    await h.click("Collapse Mango chat");
    assert.equal(expanded.hidden, true);
    assert.equal(h.dom.window.document.activeElement, expand);
    assert.equal(h.input().value, "Draft\nwith a new line");
  } finally { await h.dispose(); }
});

test("explicit send streams literal text, saves the reply, and starts a fresh conversation", async () => {
  const stream = eventStream();
  let submitted: Record<string, string> | undefined;
  const h = await harness((url, init) => {
    if (url.includes("/events?")) return stream.response;
    if (url.includes("/runs?")) {
      submitted = JSON.parse(String(init.body));
      assert.equal(new Headers(init.headers).get("Idempotency-Key"), submitted!.request_id);
      assert.equal(submitted!.company_id, "company-a");
      assert.equal(submitted!.actor_id, undefined);
      return Response.json({ run_id: "run-a", conversation_id: "conversation-a", status: "queued" });
    }
    if (url.includes("/runs/run-a?")) return Response.json({ run_id: "run-a", conversation_id: "conversation-a", status: "running" });
    if (url.includes("/conversations/conversation-a?")) return Response.json({ id: "conversation-a", messages: [
      { id: 1, role: "user", content: "Create a node" }, { id: 2, role: "assistant", content: "Created 🥭 <b>node</b>" },
      { id: 3, role: "tool", content: "private tool details" },
    ] });
    return Response.json({ conversations: [] });
  });
  try {
    await h.click("Expand Mango chat"); await h.setText("Create a node"); await h.click("Send");
    assert.equal(submitted?.message, "Create a node");
    assert.equal(h.input().value, "");
    assert.equal(h.button("Send").disabled, true);
    await stream.emit({ event: "message.delta", run_id: "run-a", delta: "Created 🥭 " });
    assert.match(h.container.textContent!, /Created 🥭/);
    await stream.emit({ event: "run.completed", run_id: "run-a", output: "Created 🥭 <b>node</b>" });
    assert.match(h.container.textContent!, /Created 🥭 <b>node<\/b>/);
    assert.equal(h.container.querySelector("article b"), null);
    assert.doesNotMatch(h.container.textContent!, /private tool details/);
    assert.equal(h.container.querySelectorAll("article").length, 2);
    await h.click("New chat");
    assert.equal(h.container.querySelectorAll("article").length, 0);
    await h.click("Collapse Mango chat"); await h.click("Expand Mango chat");
    assert.equal(h.container.querySelectorAll("article").length, 0, "reopening retains explicit new conversation selection");
  } finally { await h.dispose(); }
});

test("uncertain send retries with the same ID and leaves the draft until accepted", async () => {
  const submissions: Array<Record<string, string>> = [];
  const h = await harness((url, init) => {
    if (url.includes("/runs?")) {
      submissions.push(JSON.parse(String(init.body)));
      if (submissions.length === 1) throw new Error("Connection lost after acceptance");
      if (submissions.length === 2) return Response.json({ error: "assistant_not_configured_for_account" }, { status: 503 });
      return Response.json({ run_id: "run-a", conversation_id: "conversation-a", status: "completed" });
    }
    if (url.includes("/runs/run-a?")) return Response.json({ run_id: "run-a", conversation_id: "conversation-a", status: "completed", output: "Saved" });
    if (url.includes("/conversations/conversation-a?")) return Response.json({ id: "conversation-a", messages: [{ id: 1, role: "user", content: "Do it once" }, { id: 2, role: "assistant", content: "Saved" }] });
    return Response.json({ conversations: [] });
  });
  try {
    await h.click("Expand Mango chat"); await h.setText("Do it once"); await h.click("Send");
    assert.equal(h.input().value, "Do it once");
    assert.equal(h.button("Send").disabled, true);
    await h.click("Retry saved message");
    assert.equal(submissions.length, 2);
    assert.deepEqual(submissions[0], submissions[1]);
    assert.equal(h.button("Send").disabled, true, "a missing route during retry must preserve an earlier uncertain submission");
    await h.click("Retry saved message");
    assert.deepEqual(submissions[0], submissions[2]);
    assert.equal(h.input().value, "");
    assert.match(h.container.textContent!, /Saved/);
  } finally { await h.dispose(); }
});

test("reopening a durable pending submission retries its original ID", async () => {
  let requestID = "";
  let accepted = false;
  const pending = { request_id: "original-request", conversation_id: "conversation-a", message: "Original saved prompt" };
  const h = await harness((url, init) => {
    if (url.includes("/conversations?")) return Response.json({ conversations: [{ id: "conversation-a", title: "Saved" }] });
    if (url.includes("/conversations/conversation-a?")) return Response.json({ id: "conversation-a", messages: [], ...(accepted ? {} : { pending_submission: pending }) });
    if (url.includes("/runs?")) { requestID = JSON.parse(String(init.body)).request_id; accepted = true; return Response.json({ run_id: "run-a", conversation_id: "conversation-a", status: "cancelled" }); }
    return Response.json({ run_id: "run-a", conversation_id: "conversation-a", status: "cancelled" });
  });
  try {
    await h.click("Expand Mango chat");
    assert.match(h.container.textContent!, /Original saved prompt/);
    await h.setText("Another draft");
    assert.equal(h.button("Send").disabled, true);
    await h.click("Retry saved message");
    assert.equal(requestID, "original-request");
    assert.equal(h.input().value, "Another draft");
  } finally { await h.dispose(); }
});

test("interrupted saved runs resume through status without submitting a second action", async () => {
  const stream = eventStream();
  let completed = false;
  const h = await harness((url) => {
    if (url.includes("/conversations?")) return Response.json({ conversations: [{ id: "conversation-a", title: "Saved" }] });
    if (url.includes("/conversations/conversation-a?")) return Response.json({ id: "conversation-a", messages: completed ? [{ id: 2, role: "assistant", content: "Finished while disconnected" }] : [], active_run_id: completed ? undefined : "run-a" });
    if (url.includes("/events?")) return stream.response;
    return Response.json({ run_id: "run-a", conversation_id: "conversation-a", status: completed ? "completed" : "running", output: completed ? "Finished while disconnected" : undefined });
  });
  try {
    await h.click("Expand Mango chat");
    await stream.emit({ event: "message.delta", run_id: "run-a", delta: "Partial " });
    await stream.close();
    assert.match(h.container.textContent!, /Resume to check/);
    completed = true;
    await h.click("Resume");
    assert.match(h.container.textContent!, /Finished while disconnected/);
    assert.ok(h.requests.every(({ init }) => !init.method || init.method === "GET"));
    assert.equal(h.requests.filter(({ url }) => url.includes("/events?")).length, 1);
  } finally { await h.dispose(); }
});

test("Stop calls server cancellation and keeps already saved messages", async () => {
  const stream = eventStream();
  const h = await harness((url, init) => {
    if (url.includes("/conversations?")) return Response.json({ conversations: [{ id: "conversation-a", title: "Saved" }] });
    if (url.includes("/conversations/conversation-a?")) return Response.json({ id: "conversation-a", messages: [{ id: 1, role: "user", content: "Saved request" }], active_run_id: "run-a" });
    if (url.includes("/events?")) return stream.response;
    if (url.includes("/cancel?")) assert.equal(init.method, "POST");
    return Response.json({ run_id: "run-a", conversation_id: "conversation-a", status: "running" });
  });
  try {
    await h.click("Expand Mango chat"); await h.click("Stop response");
    assert.equal(h.requests.filter(({ url }) => url.includes("/cancel?")).length, 1);
    await stream.emit({ event: "run.cancelled", run_id: "run-a" });
    assert.match(h.container.textContent!, /Saved request/);
    assert.match(h.container.textContent!, /Any completed actions remain saved/);
  } finally { await h.dispose(); }
});

for (const change of ["company", "account", "logout"] as const) {
  test(`${change} aborts observation and rejects old account replies and drafts`, async () => {
    const stream = eventStream();
    const h = await harness((url) => {
      if (url.includes("/conversations?")) return Response.json({ conversations: [{ id: "conversation-a", title: "Old private conversation" }] });
      if (url.includes("/conversations/conversation-a?")) return Response.json({ id: "conversation-a", messages: [{ id: 1, role: "user", content: "Old private message" }], active_run_id: "run-a" });
      if (url.includes("/events?")) return stream.response;
      return Response.json({ run_id: "run-a", conversation_id: "conversation-a", status: "running" });
    });
    try {
      await h.click("Expand Mango chat"); await h.setText("Old private draft");
      const observed = h.requests.find(({ url }) => url.includes("/events?"))!;
      await h[change]();
      assert.equal(observed.init.signal!.aborted, true);
      await stream.emit({ event: "run.completed", run_id: "run-a", output: "Old late response" });
      assert.equal(h.input().value, "");
      assert.doesNotMatch(h.container.textContent!, /Old private|Old late/);
      assert.equal(h.requests.filter(({ init }) => init.method === "POST").length, 0, "scope change does not use new credentials to cancel old work");
    } finally { await h.dispose(); }
  });
}

test("SSE preserves split UTF-8 and CRLF frames and rejects wrong run IDs and unfinished replies", async () => {
  const wire = new TextEncoder().encode(': heartbeat\r\n\r\ndata: {"event":"message.delta","run_id":"run-a","delta":"🥭"}\r\n\r\ndata: {"event":"run.completed","run_id":"run-a","output":"🥭 saved"}\r\n\r\n');
  const seen: unknown[] = [];
  const response = new Response(new ReadableStream({ start(controller) {
    for (let index = 0; index < wire.length; index++) controller.enqueue(wire.slice(index, index + 1));
    controller.close();
  } }), { headers: { "Content-Type": "text/event-stream" } });
  await consumeAssistantEvents(response, "run-a", (event) => seen.push(event));
  assert.deepEqual(seen, [{ event: "message.delta", run_id: "run-a", delta: "🥭" }, { event: "run.completed", run_id: "run-a", output: "🥭 saved" }]);
  for (const body of [
    'data: {"event":"run.completed","run_id":"another-run","output":"private"}\n\n',
    'data: {"event":"message.delta","run_id":"run-a","delta":"partial"}\n\n',
    'data: {"event":"run.completed","run_id":"run-a","output":"unterminated"}',
  ]) await assert.rejects(consumeAssistantEvents(new Response(body, { headers: { "Content-Type": "text/event-stream" } }), "run-a", () => {}));
});

test("definitive invalid sends preserve an editable draft without an uncertain retry", async () => {
  const h = await harness((url) => url.includes("/runs?") ? Response.json({ error: "invalid_assistant_request" }, { status: 400 }) : Response.json({ conversations: [] }));
  try {
    await h.click("Expand Mango chat"); await h.setText("My draft"); await h.click("Send");
    assert.equal(h.input().value, "My draft");
    assert.equal(h.button("Send").disabled, false);
    assert.doesNotMatch(h.container.textContent!, /Retry saved message/);
    await h.setText("🥭".repeat(8_001)); await h.click("Send");
    assert.match(h.container.textContent!, /too long/);
    assert.equal(h.requests.filter(({ init }) => init.method === "POST").length, 1, "oversized UTF-8 messages are rejected before creating an uncertain submission");
  } finally { await h.dispose(); }
});

test("an existing active run conflict opens saved progress and an interrupted run becomes terminal", async () => {
  let conflict = false;
  const h = await harness((url) => {
    if (url.includes("/runs?")) { conflict = true; return Response.json({ error: "assistant_run_active_or_request_conflict" }, { status: 409 }); }
    if (url.includes("/conversations?")) return Response.json({ conversations: conflict ? [{ id: "saved", title: "Prior request" }] : [] });
    if (url.includes("/conversations/saved?")) return Response.json({ id: "saved", messages: [{ id: 1, role: "assistant", content: "Existing outcome" }], active_run_id: "run-existing" });
    return Response.json({ run_id: "run-existing", conversation_id: "saved", status: "interrupted" });
  });
  try {
    await h.click("Expand Mango chat"); await h.setText("New request"); await h.click("Send");
    assert.match(h.container.textContent!, /Existing outcome/);
    assert.doesNotMatch(h.container.textContent!, /Retry saved message|Stop response/);
    assert.equal(h.input().value, "New request");
    assert.equal(h.button("Send").disabled, false);
  } finally { await h.dispose(); }
});

test("older saved conversations and messages can be loaded without duplicate rows", async () => {
  const h = await harness((url) => {
    const offset = new URL(url).searchParams.get("offset");
    if (url.includes("/conversations?")) return Response.json({ conversations: offset === "50" ? [{ id: "older", title: "Older" }] : [{ id: "saved", title: "Saved" }], has_more: offset !== "50", next_offset: 50 });
    return Response.json({ id: "saved", messages: offset === "500" ? [{ id: 1, role: "user", content: "Earlier message" }] : [{ id: 2, role: "assistant", content: "Latest message" }], has_older_messages: offset !== "500", next_message_offset: 500 });
  });
  try {
    await h.click("Expand Mango chat"); await h.click("Load older chats");
    assert.match(h.container.querySelector("select")!.textContent!, /Older/);
    await h.click("Load earlier messages");
    assert.deepEqual([...h.container.querySelectorAll("article p")].map((item) => item.textContent), ["Earlier message", "Latest message"]);
    assert.doesNotMatch(h.container.textContent!, /Load earlier messages|Load older chats/);
  } finally { await h.dispose(); }
});

test("collapsing detaches the stream and reopening resumes saved status without another send", async () => {
  const stream = eventStream();
  let completed = false;
  const h = await harness((url) => {
    if (url.includes("/conversations?")) return Response.json({ conversations: [{ id: "saved", title: "Saved" }] });
    if (url.includes("/conversations/saved?")) return Response.json({ id: "saved", messages: completed ? [{ id: 1, role: "assistant", content: "Completed while closed" }] : [], active_run_id: completed ? undefined : "run-a" });
    if (url.includes("/events?")) return stream.response;
    return Response.json({ run_id: "run-a", conversation_id: "saved", status: "running" });
  });
  try {
    await h.click("Expand Mango chat"); await h.setText("Kept draft");
    const observation = h.requests.find(({ url }) => url.includes("/events?"))!;
    await h.click("Collapse Mango chat");
    assert.equal(observation.init.signal!.aborted, true);
    completed = true;
    await stream.emit({ event: "run.completed", run_id: "run-a", output: "Late event" });
    await h.click("Expand Mango chat");
    assert.match(h.container.textContent!, /Completed while closed/);
    assert.equal(h.input().value, "Kept draft");
    assert.ok(h.requests.every(({ init }) => !init.method || init.method === "GET"));
  } finally { await h.dispose(); }
});

test("a second view exposes manual resume and never retries the stream automatically", async () => {
  const h = await harness((url) => {
    if (url.includes("/conversations?")) return Response.json({ conversations: [{ id: "saved", title: "Saved" }] });
    if (url.includes("/conversations/saved?")) return Response.json({ id: "saved", messages: [], active_run_id: "run-a" });
    if (url.includes("/events?")) return Response.json({ error: "assistant_response_open_elsewhere" }, { status: 409 });
    return Response.json({ run_id: "run-a", conversation_id: "saved", status: "running" });
  });
  try {
    await h.click("Expand Mango chat");
    assert.match(h.container.textContent!, /open in another tab/);
    assert.equal(h.button("Resume").disabled, false);
    assert.equal(h.requests.filter(({ url }) => url.includes("/events?")).length, 1);
  } finally { await h.dispose(); }
});

test("a missing route before first admission preserves a draft that can be edited and sent later", async () => {
  const h = await harness(() => Response.json({ error: "assistant_not_configured_for_account" }, { status: 503 }));
  try {
    await h.click("Expand Mango chat"); await h.setText("My draft"); await h.click("Send");
    assert.match(h.container.textContent!, /configure Hermes/);
    assert.doesNotMatch(h.container.textContent!, /Retry saved message/);
    assert.equal(h.input().readOnly, false);
    assert.equal(h.button("Send").disabled, false);
    await h.setText("Edited draft"); await h.click("Send");
    assert.equal(h.input().value, "Edited draft");
    assert.doesNotMatch(h.container.textContent!, /Retry saved message/);
  } finally { await h.dispose(); }
});
