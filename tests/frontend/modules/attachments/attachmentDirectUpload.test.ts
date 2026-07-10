import test from "node:test";
import assert from "node:assert/strict";
import {
  attachmentUploadResumeStorageKey,
  uploadBrowserAttachment,
  type MangoAttachmentUploadPolicy,
} from "../../../../frontend/src/modules/attachments/attachmentDirectUpload.js";
import type {
  AttachmentRequestJSON,
  MangoAttachmentUploadResponse,
  UploadMangoAttachmentInput,
} from "../../../../frontend/src/modules/attachments/attachmentApi.js";
import { sha256HexToBase64 } from "../../../../frontend/src/modules/attachments/attachmentHash.js";

const RAW_SHA256 = "a".repeat(64);
const RAW_SHA256_BASE64 = sha256HexToBase64(RAW_SHA256);

test("single upload sends JSON metadata to Mango and raw File bytes with exact signed S3 headers", async () => {
  const file = testFile(7, "report.txt", "text/plain");
  const storage = new MemoryStorage();
  const calls: Array<{ path: string; init: Parameters<AttachmentRequestJSON>[1] }> = [];
  const xhrCaptures: XHRCapture[] = [];
  const progressStates: string[] = [];
  const request: AttachmentRequestJSON = async <T>(path: string, init?: Parameters<AttachmentRequestJSON>[1]): Promise<T> => {
    calls.push({ path, init });
    if (path === "/v1/attachments/upload-policy") return standardPolicy() as unknown as T;
    if (path === "/v1/attachments/upload-intents") {
      return singleIntent("https://s3.example.test/object?signature=secret") as T;
    }
    if (path.endsWith("/complete")) return uploadResponse(file) as unknown as T;
    throw new Error(`unexpected_request:${path}`);
  };

  const result = await uploadBrowserAttachment(request, {
    ...baseInput(file),
    onProgress: (progress) => progressStates.push(progress.state),
  }, {
    hashFile: async (_file, options) => {
      options?.onProgress?.(file.size, file.size);
      return RAW_SHA256;
    },
    xhrFactory: fakeXHRFactory([{ status: 200 }], xhrCaptures, () => {
      assert.ok(storage.values().every((value) => !value.includes("signature=secret")));
    }),
    storage,
    sleep: async () => {},
    randomUUID: () => "client-request-1",
  });

  assert.equal(result.attachment.attachment_id, "attachment-1");
  const intentCall = calls.find((call) => call.path === "/v1/attachments/upload-intents");
  assert.ok(intentCall, "expected an attachment upload intent request");
  const intentInit = intentCall!.init;
  assert.deepEqual(intentInit?.headers, {
    "X-Mango-Company-ID": "company-1",
  });
  assert.equal(intentInit?.method, "POST");
  assert.equal(intentInit?.body, undefined);
  const intentJSON = intentInit?.json as Record<string, unknown>;
  assert.equal(intentJSON.clientRequestId, "client-request-1");
  assert.equal(intentJSON.filename, "report.txt");
  assert.equal(intentJSON.sizeBytes, 7);
  assert.equal(intentJSON.sha256, RAW_SHA256);
  assert.equal(intentJSON.resourceType, "node");
  assert.equal(intentJSON.resourceId, "node-1");
  assert.equal("companyID" in intentJSON, false);
  assert.equal("company_id" in intentJSON, false);
  assert.equal("file" in intentJSON, false);

  assert.equal(xhrCaptures.length, 1);
  assert.equal(xhrCaptures[0]?.method, "PUT");
  assert.equal(xhrCaptures[0]?.body, file);
  assert.equal(xhrCaptures[0]?.withCredentials, false);
  assert.equal(xhrCaptures[0]?.timeout, 10 * 60 * 1000);
  assert.deepEqual(xhrCaptures[0]?.headers, {
    "content-type": "text/plain",
    "x-amz-checksum-sha256": RAW_SHA256_BASE64,
  });
  assert.equal("authorization" in (xhrCaptures[0]?.headers ?? {}), false);
  assert.equal("cookie" in (xhrCaptures[0]?.headers ?? {}), false);
  assert.equal("x-mango-company-id" in (xhrCaptures[0]?.headers ?? {}), false);
  assert.deepEqual(progressStates, ["preparing", "preparing", "uploading", "uploading", "uploading", "completing", "complete"]);
  assert.equal(storage.values().length, 0);
});

