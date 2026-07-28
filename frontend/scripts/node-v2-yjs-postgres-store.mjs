import { createHash, randomUUID } from "node:crypto";

import * as Y from "yjs";

const DOCUMENT_PREFIX = "node-textbox";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACK_TYPE = "node-v2-yjs.durable-ack.v1";
const ERROR_TYPE = "node-v2-yjs.durability-error.v1";
const DEFAULT_MAX_UPDATE_BYTES = 8 * 1024 * 1024;
const EMPTY_UPDATE = (() => {
  const document = new Y.Doc();
  const update = Y.encodeStateAsUpdate(document);
  document.destroy();
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

function encodeDurableSnapshot(document) {
  return Buffer.from(Y.encodeSnapshot(Y.snapshot(document))).toString("base64");
}

export function formatNodeTextboxDocumentName({ companyId, nodeId, textboxId, collaborationEpoch }) {
  return [
    DOCUMENT_PREFIX,
    assertUuid(companyId, "company_id"),
    assertUuid(nodeId, "node_id"),
    assertUuid(textboxId, "textbox_id"),
    assertUuid(collaborationEpoch, "collaboration_epoch"),
  ].join(":");
}

export function parseNodeTextboxDocumentName(documentName) {
  const [prefix, companyId, nodeId, textboxId, collaborationEpoch, ...extra] = String(documentName).split(":");
  if (prefix !== DOCUMENT_PREFIX || extra.length > 0) throw new Error("invalid_node_textbox_document_name");
  return {
    companyId: assertUuid(companyId, "company_id"),
    nodeId: assertUuid(nodeId, "node_id"),
    textboxId: assertUuid(textboxId, "textbox_id"),
    collaborationEpoch: assertUuid(collaborationEpoch, "collaboration_epoch"),
  };
}

export function isUpdateCoveredByStateVector(update, stateVector) {
  const missing = Y.diffUpdate(asUint8Array(update), asUint8Array(stateVector));
  return Buffer.from(missing).equals(Buffer.from(EMPTY_UPDATE));
}

async function rollbackQuietly(client) {
  try {
    await client.query("rollback");
  } catch {
    // The original database error is more useful than a secondary rollback error.
  }
}

export class NodeV2YjsPostgresStore {
  constructor({
    pool,
    materializeDocument = null,
    maxUpdateBytes = DEFAULT_MAX_UPDATE_BYTES,
    coveredUpdateRetentionDays = 7,
    automaticCheckpointRetentionDays = 14,
  }) {
    if (!pool || typeof pool.connect !== "function") throw new Error("node_v2_yjs_pool_required");
    if (!Number.isSafeInteger(maxUpdateBytes) || maxUpdateBytes <= 0) throw new Error("invalid_node_v2_yjs_max_update_bytes");
    this.pool = pool;
    this.materializeDocument = materializeDocument;
    this.maxUpdateBytes = maxUpdateBytes;
    this.coveredUpdateRetentionDays = coveredUpdateRetentionDays;
    this.automaticCheckpointRetentionDays = automaticCheckpointRetentionDays;
    this.durableStateCache = new Map();
  }

  #replaceDurableStateCache(documentName, collaborationEpoch, headSequence, mergedUpdate) {
    const document = new Y.Doc();
    Y.applyUpdate(document, mergedUpdate);
    this.durableStateCache.get(documentName)?.document.destroy();
    this.durableStateCache.set(documentName, { collaborationEpoch, headSequence, document });
    return document;
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
      [identity.companyId, identity.nodeId, identity.textboxId, collaborationEpoch, latestUpdateSequence],
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
        latestUpdateSequence,
      ],
    );
    const parts = [asUint8Array(checkpoint.checkpoint_payload), ...tailResult.rows.map((row) => asUint8Array(row.update_payload))];
    const mergedUpdate = parts.length === 1 ? parts[0] : Y.mergeUpdates(parts);
    return {
      checkpointId: checkpoint.checkpoint_id,
      checkpointSequence,
      mergedUpdate,
      stateVector: Y.encodeStateVectorFromUpdate(mergedUpdate),
      tailCount: tailResult.rowCount,
      tailBytes: tailResult.rows.reduce((total, row) => total + row.update_payload.byteLength, 0),
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
          where company_id = $1 and node_id = $2 and textbox_id = $3
            and collaboration_epoch = $4 and deleted_timestamp is null`,
        [identity.companyId, identity.nodeId, identity.textboxId, identity.collaborationEpoch],
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
    let document;
    try {
      await client.query("begin isolation level repeatable read read only");
      const textboxResult = await client.query(
        `select collaboration_epoch, latest_update_sequence
           from node_textboxes
          where company_id = $1 and node_id = $2 and textbox_id = $3
            and collaboration_epoch = $4 and deleted_timestamp is null`,
        [identity.companyId, identity.nodeId, identity.textboxId, identity.collaborationEpoch],
      );
      if (textboxResult.rowCount !== 1) throw new Error("node_v2_yjs_textbox_not_found");
      const collaborationEpoch = textboxResult.rows[0].collaboration_epoch;
      const latestUpdateSequence = numericSequence(textboxResult.rows[0].latest_update_sequence, "latest_update_sequence");
      const durable = await this.#loadDurableState(client, identity, collaborationEpoch, latestUpdateSequence);
      document = new Y.Doc();
      Y.applyUpdate(document, durable.mergedUpdate);
      await client.query("commit");
      return {
        type: ACK_TYPE,
        document_name: documentName,
        collaboration_epoch: collaborationEpoch,
        durable_head_sequence: latestUpdateSequence,
        state_vector_base64: Buffer.from(Y.encodeStateVector(document)).toString("base64"),
        durable_snapshot_base64: encodeDurableSnapshot(document),
        status_only: true,
      };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      document?.destroy();
      client.release();
    }
  }

  async appendUpdate(documentName, update, { updateId = randomUUID(), clientId, actorUserId = null } = {}) {
    const identity = parseNodeTextboxDocumentName(documentName);
    const payload = asUint8Array(update);
    if (payload.byteLength === 0) throw new Error("node_v2_yjs_empty_update");
    if (payload.byteLength > this.maxUpdateBytes) throw new Error("node_v2_yjs_update_too_large");
    // Decode before opening a transaction. Hocuspocus normally supplies a
    // valid Yjs update, but this keeps every direct/internal caller from ever
    // committing malformed bytes that would poison checkpoint-plus-tail replay.
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
          where company_id = $1 and node_id = $2 and textbox_id = $3
            and collaboration_epoch = $4 and deleted_timestamp is null
          for update`,
        [identity.companyId, identity.nodeId, identity.textboxId, identity.collaborationEpoch],
      );
      if (textboxResult.rowCount !== 1) throw new Error("node_v2_yjs_textbox_not_found");
      const collaborationEpoch = textboxResult.rows[0].collaboration_epoch;
      const durableHeadBefore = numericSequence(textboxResult.rows[0].latest_update_sequence, "latest_update_sequence");
      let latestUpdateSequence = durableHeadBefore;
      const cached = this.durableStateCache.get(documentName);
      const cacheMatchesDurableHead = cached?.collaborationEpoch === collaborationEpoch
        && cached.headSequence === durableHeadBefore;

      const duplicateResult = await client.query(
        `select update_sequence, update_id, update_sha256, update_payload
           from node_textbox_yjs_updates
          where company_id = $1 and node_id = $2 and textbox_id = $3 and collaboration_epoch = $4
            and (update_id = $5 or update_sha256 = $6)
          order by update_sequence`,
        [identity.companyId, identity.nodeId, identity.textboxId, collaborationEpoch, updateId, checksum],
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
            Buffer.from(payload),
          ],
        );
        updateSequence = numericSequence(insertResult.rows[0].update_sequence, "update_sequence");
        latestUpdateSequence = updateSequence;
        await client.query(
          `update node_textboxes
              set latest_update_sequence = $4, updated_timestamp = clock_timestamp()
            where company_id = $1 and node_id = $2 and textbox_id = $3`,
          [identity.companyId, identity.nodeId, identity.textboxId, updateSequence],
        );
      }

      // The process-local cache is only an acceleration. The locked database head decides
      // whether it is current; a restart or another worker's commit reloads checkpoint plus tail.
      const durableReload = cacheMatchesDurableHead
        ? null
        : await this.#loadDurableState(client, identity, collaborationEpoch, latestUpdateSequence);
      const tailStatsResult = await client.query(
        `select count(*)::integer as update_count,
                coalesce(sum(octet_length(update_payload)),0)::bigint as update_bytes
           from node_textbox_yjs_updates
          where company_id=$1 and node_id=$2 and textbox_id=$3 and collaboration_epoch=$4
            and update_sequence > coalesce((
              select max(through_update_sequence) from node_textbox_yjs_checkpoints
               where company_id=$1 and node_id=$2 and textbox_id=$3 and collaboration_epoch=$4
            ),0) and update_sequence <= $5`,
        [identity.companyId, identity.nodeId, identity.textboxId, collaborationEpoch, latestUpdateSequence],
      );
      await client.query("commit");

      let durableDocument;
      if (durableReload) {
        durableDocument = this.#replaceDurableStateCache(
          documentName,
          collaborationEpoch,
          latestUpdateSequence,
          durableReload.mergedUpdate,
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
        database_transaction_ms: Number((performance.now() - started).toFixed(3)),
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
          where company_id = $1 and node_id = $2 and textbox_id = $3
            and collaboration_epoch = $4 and deleted_timestamp is null
          for update`,
        [identity.companyId, identity.nodeId, identity.textboxId, identity.collaborationEpoch],
      );
      if (textboxResult.rowCount !== 1) throw new Error("node_v2_yjs_textbox_not_found");
      const collaborationEpoch = textboxResult.rows[0].collaboration_epoch;
      const latestUpdateSequence = numericSequence(textboxResult.rows[0].latest_update_sequence, "latest_update_sequence");
      const materializedThroughSequence = numericSequence(
        textboxResult.rows[0].materialized_through_sequence,
        "materialized_through_sequence",
      );
      const durable = await this.#loadDurableState(client, identity, collaborationEpoch, latestUpdateSequence);
      if (latestUpdateSequence === durable.checkpointSequence && latestUpdateSequence === materializedThroughSequence) {
        await client.query("commit");
        return {
          document_name: documentName,
          collaboration_epoch: collaborationEpoch,
          through_update_sequence: latestUpdateSequence,
          compacted: false,
          database_transaction_ms: Number((performance.now() - started).toFixed(3)),
        };
      }

      yDocument = new Y.Doc();
      Y.applyUpdate(yDocument, durable.mergedUpdate);
      const materialized = await this.materializeDocument(yDocument, {
        identity,
        collaborationEpoch,
        throughUpdateSequence: latestUpdateSequence,
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
          this.automaticCheckpointRetentionDays,
        ],
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
          this.coveredUpdateRetentionDays,
        ],
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
          latestUpdateSequence,
        ],
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
        database_transaction_ms: Number((performance.now() - started).toFixed(3)),
      };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      yDocument?.destroy();
      client.release();
    }
  }
}

export class NodeV2YjsPostgresExtension {
  constructor({
    store,
    operationCountThreshold = 512,
    updateBytesThreshold = 512 * 1024,
    materializationDelayMs = 30_000,
    changeBatchDelayMs = 75,
    authorizeUpdate = async () => {},
    onAcknowledgement = async () => {},
    onPersistenceError = () => {},
    onCompactionError = () => {},
    acceptsDocument = () => true,
  }) {
    if (!store || typeof store.loadDocument !== "function" || typeof store.appendUpdate !== "function" || typeof store.compactDocument !== "function") {
      throw new Error("yjs_store_required");
    }
    this.store = store;
    this.operationCountThreshold = operationCountThreshold;
    this.updateBytesThreshold = updateBytesThreshold;
    this.materializationDelayMs = materializationDelayMs;
    this.changeBatchDelayMs = changeBatchDelayMs;
    this.authorizeUpdate = authorizeUpdate;
    this.onAcknowledgement = onAcknowledgement;
    this.onPersistenceError = onPersistenceError;
    this.onCompactionError = onCompactionError;
    this.acceptsDocument = acceptsDocument;
    this.updateQueues = new Map();
    this.compactions = new Map();
    this.materializationTimers = new Map();
    this.pendingChangeBatches = new Map();
    this.failedDocumentInstances = new WeakSet();
  }

  async onLoadDocument({ document, documentName }) {
    if (!this.acceptsDocument(documentName)) return;
    const durable = await this.store.loadDocument(documentName);
    Y.applyUpdate(document, durable.mergedUpdate);
  }

  async afterUnloadDocument({ documentName }) {
    if (!this.acceptsDocument(documentName)) return;
    this.#flushChangeBatch(documentName);
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
    if (!this.acceptsDocument(payload.documentName)) return;
    return new Promise((resolve) => {
      const clientId = payload.context?.clientId || `hocuspocus:${payload.socketId || "server"}`;
      const actorUserId = payload.context?.actorUserId ?? null;
      const groupKey = `${clientId}:${actorUserId ?? "anonymous"}`;
      const existing = this.pendingChangeBatches.get(payload.documentName);
      if (existing && existing.groupKey !== groupKey) this.#flushChangeBatch(payload.documentName);

      let batch = this.pendingChangeBatches.get(payload.documentName);
      if (!batch) {
        batch = {
          groupKey,
          clientId,
          actorUserId,
          entries: [],
          bytes: 0,
          timer: setTimeout(() => this.#flushChangeBatch(payload.documentName), this.changeBatchDelayMs),
        };
        this.pendingChangeBatches.set(payload.documentName, batch);
      }
      batch.entries.push({ payload, resolve });
      batch.bytes += payload.update.byteLength;
      if (batch.bytes >= this.updateBytesThreshold) this.#flushChangeBatch(payload.documentName);
    });
  }

  #flushChangeBatch(documentName) {
    const batch = this.pendingChangeBatches.get(documentName);
    if (!batch) return this.updateQueues.get(documentName) ?? Promise.resolve();
    clearTimeout(batch.timer);
    this.pendingChangeBatches.delete(documentName);
    const representative = batch.entries[batch.entries.length - 1].payload;
    const mergedUpdate = batch.entries.length === 1
      ? batch.entries[0].payload.update
      : Y.mergeUpdates(batch.entries.map((entry) => entry.payload.update));
    const prior = this.updateQueues.get(documentName) ?? Promise.resolve();
    const current = prior
      .catch(() => {})
      .then(async () => {
        // Once one write fails, later changes from the same Hocuspocus Y.Doc may depend on
        // non-durable structs. Drop that old session and let reconnect replay from PostgreSQL.
        if (this.failedDocumentInstances.has(representative.document)) return;
        try {
          await this.authorizeUpdate(representative);
          const acknowledgement = await this.store.appendUpdate(documentName, mergedUpdate, {
            clientId: batch.clientId,
            actorUserId: batch.actorUserId,
          });
          const acknowledgementJSON = JSON.stringify(acknowledgement);
          for (const connection of new Set(batch.entries.map((entry) => entry.payload.connection).filter(Boolean))) {
            connection.sendStateless(acknowledgementJSON);
          }
          await this.onAcknowledgement(acknowledgement, representative);
          if (
            acknowledgement.uncheckpointed_update_count >= this.operationCountThreshold ||
            acknowledgement.uncheckpointed_update_bytes >= this.updateBytesThreshold
          ) {
            const reason = acknowledgement.uncheckpointed_update_count >= this.operationCountThreshold
              ? "operation_count"
              : "update_bytes";
            this.#scheduleCompaction(documentName, reason);
          } else {
            this.#scheduleMaterialization(documentName);
          }
        } catch (error) {
          if (representative.document && typeof representative.document === "object") {
            this.failedDocumentInstances.add(representative.document);
          }
          try {
            await this.onPersistenceError(error, representative);
          } catch {
            // Observability hooks must not prevent the durability failure response and disconnect.
          }
          try {
            const code = error instanceof Error && error.message.includes("editor_owner_text_limit_exceeded")
              ? "editor_owner_text_limit_exceeded"
              : "durable_commit_failed";
            const errorJSON = JSON.stringify({ type: ERROR_TYPE, code });
            for (const connection of new Set(batch.entries.map((entry) => entry.payload.connection).filter(Boolean))) {
              connection.sendStateless(errorJSON);
            }
          } catch {
            // A peer may already have closed while the database transaction was rolling back.
          }
          // Hocuspocus has already integrated and may have broadcast the update. Closing every
          // connection forces the next session to reload only checkpoint-plus-tail durable state.
          representative.instance.closeConnections(documentName);
        }
      })
      .finally(() => {
        for (const entry of batch.entries) entry.resolve();
      });
    this.updateQueues.set(documentName, current);
    current.finally(() => {
      if (this.updateQueues.get(documentName) === current) this.updateQueues.delete(documentName);
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
    const work = new Promise((resolve) => setTimeout(resolve, 0))
      .then(() => this.updateQueues.get(documentName))
      .then(() => this.store.compactDocument(documentName, reason))
      .catch(async (error) => {
        try {
          await this.onCompactionError(error, { documentName, reason });
        } catch {
          // Observability hooks cannot turn a handled background compaction failure into a rejection.
        }
      });
    this.compactions.set(documentName, work);
    work.finally(() => {
      if (this.compactions.get(documentName) === work) this.compactions.delete(documentName);
    });
  }

  async flush() {
    for (const documentName of [...this.pendingChangeBatches.keys()]) this.#flushChangeBatch(documentName);
    for (const [documentName, timer] of this.materializationTimers) {
      clearTimeout(timer);
      this.materializationTimers.delete(documentName);
      this.#scheduleCompaction(documentName, "idle");
    }
    while (this.updateQueues.size > 0 || this.compactions.size > 0) {
      await Promise.allSettled([...this.updateQueues.values(), ...this.compactions.values()]);
    }
  }
}

export const NODE_V2_YJS_DURABLE_ACK_TYPE = ACK_TYPE;
export const NODE_V2_YJS_DURABILITY_ERROR_TYPE = ERROR_TYPE;
