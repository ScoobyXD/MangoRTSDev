import assert from "node:assert/strict";
import test from "node:test";

import {
  EDITOR_NATIVE_INPUT_IDLE_BATCH_MS,
  EDITOR_NATIVE_INPUT_MAX_BATCH_MS,
  EditorNativeInputBatcher,
  type EditorInputBatchScheduler,
} from "../../../../frontend/src/modules/editor/editorInputBatch.js";
import { snapshotEditorDocumentHTML } from "../../../../frontend/src/modules/editor/editorUndoHistory.js";

class ManualBatchScheduler implements EditorInputBatchScheduler {
  private now = 0;
  private nextID = 1;
  private readonly tasks = new Map<number, { at: number; callback: () => void }>();

  schedule = (callback: () => void, delayMs: number): unknown => {
    const id = this.nextID++;
    this.tasks.set(id, { at: this.now + delayMs, callback });
    return id;
  };

  cancel = (handle: unknown): void => {
    this.tasks.delete(Number(handle));
  };

  advance(delayMs: number): void {
    const target = this.now + delayMs;
    while (true) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
      if (!next) break;
      this.tasks.delete(next[0]);
      this.now = next[1].at;
      next[1].callback();
    }
    this.now = target;
  }
}

test("native input batching captures one before snapshot and flushes once after idle", () => {
  const scheduler = new ManualBatchScheduler();
  const root = {} as HTMLElement;
  const before = snapshotEditorDocumentHTML("before", 0, 0);
  let captures = 0;
  const flushed: string[] = [];
  const batcher = new EditorNativeInputBatcher(scheduler, (batch) => {
    flushed.push(`${batch.kind}:${batch.before?.html ?? "none"}`);
    return "after";
  });

  batcher.begin(root, "typing", () => { captures += 1; return before; });
  batcher.markChanged(root);
  scheduler.advance(80);
  batcher.begin(root, "typing", () => { captures += 1; return before; });
  batcher.markChanged(root);
  scheduler.advance(EDITOR_NATIVE_INPUT_IDLE_BATCH_MS - 1);

  assert.equal(captures, 1);
  assert.deepEqual(flushed, []);
  scheduler.advance(1);
  assert.deepEqual(flushed, ["typing:before"]);
  assert.equal(batcher.hasPendingChanges(root), false);
});

test("continuous input flushes at the bounded maximum latency", () => {
  const scheduler = new ManualBatchScheduler();
  const root = {} as HTMLElement;
  let flushes = 0;
  const batcher = new EditorNativeInputBatcher(scheduler, () => {
    flushes += 1;
    return "after";
  });

  batcher.begin(root, "typing", () => snapshotEditorDocumentHTML("before", 0, 0));
  batcher.markChanged(root);
  for (let elapsed = 100; elapsed < EDITOR_NATIVE_INPUT_MAX_BATCH_MS; elapsed += 100) {
    scheduler.advance(100);
    batcher.markChanged(root);
  }
  assert.equal(flushes, 0);
  scheduler.advance(EDITOR_NATIVE_INPUT_MAX_BATCH_MS % 100 || 100);
  assert.equal(flushes, 1);
});

test("IME composition defers timers until the composition boundary", () => {
  const scheduler = new ManualBatchScheduler();
  const root = {} as HTMLElement;
  let flushes = 0;
  const batcher = new EditorNativeInputBatcher(scheduler, () => {
    flushes += 1;
    return "after";
  });

  batcher.begin(root, "typing", () => snapshotEditorDocumentHTML("before", 0, 0));
  batcher.markChanged(root, true);
  scheduler.advance(EDITOR_NATIVE_INPUT_MAX_BATCH_MS * 2);
  assert.equal(flushes, 0);

  batcher.markChanged(root);
  scheduler.advance(EDITOR_NATIVE_INPUT_IDLE_BATCH_MS);
  assert.equal(flushes, 1);
});

test("changing edit kind flushes the completed batch before capturing the next boundary", () => {
  const scheduler = new ManualBatchScheduler();
  const root = {} as HTMLElement;
  const flushed: string[] = [];
  const batcher = new EditorNativeInputBatcher(scheduler, (batch) => {
    flushed.push(batch.kind);
    return batch.kind;
  });

  batcher.begin(root, "typing", () => snapshotEditorDocumentHTML("before typing", 0, 0));
  batcher.markChanged(root);
  batcher.begin(root, "delete", () => snapshotEditorDocumentHTML("before delete", 1, 1));

  assert.deepEqual(flushed, ["typing"]);
  assert.equal(batcher.hasPendingChanges(root), false);
  batcher.markChanged(root);
  batcher.flush(root);
  assert.deepEqual(flushed, ["typing", "delete"]);
});

test("a beforeinput without a DOM mutation does not create undo or persistence work", () => {
  const scheduler = new ManualBatchScheduler();
  const root = {} as HTMLElement;
  let flushes = 0;
  const batcher = new EditorNativeInputBatcher(scheduler, () => {
    flushes += 1;
    return "after";
  });

  batcher.begin(root, "typing", () => snapshotEditorDocumentHTML("unchanged", 0, 0));
  assert.equal(batcher.flush(root), undefined);
  assert.equal(flushes, 0);
});
