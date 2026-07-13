import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchMangoAttachmentBlob,
  filterMangoResourceAttachments,
  groupMangoResourceAttachmentsByInformationID,
  invalidateMangoResourceAttachmentsCache,
  linkMangoResourceAttachment,
  listMangoResourceAttachments,
  mangoEmailDraftResourceID,
  mangoEmailSignatureResourceID,
  unlinkMangoResourceAttachment,
  type AttachmentRequestJSON,
  type MangoResourceAttachment,
  type MangoResourceAttachmentListResponse,
} from "../../../../frontend/src/modules/attachments/attachmentApi.js";
import { logout } from "../../../../frontend/src/auth/cognitoAuth.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function resourceAttachment(
  attachmentID: string,
  overrides: Partial<MangoResourceAttachment> = {},
): MangoResourceAttachment {
  return {
    resource_attachment_id: `link-${attachmentID}`,
    company_id: "company-1",
    resource_type: "node",
    resource_id: "node-1",
    attachment_id: attachmentID,
    information_id: "block-1",
    editor_surface: "node_text_block",
    relationship_kind: "file_attachment",
    created_timestamp: "2026-07-10T12:00:00.000Z",
    attachment: {
      company_id: "company-1",
      attachment_id: attachmentID,
      original_filename: `${attachmentID}.txt`,
      mime_type: "text/plain",
      byte_size: 42,
      sha256: `sha-${attachmentID}`,
      storage_bucket: "attachments-test",
      storage_key: `company-1/${attachmentID}`,
      source_kind: "user_upload",
      created_timestamp: "2026-07-10T12:00:00.000Z",
    },
    ...overrides,
  };
}

test("lists resource attachments through the encoded resource endpoint", async () => {
  const expected: MangoResourceAttachmentListResponse = {
    company_id: "company/id",
    resource_type: "node",
    resource_id: "node/with spaces",
    attachments: [resourceAttachment("attachment-1")],
  };
  let requestedPath = "";
  let requestedMethod = "";
  const request: AttachmentRequestJSON = async <T>(
    path: string,
    init?: Parameters<AttachmentRequestJSON>[1],
  ): Promise<T> => {
    requestedPath = path;
    requestedMethod = init?.method ?? "GET";
    return expected as unknown as T;
  };

  const result = await listMangoResourceAttachments(request, {
    companyID: "  company/id  ",
    resourceType: "node",
    resourceID: "  node/with spaces  ",
  });

  assert.equal(
    requestedPath,
    "/v1/resources/node/node%2Fwith%20spaces/attachments?company_id=company%2Fid",
  );
  assert.equal(requestedMethod, "GET");
  assert.deepEqual(result, expected);
  assert.equal(result.attachments[0]?.attachment?.original_filename, "attachment-1.txt");
});

test("links an existing attachment to the destination editor resource", async () => {
  const expected = resourceAttachment("attachment-1", {
    resource_type: "email_signature",
    resource_id: "personal:user-1:person@example.test",
    relationship_kind: "inline_image",
    editor_surface: "personal-email-signature",
  });
  let requestedPath = "";
  let requestedMethod = "";
  let requestedBody: unknown;
  const request: AttachmentRequestJSON = async <T>(
    path: string,
    init?: Parameters<AttachmentRequestJSON>[1],
  ): Promise<T> => {
    requestedPath = path;
    requestedMethod = init?.method ?? "GET";
    requestedBody = init?.json;
    return { resource_attachment: expected } as T;
  };

  const result = await linkMangoResourceAttachment(request, {
    companyID: " company-1 ",
    resourceType: "email_signature",
    resourceID: " personal:user-1:person@example.test ",
    attachmentID: " attachment-1 ",
    relationshipKind: "inline_image",
    editorSurface: " personal-email-signature ",
  });

  assert.equal(requestedPath, "/v1/resources/email_signature/personal%3Auser-1%3Aperson%40example.test/attachments");
  assert.equal(requestedMethod, "POST");
  assert.deepEqual(requestedBody, {
    company_id: "company-1",
    attachment_id: "attachment-1",
    relationship_kind: "inline_image",
    information_id: undefined,
    message_id: undefined,
    editor_surface: "personal-email-signature",
  });
  assert.equal(result, expected);
});

