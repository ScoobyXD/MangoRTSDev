import test from "node:test";
import assert from "node:assert/strict";
import { createEditorDocumentSaveQueue } from "../../../../frontend/src/modules/editor/editorDocumentSaveQueue.js";

type SaveRequest = {
  target: string;
  text: string;
};

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.equal(predicate(), true);
}

test("document save queue retains the latest request for every target", async () => {
  const firstSave = createDeferred();
  const started: SaveRequest[] = [];
  let activeSaves = 0;
  let maxActiveSaves = 0;
  const queue = createEditorDocumentSaveQueue<SaveRequest>();
  queue.configure({
    targetKey: (request) => request.target,
    sameRequest: (left, right) => Boolean(left && right && left.target === right.target && left.text === right.text),
    persist: async (request) => {
      started.push(request);
      activeSaves += 1;
      maxActiveSaves = Math.max(maxActiveSaves, activeSaves);
      if (request.target === "A" && request.text === "A1") await firstSave.promise;
      activeSaves -= 1;
    },
  });

  queue.enqueue({ target: "A", text: "A1" });
  await waitFor(() => started.length === 1);
  queue.enqueue({ target: "A", text: "A2" });
  queue.enqueue({ target: "A", text: "A2" });
  queue.enqueue({ target: "B", text: "B1" });

  assert.deepEqual(queue.getState().queuedRequests, [
    { target: "A", text: "A2" },
    { target: "B", text: "B1" },
  ]);

  firstSave.resolve();
  await queue.waitForIdle();

  assert.deepEqual(started, [
    { target: "A", text: "A1" },
    { target: "A", text: "A2" },
    { target: "B", text: "B1" },
  ]);
  assert.equal(maxActiveSaves, 1);
  assert.equal(queue.getState().inFlight, false);
});

test("replacing a target's queued request keeps its original cross-target position", async () => {
  const firstSave = createDeferred();
  const started: SaveRequest[] = [];
  const queue = createEditorDocumentSaveQueue<SaveRequest>();
  queue.configure({
    targetKey: (request) => request.target,
    sameRequest: (left, right) => Boolean(left && right && left.target === right.target && left.text === right.text),
    persist: async (request) => {
      started.push(request);
      if (request.text === "A1") await firstSave.promise;
    },
  });

  queue.enqueue({ target: "A", text: "A1" });
  await waitFor(() => started.length === 1);
  queue.enqueue({ target: "A", text: "A2" });
  queue.enqueue({ target: "B", text: "B1" });
  queue.enqueue({ target: "A", text: "A3" });

  firstSave.resolve();
  await queue.waitForIdle();

  assert.deepEqual(started, [
    { target: "A", text: "A1" },
    { target: "A", text: "A3" },
    { target: "B", text: "B1" },
  ]);
});

test("persistence rejection stays blocked with the exact latest request until retry succeeds", async () => {
  const attempted: SaveRequest[] = [];
  let shouldFail = true;
  const queue = createEditorDocumentSaveQueue<SaveRequest>();
  queue.configure({
    targetKey: (request) => request.target,
    sameRequest: (left, right) => Boolean(left && right && left.target === right.target && left.text === right.text),
    persist: async (request) => {
      attempted.push(request);
      if (shouldFail) throw new Error("delivery failed");
    },
  });

  queue.enqueue({ target: "A", text: "draft-1" });
  await assert.rejects(() => queue.waitForIdle(), /delivery failed/);
  assert.equal(queue.getState().inFlight, false);
  assert.deepEqual(queue.getState().failedRequest, { target: "A", text: "draft-1" });

  queue.enqueue({ target: "A", text: "latest-draft" });
  assert.deepEqual(queue.getState().failedRequest, { target: "A", text: "latest-draft" });
  shouldFail = false;
  queue.retryFailed();
  await queue.waitForIdle();
  assert.deepEqual(attempted, [{ target: "A", text: "draft-1" }, { target: "A", text: "latest-draft" }]);
  assert.equal(queue.getState().failedRequest, null);
});
