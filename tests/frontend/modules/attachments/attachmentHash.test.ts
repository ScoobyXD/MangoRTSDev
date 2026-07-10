import test from "node:test";
import assert from "node:assert/strict";
import {
  hashAttachmentBlobIncrementally,
  hashAttachmentFileSHA256,
  hashAttachmentPartSHA256Base64,
} from "../../../../frontend/src/modules/attachments/attachmentHash.js";

test("raw file SHA-256 is calculated from bounded slices without whole-file arrayBuffer", async () => {
  const bytes = new Uint8Array(1_000_000);
  bytes.fill("a".charCodeAt(0));
  const source = new Blob([bytes]);
  const slices: Array<[number, number]> = [];
  const trackedBlob = {
    size: source.size,
    slice(start = 0, end = source.size) {
      slices.push([start, end]);
      return source.slice(start, end);
    },
    arrayBuffer() {
      throw new Error("whole_file_array_buffer_forbidden");
    },
  } as unknown as Blob;
  const progress: number[] = [];

  const digest = await hashAttachmentBlobIncrementally(trackedBlob, {
    chunkBytes: 64 * 1024,
    onProgress: (processed) => progress.push(processed),
  });

  assert.equal(digest, "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
  assert.ok(slices.length > 10);
  assert.ok(slices.every(([start, end]) => end - start <= 64 * 1024));
  assert.equal(progress.at(-1), bytes.length);
});

test("multipart checksum is the base64 form of the raw part SHA-256", async () => {
  assert.equal(
    await hashAttachmentPartSHA256Base64(new Blob(["abc"])),
    "ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=",
  );
});

test("file hashing honors cancellation before reading bytes", async () => {
  const controller = new AbortController();
  controller.abort();
  const file = Object.assign(new Blob(["not read"], { type: "text/plain" }), {
    name: "canceled.txt",
    lastModified: 1,
  }) as unknown as File;

  await assert.rejects(
    hashAttachmentFileSHA256(file, { signal: controller.signal, preferWorker: false }),
    (cause: unknown) => cause instanceof Error && cause.name === "AbortError",
  );
});
