import { createHash, randomUUID } from "node:crypto";

import * as Y from "yjs";

const DOCUMENT_PREFIX = "editor-owner";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACK_TYPE = "node-v2-yjs.durable-ack.v1";
const DEFAULT_MAX_UPDATE_BYTES = 8 * 1024 * 1024;
const OWNER_STORAGE = Object.freeze({
  project: { table: "project_editor_documents", ownerColumn: "project_id" },
  logic_gate: { table: "logic_gate_editor_documents", ownerColumn: "logic_gate_id" },
});

function asUint8Array(value) {
  return value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(Buffer.from(value));
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertUuid(value, label) {
  if (!UUID_PATTERN.test(String(value))) throw new Error(`invalid_${label}`);
  return String(value).toLowerCase();
}

function numericSequence(value, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`invalid_${label}`);
  return result;
}

function encodeDocumentID(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 500) throw new Error("invalid_document_id");
  return Buffer.from(normalized, "utf8").toString("base64url");
}

function decodeDocumentID(value) {
  let result;
  try {
    result = Buffer.from(String(value), "base64url").toString("utf8");
  } catch {
    throw new Error("invalid_document_id");
  }
  if (!result || result.length > 500 || encodeDocumentID(result) !== value) throw new Error("invalid_document_id");
  return result;
}

function ownerStorage(ownerType) {
  const storage = OWNER_STORAGE[ownerType];
  if (!storage) throw new Error("invalid_editor_owner_type");
  return storage;
}

function encodeDurableSnapshot(document) {
  return Buffer.from(Y.encodeSnapshot(Y.snapshot(document))).toString("base64");
}

async function rollbackQuietly(client) {
  try { await client.query("rollback"); } catch { /* preserve the original error */ }
}

export function formatEditorOwnerDocumentName({ ownerType, companyId, ownerId, documentId, collaborationEpoch }) {
  ownerStorage(ownerType);
  return [
    DOCUMENT_PREFIX,
    ownerType,
    assertUuid(companyId, "company_id"),
    assertUuid(ownerId, "owner_id"),
    encodeDocumentID(documentId),
    assertUuid(collaborationEpoch, "collaboration_epoch"),
  ].join(":");
}

export function parseEditorOwnerDocumentName(documentName) {
  const [prefix, ownerType, companyId, ownerId, encodedDocumentId, collaborationEpoch, ...extra] = String(documentName).split(":");
  if (prefix !== DOCUMENT_PREFIX || extra.length > 0) throw new Error("invalid_editor_owner_document_name");
  ownerStorage(ownerType);
  return {
    ownerType,
    companyId: assertUuid(companyId, "company_id"),
    ownerId: assertUuid(ownerId, "owner_id"),
    documentId: decodeDocumentID(encodedDocumentId),
    collaborationEpoch: assertUuid(collaborationEpoch, "collaboration_epoch"),
  };
}

export class EditorOwnerYjsPostgresStore {
  constructor({ pool, seedDocument, materializeDocument, maxUpdateBytes = DEFAULT_MAX_UPDATE_BYTES, coveredUpdateRetentionDays = 7, automaticCheckpointRetentionDays = 14 }) {
    if (!pool || typeof pool.connect !== "function") throw new Error("editor_owner_yjs_pool_required");
    if (typeof seedDocument !== "function") throw new Error("editor_owner_yjs_seed_required");
    if (typeof materializeDocument !== "function") throw new Error("editor_owner_yjs_materializer_required");
    this.pool = pool;
    this.seedDocument = seedDocument;
    this.materializeDocument = materializeDocument;
    this.maxUpdateBytes = maxUpdateBytes;
    this.coveredUpdateRetentionDays = coveredUpdateRetentionDays;
    this.automaticCheckpointRetentionDays = automaticCheckpointRetentionDays;
    this.durableStateCache = new Map();
  }

  #replaceCache(documentName, collaborationEpoch, headSequence, mergedUpdate) {
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