test("expired single PUT URL is refreshed through the idempotent intent before retry", async () => {
  const file = testFile(5, "refresh.bin");
  let createCalls = 0;
  const xhrCaptures: XHRCapture[] = [];
  const request: AttachmentRequestJSON = async <T>(path: string): Promise<T> => {
    if (path === "/v1/attachments/upload-intents") {
      createCalls += 1;
      return singleIntent(`https://s3.example.test/object?attempt=${createCalls}`) as T;
    }
    if (path.endsWith("/complete")) return uploadResponse(file) as unknown as T;
    throw new Error(`unexpected_request:${path}`);
  };

  await uploadBrowserAttachment(request, baseInput(file), {
    policy: standardPolicy(),
    hashFile: async () => RAW_SHA256,
    xhrFactory: fakeXHRFactory([{ status: 403 }, { status: 200 }], xhrCaptures),
    storage: null,
    sleep: async () => {},
    random: () => 0,
    randomUUID: () => "client-refresh",
  });

  assert.equal(createCalls, 2);
  assert.deepEqual(xhrCaptures.map((capture) => capture.url), [
    "https://s3.example.test/object?attempt=1",
    "https://s3.example.test/object?attempt=2",
  ]);
});

test("multipart resume reconciles backend state and never uploads an accepted part twice", async () => {
  const file = testFile(10, "resume.bin", "application/octet-stream", 77);
  const input = baseInput(file);
  const storage = new MemoryStorage();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  storage.setItem(attachmentUploadResumeStorageKey(input), JSON.stringify({
    version: 1,
    clientRequestId: "client-resume",
    uploadIntentId: "intent-1",
    attachmentId: "attachment-1",
    expiresAt,
    strategy: "multipart",
    partSizeBytes: 4,
    partCount: 3,
    filename: file.name,
    sizeBytes: file.size,
    lastModified: file.lastModified,
    relativePath: "",
    sha256: RAW_SHA256,
    resourceType: "node",
    resourceId: "node-1",
    informationId: "block-1",
    contentType: file.type,
    messageId: "",
    editorSurface: "node_text_block",
    relationshipKind: "file_attachment",
    sourceKind: "user_upload",
    sourceProvider: "",
    originalWidth: null,
    originalHeight: null,
  }));
  const signedPartNumbers: number[] = [];
  const xhrCaptures: XHRCapture[] = [];
  const uploadedBytes: number[] = [];
  const request: AttachmentRequestJSON = async <T>(path: string, init?: Parameters<AttachmentRequestJSON>[1]): Promise<T> => {
    if (path === "/v1/attachments/upload-intents/intent-1" && !init?.method) {
      return { uploadIntentId: "intent-1", status: "uploading", sha256: RAW_SHA256, expectedSizeBytes: 10, acceptedParts: [{ partNumber: 1, eTag: "etag-1" }] } as unknown as T;
    }
    if (path === "/v1/attachments/upload-intents") {
      return { uploadIntentId: "intent-1", attachmentId: "attachment-1", expiresAt, upload: { strategy: "multipart", partSizeBytes: 4, partCount: 3 } } as unknown as T;
    }
    if (path.endsWith("/parts")) {
      const part = ((init?.json as { parts: Array<{ partNumber: number }> }).parts[0]);
      signedPartNumbers.push(part.partNumber);
      return { parts: [{ partNumber: part.partNumber, method: "PUT", url: `https://s3.example.test/part-${part.partNumber}?secret=yes`, requiredHeaders: { "x-amz-checksum-sha256": "part-checksum-base64" } }] } as unknown as T;
    }
    if (path.endsWith("/complete")) return uploadResponse(file) as unknown as T;
    throw new Error(`unexpected_request:${path}`);
  };

  await uploadBrowserAttachment(request, {
    ...input,
    onProgress: (progress) => uploadedBytes.push(progress.bytesUploaded),
  }, {
    policy: { ...standardPolicy(), singlePutMaxBytes: 4, multipartPartBytes: 4 },
    hashFile: async () => RAW_SHA256,
    hashPart: async () => "part-checksum-base64",
    xhrFactory: fakeXHRFactory([{ status: 200 }, { status: 200 }], xhrCaptures, () => {
      assert.ok(storage.values().every((value) => !value.includes("secret=yes")));
    }),
    storage,
    sleep: async () => {},
  });

  assert.deepEqual(signedPartNumbers.sort((a, b) => a - b), [2, 3]);
  assert.deepEqual(xhrCaptures.map((capture) => (capture.body as Blob).size).sort((a, b) => a - b), [2, 4]);
  assert.equal(Math.max(...uploadedBytes), 10);
  assert.equal(storage.values().length, 0);
});

