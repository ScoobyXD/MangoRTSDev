import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createNetworkServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { HocuspocusProvider } from "@hocuspocus/provider";
import { Server } from "@hocuspocus/server";
import pg from "pg";
import WebSocket from "ws";
import * as Y from "yjs";
import { yDocToProsemirrorJSON } from "@tiptap/y-tiptap";

import {
  NODE_V2_YJS_DURABLE_ACK_TYPE,
  NodeV2YjsPostgresExtension,
  NodeV2YjsPostgresStore,
  formatNodeTextboxDocumentName,
  isUpdateCoveredByStateVector,
} from "./node-v2-yjs-postgres-store.mjs";
import { createNodeV2CollaborationServer, mangoProsemirrorJSONToYDoc } from "../dist-services/node-v2-collaboration-server.mjs";

const { Pool } = pg;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendDir = resolve(scriptDir, "..");
const repositoryRoot = resolve(frontendDir, "..");
const backendDir = resolve(repositoryRoot, "backend");
const windows = process.platform === "win32";
const executableSuffix = windows ? ".exe" : "";
const postgresBin = process.env.POSTGRES_BIN || (windows ? "C:\\Program Files\\PostgreSQL\\18\\bin" : "");
const postgresTools = Object.fromEntries(["initdb", "pg_ctl", "psql"].map((name) => [
  name,
  postgresBin ? join(postgresBin, name + executableSuffix) : name,
]));

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const NODE_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEXTBOX_IDS = Object.freeze({
  provider: "33333333-3333-4333-8333-333333333333",
  p50: "44444444-4444-4444-8444-444444444444",
  production: "99999999-9999-4999-8999-999999999999",
  p95: "55555555-5555-4555-8555-555555555555",
  max: "66666666-6666-4666-8666-666666666666",
  failedUpdate: "77777777-7777-4777-8777-777777777777",
  failedCompaction: "88888888-8888-4888-8888-888888888888",
});
const LIVE_TEXTBOX_BYTES = Object.freeze({ p50: 205, p95: 5_716, max: 1_870_652 });
const AUTH_TOKEN_PREFIX = "node-v2-poc:";
const MIGRATION_COMPANY_ID = "12121212-1212-4121-8121-121212121212";
const MIGRATION_NODE_ID = "23232323-2323-4232-8232-232323232323";
const MIGRATION_PROJECT_ID = "34343434-3434-4343-8343-343434343434";
const MIGRATION_LOGIC_GATE_ID = "45454545-4545-4454-8454-454545454545";
const MIGRATION_DOCUMENT_IDS = Object.freeze({
  node: "56565656-5656-4565-8565-565656565656",
  deletedNode: "57575757-5757-4575-8575-575757575757",
  project: "67676767-6767-4676-8676-676767676767",
  logic_gate: "78787878-7878-4787-8787-787878787878",
});

function makeRepresentativeText(targetBytes) {
  const paragraph = "Mango Node text box with lists, mentions, links, tables, comments, and attachment references.\n";
  return paragraph.repeat(Math.ceil(targetBytes / Buffer.byteLength(paragraph))).slice(0, targetBytes);
}

function materializeProofDocument(document) {
  const plainText = document.getText("content").toString();
  const content = plainText.split("\n").map((text) => ({
    type: "paragraph",
    ...(text ? { content: [{ type: "text", text }] } : {}),
  }));
  return {
    documentSchemaVersion: 1,
    plainText,
    documentJson: {
      format: "mango-tiptap-json",
      schema_version: 1,
      document: { type: "doc", content },
    },
  };
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return Number(sorted[index].toFixed(3));
}

async function waitFor(predicate, label, timeoutMs = 15_000) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    if (await predicate()) return performance.now() - started;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function freePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createNetworkServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

