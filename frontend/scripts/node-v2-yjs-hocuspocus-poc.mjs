import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { Database } from "@hocuspocus/extension-database";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { Server } from "@hocuspocus/server";
import WebSocket from "ws";
import * as Y from "yjs";

const DOCUMENT_NAME = "node-textbox:11111111-1111-1111-1111-111111111111:22222222-2222-2222-2222-222222222222:33333333-3333-3333-3333-333333333333:44444444-4444-4444-8444-444444444444";
const AUTH_TOKEN = "node-v2-poc-authorized";
const LIVE_TEXTBOX_BYTES = Object.freeze({ p50: 205, p95: 5_716, max: 1_870_652 });

function makeRepresentativeText(targetBytes) {
  const paragraph = "Mango Node text box with lists, mentions, links, tables, comments, and attachment references.\n";
  return paragraph.repeat(Math.ceil(targetBytes / Buffer.byteLength(paragraph))).slice(0, targetBytes);
}

async function waitFor(predicate, label, timeoutMs = 8_000) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    if (predicate()) return performance.now() - started;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function benchmarkYjsCodec(label, sourceBytes) {
  const document = new Y.Doc();
  const text = document.getText("content");
  text.insert(0, makeRepresentativeText(sourceBytes));

  const checkpointStarted = performance.now();
  const checkpoint = Y.encodeStateAsUpdate(document);
  const checkpointEncodeMs = performance.now() - checkpointStarted;
  const stateVector = Y.encodeStateVector(document);

  const tail = [];
  const onUpdate = (update) => tail.push(update);
  document.on("update", onUpdate);
  for (let index = 0; index < 600; index += 1) {
    text.insert(text.length, String.fromCharCode(97 + (index % 26)));
  }
  document.off("update", onUpdate);

  const mergedTail = Y.mergeUpdates(tail);
  const expected = text.toString();
  const replayed = new Y.Doc();
  Y.applyUpdate(replayed, checkpoint);
  for (const update of [...tail].reverse()) {
    Y.applyUpdate(replayed, update);
    Y.applyUpdate(replayed, update);
  }
  assert.equal(replayed.getText("content").toString(), expected, `${label} reversed duplicate replay must converge`);

  const compactedStarted = performance.now();
  const compactedCheckpoint = Y.encodeStateAsUpdate(document);
  const compactedEncodeMs = performance.now() - compactedStarted;
  document.destroy();
  replayed.destroy();

  return {
    label,
    source_bytes: sourceBytes,
    initial_checkpoint_bytes: checkpoint.byteLength,
    state_vector_bytes: stateVector.byteLength,
    update_count: tail.length,
    update_tail_bytes: tail.reduce((total, update) => total + update.byteLength, 0),
    merged_tail_bytes: mergedTail.byteLength,
    compacted_checkpoint_bytes: compactedCheckpoint.byteLength,
    initial_checkpoint_encode_ms: Number(checkpointEncodeMs.toFixed(3)),
    compacted_checkpoint_encode_ms: Number(compactedEncodeMs.toFixed(3)),
  };
}

function createServer(durableStates, storeMetrics) {
  return new Server({
    address: "127.0.0.1",
    port: 0,
    quiet: true,
    stopOnSignals: false,
    debounce: 20,
    maxDebounce: 80,
    async onAuthenticate({ documentName, token }) {
      if (token !== AUTH_TOKEN || documentName !== DOCUMENT_NAME) {
        throw new Error("node_v2_poc_forbidden");
      }
      return { authorized: true };
    },
    extensions: [
      new Database({
        async fetch({ documentName }) {
          const state = durableStates.get(documentName);
          return state ? new Uint8Array(state) : null;
        },
        async store({ documentName, state }) {
          const copy = new Uint8Array(state);
          durableStates.set(documentName, copy);
          storeMetrics.calls += 1;
          storeMetrics.bytes += copy.byteLength;
          storeMetrics.last_bytes = copy.byteLength;
        },
      }),
    ],
  });
}

function createProvider(url, document, networkMetrics) {
  return new HocuspocusProvider({
    url,
    name: DOCUMENT_NAME,
    document,
    token: AUTH_TOKEN,
    WebSocketPolyfill: WebSocket,
    onOutgoingMessage({ message }) {
      networkMetrics.messages += 1;
      networkMetrics.bytes += message.toUint8Array().byteLength;
    },
  });
}

