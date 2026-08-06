import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  markEditorHistoryChanged,
  registerEditorHistoryExitSaver,
  saveChangedEditorHistoriesForPageHide,
  saveEditorHistory,
  saveEditorHistoryOnExit,
  type EditorHistoryResourceRef,
} from "../../../../frontend/src/modules/editor/editorExitHistory.js";
import {
  flushMangoTiptapResource,
  registerMangoTiptapFlusher,
} from "../../../../frontend/src/modules/editor/tiptap/mangoTiptapFlushRegistry.js";

function resource(resourceType: EditorHistoryResourceRef["resourceType"], resourceID: string): EditorHistoryResourceRef {
  return { companyID: "company-editor-exit-history", resourceType, resourceID };
}

test("unchanged exits do not create history and one changed exit creates it once", async () => {
  const ref = resource("node", "node-changed-once");
  let saves = 0;
  const unregister = registerEditorHistoryExitSaver(ref, async () => {
    saves += 1;
  });

  await saveEditorHistoryOnExit(ref);
  assert.equal(saves, 0);

  markEditorHistoryChanged(ref);
  await Promise.all([saveEditorHistoryOnExit(ref), saveEditorHistoryOnExit(ref)]);
  assert.equal(saves, 1);
  await saveEditorHistoryOnExit(ref);
  assert.equal(saves, 1);
  unregister();
});

test("manual history and exit history share one in-flight save and one clean baseline", async () => {
  const ref = resource("logic_gate", "logic-gate-manual-dedupe");
  let releaseSave: (() => void) | undefined;
  const saveBlocked = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  let exitSaves = 0;
  let manualSaves = 0;
  const unregister = registerEditorHistoryExitSaver(ref, async () => {
    exitSaves += 1;
    await saveBlocked;
    return "exit-result";
  });

  markEditorHistoryChanged(ref);
  const exit = saveEditorHistoryOnExit(ref);
  const manual = saveEditorHistory(ref, async () => {
    manualSaves += 1;
    return "manual-result";
  });
  releaseSave?.();

  assert.equal(await exit, "exit-result");
  assert.equal(await manual, "exit-result");
  assert.equal(exitSaves, 1);
  assert.equal(manualSaves, 0);
  await saveEditorHistoryOnExit(ref);
  assert.equal(exitSaves, 1);
  unregister();
});

test("a failed exit save stays dirty and retries on the next exit", async () => {
  const ref = resource("project", "project-retry");
  let attempts = 0;
  const unregister = registerEditorHistoryExitSaver(ref, async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("offline");
  });

  markEditorHistoryChanged(ref);
  await assert.rejects(saveEditorHistoryOnExit(ref), /offline/);
  await saveEditorHistoryOnExit(ref);
  assert.equal(attempts, 2);
  unregister();
});

test("unregistering a changed resource starts its exit history save", async () => {
  const ref = resource("node", "node-unmount");
  let saves = 0;
  const unregister = registerEditorHistoryExitSaver(ref, async () => {
    saves += 1;
  });

  markEditorHistoryChanged(ref);
  unregister();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(saves, 1);
});

test("pagehide saves every registered changed resource and skips unchanged resources", async () => {
  const changed = resource("project", "project-pagehide");
  const unchanged = resource("node", "node-pagehide-unchanged");
  let changedSaves = 0;
  let unchangedSaves = 0;
  const unregisterChanged = registerEditorHistoryExitSaver(changed, async () => { changedSaves += 1; });
  const unregisterUnchanged = registerEditorHistoryExitSaver(unchanged, async () => { unchangedSaves += 1; });

  markEditorHistoryChanged(changed);
  await saveChangedEditorHistoriesForPageHide();
  assert.equal(changedSaves, 1);
  assert.equal(unchangedSaves, 0);
  unregisterChanged();
  unregisterUnchanged();
});

test("resource flush saves every mounted textbox for only the requested resource", async () => {
  const flushed: string[] = [];
  const unregisterFirst = registerMangoTiptapFlusher({
    companyID: "company-flush",
    resourceType: "node",
    resourceID: "node-a",
    documentID: "textbox-1",
  }, async () => { flushed.push("textbox-1"); });
  const unregisterSecond = registerMangoTiptapFlusher({
    companyID: "company-flush",
    resourceType: "node",
    resourceID: "node-a",
    documentID: "textbox-2",
  }, async () => { flushed.push("textbox-2"); });
  const unregisterOther = registerMangoTiptapFlusher({
    companyID: "company-flush",
    resourceType: "node",
    resourceID: "node-b",
    documentID: "textbox-other",
  }, async () => { flushed.push("textbox-other"); });

  await flushMangoTiptapResource({
    companyID: "company-flush",
    resourceType: "node",
    resourceID: "node-a",
  });
  assert.deepEqual(flushed.sort(), ["textbox-1", "textbox-2"]);
  unregisterFirst();
  unregisterSecond();
  unregisterOther();
});

test("Node, Logic Gate, and Project owners wire the shared changed-exit history path", () => {
  const editor = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/EditorContent.tsx"), "utf8");
  const node = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurface.tsx"), "utf8");
  const project = readFileSync(resolve(process.cwd(), "frontend/src/modules/project-management/ProjectSummaryContent.tsx"), "utf8");
  const tiptap = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/tiptap/MangoTiptapEditor.tsx"), "utf8");

  assert.match(tiptap, /markEditorHistoryChanged\(\{ companyID, resourceType, resourceID \}\)/);
  assert.match(editor, /registerEditorHistoryExitSaver/);
  assert.match(node, /resourceType: "node"/);
  assert.match(node, /flushPendingProjectionSaves: flushAllTextBlockProjectionSaves/);
  assert.doesNotMatch(node, /registerEditorHistoryExitSaver/);
  assert.match(project, /resourceType: "project"/);
  assert.match(project, /registerEditorHistoryExitSaver/);
});