test("signature attachment resource IDs require a complete personal mailbox scope", () => {
  assert.equal(mangoEmailSignatureResourceID({
    userID: " user-1 ",
    accountEmail: " Person@Example.Test ",
  }), "personal:user-1:person%40example.test");
  assert.equal(mangoEmailSignatureResourceID({ userID: "user-1" }), "");
  assert.equal(mangoEmailSignatureResourceID({ accountEmail: "person@example.test" }), "");
  assert.equal(mangoEmailSignatureResourceID({ sharedInboxID: " shared-1 " }), "shared:shared-1");
});

test("draft attachment resource IDs separate personal accounts and shared inboxes", () => {
  assert.equal(mangoEmailDraftResourceID({
    draftID: " draft:1 ",
    userID: " user-1 ",
    accountEmail: " Person@Example.Test ",
  }), "personal:user-1:person%40example.test:draft%3A1");
  assert.equal(mangoEmailDraftResourceID({ draftID: "draft:1", userID: "user-1" }), "");
  assert.equal(mangoEmailDraftResourceID({
    draftID: "draft:1",
    sharedInboxID: " shared-1 ",
  }), "shared:shared-1:draft%3A1");
});

test("filters node text-block files without changing the source list", () => {
  const softDeletedAttachment = resourceAttachment("deleted-attachment");
  softDeletedAttachment.attachment = {
    ...softDeletedAttachment.attachment!,
    deleted_timestamp: "2026-07-10T13:00:00.000Z",
  };
  const items = [
    resourceAttachment("file-a", { information_id: "block-a" }),
    resourceAttachment("file-b", { information_id: "block-b" }),
    resourceAttachment("inline-image", { relationship_kind: "inline_image" }),
    resourceAttachment("chat-file", { editor_surface: "node_chat_message" }),
    resourceAttachment("email-file", { relationship_kind: "email_attachment" }),
    resourceAttachment("deleted-link", { deleted_timestamp: "2026-07-10T13:00:00.000Z" }),
    softDeletedAttachment,
    resourceAttachment("missing-metadata", { attachment: undefined }),
  ];
  const originalSnapshot = JSON.stringify(items);

  const filtered = filterMangoResourceAttachments(items, {
    relationshipKind: "file_attachment",
    editorSurface: "node_text_block",
  });

  assert.notEqual(filtered, items);
  assert.deepEqual(filtered.map((item) => item.attachment_id), ["file-a", "file-b"]);
  assert.equal(JSON.stringify(items), originalSnapshot);
});

test("groups attachments by normalized information ID and preserves item order", () => {
  const items = [
    resourceAttachment("block-a-first", { information_id: "block-a" }),
    resourceAttachment("unassigned-blank", { information_id: "   " }),
    resourceAttachment("block-a-second", { information_id: " block-a " }),
    resourceAttachment("unassigned-missing", { information_id: undefined }),
    resourceAttachment("block-b", { information_id: "block-b" }),
  ];

  const grouped = groupMangoResourceAttachmentsByInformationID(items);

  assert.deepEqual([...grouped.keys()], ["block-a", "", "block-b"]);
  assert.deepEqual(grouped.get("block-a")?.map((item) => item.attachment_id), [
    "block-a-first",
    "block-a-second",
  ]);
  assert.deepEqual(grouped.get("")?.map((item) => item.attachment_id), [
    "unassigned-blank",
    "unassigned-missing",
  ]);
  assert.deepEqual(grouped.get("block-b")?.map((item) => item.attachment_id), ["block-b"]);
});

