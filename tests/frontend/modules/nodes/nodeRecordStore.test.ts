import test from "node:test";
import assert from "node:assert/strict";

import { clearResourceMissing, isTerminalResourceNotFoundError } from "../../../../frontend/src/modules/api/missingResources.js";
import {
  getNodeRecordSingleFlight,
  getNodeRACIAssignmentsSingleFlight,
  getNodeInformationProjectionSingleFlight,
  invalidateNodeRecordStoreCaches,
  type NodeProjectionItem,
} from "../../../../frontend/src/modules/nodes/nodeRecordStore.js";
import { getLogicGateRecordSingleFlight, invalidateLogicGateRecordStoreCaches } from "../../../../frontend/src/modules/logic-gates/logicGateRecordStore.js";
import { invalidateResourcePolicyDependentCaches } from "../../../../frontend/src/modules/permissions/resourcePolicyCaches.js";
import { logout } from "../../../../frontend/src/auth/cognitoAuth.js";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (cause: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(payload), {
    ...init,
    headers,
  });
}

function projection(information: string, updatedTimestamp: string): NodeProjectionItem {
  return {
    company_id: "company-1",
    node_id: "node-1",
    information_id: "info-1",
    type: "Text box",
    information,
    created_timestamp: "2026-06-18T01:00:00.000Z",
    updated_timestamp: updatedTimestamp,
  };
}

function nodeViewPayload(item: NodeProjectionItem, editorSequence: number) {
  return {
    node: {
      company_id: "company-1",
      node_id: "node-1",
      name: "Node",
      created_timestamp: "2026-06-18T01:00:00.000Z",
    },
    information: [],
    relationships: [],
    projections: [item],
    gvic_assignments: [{
      company_id: "company-1",
      resource_id: "node-1",
      role: "informed",
      principal_type: "user",
      principal_id: "user-1",
      user_id: "user-1",
      created_timestamp: "2026-06-18T01:00:00.000Z",
    }],
    editor_sequence: editorSequence,
  };
}

