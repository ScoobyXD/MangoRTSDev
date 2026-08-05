import test from "node:test";
import assert from "node:assert/strict";
import { fetchWorkspaceSnapshot, invalidateWorkspaceSnapshot, markWorkspaceSnapshotScopeStale } from "../../../../frontend/src/modules/workspace/workspaceSnapshotCache.js";

function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(payload), { ...init, headers });
}

test("fetchWorkspaceSnapshot sends If-None-Match and keeps cached payload on 304", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; headers: Headers }> = [];
  const firstPayload = { scope: "company_explorer", company_id: "company-1", nodes: [{ node_id: "node-1" }] };
  let requestCount = 0;
  globalThis.fetch = (async (input, init) => {
    calls.push({ url: input.toString(), headers: new Headers(init?.headers) });
    requestCount += 1;
    if (requestCount === 1) return jsonResponse(firstPayload, { headers: { ETag: "\"snapshot-v1\"" } });
    return new Response(null, { status: 304 });
  }) as typeof fetch;

  try {
    invalidateWorkspaceSnapshot();
    const first = await fetchWorkspaceSnapshot("https://api.example.test", "company-1", { scope: "company_explorer", force: true });
    const second = await fetchWorkspaceSnapshot("https://api.example.test", "company-1", { scope: "company_explorer", force: true });

    assert.deepEqual(first.payload, firstPayload);
    assert.equal(first.changed, true);
    assert.deepEqual(second.payload, firstPayload);
    assert.equal(second.changed, false);
    assert.equal(calls[1]?.headers.get("If-None-Match"), "\"snapshot-v1\"");
    assert.match(calls[0]?.url ?? "", /\/v1\/workspace\/snapshot\?/);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateWorkspaceSnapshot();
  }
});

test("fetchWorkspaceSnapshot keeps cached payload on non-OK responses", async () => {
  const originalFetch = globalThis.fetch;
  const firstPayload = { scope: "full", company_id: "company-1", nodes: [{ node_id: "node-1" }] };
  let requestCount = 0;
  globalThis.fetch = (async () => {
    requestCount += 1;
    if (requestCount === 1) return jsonResponse(firstPayload, { headers: { ETag: "\"snapshot-v2\"" } });
    return jsonResponse({ error: "temporarily_unavailable" }, { status: 503, statusText: "Unavailable" });
  }) as typeof fetch;

  try {
    invalidateWorkspaceSnapshot();
    await fetchWorkspaceSnapshot("https://api.example.test", "company-1", { scope: "full", force: true });
    const result = await fetchWorkspaceSnapshot("https://api.example.test", "company-1", { scope: "full", force: true });

    assert.deepEqual(result.payload, firstPayload);
    assert.equal(result.changed, false);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateWorkspaceSnapshot();
  }
});

test("markWorkspaceSnapshotScopeStale refetches only matching snapshot scope and resource", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = input.toString();
    calls.push(url);
    const parsed = new URL(url);
    const scope = parsed.searchParams.get("scope") ?? "";
    const boardID = parsed.searchParams.get("board_id") ?? "";
    return jsonResponse({ scope, board_id: boardID, request_count: calls.length }, { headers: { ETag: `"${scope}:${boardID}:${calls.length}"` } });
  }) as typeof fetch;

  try {
    invalidateWorkspaceSnapshot();
    await fetchWorkspaceSnapshot("https://api.example.test", "company-1", { scope: "company_explorer", force: true });
    await fetchWorkspaceSnapshot("https://api.example.test", "company-1", { scope: "kanban", boardID: "board-A", force: true });
    await fetchWorkspaceSnapshot("https://api.example.test", "company-1", { scope: "kanban", boardID: "board-B", force: true });
    const warmedCallCount = calls.length;

    markWorkspaceSnapshotScopeStale("https://api.example.test", "company-1", { scope: "kanban", boardID: "board-A" });
    await fetchWorkspaceSnapshot("https://api.example.test", "company-1", { scope: "kanban", boardID: "board-A", maxAgeMs: 60_000 });
    await fetchWorkspaceSnapshot("https://api.example.test", "company-1", { scope: "kanban", boardID: "board-B", maxAgeMs: 60_000 });
    await fetchWorkspaceSnapshot("https://api.example.test", "company-1", { scope: "company_explorer", maxAgeMs: 60_000 });

    assert.equal(calls.length, warmedCallCount + 1);
    const refetched = new URL(calls[calls.length - 1]);
    assert.equal(refetched.searchParams.get("scope"), "kanban");
    assert.equal(refetched.searchParams.get("board_id"), "board-A");
  } finally {
    globalThis.fetch = originalFetch;
    invalidateWorkspaceSnapshot();
  }
});