test("resource attachment metadata coalesces StrictMode-style reads and invalidates after unlink", async () => {
  const firstLoad = deferred<MangoResourceAttachmentListResponse>();
  let listCalls = 0;
  let unlinkCalls = 0;
  const underlyingRequest: AttachmentRequestJSON = async <T>(_path: string, init?: Parameters<AttachmentRequestJSON>[1]): Promise<T> => {
    if (init?.method === "DELETE") {
      unlinkCalls += 1;
      return { status: "ok" } as T;
    }
    listCalls += 1;
    if (listCalls === 1) return firstLoad.promise as Promise<T>;
    return {
      company_id: "company-1",
      resource_type: "node",
      resource_id: "node-1",
      attachments: [resourceAttachment(`attachment-${listCalls}`)],
    } as T;
  };
  const firstOwner: AttachmentRequestJSON = (path, init) => underlyingRequest(path, init);
  const strictModeReplayOwner: AttachmentRequestJSON = (path, init) => underlyingRequest(path, init);
  const input = { apiBase: "https://api.example.test", companyID: "company-1", resourceType: "node" as const, resourceID: "node-1" };

  const first = listMangoResourceAttachments(firstOwner, input);
  const replay = listMangoResourceAttachments(strictModeReplayOwner, input);
  assert.equal(listCalls, 1);
  firstLoad.resolve({
    company_id: "company-1",
    resource_type: "node",
    resource_id: "node-1",
    attachments: [resourceAttachment("attachment-1")],
  });
  assert.deepEqual((await first).attachments.map((item) => item.attachment_id), ["attachment-1"]);
  assert.deepEqual((await replay).attachments.map((item) => item.attachment_id), ["attachment-1"]);
  assert.equal((await listMangoResourceAttachments(strictModeReplayOwner, input)).attachments[0]?.attachment_id, "attachment-1");
  assert.equal(listCalls, 1);

  await unlinkMangoResourceAttachment(firstOwner, { ...input, attachmentID: "attachment-1" });
  assert.equal(unlinkCalls, 1);
  assert.equal((await listMangoResourceAttachments(strictModeReplayOwner, input)).attachments[0]?.attachment_id, "attachment-2");
  assert.equal(listCalls, 2);
  invalidateMangoResourceAttachmentsCache(firstOwner);
});

test("resource attachment metadata failures evict the shared request", async () => {
  let calls = 0;
  const request: AttachmentRequestJSON = async <T>(): Promise<T> => {
    calls += 1;
    if (calls === 1) throw new Error("temporary_failure");
    return { company_id: "company-1", resource_type: "node", resource_id: "node-2", attachments: [] } as T;
  };
  const input = { companyID: "company-1", resourceType: "node" as const, resourceID: "node-2" };
  await assert.rejects(listMangoResourceAttachments(request, input), /temporary_failure/);
  await listMangoResourceAttachments(request, input);
  assert.equal(calls, 2);
});

