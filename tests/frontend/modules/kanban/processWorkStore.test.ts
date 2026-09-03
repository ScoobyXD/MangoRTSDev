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

test("invalidation keeps visible work but rejects the older response", async () => {
  const original = globalThis.fetch; const gate = deferred(); let reads = 0;
  globalThis.fetch = async () => { reads++; if (reads === 2) await gate.promise; return json(snapshot(reads === 1 ? "Visible" : "New")); };
  try {
    await getProcessWorkSingleFlight("https://stale.test", "company-a", "process-a");
    invalidateLogicGateArenaViewCache("https://stale.test", "company-a", "process-a");
    assert.equal(getCachedProcessWork("https://stale.test", "company-a", "process-a")?.contents.logic_gate.header, "Visible");
    const pending = getProcessWorkSingleFlight("https://stale.test", "company-a", "process-a");
    invalidateLogicGateArenaViewCache("https://stale.test", "company-a", "process-a");
    gate.resolve(); await assert.rejects(pending, { name: "AbortError" });
    assert.equal(getCachedProcessWork("https://stale.test", "company-a", "process-a")?.stale, true);
    assert.equal((await getProcessWorkSingleFlight("https://stale.test", "company-a", "process-a")).logic_gate.header, "New");
  } finally { gate.resolve(); globalThis.fetch = original; clearProcessWorkCache("https://stale.test", "company-a", "process-a"); }
});
