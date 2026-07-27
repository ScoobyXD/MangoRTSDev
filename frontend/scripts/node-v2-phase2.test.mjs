import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFile(path.join(root, relative), "utf8");

async function indexedDBRecoveryScenario() {
  const key = `node-v2-test:user:company:node:textbox:${Date.now()}`;
  const first = new Y.Doc();
  const firstPersistence = new IndexeddbPersistence(key, first);
  await firstPersistence.whenSynced;
  first.getText("recovery").insert(0, "survives refresh");
  await new Promise((resolve) => setTimeout(resolve, 20));

  const recovered = new Y.Doc();
  const recoveredPersistence = new IndexeddbPersistence(key, recovered);
  await recoveredPersistence.whenSynced;
  assert.equal(recovered.getText("recovery").toString(), "survives refresh");
  await recoveredPersistence.clearData();
  firstPersistence.destroy();
  recoveredPersistence.destroy();
  first.destroy();
  recovered.destroy();
}

function retryAndMultiTabScenario() {
  const tabA = new Y.Doc();
  const tabB = new Y.Doc();
  const server = new Y.Doc();
  const updatesA = [];
  const updatesB = [];
  tabA.on("update", (update) => updatesA.push(update));
  tabB.on("update", (update) => updatesB.push(update));
  tabA.getText("body").insert(0, "Alpha");
  tabB.getText("body").insert(0, "Beta");

  const operationA = Y.mergeUpdates(updatesA);
  const operationB = Y.mergeUpdates(updatesB);
  Y.applyUpdate(server, operationA);
  Y.applyUpdate(server, operationA); // exact idempotent retry
  Y.applyUpdate(server, operationB);
  const canonical = Y.encodeStateAsUpdate(server);
  Y.applyUpdate(tabA, canonical);
  Y.applyUpdate(tabB, canonical);
  assert.equal(tabA.getText("body").toString(), tabB.getText("body").toString());
  assert.equal(tabA.getText("body").length, 9);

  const start = Y.createRelativePositionFromTypeIndex(tabA.getText("body"), 1);
  const encoded = Y.encodeRelativePosition(start);
  tabA.getText("body").insert(0, "!");
  const resolved = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(encoded), tabA);
  assert.equal(resolved?.index, 2, "relative comment anchor follows inserted content");
}

async function sourceContractScenario() {
  const [workspace, editor, sync, api, extensions] = await Promise.all([
    read("src/modules/editor/nodeV2/NodeV2WorkspaceSurface.tsx"),
    read("src/modules/editor/nodeV2/NodeV2Editor.tsx"),
    read("src/modules/editor/nodeV2/nodeV2Sync.ts"),
    read("src/modules/editor/nodeV2/nodeV2Api.ts"),
    read("src/modules/editor/tiptap/mangoTiptapExtensions.ts"),
  ]);
  assert.match(workspace, /active && currentUserID[^]*\? <NodeV2Editor/);
  assert.match(workspace, /<VirtualStaticTextbox/);
  assert.match(workspace, /IntersectionObserver/);
  assert.match(workspace, /Load more comments/);
  assert.match(workspace, /Load message bodies/);
  assert.match(workspace, /fetchMangoAttachmentBlob[^]*"thumbnail"/);
  assert.match(workspace, /anchor_start_base64/);
  assert.match(workspace, /Legacy unanchored comment/);
  assert.doesNotMatch(editor, /onUpdate:[^\n]*getJSON/);
  assert.match(editor, /Collaboration\.configure/);
  assert.match(editor, /onFirstRender[^]*undoManager\?\.clear\(\)[^]*undoManager\?\.stopCapturing\(\)/);
  assert.match(editor, /absolutePositionToRelativePosition/);
  assert.match(sync, /IndexeddbPersistence/);
  assert.match(sync, /Y\.mergeUpdates/);
  assert.match(sync, /format: "mango-tiptap-json"[^]*schema_version: 1[^]*document: documentJSON/);
  assert.match(sync, /reason: reason === "manual_recovery" \? reason : "idle"/);
  assert.match(sync, /CHECKPOINT_UPDATE_COUNT = 512/);
  assert.match(sync, /CHECKPOINT_UPDATE_BYTES = 512 \* 1024/);
  assert.match(sync, /putPending\(pending\)[^]*sendOne\(pending\)/);
  assert.match(api, /include_body: includeBody \? 1 : 0/);
  assert.match(extensions, /undoRedo: options\.collaboration \? false/);

  const timelineSource = workspace.slice(workspace.indexOf("function timelineLabel"), workspace.indexOf("function saveLabel"));
  const timelineCases = [...timelineSource.matchAll(/case "([^"]+)": return "[^"]+";/g)].map((match) => match[1]);
  assert.deepEqual(timelineCases, ["textbox_created", "node_moved", "verification_stamp"]);
}

await indexedDBRecoveryScenario();
retryAndMultiTabScenario();
await sourceContractScenario();
console.log("Node v2 Phase 2 frontend durability and source-contract scenarios passed.");