test("node invalidation rejects a stale in-flight record response before any consumer can repopulate cache", async () => {
  const apiBase = "https://api.example.test/node-record-cache";
  const staleResponse = deferred<Response>();
  const freshPayload = nodeViewPayload(projection("fresh document", "2026-06-18T01:00:02.000Z"), 2);
  const responses: Array<Promise<Response> | Response> = [
    staleResponse.promise,
    jsonResponse(freshPayload),
  ];
  const requests: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    requests.push(String(input));
    if (init?.method === "POST") return jsonResponse({ status: "anchored" });
    const next = responses.shift();
    if (!next) throw new Error("unexpected_fetch");
    return next instanceof Response ? next : await next;
  }) as typeof fetch;

  try {
    const firstRead = getNodeRecordSingleFlight(apiBase, "company-1", "node-1");
    await Promise.resolve();
    assert.equal(requests.filter((path) => path.includes("/view?")).length, 1);

    invalidateNodeRecordStoreCaches(apiBase, "company-1", "node-1");
    staleResponse.resolve(jsonResponse(nodeViewPayload(projection("stale empty document", "2026-06-18T01:00:01.000Z"), 1)));

    await assert.rejects(firstRead, (cause: unknown) => cause instanceof DOMException && cause.name === "AbortError");

    const freshItems = await getNodeInformationProjectionSingleFlight(apiBase, "company-1", "node-1");
    assert.equal(requests.filter((path) => path.includes("/view?")).length, 2);
    assert.equal(requests.filter((path) => path.includes("/changes/")).length, 0);
    assert.equal(freshItems[0]?.information, "fresh document");
  } finally {
    globalThis.fetch = originalFetch;
    invalidateNodeRecordStoreCaches(apiBase, "company-1", "node-1");
  }
});

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test("node view revalidation sends ETag, reuses the retained payload on 304, and performs no cleanup write", async () => {
  const apiBase = "https://api.example.test/node-record-etag";
  const companyID = "company-1";
  const nodeID = "node-1";
  const originalFetch = globalThis.fetch;
  const getHeaders: Headers[] = [];
  let getCalls = 0;
  let anchorCalls = 0;
  globalThis.fetch = (async (_input, init) => {
    if (init?.method === "POST") {
      anchorCalls += 1;
      return jsonResponse({ status: "anchored" });
    }
    getCalls += 1;
    getHeaders.push(new Headers(init?.headers));
    if (getCalls === 1) {
      return jsonResponse(nodeViewPayload(projection("etag document", "2026-06-18T01:00:01.000Z"), 1), { headers: { ETag: '"node-v1"' } });
    }
    return new Response(null, { status: 304, headers: { ETag: '"node-v1"' } });
  }) as typeof fetch;
  invalidateNodeRecordStoreCaches(apiBase, companyID, nodeID);
  try {
    const [first, gvicAssignments] = await Promise.all([
      getNodeInformationProjectionSingleFlight(apiBase, companyID, nodeID),
      getNodeRACIAssignmentsSingleFlight(apiBase, companyID, nodeID),
    ]);
    await flushPromises();
    assert.equal(first[0]?.information, "etag document");
    assert.equal(gvicAssignments[0]?.principal_id, "user-1");
    assert.equal(anchorCalls, 0);

    invalidateNodeRecordStoreCaches(apiBase, companyID, nodeID);
    const revalidated = await getNodeInformationProjectionSingleFlight(apiBase, companyID, nodeID);
    await flushPromises();
    assert.equal(revalidated[0]?.information, "etag document");
    assert.equal(getCalls, 2);
    assert.equal(getHeaders[0]?.get("If-None-Match"), null);
    assert.equal(getHeaders[1]?.get("If-None-Match"), '"node-v1"');
    assert.equal(anchorCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateNodeRecordStoreCaches(apiBase, companyID, nodeID);
  }
});

test("auth generation changes isolate retained node ETags and payloads", async () => {
  const apiBase = "https://api.example.test/node-record-auth";
  const companyID = "company-1";
  const nodeID = "node-1";
  const originalFetch = globalThis.fetch;
  const conditionalHeaders: Array<string | null> = [];
  let getCalls = 0;
  globalThis.fetch = (async (_input, init) => {
    if (init?.method === "POST") return jsonResponse({ status: "anchored" });
    getCalls += 1;
    conditionalHeaders.push(new Headers(init?.headers).get("If-None-Match"));
    return jsonResponse(nodeViewPayload(projection(`auth-document-${getCalls}`, "2026-06-18T01:00:01.000Z"), getCalls), { headers: { ETag: `"node-v${getCalls}"` } });
  }) as typeof fetch;
  invalidateNodeRecordStoreCaches(apiBase, companyID, nodeID);
  try {
    assert.equal((await getNodeRecordSingleFlight(apiBase, companyID, nodeID)).node.node_id, nodeID);
    logout();
    assert.equal((await getNodeInformationProjectionSingleFlight(apiBase, companyID, nodeID))[0]?.information, "auth-document-2");
    assert.deepEqual(conditionalHeaders, [null, null]);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateNodeRecordStoreCaches(apiBase, companyID, nodeID);
  }
});

test("an old-auth in-flight node view cannot repopulate the new session cache or schedule a retired write", async () => {
  const apiBase = "https://api.example.test/node-record-stale-auth";
  const companyID = "company-1";
  const nodeID = "node-1";
  const originalFetch = globalThis.fetch;
  const staleResponse = deferred<Response>();
  let getCalls = 0;
  let anchorCalls = 0;
  globalThis.fetch = (async (_input, init) => {
    if (init?.method === "POST") {
      anchorCalls += 1;
      return jsonResponse({ status: "anchored" });
    }
    getCalls += 1;
    if (getCalls === 1) return staleResponse.promise;
    return jsonResponse(nodeViewPayload(projection("new-session", "2026-06-18T01:00:02.000Z"), 2), { headers: { ETag: '"new-session"' } });
  }) as typeof fetch;
  invalidateNodeRecordStoreCaches(apiBase, companyID, nodeID);
  try {
    const staleRead = getNodeInformationProjectionSingleFlight(apiBase, companyID, nodeID);
    await Promise.resolve();
    logout();
    const newSessionRead = await getNodeInformationProjectionSingleFlight(apiBase, companyID, nodeID);
    assert.equal(newSessionRead[0]?.information, "new-session");
    staleResponse.resolve(jsonResponse(nodeViewPayload(projection("old-session", "2026-06-18T01:00:01.000Z"), 1), { headers: { ETag: '"old-session"' } }));
    await assert.rejects(staleRead, (cause: unknown) => cause instanceof DOMException && cause.name === "AbortError");
    await flushPromises();
    assert.equal((await getNodeInformationProjectionSingleFlight(apiBase, companyID, nodeID))[0]?.information, "new-session");
    assert.equal(getCalls, 2);
    assert.equal(anchorCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateNodeRecordStoreCaches(apiBase, companyID, nodeID);
  }
});

test("node view 404 is terminal for that resource until explicit clear", async () => {
  const apiBase = "https://api.example.test/node-record-404";
  const companyID = "company-1";
  const nodeID = "missing-node";
  const requests: string[] = [];
  const originalFetch = globalThis.fetch;
  clearResourceMissing({ apiBase, companyID, resourceType: "node", resourceID: nodeID });
  invalidateNodeRecordStoreCaches(apiBase, companyID, nodeID);

  globalThis.fetch = (async (input) => {
    requests.push(String(input));
    return jsonResponse({ error: "node_not_found" }, { status: 404, statusText: "Not Found" });
  }) as typeof fetch;

  try {
    await assert.rejects(
      getNodeInformationProjectionSingleFlight(apiBase, companyID, nodeID),
      (error: unknown) => isTerminalResourceNotFoundError(error),
    );
    await assert.rejects(
      getNodeInformationProjectionSingleFlight(apiBase, companyID, nodeID),
      (error: unknown) => isTerminalResourceNotFoundError(error),
    );
    assert.equal(requests.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    clearResourceMissing({ apiBase, companyID, resourceType: "node", resourceID: nodeID });
    invalidateNodeRecordStoreCaches(apiBase, companyID, nodeID);
  }
});

test("resource policy invalidation refetches cached node and logic gate descendants", async () => {
  const apiBase = "https://api.example.test/resource-policy-cache";
  const companyID = "company-1";
  const originalFetch = globalThis.fetch;
  let policyVersion = 1;
  let nodeCalls = 0;
  let logicGateCalls = 0;
  globalThis.fetch = (async (input) => {
    const path = String(input);
    if (path.includes("/v2/nodes/")) {
      nodeCalls += 1;
      return jsonResponse({
        node: {
          company_id: companyID,
          node_id: "node-policy",
          name: "Node policy " + policyVersion,
          created_timestamp: "2026-06-18T01:00:00.000Z",
        },
        information: [],
        relationships: [],
        projections: [],
        gvic_assignments: [],
      });
    }
    if (path.includes("/v2/logic-gates/")) {
      logicGateCalls += 1;
      return jsonResponse({
        logic_gate: {
          company_id: companyID,
          logic_gate_id: "gate-policy",
          header: "Gate policy " + policyVersion,
          created_timestamp: "2026-06-18T01:00:00.000Z",
        },
        information: [],
        relationships: [],
        projections: [],
      });
    }
    throw new Error("unexpected_fetch:" + path);
  }) as typeof fetch;

  invalidateNodeRecordStoreCaches(apiBase, companyID, "node-policy");
  invalidateLogicGateRecordStoreCaches(apiBase, companyID, "gate-policy");
  try {
    assert.equal((await getNodeRecordSingleFlight(apiBase, companyID, "node-policy")).node.name, "Node policy 1");
    assert.equal((await getLogicGateRecordSingleFlight(apiBase, companyID, "gate-policy")).logic_gate.header, "Gate policy 1");
    policyVersion = 2;
    assert.equal((await getNodeRecordSingleFlight(apiBase, companyID, "node-policy")).node.name, "Node policy 1");
    assert.equal((await getLogicGateRecordSingleFlight(apiBase, companyID, "gate-policy")).logic_gate.header, "Gate policy 1");
    assert.deepEqual([nodeCalls, logicGateCalls], [1, 1]);

    invalidateResourcePolicyDependentCaches(apiBase, companyID);

    assert.equal((await getNodeRecordSingleFlight(apiBase, companyID, "node-policy")).node.name, "Node policy 2");
    assert.equal((await getLogicGateRecordSingleFlight(apiBase, companyID, "gate-policy")).logic_gate.header, "Gate policy 2");
    assert.deepEqual([nodeCalls, logicGateCalls], [2, 2]);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateNodeRecordStoreCaches(apiBase, companyID, "node-policy");
    invalidateLogicGateRecordStoreCaches(apiBase, companyID, "gate-policy");
  }
});