function runPostgres(file, args, env, options = {}) {
  return execFileSync(file, args, {
    cwd: options.cwd ?? repositoryRoot,
    env,
    input: options.input,
    encoding: "utf8",
    stdio: options.stdio ?? ["pipe", "pipe", "pipe"],
    timeout: options.timeoutMs ?? 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function postgresEnvironment(port, database) {
  return {
    ...process.env,
    PGHOST: "127.0.0.1",
    PGPORT: String(port),
    PGUSER: "postgres",
    PGDATABASE: database,
    PGSSLMODE: "disable",
  };
}

function transactAndCapture(document, origin, mutate) {
  let captured;
  const onUpdate = (update, updateOrigin) => {
    if (updateOrigin === origin) captured = new Uint8Array(update);
  };
  document.on("update", onUpdate);
  document.transact(mutate, origin);
  document.off("update", onUpdate);
  assert.ok(captured?.byteLength > 0, "the local transaction must produce one Yjs update");
  return captured;
}

function assertDurableAcknowledgement(acknowledgement, update, { requireStateVectorCoverage = true } = {}) {
  assert.equal(acknowledgement.type, NODE_V2_YJS_DURABLE_ACK_TYPE);
  assert.equal(acknowledgement.update_sha256, sha256Hex(update));
  assert.ok(acknowledgement.durable_update_sequence > 0);
  const stateVector = Buffer.from(acknowledgement.state_vector_base64, "base64");
  if (requireStateVectorCoverage) {
    assert.equal(isUpdateCoveredByStateVector(update, stateVector), true, "acknowledgement vector must cover pending structs");
  }
  const snapshot = Y.decodeSnapshot(Buffer.from(acknowledgement.durable_snapshot_base64, "base64"));
  assert.equal(Y.snapshotContainsUpdate(snapshot, update), true, "acknowledgement snapshot must cover structs and delete sets");
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
  for (let index = 0; index < 600; index += 1) text.insert(text.length, String.fromCharCode(97 + (index % 26)));
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

async function seedFoundation(pool, textboxId, sourceBytes) {
  const document = new Y.Doc();
  document.getText("content").insert(0, makeRepresentativeText(sourceBytes));
  const checkpoint = Y.encodeStateAsUpdate(document);
  const stateVector = Y.encodeStateVector(document);
  const materialized = materializeProofDocument(document);
  const epoch = randomUUID();
  document.destroy();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into node_textboxes (
         company_id, node_id, textbox_id, document_json, plain_text,
         collaboration_epoch, created_by_user_id, updated_by_user_id
       ) values ($1,$2,$3,$4::jsonb,$5,$6,$7,$7)`,
      [COMPANY_ID, NODE_ID, textboxId, JSON.stringify(materialized.documentJson), materialized.plainText, epoch, ACTOR_ID],
    );
    await client.query(
      `insert into node_textbox_yjs_checkpoints (
         company_id, node_id, textbox_id, checkpoint_id, collaboration_epoch,
         through_update_sequence, checkpoint_payload, state_vector, document_json,
         plain_text, checkpoint_reason, retain_until
       ) values ($1,$2,$3,$4,$5,0,$6,$7,$8::jsonb,$9,'migration_seed',clock_timestamp() + interval '14 days')`,
      [
        COMPANY_ID,
        NODE_ID,
        textboxId,
        randomUUID(),
        epoch,
        Buffer.from(checkpoint),
        Buffer.from(stateVector),
        JSON.stringify(materialized.documentJson),
        materialized.plainText,
      ],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
function createProvider(url, documentName, clientId, document, acknowledgements, networkMetrics, token = `${AUTH_TOKEN_PREFIX}${clientId}`) {
  return new HocuspocusProvider({
    url,
    name: documentName,
    document,
    token,
    WebSocketPolyfill: WebSocket,
    onOutgoingMessage({ message }) {
      networkMetrics.messages += 1;
      networkMetrics.bytes += message.toUint8Array().byteLength;
    },
    onStateless({ payload }) {
      try {
        acknowledgements.push(JSON.parse(payload));
      } catch {
        acknowledgements.push({ type: "invalid" });
      }
    },
  });
}

function createHocuspocusServer(store, errors) {
  const extension = new NodeV2YjsPostgresExtension({
    store,
    onPersistenceError(error) {
      errors.persistence.push(error.message);
    },
    onCompactionError(error) {
      errors.compaction.push(error.message);
    },
  });
  const server = new Server({
    address: "127.0.0.1",
    port: 0,
    quiet: true,
    stopOnSignals: false,
    async onAuthenticate({ documentName, token }) {
      if (!token.startsWith(AUTH_TOKEN_PREFIX)) throw new Error("node_v2_poc_forbidden");
      const clientId = token.slice(AUTH_TOKEN_PREFIX.length);
      if (!clientId || !documentName.startsWith("node-textbox:")) throw new Error("node_v2_poc_forbidden");
      return { actorUserId: ACTOR_ID, clientId };
    },
    extensions: [extension],
  });
  return { server, extension };
}

function base64URL(value) {
  return Buffer.from(value).toString("base64url");
}

function mintProductionTicket(secret, documentName, clientId) {
  const [, companyId, nodeId, textboxId] = documentName.split(":");
  const issuedAt = Math.floor(Date.now() / 1000);
  const body = base64URL(JSON.stringify({
    v: 1,
    type: "node-v2-collaboration",
    company_id: companyId,
    node_id: nodeId,
    textbox_id: textboxId,
    user_id: ACTOR_ID,
    client_id: clientId,
    issued_at: issuedAt,
    expires_at: issuedAt + 120,
  }));
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

async function seedProductionRuntime(pool) {
  const runId = randomUUID();
  await pool.query("insert into company_memberships(company_id,user_id,role) values($1,$2,'company_admin') on conflict do nothing", [COMPANY_ID, ACTOR_ID]);
  await pool.query(
    `insert into editor_conversion_runs(conversion_run_id,company_id,owner_type,mode,status,batch_size,source_snapshot_timestamp,backup_reference,expected_count,started_timestamp,completed_timestamp)
     values($1,$2,'all','shadow_validate','completed',100,clock_timestamp(),'disposable-proof',0,clock_timestamp(),clock_timestamp())`,
    [runId, COMPANY_ID],
  );
  for (const owner of ["node", "project", "logic_gate"]) {
    await pool.query(
      `insert into editor_rollout_gates(company_id,owner_type,rollout_state,expected_count,converted_count,failed_count,shadow_mismatch_count,validation_run_id,validated_timestamp,activated_timestamp)
       values($1,$2,'active',0,0,0,0,$3,clock_timestamp(),clock_timestamp())`,
      [COMPANY_ID, owner, runId],
    );
  }
  await pool.query(
    `insert into workspace_editor_formats(company_id,editor_format,migration_state,expected_document_count,converted_document_count,validated_timestamp,cutover_timestamp)
     values($1,'tiptap_json','ready',0,0,clock_timestamp(),clock_timestamp())`,
    [COMPANY_ID],
  );

  const documentJson = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Production seed" }] }] };
  const document = mangoProsemirrorJSONToYDoc(documentJson, "default");
  const checkpoint = Y.encodeStateAsUpdate(document);
  const stateVector = Y.encodeStateVector(document);
  const epoch = randomUUID();
  await pool.query(
    `insert into node_textboxes(company_id,node_id,textbox_id,document_json,plain_text,collaboration_epoch,created_by_user_id,updated_by_user_id)
     values($1,$2,$3,$4::jsonb,'Production seed',$5,$6,$6)`,
    [COMPANY_ID, NODE_ID, TEXTBOX_IDS.production, JSON.stringify({ format: "mango-tiptap-json", schema_version: 1, document: documentJson }), epoch, ACTOR_ID],
  );
  await pool.query(
    `insert into node_textbox_yjs_checkpoints(company_id,node_id,textbox_id,checkpoint_id,collaboration_epoch,through_update_sequence,checkpoint_payload,state_vector,document_json,plain_text,checkpoint_reason,retain_until)
     values($1,$2,$3,$4,$5,0,$6,$7,$8::jsonb,'Production seed','migration_seed',clock_timestamp()+interval '14 days')`,
    [COMPANY_ID, NODE_ID, TEXTBOX_IDS.production, randomUUID(), epoch, Buffer.from(checkpoint), Buffer.from(stateVector), JSON.stringify({ format: "mango-tiptap-json", schema_version: 1, document: documentJson })],
  );
  document.destroy();
}

async function runProductionRuntimeProof(pool) {
  await seedProductionRuntime(pool);
  const secret = "node-v2-production-proof-secret-32-bytes";
  const documentName = formatNodeTextboxDocumentName({ companyId: COMPANY_ID, nodeId: NODE_ID, textboxId: TEXTBOX_IDS.production });
  let runtime = createNodeV2CollaborationServer({ pool, ticketSecret: secret, address: "127.0.0.1", port: 0, quiet: true });
  await runtime.listen();
  const document = new Y.Doc();
  const acknowledgements = [];
  const network = { messages: 0, bytes: 0 };
  const provider = createProvider(`ws://127.0.0.1:${runtime.server.address.port}`, documentName, "production-client", document, acknowledgements, network, mintProductionTicket(secret, documentName, "production-client"));
  await waitFor(() => provider.synced && JSON.stringify(yDocToProsemirrorJSON(document, "default")).includes("Production seed"), "production collaboration initial sync");

  let durableUpdate;
  const onUpdate = (update, origin) => { if (origin === "production-proof") durableUpdate = new Uint8Array(update); };
  document.on("update", onUpdate);
  document.transact(() => {
    const paragraph = new Y.XmlElement("paragraph");
    const text = new Y.XmlText();
    text.insert(0, "Production runtime edit");
    paragraph.insert(0, [text]);
    document.getXmlFragment("default").insert(document.getXmlFragment("default").length, [paragraph]);
  }, "production-proof");
  document.off("update", onUpdate);
  assert.ok(durableUpdate?.byteLength > 0);
  await waitFor(() => acknowledgements.some((ack) => ack.update_sha256 === sha256Hex(durableUpdate)), "production durable acknowledgement");
  assertDurableAcknowledgement(acknowledgements.find((ack) => ack.update_sha256 === sha256Hex(durableUpdate)), durableUpdate);

  const deleteProof = document.getMap("durable-delete-proof");
  const deleteSeedUpdate = transactAndCapture(document, "production-delete-seed", () => deleteProof.set("pending", "remove me"));
  await waitFor(() => acknowledgements.some((ack) => ack.update_sha256 === sha256Hex(deleteSeedUpdate)), "production delete seed acknowledgement");
  assertDurableAcknowledgement(acknowledgements.find((ack) => ack.update_sha256 === sha256Hex(deleteSeedUpdate)), deleteSeedUpdate);
  const deleteUpdate = transactAndCapture(document, "production-delete", () => deleteProof.delete("pending"));
  await waitFor(() => acknowledgements.some((ack) => ack.update_sha256 === sha256Hex(deleteUpdate)), "production delete acknowledgement");
  assertDurableAcknowledgement(
    acknowledgements.find((ack) => ack.update_sha256 === sha256Hex(deleteUpdate)),
    deleteUpdate,
    { requireStateVectorCoverage: false },
  );
  assert.equal(
    isUpdateCoveredByStateVector(
      deleteUpdate,
      Buffer.from(acknowledgements.find((ack) => ack.update_sha256 === sha256Hex(deleteUpdate)).state_vector_base64, "base64"),
    ),
    false,
    "the proof must exercise the delete-set gap that state vectors cannot acknowledge",
  );
  await runtime.persistence.flush();
  const materialized = await pool.query("select document_json,plain_text,latest_update_sequence,materialized_through_sequence from node_textboxes where company_id=$1 and node_id=$2 and textbox_id=$3", [COMPANY_ID, NODE_ID, TEXTBOX_IDS.production]);
  assert.match(JSON.stringify(materialized.rows[0].document_json), /Production runtime edit/);
  assert.match(materialized.rows[0].plain_text, /Production runtime edit/);
  assert.equal(Number(materialized.rows[0].latest_update_sequence), Number(materialized.rows[0].materialized_through_sequence));
  const metricsResponse = await fetch(`http://127.0.0.1:${runtime.server.address.port}/metrics`);
  assert.equal(metricsResponse.status, 200);
  const firstMetrics = await metricsResponse.json();
  assert.ok(firstMetrics.durable_updates >= 1);
  provider.destroy();
  document.destroy();
  await runtime.destroy();

  runtime = createNodeV2CollaborationServer({ pool, ticketSecret: secret, address: "127.0.0.1", port: 0, quiet: true });
  await runtime.listen();
  const restored = new Y.Doc();
  const restoredProvider = createProvider(`ws://127.0.0.1:${runtime.server.address.port}`, documentName, "restart-production-client", restored, [], { messages: 0, bytes: 0 }, mintProductionTicket(secret, documentName, "restart-production-client"));
  const restartRestoreMs = await waitFor(() => restoredProvider.synced && JSON.stringify(yDocToProsemirrorJSON(restored, "default")).includes("Production runtime edit"), "production restart restore");
  restoredProvider.destroy();
  restored.destroy();

  await pool.query("update editor_rollout_gates set rollout_state='inactive',updated_timestamp=clock_timestamp() where company_id=$1 and owner_type='node'", [COMPANY_ID]);
  const rejected = new Y.Doc();
  const rejectedProvider = createProvider(`ws://127.0.0.1:${runtime.server.address.port}`, documentName, "inactive-gate-client", rejected, [], { messages: 0, bytes: 0 }, mintProductionTicket(secret, documentName, "inactive-gate-client"));
  await waitFor(() => runtime.metrics.connections_rejected > 0, "inactive owner gate rejection");
  assert.equal(rejectedProvider.synced, false);
  rejectedProvider.destroy();
  rejected.destroy();
  const metrics = { ...runtime.metrics };
  await runtime.destroy();
  return {
    materialized_plain_text: materialized.rows[0].plain_text,
    durable_update_sequence: Number(materialized.rows[0].latest_update_sequence),
    restart_restore_ms: Number(restartRestoreMs.toFixed(3)),
    inactive_gate_rejected: metrics.connections_rejected > 0,
    durable_update_bytes: firstMetrics.durable_update_bytes,
    network,
  };
}

// createHocuspocusServer closes before the production-runtime proof helpers.


async function runProviderProof(pool, store) {
  const documentName = formatNodeTextboxDocumentName({ companyId: COMPANY_ID, nodeId: NODE_ID, textboxId: TEXTBOX_IDS.provider });
  const errors = { persistence: [], compaction: [] };
  let runtime = createHocuspocusServer(store, errors);
  await runtime.server.listen();
  const url = `ws://127.0.0.1:${runtime.server.address.port}`;
  const documents = Array.from({ length: 6 }, () => new Y.Doc());
  const acknowledgements = Array.from({ length: 6 }, () => []);
  const networkMetrics = Array.from({ length: 6 }, () => ({ messages: 0, bytes: 0 }));
  const providers = documents.map((document, index) => createProvider(
    url,
    documentName,
    `provider-${index + 1}`,
    document,
    acknowledgements[index],
    networkMetrics[index],
  ));
  const initialSyncMs = await waitFor(
    () => providers.every((provider) => provider.synced)
      && documents.every((document) => document.getText("content").length === LIVE_TEXTBOX_BYTES.p95),
    "six-provider PostgreSQL-backed initial synchronization",
  );

  const concurrentStarted = performance.now();
  const firstUpdate = transactAndCapture(
    documents[0],
    Symbol("first-tab"),
    () => documents[0].getText("content").insert(25, "[first-tab]"),
  );
  const secondUpdate = transactAndCapture(
    documents[1],
    Symbol("second-tab"),
    () => documents[1].getText("content").insert(Math.max(0, documents[1].getText("content").length - 25), "[second-tab]"),
  );
  await waitFor(
    () => acknowledgements[0].some((ack) => ack.update_sha256 === sha256Hex(firstUpdate))
      && acknowledgements[1].some((ack) => ack.update_sha256 === sha256Hex(secondUpdate))
      && new Set(documents.map((document) => document.getText("content").toString())).size === 1,
    "concurrent durable acknowledgements and convergence",
  );
  const concurrentConvergenceMs = performance.now() - concurrentStarted;
  assertDurableAcknowledgement(acknowledgements[0].find((ack) => ack.update_sha256 === sha256Hex(firstUpdate)), firstUpdate);
  assertDurableAcknowledgement(acknowledgements[1].find((ack) => ack.update_sha256 === sha256Hex(secondUpdate)), secondUpdate);

  providers[2].disconnect();
  await waitFor(() => !providers[2].synced, "offline provider disconnect");
  const offlineUpdate = transactAndCapture(
    documents[2],
    Symbol("offline-tab"),
    () => documents[2].getText("content").insert(10, "[offline-tab]"),
  );
  const onlineUpdate = transactAndCapture(
    documents[3],
    Symbol("online-tab"),
    () => documents[3].getText("content").insert(40, "[online-tab]"),
  );
  await waitFor(() => acknowledgements[3].some((ack) => ack.update_sha256 === sha256Hex(onlineUpdate)), "online durable acknowledgement");
  await providers[2].connect();
  const offlineReconnectMs = await waitFor(
    () => providers[2].synced
      && acknowledgements[2].some((ack) => ack.update_sha256 === sha256Hex(offlineUpdate))
      && new Set(documents.map((document) => document.getText("content").toString())).size === 1,
    "offline edit durable replay and convergence",
  );
  assertDurableAcknowledgement(acknowledgements[2].find((ack) => ack.update_sha256 === sha256Hex(offlineUpdate)), offlineUpdate);

  const finalUpdate = transactAndCapture(
    documents[4],
    Symbol("durable-final"),
    () => documents[4].getText("content").insert(documents[4].getText("content").length, "[durable]"),
  );
  await waitFor(
    () => acknowledgements[4].some((ack) => ack.update_sha256 === sha256Hex(finalUpdate))
      && new Set(documents.map((document) => document.getText("content").toString())).size === 1,
    "final durable convergence",
  );
  const expected = documents[0].getText("content").toString();
  const finalAck = acknowledgements[4].find((ack) => ack.update_sha256 === sha256Hex(finalUpdate));
  assertDurableAcknowledgement(finalAck, finalUpdate);

  const retryAck = await store.appendUpdate(documentName, finalUpdate, {
    updateId: randomUUID(),
    clientId: "lost-ack-retry",
    actorUserId: ACTOR_ID,
  });
  assert.equal(retryAck.duplicate, true, "a lost acknowledgement retry must deduplicate by exact Yjs update");
  assert.equal(retryAck.durable_update_sequence, finalAck.durable_update_sequence);
  assertDurableAcknowledgement(retryAck, finalUpdate);

  await runtime.extension.flush();
  for (const provider of providers) provider.destroy();
  for (const document of documents) document.destroy();
  await runtime.server.destroy();

  runtime = createHocuspocusServer(store, errors);
  await runtime.server.listen();
  const restartDocument = new Y.Doc();
  const restartAcknowledgements = [];
  const restartMetrics = { messages: 0, bytes: 0 };
  const restartProvider = createProvider(
    `ws://127.0.0.1:${runtime.server.address.port}`,
    documentName,
    "restart-provider",
    restartDocument,
    restartAcknowledgements,
    restartMetrics,
  );
  const restartRestoreMs = await waitFor(
    () => restartProvider.synced && restartDocument.getText("content").toString() === expected,
    "fresh Hocuspocus server restore from PostgreSQL checkpoint plus tail",
  );
  restartProvider.destroy();
  restartDocument.destroy();
  await runtime.server.destroy();
  assert.deepEqual(errors, { persistence: [], compaction: [] });

  const persisted = await pool.query(
    `select count(*)::integer as update_count, coalesce(sum(octet_length(update_payload)),0)::bigint as update_bytes
       from node_textbox_yjs_updates where company_id=$1 and node_id=$2 and textbox_id=$3`,
    [COMPANY_ID, NODE_ID, TEXTBOX_IDS.provider],
  );
  return {
    clients: 6,
    initial_sync_ms: Number(initialSyncMs.toFixed(3)),
    concurrent_durable_convergence_ms: Number(concurrentConvergenceMs.toFixed(3)),
    offline_reconnect_durable_convergence_ms: Number(offlineReconnectMs.toFixed(3)),
    restart_restore_ms: Number(restartRestoreMs.toFixed(3)),
    durable_updates: persisted.rows[0].update_count,
    durable_update_bytes: Number(persisted.rows[0].update_bytes),
    client_messages_total: networkMetrics.reduce((total, metric) => total + metric.messages, 0) + restartMetrics.messages,
    client_bytes_total: networkMetrics.reduce((total, metric) => total + metric.bytes, 0) + restartMetrics.bytes,
    lost_ack_retry_deduplicated: retryAck.duplicate,
  };
}

async function appendCompactionTail(pool, store, documentName, document, textboxId, updateCount, label) {
  if (updateCount <= 0) return;
  const updates = [];
  for (let index = 0; index < updateCount; index += 1) {
    updates.push(transactAndCapture(
      document,
      Symbol(`tail-${label}-${index}`),
      () => document.getText("content").insert(document.getText("content").length, String.fromCharCode(97 + (index % 26))),
    ));
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    const textbox = await client.query(
      `select collaboration_epoch from node_textboxes
        where company_id=$1 and node_id=$2 and textbox_id=$3 for update`,
      [COMPANY_ID, NODE_ID, textboxId],
    );
    const collaborationEpoch = textbox.rows[0].collaboration_epoch;
    const inserted = await client.query(
      `insert into node_textbox_yjs_updates (
         company_id,node_id,textbox_id,update_id,update_sha256,collaboration_epoch,client_id,actor_user_id,update_payload
       )
       select $1,$2,$3,batch.update_id,batch.update_sha256,$4,$5,$6,decode(batch.payload_base64,'base64')
       from unnest($7::uuid[],$8::text[],$9::text[]) with ordinality
         as batch(update_id,update_sha256,payload_base64,ordinality)
       order by batch.ordinality
       returning update_sequence`,
      [
        COMPANY_ID,
        NODE_ID,
        textboxId,
        collaborationEpoch,
        `compaction-tail-${label}`,
        ACTOR_ID,
        updates.map(() => randomUUID()),
        updates.map((update) => sha256Hex(update)),
        updates.map((update) => Buffer.from(update).toString("base64")),
      ],
    );
    const latestSequence = Math.max(...inserted.rows.map((row) => Number(row.update_sequence)));
    await client.query(
      `update node_textboxes set latest_update_sequence=$4,updated_timestamp=clock_timestamp()
        where company_id=$1 and node_id=$2 and textbox_id=$3`,
      [COMPANY_ID, NODE_ID, textboxId, latestSequence],
    );
    await client.query("commit");
    store.evictDocument(documentName);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function runLoadProfile(pool, store, label, textboxId, sourceBytes, acknowledgedUpdateCount, totalUpdateCount) {
  const documentName = formatNodeTextboxDocumentName({ companyId: COMPANY_ID, nodeId: NODE_ID, textboxId });
  const document = new Y.Doc();
  const durableAtStart = await store.loadDocument(documentName);
  Y.applyUpdate(document, durableAtStart.mergedUpdate);
  const latencies = [];
  const initialWal = (await pool.query("select pg_current_wal_lsn() as lsn")).rows[0].lsn;
  for (let index = 0; index < acknowledgedUpdateCount; index += 1) {
    const update = transactAndCapture(
      document,
      Symbol(`load-${label}-${index}`),
      () => document.getText("content").insert(document.getText("content").length, String.fromCharCode(97 + (index % 26))),
    );
    const acknowledgement = await store.appendUpdate(documentName, update, {
      clientId: `load-${label}`,
      actorUserId: ACTOR_ID,
    });
    assertDurableAcknowledgement(acknowledgement, update);
    latencies.push(acknowledgement.database_transaction_ms);
  }
  await appendCompactionTail(pool, store, documentName, document, textboxId, totalUpdateCount - acknowledgedUpdateCount, label);
  const walBytes = Number((await pool.query(
    "select pg_wal_lsn_diff(pg_current_wal_lsn(), $1)::bigint as bytes",
    [initialWal],
  )).rows[0].bytes);
  const queryPlanResult = await pool.query(
    `explain (analyze, buffers, format json)
     select update_sequence, update_payload
       from node_textbox_yjs_updates
      where company_id=$1 and node_id=$2 and textbox_id=$3
        and collaboration_epoch=(select collaboration_epoch from node_textboxes where company_id=$1 and node_id=$2 and textbox_id=$3)
        and update_sequence > 0
      order by update_sequence`,
    [COMPANY_ID, NODE_ID, textboxId],
  );
  const queryPlan = queryPlanResult.rows[0]["QUERY PLAN"][0];
  const compaction = await store.compactDocument(documentName, totalUpdateCount >= 512 ? "operation_count" : "manual_recovery");
  assert.equal(compaction.compacted, true);
  const restored = await store.loadDocument(documentName);
  const restoredDocument = new Y.Doc();
  Y.applyUpdate(restoredDocument, restored.mergedUpdate);
  assert.equal(restoredDocument.getText("content").toString(), document.getText("content").toString());
  const storageResult = await pool.query(
    `select
       count(*)::integer as update_count,
       coalesce(sum(octet_length(update_payload)),0)::bigint as update_bytes,
       count(*) filter (where checkpointed_timestamp is not null)::integer as covered_updates,
       min(retain_until - checkpointed_timestamp) filter (where checkpointed_timestamp is not null) as covered_retention
     from node_textbox_yjs_updates
     where company_id=$1 and node_id=$2 and textbox_id=$3`,
    [COMPANY_ID, NODE_ID, textboxId],
  );
  document.destroy();
  restoredDocument.destroy();
  return {
    label,
    source_bytes: sourceBytes,
    acknowledged_update_count: acknowledgedUpdateCount,
    compaction_tail_update_count: totalUpdateCount,
    update_payload_bytes: Number(storageResult.rows[0].update_bytes),
    covered_updates: storageResult.rows[0].covered_updates,
    covered_retention: storageResult.rows[0].covered_retention,
    append_transaction_ms: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: percentile(latencies, 1),
    },
    wal_bytes: walBytes,
    replay_query_planning_ms: Number(queryPlan["Planning Time"].toFixed(3)),
    replay_query_execution_ms: Number(queryPlan["Execution Time"].toFixed(3)),
    replay_query_plan: queryPlan.Plan["Node Type"],
    compaction,
  };
}

async function proveFailedUpdateIsNotAcknowledged(pool, store) {
  const documentName = formatNodeTextboxDocumentName({
    companyId: COMPANY_ID,
    nodeId: NODE_ID,
    textboxId: TEXTBOX_IDS.failedUpdate,
  });
  await pool.query(`
    create or replace function reject_node_v2_poc_update() returns trigger language plpgsql as $$
    begin
      if new.client_id = 'reject-client' then raise exception 'forced_node_v2_update_failure'; end if;
      return new;
    end $$;
    create trigger trg_reject_node_v2_poc_update before insert on node_textbox_yjs_updates
    for each row execute function reject_node_v2_poc_update()`);
  const errors = { persistence: [], compaction: [] };
  const runtime = createHocuspocusServer(store, errors);
  await runtime.server.listen();
  const document = new Y.Doc();
  const acknowledgements = [];
  const provider = createProvider(
    `ws://127.0.0.1:${runtime.server.address.port}`,
    documentName,
    "reject-client",
    document,
    acknowledgements,
    { messages: 0, bytes: 0 },
  );
  await waitFor(() => provider.synced, "failure-proof provider synchronization");
  const update = transactAndCapture(
    document,
    Symbol("rejected-update"),
    () => document.getText("content").insert(document.getText("content").length, "[must-not-ack]"),
  );
  await waitFor(() => errors.persistence.includes("forced_node_v2_update_failure"), "forced PostgreSQL update rollback");
  await runtime.extension.flush();
  assert.equal(acknowledgements.some((ack) => ack.update_sha256 === sha256Hex(update)), false);
  const stored = await pool.query(
    "select count(*)::integer as count from node_textbox_yjs_updates where company_id=$1 and node_id=$2 and textbox_id=$3",
    [COMPANY_ID, NODE_ID, TEXTBOX_IDS.failedUpdate],
  );
  assert.equal(stored.rows[0].count, 0, "failed transaction must leave no durable update");
  provider.destroy();
  document.destroy();
  await runtime.server.destroy();
  await pool.query("drop trigger trg_reject_node_v2_poc_update on node_textbox_yjs_updates; drop function reject_node_v2_poc_update()");
  return { forced_failure_observed: true, durable_ack_emitted: false, durable_rows: 0 };
}

async function proveCompactionRollback(pool, store) {
  const documentName = formatNodeTextboxDocumentName({
    companyId: COMPANY_ID,
    nodeId: NODE_ID,
    textboxId: TEXTBOX_IDS.failedCompaction,
  });
  const document = new Y.Doc();
  const durableAtStart = await store.loadDocument(documentName);
  Y.applyUpdate(document, durableAtStart.mergedUpdate);
  const update = transactAndCapture(
    document,
    Symbol("compaction-rollback"),
    () => document.getText("content").insert(document.getText("content").length, "[pending-compaction]"),
  );
  const acknowledgement = await store.appendUpdate(
    documentName,
    update,
    { clientId: "compaction-rollback", actorUserId: ACTOR_ID },
  );
  assertDurableAcknowledgement(acknowledgement, update);
  const before = (await pool.query(
    `select materialized_through_sequence, content_revision,
       (select count(*) from node_textbox_yjs_checkpoints where company_id=$1 and node_id=$2 and textbox_id=$3) as checkpoint_count
     from node_textboxes where company_id=$1 and node_id=$2 and textbox_id=$3`,
    [COMPANY_ID, NODE_ID, TEXTBOX_IDS.failedCompaction],
  )).rows[0];
  await pool.query(`
    create or replace function reject_node_v2_poc_checkpoint() returns trigger language plpgsql as $$
    begin
      if new.checkpoint_reason = 'update_bytes' then raise exception 'forced_node_v2_compaction_failure'; end if;
      return new;
    end $$;
    create trigger trg_reject_node_v2_poc_checkpoint before insert on node_textbox_yjs_checkpoints
    for each row execute function reject_node_v2_poc_checkpoint()`);
  await assert.rejects(() => store.compactDocument(documentName, "update_bytes"), /forced_node_v2_compaction_failure/);
  const after = (await pool.query(
    `select materialized_through_sequence, content_revision,
       (select count(*) from node_textbox_yjs_checkpoints where company_id=$1 and node_id=$2 and textbox_id=$3) as checkpoint_count,
       (select count(*) from node_textbox_yjs_updates where company_id=$1 and node_id=$2 and textbox_id=$3 and checkpointed_timestamp is not null) as covered_count
     from node_textboxes where company_id=$1 and node_id=$2 and textbox_id=$3`,
    [COMPANY_ID, NODE_ID, TEXTBOX_IDS.failedCompaction],
  )).rows[0];
  assert.equal(after.materialized_through_sequence, before.materialized_through_sequence);
  assert.equal(after.content_revision, before.content_revision);
  assert.equal(after.checkpoint_count, before.checkpoint_count);
  assert.equal(Number(after.covered_count), 0);
  await pool.query("drop trigger trg_reject_node_v2_poc_checkpoint on node_textbox_yjs_checkpoints; drop function reject_node_v2_poc_checkpoint()");
  const recovered = await store.compactDocument(documentName, "manual_recovery");
  assert.equal(recovered.compacted, true);
  const durableAfterRecovery = await store.loadDocument(documentName);
  const recoveredDocument = new Y.Doc();
  Y.applyUpdate(recoveredDocument, durableAfterRecovery.mergedUpdate);
  assert.equal(recoveredDocument.getText("content").toString(), document.getText("content").toString());
  recoveredDocument.destroy();
  document.destroy();
  return { forced_failure_rolled_back_atomically: true, recovered_checkpoint_sequence: recovered.through_update_sequence };
}

function runMigrationTool(port, database, arguments_, expectFailure = false, failurePattern = /current_rollback_export_does_not_cover_all_documents/) {
  const environment = {
    ...process.env,
    MANGORTS_MIGRATION_DATABASE_URL: `postgresql://postgres@127.0.0.1:${port}/${database}`,
  };
  try {
    const output = execFileSync(process.execPath, [resolve(frontendDir, "dist-services", "mango-editor-migration.mjs"), ...arguments_], {
      cwd: frontendDir,
      env: environment,
      encoding: "utf8",
      stdio: ["ignore", "pipe", expectFailure ? "pipe" : "inherit"],
    });
    if (expectFailure) throw new Error("migration command unexpectedly succeeded");
    return output;
  } catch (error) {
    if (!expectFailure) throw error;
    const diagnostic = String(error?.stderr || error?.stdout || error?.message || "");
    assert.match(diagnostic, failurePattern);
    return diagnostic;
  }
}

async function seedMigrationWorkflow(pool) {
  await pool.query("insert into companies(company_id,name) values($1,'Migration proof company')", [MIGRATION_COMPANY_ID]);
  await pool.query("insert into nodes(company_id,node_id,name,created_timestamp) values($1,$2,'Migration proof Node',clock_timestamp())", [MIGRATION_COMPANY_ID, MIGRATION_NODE_ID]);
  await pool.query("insert into projects(company_id,project_id,name) values($1,$2,'Migration proof Project')", [MIGRATION_COMPANY_ID, MIGRATION_PROJECT_ID]);
  await pool.query("insert into logic_gates(company_id,logic_gate_id,header,created_timestamp) values($1,$2,'Migration proof Logic Gate',clock_timestamp())", [MIGRATION_COMPANY_ID, MIGRATION_LOGIC_GATE_ID]);
  await pool.query(
    `insert into node_projection_table(
       company_id,node_id,information_id,type,information,is_deleted,revision,created_timestamp,updated_timestamp
     ) values
       ($1,$2,$3,'Text box',$4,false,3,clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour'),
       ($1,$2,$5,'Text box',$6,true,2,clock_timestamp()-interval '90 minutes',clock_timestamp()-interval '30 minutes')`,
    [
      MIGRATION_COMPANY_ID,
      MIGRATION_NODE_ID,
      MIGRATION_DOCUMENT_IDS.node,
      '<h2>Node source</h2><p>Exact <strong>rich text</strong> with <a href="https://example.com">link</a>.</p>',
      MIGRATION_DOCUMENT_IDS.deletedNode,
      '<p>Deleted Node source remains recoverable.</p>',
    ],
  );
  const trialDocument = {
    format: "mango-tiptap-json",
    schema_version: 1,
    document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Older trial snapshot" }] }] },
  };
  await pool.query(
    `insert into editor_json_documents(
       company_id,resource_type,resource_id,document_id,document_schema_version,revision,
       canonical_document,canonical_annotations,is_deleted
     ) values($1,'node',$2,$3,1,0,$4::jsonb,$5::jsonb,false)`,
    [
      MIGRATION_COMPANY_ID,
      MIGRATION_NODE_ID,
      MIGRATION_DOCUMENT_IDS.node,
      JSON.stringify(trialDocument),
      JSON.stringify([{ id: "trial-chat", kind: "chat", from: 1, to: 2 }]),
    ],
  );
  const fixtures = [
    ["project", MIGRATION_PROJECT_ID, MIGRATION_DOCUMENT_IDS.project, '<p>Project source</p><ul><li>One</li><li>Two</li></ul>'],
    ["logic_gate", MIGRATION_LOGIC_GATE_ID, MIGRATION_DOCUMENT_IDS.logic_gate, '<p>Logic Gate source</p><blockquote>Decision</blockquote>'],
  ];
  for (const fixture of fixtures) {
    await pool.query(
      "insert into editor_collaboration_documents(company_id,resource_type,resource_id,document_id,canonical_html) values($1,$2,$3,$4,$5)",
      [MIGRATION_COMPANY_ID, ...fixture],
    );
  }
}

async function runMigrationWorkflowProof(pool, port, database) {
  await seedMigrationWorkflow(pool);
  const conversionRun = "89898989-8989-4898-8989-898989898989";
  const common = ["--company", MIGRATION_COMPANY_ID, "--owner", "all", "--run-id", conversionRun];
  const inventoryOutput = runMigrationTool(port, database, [
    "--mode", "inventory", "--company", MIGRATION_COMPANY_ID, "--owner", "node", "--run-id", conversionRun,
  ]);
  const inventory = JSON.parse(inventoryOutput.trim());
  assert.equal(inventory.expected_count, 2);
  assert.equal(inventory.active_count, 1);
  assert.equal(inventory.deleted_count, 1);
  assert.equal(inventory.per_node_totals.length, 1);
  assert.equal(inventory.per_node_totals[0].total_count, 2);
  const dryRunOutput = runMigrationTool(port, database, ["--mode", "dry-run", ...common]);
  assert.match(dryRunOutput, /"processed":4/);
  const before = await pool.query("select count(*)::integer as count from node_textboxes where company_id=$1", [MIGRATION_COMPANY_ID]);
  assert.equal(before.rows[0].count, 0, "dry-run must not write targets");
  const legacyBefore = await pool.query(
    "select information_id::text,information,is_deleted from node_projection_table where company_id=$1 and type='Text box' order by information_id",
    [MIGRATION_COMPANY_ID],
  );

  const writeSafety = ["--allow-write", "--backup-reference", "disposable-proof"];
  await pool.query(`
    create function reject_deleted_migration_checkpoint() returns trigger language plpgsql as $$
    begin
      if new.textbox_id='${MIGRATION_DOCUMENT_IDS.deletedNode}'::uuid then
        raise exception 'forced_deleted_migration_checkpoint_failure';
      end if;
      return new;
    end $$;
    create trigger trg_reject_deleted_migration_checkpoint
      before insert on node_textbox_yjs_checkpoints
      for each row execute function reject_deleted_migration_checkpoint()`);
  runMigrationTool(
    port,
    database,
    ["--mode", "backfill", ...common, ...writeSafety, "--confirm", `BACKFILL ${MIGRATION_COMPANY_ID}`],
    true,
    /forced_deleted_migration_checkpoint_failure/,
  );
  const failedDeletedTarget = await pool.query(
    `select
       (select count(*)::integer from editor_json_documents where company_id=$1 and resource_type='node' and document_id=$2) as transitional,
       (select count(*)::integer from node_textboxes where company_id=$1 and textbox_id=$2::uuid) as permanent,
       (select count(*)::integer from node_textbox_yjs_checkpoints where company_id=$1 and textbox_id=$2::uuid) as checkpoints`,
    [MIGRATION_COMPANY_ID, MIGRATION_DOCUMENT_IDS.deletedNode],
  );
  assert.deepEqual(failedDeletedTarget.rows[0], { transitional: 0, permanent: 0, checkpoints: 0 });
  await pool.query("drop trigger trg_reject_deleted_migration_checkpoint on node_textbox_yjs_checkpoints; drop function reject_deleted_migration_checkpoint()");
  runMigrationTool(port, database, ["--mode", "backfill", ...common, ...writeSafety, "--confirm", `BACKFILL ${MIGRATION_COMPANY_ID}`]);
  const ledger = await pool.query(
    "select count(*)::integer as items,min(retry_count)::integer as min_retries,count(*) filter(where source_html_snapshot <> '')::integer as snapshots from editor_conversion_items where conversion_run_id=$1",
    [conversionRun],
  );
  assert.deepEqual(ledger.rows[0], { items: 4, min_retries: 1, snapshots: 4 });
  const nodeTargets = await pool.query(
    `select
       (select count(*)::integer from node_textboxes where company_id=$1) as permanent,
       (select count(*) filter(where deleted_timestamp is not null)::integer from node_textboxes where company_id=$1) as permanent_deleted,
       (select count(*)::integer from editor_json_documents where company_id=$1 and resource_type='node') as transitional,
       (select count(*) filter(where is_deleted)::integer from editor_json_documents where company_id=$1 and resource_type='node') as transitional_deleted,
       (select jsonb_array_length(canonical_annotations)::integer from editor_json_documents where company_id=$1 and resource_type='node' and document_id=$2) as preserved_annotations,
       (select count(*)::integer from node_textbox_yjs_checkpoints where company_id=$1 and checkpoint_reason='migration_seed') as checkpoints`,
    [MIGRATION_COMPANY_ID, MIGRATION_DOCUMENT_IDS.node],
  );
  assert.deepEqual(nodeTargets.rows[0], {
    permanent: 2,
    permanent_deleted: 1,
    transitional: 2,
    transitional_deleted: 1,
    preserved_annotations: 1,
    checkpoints: 2,
  });
  const legacyAfter = await pool.query(
    "select information_id::text,information,is_deleted from node_projection_table where company_id=$1 and type='Text box' order by information_id",
    [MIGRATION_COMPANY_ID],
  );
  assert.deepEqual(legacyAfter.rows, legacyBefore.rows, "backfill must not alter projection HTML or deletion state");

  runMigrationTool(port, database, ["--mode", "shadow", ...common, ...writeSafety, "--confirm", `SHADOW ${MIGRATION_COMPANY_ID}`]);
  const comparisons = await pool.query("select count(*)::integer as count,count(*) filter(where equivalent)::integer as equivalent from editor_shadow_comparisons where conversion_run_id=$1", [conversionRun]);
  assert.deepEqual(comparisons.rows[0], { count: 4, equivalent: 4 });
  runMigrationTool(port, database, ["--mode", "readiness", ...common, "--allow-write", "--confirm", `VALIDATE ${MIGRATION_COMPANY_ID}`]);
  await pool.query(
    "update editor_collaboration_documents set canonical_html=canonical_html || '<p>drift</p>' where company_id=$1 and resource_type='project' and resource_id=$2 and document_id=$3",
    [MIGRATION_COMPANY_ID, MIGRATION_PROJECT_ID, MIGRATION_DOCUMENT_IDS.project],
  );
  runMigrationTool(
    port,
    database,
    ["--mode", "activate", ...common, ...writeSafety, "--confirm", "ACTIVATE " + MIGRATION_COMPANY_ID],
    true,
    /legacy_source_changed_after_validation/,
  );
  await pool.query(
    "update editor_collaboration_documents set canonical_html=$1 where company_id=$2 and resource_type='project' and resource_id=$3 and document_id=$4",
    ['<p>Project source</p><ul><li>One</li><li>Two</li></ul>', MIGRATION_COMPANY_ID, MIGRATION_PROJECT_ID, MIGRATION_DOCUMENT_IDS.project],
  );
  runMigrationTool(port, database, ["--mode", "activate", ...common, ...writeSafety, "--confirm", "ACTIVATE " + MIGRATION_COMPANY_ID]);
  const active = await pool.query("select editor_format,migration_state,(select count(*) from editor_rollout_gates where company_id=$1 and rollout_state='active')::integer as active_gates from workspace_editor_formats where company_id=$1", [MIGRATION_COMPANY_ID]);
  assert.deepEqual(active.rows[0], { editor_format: "tiptap_json", migration_state: "ready", active_gates: 3 });

  const nativeDocumentID = "79797979-7979-4797-8797-797979797979";
  const nativeDocument = { format: "mango-tiptap-json", schema_version: 1, document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Created after cutover" }] }] } };
  await pool.query(
    "insert into project_editor_documents(company_id,project_id,document_id,document_schema_version,revision,document_json,plain_text) values($1,$2,$3,1,1,$4::jsonb,$5)",
    [MIGRATION_COMPANY_ID, MIGRATION_PROJECT_ID, nativeDocumentID, JSON.stringify(nativeDocument), "Created after cutover"],
  );
  await pool.query(
    "update logic_gate_editor_documents set is_deleted=true,revision=revision+1,updated_timestamp=clock_timestamp() where company_id=$1 and logic_gate_id=$2 and document_id=$3",
    [MIGRATION_COMPANY_ID, MIGRATION_LOGIC_GATE_ID, MIGRATION_DOCUMENT_IDS.logic_gate],
  );


  const updateProject = async (text) => {
    const document = { format: "mango-tiptap-json", schema_version: 1, document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] } };
    await pool.query("update project_editor_documents set document_json=$1::jsonb,plain_text=$2,revision=revision+1,updated_timestamp=clock_timestamp() where company_id=$3 and project_id=$4 and document_id=$5", [JSON.stringify(document), text, MIGRATION_COMPANY_ID, MIGRATION_PROJECT_ID, MIGRATION_DOCUMENT_IDS.project]);
  };
  await updateProject("First post-cutover edit");
  const firstExportRun = "90909090-9090-4909-8909-909090909090";
  runMigrationTool(port, database, ["--mode", "rollback-export", "--company", MIGRATION_COMPANY_ID, "--owner", "all", "--run-id", firstExportRun, ...writeSafety, "--confirm", `EXPORT ${MIGRATION_COMPANY_ID}`]);
  await updateProject("Newest post-cutover edit survives rollback");
  runMigrationTool(port, database, ["--mode", "rollback", "--company", MIGRATION_COMPANY_ID, "--owner", "all", "--run-id", firstExportRun, ...writeSafety, "--confirm", `ROLLBACK ${MIGRATION_COMPANY_ID}`], true);

  const secondExportRun = "91919191-9191-4919-8919-919191919191";
  runMigrationTool(port, database, ["--mode", "rollback-export", "--company", MIGRATION_COMPANY_ID, "--owner", "all", "--run-id", secondExportRun, ...writeSafety, "--confirm", `EXPORT ${MIGRATION_COMPANY_ID}`]);
  runMigrationTool(port, database, ["--mode", "rollback", "--company", MIGRATION_COMPANY_ID, "--owner", "all", "--run-id", secondExportRun, ...writeSafety, "--confirm", `ROLLBACK ${MIGRATION_COMPANY_ID}`]);
  const rolledBack = await pool.query(
    "select format.editor_format,format.migration_state,legacy.canonical_html,(select count(*) from editor_rollout_gates where company_id=$1 and rollout_state='rolled_back')::integer as rolled_back_gates from workspace_editor_formats format join editor_collaboration_documents legacy on legacy.company_id=format.company_id and legacy.resource_type='project' and legacy.resource_id=$2 and legacy.document_id=$3 where format.company_id=$1",
    [MIGRATION_COMPANY_ID, MIGRATION_PROJECT_ID, MIGRATION_DOCUMENT_IDS.project],
  );
  assert.equal(rolledBack.rows[0].editor_format, "legacy_html");
  assert.equal(rolledBack.rows[0].migration_state, "validated");
  assert.equal(rolledBack.rows[0].rolled_back_gates, 3);
  assert.match(rolledBack.rows[0].canonical_html, /Newest post-cutover edit survives rollback/);
  const nativeRollback = await pool.query(
    "select canonical_html,is_deleted from editor_collaboration_documents where company_id=$1 and resource_type='project' and resource_id=$2 and document_id=$3",
    [MIGRATION_COMPANY_ID, MIGRATION_PROJECT_ID, nativeDocumentID],
  );
  assert.equal(nativeRollback.rowCount, 1);
  assert.match(nativeRollback.rows[0].canonical_html, /Created after cutover/);
  assert.equal(nativeRollback.rows[0].is_deleted, false);
  const deletedRollback = await pool.query(
    "select is_deleted from editor_collaboration_documents where company_id=$1 and resource_type='logic_gate' and resource_id=$2 and document_id=$3",
    [MIGRATION_COMPANY_ID, MIGRATION_LOGIC_GATE_ID, MIGRATION_DOCUMENT_IDS.logic_gate],
  );
  assert.equal(deletedRollback.rows[0].is_deleted, true);
  return {
    converted_documents: 4,
    resumable_retry_count: ledger.rows[0].min_retries,
    shadow_matches: comparisons.rows[0].equivalent,
    activation_gates: active.rows[0].active_gates,
    activation_source_drift_rejected: true,
    stale_export_rejected: true,
    newest_edit_preserved_in_legacy_html: true,
    post_cutover_create_and_delete_preserved: true,
  };
}
async function runProof(pool, port, database) {
  await pool.query(
    `insert into users (user_id,cognito_subject,email,display_name)
     values ($1,'node-v2-poc','node-v2-poc@example.invalid','Node v2 PoC')`,
    [ACTOR_ID],
  );
  await pool.query(
    `insert into companies (company_id,name) values ($1,'Node v2 disposable proof')`,
    [COMPANY_ID],
  );
  await pool.query(
    `insert into nodes (company_id,node_id,name,created_timestamp)
     values ($1,$2,'Node v2 disposable Node',clock_timestamp())`,
    [COMPANY_ID, NODE_ID],
  );
  await Promise.all([
    seedFoundation(pool, TEXTBOX_IDS.provider, LIVE_TEXTBOX_BYTES.p95),
    seedFoundation(pool, TEXTBOX_IDS.p50, LIVE_TEXTBOX_BYTES.p50),
    seedFoundation(pool, TEXTBOX_IDS.p95, LIVE_TEXTBOX_BYTES.p95),
    seedFoundation(pool, TEXTBOX_IDS.max, LIVE_TEXTBOX_BYTES.max),
    seedFoundation(pool, TEXTBOX_IDS.failedUpdate, LIVE_TEXTBOX_BYTES.p50),
    seedFoundation(pool, TEXTBOX_IDS.failedCompaction, LIVE_TEXTBOX_BYTES.p50),
  ]);
  process.stderr.write("node-v2-proof stage=production-runtime\n");
  const productionRuntime = await runProductionRuntimeProof(pool);
  process.stderr.write("node-v2-proof stage=migration-workflow\n");
  const migrationWorkflow = await runMigrationWorkflowProof(pool, port, database);

  const store = new NodeV2YjsPostgresStore({ pool, materializeDocument: materializeProofDocument });
  process.stderr.write("node-v2-proof stage=provider\n");
  const provider = await runProviderProof(pool, store);
  process.stderr.write("node-v2-proof stage=failed-update\n");
  const failedUpdate = await proveFailedUpdateIsNotAcknowledged(pool, store);
  process.stderr.write("node-v2-proof stage=failed-compaction\n");
  const failedCompaction = await proveCompactionRollback(pool, store);
  const load = [];
  process.stderr.write("node-v2-proof stage=load-p50\n");
  load.push(await runLoadProfile(pool, store, "live-p50", TEXTBOX_IDS.p50, LIVE_TEXTBOX_BYTES.p50, 4, 4));
  process.stderr.write("node-v2-proof stage=load-p95\n");
  load.push(await runLoadProfile(pool, store, "live-p95", TEXTBOX_IDS.p95, LIVE_TEXTBOX_BYTES.p95, 8, 520));
  process.stderr.write("node-v2-proof stage=load-max\n");
  load.push(await runLoadProfile(pool, store, "live-max", TEXTBOX_IDS.max, LIVE_TEXTBOX_BYTES.max, 2, 2));
  process.stderr.write("node-v2-proof stage=complete\n");
  const relationSizes = await pool.query(
    `select relname, pg_total_relation_size(relid)::bigint as bytes
       from pg_catalog.pg_statio_user_tables
      where relname in ('node_textboxes','node_textbox_yjs_updates','node_textbox_yjs_checkpoints')
      order by relname`,
  );
  return {
    provider,
    failed_update: failedUpdate,
    production_runtime: productionRuntime,
    migration_workflow: migrationWorkflow,
    failed_compaction: failedCompaction,
    load,
    relation_bytes: Object.fromEntries(relationSizes.rows.map((row) => [row.relname, Number(row.bytes)])),
  };
}

async function main() {
  for (const path of Object.values(postgresTools)) {
    if (postgresBin && !existsSync(path)) throw new Error(`PostgreSQL executable missing: ${path}`);
  }
  const tempRoot = mkdtempSync(join(tmpdir(), "mangorts-node-v2-yjs-postgres-"));
  const pgData = join(tempRoot, "postgres");
  const pgLog = join(tempRoot, "postgres.log");
  const database = "mangorts_node_v2_yjs_test";
  const port = await freePort();
  let postgresStarted = false;
  let pool;
  try {
    mkdirSync(pgData, { recursive: true });
    process.stderr.write("node-v2-proof setup=initdb\n");
    runPostgres(postgresTools.initdb, [
      "-D", pgData, "--username=postgres", "--auth=trust", "--encoding=UTF8", "--no-locale",
    ], process.env);
    const postgresOptions = ["-p", String(port), "-h", "127.0.0.1", "-c", "synchronous_commit=on"];
    if (!windows) postgresOptions.push("-k", tempRoot);
    try {
      process.stderr.write(`node-v2-proof setup=postgres-start port=${port}\n`);
      runPostgres(postgresTools.pg_ctl, [
        "-D", pgData, "-l", pgLog, "-o", postgresOptions.join(" "), "-w", "start",
      ], process.env, { stdio: "ignore" });
    } catch (error) {
      if (existsSync(pgLog)) process.stderr.write(readFileSync(pgLog, "utf8"));
      throw error;
    }
    postgresStarted = true;
    const env = postgresEnvironment(port, "postgres");
    process.stderr.write("node-v2-proof setup=database\n");
    runPostgres(
      postgresTools.psql,
      ["-X", "-v", "ON_ERROR_STOP=1", "-d", "postgres", "-c", `create database ${database}`],
      env,
    );
    process.stderr.write("node-v2-proof setup=schema\n");
    runPostgres(
      postgresTools.psql,
      ["-X", "-v", "ON_ERROR_STOP=1", "-d", database, "-f", resolve(backendDir, "db", "schema.sql")],
      postgresEnvironment(port, database),
    );
    process.stderr.write("node-v2-proof setup=measurements\n");
    pool = new Pool({ host: "127.0.0.1", port, database, user: "postgres", max: 12 });
    const codec = [
      benchmarkYjsCodec("live-p50", LIVE_TEXTBOX_BYTES.p50),
      benchmarkYjsCodec("live-p95", LIVE_TEXTBOX_BYTES.p95),
      benchmarkYjsCodec("live-max", LIVE_TEXTBOX_BYTES.max),
    ];
    const postgres = await runProof(pool, port, database);
    process.stdout.write(`${JSON.stringify({
      measured_at: new Date().toISOString(),
      postgresql: "disposable PostgreSQL 18 with synchronous_commit=on",
      live_textbox_source_bytes: LIVE_TEXTBOX_BYTES,
      codec,
      postgres,
    }, null, 2)}\n`);
  } finally {
    await pool?.end().catch(() => {});
    if (postgresStarted) {
      try {
        execFileSync(postgresTools.pg_ctl, ["-D", pgData, "-m", "fast", "-w", "stop"], { stdio: "ignore" });
      } catch {
        if (existsSync(pgLog)) process.stderr.write(readFileSync(pgLog, "utf8"));
      }
    }
    const resolvedTemp = resolve(tempRoot);
    const resolvedParent = resolve(tmpdir());
    const underTemp = resolvedTemp.startsWith(resolvedParent + "\\") || resolvedTemp.startsWith(resolvedParent + "/");
    if (!underTemp || !resolvedTemp.includes("mangorts-node-v2-yjs-postgres-")) {
      throw new Error(`Refusing to remove unexpected integration path: ${resolvedTemp}`);
    }
    rmSync(resolvedTemp, { recursive: true, force: true });
  }
}

await main();
