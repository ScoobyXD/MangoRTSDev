import assert from "node:assert/strict";
import test from "node:test";
import { clearProcessWorkCache, getCachedProcessWork, getProcessWorkSingleFlight, invalidateLogicGateArenaViewCache } from "../../../../frontend/src/modules/kanban/ProcessWorkStore.js";
import type { ProcessWorkSnapshot } from "../../../../frontend/src/modules/kanban/processWork.js";

const snapshot = (header = "Process"): ProcessWorkSnapshot => ({ logic_gate: { logic_gate_id: "process-a", header }, permissions: { can_edit: true, can_resolve_requests: true }, steps: [], relationships: [], nodes: [] });
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };

test("same Process reads share one request and callers own cloned snapshots", async () => {
  const original = globalThis.fetch; const gate = deferred(); let requests = 0;
  globalThis.fetch = async (input) => { requests++; assert.match(String(input), /\/v2\/logic-gates\/process-a\/work\?company_id=company-a$/); await gate.promise; return json(snapshot()); };
  try {
    const first = getProcessWorkSingleFlight("https://shared.test", "company-a", "process-a");
    const second = getProcessWorkSingleFlight("https://shared.test", "company-a", "process-a");
    gate.resolve(); const [a, b] = await Promise.all([first, second]);
    assert.equal(requests, 1); a.logic_gate.header = "Local mutation";
    assert.equal(b.logic_gate.header, "Process");
    assert.equal((await getProcessWorkSingleFlight("https://shared.test", "company-a", "process-a")).logic_gate.header, "Process");
    assert.equal(requests, 1);
  } finally { globalThis.fetch = original; clearProcessWorkCache("https://shared.test", "company-a", "process-a"); }
});

test("one caller abort does not cancel the other Process reader", async () => {
  const original = globalThis.fetch; const gate = deferred(); let networkSignal: AbortSignal | null | undefined;
  globalThis.fetch = async (_input, init) => { networkSignal = init?.signal; await gate.promise; return json(snapshot()); };
  const controller = new AbortController();
  try {
    const first = getProcessWorkSingleFlight("https://abort.test", "company-a", "process-a", controller.signal);
    const second = getProcessWorkSingleFlight("https://abort.test", "company-a", "process-a");
    controller.abort(); await assert.rejects(first, { name: "AbortError" });
    assert.equal(networkSignal?.aborted, false); gate.resolve(); assert.equal((await second).logic_gate.header, "Process");
  } finally { gate.resolve(); globalThis.fetch = original; clearProcessWorkCache("https://abort.test", "company-a", "process-a"); }
});

test("invalidation keeps visible work and replaces the older response with a fresh read", async () => {
  const original = globalThis.fetch; const gate = deferred(); let reads = 0;
  globalThis.fetch = async () => { const read = ++reads; if (read === 2) await gate.promise; return json(snapshot(read === 1 ? "Visible" : read === 2 ? "Obsolete" : "Fresh")); };
  try {
    await getProcessWorkSingleFlight("https://stale.test", "company-a", "process-a");
    invalidateLogicGateArenaViewCache("https://stale.test", "company-a", "process-a");
    assert.equal(getCachedProcessWork("https://stale.test", "company-a", "process-a")?.contents.logic_gate.header, "Visible");
    const pending = getProcessWorkSingleFlight("https://stale.test", "company-a", "process-a");
    invalidateLogicGateArenaViewCache("https://stale.test", "company-a", "process-a");
    gate.resolve(); assert.equal((await pending).logic_gate.header, "Fresh");
    assert.equal(reads, 3);
    assert.equal(getCachedProcessWork("https://stale.test", "company-a", "process-a")?.stale, false);
    assert.equal(getCachedProcessWork("https://stale.test", "company-a", "process-a")?.contents.logic_gate.header, "Fresh");
  } finally { gate.resolve(); globalThis.fetch = original; clearProcessWorkCache("https://stale.test", "company-a", "process-a"); }
});

