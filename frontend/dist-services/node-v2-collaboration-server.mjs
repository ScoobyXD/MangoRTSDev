// scripts/node-v2-collaboration-server.ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { Server } from "@hocuspocus/server";
import { yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import pg from "pg";

// scripts/node-v2-yjs-postgres-store.mjs
import { createHash, randomUUID } from "node:crypto";
import * as Y from "yjs";
var DOCUMENT_PREFIX = "node-textbox";
var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var ACK_TYPE = "node-v2-yjs.durable-ack.v1";
var ERROR_TYPE = "node-v2-yjs.durability-error.v1";
var DEFAULT_MAX_UPDATE_BYTES = 8 * 1024 * 1024;
var EMPTY_UPDATE = (() => {
  const document2 = new Y.Doc();
  const update = Y.encodeStateAsUpdate(document2);
  document2.destroy();
  return update;
})();
function asUint8Array(value) {
  return value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(Buffer.from(value));
}
function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}
function assertUuid(value, label) {
  if (!UUID_PATTERN.test(value)) throw new Error(`invalid_${label}`);
  return value.toLowerCase();
}
function numericSequence(value, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`invalid_${label}`);
  return result;
}
function encodeDurableSnapshot(document2) {
  return Buffer.from(Y.encodeSnapshot(Y.snapshot(document2))).toString("base64");
}
function parseNodeTextboxDocumentName(documentName) {
  const [prefix, companyId, nodeId, textboxId, ...extra] = String(documentName).split(":");
  if (prefix !== DOCUMENT_PREFIX || extra.length > 0) throw new Error("invalid_node_textbox_document_name");
  return {
    companyId: assertUuid(companyId, "company_id"),
    nodeId: assertUuid(nodeId, "node_id"),
    textboxId: assertUuid(textboxId, "textbox_id")
  };
}
async function rollbackQuietly(client) {
  try {
    await client.query("rollback");
  } catch {
  }
}
var NodeV2YjsPostgresStore = class {
  constructor({
    pool,
    materializeDocument = null,
    maxUpdateBytes = DEFAULT_MAX_UPDATE_BYTES,
    coveredUpdateRetentionDays = 7,
    automaticCheckpointRetentionDays = 14
  }) {
    if (!pool || typeof pool.connect !== "function") throw new Error("node_v2_yjs_pool_required");
    if (!Number.isSafeInteger(maxUpdateBytes) || maxUpdateBytes <= 0) throw new Error("invalid_node_v2_yjs_max_update_bytes");
    this.pool = pool;
    this.materializeDocument = materializeDocument;
    this.maxUpdateBytes = maxUpdateBytes;
    this.coveredUpdateRetentionDays = coveredUpdateRetentionDays;
    this.automaticCheckpointRetentionDays = automaticCheckpointRetentionDays;
    this.durableStateCache = /* @__PURE__ */ new Map();
  }
  #replaceDurableStateCache(documentName, collaborationEpoch, headSequence, mergedUpdate) {
    const document2 = new Y.Doc();
    Y.applyUpdate(document2, mergedUpdate);
    this.durableStateCache.get(documentName)?.document.destroy();
    this.durableStateCache.set(documentName, { collaborationEpoch, headSequence, document: document2 });
    return document2;
  }
  evictDocument(documentName) {
    this.durableStateCache.get(documentName)?.document.destroy();
    this.durableStateCache.delete(documentName);
  }
  async #loadDurableState(client, identity, collaborationEpoch, latestUpdateSequence) {
    const checkpointResult = await client.query(
      `select checkpoint_id, through_update_sequence, checkpoint_payload, state_vector
         from node_textbox_yjs_checkpoints
        where company_id = $1 and node_id = $2 and textbox_id = $3
          and collaboration_epoch = $4
          and through_update_sequence <= $5
        order by through_update_sequence desc, checkpoint_id desc
        limit 1`,
      [identity.companyId, identity.nodeId, identity.textboxId, collaborationEpoch, latestUpdateSequence]
    );
    if (checkpointResult.rowCount !== 1) throw new Error("node_v2_yjs_checkpoint_missing");
    const checkpoint = checkpointResult.rows[0];
    const checkpointSequence = numericSequence(checkpoint.through_update_sequence, "checkpoint_sequence");
    const tailResult = await client.query(
      `select update_sequence, update_payload
         from node_textbox_yjs_updates
        where company_id = $1 and node_id = $2 and textbox_id = $3
          and collaboration_epoch = $4
          and update_sequence > $5 and update_sequence <= $6
        order by update_sequence`,
      [
        identity.companyId,
        identity.nodeId,
        identity.textboxId,
        collaborationEpoch,
        checkpointSequence,
        latestUpdateSequence
      ]
    );
    const parts = [asUint8Array(checkpoint.checkpoint_payload), ...tailResult.rows.map((row) => asUint8Array(row.update_payload))];
    const mergedUpdate = parts.length === 1 ? parts[0] : Y.mergeUpdates(parts);
    return {
      checkpointId: checkpoint.checkpoint_id,
      checkpointSequence,
      mergedUpdate,
      stateVector: Y.encodeStateVectorFromUpdate(mergedUpdate),
      tailCount: tailResult.rowCount,
      tailBytes: tailResult.rows.reduce((total, row) => total + row.update_payload.byteLength, 0)
    };
  }
  async loadDocument(documentName) {
    const identity = parseNodeTextboxDocumentName(documentName);
    const client = await this.pool.connect();
    try {
      await client.query("begin isolation level repeatable read read only");
      const textboxResult = await client.query(
        `select collaboration_epoch, latest_update_sequence
           from node_textboxes
          where company_id = $1 and node_id = $2 and textbox_id = $3 and deleted_timestamp is null`,
        [identity.companyId, identity.nodeId, identity.textboxId]
      );
      if (textboxResult.rowCount !== 1) throw new Error("node_v2_yjs_textbox_not_found");
      const collaborationEpoch = textboxResult.rows[0].collaboration_epoch;
      const latestUpdateSequence = numericSequence(textboxResult.rows[0].latest_update_sequence, "latest_update_sequence");
      const durable = await this.#loadDurableState(client, identity, collaborationEpoch, latestUpdateSequence);
      await client.query("commit");
      this.#replaceDurableStateCache(documentName, collaborationEpoch, latestUpdateSequence, durable.mergedUpdate);
      return { identity, collaborationEpoch, latestUpdateSequence, ...durable };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }
  async durabilityStatus(documentName) {
    const identity = parseNodeTextboxDocumentName(documentName);
    const client = await this.pool.connect();
    let document2;
    try {
      await client.query("begin isolation level repeatable read read only");
      const textboxResult = await client.query(
        `select collaboration_epoch, latest_update_sequence
           from node_textboxes
          where company_id = $1 and node_id = $2 and textbox_id = $3 and deleted_timestamp is null`,
        [identity.companyId, identity.nodeId, identity.textboxId]
      );
      if (textboxResult.rowCount !== 1) throw new Error("node_v2_yjs_textbox_not_found");
      const collaborationEpoch = textboxResult.rows[0].collaboration_epoch;
      const latestUpdateSequence = numericSequence(textboxResult.rows[0].latest_update_sequence, "latest_update_sequence");
      const durable = await this.#loadDurableState(client, identity, collaborationEpoch, latestUpdateSequence);
      document2 = new Y.Doc();
      Y.applyUpdate(document2, durable.mergedUpdate);
      await client.query("commit");
      return {
        type: ACK_TYPE,
        document_name: documentName,
        collaboration_epoch: collaborationEpoch,
        durable_head_sequence: latestUpdateSequence,
        state_vector_base64: Buffer.from(Y.encodeStateVector(document2)).toString("base64"),
        durable_snapshot_base64: encodeDurableSnapshot(document2),
        status_only: true
      };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      document2?.destroy();
      client.release();
    }
  }
  async appendUpdate(documentName, update, { updateId = randomUUID(), clientId, actorUserId = null, documentJson = null } = {}) {
    const identity = parseNodeTextboxDocumentName(documentName);
    const payload = asUint8Array(update);
    if (payload.byteLength === 0) throw new Error("node_v2_yjs_empty_update");
    if (payload.byteLength > this.maxUpdateBytes) throw new Error("node_v2_yjs_update_too_large");
    const validationDocument = new Y.Doc();
    try {
      Y.applyUpdate(validationDocument, payload);
    } finally {
      validationDocument.destroy();
    }
    assertUuid(updateId, "update_id");
    if (!clientId || Buffer.byteLength(clientId, "utf8") > 160) throw new Error("invalid_client_id");
    if (actorUserId !== null) assertUuid(actorUserId, "actor_user_id");
    const checksum = sha256Hex(payload);
    const started = performance.now();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const textboxResult = await client.query(
        `select collaboration_epoch, latest_update_sequence
           from node_textboxes
          where company_id = $1 and node_id = $2 and textbox_id = $3 and deleted_timestamp is null
          for update`,
        [identity.companyId, identity.nodeId, identity.textboxId]
      );
      if (textboxResult.rowCount !== 1) throw new Error("node_v2_yjs_textbox_not_found");
      if (documentJson) {
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended('editor-owner-text:' || $1 || ':node:' || $2, 0))",
          [identity.companyId, identity.nodeId]
        );
        const limitResult = await client.query(
          `select coalesce(sum(octet_length(document_json::text)) filter (
                   where deleted_timestamp is null and textbox_id <> $3), 0)
                  + octet_length($4::jsonb::text) <= 1073741824 as within_limit
             from node_textboxes
            where company_id = $1 and node_id = $2`,
          [identity.companyId, identity.nodeId, identity.textboxId, JSON.stringify(documentJson)]
        );
        if (limitResult.rows[0]?.within_limit !== true) throw new Error("editor_owner_text_limit_exceeded");
      }
      const collaborationEpoch = textboxResult.rows[0].collaboration_epoch;
      const durableHeadBefore = numericSequence(textboxResult.rows[0].latest_update_sequence, "latest_update_sequence");
      let latestUpdateSequence = durableHeadBefore;
      const cached = this.durableStateCache.get(documentName);
      const cacheMatchesDurableHead = cached?.collaborationEpoch === collaborationEpoch && cached.headSequence === durableHeadBefore;
      const duplicateResult = await client.query(
        `select update_sequence, update_id, update_sha256, update_payload
           from node_textbox_yjs_updates
          where company_id = $1 and node_id = $2 and textbox_id = $3 and collaboration_epoch = $4
            and (update_id = $5 or update_sha256 = $6)
          order by update_sequence`,
        [identity.companyId, identity.nodeId, identity.textboxId, collaborationEpoch, updateId, checksum]
      );
      if (duplicateResult.rowCount > 1) throw new Error("node_v2_yjs_deduplication_conflict");
      let updateSequence;
      let duplicate = false;
      if (duplicateResult.rowCount === 1) {
        const existing = duplicateResult.rows[0];
        if (existing.update_id === updateId && existing.update_sha256 !== checksum) {
          throw new Error("node_v2_yjs_update_id_payload_mismatch");
        }
        if (!Buffer.from(existing.update_payload).equals(Buffer.from(payload))) {
          throw new Error("node_v2_yjs_checksum_collision");
        }
        updateSequence = numericSequence(existing.update_sequence, "update_sequence");
        duplicate = true;
      } else {
        const insertResult = await client.query(
          `insert into node_textbox_yjs_updates (
             company_id, node_id, textbox_id, update_id, update_sha256,
             collaboration_epoch, client_id, actor_user_id, update_payload
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           returning update_sequence`,
          [
            identity.companyId,
            identity.nodeId,
            identity.textboxId,
            updateId,
            checksum,
            collaborationEpoch,
            clientId,
            actorUserId,
            Buffer.from(payload)
          ]
        );
        updateSequence = numericSequence(insertResult.rows[0].update_sequence, "update_sequence");
        latestUpdateSequence = updateSequence;
        await client.query(
          `update node_textboxes
              set latest_update_sequence = $4, updated_timestamp = clock_timestamp()
            where company_id = $1 and node_id = $2 and textbox_id = $3`,
          [identity.companyId, identity.nodeId, identity.textboxId, updateSequence]
        );
      }
      const durableReload = cacheMatchesDurableHead ? null : await this.#loadDurableState(client, identity, collaborationEpoch, latestUpdateSequence);
      const tailStatsResult = await client.query(
        `select count(*)::integer as update_count,
                coalesce(sum(octet_length(update_payload)),0)::bigint as update_bytes
           from node_textbox_yjs_updates
          where company_id=$1 and node_id=$2 and textbox_id=$3 and collaboration_epoch=$4
            and update_sequence > coalesce((
              select max(through_update_sequence) from node_textbox_yjs_checkpoints
               where company_id=$1 and node_id=$2 and textbox_id=$3 and collaboration_epoch=$4
            ),0) and update_sequence <= $5`,
        [identity.companyId, identity.nodeId, identity.textboxId, collaborationEpoch, latestUpdateSequence]
      );
      await client.query("commit");
      let durableDocument;
      if (durableReload) {
        durableDocument = this.#replaceDurableStateCache(
          documentName,
          collaborationEpoch,
          latestUpdateSequence,
          durableReload.mergedUpdate
        );
      } else {
        durableDocument = cached.document;
        if (!duplicate) Y.applyUpdate(durableDocument, payload);
        cached.headSequence = latestUpdateSequence;
      }
      const durableStateVector = Y.encodeStateVector(durableDocument);
      return {
        type: ACK_TYPE,
        document_name: documentName,
        collaboration_epoch: collaborationEpoch,
        durable_update_sequence: updateSequence,
        durable_head_sequence: latestUpdateSequence,
        update_id: updateId,
        update_sha256: checksum,
        state_vector_base64: Buffer.from(durableStateVector).toString("base64"),
        durable_snapshot_base64: encodeDurableSnapshot(durableDocument),
        duplicate,
        update_bytes: payload.byteLength,
        uncheckpointed_update_count: tailStatsResult.rows[0].update_count,
        uncheckpointed_update_bytes: Number(tailStatsResult.rows[0].update_bytes),
        database_transaction_ms: Number((performance.now() - started).toFixed(3))
      };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }
  async compactDocument(documentName, reason) {
    if (typeof this.materializeDocument !== "function") throw new Error("node_v2_yjs_materializer_required");
    if (!["operation_count", "update_bytes", "idle", "manual_recovery"].includes(reason)) {
      throw new Error("invalid_node_v2_yjs_checkpoint_reason");
    }
    const identity = parseNodeTextboxDocumentName(documentName);
    const started = performance.now();
    const client = await this.pool.connect();
    let yDocument;
    try {
      await client.query("begin");
      const textboxResult = await client.query(
        `select collaboration_epoch, latest_update_sequence, materialized_through_sequence
           from node_textboxes
          where company_id = $1 and node_id = $2 and textbox_id = $3 and deleted_timestamp is null
          for update`,
        [identity.companyId, identity.nodeId, identity.textboxId]
      );
      if (textboxResult.rowCount !== 1) throw new Error("node_v2_yjs_textbox_not_found");
      const collaborationEpoch = textboxResult.rows[0].collaboration_epoch;
      const latestUpdateSequence = numericSequence(textboxResult.rows[0].latest_update_sequence, "latest_update_sequence");
      const materializedThroughSequence = numericSequence(
        textboxResult.rows[0].materialized_through_sequence,
        "materialized_through_sequence"
      );
      const durable = await this.#loadDurableState(client, identity, collaborationEpoch, latestUpdateSequence);
      if (latestUpdateSequence === durable.checkpointSequence && latestUpdateSequence === materializedThroughSequence) {
        await client.query("commit");
        return {
          document_name: documentName,
          collaboration_epoch: collaborationEpoch,
          through_update_sequence: latestUpdateSequence,
          compacted: false,
          database_transaction_ms: Number((performance.now() - started).toFixed(3))
        };
      }
      yDocument = new Y.Doc();
      Y.applyUpdate(yDocument, durable.mergedUpdate);
      const materialized = await this.materializeDocument(yDocument, {
        identity,
        collaborationEpoch,
        throughUpdateSequence: latestUpdateSequence
      });
      if (!materialized || typeof materialized.plainText !== "string" || !materialized.documentJson) {
        throw new Error("invalid_node_v2_yjs_materialization");
      }
      const checkpointId = randomUUID();
      const checkpointResult = await client.query(
        `insert into node_textbox_yjs_checkpoints (
           company_id, node_id, textbox_id, checkpoint_id, collaboration_epoch,
           through_update_sequence, checkpoint_payload, state_vector,
           document_schema_version, document_json, plain_text, checkpoint_reason,
           created_timestamp, retain_until
         ) values (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,
           clock_timestamp(), clock_timestamp() + ($13::integer * interval '1 day')
         )
         on conflict (company_id, node_id, textbox_id, collaboration_epoch, through_update_sequence)
         do nothing
         returning checkpoint_id`,
        [
          identity.companyId,
          identity.nodeId,
          identity.textboxId,
          checkpointId,
          collaborationEpoch,
          latestUpdateSequence,
          Buffer.from(durable.mergedUpdate),
          Buffer.from(durable.stateVector),
          materialized.documentSchemaVersion ?? 1,
          JSON.stringify(materialized.documentJson),
          materialized.plainText,
          reason,
          this.automaticCheckpointRetentionDays
        ]
      );
      await client.query(
        `update node_textbox_yjs_updates
            set checkpointed_timestamp = coalesce(checkpointed_timestamp, clock_timestamp()),
                retain_until = coalesce(retain_until, clock_timestamp() + ($6::integer * interval '1 day'))
          where company_id = $1 and node_id = $2 and textbox_id = $3
            and collaboration_epoch = $4 and update_sequence <= $5`,
        [
          identity.companyId,
          identity.nodeId,
          identity.textboxId,
          collaborationEpoch,
          latestUpdateSequence,
          this.coveredUpdateRetentionDays
        ]
      );
      await client.query(
        `update node_textboxes
            set document_schema_version = $4,
                document_json = $5::jsonb,
                plain_text = $6,
                content_revision = content_revision + 1,
                materialized_through_sequence = $7,
                updated_timestamp = clock_timestamp()
          where company_id = $1 and node_id = $2 and textbox_id = $3`,
        [
          identity.companyId,
          identity.nodeId,
          identity.textboxId,
          materialized.documentSchemaVersion ?? 1,
          JSON.stringify(materialized.documentJson),
          materialized.plainText,
          latestUpdateSequence
        ]
      );
      await client.query("commit");
      return {
        document_name: documentName,
        collaboration_epoch: collaborationEpoch,
        checkpoint_id: checkpointResult.rows[0]?.checkpoint_id ?? checkpointId,
        through_update_sequence: latestUpdateSequence,
        checkpoint_bytes: durable.mergedUpdate.byteLength,
        state_vector_bytes: durable.stateVector.byteLength,
        covered_update_count: durable.tailCount,
        covered_update_bytes: durable.tailBytes,
        compacted: checkpointResult.rowCount === 1,
        database_transaction_ms: Number((performance.now() - started).toFixed(3))
      };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      yDocument?.destroy();
      client.release();
    }
  }
};
var NodeV2YjsPostgresExtension = class {
  constructor({
    store,
    operationCountThreshold = 512,
    updateBytesThreshold = 512 * 1024,
    materializationDelayMs = 1500,
    authorizeUpdate = async () => {
    },
    validateDocument = async () => {
    },
    onAcknowledgement = async () => {
    },
    onPersistenceError = () => {
    },
    onCompactionError = () => {
    }
  }) {
    if (!(store instanceof NodeV2YjsPostgresStore)) throw new Error("node_v2_yjs_store_required");
    this.store = store;
    this.operationCountThreshold = operationCountThreshold;
    this.updateBytesThreshold = updateBytesThreshold;
    this.materializationDelayMs = materializationDelayMs;
    this.authorizeUpdate = authorizeUpdate;
    this.validateDocument = validateDocument;
    this.onAcknowledgement = onAcknowledgement;
    this.onPersistenceError = onPersistenceError;
    this.onCompactionError = onCompactionError;
    this.updateQueues = /* @__PURE__ */ new Map();
    this.compactions = /* @__PURE__ */ new Map();
    this.materializationTimers = /* @__PURE__ */ new Map();
    this.failedDocumentInstances = /* @__PURE__ */ new WeakSet();
  }
  async onLoadDocument({ document: document2, documentName }) {
    const durable = await this.store.loadDocument(documentName);
    Y.applyUpdate(document2, durable.mergedUpdate);
  }
  async afterUnloadDocument({ documentName }) {
    const timer = this.materializationTimers.get(documentName);
    if (timer) {
      clearTimeout(timer);
      this.materializationTimers.delete(documentName);
    }
    try {
      await this.updateQueues.get(documentName);
      await this.store.compactDocument(documentName, "idle");
    } catch (error) {
      await this.onCompactionError(error, { documentName, reason: "idle" });
    } finally {
      this.store.evictDocument(documentName);
    }
  }
  onChange(payload) {
    const prior = this.updateQueues.get(payload.documentName) ?? Promise.resolve();
    const current = prior.catch(() => {
    }).then(async () => {
      if (this.failedDocumentInstances.has(payload.document)) return;
      try {
        await this.authorizeUpdate(payload);
        const materialized = await this.validateDocument(payload.document, payload);
        const acknowledgement = await this.store.appendUpdate(payload.documentName, payload.update, {
          clientId: payload.context?.clientId || `hocuspocus:${payload.socketId || "server"}`,
          actorUserId: payload.context?.actorUserId ?? null,
          documentJson: materialized?.documentJson ?? null
        });
        payload.connection?.sendStateless(JSON.stringify(acknowledgement));
        await this.onAcknowledgement(acknowledgement, payload);
        if (acknowledgement.uncheckpointed_update_count >= this.operationCountThreshold || acknowledgement.uncheckpointed_update_bytes >= this.updateBytesThreshold) {
          const reason = acknowledgement.uncheckpointed_update_count >= this.operationCountThreshold ? "operation_count" : "update_bytes";
          this.#scheduleCompaction(payload.documentName, reason);
        } else {
          this.#scheduleMaterialization(payload.documentName);
        }
      } catch (error) {
        if (payload.document && typeof payload.document === "object") {
          this.failedDocumentInstances.add(payload.document);
        }
        try {
          await this.onPersistenceError(error, payload);
        } catch {
        }
        try {
          const code = error instanceof Error && error.message.includes("editor_owner_text_limit_exceeded") ? "editor_owner_text_limit_exceeded" : "durable_commit_failed";
          payload.connection?.sendStateless(JSON.stringify({ type: ERROR_TYPE, code }));
        } catch {
        }
        payload.instance.closeConnections(payload.documentName);
      }
    });
    this.updateQueues.set(payload.documentName, current);
    current.finally(() => {
      if (this.updateQueues.get(payload.documentName) === current) this.updateQueues.delete(payload.documentName);
    });
    return current;
  }
  #scheduleMaterialization(documentName) {
    if (this.materializationTimers.has(documentName)) return;
    const timer = setTimeout(() => {
      this.materializationTimers.delete(documentName);
      this.#scheduleCompaction(documentName, "idle");
    }, this.materializationDelayMs);
    this.materializationTimers.set(documentName, timer);
  }
  #scheduleCompaction(documentName, reason) {
    const timer = this.materializationTimers.get(documentName);
    if (timer) {
      clearTimeout(timer);
      this.materializationTimers.delete(documentName);
    }
    if (this.compactions.has(documentName)) return;
    const work = new Promise((resolve) => setTimeout(resolve, 0)).then(() => this.updateQueues.get(documentName)).then(() => this.store.compactDocument(documentName, reason)).catch(async (error) => {
      try {
        await this.onCompactionError(error, { documentName, reason });
      } catch {
      }
    });
    this.compactions.set(documentName, work);
    work.finally(() => {
      if (this.compactions.get(documentName) === work) this.compactions.delete(documentName);
    });
  }
  async flush() {
    for (const [documentName, timer] of this.materializationTimers) {
      clearTimeout(timer);
      this.materializationTimers.delete(documentName);
      this.#scheduleCompaction(documentName, "idle");
    }
    while (this.updateQueues.size > 0 || this.compactions.size > 0) {
      await Promise.allSettled([...this.updateQueues.values(), ...this.compactions.values()]);
    }
  }
};

