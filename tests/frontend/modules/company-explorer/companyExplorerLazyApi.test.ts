import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchCompanyExplorerBranchResourceIDs,
  fetchCompanyExplorerChildren,
  fetchCompanyExplorerRoots,
} from "../../../../frontend/src/modules/company-explorer/companyExplorerLazyApi.js";

test("simultaneous Explorer roots and matching children share in-flight requests", async () => {
  const apiBase = "https://explorer-dedup.test";
  const companyID = "company-dedup";
  const originalFetch = globalThis.fetch;
  const requestedPaths: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  globalThis.fetch = (async (input) => {
    requestedPaths.push(input.toString());
    await gate;
    return new Response(JSON.stringify({ rows: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const requests = [
      fetchCompanyExplorerRoots(apiBase, companyID, "all"),
      fetchCompanyExplorerRoots(apiBase, companyID, "all"),
      fetchCompanyExplorerChildren(apiBase, companyID, "all", "folder-a"),
      fetchCompanyExplorerChildren(apiBase, companyID, "all", "folder-a"),
      fetchCompanyExplorerChildren(apiBase, companyID, "all", "folder-b"),
      fetchCompanyExplorerChildren(apiBase, companyID, "all", "folder-b"),
    ];
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(requestedPaths.length, 3, "one roots request and one request per distinct parent");
    release();
    await Promise.all(requests);
  } finally {
    release();
    globalThis.fetch = originalFetch;
  }
});

test("committed creation waits for an older branch read and then reads the saved rows once", async () => {
  const originalFetch = globalThis.fetch;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  globalThis.fetch = (async () => {
    const index = calls++;
    if (index === 0) await pending;
    return Response.json({ rows: index === 0 ? [] : [{ entity_id: "saved-process", entity_type: "logic_gate" }] });
  }) as typeof fetch;
  try {
    const beforeSave = fetchCompanyExplorerChildren("https://explorer-save.test", "company", "all", "folder");
    const afterSave = fetchCompanyExplorerChildren("https://explorer-save.test", "company", "all", "folder", true);
    const sameSave = fetchCompanyExplorerChildren("https://explorer-save.test", "company", "all", "folder", true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls, 1, "no simultaneous request for the same branch");
    release();
    assert.deepEqual((await beforeSave).rows, []);
    assert.equal((await afterSave).rows?.[0].entity_id, "saved-process");
    assert.equal((await sameSave).rows?.[0].entity_id, "saved-process");
    assert.equal(calls, 2, "the post-commit readers share one fresh request");
  } finally {
    release();
    globalThis.fetch = originalFetch;
  }
});

test("explicit branch expansion collects only the requested resource type", async () => {
  const apiBase = "https://explorer-branch.test";
  const companyID = "company-branch";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const parentID = new URL(input.toString()).searchParams.get("parent_id");
    const rows = parentID === "folder-root"
      ? [
        { entity_id: "gate-1", resource_id: "gate-1", entity_type: "logic_gate", has_children: false },
        { entity_id: "folder-child", entity_type: "folder", has_children: true },
      ]
      : [
        { entity_id: "node-1", resource_id: "node-1", entity_type: "node", has_children: false },
        { entity_id: "gate-2", resource_id: "gate-2", entity_type: "logic_gate", has_children: false },
      ];
    return new Response(JSON.stringify({ rows }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    assert.deepEqual(
      await fetchCompanyExplorerBranchResourceIDs(apiBase, companyID, "folder-root", "node"),
      ["node-1"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
