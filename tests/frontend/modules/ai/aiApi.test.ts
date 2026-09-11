import test from "node:test";
import assert from "node:assert/strict";
import { cancelAISession, decideAIAction, getAISession } from "../../../../frontend/src/modules/ai/aiApi.js";
import { setRealtimeHealthClientActive, updateRealtimeHealth } from "../../../../frontend/src/modules/realtime/realtimeHealth.js";

test("AI cancellation remains available during realtime failure while approvals stay blocked", async () => {
  const previousFetch = globalThis.fetch;
  const calls: { url: string; method: string }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? "GET" });
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  setRealtimeHealthClientActive("ai-test", true);
  updateRealtimeHealth("ai-test", { status: "disconnected" });
  try {
    await cancelAISession("company A", "session/one");
    assert.equal(calls[0].method, "POST");
    assert.ok(calls[0].url.endsWith("/v1/ai/sessions/session%2Fone/cancel?company_id=company+A"));
    await assert.rejects(decideAIAction("company A", "one", { turn_id: "turn", call_id: "call", name: "create_process_node", arguments: {}, state: "pending", consequential: true }, true), /disconnected/);
    assert.equal(calls.length, 1);
    await getAISession("company A", "one", undefined, "opaque/cursor");
    assert.equal(calls[1].method, "GET");
    assert.ok(calls[1].url.endsWith("company_id=company+A&items_after=opaque%2Fcursor"));
  } finally {
    globalThis.fetch = previousFetch;
    setRealtimeHealthClientActive("ai-test", false);
  }
});
