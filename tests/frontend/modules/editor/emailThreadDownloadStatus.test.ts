import assert from "node:assert/strict";
import test from "node:test";

import { resolveEmailThreadDownloadStatus } from "../../../../frontend/src/modules/editor/emailThreadDownloadStatus.js";

test("one-off email messages without a provider thread never report missing thread history", () => {
  assert.equal(resolveEmailThreadDownloadStatus("failed", false, ""), "complete");
  assert.equal(resolveEmailThreadDownloadStatus("partial", false, undefined), "complete");
  assert.equal(resolveEmailThreadDownloadStatus("downloading", false, "  "), "complete");
});

test("provider-backed threads preserve their durable download state", () => {
  assert.equal(
    resolveEmailThreadDownloadStatus("failed", false, "provider-thread-1"),
    "failed",
  );
  assert.equal(
    resolveEmailThreadDownloadStatus(undefined, false, "provider-thread-1"),
    "partial",
  );
  assert.equal(
    resolveEmailThreadDownloadStatus(undefined, true, "provider-thread-1"),
    "complete",
  );
});
