import assert from "node:assert/strict";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

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

function smallDeltaAndRecoveryChainScenario() {
  const source = new Y.Doc();
  const body = source.getText("body");
  body.insert(0, "x".repeat(1024 * 1024));
  const checkpoint = Y.encodeStateAsUpdate(source);
  const incremental = [];
  source.on("update", (update) => incremental.push(update));
  body.insert(512 * 1024, "!");

  const delta = Y.mergeUpdates(incremental);
  assert.ok(delta.byteLength < checkpoint.byteLength / 100,
    `single-character delta ${delta.byteLength}B must stay far below ${checkpoint.byteLength}B checkpoint`);

  const restored = new Y.Doc();
  Y.applyUpdate(restored, checkpoint);
  Y.applyUpdate(restored, delta);
  Y.applyUpdate(restored, delta);
  assert.equal(restored.getText("body").length, 1024 * 1024 + 1);
  assert.equal(restored.getText("body").toString().at(512 * 1024), "!");

  const omittedTail = new Y.Doc();
  Y.applyUpdate(omittedTail, checkpoint);
  assert.notDeepEqual(
    [...Y.encodeStateVector(omittedTail)],
    [...Y.encodeStateVector(restored)],
    "a checkpoint that claims to cover an omitted durable update has a different state vector",
  );
  source.destroy();
  restored.destroy();
  omittedTail.destroy();
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
  Y.applyUpdate(server, operationA);
  Y.applyUpdate(server, operationB);
  const canonical = Y.encodeStateAsUpdate(server);
  Y.applyUpdate(tabA, canonical);
  Y.applyUpdate(tabB, canonical);
  assert.equal(tabA.getText("body").toString(), tabB.getText("body").toString());
  assert.equal(tabA.getText("body").length, 9);

  const text = tabA.getText("body");
  const start = Y.createRelativePositionFromTypeIndex(text, 1, 0);
  const end = Y.createRelativePositionFromTypeIndex(text, 4, 0);
  const encodedStart = Y.encodeRelativePosition(start);
  const encodedEnd = Y.encodeRelativePosition(end);
  text.insert(0, "!");
  const movedStart = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(encodedStart), tabA);
  const movedEnd = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(encodedEnd), tabA);
  assert.equal(movedStart?.index, 2, "comment start follows an insertion before its range");
  assert.equal(movedEnd?.index, 5, "comment end follows an insertion before its range");

  tabA.destroy();
  tabB.destroy();
  server.destroy();
}

await indexedDBRecoveryScenario();
smallDeltaAndRecoveryChainScenario();
retryAndMultiTabScenario();
console.log("Node v2 Phase 2 executable durability, delta-size, recovery-chain, and anchor scenarios passed.");