test("does not reuse stale resume metadata when an upload identity field differs", async () => {
  const file = testFile(7, "stale.txt", "text/plain", 88);
  const input = baseInput(file);
  const storage = new MemoryStorage();
  const key = attachmentUploadResumeStorageKey(input);
  storage.setItem(
    key,
    JSON.stringify({
      version: 1,
      clientRequestId: "client-old",
      uploadIntentId: "stale-intent",
      attachmentId: "stale-attachment",
      expiresAt: "2099-01-01T00:00:00Z",
      strategy: "single",
      filename: file.name,
      sizeBytes: file.size,
      lastModified: file.lastModified,
      relativePath: "",
      sha256: RAW_SHA256,
      contentType: file.type,
      resourceType: "node",
      resourceId: "node-1",
      informationId: "block-1",
      messageId: "",
      editorSurface: "node_text_block",
      relationshipKind: "inline_image",
      sourceKind: "user_upload",
      sourceProvider: "",
      originalWidth: null,
      originalHeight: null,
    }),
  );

  const paths: string[] = [];
  const request = async <T>(
    path: string,
    init: { method?: string; json?: unknown } = {},
  ): Promise<T> => {
    paths.push(path);
    if (path === "/v1/attachments/upload-intents" && init.method === "POST") {
      assert.equal(
        (init.json as { clientRequestId?: string } | undefined)?.clientRequestId,
        "client-new",
      );
      return singleIntent("https://s3.example.test/stale") as T;
    }
    if (path.endsWith("/complete") && init.method === "POST") {
      return uploadResponse(file) as T;
    }
    throw new Error(`unexpected request: ${init.method ?? "GET"} ${path}`);
  };

  await uploadBrowserAttachment(request, input, {
    policy: standardPolicy(),
    hashFile: async () => RAW_SHA256,
    xhrFactory: fakeXHRFactory([{ status: 200 }], []),
    storage,
    sleep: async () => {},
    randomUUID: () => "client-new",
  });

  assert.equal(
    paths.includes("/v1/attachments/upload-intents/stale-intent"),
    false,
  );
  assert.equal(storage.getItem(key), null);
});

test("cancel aborts the active S3 request, removes resume state, and calls the intent abort endpoint", async () => {
  const file = testFile(8, "cancel.bin");
  const controller = new AbortController();
  const storage = new MemoryStorage();
  const calls: string[] = [];
  let markRequestStarted: (() => void) | undefined;
  const requestStarted = new Promise<void>((resolve) => { markRequestStarted = resolve; });
  const states: string[] = [];
  const request: AttachmentRequestJSON = async <T>(path: string): Promise<T> => {
    calls.push(path);
    if (path === "/v1/attachments/upload-intents") return singleIntent("https://s3.example.test/hanging") as T;
    if (path === "/v1/attachments/upload-intents/intent-1") return undefined as T;
    throw new Error(`unexpected_request:${path}`);
  };
  const promise = uploadBrowserAttachment(request, {
    ...baseInput(file),
    signal: controller.signal,
    onProgress: (progress) => states.push(progress.state),
  }, {
    policy: standardPolicy(),
    hashFile: async () => RAW_SHA256,
    xhrFactory: fakeXHRFactory([{ status: 0, hang: true }], [], () => markRequestStarted?.()),
    storage,
    randomUUID: () => "client-cancel",
  });

  await requestStarted;
  controller.abort();
  await assert.rejects(promise, (cause: unknown) => cause instanceof Error && cause.name === "AbortError");

  assert.ok(calls.includes("/v1/attachments/upload-intents/intent-1"));
  assert.ok(states.includes("canceled"));
  assert.equal(storage.values().length, 0);
});

