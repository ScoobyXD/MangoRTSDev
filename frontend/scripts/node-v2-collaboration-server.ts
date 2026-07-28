import { createHmac, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";

import { Server } from "@hocuspocus/server";
import { yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import pg from "pg";
import type * as Y from "yjs";

import {
  NodeV2YjsPostgresExtension,
  NodeV2YjsPostgresStore,
  formatNodeTextboxDocumentName,
  parseNodeTextboxDocumentName,
} from "./node-v2-yjs-postgres-store.mjs";
import {
  EditorOwnerYjsPostgresStore,
  parseEditorOwnerDocumentName,
} from "./editor-owner-yjs-postgres-store.mjs";
import {
  MANGO_TIPTAP_FORMAT,
  MANGO_TIPTAP_SCHEMA_VERSION,
  validateMangoTiptapDocument,
  type MangoTiptapDocument,
} from "../src/modules/editor/tiptap/mangoTiptapDocument.js";
import { mangoProsemirrorJSONToYDoc } from "../src/modules/editor/tiptap/mangoTiptapYjs.js";
export { mangoProsemirrorJSONToYDoc } from "../src/modules/editor/tiptap/mangoTiptapYjs.js";

const { Pool } = pg;
const MAX_AWARENESS_BYTES = 16 * 1024;
const MAX_AWARENESS_CLIENTS = 100;

type CollaborationContext = {
  actorUserId: string;
  clientId: string;
  expiresAt: number;
};

type CollaborationTicket = {
  v: number;
  type: string;
  company_id: string;
  node_id: string;
  textbox_id: string;
  owner_type?: string;
  owner_id?: string;
  document_id?: string;
  collaboration_epoch: string;
  user_id: string;
  client_id: string;
  issued_at: number;
  expires_at: number;
};

type RuntimeMetrics = {
  started_at: string;
  connections_accepted: number;
  connections_rejected: number;
  active_connections: number;
  durable_updates: number;
  duplicate_updates: number;
  durable_update_bytes: number;
  persistence_failures: number;
  compaction_failures: number;
  awareness_rejections: number;
  last_ack_transaction_ms: number;
};

function required(value: string | undefined, name: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${name}_required`);
  return normalized;
}

function decodeBase64URL(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function verifyNodeV2CollaborationTicket(
  token: string,
  secret: string,
  documentName: string,
  now = new Date(),
): CollaborationTicket {
  const [body, signature, ...extra] = String(token).split(".");
  if (!body || !signature || extra.length > 0) throw new Error("node_v2_collaboration_ticket_invalid");
  const expected = createHmac("sha256", required(secret, "collaboration_ticket_secret"))
    .update(body)
    .digest();
  const supplied = decodeBase64URL(signature);
  if (expected.byteLength !== supplied.byteLength || !timingSafeEqual(expected, supplied)) {
    throw new Error("node_v2_collaboration_ticket_invalid");
  }

  let payload: CollaborationTicket;
  try {
    payload = JSON.parse(decodeBase64URL(body).toString("utf8")) as CollaborationTicket;
  } catch {
    throw new Error("node_v2_collaboration_ticket_invalid");
  }
  const identity = parseNodeTextboxDocumentName(documentName);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (
    payload.v !== 1
    || payload.type !== "node-v2-collaboration"
    || payload.company_id !== identity.companyId
    || payload.node_id !== identity.nodeId
    || payload.textbox_id !== identity.textboxId
    || payload.collaboration_epoch !== identity.collaborationEpoch
    || !payload.user_id
    || !payload.client_id
    || Buffer.byteLength(payload.client_id, "utf8") > 160
    || !Number.isSafeInteger(payload.issued_at)
    || !Number.isSafeInteger(payload.expires_at)
    || payload.issued_at > nowSeconds + 60
    || payload.expires_at < nowSeconds
    || payload.expires_at - payload.issued_at > 180
  ) {
    throw new Error("node_v2_collaboration_ticket_invalid");
  }
  return payload;
}

export function verifyEditorOwnerCollaborationTicket(
  token: string,
  secret: string,
  documentName: string,
  now = new Date(),
): CollaborationTicket {
  const [body, signature, ...extra] = String(token).split(".");
  if (!body || !signature || extra.length > 0) throw new Error("editor_owner_collaboration_ticket_invalid");
  const expected = createHmac("sha256", required(secret, "collaboration_ticket_secret")).update(body).digest();
  const supplied = decodeBase64URL(signature);
  if (expected.byteLength !== supplied.byteLength || !timingSafeEqual(expected, supplied)) throw new Error("editor_owner_collaboration_ticket_invalid");
  let payload: CollaborationTicket;
  try {
    payload = JSON.parse(decodeBase64URL(body).toString("utf8")) as CollaborationTicket;
  } catch {
    throw new Error("editor_owner_collaboration_ticket_invalid");
  }
  const identity = parseEditorOwnerDocumentName(documentName);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (
    payload.v !== 1 || payload.type !== "editor-owner-collaboration"
    || payload.company_id !== identity.companyId || payload.owner_type !== identity.ownerType
    || payload.owner_id !== identity.ownerId || payload.document_id !== identity.documentId
    || payload.collaboration_epoch !== identity.collaborationEpoch || !payload.user_id || !payload.client_id
    || Buffer.byteLength(payload.client_id, "utf8") > 160 || !Number.isSafeInteger(payload.issued_at)
    || !Number.isSafeInteger(payload.expires_at) || payload.issued_at > nowSeconds + 60
    || payload.expires_at < nowSeconds || payload.expires_at - payload.issued_at > 180
  ) throw new Error("editor_owner_collaboration_ticket_invalid");
  return payload;
}

function jsonText(node: Record<string, unknown>): string {
  if (node.type === "text") return typeof node.text === "string" ? node.text : "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "mention") {
    const attrs = node.attrs as Record<string, unknown> | undefined;
    return `${attrs?.kind === "urgent" ? "!" : "@"}${String(attrs?.label ?? "user")}`;
  }
  if (node.type === "mangoEntityLink") {
    const attrs = node.attrs as Record<string, unknown> | undefined;
    return String(attrs?.label ?? "Entity");
  }
  const children = Array.isArray(node.content)
    ? node.content.map((child) => jsonText(child as Record<string, unknown>)).join("")
    : "";
  return ["paragraph", "heading", "blockquote", "codeBlock", "listItem", "taskItem", "tableCell", "tableHeader"].includes(String(node.type))
    ? `${children}\n`
    : children;
}

export function materializeNodeV2Document(document: Y.Doc): {
  documentJson: MangoTiptapDocument;
  documentSchemaVersion: number;
  plainText: string;
  documentByteSize: number;
} {
  const documentJson: MangoTiptapDocument = {
    format: MANGO_TIPTAP_FORMAT,
    schema_version: MANGO_TIPTAP_SCHEMA_VERSION,
    document: yDocToProsemirrorJSON(document, "default"),
  };
  const validation = validateMangoTiptapDocument(documentJson);
  if (!validation.valid) throw new Error(`node_v2_yjs_schema_invalid:${validation.error}`);
  return {
    documentJson: validation.value,
    documentSchemaVersion: MANGO_TIPTAP_SCHEMA_VERSION,
    plainText: jsonText(validation.value.document as Record<string, unknown>).trimEnd(),
    documentByteSize: Buffer.byteLength(JSON.stringify(validation.value), "utf8"),
  };
}

function editorOwnerAnnotations(document: Y.Doc): unknown[] {
  const raw = document.getMap("mango-metadata").get("annotations");
  if (raw === undefined) return [];
  let value: unknown;
  try { value = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { throw new Error("editor_owner_yjs_annotations_invalid"); }
  if (!Array.isArray(value) || value.length > 10_000) throw new Error("editor_owner_yjs_annotations_invalid");
  return value;
}

function seedEditorOwnerDocument(documentJSON: unknown, annotations: unknown): Y.Doc {
  const validation = validateMangoTiptapDocument(documentJSON);
  if (!validation.valid) throw new Error(`editor_owner_yjs_seed_invalid:${validation.error}`);
  const document = mangoProsemirrorJSONToYDoc(validation.value.document, "default");
  const normalizedAnnotations = Array.isArray(annotations) ? annotations : [];
  if (normalizedAnnotations.length > 10_000) throw new Error("editor_owner_yjs_annotations_invalid");
  document.getMap("mango-metadata").set("annotations", JSON.stringify(normalizedAnnotations));
  return document;
}

function materializeEditorOwnerDocument(document: Y.Doc) {
  return { ...materializeNodeV2Document(document), annotations: editorOwnerAnnotations(document) };
}

async function isAuthorized(pool: pg.Pool, documentName: string, userID: string): Promise<boolean> {
  const identity = parseNodeTextboxDocumentName(documentName);
  const result = await pool.query(
    `select exists(
       select 1
         from node_textboxes textbox
         join editor_rollout_gates owner_gate
           on owner_gate.company_id=textbox.company_id and owner_gate.owner_type='node'
         join workspace_editor_formats gate on gate.company_id=textbox.company_id
        where textbox.company_id=$1::uuid
          and textbox.node_id=$2::uuid
          and textbox.textbox_id=$3::uuid
          and textbox.collaboration_epoch=$5::uuid
          and textbox.deleted_timestamp is null
          and gate.editor_format='tiptap_json'
          and gate.migration_state='ready'
          and gate.expected_document_count=gate.converted_document_count
          and mangorts_user_can_access_resource($1::uuid,'node',$2::uuid,$4::uuid,'edit')

          and owner_gate.rollout_state='active'
          and owner_gate.expected_count=owner_gate.converted_count
          and owner_gate.failed_count=0
          and owner_gate.shadow_mismatch_count=0
          and owner_gate.validated_timestamp is not null
     ) as allowed`,
    [identity.companyId, identity.nodeId, identity.textboxId, userID, identity.collaborationEpoch],
  );
  return result.rows[0]?.allowed === true;
}

async function isEditorOwnerAuthorized(pool: pg.Pool, documentName: string, userID: string): Promise<boolean> {
  const identity = parseEditorOwnerDocumentName(documentName);
  const storage = identity.ownerType === "project"
    ? { table: "project_editor_documents", ownerColumn: "project_id" }
    : { table: "logic_gate_editor_documents", ownerColumn: "logic_gate_id" };
  const result = await pool.query(
    `select exists(
       select 1 from ${storage.table} document
       join editor_rollout_gates owner_gate on owner_gate.company_id=document.company_id and owner_gate.owner_type=$2
       join workspace_editor_formats gate on gate.company_id=document.company_id
       where document.company_id=$1::uuid and document.${storage.ownerColumn}=$3::uuid and document.document_id=$4
         and document.collaboration_epoch=$6::uuid and document.is_deleted=false
         and gate.editor_format='tiptap_json' and gate.migration_state='ready'
         and gate.expected_document_count=gate.converted_document_count
         and owner_gate.rollout_state='active' and owner_gate.expected_count=owner_gate.converted_count
         and owner_gate.failed_count=0 and owner_gate.shadow_mismatch_count=0 and owner_gate.validated_timestamp is not null
         and mangorts_user_can_access_resource($1::uuid,$2,$3::uuid,$5::uuid,'edit')
     ) as allowed`,
    [identity.companyId, identity.ownerType, identity.ownerId, identity.documentId, userID, identity.collaborationEpoch],
  );
  return result.rows[0]?.allowed === true;
}

function safeLog(event: string, values: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ service: "node-v2-collaboration", event, ...values, timestamp: new Date().toISOString() })}\n`);
}

export function createNodeV2CollaborationServer(options: {
  databaseURL?: string;
  ticketSecret?: string;
  address?: string;
  port?: number;
  pool?: pg.Pool;
  quiet?: boolean;
} = {}) {
  const databaseURL = options.databaseURL ?? process.env.DATABASE_URL;
  const ticketSecret = options.ticketSecret ?? process.env.MANGORTS_REALTIME_TICKET_SECRET;
  const pool = options.pool ?? new Pool({
    connectionString: required(databaseURL, "database_url"),
    max: Number(process.env.NODE_V2_COLLAB_DB_POOL_SIZE || 12),
    statement_timeout: Number(process.env.NODE_V2_COLLAB_STATEMENT_TIMEOUT_MS || 15_000),
    application_name: "mangorts-node-v2-collaboration",
  });
  const secret = required(ticketSecret, "collaboration_ticket_secret");
  const metrics: RuntimeMetrics = {
    started_at: new Date().toISOString(),
    connections_accepted: 0,
    connections_rejected: 0,
    active_connections: 0,
    durable_updates: 0,
    duplicate_updates: 0,
    durable_update_bytes: 0,
    persistence_failures: 0,
    compaction_failures: 0,
    awareness_rejections: 0,
    last_ack_transaction_ms: 0,
  };

  const store = new NodeV2YjsPostgresStore({
    pool,
    materializeDocument: materializeNodeV2Document,
    maxUpdateBytes: Number(process.env.NODE_V2_COLLAB_MAX_UPDATE_BYTES || 8 * 1024 * 1024),
  });
  const editorOwnerStore = new EditorOwnerYjsPostgresStore({
    pool,
    seedDocument: seedEditorOwnerDocument,
    materializeDocument: materializeEditorOwnerDocument,
    maxUpdateBytes: Number(process.env.NODE_V2_COLLAB_MAX_UPDATE_BYTES || 8 * 1024 * 1024),
  });
  const persistence = new NodeV2YjsPostgresExtension({
    store,
    materializationDelayMs: Number(process.env.NODE_V2_COLLAB_MATERIALIZE_MS || 30_000),
    acceptsDocument: (documentName: string) => documentName.startsWith("node-textbox:"),
    async authorizeUpdate(payload: { documentName: string; context?: CollaborationContext }) {
      const userID = payload.context?.actorUserId ?? "";
      if (!userID || !await isAuthorized(pool, payload.documentName, userID)) {
        throw new Error("node_v2_collaboration_write_revoked");
      }
    },
    async onAcknowledgement(acknowledgement: Record<string, unknown>) {
      metrics.durable_updates += 1;
      metrics.durable_update_bytes += Number(acknowledgement.update_bytes || 0);
      metrics.last_ack_transaction_ms = Number(acknowledgement.database_transaction_ms || 0);
      if (acknowledgement.duplicate) metrics.duplicate_updates += 1;
    },
    async onPersistenceError(error: unknown, payload: { documentName: string }) {
      metrics.persistence_failures += 1;
      safeLog("durability_quarantine", { document_name: payload.documentName, error: error instanceof Error ? error.message : "unknown" });
    },
    async onCompactionError(error: unknown, payload: { documentName: string; reason: string }) {
      metrics.compaction_failures += 1;
      safeLog("compaction_failed", { document_name: payload.documentName, reason: payload.reason, error: error instanceof Error ? error.message : "unknown" });
    },
  });
  const editorOwnerPersistence = new NodeV2YjsPostgresExtension({
    store: editorOwnerStore,
    materializationDelayMs: Number(process.env.NODE_V2_COLLAB_MATERIALIZE_MS || 30_000),
    acceptsDocument: (documentName: string) => documentName.startsWith("editor-owner:"),
    async authorizeUpdate(payload: { documentName: string; context?: CollaborationContext }) {
      const userID = payload.context?.actorUserId ?? "";
      if (!userID || !await isEditorOwnerAuthorized(pool, payload.documentName, userID)) throw new Error("editor_owner_collaboration_write_revoked");
    },
    async onAcknowledgement(acknowledgement: Record<string, unknown>) {
      metrics.durable_updates += 1;
      metrics.durable_update_bytes += Number(acknowledgement.update_bytes || 0);
      metrics.last_ack_transaction_ms = Number(acknowledgement.database_transaction_ms || 0);
      if (acknowledgement.duplicate) metrics.duplicate_updates += 1;
    },
    async onPersistenceError(error: unknown, payload: { documentName: string }) {
      metrics.persistence_failures += 1;
      safeLog("durability_quarantine", { document_name: payload.documentName, error: error instanceof Error ? error.message : "unknown" });
    },
    async onCompactionError(error: unknown, payload: { documentName: string; reason: string }) {
      metrics.compaction_failures += 1;
      safeLog("compaction_failed", { document_name: payload.documentName, reason: payload.reason, error: error instanceof Error ? error.message : "unknown" });
    },
  });

  const server = new Server<CollaborationContext>({
    address: options.address ?? process.env.NODE_V2_COLLAB_ADDRESS ?? "127.0.0.1",
    port: options.port ?? Number(process.env.NODE_V2_COLLAB_PORT || 1234),
    quiet: options.quiet ?? false,
    stopOnSignals: false,
    debounce: 120,
    maxDebounce: 1_000,
    timeout: 60_000,
    extensions: [persistence, editorOwnerPersistence],
    async onAuthenticate({ documentName, token }) {
      try {
        const editorOwner = documentName.startsWith("editor-owner:");
        const ticket = editorOwner
          ? verifyEditorOwnerCollaborationTicket(token, secret, documentName)
          : verifyNodeV2CollaborationTicket(token, secret, documentName);
        const authorized = editorOwner
          ? await isEditorOwnerAuthorized(pool, documentName, ticket.user_id)
          : await isAuthorized(pool, documentName, ticket.user_id);
        if (!authorized) throw new Error("collaboration_forbidden");
        metrics.connections_accepted += 1;
        metrics.active_connections += 1;
        return { actorUserId: ticket.user_id, clientId: ticket.client_id, expiresAt: ticket.expires_at };
      } catch (error) {
        metrics.connections_rejected += 1;
        throw error;
      }
    },
    async connected({ documentName, connection }) {
      // Prove IndexedDB recovery against PostgreSQL on every mount. This status
      // also closes the lost-acknowledgement window without accepting sync as
      // evidence that the asynchronous durability hook has committed.
      const status = documentName.startsWith("editor-owner:")
        ? await editorOwnerStore.durabilityStatus(documentName)
        : await store.durabilityStatus(documentName);
      connection.sendStateless(JSON.stringify(status));
    },
    async onAwarenessUpdate({ states, documentName, instance }) {
      const encodedBytes = Buffer.byteLength(JSON.stringify(states), "utf8");
      if (states.length > MAX_AWARENESS_CLIENTS || encodedBytes > MAX_AWARENESS_BYTES) {
        metrics.awareness_rejections += 1;
        instance.closeConnections(documentName);
        throw new Error("node_v2_awareness_limit_exceeded");
      }
    },
    async onDisconnect() {
      metrics.active_connections = Math.max(0, metrics.active_connections - 1);
    },
    async onRequest({ request, response }) {
      const path = String(request.url ?? "").split("?")[0];
      if (path === "/healthz") {
        const database = await pool.query("select 1 as ok");
        response.writeHead(database.rows[0]?.ok === 1 ? 200 : 503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        response.end(JSON.stringify({ ok: database.rows[0]?.ok === 1 }));
        return Promise.reject();
      }
      if (path === "/metrics") {
        response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        response.end(JSON.stringify(metrics));
        return Promise.reject();
      }
      response.writeHead(404, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ error: "not_found" }));
      return Promise.reject();
    },
  });

  let stopped = false;
  return {
    server,
    pool,
    store,
    editorOwnerStore,
    persistence,
    editorOwnerPersistence,
    metrics,
    async listen() {
      await server.listen();
      safeLog("listening", { address: server.configuration.address, port: server.address.port });
      return server.address;
    },
    async destroy() {
      if (stopped) return;
      stopped = true;
      await persistence.flush();
      await editorOwnerPersistence.flush();
      await server.destroy();
      if (!options.pool) await pool.end();
      safeLog("stopped");
    },
  };
}

async function main(): Promise<void> {
  const runtime = createNodeV2CollaborationServer();
  const stop = async () => {
    await runtime.destroy();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await runtime.listen();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    safeLog("startup_failed", { error: error instanceof Error ? error.message : "unknown" });
    process.exitCode = 1;
  });
}