// src/modules/editor/editorRuntimeMetrics.ts
var metricNames = [
  "active_editors",
  "dirty_editors",
  "listeners",
  "observers",
  "recovery_requests",
  "indexeddb_reads",
  "indexeddb_writes",
  "image_requests",
  "transactions",
  "full_document_serializations",
  "network_saves",
  "conflicts"
];
var metrics = new Map(metricNames.map((name) => [name, 0]));

// src/modules/editor/tiptap/mangoTiptapDocument.ts
var MANGO_TIPTAP_FORMAT = "mango-tiptap-json";
var MANGO_TIPTAP_SCHEMA_VERSION = 1;
var nodeAttributes = {
  doc: /* @__PURE__ */ new Set(),
  paragraph: /* @__PURE__ */ new Set(["blockId", "textAlign", "indentLevel"]),
  heading: /* @__PURE__ */ new Set(["blockId", "level", "textAlign", "indentLevel"]),
  blockquote: /* @__PURE__ */ new Set(["blockId"]),
  codeBlock: /* @__PURE__ */ new Set(["blockId", "language"]),
  horizontalRule: /* @__PURE__ */ new Set(["blockId"]),
  text: /* @__PURE__ */ new Set(),
  hardBreak: /* @__PURE__ */ new Set(),
  bulletList: /* @__PURE__ */ new Set(["blockId"]),
  orderedList: /* @__PURE__ */ new Set(["blockId", "start", "type"]),
  listItem: /* @__PURE__ */ new Set(["blockId"]),
  taskList: /* @__PURE__ */ new Set(["blockId"]),
  taskItem: /* @__PURE__ */ new Set(["blockId", "checked"]),
  table: /* @__PURE__ */ new Set(["blockId", "style"]),
  tableRow: /* @__PURE__ */ new Set(),
  tableHeader: /* @__PURE__ */ new Set(["colspan", "rowspan", "colwidth", "align", "backgroundColor"]),
  tableCell: /* @__PURE__ */ new Set(["colspan", "rowspan", "colwidth", "align", "backgroundColor"]),
  mention: /* @__PURE__ */ new Set(["userId", "label", "kind"]),
  mangoEntityLink: /* @__PURE__ */ new Set(["entityType", "entityId", "label"]),
  mangoAttachmentImage: /* @__PURE__ */ new Set([
    "attachmentId",
    "filename",
    "mimeType",
    "width",
    "height",
    "displayWidth",
    "displayHeight",
    "alignment",
    "position",
    "layout",
    "alt",
    "title",
    "linkHref",
    "linkTarget",
    "linkRel",
    "linkTitle"
  ])
};
var markAttributes = {
  bold: /* @__PURE__ */ new Set(),
  italic: /* @__PURE__ */ new Set(),
  underline: /* @__PURE__ */ new Set(),
  strike: /* @__PURE__ */ new Set(),
  code: /* @__PURE__ */ new Set(),
  textStyle: /* @__PURE__ */ new Set(["fontSize", "color"]),
  highlight: /* @__PURE__ */ new Set(["color"]),
  link: /* @__PURE__ */ new Set(["href", "target", "rel", "class", "title"])
};
var inlineNodes = /* @__PURE__ */ new Set(["text", "hardBreak", "mention", "mangoEntityLink"]);
var textContainers = /* @__PURE__ */ new Set(["paragraph", "heading"]);
var blockNodes = /* @__PURE__ */ new Set([
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "bulletList",
  "orderedList",
  "taskList",
  "table",
  "mangoAttachmentImage"
]);
var blockContainers = /* @__PURE__ */ new Set(["doc", "blockquote", "tableCell", "tableHeader"]);
var listContainers = /* @__PURE__ */ new Set(["bulletList", "orderedList", "taskList"]);
var atomNodes = /* @__PURE__ */ new Set(["text", "hardBreak", "horizontalRule", "mention", "mangoEntityLink", "mangoAttachmentImage"]);
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function safeColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}
function positiveInteger(value, maximum = 1e5) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= maximum;
}
function validateAttributes(kind, value, allowed, path) {
  if (value === void 0) return null;
  if (!isRecord(value)) return `${path}.attrs must be an object`;
  for (const [name, attribute] of Object.entries(value)) {
    if (!allowed.has(name)) return `${path}.attrs.${name} is not supported for ${kind}`;
    if (attribute !== null && typeof attribute !== "string" && typeof attribute !== "number" && typeof attribute !== "boolean" && !Array.isArray(attribute)) return `${path}.attrs.${name} has an invalid value`;
    if (Array.isArray(attribute) && !attribute.every((item) => typeof item === "number" && Number.isFinite(item))) {
      return `${path}.attrs.${name} must contain only numbers`;
    }
  }
  const attrs = value;
  if (kind === "mention" && (typeof attrs.userId !== "string" || !attrs.userId.trim())) {
    return `${path}.attrs.userId is required`;
  }
  if (kind === "mention" && !["normal", "urgent"].includes(String(attrs.kind))) {
    return `${path}.attrs.kind must be normal or urgent`;
  }
  if (kind === "mangoEntityLink") {
    if (!["node", "logic_gate", "project"].includes(String(attrs.entityType))) return `${path}.attrs.entityType is invalid`;
    if (typeof attrs.entityId !== "string" || !attrs.entityId.trim() || attrs.entityId.length > 160) return `${path}.attrs.entityId is required`;
    if (typeof attrs.label !== "string" || !attrs.label.trim() || attrs.label.length > 500) return `${path}.attrs.label is required`;
  }
  if (kind === "mangoAttachmentImage") {
    if (typeof attrs.attachmentId !== "string" || !attrs.attachmentId.trim()) return `${path}.attrs.attachmentId is required`;
    if (Object.values(attrs).some((attribute) => typeof attribute === "string" && /^(blob:|data:)/i.test(attribute))) {
      return `${path} cannot store transient Blob or data URLs`;
    }
  }
  if (kind === "link") {
    const href = attrs.href;
    if (typeof href !== "string" || !href.trim()) return `${path}.attrs.href is required`;
    if (!/^(https?:|mailto:|tel:|\/|#)/i.test(href.trim())) return `${path}.attrs.href uses an unsafe protocol`;
  }
  if (attrs.blockId !== void 0 && attrs.blockId !== null && (typeof attrs.blockId !== "string" || !attrs.blockId.trim() || attrs.blockId.length > 160)) {
    return `${path}.attrs.blockId is invalid`;
  }
  if (attrs.indentLevel !== void 0 && (!Number.isInteger(attrs.indentLevel) || Number(attrs.indentLevel) < 0 || Number(attrs.indentLevel) > 12)) {
    return `${path}.attrs.indentLevel must be an integer from 0 through 12`;
  }
  if (attrs.textAlign !== void 0 && attrs.textAlign !== null && !["left", "center", "right"].includes(String(attrs.textAlign))) {
    return `${path}.attrs.textAlign is invalid`;
  }
  if (kind === "heading" && !positiveInteger(attrs.level, 6)) return `${path}.attrs.level must be from 1 through 6`;
  if (kind === "orderedList" && attrs.start !== void 0 && attrs.start !== null && !positiveInteger(attrs.start)) return `${path}.attrs.start is invalid`;
  if (kind === "orderedList" && attrs.type !== void 0 && attrs.type !== null && !["1", "a", "A", "i", "I"].includes(String(attrs.type))) {
    return `${path}.attrs.type is invalid`;
  }
  if (kind === "taskItem" && attrs.checked !== void 0 && attrs.checked !== null && typeof attrs.checked !== "boolean") return `${path}.attrs.checked must be boolean`;
  if (kind === "table" && attrs.style !== void 0 && attrs.style !== null && !["auto", "fixed"].includes(String(attrs.style))) return `${path}.attrs.style is invalid`;
  if (kind === "tableCell" || kind === "tableHeader") {
    if (attrs.colspan !== void 0 && attrs.colspan !== null && !positiveInteger(attrs.colspan, 1e3)) return `${path}.attrs.colspan is invalid`;
    if (attrs.rowspan !== void 0 && attrs.rowspan !== null && !positiveInteger(attrs.rowspan, 1e3)) return `${path}.attrs.rowspan is invalid`;
    if (attrs.colwidth !== void 0 && attrs.colwidth !== null && (!Array.isArray(attrs.colwidth) || !attrs.colwidth.every((item) => positiveInteger(item)))) return `${path}.attrs.colwidth is invalid`;
    if (attrs.align !== void 0 && attrs.align !== null && !["left", "center", "right"].includes(String(attrs.align))) return `${path}.attrs.align is invalid`;
    if (attrs.backgroundColor !== void 0 && attrs.backgroundColor !== null && !safeColor(attrs.backgroundColor)) return `${path}.attrs.backgroundColor is invalid`;
  }
  if (kind === "textStyle") {
    if (attrs.fontSize !== void 0 && attrs.fontSize !== null) {
      const match = typeof attrs.fontSize === "string" ? /^(\d+)px$/.exec(attrs.fontSize) : null;
      if (!match || Number(match[1]) < 10 || Number(match[1]) > 28) return `${path}.attrs.fontSize is invalid`;
    }
    if (attrs.color !== void 0 && attrs.color !== null && !safeColor(attrs.color)) return `${path}.attrs.color is invalid`;
  }
  if (kind === "highlight" && attrs.color !== void 0 && attrs.color !== null && !safeColor(attrs.color)) return `${path}.attrs.color is invalid`;
  if (kind === "mangoAttachmentImage") {
    if (typeof attrs.mimeType !== "string" || !/^image\/(jpeg|png|gif|webp)$/i.test(attrs.mimeType)) return `${path}.attrs.mimeType is invalid`;
    for (const name of ["width", "height", "displayWidth", "displayHeight"]) {
      if (attrs[name] !== void 0 && attrs[name] !== null && !positiveInteger(attrs[name])) return `${path}.attrs.${name} is invalid`;
    }
    if (attrs.alignment !== void 0 && attrs.alignment !== null && !["left", "center", "right"].includes(String(attrs.alignment))) return `${path}.attrs.alignment is invalid`;
    if (attrs.position !== void 0 && attrs.position !== null && !["inline", "break"].includes(String(attrs.position))) return `${path}.attrs.position is invalid`;
    if (attrs.layout !== void 0 && attrs.layout !== null && !["content", "wide"].includes(String(attrs.layout))) return `${path}.attrs.layout is invalid`;
    if (attrs.linkHref !== void 0 && attrs.linkHref !== null && attrs.linkHref !== "" && !/^(https?:|mailto:|tel:|\/|#)/i.test(String(attrs.linkHref))) {
      return `${path}.attrs.linkHref uses an unsafe protocol`;
    }
    if (attrs.linkTarget !== void 0 && attrs.linkTarget !== null && attrs.linkTarget !== "" && !["_blank", "_self"].includes(String(attrs.linkTarget))) {
      return `${path}.attrs.linkTarget is invalid`;
    }
  }
  return null;
}
function validateNode(value, path, depth, count) {
  if (depth > 100) return `${path} is nested too deeply`;
  if (!isRecord(value)) return `${path} must be an object`;
  count.value += 1;
  if (count.value > 1e5) return "document contains too many nodes";
  const type = value.type;
  if (typeof type !== "string" || !(type in nodeAttributes)) return `${path}.type is unknown`;
  for (const key of Object.keys(value)) {
    if (!["type", "attrs", "content", "text", "marks"].includes(key)) return `${path} contains unsupported property ${key}`;
  }
  const attrError = validateAttributes(type, value.attrs, nodeAttributes[type], path);
  if (attrError) return attrError;
  if (type === "text") {
    if (typeof value.text !== "string") return `${path}.text is required`;
    if (value.content !== void 0) return `${path}.content is not valid on text`;
  } else if (value.text !== void 0) {
    return `${path}.text is only valid on text nodes`;
  }
  if (value.marks !== void 0) {
    if (type !== "text" && type !== "mention" || !Array.isArray(value.marks)) return `${path}.marks is invalid`;
    for (let index = 0; index < value.marks.length; index += 1) {
      const mark = value.marks[index];
      if (!isRecord(mark) || typeof mark.type !== "string" || !(mark.type in markAttributes)) {
        return `${path}.marks[${index}] is unknown`;
      }
      for (const key of Object.keys(mark)) if (!["type", "attrs"].includes(key)) return `${path}.marks[${index}] contains unsupported property ${key}`;
      const markError = validateAttributes(mark.type, mark.attrs, markAttributes[mark.type], `${path}.marks[${index}]`);
      if (markError) return markError;
    }
  }
  const content = value.content;
  if (content !== void 0 && !Array.isArray(content)) return `${path}.content must be an array`;
  if (content === void 0) return type === "doc" ? `${path}.content is required` : null;
  if (atomNodes.has(type)) return `${path}.content is not valid on ${type}`;
  if (["doc", "blockquote", "bulletList", "orderedList", "taskList", "listItem", "taskItem", "table", "tableRow", "tableCell", "tableHeader"].includes(type) && content.length === 0) {
    return `${path}.content cannot be empty for ${type}`;
  }
  for (let index = 0; index < content.length; index += 1) {
    const child = content[index];
    const childType = isRecord(child) ? child.type : void 0;
    if (textContainers.has(type) && (typeof childType !== "string" || !inlineNodes.has(childType))) {
      return `${path}.content[${index}] is not valid inside ${type}`;
    }
    if (type === "codeBlock" && childType !== "text") return `${path}.content[${index}] is not text`;
    if (listContainers.has(type) && childType !== (type === "taskList" ? "taskItem" : "listItem")) {
      return `${path}.content[${index}] is not a valid list item`;
    }
    if (type === "table" && childType !== "tableRow") return `${path}.content[${index}] is not a table row`;
    if (type === "tableRow" && childType !== "tableCell" && childType !== "tableHeader") {
      return `${path}.content[${index}] is not a table cell`;
    }
    if (blockContainers.has(type) && (typeof childType !== "string" || !blockNodes.has(childType))) {
      return `${path}.content[${index}] is not a valid block`;
    }
    if ((type === "listItem" || type === "taskItem") && (typeof childType !== "string" || !blockNodes.has(childType) || index === 0 && childType !== "paragraph")) {
      return `${path}.content[${index}] is not valid inside ${type}`;
    }
    const childError = validateNode(child, `${path}.content[${index}]`, depth + 1, count);
    if (childError) return childError;
  }
  return null;
}
function validateMangoTiptapDocumentStructure(value) {
  if (!isRecord(value)) return { valid: false, error: "document envelope must be an object" };
  for (const key of Object.keys(value)) {
    if (!["format", "schema_version", "document"].includes(key)) return { valid: false, error: `document envelope contains unsupported property ${key}` };
  }
  if (value.format !== MANGO_TIPTAP_FORMAT) return { valid: false, error: "document format is not mango-tiptap-json" };
  if (value.schema_version !== MANGO_TIPTAP_SCHEMA_VERSION) return { valid: false, error: "document schema version is not supported" };
  if (!isRecord(value.document) || value.document.type !== "doc") return { valid: false, error: "document root must be doc" };
  const nodeError = validateNode(value.document, "document", 0, { value: 0 });
  if (nodeError) return { valid: false, error: nodeError };
  return { valid: true, value };
}
function validateMangoTiptapDocument(value) {
  return validateMangoTiptapDocumentStructure(value);
}

// src/modules/editor/tiptap/mangoTiptapYjs.ts
import { getSchema } from "@tiptap/core";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";

// src/modules/editor/tiptap/mangoTiptapExtensions.ts
import { Extension, Node, mergeAttributes } from "@tiptap/core";
import { FileHandler } from "@tiptap/extension-file-handler";
import Highlight from "@tiptap/extension-highlight";
import Mention from "@tiptap/extension-mention";
import { TableKit } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import TextAlign from "@tiptap/extension-text-align";
import { Color, FontSize, TextStyle } from "@tiptap/extension-text-style";
import StarterKit from "@tiptap/starter-kit";
import { NodeSelection, Plugin, TextSelection } from "@tiptap/pm/state";

// src/modules/company-explorer/CompanyExplorerEntityIcon.tsx
import React from "react";
import { jsx } from "react/jsx-runtime";
var SVG_NAMESPACE = "http://www.w3.org/2000/svg";
var SVG_DOM_ATTRIBUTE_NAMES = {
  gradientUnits: "gradientUnits",
  stopColor: "stop-color",
  stopOpacity: "stop-opacity",
  strokeLinecap: "stroke-linecap",
  strokeLinejoin: "stroke-linejoin",
  strokeOpacity: "stroke-opacity",
  strokeWidth: "stroke-width"
};
var NODE_BODY_PATH = "M3.7 1.7h5.45l3.15 3.15v9.45H3.7z";
var NODE_DETAIL_PATH = "M9.15 1.7v3.15h3.15M5.55 7.25h4.9M5.55 9.55h4.9M5.55 11.85h3.25";
var PROJECT_BODY_PATH = "M2.3 3.1h11.4v9.8H2.3z";
var PROJECT_DETAIL_PATH = "M4.1 5.25h3.2M4.1 7.85h5.7M4.1 10.45h3.9";
var PROJECT_CHECKS_PATH = "M11.25 5.15h1.3v1.3h-1.3zM11.25 7.45h1.3v1.3h-1.3zM11.25 9.75h1.3v1.3h-1.3z";
var LOGIC_GATE_CONNECTION_PATH = "M1.4 5.25h3.05M1.4 10.75h3.05M11.7 8h2.9";
var LOGIC_GATE_BODY_PATH = "M4.35 3.55h3.35c2.45 0 4.45 1.95 4.45 4.45s-2 4.45-4.45 4.45H4.35z";
function iconSpecs(kind, tone, id) {
  if (kind === "node") {
    const stroke = tone === "inverse" ? "#ffffff" : tone === "orange" ? "#ff9708" : `url(#${id})`;
    return [
      ...tone === "default" ? [{
        tag: "defs",
        attrs: {},
        children: [{
          tag: "linearGradient",
          attrs: { id, x1: "8", y1: "1.7", x2: "8", y2: "14.3", gradientUnits: "userSpaceOnUse" },
          children: [
            { tag: "stop", attrs: { stopColor: "#33ddd5" } },
            { tag: "stop", attrs: { offset: "1", stopColor: "#19a8ff" } }
          ]
        }]
      }] : [],
      { tag: "path", attrs: { d: NODE_BODY_PATH, fill: "none", stroke, strokeWidth: "1.35", strokeLinejoin: "round" } },
      { tag: "path", attrs: { d: NODE_DETAIL_PATH, fill: "none", stroke, strokeWidth: "1.05", strokeLinecap: "round" } }
    ];
  }
  if (kind === "project") {
    const stroke = tone === "inverse" ? "#ffffff" : tone === "orange" ? "#ff9708" : "#2563eb";
    const fill = tone === "inverse" ? "rgba(255,255,255,0.10)" : tone === "orange" ? "rgba(255,151,8,0.10)" : "rgba(37,99,235,0.10)";
    return [
      { tag: "path", attrs: { d: PROJECT_BODY_PATH, fill, stroke, strokeWidth: "1.25", strokeLinejoin: "round" } },
      { tag: "path", attrs: { d: PROJECT_DETAIL_PATH, fill: "none", stroke, strokeWidth: "1.05", strokeLinecap: "round" } },
      { tag: "path", attrs: { d: PROJECT_CHECKS_PATH, fill: stroke } }
    ];
  }
  return [
    {
      tag: "defs",
      attrs: {},
      children: [{
        tag: "linearGradient",
        attrs: { id, x1: "1.4", y1: "3.55", x2: "14.6", y2: "12.45", gradientUnits: "userSpaceOnUse" },
        children: [
          { tag: "stop", attrs: { stopColor: "#7cff9b" } },
          { tag: "stop", attrs: { offset: "0.58", stopColor: "#19f07a" } },
          { tag: "stop", attrs: { offset: "1", stopColor: "#00c86f" } }
        ]
      }]
    },
    {
      tag: "path",
      attrs: { d: LOGIC_GATE_CONNECTION_PATH, fill: "none", stroke: `url(#${id})`, strokeWidth: "1.25", strokeLinecap: "round" }
    },
    {
      tag: "path",
      attrs: { d: LOGIC_GATE_BODY_PATH, fill: "none", stroke: `url(#${id})`, strokeWidth: "1.35", strokeLinejoin: "round" }
    },
    { tag: "circle", attrs: { cx: "4.35", cy: "5.25", r: "0.85", fill: "#19f07a" } },
    { tag: "circle", attrs: { cx: "4.35", cy: "10.75", r: "0.85", fill: "#19f07a" } },
    { tag: "circle", attrs: { cx: "12.15", cy: "8", r: "0.85", fill: "#19f07a" } }
  ];
}
function appendDOMSpec(ownerDocument, parent, spec) {
  const element = ownerDocument.createElementNS(SVG_NAMESPACE, spec.tag);
  Object.entries(spec.attrs).forEach(([name, value]) => {
    element.setAttribute(SVG_DOM_ATTRIBUTE_NAMES[name] ?? name, String(value));
  });
  spec.children?.forEach((child) => appendDOMSpec(ownerDocument, element, child));
  parent.appendChild(element);
}
var explorerEntityDOMIconSequence = 0;
function createExplorerEntityIconElement(ownerDocument, kind, tone = "default") {
  explorerEntityDOMIconSequence += 1;
  const id = `mango-${kind}-dom-icon-${explorerEntityDOMIconSequence}`;
  const svg = ownerDocument.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "15");
  svg.setAttribute("height", "15");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.style.display = "block";
  svg.style.flexShrink = "0";
  iconSpecs(kind, tone, id).forEach((spec) => appendDOMSpec(ownerDocument, svg, spec));
  return svg;
}

// src/auth/cognitoAuth.ts
var COGNITO_PASSWORD_RESET_SECONDS = 60 * 60;
var currentUserCacheGeneration = 0;
function getAuthSessionCacheGeneration() {
  return currentUserCacheGeneration;
}

// src/modules/node-map/NodeRecordStore.ts
var nodeRecordStoreAuthGeneration = getAuthSessionCacheGeneration();

// src/modules/editor/editorEntityLinks.ts
function editorEntityTypeLabel(type) {
  if (type === "logic_gate") return "Logic Gate";
  return type === "project" ? "Project" : "Node";
}
function createEditorEntityIconElement(ownerDocument, entityType) {
  const icon = createExplorerEntityIconElement(ownerDocument, entityType);
  icon.classList.add("mango-editor-entity-icon", `mango-editor-entity-icon--${entityType}`);
  return icon;
}

// src/modules/editor/tiptap/mangoTiptapExtensions.ts
import { Editor } from "@tiptap/core";
var mangoBlockNodeNames = [
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "table"
];
function newBlockID() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `mango-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
function parsedNumberAttribute(element, name) {
  const raw = element.getAttribute(name);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
var MangoAttachmentImage = Node.create({
  name: "mangoAttachmentImage",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      attachmentId: { default: "", parseHTML: (element) => element.getAttribute("data-attachment-id") ?? "" },
      filename: { default: "", parseHTML: (element) => element.getAttribute("data-filename") ?? "" },
      mimeType: { default: "", parseHTML: (element) => element.getAttribute("data-mime-type") ?? "" },
      width: { default: null, parseHTML: (element) => parsedNumberAttribute(element, "data-width") },
      height: { default: null, parseHTML: (element) => parsedNumberAttribute(element, "data-height") },
      displayWidth: { default: null, parseHTML: (element) => parsedNumberAttribute(element, "data-display-width") },
      displayHeight: { default: null, parseHTML: (element) => parsedNumberAttribute(element, "data-display-height") },
      alignment: {
        default: "center",
        parseHTML: (element) => ["left", "center", "right"].includes(element.getAttribute("data-alignment") ?? "") ? element.getAttribute("data-alignment") : "center"
      },
      position: {
        default: "break",
        parseHTML: (element) => ["inline", "break"].includes(element.getAttribute("data-position") ?? "") ? element.getAttribute("data-position") : "break"
      },
      layout: {
        default: "content",
        parseHTML: (element) => ["content", "wide"].includes(element.getAttribute("data-layout") ?? "") ? element.getAttribute("data-layout") : "content"
      },
      alt: { default: "", parseHTML: (element) => element.getAttribute("aria-label") ?? "" },
      title: { default: "", parseHTML: (element) => element.getAttribute("title") ?? "" },
      linkHref: { default: "", parseHTML: (element) => element.getAttribute("data-link-href") ?? "" },
      linkTarget: { default: "", parseHTML: (element) => element.getAttribute("data-link-target") ?? "" },
      linkRel: { default: "", parseHTML: (element) => element.getAttribute("data-link-rel") ?? "" },
      linkTitle: { default: "", parseHTML: (element) => element.getAttribute("data-link-title") ?? "" }
    };
  },
  parseHTML() {
    return [{ tag: "mango-attachment-image[data-attachment-id]" }];
  },
  renderHTML({ HTMLAttributes }) {
    const { attachmentId, filename, mimeType, width, height, displayWidth, displayHeight, alignment, position, layout, alt, title, linkHref, linkTarget, linkRel, linkTitle } = HTMLAttributes;
    return ["mango-attachment-image", mergeAttributes({
      "data-attachment-id": attachmentId,
      "data-filename": filename,
      "data-mime-type": mimeType,
      "data-width": width,
      "data-height": height,
      "data-display-width": displayWidth,
      "data-display-height": displayHeight,
      "data-alignment": alignment,
      "data-position": position,
      "data-layout": layout,
      "data-link-href": linkHref,
      "data-link-target": linkTarget,
      "data-link-rel": linkRel,
      "data-link-title": linkTitle,
      "aria-label": alt || filename || "Attached image",
      title
    })];
  }
});
var MangoBlockIdentity = Extension.create({
  name: "mangoBlockIdentity",
  addGlobalAttributes() {
    return [{
      types: mangoBlockNodeNames,
      attributes: {
        blockId: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-mango-block-id"),
          renderHTML: (attributes) => attributes.blockId ? { "data-mango-block-id": attributes.blockId } : {}
        }
      }
    }, {
      types: ["paragraph", "heading"],
      attributes: {
        indentLevel: {
          default: 0,
          parseHTML: (element) => Number(element.getAttribute("data-indent-level") || 0),
          renderHTML: (attributes) => attributes.indentLevel ? { "data-indent-level": attributes.indentLevel, style: `margin-left: ${Number(attributes.indentLevel) * 24}px` } : {}
        }
      }
    }, {
      types: ["table"],
      attributes: {
        style: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-mango-table-layout"),
          renderHTML: (attributes) => attributes.style === "fixed" ? { "data-mango-table-layout": "fixed", style: "table-layout: fixed" } : {}
        }
      }
    }, {
      types: ["tableCell", "tableHeader"],
      attributes: {
        align: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-mango-cell-align"),
          renderHTML: (attributes) => ["left", "center", "right"].includes(attributes.align) ? { "data-mango-cell-align": attributes.align, style: `text-align: ${attributes.align}` } : {}
        },
        backgroundColor: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-mango-cell-background"),
          renderHTML: (attributes) => typeof attributes.backgroundColor === "string" && /^#[0-9a-f]{6}$/i.test(attributes.backgroundColor) ? { "data-mango-cell-background": attributes.backgroundColor, style: `background-color: ${attributes.backgroundColor}` } : {}
        }
      }
    }];
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction: (transactions, _oldState, newState) => {
        if (!transactions.some((transaction2) => transaction2.docChanged)) return null;
        const transaction = newState.tr;
        newState.doc.descendants((node, position) => {
          if (mangoBlockNodeNames.includes(node.type.name) && !node.attrs.blockId) {
            transaction.setNodeMarkup(position, void 0, { ...node.attrs, blockId: newBlockID() });
          }
        });
        return transaction.steps.length > 0 ? transaction : null;
      }
    })];
  }
});
function createMangoTiptapExtensions(options) {
  const extensions = [
    StarterKit.configure({
      link: {
        autolink: true,
        linkOnPaste: true,
        openOnClick: !options.editable,
        defaultProtocol: "https",
        protocols: ["http", "https", "mailto", "tel"],
        HTMLAttributes: { rel: "noopener noreferrer nofollow" }
      },
      underline: {},
      undoRedo: options.collaboration ? false : { depth: 200, newGroupDelay: 500 }
    }),
    TextStyle,
    FontSize,
    Color,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right"] }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({
      table: { resizable: true, allowTableNodeSelection: true },
      tableCell: {},
      tableHeader: {},
      tableRow: {}
    }),
    Mention.extend({
      addAttributes() {
        return {
          userId: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-mango-user-id"),
            renderHTML: () => ({})
          },
          label: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-mango-user-label"),
            renderHTML: () => ({})
          },
          kind: {
            default: "normal",
            parseHTML: (element) => element.getAttribute("data-mango-mention-kind") ?? "normal",
            renderHTML: () => ({})
          }
        };
      },
      renderHTML({ node, HTMLAttributes }) {
        return ["span", mergeAttributes(HTMLAttributes, {
          "data-type": "mention",
          "data-mango-user-id": node.attrs.userId,
          "data-mango-user-label": node.attrs.label,
          "data-mango-mention-kind": node.attrs.kind,
          class: `mango-tiptap-mention mango-tiptap-mention--${node.attrs.kind === "urgent" ? "urgent" : "normal"}`
        }), `${node.attrs.kind === "urgent" ? "!" : "@"}${String(node.attrs.label || "user")}`];
      }
    }).configure({
      HTMLAttributes: { class: "mango-tiptap-mention" },
      renderText: ({ node }) => `${node.attrs.kind === "urgent" ? "!" : "@"}${String(node.attrs.label || "user")}`,
      deleteTriggerWithBackspace: true,
      suggestions: ["normal", "urgent"].map((kind) => ({
        char: kind === "urgent" ? "!" : "@",
        items: ({ query }) => {
          const normalized = query.trim().toLowerCase();
          return (options.mentionUsers ?? []).filter((user) => !normalized || user.name.toLowerCase().includes(normalized) || user.email?.toLowerCase().includes(normalized)).slice(0, 20).map((user) => ({ id: user.userID, userId: user.userID, label: user.name }));
        },
        command: ({ editor, range, props }) => {
          const value = props;
          editor.chain().focus().insertContentAt(range, [{
            type: "mention",
            attrs: { userId: value.userId || value.id, label: value.label || "user", kind }
          }, { type: "text", text: " " }]).run();
        },
        render: () => {
          let menu = null;
          let selectedIndex = 0;
          let current = null;
          const close = () => {
            menu?.remove();
            menu = null;
            current = null;
          };
          const paint = () => {
            if (!menu || !current) return;
            menu.replaceChildren();
            const items = current.items;
            selectedIndex = Math.max(0, Math.min(selectedIndex, Math.max(0, items.length - 1)));
            items.forEach((item, index) => {
              const button = document.createElement("button");
              button.type = "button";
              button.setAttribute("role", "option");
              button.setAttribute("aria-selected", index === selectedIndex ? "true" : "false");
              button.textContent = item.label || item.userId || "User";
              Object.assign(button.style, {
                display: "block",
                width: "100%",
                border: "0",
                borderRadius: "5px",
                padding: "6px 8px",
                textAlign: "left",
                cursor: "pointer",
                background: index === selectedIndex ? "#e0f2fe" : "#ffffff"
              });
              button.addEventListener("mousedown", (event) => {
                event.preventDefault();
                current?.command(item);
              });
              menu?.appendChild(button);
            });
            const rect = current.clientRect?.();
            if (rect) {
              menu.style.left = `${Math.round(rect.left)}px`;
              menu.style.top = `${Math.round(rect.bottom + 4)}px`;
            }
          };
          return {
            onStart: (props) => {
              if (typeof document === "undefined") return;
              close();
              current = props;
              menu = document.createElement("div");
              menu.setAttribute("role", "listbox");
              menu.setAttribute("aria-label", kind === "urgent" ? "Urgently mention people" : "Mention people");
              menu.setAttribute("data-mango-tiptap-mention-menu", "true");
              Object.assign(menu.style, {
                position: "fixed",
                zIndex: "2100",
                minWidth: "180px",
                maxHeight: "240px",
                overflowY: "auto",
                padding: "4px",
                border: "1px solid #cbd5e1",
                borderRadius: "8px",
                background: "#ffffff",
                boxShadow: "0 8px 24px rgba(15,23,42,.18)"
              });
              document.body.appendChild(menu);
              paint();
            },
            onUpdate: (props) => {
              current = props;
              selectedIndex = 0;
              paint();
            },
            onKeyDown: ({ event }) => {
              if (!current) return false;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const direction = event.key === "ArrowDown" ? 1 : -1;
                selectedIndex = (selectedIndex + direction + current.items.length) % Math.max(1, current.items.length);
                paint();
                return true;
              }
              if ((event.key === "Enter" || event.key === "Tab") && current.items[selectedIndex]) {
                event.preventDefault();
                current.command(current.items[selectedIndex]);
                return true;
              }
              if (event.key === "Escape") {
                close();
                return true;
              }
              return false;
            },
            onExit: close
          };
        }
      }))
    }),
    Mention.extend({
      name: "mangoEntityLink",
      addKeyboardShortcuts() {
        return {
          Backspace: () => {
            const { state, view } = this.editor;
            const { selection } = state;
            let from = -1;
            let to = -1;
            let label = "";
            if (selection instanceof NodeSelection && selection.node.type.name === "mangoEntityLink") {
              from = selection.from;
              to = selection.to;
              label = String(selection.node.attrs.label || "Entity");
            } else if (selection.empty && selection.$from.nodeBefore?.type.name === "mangoEntityLink") {
              const entityNode = selection.$from.nodeBefore;
              from = selection.from - entityNode.nodeSize;
              to = selection.from;
              label = String(entityNode.attrs.label || "Entity");
            }
            if (from < 0 || to < from || !label) return false;
            const transaction = state.tr.replaceWith(from, to, state.schema.text(label));
            transaction.setSelection(TextSelection.create(transaction.doc, from + label.length));
            view.dispatch(transaction.scrollIntoView());
            return true;
          }
        };
      },
      addAttributes() {
        return {
          entityType: {
            default: "node",
            parseHTML: (element) => element.getAttribute("data-mango-entity-type") ?? "node",
            renderHTML: () => ({})
          },
          entityId: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-mango-entity-id"),
            renderHTML: () => ({})
          },
          label: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-mango-entity-label") ?? element.textContent,
            renderHTML: () => ({})
          }
        };
      },
      parseHTML() {
        return [{ tag: 'span[data-mango-entity-link="true"]' }, { tag: 'a[data-mango-entity-link="true"]' }];
      },
      renderHTML({ node, HTMLAttributes }) {
        const type = String(node.attrs.entityType || "node");
        const entityType = type === "logic_gate" || type === "project" ? type : "node";
        const label = String(node.attrs.label || "Entity");
        const ownerDocument = globalThis.document;
        const icon = ownerDocument ? createEditorEntityIconElement(ownerDocument, entityType) : ["span", { "aria-hidden": "true", class: `mango-editor-entity-icon mango-editor-entity-icon--${entityType}` }];
        return ["span", mergeAttributes(HTMLAttributes, {
          "data-mango-entity-link": "true",
          "data-mango-entity-type": entityType,
          "data-mango-entity-id": node.attrs.entityId,
          "data-mango-entity-label": label,
          role: "link",
          tabindex: "0",
          "aria-label": `Open ${editorEntityTypeLabel(entityType)} ${label}`,
          class: `mango-editor-entity-link mango-editor-entity-link--${entityType}`
        }), icon, ["span", { class: "mango-editor-entity-label" }, label]];
      }
    }).configure({
      renderText: ({ node }) => String(node.attrs.label || "Entity"),
      deleteTriggerWithBackspace: false,
      suggestions: [{
        char: "#",
        allowSpaces: true,
        items: async ({ query }) => {
          if (!options.searchEntityLinks) return [];
          try {
            return await options.searchEntityLinks(query);
          } catch (cause) {
            options.onEntityLinkSearchError?.(cause instanceof Error ? cause.message : "Unable to search workspace entities");
            return [];
          }
        },
        command: ({ editor, range, props }) => {
          const entity = props;
          editor.chain().focus().insertContentAt(range, [{
            type: "mangoEntityLink",
            attrs: { entityType: entity.entityType, entityId: entity.entityID, label: entity.label }
          }, { type: "text", text: " " }]).run();
        },
        render: () => {
          let menu = null;
          let selectedIndex = 0;
          let current = null;
          const close = () => {
            menu?.remove();
            menu = null;
            current = null;
          };
          const paint = () => {
            if (!menu || !current) return;
            menu.replaceChildren();
            selectedIndex = Math.max(0, Math.min(selectedIndex, Math.max(0, current.items.length - 1)));
            current.items.forEach((item, index) => {
              const button = document.createElement("button");
              button.type = "button";
              button.setAttribute("role", "option");
              button.setAttribute("aria-selected", index === selectedIndex ? "true" : "false");
              button.dataset.mangoEditorEntityType = item.entityType;
              Object.assign(button.style, {
                display: "grid",
                gridTemplateColumns: "18px minmax(0,1fr) auto",
                alignItems: "center",
                gap: "7px",
                width: "100%",
                border: "0",
                borderRadius: "6px",
                padding: "7px 8px",
                textAlign: "left",
                cursor: "pointer",
                background: index === selectedIndex ? "#e0f2fe" : "#ffffff",
                color: "#0f172a"
              });
              const icon = createEditorEntityIconElement(document, item.entityType);
              const label = document.createElement("span");
              label.textContent = item.label;
              label.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:750";
              const type = document.createElement("span");
              type.textContent = editorEntityTypeLabel(item.entityType);
              type.style.cssText = "font-size:10px;color:#64748b;font-weight:700";
              button.append(icon, label, type);
              button.addEventListener("mousedown", (event) => {
                event.preventDefault();
                current?.command(item);
              });
              menu?.appendChild(button);
            });
            const rect = current.clientRect?.();
            if (rect) {
              menu.style.left = `${Math.round(rect.left)}px`;
              menu.style.top = `${Math.round(rect.bottom + 4)}px`;
            }
          };
          return {
            onStart: (props) => {
              if (typeof document === "undefined") return;
              close();
              current = props;
              menu = document.createElement("div");
              menu.setAttribute("role", "listbox");
              menu.setAttribute("aria-label", "Link a Node, Logic Gate, or Project");
              menu.setAttribute("data-mango-tiptap-entity-menu", "true");
              Object.assign(menu.style, {
                position: "fixed",
                zIndex: "2100",
                minWidth: "280px",
                maxWidth: "min(420px, calc(100vw - 16px))",
                maxHeight: "280px",
                overflowY: "auto",
                padding: "4px",
                border: "1px solid #cbd5e1",
                borderRadius: "8px",
                background: "#ffffff",
                boxShadow: "0 8px 24px rgba(15,23,42,.18)"
              });
              document.body.appendChild(menu);
              paint();
            },
            onUpdate: (props) => {
              current = props;
              selectedIndex = 0;
              paint();
            },
            onKeyDown: ({ event }) => {
              if (!current) return false;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const direction = event.key === "ArrowDown" ? 1 : -1;
                selectedIndex = (selectedIndex + direction + current.items.length) % Math.max(1, current.items.length);
                paint();
                return true;
              }
              if ((event.key === "Enter" || event.key === "Tab" && !event.shiftKey) && current.items[selectedIndex]) {
                event.preventDefault();
                current.command(current.items[selectedIndex]);
                return true;
              }
              if (event.key === "Escape") {
                close();
                return true;
              }
              return false;
            },
            onExit: close
          };
        }
      }]
    }),
    options.attachmentImageExtension ?? MangoAttachmentImage,
    MangoBlockIdentity
  ];
  if (options.onImageFiles) {
    extensions.push(FileHandler.configure({
      allowedMimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
      consumePasteEvent: true,
      onPaste: (_editor, files) => options.onImageFiles?.(files, null),
      onDrop: (_editor, files, position) => options.onImageFiles?.(files, position)
    }));
  }
  return extensions;
}

// src/modules/editor/tiptap/mangoTiptapYjs.ts
var MANGO_TIPTAP_SCHEMA = getSchema(createMangoTiptapExtensions({ editable: false }));
function mangoProsemirrorJSONToYDoc(document2, field = "default") {
  return prosemirrorJSONToYDoc(MANGO_TIPTAP_SCHEMA, document2, field);
}

// scripts/node-v2-collaboration-server.ts
var { Pool } = pg;
var MAX_AWARENESS_BYTES = 16 * 1024;
var MAX_AWARENESS_CLIENTS = 100;
function required(value, name) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${name}_required`);
  return normalized;
}
function decodeBase64URL(value) {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}
function verifyNodeV2CollaborationTicket(token, secret, documentName, now = /* @__PURE__ */ new Date()) {
  const [body, signature, ...extra] = String(token).split(".");
  if (!body || !signature || extra.length > 0) throw new Error("node_v2_collaboration_ticket_invalid");
  const expected = createHmac("sha256", required(secret, "collaboration_ticket_secret")).update(body).digest();
  const supplied = decodeBase64URL(signature);
  if (expected.byteLength !== supplied.byteLength || !timingSafeEqual(expected, supplied)) {
    throw new Error("node_v2_collaboration_ticket_invalid");
  }
  let payload;
  try {
    payload = JSON.parse(decodeBase64URL(body).toString("utf8"));
  } catch {
    throw new Error("node_v2_collaboration_ticket_invalid");
  }
  const identity = parseNodeTextboxDocumentName(documentName);
  const nowSeconds = Math.floor(now.getTime() / 1e3);
  if (payload.v !== 1 || payload.type !== "node-v2-collaboration" || payload.company_id !== identity.companyId || payload.node_id !== identity.nodeId || payload.textbox_id !== identity.textboxId || !payload.user_id || !payload.client_id || Buffer.byteLength(payload.client_id, "utf8") > 160 || !Number.isSafeInteger(payload.issued_at) || !Number.isSafeInteger(payload.expires_at) || payload.issued_at > nowSeconds + 60 || payload.expires_at < nowSeconds || payload.expires_at - payload.issued_at > 180) {
    throw new Error("node_v2_collaboration_ticket_invalid");
  }
  return payload;
}
function jsonText(node) {
  if (node.type === "text") return typeof node.text === "string" ? node.text : "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "mention") {
    const attrs = node.attrs;
    return `${attrs?.kind === "urgent" ? "!" : "@"}${String(attrs?.label ?? "user")}`;
  }
  if (node.type === "mangoEntityLink") {
    const attrs = node.attrs;
    return String(attrs?.label ?? "Entity");
  }
  const children = Array.isArray(node.content) ? node.content.map((child) => jsonText(child)).join("") : "";
  return ["paragraph", "heading", "blockquote", "codeBlock", "listItem", "taskItem", "tableCell", "tableHeader"].includes(String(node.type)) ? `${children}
` : children;
}
function materializeNodeV2Document(document2) {
  const documentJson = {
    format: MANGO_TIPTAP_FORMAT,
    schema_version: MANGO_TIPTAP_SCHEMA_VERSION,
    document: yDocToProsemirrorJSON(document2, "default")
  };
  const validation = validateMangoTiptapDocument(documentJson);
  if (!validation.valid) throw new Error(`node_v2_yjs_schema_invalid:${validation.error}`);
  return {
    documentJson: validation.value,
    documentSchemaVersion: MANGO_TIPTAP_SCHEMA_VERSION,
    plainText: jsonText(validation.value.document).trimEnd()
  };
}
async function isAuthorized(pool, documentName, userID) {
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
    [identity.companyId, identity.nodeId, identity.textboxId, userID]
  );
  return result.rows[0]?.allowed === true;
}
function safeLog(event, values = {}) {
  process.stdout.write(`${JSON.stringify({ service: "node-v2-collaboration", event, ...values, timestamp: (/* @__PURE__ */ new Date()).toISOString() })}
`);
}
function createNodeV2CollaborationServer(options = {}) {
  const databaseURL = options.databaseURL ?? process.env.DATABASE_URL;
  const ticketSecret = options.ticketSecret ?? process.env.MANGORTS_REALTIME_TICKET_SECRET;
  const pool = options.pool ?? new Pool({
    connectionString: required(databaseURL, "database_url"),
    max: Number(process.env.NODE_V2_COLLAB_DB_POOL_SIZE || 12),
    statement_timeout: Number(process.env.NODE_V2_COLLAB_STATEMENT_TIMEOUT_MS || 15e3),
    application_name: "mangorts-node-v2-collaboration"
  });
  const secret = required(ticketSecret, "collaboration_ticket_secret");
  const metrics2 = {
    started_at: (/* @__PURE__ */ new Date()).toISOString(),
    connections_accepted: 0,
    connections_rejected: 0,
    active_connections: 0,
    durable_updates: 0,
    duplicate_updates: 0,
    durable_update_bytes: 0,
    persistence_failures: 0,
    compaction_failures: 0,
    awareness_rejections: 0,
    last_ack_transaction_ms: 0
  };
  const store = new NodeV2YjsPostgresStore({
    pool,
    materializeDocument: materializeNodeV2Document,
    maxUpdateBytes: Number(process.env.NODE_V2_COLLAB_MAX_UPDATE_BYTES || 8 * 1024 * 1024)
  });
  const persistence = new NodeV2YjsPostgresExtension({
    store,
    materializationDelayMs: Number(process.env.NODE_V2_COLLAB_MATERIALIZE_MS || 1500),
    async authorizeUpdate(payload) {
      const userID = payload.context?.actorUserId ?? "";
      if (!userID || !await isAuthorized(pool, payload.documentName, userID)) {
        throw new Error("node_v2_collaboration_write_revoked");
      }
    },
    async validateDocument(document2) {
      return materializeNodeV2Document(document2);
    },
    async onAcknowledgement(acknowledgement) {
      metrics2.durable_updates += 1;
      metrics2.durable_update_bytes += Number(acknowledgement.update_bytes || 0);
      metrics2.last_ack_transaction_ms = Number(acknowledgement.database_transaction_ms || 0);
      if (acknowledgement.duplicate) metrics2.duplicate_updates += 1;
    },
    async onPersistenceError(error, payload) {
      metrics2.persistence_failures += 1;
      safeLog("durability_quarantine", { document_name: payload.documentName, error: error instanceof Error ? error.message : "unknown" });
    },
    async onCompactionError(error, payload) {
      metrics2.compaction_failures += 1;
      safeLog("compaction_failed", { document_name: payload.documentName, reason: payload.reason, error: error instanceof Error ? error.message : "unknown" });
    }
  });
  const server = new Server({
    address: options.address ?? process.env.NODE_V2_COLLAB_ADDRESS ?? "127.0.0.1",
    port: options.port ?? Number(process.env.NODE_V2_COLLAB_PORT || 1234),
    quiet: options.quiet ?? false,
    stopOnSignals: false,
    debounce: 120,
    maxDebounce: 1e3,
    timeout: 6e4,
    extensions: [persistence],
    async onAuthenticate({ documentName, token }) {
      try {
        const ticket = verifyNodeV2CollaborationTicket(token, secret, documentName);
        if (!await isAuthorized(pool, documentName, ticket.user_id)) throw new Error("node_v2_collaboration_forbidden");
        metrics2.connections_accepted += 1;
        metrics2.active_connections += 1;
        return { actorUserId: ticket.user_id, clientId: ticket.client_id, expiresAt: ticket.expires_at };
      } catch (error) {
        metrics2.connections_rejected += 1;
        throw error;
      }
    },
    async connected({ documentName, connection }) {
      connection.sendStateless(JSON.stringify(await store.durabilityStatus(documentName)));
    },
    async onAwarenessUpdate({ states, documentName, instance }) {
      const encodedBytes = Buffer.byteLength(JSON.stringify(states), "utf8");
      if (states.length > MAX_AWARENESS_CLIENTS || encodedBytes > MAX_AWARENESS_BYTES) {
        metrics2.awareness_rejections += 1;
        instance.closeConnections(documentName);
        throw new Error("node_v2_awareness_limit_exceeded");
      }
    },
    async onDisconnect() {
      metrics2.active_connections = Math.max(0, metrics2.active_connections - 1);
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
        response.end(JSON.stringify(metrics2));
        return Promise.reject();
      }
      response.writeHead(404, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ error: "not_found" }));
      return Promise.reject();
    }
  });
  let stopped = false;
  return {
    server,
    pool,
    store,
    persistence,
    metrics: metrics2,
    async listen() {
      await server.listen();
      safeLog("listening", { address: server.configuration.address, port: server.address.port });
      return server.address;
    },
    async destroy() {
      if (stopped) return;
      stopped = true;
      await persistence.flush();
      await server.destroy();
      if (!options.pool) await pool.end();
      safeLog("stopped");
    }
  };
}
async function main() {
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
export {
  createNodeV2CollaborationServer,
  mangoProsemirrorJSONToYDoc,
  materializeNodeV2Document,
  verifyNodeV2CollaborationTicket
};
