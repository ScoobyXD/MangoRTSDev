import test from "node:test";
import assert from "node:assert/strict";
import {
  createTextBlockProjectionSaveController,
  type TextBlockProjectionSaveRequest,
} from "../../../../frontend/src/modules/editor/nodeTextBlockProjectionSaves.js";

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (cause?: unknown) => void;
};

function createDeferred(): Deferred {
  let resolve!: () => void;
  let reject!: (cause?: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.equal(predicate(), true);
}

test("text block projection saves do not overlap and follow up with latest content", async () => {
  const controller = createTextBlockProjectionSaveController<string>();
  const requests: TextBlockProjectionSaveRequest<string>[] = [];
  const pendingSaves: Deferred[] = [];
  let activeSaves = 0;
  let maxActiveSaves = 0;

  controller.configure({
    saveBlock: async (request) => {
      requests.push(request);
      activeSaves += 1;
      maxActiveSaves = Math.max(maxActiveSaves, activeSaves);
      const pending = createDeferred();
      pendingSaves.push(pending);
      await pending.promise;
      activeSaves -= 1;
    },
  });

  controller.replaceBlocksAsHasNotChanged([{ blockID: "block-1", content: "initial" }]);
  controller.markHasChanged("block-1", "first");
  const firstDrain = controller.saveLatestContent("block-1");

  assert.equal(requests.length, 1);
  assert.equal(requests[0].content, "first");
  assert.equal(requests[0].sentVersion, 1);
  assert.equal(maxActiveSaves, 1);

  controller.markHasChanged("block-1", "second");
  controller.markHasChanged("block-1", "latest");
  const concurrentDrain = controller.saveLatestContent("block-1");

  assert.equal(requests.length, 1);
  pendingSaves[0]?.resolve();
  await waitFor(() => requests.length === 2);

  assert.equal(requests[1].content, "latest");
  assert.equal(requests[1].sentVersion, 3);
  assert.equal(maxActiveSaves, 1);

  pendingSaves[1]?.resolve();
  await Promise.all([firstDrain, concurrentDrain]);

  const snapshot = controller.getSnapshot("block-1");
  assert.equal(activeSaves, 0);
  assert.equal(snapshot?.localVersion, 3);
  assert.equal(snapshot?.hasChanged, false);
  assert.equal(snapshot?.saveInProgress, false);
  assert.equal(snapshot?.saveNeededAfterCurrentSave, false);
});

test("serialized text block saves retain the latest full content envelope", async () => {
  type ContentEnvelope = {
    title: string;
    document: string;
    attachments: string[];
  };
  const controller = createTextBlockProjectionSaveController<ContentEnvelope>();
  const requests: TextBlockProjectionSaveRequest<ContentEnvelope>[] = [];
  const pendingSaves: Deferred[] = [];

  controller.configure({
    saveBlock: async (request) => {
      requests.push(request);
      const pending = createDeferred();
      pendingSaves.push(pending);
      await pending.promise;
    },
  });

  let latestContent: ContentEnvelope = {
    title: "Project summary",
    document: "Initial document",
    attachments: [],
  };
  controller.replaceBlocksAsHasNotChanged([{ blockID: "project-block", content: latestContent }]);

  latestContent = { ...latestContent, document: "Newest document" };
  controller.markHasChanged("project-block", latestContent);
  const firstDrain = controller.saveLatestContent("project-block");
  await waitFor(() => requests.length === 1);

  latestContent = { ...latestContent, attachments: ["attachment-1"] };
  controller.markHasChanged("project-block", latestContent);
  latestContent = { ...latestContent, title: "Renamed project summary" };
  controller.markHasChanged("project-block", latestContent);

  pendingSaves[0]?.resolve();
  await waitFor(() => requests.length === 2);

  assert.deepEqual(requests[1]?.content, {
    title: "Renamed project summary",
    document: "Newest document",
    attachments: ["attachment-1"],
  });
  assert.equal(requests[1]?.sentVersion, 3);

  pendingSaves[1]?.resolve();
  await firstDrain;
  assert.equal(controller.getSnapshot("project-block")?.hasChanged, false);
});

test("forced text block projection flush skips has not changed blocks and saves sequentially", async () => {
  const controller = createTextBlockProjectionSaveController<string>();
  const requests: TextBlockProjectionSaveRequest<string>[] = [];
  let activeSaves = 0;
  let maxActiveSaves = 0;

  controller.configure({
    saveBlock: async (request) => {
      requests.push(request);
      activeSaves += 1;
      maxActiveSaves = Math.max(maxActiveSaves, activeSaves);
      await Promise.resolve();
      activeSaves -= 1;
    },
  });

  controller.replaceBlocksAsHasNotChanged([
    { blockID: "unchanged", content: "a" },
    { blockID: "changed-1", content: "b" },
    { blockID: "changed-2", content: "c" },
  ]);
  controller.markHasChanged("changed-1", "b2");
  controller.markHasChanged("changed-2", "c2");

  await controller.flushChangedBlocks();

  assert.deepEqual(requests.map((request) => request.blockID), ["changed-1", "changed-2"]);
  assert.deepEqual(requests.map((request) => request.content), ["b2", "c2"]);
  assert.equal(activeSaves, 0);
  assert.equal(maxActiveSaves, 1);
  assert.equal(controller.getSnapshot("unchanged")?.hasChanged, false);
  assert.equal(controller.getSnapshot("changed-1")?.hasChanged, false);
  assert.equal(controller.getSnapshot("changed-2")?.hasChanged, false);
});

test("deleting a text block waits for the active save and suppresses follow-up saves", async () => {
  const controller = createTextBlockProjectionSaveController<string>();
  const requests: TextBlockProjectionSaveRequest<string>[] = [];
  const pendingSaves: Deferred[] = [];

  controller.configure({
    saveBlock: async (request) => {
      requests.push(request);
      const pending = createDeferred();
      pendingSaves.push(pending);
      await pending.promise;
    },
  });

  controller.replaceBlocksAsHasNotChanged([{ blockID: "block-1", content: "initial" }]);
  controller.markHasChanged("block-1", "first");
  const saveDrain = controller.saveLatestContent("block-1");
  await waitFor(() => requests.length === 1);

  controller.markHasChanged("block-1", "latest");
  const deleteDrain = controller.waitForInProgressSaveThenRemoveBlock("block-1");
  assert.equal(requests.length, 1);
  assert.equal(controller.getSnapshot("block-1")?.saveInProgress, true);

  pendingSaves[0]?.resolve();
  await Promise.all([saveDrain, deleteDrain]);

  assert.equal(requests.length, 1);
  assert.equal(controller.getSnapshot("block-1"), null);
});