async function runProviderProof() {
  const initial = new Y.Doc();
  initial.getText("content").insert(0, makeRepresentativeText(LIVE_TEXTBOX_BYTES.p95));
  const durableStates = new Map([[DOCUMENT_NAME, Y.encodeStateAsUpdate(initial)]]);
  initial.destroy();

  const storeMetrics = { calls: 0, bytes: 0, last_bytes: 0 };
  let server = createServer(durableStates, storeMetrics);
  await server.listen();
  const url = `ws://127.0.0.1:${server.address.port}`;

  const documents = Array.from({ length: 6 }, () => new Y.Doc());
  const networkMetrics = Array.from({ length: 6 }, () => ({ messages: 0, bytes: 0 }));
  const providers = documents.map((document, index) => createProvider(url, document, networkMetrics[index]));
  const initialSyncMs = await waitFor(
    () => providers.every((provider) => provider.synced) && documents.every((document) => document.getText("content").length === LIVE_TEXTBOX_BYTES.p95),
    "six-provider initial synchronization",
  );

  const first = documents[0].getText("content");
  const second = documents[1].getText("content");
  first.insert(25, "[first-tab]");
  second.insert(Math.max(0, second.length - 25), "[second-tab]");
  const concurrentConvergenceMs = await waitFor(
    () => new Set(documents.map((document) => document.getText("content").toString())).size === 1,
    "six-provider concurrent convergence",
  );

  providers[2].disconnect();
  await waitFor(() => !providers[2].synced, "offline provider disconnect");
  documents[2].getText("content").insert(10, "[offline-tab]");
  documents[3].getText("content").insert(40, "[online-tab]");
  await providers[2].connect();
  const offlineReconnectMs = await waitFor(
    () => providers[2].synced && new Set(documents.map((document) => document.getText("content").toString())).size === 1,
    "offline edit replay and convergence",
  );

  const expected = documents[0].getText("content").toString();
  const storesBeforeFinalEdit = storeMetrics.calls;
  documents[4].getText("content").insert(documents[4].getText("content").length, "[durable]");
  const finalExpected = `${expected}[durable]`;
  await waitFor(
    () => documents.every((document) => document.getText("content").toString() === finalExpected),
    "final provider convergence",
  );
  await waitFor(() => storeMetrics.calls > storesBeforeFinalEdit, "debounced durable checkpoint store");

  for (const provider of providers) provider.destroy();
  for (const document of documents) document.destroy();
  await server.destroy();

  server = createServer(durableStates, storeMetrics);
  await server.listen();
  const restartDocument = new Y.Doc();
  const restartMetrics = { messages: 0, bytes: 0 };
  const restartProvider = createProvider(`ws://127.0.0.1:${server.address.port}`, restartDocument, restartMetrics);
  const restartRestoreMs = await waitFor(
    () => restartProvider.synced && restartDocument.getText("content").toString() === finalExpected,
    "server restart restore",
  );
  assert.equal(restartDocument.getText("content").toString(), finalExpected);

  restartProvider.destroy();
  restartDocument.destroy();
  await server.destroy();

  return {
    clients: 6,
    initial_sync_ms: Number(initialSyncMs.toFixed(3)),
    concurrent_convergence_ms: Number(concurrentConvergenceMs.toFixed(3)),
    offline_reconnect_convergence_ms: Number(offlineReconnectMs.toFixed(3)),
    restart_restore_ms: Number(restartRestoreMs.toFixed(3)),
    checkpoint_store_calls: storeMetrics.calls,
    checkpoint_store_bytes_total: storeMetrics.bytes,
    last_checkpoint_bytes: storeMetrics.last_bytes,
    client_messages_total: networkMetrics.reduce((total, metric) => total + metric.messages, 0) + restartMetrics.messages,
    client_bytes_total: networkMetrics.reduce((total, metric) => total + metric.bytes, 0) + restartMetrics.bytes,
  };
}

const codec = [
  benchmarkYjsCodec("live-p50", LIVE_TEXTBOX_BYTES.p50),
  benchmarkYjsCodec("live-p95", LIVE_TEXTBOX_BYTES.p95),
  benchmarkYjsCodec("live-max", LIVE_TEXTBOX_BYTES.max),
];
const provider = await runProviderProof();

process.stdout.write(`${JSON.stringify({
  measured_at: new Date().toISOString(),
  live_textbox_source_bytes: LIVE_TEXTBOX_BYTES,
  codec,
  provider,
}, null, 2)}\n`);
