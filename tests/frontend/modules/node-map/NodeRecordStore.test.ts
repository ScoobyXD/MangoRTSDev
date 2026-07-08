import test from "node:test";
import assert from "node:assert/strict";

import { clearResourceMissing, isTerminalResourceNotFoundError } from "../../../../frontend/src/modules/api/missingResources.js";
import {
  getNodeInformationProjectionSingleFlight,
  invalidateNodeRecordStoreCaches,
  type NodeProjectionItem,
} from "../../../../frontend/src/modules/node-map/NodeRecordStore.js";

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
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: { "Content-Type": "application/json" },
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
    content_changes: [],
    editor_sequence: editorSequence,
  };
}

test("node projection invalidation prevents stale in-flight view responses from repopulating cache", async () => {
  const apiBase = "https://api.example.test/node-record-cache";
  const staleResponse = deferred<Response>();
  const freshPayload = nodeViewPayload(projection("fresh document", "2026-06-18T01:00:02.000Z"), 2);
  const responses: Array<Promise<Response> | Response> = [
    staleResponse.promise,
    jsonResponse(freshPayload),
  ];
  const requests: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    requests.push(String(input));
    const next = responses.shift();
    if (!next) throw new Error("unexpected_fetch");
    return next instanceof Response ? next : await next;
  }) as typeof fetch;

  try {
    const firstRead = getNodeInformationProjectionSingleFlight(apiBase, "company-1", "node-1");
    await Promise.resolve();
    assert.equal(requests.length, 1);

    invalidateNodeRecordStoreCaches(apiBase, "company-1", "node-1");
    staleResponse.resolve(jsonResponse(nodeViewPayload(projection("stale empty document", "2026-06-18T01:00:01.000Z"), 1)));

    const staleItems = await firstRead;
    assert.equal(staleItems[0]?.information, "stale empty document");

    const freshItems = await getNodeInformationProjectionSingleFlight(apiBase, "company-1", "node-1");
    assert.equal(requests.length, 2);
    assert.equal(freshItems[0]?.information, "fresh document");
  } finally {
    globalThis.fetch = originalFetch;
    invalidateNodeRecordStoreCaches(apiBase, "company-1", "node-1");
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