function standardPolicy(): MangoAttachmentUploadPolicy {
  return {
    directUploadEnabled: true,
    maxFileBytes: 250 * 1024 * 1024,
    singlePutMaxBytes: 64 * 1024 * 1024,
    multipartPartBytes: 16 * 1024 * 1024,
    maxConcurrentParts: 3,
    intentLifetimeSeconds: 86_400,
  };
}

function baseInput(file: File): UploadMangoAttachmentInput {
  return {
    companyID: "company-1",
    resourceType: "node",
    resourceID: "node-1",
    file,
    sourceKind: "user_upload",
    relationshipKind: "file_attachment",
    informationID: "block-1",
    editorSurface: "node_text_block",
  };
}

function testFile(size: number, name: string, type = "application/octet-stream", lastModified = 42): File {
  return Object.assign(new Blob([new Uint8Array(size)], { type }), { name, lastModified }) as unknown as File;
}

function singleIntent(url: string): unknown {
  return {
    uploadIntentId: "intent-1",
    attachmentId: "attachment-1",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    upload: {
      strategy: "single",
      method: "PUT",
      url,
      requiredHeaders: {
        "content-type": "text/plain",
        "x-amz-checksum-sha256": RAW_SHA256_BASE64,
      },
    },
  };
}

function uploadResponse(file: File): MangoAttachmentUploadResponse {
  return {
    attachment: {
      company_id: "company-1",
      attachment_id: "attachment-1",
      original_filename: file.name,
      mime_type: file.type,
      byte_size: file.size,
      sha256: RAW_SHA256,
      storage_bucket: "private",
      storage_key: "opaque",
      source_kind: "user_upload",
      created_timestamp: "2026-07-10T00:00:00Z",
    },
    resource_attachment: {
      resource_attachment_id: "link-1",
      company_id: "company-1",
      resource_type: "node",
      resource_id: "node-1",
      attachment_id: "attachment-1",
      information_id: "block-1",
      editor_surface: "node_text_block",
      relationship_kind: "file_attachment",
      created_timestamp: "2026-07-10T00:00:00Z",
    },
  };
}

class MemoryStorage {
  private readonly valuesByKey = new Map<string, string>();

  getItem(key: string): string | null {
    return this.valuesByKey.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.valuesByKey.set(key, value);
  }

  removeItem(key: string): void {
    this.valuesByKey.delete(key);
  }

  values(): string[] {
    return [...this.valuesByKey.values()];
  }
}

type XHRStep = { status: number; hang?: boolean };
type XHRCapture = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Document | XMLHttpRequestBodyInit | null;
  withCredentials: boolean;
  timeout: number;
};

function fakeXHRFactory(
  steps: XHRStep[],
  captures: XHRCapture[],
  onSend?: () => void,
): () => XMLHttpRequest {
  let index = 0;
  return () => {
    const step = steps[index] ?? { status: 500 };
    index += 1;
    const headers: Record<string, string> = {};
    const xhr = {
      upload: { onprogress: null as ((event: ProgressEvent<EventTarget>) => void) | null },
      status: 0,
      withCredentials: true,
      timeout: 0,
      onload: null as (() => void) | null,
      onerror: null as (() => void) | null,
      ontimeout: null as (() => void) | null,
      onabort: null as (() => void) | null,
      method: "",
      url: "",
      open(method: string, url: string) {
        this.method = method;
        this.url = url;
      },
      setRequestHeader(name: string, value: string) {
        headers[name.toLowerCase()] = value;
      },
      getResponseHeader(name: string) {
        return name.toLowerCase() === "etag" ? '"etag"' : null;
      },
      send(body: Document | XMLHttpRequestBodyInit | null) {
        captures.push({ method: this.method, url: this.url, headers: { ...headers }, body, withCredentials: this.withCredentials, timeout: this.timeout });
        onSend?.();
        if (step.hang) return;
        this.upload.onprogress?.({ loaded: body instanceof Blob ? body.size : 0 } as ProgressEvent<EventTarget>);
        this.status = step.status;
        this.onload?.();
      },
      abort() {
        this.onabort?.();
      },
    };
    return xhr as unknown as XMLHttpRequest;
  };
}