test("sidebar and board share one fresh read after overlapping invalidation hints", async () => {
  const original = globalThis.fetch; const gate = deferred(); const started = deferred(); let reads = 0;
  globalThis.fetch = async () => {
    const read = ++reads;
    if (read === 2) { started.resolve(); await gate.promise; }
    return json(snapshot(read === 1 ? "Visible" : read === 2 ? "Obsolete" : "Fresh"));
  };
  try {
    await getProcessWorkSingleFlight("https://shared-refresh.test", "company-a", "process-a");
    invalidateLogicGateArenaViewCache("https://shared-refresh.test", "company-a", "process-a");
    const sidebar = getProcessWorkSingleFlight("https://shared-refresh.test", "company-a", "process-a");
    await started.promise;
    invalidateLogicGateArenaViewCache("https://shared-refresh.test", "company-a", "process-a");
    const board = getProcessWorkSingleFlight("https://shared-refresh.test", "company-a", "process-a");
    invalidateLogicGateArenaViewCache("https://shared-refresh.test", "company-a", "process-a");
    assert.equal(reads, 2);
    assert.equal(getCachedProcessWork("https://shared-refresh.test", "company-a", "process-a")?.contents.logic_gate.header, "Visible");
    gate.resolve();
    const [sidebarWork, boardWork] = await Promise.all([sidebar, board]);
    assert.equal(reads, 3);
    assert.equal(sidebarWork.logic_gate.header, "Fresh");
    assert.equal(boardWork.logic_gate.header, "Fresh");
    sidebarWork.logic_gate.header = "Local change";
    assert.equal(boardWork.logic_gate.header, "Fresh");
    assert.equal(getCachedProcessWork("https://shared-refresh.test", "company-a", "process-a")?.stale, false);
  } finally { gate.resolve(); globalThis.fetch = original; clearProcessWorkCache("https://shared-refresh.test", "company-a", "process-a"); }
});

test("a read invalidated again during its retry stops after two requests", async () => {
  const original = globalThis.fetch; let reads = 0;
  globalThis.fetch = async () => {
    reads++;
    if (reads > 2) throw new Error("A third request must not run");
    invalidateLogicGateArenaViewCache("https://bounded.test", "company-a", "process-a");
    return json(snapshot("Obsolete"));
  };
  try {
    await assert.rejects(getProcessWorkSingleFlight("https://bounded.test", "company-a", "process-a"), { name: "AbortError" });
    assert.equal(reads, 2);
    assert.equal(getCachedProcessWork("https://bounded.test", "company-a", "process-a"), null);
  } finally { globalThis.fetch = original; clearProcessWorkCache("https://bounded.test", "company-a", "process-a"); }
});

test("aborting the last caller cancels invalidated work without retrying", async () => {
  const original = globalThis.fetch; const started = deferred(); const gate = deferred(); let reads = 0; let networkSignal: AbortSignal | null | undefined;
  globalThis.fetch = async (_input, init) => { reads++; networkSignal = init?.signal; started.resolve(); await gate.promise; return json(snapshot()); };
  const controller = new AbortController();
  try {
    const pending = getProcessWorkSingleFlight("https://cancel-refresh.test", "company-a", "process-a", controller.signal);
    await started.promise;
    invalidateLogicGateArenaViewCache("https://cancel-refresh.test", "company-a", "process-a");
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    gate.resolve();
    assert.equal(networkSignal?.aborted, true);
    assert.equal(reads, 1);
    assert.equal(getCachedProcessWork("https://cancel-refresh.test", "company-a", "process-a"), null);
  } finally { gate.resolve(); globalThis.fetch = original; clearProcessWorkCache("https://cancel-refresh.test", "company-a", "process-a"); }
});

test("clearing the cache cancels an invalidated read without retrying", async () => {
  const original = globalThis.fetch; const started = deferred(); const gate = deferred(); let reads = 0; let networkSignal: AbortSignal | null | undefined;
  globalThis.fetch = async (_input, init) => { reads++; networkSignal = init?.signal; started.resolve(); await gate.promise; return json(snapshot()); };
  try {
    const pending = getProcessWorkSingleFlight("https://clear-refresh.test", "company-a", "process-a");
    await started.promise;
    invalidateLogicGateArenaViewCache("https://clear-refresh.test", "company-a", "process-a");
    clearProcessWorkCache("https://clear-refresh.test", "company-a", "process-a");
    gate.resolve();
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(networkSignal?.aborted, true);
    assert.equal(reads, 1);
    assert.equal(getCachedProcessWork("https://clear-refresh.test", "company-a", "process-a"), null);
  } finally { gate.resolve(); globalThis.fetch = original; clearProcessWorkCache("https://clear-refresh.test", "company-a", "process-a"); }
});

test("a failed network read is not retried after an invalidation hint", async () => {
  const original = globalThis.fetch; const failure = new Error("Network unavailable"); let reads = 0;
  globalThis.fetch = async () => { reads++; invalidateLogicGateArenaViewCache("https://failed-refresh.test", "company-a", "process-a"); throw failure; };
  try {
    await assert.rejects(getProcessWorkSingleFlight("https://failed-refresh.test", "company-a", "process-a"), (cause) => cause === failure);
    assert.equal(reads, 1);
    assert.equal(getCachedProcessWork("https://failed-refresh.test", "company-a", "process-a"), null);
  } finally { globalThis.fetch = original; clearProcessWorkCache("https://failed-refresh.test", "company-a", "process-a"); }
});