  async #currentRow(client, identity, lock = false) {
    const storage = ownerStorage(identity.ownerType);
    const result = await client.query(
      `select collaboration_epoch,latest_update_sequence,materialized_through_sequence,document_json,plain_text,canonical_annotations
         from ${storage.table}
        where company_id=$1::uuid and ${storage.ownerColumn}=$2::uuid and document_id=$3
          and collaboration_epoch=$4::uuid and is_deleted=false${lock ? " for update" : ""}`,
      [identity.companyId, identity.ownerId, identity.documentId, identity.collaborationEpoch],
    );
    if (result.rowCount !== 1) throw new Error("editor_owner_yjs_document_not_found");
    return result.rows[0];
  }

  async #ensureSeedCheckpoint(client, identity, row) {
    const existing = await client.query(
      `select 1 from editor_owner_yjs_checkpoints
        where company_id=$1::uuid and owner_type=$2 and owner_id=$3::uuid and document_id=$4
          and collaboration_epoch=$5::uuid limit 1`,
      [identity.companyId, identity.ownerType, identity.ownerId, identity.documentId, identity.collaborationEpoch],
    );
    if (existing.rowCount > 0) return;
    if (numericSequence(row.latest_update_sequence, "latest_update_sequence") !== 0) throw new Error("editor_owner_yjs_checkpoint_missing");
    const document = await this.seedDocument(row.document_json, row.canonical_annotations ?? []);
    try {
      const checkpointPayload = Y.encodeStateAsUpdate(document);
      const stateVector = Y.encodeStateVector(document);
      await client.query(
        `insert into editor_owner_yjs_checkpoints(
           company_id,owner_type,owner_id,document_id,checkpoint_id,collaboration_epoch,
           through_update_sequence,checkpoint_payload,state_vector,document_json,plain_text,
           canonical_annotations,checkpoint_reason,retain_until
         ) values($1::uuid,$2,$3::uuid,$4,$5::uuid,$6::uuid,0,$7,$8,$9::jsonb,$10,$11::jsonb,'migration_seed',clock_timestamp()+interval '14 days')
         on conflict(company_id,owner_type,owner_id,document_id,collaboration_epoch,through_update_sequence) do nothing`,
        [identity.companyId, identity.ownerType, identity.ownerId, identity.documentId, randomUUID(), identity.collaborationEpoch,
          Buffer.from(checkpointPayload), Buffer.from(stateVector), JSON.stringify(row.document_json), String(row.plain_text ?? ""), JSON.stringify(row.canonical_annotations ?? [])],
      );
    } finally { document.destroy(); }
  }

  async #loadDurableState(client, identity, latestUpdateSequence) {
    const checkpointResult = await client.query(
      `select checkpoint_id,through_update_sequence,checkpoint_payload,state_vector
         from editor_owner_yjs_checkpoints
        where company_id=$1::uuid and owner_type=$2 and owner_id=$3::uuid and document_id=$4
          and collaboration_epoch=$5::uuid and through_update_sequence <= $6
        order by through_update_sequence desc,checkpoint_id desc limit 1`,
      [identity.companyId, identity.ownerType, identity.ownerId, identity.documentId, identity.collaborationEpoch, latestUpdateSequence],
    );
    if (checkpointResult.rowCount !== 1) throw new Error("editor_owner_yjs_checkpoint_missing");
    const checkpoint = checkpointResult.rows[0];
    const checkpointSequence = numericSequence(checkpoint.through_update_sequence, "checkpoint_sequence");
    const tailResult = await client.query(
      `select update_sequence,update_payload from editor_owner_yjs_updates
        where company_id=$1::uuid and owner_type=$2 and owner_id=$3::uuid and document_id=$4
          and collaboration_epoch=$5::uuid and update_sequence>$6 and update_sequence<=$7 order by update_sequence`,
      [identity.companyId, identity.ownerType, identity.ownerId, identity.documentId, identity.collaborationEpoch, checkpointSequence, latestUpdateSequence],
    );
    const parts = [asUint8Array(checkpoint.checkpoint_payload), ...tailResult.rows.map((item) => asUint8Array(item.update_payload))];
    const mergedUpdate = parts.length === 1 ? parts[0] : Y.mergeUpdates(parts);
    return {
      checkpointSequence,
      mergedUpdate,
      stateVector: Y.encodeStateVectorFromUpdate(mergedUpdate),
      tailCount: tailResult.rowCount,
      tailBytes: tailResult.rows.reduce((sum, item) => sum + item.update_payload.byteLength, 0),
    };
  }

  async loadDocument(documentName) {
    const identity = parseEditorOwnerDocumentName(documentName);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const row = await this.#currentRow(client, identity, true);
      await this.#ensureSeedCheckpoint(client, identity, row);
      const latestUpdateSequence = numericSequence(row.latest_update_sequence, "latest_update_sequence");
      const durable = await this.#loadDurableState(client, identity, latestUpdateSequence);
      await client.query("commit");
      this.#replaceCache(documentName, identity.collaborationEpoch, latestUpdateSequence, durable.mergedUpdate);
      return { identity, collaborationEpoch: identity.collaborationEpoch, latestUpdateSequence, ...durable };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally { client.release(); }
  }

  async durabilityStatus(documentName) {
    const durable = await this.loadDocument(documentName);
    const document = new Y.Doc();
    try {
      Y.applyUpdate(document, durable.mergedUpdate);
      return {
        type: ACK_TYPE, document_name: documentName, collaboration_epoch: durable.collaborationEpoch,
        durable_head_sequence: durable.latestUpdateSequence,
        state_vector_base64: Buffer.from(Y.encodeStateVector(document)).toString("base64"),
        durable_snapshot_base64: encodeDurableSnapshot(document), status_only: true,
      };
    } finally { document.destroy(); }
  }

  async appendUpdate(documentName, update, { updateId = randomUUID(), clientId, actorUserId = null } = {}) {
    const identity = parseEditorOwnerDocumentName(documentName);
    const payload = asUint8Array(update);
    if (payload.byteLength === 0 || payload.byteLength > this.maxUpdateBytes) throw new Error("editor_owner_yjs_update_size_invalid");
    const validationDocument = new Y.Doc();
    try { Y.applyUpdate(validationDocument, payload); } finally { validationDocument.destroy(); }
    assertUuid(updateId, "update_id");
    if (!clientId || Buffer.byteLength(clientId, "utf8") > 160) throw new Error("invalid_client_id");
    if (actorUserId !== null) assertUuid(actorUserId, "actor_user_id");
    const checksum = sha256Hex(payload);
    const started = performance.now();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const row = await this.#currentRow(client, identity, true);
      await this.#ensureSeedCheckpoint(client, identity, row);
      const durableHeadBefore = numericSequence(row.latest_update_sequence, "latest_update_sequence");
      let latestUpdateSequence = durableHeadBefore;
      const cached = this.durableStateCache.get(documentName);
      const cacheMatches = cached?.collaborationEpoch === identity.collaborationEpoch && cached.headSequence === durableHeadBefore;
      const duplicateResult = await client.query(
        `select update_sequence,update_id,update_sha256,update_payload from editor_owner_yjs_updates
          where company_id=$1::uuid and owner_type=$2 and owner_id=$3::uuid and document_id=$4
            and collaboration_epoch=$5::uuid and (update_id=$6::uuid or update_sha256=$7) order by update_sequence`,
        [identity.companyId, identity.ownerType, identity.ownerId, identity.documentId, identity.collaborationEpoch, updateId, checksum],
      );
      if (duplicateResult.rowCount > 1) throw new Error("editor_owner_yjs_deduplication_conflict");
      let updateSequence;
      let duplicate = false;
      if (duplicateResult.rowCount === 1) {
        const existing = duplicateResult.rows[0];
        if (existing.update_id === updateId && existing.update_sha256 !== checksum) throw new Error("editor_owner_yjs_update_id_payload_mismatch");
        if (!Buffer.from(existing.update_payload).equals(Buffer.from(payload))) throw new Error("editor_owner_yjs_checksum_collision");
        updateSequence = numericSequence(existing.update_sequence, "update_sequence");
        duplicate = true;
      } else {
        const inserted = await client.query(
          `insert into editor_owner_yjs_updates(
             company_id,owner_type,owner_id,document_id,update_id,update_sha256,collaboration_epoch,client_id,actor_user_id,update_payload
           ) values($1::uuid,$2,$3::uuid,$4,$5::uuid,$6,$7::uuid,$8,nullif($9,'')::uuid,$10) returning update_sequence`,
          [identity.companyId, identity.ownerType, identity.ownerId, identity.documentId, updateId, checksum,
            identity.collaborationEpoch, clientId, actorUserId ?? "", Buffer.from(payload)],
        );
        updateSequence = numericSequence(inserted.rows[0].update_sequence, "update_sequence");
        latestUpdateSequence = updateSequence;
        const storage = ownerStorage(identity.ownerType);
        await client.query(
          `update ${storage.table} set latest_update_sequence=$4,updated_timestamp=clock_timestamp()
            where company_id=$1::uuid and ${storage.ownerColumn}=$2::uuid and document_id=$3 and collaboration_epoch=$5::uuid`,
          [identity.companyId, identity.ownerId, identity.documentId, updateSequence, identity.collaborationEpoch],
        );
      }
      const durableReload = cacheMatches ? null : await this.#loadDurableState(client, identity, latestUpdateSequence);
      const tailStats = await client.query(
        `select count(*)::integer as update_count,coalesce(sum(octet_length(update_payload)),0)::bigint as update_bytes
           from editor_owner_yjs_updates where company_id=$1::uuid and owner_type=$2 and owner_id=$3::uuid and document_id=$4
            and collaboration_epoch=$5::uuid and update_sequence>coalesce((
              select max(through_update_sequence) from editor_owner_yjs_checkpoints
               where company_id=$1::uuid and owner_type=$2 and owner_id=$3::uuid and document_id=$4 and collaboration_epoch=$5::uuid
            ),0) and update_sequence<=$6`,
        [identity.companyId, identity.ownerType, identity.ownerId, identity.documentId, identity.collaborationEpoch, latestUpdateSequence],
      );
      await client.query("commit");
      let durableDocument;
      if (durableReload) durableDocument = this.#replaceCache(documentName, identity.collaborationEpoch, latestUpdateSequence, durableReload.mergedUpdate);
      else {
        durableDocument = cached.document;
        if (!duplicate) Y.applyUpdate(durableDocument, payload);
        cached.headSequence = latestUpdateSequence;
      }
      return {
        type: ACK_TYPE, document_name: documentName, collaboration_epoch: identity.collaborationEpoch,
        durable_update_sequence: updateSequence, durable_head_sequence: latestUpdateSequence,
        update_id: updateId, update_sha256: checksum,
        state_vector_base64: Buffer.from(Y.encodeStateVector(durableDocument)).toString("base64"),
        durable_snapshot_base64: encodeDurableSnapshot(durableDocument), duplicate, update_bytes: payload.byteLength,
        uncheckpointed_update_count: tailStats.rows[0].update_count,
        uncheckpointed_update_bytes: Number(tailStats.rows[0].update_bytes),
        database_transaction_ms: Number((performance.now() - started).toFixed(3)),
      };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally { client.release(); }
  }

  async compactDocument(documentName, reason) {
    if (!["operation_count", "update_bytes", "idle", "manual_recovery"].includes(reason)) throw new Error("invalid_editor_owner_yjs_checkpoint_reason");
    const identity = parseEditorOwnerDocumentName(documentName);
    const storage = ownerStorage(identity.ownerType);
    const client = await this.pool.connect();
    let document;
    try {
      await client.query("begin");
      const row = await this.#currentRow(client, identity, true);
      await this.#ensureSeedCheckpoint(client, identity, row);
      const latest = numericSequence(row.latest_update_sequence, "latest_update_sequence");
      const materializedThrough = numericSequence(row.materialized_through_sequence, "materialized_through_sequence");
      const durable = await this.#loadDurableState(client, identity, latest);
      if (latest === durable.checkpointSequence && latest === materializedThrough) {
        await client.query("commit");
        return { document_name: documentName, through_update_sequence: latest, compacted: false };
      }
      document = new Y.Doc();
      Y.applyUpdate(document, durable.mergedUpdate);
      const materialized = await this.materializeDocument(document, { identity, throughUpdateSequence: latest });
      if (!materialized?.documentJson || typeof materialized.plainText !== "string" || !Array.isArray(materialized.annotations)) throw new Error("invalid_editor_owner_yjs_materialization");
      const checkpointId = randomUUID();
      const inserted = await client.query(
        `insert into editor_owner_yjs_checkpoints(
          company_id,owner_type,owner_id,document_id,checkpoint_id,collaboration_epoch,through_update_sequence,
          checkpoint_payload,state_vector,document_json,plain_text,canonical_annotations,checkpoint_reason,retain_until
        ) values($1::uuid,$2,$3::uuid,$4,$5::uuid,$6::uuid,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13,
          clock_timestamp()+($14::integer*interval '1 day'))
        on conflict(company_id,owner_type,owner_id,document_id,collaboration_epoch,through_update_sequence) do nothing
        returning checkpoint_id`,
        [identity.companyId, identity.ownerType, identity.ownerId, identity.documentId, checkpointId, identity.collaborationEpoch,
          latest, Buffer.from(durable.mergedUpdate), Buffer.from(durable.stateVector), JSON.stringify(materialized.documentJson),
          materialized.plainText, JSON.stringify(materialized.annotations), reason, this.automaticCheckpointRetentionDays],
      );
      await client.query(
        `update editor_owner_yjs_updates set checkpointed_timestamp=coalesce(checkpointed_timestamp,clock_timestamp()),
          retain_until=coalesce(retain_until,clock_timestamp()+($7::integer*interval '1 day'))
          where company_id=$1::uuid and owner_type=$2 and owner_id=$3::uuid and document_id=$4
            and collaboration_epoch=$5::uuid and update_sequence<=$6`,
        [identity.companyId, identity.ownerType, identity.ownerId, identity.documentId, identity.collaborationEpoch, latest, this.coveredUpdateRetentionDays],
      );
      await client.query(
        `update ${storage.table} set document_schema_version=1,document_json=$4::jsonb,plain_text=$5,
          canonical_annotations=$6::jsonb,revision=revision+1,materialized_through_sequence=$7,updated_timestamp=clock_timestamp()
          where company_id=$1::uuid and ${storage.ownerColumn}=$2::uuid and document_id=$3 and collaboration_epoch=$8::uuid`,
        [identity.companyId, identity.ownerId, identity.documentId, JSON.stringify(materialized.documentJson), materialized.plainText,
          JSON.stringify(materialized.annotations), latest, identity.collaborationEpoch],
      );
      await client.query("commit");
      return { document_name: documentName, checkpoint_id: inserted.rows[0]?.checkpoint_id ?? checkpointId, through_update_sequence: latest, compacted: inserted.rowCount === 1 };
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally { document?.destroy(); client.release(); }
  }
}
