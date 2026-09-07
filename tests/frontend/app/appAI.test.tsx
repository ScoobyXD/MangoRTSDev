import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { Simulate } from "react-dom/test-utils";
import { JSDOM } from "jsdom";
import { consumeAIEvents } from "../../../frontend/src/modules/ai/aiApi.js";

async function harness(respond: (url: string, init: RequestInit) => Promise<Response> | Response = () => Response.json({ chats: [] })) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://localhost/" });
  const restores: Array<() => void> = [];
  let runSequence = 0;
  for (const [name, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator, sessionStorage: dom.window.sessionStorage,
    localStorage: dom.window.localStorage, Event: dom.window.Event, CustomEvent: dom.window.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
    crypto: { randomUUID: () => `11111111-1111-4111-8111-${String(++runSequence).padStart(12, "0")}` },
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
  const [{ createRoot }, { AppAI }, { setActiveCompanyID }, { resetTerminalAuthFailure, markTerminalAuthFailure }] = await Promise.all([
    import("react-dom/client"), import("../../../frontend/src/app/AppAI.tsx"), import("../../../frontend/src/auth/currentCompany.ts"), import("../../../frontend/src/auth/cognitoAuth.ts"),
  ]);
  resetTerminalAuthFailure();
  setActiveCompanyID("company-a");
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const render = (userID = "user-a") => root.render(<AppAI apiBase="http://localhost:8080" userID={userID} bottomInset={62} />);
  const button = (label: string) => {
    const item = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
      ?? [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
    assert.ok(item, `Missing button: ${label}`); return item;
  };
  const click = async (label: string) => { await act(async () => { button(label).click(); }); };
  const input = () => container.querySelector<HTMLTextAreaElement>('[aria-label="Message AI"]')!;
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
    const ai = h.container.querySelector<HTMLElement>('[aria-label="AI chat"]')!;
    const expand = h.button("Expand AI chat");
    const collapse = h.button("Collapse AI chat");
    const panel = h.dom.window.document.getElementById(expand.getAttribute("aria-controls")!)!;
    const expanded = panel.closest<HTMLDivElement>(".mango-ai-expanded")!;
    assert.equal(ai.style.bottom, "62px");
    assert.equal(expanded.hidden, true);
    assert.equal(h.requests.length, 0, "collapsed initial chat does not request history");
    await h.click("Expand AI chat");
    assert.equal(expanded.hidden, false);
    assert.equal(h.dom.window.document.activeElement, collapse);
    assert.equal(h.button("Send").disabled, true);
    await h.setText("Draft\nwith a new line");
    assert.equal(h.button("Send").disabled, false);
    await act(async () => { h.input().focus(); h.input().dispatchEvent(new h.dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    assert.ok(h.requests.every(({ init }) => !init.method || init.method === "GET"));
    await h.click("Collapse AI chat");
    assert.equal(expanded.hidden, true);
    assert.equal(h.dom.window.document.activeElement, expand);
    assert.equal(h.input().value, "Draft\nwith a new line");
  } finally { await h.dispose(); }
});

test("explicit send streams literal text, saves the reply, and starts a fresh chat", async () => {
  const stream = eventStream();
  let submitted: Record<string, string> | undefined;
  let createdChat: { chat_id: string; name: string } | undefined;
  const h = await harness((url, init) => {
    if (url.includes("/chats?") && init.method === "POST") {
      const body = JSON.parse(String(init.body));
      assert.equal(body.company_id, "company-a");
      assert.equal(body.name, "New chat");
      createdChat = { chat_id: body.chat_id, name: body.name };
      return Response.json(createdChat);
    }
    if (createdChat && url.includes(`/chats/${createdChat.chat_id}?`)) return Response.json({ ...createdChat, messages: [] });
    if (url.includes("/events?")) return stream.response;
    if (url.includes("/runs?")) {
      submitted = JSON.parse(String(init.body));
      assert.equal(new Headers(init.headers).get("Idempotency-Key"), submitted!.run_id);
      assert.equal(submitted!.company_id, "company-a");
      assert.equal(submitted!.actor_id, undefined);
      assert.match(submitted!.run_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      assert.deepEqual(Object.keys(submitted!).sort(), ["company_id", "message", "run_id"]);
      assert.equal(new URL(url).pathname, "/v1/ai/runs");
      return Response.json({ run_id: "11111111-1111-4111-8111-000000000001", chat_id: "chat-a", status: "queued" });
    }
    if (url.includes("/runs/11111111-1111-4111-8111-000000000001?")) return Response.json({ run_id: "11111111-1111-4111-8111-000000000001", chat_id: "chat-a", status: "running" });
    if (url.includes("/chats/chat-a?")) return Response.json({ chat_id: "chat-a", messages: [
      { message_id: 1, created_timestamp: "2026-09-07T00:00:00Z", role: "user", content: "Create a node" }, { message_id: 2, created_timestamp: "2026-09-07T00:00:00Z", role: "ai", content: "Created 🥭 <b>node</b>" },
      { message_id: 3, created_timestamp: "2026-09-07T00:00:00Z", role: "tool", content: "private tool details" },
    ] });
    return Response.json({ chats: createdChat ? [createdChat] : [] });
  });
  try {
    await h.click("Expand AI chat"); await h.setText("Create a node"); await h.click("Send");
    assert.equal(submitted?.message, "Create a node");
    assert.equal(h.input().value, "");
    assert.equal(h.button("Send").disabled, true);
    await stream.emit({ event: "message.delta", run_id: "11111111-1111-4111-8111-000000000001", delta: "Created 🥭 " });
    assert.match(h.container.textContent!, /Created 🥭/);
    await stream.emit({ event: "run.completed", run_id: "11111111-1111-4111-8111-000000000001", output: "Created 🥭 <b>node</b>" });
    assert.match(h.container.textContent!, /Created 🥭 <b>node<\/b>/);
    assert.equal(h.container.querySelector("article b"), null);
    assert.doesNotMatch(h.container.textContent!, /private tool details/);
    assert.equal(h.container.querySelectorAll("article").length, 2);
    assert.equal(h.container.querySelector('[data-role="ai"] strong')?.textContent, "AI");
    assert.ok(h.requests.every(({ url }) => new URL(url).pathname.startsWith("/v1/ai/")));
    await h.click("New chat");
    assert.equal(h.container.querySelectorAll("article").length, 0);
    assert.equal(h.requests.filter(({ url, init }) => url.includes("/runs?") && init.method === "POST").length, 1, "creating an empty chat never starts a run");
    assert.equal(h.container.querySelector("select")?.value, createdChat?.chat_id);
    await h.click("Collapse AI chat"); await h.click("Expand AI chat");
    assert.equal(h.container.querySelectorAll("article").length, 0, "reopening retains explicit new chat selection");
  } finally { await h.dispose(); }
});

test("uncertain send retries with the same ID and leaves the draft until accepted", async () => {
  const submissions: Array<Record<string, string>> = [];
  const h = await harness((url, init) => {
    if (url.includes("/runs?")) {
      submissions.push(JSON.parse(String(init.body)));
      if (submissions.length === 1) throw new Error("Connection lost after acceptance");
      if (submissions.length === 2) return Response.json({ error: "ai_not_configured_for_account" }, { status: 503 });
      return Response.json({ run_id: "11111111-1111-4111-8111-000000000001", chat_id: "chat-a", status: "completed" });
    }
    if (url.includes("/runs/11111111-1111-4111-8111-000000000001?")) return Response.json({ run_id: "11111111-1111-4111-8111-000000000001", chat_id: "chat-a", status: "completed", output: "Saved" });
    if (url.includes("/chats/chat-a?")) return Response.json({ chat_id: "chat-a", messages: [{ message_id: 1, created_timestamp: "2026-09-07T00:00:00Z", role: "user", content: "Do it once" }, { message_id: 2, created_timestamp: "2026-09-07T00:00:00Z", role: "ai", content: "Saved" }] });
    return Response.json({ chats: [] });
  });
  try {
    await h.click("Expand AI chat"); await h.setText("Do it once"); await h.click("Send");
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
  let localRunID = "";
  let accepted = false;
  const pending = { run_id: "11111111-1111-4111-8111-000000000001", chat_id: "chat-a", message: "Original saved prompt" };
  const h = await harness((url, init) => {
    if (url.includes("/chats?")) return Response.json({ chats: [{ chat_id: "chat-a", name: "Saved" }] });
    if (url.includes("/chats/chat-a?")) return Response.json({ chat_id: "chat-a", messages: [], ...(accepted ? {} : { pending_submission: pending }) });
    if (url.includes("/runs?")) { localRunID = JSON.parse(String(init.body)).run_id; accepted = true; return Response.json({ run_id: "11111111-1111-4111-8111-000000000001", chat_id: "chat-a", status: "cancelled" }); }
    return Response.json({ run_id: "11111111-1111-4111-8111-000000000001", chat_id: "chat-a", status: "cancelled" });
  });
  try {
    await h.click("Expand AI chat");
    assert.match(h.container.textContent!, /Original saved prompt/);
    await h.setText("Another draft");
    assert.equal(h.button("Send").disabled, true);
    await h.click("Retry saved message");
    assert.equal(localRunID, "11111111-1111-4111-8111-000000000001");
    assert.equal(h.input().value, "Another draft");
  } finally { await h.dispose(); }
});

test("interrupted saved runs resume through status without submitting a second action", async () => {
  const stream = eventStream();
  let completed = false;
  const h = await harness((url) => {
    if (url.includes("/chats?")) return Response.json({ chats: [{ chat_id: "chat-a", name: "Saved" }] });
    if (url.includes("/chats/chat-a?")) return Response.json({ chat_id: "chat-a", messages: completed ? [{ message_id: 2, created_timestamp: "2026-09-07T00:00:00Z", role: "ai", content: "Finished while disconnected" }] : [], active_run_id: completed ? undefined : "11111111-1111-4111-8111-000000000001" });
    if (url.includes("/events?")) return stream.response;
    return Response.json({ run_id: "11111111-1111-4111-8111-000000000001", chat_id: "chat-a", status: completed ? "completed" : "running", output: completed ? "Finished while disconnected" : undefined });
  });
  try {
    await h.click("Expand AI chat");
    await stream.emit({ event: "message.delta", run_id: "11111111-1111-4111-8111-000000000001", delta: "Partial " });
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
    if (url.includes("/chats?")) return Response.json({ chats: [{ chat_id: "chat-a", name: "Saved" }] });
    if (url.includes("/chats/chat-a?")) return Response.json({ chat_id: "chat-a", messages: [{ message_id: 1, created_timestamp: "2026-09-07T00:00:00Z", role: "user", content: "Saved request" }], active_run_id: "11111111-1111-4111-8111-000000000001" });
    if (url.includes("/events?")) return stream.response;
    if (url.includes("/cancel?")) assert.equal(init.method, "POST");
    return Response.json({ run_id: "11111111-1111-4111-8111-000000000001", chat_id: "chat-a", status: "running" });
  });
  try {
    await h.click("Expand AI chat"); await h.click("Stop response");
    assert.equal(h.requests.filter(({ url }) => url.includes("/cancel?")).length, 1);
    await stream.emit({ event: "run.cancelled", run_id: "11111111-1111-4111-8111-000000000001" });
    assert.match(h.container.textContent!, /Saved request/);
    assert.match(h.container.textContent!, /Any completed actions remain saved/);
  } finally { await h.dispose(); }
});

for (const change of ["company", "account", "logout"] as const) {
  test(`${change} aborts observation and rejects old account replies and drafts`, async () => {
    const stream = eventStream();
    const h = await harness((url) => {
      if (url.includes("/chats?")) return Response.json({ chats: [{ chat_id: "chat-a", name: "Old private chat" }] });
      if (url.includes("/chats/chat-a?")) return Response.json({ chat_id: "chat-a", messages: [{ message_id: 1, created_timestamp: "2026-09-07T00:00:00Z", role: "user", content: "Old private message" }], active_run_id: "11111111-1111-4111-8111-000000000001" });
      if (url.includes("/events?")) return stream.response;
      return Response.json({ run_id: "11111111-1111-4111-8111-000000000001", chat_id: "chat-a", status: "running" });
    });
    try {
      await h.click("Expand AI chat"); await h.setText("Old private draft");
      const observed = h.requests.find(({ url }) => url.includes("/events?"))!;
      await h[change]();
      assert.equal(observed.init.signal!.aborted, true);
      await stream.emit({ event: "run.completed", run_id: "11111111-1111-4111-8111-000000000001", output: "Old late response" });
      assert.equal(h.input().value, "");
      assert.doesNotMatch(h.container.textContent!, /Old private|Old late/);
      assert.equal(h.requests.filter(({ init }) => init.method === "POST").length, 0, "scope change does not use new credentials to cancel old work");
    } finally { await h.dispose(); }
  });
}

test("SSE preserves split UTF-8 and CRLF frames and rejects wrong run IDs and unfinished replies", async () => {
  const wire = new TextEncoder().encode(': heartbeat\r\n\r\ndata: {"event":"message.delta","run_id":"11111111-1111-4111-8111-000000000001","delta":"🥭"}\r\n\r\ndata: {"event":"run.completed","run_id":"11111111-1111-4111-8111-000000000001","output":"🥭 saved"}\r\n\r\n');
  const seen: unknown[] = [];
  const response = new Response(new ReadableStream({ start(controller) {
    for (let index = 0; index < wire.length; index++) controller.enqueue(wire.slice(index, index + 1));
    controller.close();
  } }), { headers: { "Content-Type": "text/event-stream" } });
  await consumeAIEvents(response, "11111111-1111-4111-8111-000000000001", (event) => seen.push(event));
  assert.deepEqual(seen, [{ event: "message.delta", run_id: "11111111-1111-4111-8111-000000000001", delta: "🥭" }, { event: "run.completed", run_id: "11111111-1111-4111-8111-000000000001", output: "🥭 saved" }]);
  for (const body of [
    'data: {"event":"run.completed","run_id":"another-run","output":"private"}\n\n',
    'data: {"event":"message.delta","run_id":"11111111-1111-4111-8111-000000000001","delta":"partial"}\n\n',
    'data: {"event":"run.completed","run_id":"11111111-1111-4111-8111-000000000001","output":"unterminated"}',
  ]) await assert.rejects(consumeAIEvents(new Response(body, { headers: { "Content-Type": "text/event-stream" } }), "11111111-1111-4111-8111-000000000001", () => {}));
});

test("definitive invalid sends preserve an editable draft without an uncertain retry", async () => {
  const h = await harness((url) => url.includes("/runs?") ? Response.json({ error: "invalid_ai_request" }, { status: 400 }) : Response.json({ chats: [] }));
  try {
    await h.click("Expand AI chat"); await h.setText("My draft"); await h.click("Send");
    assert.equal(h.input().value, "My draft");
    assert.equal(h.button("Send").disabled, false);
    assert.doesNotMatch(h.container.textContent!, /Retry saved message/);
    await h.setText("🥭".repeat(8_001)); await h.click("Send");
    assert.match(h.container.textContent!, /too long/);
    assert.equal(h.requests.filter(({ init }) => init.method === "POST").length, 1, "oversized UTF-8 messages are rejected before creating an uncertain submission");
  } finally { await h.dispose(); }
});

test("an active run conflict opens its older chat instead of the newest chat", async () => {
  const h = await harness((url) => {
    if (url.includes("/runs?")) return Response.json({ error: "ai_run_active_or_request_conflict", active_chat_id: "saved", active_run_id: "run-existing" }, { status: 409 });
    if (url.includes("/chats?")) return Response.json({ chats: [{ chat_id: "newest", name: "Newer chat" }, { chat_id: "saved", name: "Prior request" }] });
    if (url.includes("/chats/newest?")) return Response.json({ chat_id: "newest", messages: [] });
    if (url.includes("/chats/saved?")) return Response.json({ chat_id: "saved", messages: [{ message_id: 1, created_timestamp: "2026-09-07T00:00:00Z", role: "ai", content: "Existing outcome" }], active_run_id: "run-existing" });
    return Response.json({ run_id: "run-existing", chat_id: "saved", status: "interrupted" });
  });
  try {
    await h.click("Expand AI chat"); await h.setText("New request"); await h.click("Send");
    assert.match(h.container.textContent!, /Existing outcome/);
    assert.doesNotMatch(h.container.textContent!, /Retry saved message|Stop response/);
    assert.equal(h.input().value, "New request");
    assert.equal(h.button("Send").disabled, false);
    assert.equal(h.container.querySelector("select")!.value, "saved");
    assert.equal(h.requests.filter(({ url }) => url.includes("/chats/newest?")).length, 1, "recovery must not read the unrelated newest chat again");
  } finally { await h.dispose(); }
});

test("a conflict without active run identities preserves the uncertain send", async () => {
  const h = await harness((url) => url.includes("/runs?")
    ? Response.json({ error: "ai_run_active_or_request_conflict" }, { status: 409 })
    : Response.json({ chats: [] }));
  try {
    await h.click("Expand AI chat"); await h.setText("New request"); await h.click("Send");
    assert.match(h.container.textContent!, /Retry saved message/);
    assert.doesNotMatch(h.container.textContent!, /Its saved chat has been opened/);
    assert.equal(h.requests.filter(({ url }) => url.includes("/chats?")).length, 1, "an ordinary conflict must not guess a recovery chat");
  } finally { await h.dispose(); }
});

test("older saved chats and messages can be loaded without duplicate rows", async () => {
  const h = await harness((url) => {
    const offset = new URL(url).searchParams.get("offset");
    if (url.includes("/chats?")) return Response.json({ chats: offset === "50" ? [{ chat_id: "older", name: "Older" }] : [{ chat_id: "saved", name: "Saved" }], has_more: offset !== "50", next_offset: 50 });
    return Response.json({ chat_id: "saved", messages: offset === "500" ? [{ message_id: 1, created_timestamp: "2026-09-07T00:00:00Z", role: "user", content: "Earlier message" }] : [{ message_id: 2, created_timestamp: "2026-09-07T00:00:00Z", role: "ai", content: "Latest message" }], has_older_messages: offset !== "500", next_message_offset: 500 });
  });
  try {
    await h.click("Expand AI chat"); await h.click("Load older chats");
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
    if (url.includes("/chats?")) return Response.json({ chats: [{ chat_id: "saved", name: "Saved" }] });
    if (url.includes("/chats/saved?")) return Response.json({ chat_id: "saved", messages: completed ? [{ message_id: 1, created_timestamp: "2026-09-07T00:00:00Z", role: "ai", content: "Completed while closed" }] : [], active_run_id: completed ? undefined : "11111111-1111-4111-8111-000000000001" });
    if (url.includes("/events?")) return stream.response;
    return Response.json({ run_id: "11111111-1111-4111-8111-000000000001", chat_id: "saved", status: "running" });
  });
  try {
    await h.click("Expand AI chat"); await h.setText("Kept draft");
    const observation = h.requests.find(({ url }) => url.includes("/events?"))!;
    await h.click("Collapse AI chat");
    assert.equal(observation.init.signal!.aborted, true);
    completed = true;
    await stream.emit({ event: "run.completed", run_id: "11111111-1111-4111-8111-000000000001", output: "Late event" });
    await h.click("Expand AI chat");
    assert.match(h.container.textContent!, /Completed while closed/);
    assert.equal(h.input().value, "Kept draft");
    assert.ok(h.requests.every(({ init }) => !init.method || init.method === "GET"));
  } finally { await h.dispose(); }
});

test("a second view exposes manual resume and never retries the stream automatically", async () => {
  const h = await harness((url) => {
    if (url.includes("/chats?")) return Response.json({ chats: [{ chat_id: "saved", name: "Saved" }] });
    if (url.includes("/chats/saved?")) return Response.json({ chat_id: "saved", messages: [], active_run_id: "11111111-1111-4111-8111-000000000001" });
    if (url.includes("/events?")) return Response.json({ error: "ai_response_open_elsewhere" }, { status: 409 });
    return Response.json({ run_id: "11111111-1111-4111-8111-000000000001", chat_id: "saved", status: "running" });
  });
  try {
    await h.click("Expand AI chat");
    assert.match(h.container.textContent!, /open in another tab/);
    assert.equal(h.button("Resume").disabled, false);
    assert.equal(h.requests.filter(({ url }) => url.includes("/events?")).length, 1);
  } finally { await h.dispose(); }
});

test("a missing route before first admission preserves a draft that can be edited and sent later", async () => {
  const h = await harness(() => Response.json({ error: "ai_not_configured_for_account" }, { status: 503 }));
  try {
    await h.click("Expand AI chat"); await h.setText("My draft"); await h.click("Send");
    assert.match(h.container.textContent!, /configure Hermes/);
    assert.doesNotMatch(h.container.textContent!, /Retry saved message/);
    assert.equal(h.input().readOnly, false);
    assert.equal(h.button("Send").disabled, false);
    await h.setText("Edited draft"); await h.click("Send");
    assert.equal(h.input().value, "Edited draft");
    assert.doesNotMatch(h.container.textContent!, /Retry saved message/);
  } finally { await h.dispose(); }
});


test("pending local runs skip SSE and keep their saved send until Stop confirms closure", async () => {
  const pending = { run_id: "11111111-1111-4111-8111-000000000001", chat_id: "saved", message: "Saved work" };
  let cancelled = false;
  let stops = 0;
  const h = await harness((url, init) => {
    if (url.includes("/chats?")) return Response.json({ chats: [{ chat_id: "saved", name: "Saved work" }] });
    if (url.includes("/chats/saved?")) return Response.json({ chat_id: "saved", name: "Saved work", messages: [], active_run_id: cancelled ? undefined : pending.run_id });
    if (url.includes("/cancel?")) {
      assert.equal(new URL(url).pathname, `/v1/ai/runs/${pending.run_id}/cancel`);
      assert.deepEqual(JSON.parse(String(init.body)), { company_id: "company-a" });
      cancelled = ++stops === 2;
      return Response.json({ run_id: pending.run_id, chat_id: "saved", status: cancelled ? "cancelled" : "stopping", ...(cancelled ? {} : { pending_submission: pending }) });
    }
    assert.equal(new URL(url).pathname, `/v1/ai/runs/${pending.run_id}`);
    return Response.json({ run_id: pending.run_id, chat_id: "saved", status: "pending", pending_submission: pending });
  });
  try {
    await h.click("Expand AI chat"); await h.setText("Separate draft");
    assert.equal(h.button("Send").disabled, true);
    await h.click("Stop response");
    assert.equal(h.button("Send").disabled, true);
    assert.match(h.container.textContent!, /Retry saved message/);
    await h.click("Stop response");
    assert.doesNotMatch(h.container.textContent!, /Retry saved message|Stop response/);
    assert.equal(h.input().value, "Separate draft");
    assert.equal(h.button("Send").disabled, false);
    assert.equal(h.requests.filter(({ url }) => url.includes("/events?")).length, 0);
    assert.equal(h.requests.filter(({ init }) => init.method === "POST").length, 2);
  } finally { await h.dispose(); }
});

test("retrying a saved local run does not duplicate its recorded user message", async () => {
  const stream = eventStream();
  const pending = { run_id: "11111111-1111-4111-8111-000000000001", chat_id: "saved", message: "Saved work" };
  const h = await harness((url, init) => {
    if (url.includes("/chats?")) return Response.json({ chats: [{ chat_id: "saved", name: "Saved work" }] });
    if (url.includes("/chats/saved?")) return Response.json({ chat_id: "saved", name: "Saved work", messages: [
      { message_id: 5, role: "user", content: pending.message, created_timestamp: "2026-09-07T00:00:00Z" },
    ], pending_submission: pending });
    if (url.includes("/runs?")) assert.deepEqual(JSON.parse(String(init.body)), { ...pending, company_id: "company-a" });
    if (url.includes("/events?")) return stream.response;
    return Response.json({ run_id: pending.run_id, chat_id: "saved", status: "running" });
  });
  try {
    await h.click("Expand AI chat"); await h.click("Retry saved message");
    assert.equal(h.container.querySelectorAll('article[data-role="user"]').length, 1);
    assert.equal(h.container.querySelector('article[data-role="user"] p')?.textContent, pending.message);
    assert.equal(h.requests.filter(({ init }) => init.method === "POST").length, 1);
  } finally { await h.dispose(); }
});

test("an accepted response with another run ID preserves the original send for retry", async () => {
  const h = await harness((url) => url.includes("/runs?")
    ? Response.json({ run_id: "unexpected-run", chat_id: "saved", status: "running" })
    : Response.json({ chats: [] }));
  try {
    await h.click("Expand AI chat"); await h.setText("My original send"); await h.click("Send");
    assert.equal(h.input().value, "My original send");
    assert.equal(h.button("Send").disabled, true);
    assert.match(h.container.textContent!, /Retry saved message/);
    assert.equal(h.requests.filter(({ url }) => url.includes("unexpected-run")).length, 0);
  } finally { await h.dispose(); }
});


test("New chat saves an empty named chat without sending a message", async () => {
  let saved: { chat_id: string; name: string } | undefined;
  const h = await harness((url, init) => {
    assert.ok(new URL(url).pathname.startsWith("/v1/ai/chats"));
    if (init.method === "POST") {
      const body = JSON.parse(String(init.body));
      assert.deepEqual(Object.keys(body).sort(), ["chat_id", "company_id", "name"]);
      assert.equal(body.company_id, "company-a");
      saved = { chat_id: body.chat_id, name: body.name };
      return Response.json(saved);
    }
    if (saved && new URL(url).pathname.endsWith(saved.chat_id)) return Response.json({ ...saved, messages: [] });
    return Response.json({ chats: saved ? [saved] : [] });
  });
  try {
    await h.click("Expand AI chat"); await h.setText("Unsent draft"); await h.click("New chat");
    assert.equal(saved?.name, "New chat");
    assert.equal(h.input().value, "");
    assert.equal(h.container.querySelector("select")?.value, saved?.chat_id);
    assert.equal(h.container.querySelectorAll("article").length, 0);
    await h.click("Collapse AI chat"); await h.click("Expand AI chat");
    assert.equal(h.container.querySelector("select")?.value, saved?.chat_id);
    assert.equal(h.requests.filter(({ init }) => init.method === "POST").length, 1);
  } finally { await h.dispose(); }
});


for (const historyMarker of ["run.finished", "history.recovered"]) test(`queued history preserves the completed reply until explicit sync observes ${historyMarker}`, async () => {
  const stream = eventStream();
  let accepted = false;
  let completed = false;
  let historyReady = false;
  const runID = "11111111-1111-4111-8111-000000000001";
  const h = await harness((url, init) => {
    if (url.includes("/chats?")) return Response.json({ chats: accepted ? [{ chat_id: "saved", name: "Saved" }] : [] });
    if (url.includes("/chats/saved?")) return Response.json({ chat_id: "saved", name: "Saved", messages: historyReady ? [
      { message_id: 1, role: "user", content: "Keep this reply", created_timestamp: "2026-09-07T00:00:00Z" },
      { message_id: 2, role: "ai", content: "Exact completed reply", created_timestamp: "2026-09-07T00:00:01Z" },
    ] : [] });
    if (url.includes("/runs?")) { accepted = true; assert.equal(JSON.parse(String(init.body)).run_id, runID); }
    if (url.includes("/events?")) return stream.response;
    return Response.json({ run_id: runID, chat_id: "saved", status: completed ? "completed" : "running", output: completed ? "Exact completed reply" : undefined, history: historyReady ? [{ event: historyMarker }] : [{ event: "messages.saved" }] });
  });
  try {
    await h.click("Expand AI chat"); await h.setText("Keep this reply"); await h.click("Send");
    completed = true;
    await stream.emit({ event: "run.completed", run_id: runID, output: "Exact completed reply" });
    assert.match(h.container.textContent!, /Exact completed reply/);
    assert.match(h.container.textContent!, /history is still syncing/);
    assert.equal(h.container.querySelectorAll("article").length, 2);
    await h.click("Collapse AI chat"); await h.click("Expand AI chat");
    assert.match(h.container.textContent!, /Exact completed reply/);
    assert.match(h.container.textContent!, /history is still syncing/);
    historyReady = true;
    await h.click("Resume");
    assert.deepEqual([...h.container.querySelectorAll("article p")].map((item) => item.textContent), ["Keep this reply", "Exact completed reply"]);
    assert.doesNotMatch(h.container.textContent!, /history is still syncing/);
    assert.equal(h.requests.filter(({ url }) => url.includes("/events?")).length, 1);
    assert.equal(h.requests.filter(({ init }) => init.method === "POST").length, 1);
  } finally { await h.dispose(); }
});