test("attachment Blob requests share bytes, detach aborted consumers, and isolate auth generations", async () => {
  const originalFetch = globalThis.fetch;
  const firstResponse = deferred<Response>();
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    if (fetchCalls === 1) return firstResponse.promise;
    return new Response(new Blob([`bytes-${fetchCalls}`], { type: "image/png" }), { status: 200 });
  }) as typeof fetch;
  try {
    const controller = new AbortController();
    const abortedConsumer = fetchMangoAttachmentBlob("https://api.example.test", "company-1", "attachment-shared", "display", { signal: controller.signal });
    const survivingConsumer = fetchMangoAttachmentBlob("https://api.example.test", "company-1", "attachment-shared", "display");
    assert.equal(fetchCalls, 1);
    controller.abort();
    await assert.rejects(abortedConsumer, (cause: unknown) => cause instanceof DOMException && cause.name === "AbortError");
    firstResponse.resolve(new Response(new Blob(["shared-bytes"], { type: "image/png" }), { status: 200 }));
    assert.equal(await (await survivingConsumer).text(), "shared-bytes");
    assert.equal(await (await fetchMangoAttachmentBlob("https://api.example.test", "company-1", "attachment-shared", "display")).text(), "shared-bytes");
    assert.equal(fetchCalls, 1);

    await fetchMangoAttachmentBlob("https://api.example.test", "company-1", "attachment-original", "original");
    await fetchMangoAttachmentBlob("https://api.example.test", "company-1", "attachment-original", "original");
    assert.equal(fetchCalls, 3, "original bytes are singleflight-only and are not retained");

    logout();
    await fetchMangoAttachmentBlob("https://api.example.test", "company-1", "attachment-shared", "display");
    assert.equal(fetchCalls, 4, "a new auth generation cannot reuse prior-user bytes");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("StrictMode detach and immediate reattach preserve one shared Blob transfer", async () => {
  const originalFetch = globalThis.fetch;
  const response = deferred<Response>();
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return response.promise;
  }) as typeof fetch;
  try {
    const controller = new AbortController();
    const detached = fetchMangoAttachmentBlob("https://api.example.test", "company-1", "attachment-strict", "display", { signal: controller.signal });
    controller.abort();
    const reattached = fetchMangoAttachmentBlob("https://api.example.test", "company-1", "attachment-strict", "display");
    assert.equal(fetchCalls, 1);
    response.resolve(new Response(new Blob(["strict-bytes"], { type: "image/png" }), { status: 200 }));
    await assert.rejects(detached, (cause: unknown) => cause instanceof DOMException && cause.name === "AbortError");
    assert.equal(await (await reattached).text(), "strict-bytes");
    assert.equal(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("metadata and Blob callers reject an old auth generation after an in-flight response", async () => {
  const metadataResponse = deferred<MangoResourceAttachmentListResponse>();
  const request: AttachmentRequestJSON = async <T>() => metadataResponse.promise as Promise<T>;
  const metadataRead = listMangoResourceAttachments(request, {
    apiBase: "https://api.example.test/stale-auth",
    companyID: "company-1",
    resourceType: "node",
    resourceID: "node-stale-auth",
  });
  logout();
  metadataResponse.resolve({ company_id: "company-1", resource_type: "node", resource_id: "node-stale-auth", attachments: [] });
  await assert.rejects(metadataRead, (cause: unknown) => cause instanceof DOMException && cause.name === "AbortError");
  invalidateMangoResourceAttachmentsCache(request);

  const originalFetch = globalThis.fetch;
  const blobResponse = deferred<Response>();
  globalThis.fetch = (async () => blobResponse.promise) as typeof fetch;
  try {
    const blobRead = fetchMangoAttachmentBlob("https://api.example.test", "company-1", "attachment-stale-auth", "display");
    logout();
    blobResponse.resolve(new Response(new Blob(["old-user-bytes"], { type: "image/png" }), { status: 200 }));
    await assert.rejects(blobRead, (cause: unknown) => cause instanceof DOMException && cause.name === "AbortError");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resource attachment metadata invalidation aborts an obsolete in-flight caller", async () => {
  const firstResponse = deferred<MangoResourceAttachmentListResponse>();
  let calls = 0;
  const request: AttachmentRequestJSON = async <T>(): Promise<T> => {
    calls += 1;
    if (calls === 1) return firstResponse.promise as Promise<T>;
    return { company_id: "company-1", resource_type: "node", resource_id: "node-invalidation", attachments: [] } as T;
  };
  const input = {
    apiBase: "https://api.example.test/invalidation",
    companyID: "company-1",
    resourceType: "node" as const,
    resourceID: "node-invalidation",
  };
  const staleRead = listMangoResourceAttachments(request, input);
  invalidateMangoResourceAttachmentsCache(request, input);
  firstResponse.resolve({ company_id: "company-1", resource_type: "node", resource_id: "node-invalidation", attachments: [] });
  await assert.rejects(staleRead, (cause: unknown) => cause instanceof DOMException && cause.name === "AbortError");
  await listMangoResourceAttachments(request, input);
  assert.equal(calls, 2);
  invalidateMangoResourceAttachmentsCache(request, input);
});
