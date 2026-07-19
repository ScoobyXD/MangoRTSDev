import {
  realtimeEditorScope,
  subscribeRealtimeScope,
  type RealtimeEditorHTMLPatch,
  type RealtimeEditorPatchCommittedMessage,
  type RealtimeEditorDocumentDeletedMessage,
  type RealtimeEditorSnapshotRequiredMessage,
} from "../realtime/realtimeWebSocket.js";
import { incrementEditorRuntimeMetric } from "./editorRuntimeMetrics.js";

export type EditorTextboxSyncResourceType = "node" | "logic_gate" | "project";
export type EditorTextboxSyncSnapshot = {
  revision: number;
  html: string;
  etag: string;
  deleted?: boolean;
};
type EditorTextboxSyncCommit = {
  operation_id: string;
  event_id?: string;
  revision: number;
  deduplicated?: boolean;
  patch: RealtimeEditorHTMLPatch;
  concurrent_operations?: Array<{
    revision: number;
    operation_id: string;
    client_id: string;
    patch: RealtimeEditorHTMLPatch;
  }>;
};
export type EditorTextboxSyncRequest = <T>(path: string, init?: RequestInit) => Promise<T>;
export type EditorTextboxSyncOptions = {
  apiBase: string;
  companyID: string;
  currentUserID: string;
  resourceType: EditorTextboxSyncResourceType;
  resourceID: string;
  documentID: string;
  initialHTML: string;
  requestJSON: EditorTextboxSyncRequest;
  onHTML: (html: string, source: "remote" | "recovery") => void;
  onPendingChange?: (pendingCount: number) => void;
  onDeleted?: () => void;
  flushPendingLocalInput?: () => void;
  onError?: (cause: unknown) => void;
  microBatchMs?: number;
  subscribe?: typeof subscribeRealtimeScope;
};
type PendingEditorOperation = {
  storage_key: string;
  user_id: string;
  company_id: string;
  resource_type: EditorTextboxSyncResourceType;
  resource_id: string;
  document_id: string;
  client_id: string;
  operation_id: string;
  base_revision: number;
  patch: RealtimeEditorHTMLPatch;
  created_at: number;
};
type CommittedEditorPatch = {
  revision: number;
  operationID: string;
  clientID: string;
  patch: RealtimeEditorHTMLPatch;
};

const CLIENT_PREFIX = "mango-editor-collaboration-html-tab-v1:";
const LEGACY_PREFIXES = [
  "mango-editor-projection-draft-v2",
  "mango-editor-projection-tab-v1",
  "mango-editor-collaboration-pending-v1:",
  "mango-editor-collaboration-client-v1:",
  "mango-editor-collaboration-tab-v2:",
];
const LEGACY_STRUCTURED_DB_NAME = "mango-editor-collaboration-v2";
const DB_NAME = "mango-editor-collaboration-html-v1";
const DB_STORE = "pending_operations";
const DB_VERSION = 1;
export const EDITOR_COLLABORATION_OPERATION_TARGET_BYTES = 48 * 1024;
export const EDITOR_COLLABORATION_PRODUCT_MAX_HTML_BYTES = 2 * 1024 * 1024;
const EDITOR_COLLABORATION_FORBIDDEN_CONTENT = [
  "data:image/", ";base64,", "x-amz-credential", "x-amz-signature",
  "awsaccesskeyid", "presigned_url", "secret_access_key",
];
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function stableID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function encodedParts(parts: string[]): string {
  return parts.map(encodeURIComponent).join(":");
}

function tabClientID(): string {
  if (typeof window === "undefined") return stableID();
  const existing = window.name.startsWith(CLIENT_PREFIX) ? window.name.slice(CLIENT_PREFIX.length).trim() : "";
  if (existing) return existing;
  const created = stableID();
  window.name = CLIENT_PREFIX + created;
  return created;
}

function scopePrefix(options: EditorTextboxSyncOptions, clientID: string): string {
  return encodedParts([
    options.currentUserID, options.companyID, options.resourceType,
    options.resourceID, options.documentID, clientID,
  ]) + ":";
}

function localStorageTarget(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function cleanupLegacyEditorProjectionStorage(
  local: Storage | null = localStorageTarget(),
  session: Storage | null = typeof window === "undefined" ? null : window.sessionStorage,
): number {
  let removed = 0;
  for (const target of [local, session]) {
    if (!target) continue;
    const keys = Array.from({ length: target.length }, (_, index) => target.key(index))
      .filter((key): key is string => Boolean(key));
    for (const key of keys) {
      if (!LEGACY_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
      target.removeItem(key);
      removed += 1;
    }
  }
  if (typeof indexedDB !== "undefined") indexedDB.deleteDatabase(LEGACY_STRUCTURED_DB_NAME);
  return removed;
}

function storageError(code: string, cause?: unknown): Error {
  const error = new Error(code);
  if (cause !== undefined) (error as Error & { cause?: unknown }).cause = cause;
  return error;
}

function openPendingDB(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(storageError("editor_collaboration_storage_unavailable"));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE, { keyPath: "storage_key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageError(
      request.error?.name === "QuotaExceededError"
        ? "editor_collaboration_storage_quota_exceeded"
        : "editor_collaboration_storage_unavailable",
      request.error,
    ));
    request.onblocked = () => reject(storageError("editor_collaboration_storage_blocked"));
  });
}

async function pendingTransaction<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore, resolve: (value: T) => void, reject: (cause: unknown) => void) => void,
): Promise<T> {
  const db = await openPendingDB();
  try {
    return await new Promise<T>((resolve, reject) => {
      let settled = false;
      const succeed = (value: T) => { if (!settled) { settled = true; resolve(value); } };
      const fail = (cause: unknown) => {
        if (settled) return;
        settled = true;
        const name = cause instanceof DOMException ? cause.name : "";
        reject(storageError(name === "QuotaExceededError" ? "editor_collaboration_storage_quota_exceeded" : "editor_collaboration_storage_failed", cause));
      };
      const transaction = db.transaction(DB_STORE, mode);
      transaction.onerror = () => fail(transaction.error);
      transaction.onabort = () => fail(transaction.error);
      try { work(transaction.objectStore(DB_STORE), succeed, fail); } catch (cause) { fail(cause); }
    });
  } finally {
    db.close();
  }
}

async function readPending(prefix: string): Promise<PendingEditorOperation[]> {
  incrementEditorRuntimeMetric("indexeddb_reads");
  return pendingTransaction<PendingEditorOperation[]>("readonly", (store, resolve, reject) => {
    const request = store.getAll(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(
      (request.result as PendingEditorOperation[])
        .sort((left, right) => left.created_at - right.created_at || left.operation_id.localeCompare(right.operation_id)),
    );
  });
}

async function putPending(records: PendingEditorOperation[]): Promise<void> {
  if (records.length === 0) return;
  incrementEditorRuntimeMetric("indexeddb_writes");
  await pendingTransaction<void>("readwrite", (store, resolve, reject) => {
    for (const record of records) {
      const request = store.put(record);
      request.onerror = () => reject(request.error);
    }
    store.transaction.oncomplete = () => resolve();
  });
}

async function deletePending(records: PendingEditorOperation[]): Promise<void> {
  if (records.length === 0) return;
  incrementEditorRuntimeMetric("indexeddb_writes");
  await pendingTransaction<void>("readwrite", (store, resolve, reject) => {
    for (const record of records) {
      const request = store.delete(record.storage_key);
      request.onerror = () => reject(request.error);
    }
    store.transaction.oncomplete = () => resolve();
  });
}

async function replacePending(previous: PendingEditorOperation[], replacement: PendingEditorOperation[]): Promise<void> {
  if (previous.length === 0 && replacement.length === 0) return;
  incrementEditorRuntimeMetric("indexeddb_writes");
  await pendingTransaction<void>("readwrite", (store, resolve, reject) => {
    const replacementKeys = new Set(replacement.map((record) => record.storage_key));
    for (const record of previous) {
      if (replacementKeys.has(record.storage_key)) continue;
      const request = store.delete(record.storage_key);
      request.onerror = () => reject(request.error);
    }
    for (const record of replacement) {
      const request = store.put(record);
      request.onerror = () => reject(request.error);
    }
    store.transaction.oncomplete = () => resolve();
  });
}

function utf8Bytes(value: string): number {
  return encoder.encode(value).byteLength;
}

function encodedBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength;
}

function editorHTMLContainsForbiddenRealtimeContent(value: string): boolean {
  const lower = value.toLowerCase();
  return EDITOR_COLLABORATION_FORBIDDEN_CONTENT.some((item) => lower.includes(item));
}

function isHighSurrogate(value: number): boolean { return value >= 0xd800 && value <= 0xdbff; }
function isLowSurrogate(value: number): boolean { return value >= 0xdc00 && value <= 0xdfff; }

export function editorHTMLPatchForChange(currentHTML: string, nextHTML: string): RealtimeEditorHTMLPatch {
  let prefix = 0;
  const limit = Math.min(currentHTML.length, nextHTML.length);
  while (prefix < limit && currentHTML.charCodeAt(prefix) === nextHTML.charCodeAt(prefix)) prefix += 1;
  if (prefix > 0 && prefix < currentHTML.length && isHighSurrogate(currentHTML.charCodeAt(prefix - 1)) && isLowSurrogate(currentHTML.charCodeAt(prefix))) prefix -= 1;
  let suffix = 0;
  while (
    suffix < currentHTML.length - prefix
    && suffix < nextHTML.length - prefix
    && currentHTML.charCodeAt(currentHTML.length - 1 - suffix) === nextHTML.charCodeAt(nextHTML.length - 1 - suffix)
  ) suffix += 1;
  const currentEnd = currentHTML.length - suffix;
  const nextEnd = nextHTML.length - suffix;
  return {
    start_utf8: utf8Bytes(currentHTML.slice(0, prefix)),
    delete_utf8: utf8Bytes(currentHTML.slice(prefix, currentEnd)),
    insert: nextHTML.slice(prefix, nextEnd),
  };
}

export function applyEditorHTMLPatch(html: string, patch: RealtimeEditorHTMLPatch): string {
  const value = encoder.encode(html);
  const end = patch.start_utf8 + patch.delete_utf8;
  if (!Number.isInteger(patch.start_utf8) || !Number.isInteger(patch.delete_utf8) || patch.start_utf8 < 0 || patch.delete_utf8 < 0 || end > value.length) {
    throw new Error("editor_collaboration_patch_out_of_range");
  }
  const inserted = encoder.encode(patch.insert);
  const next = new Uint8Array(value.length - patch.delete_utf8 + inserted.length);
  next.set(value.slice(0, patch.start_utf8), 0);
  next.set(inserted, patch.start_utf8);
  next.set(value.slice(end), patch.start_utf8 + inserted.length);
  try { return decoder.decode(next); } catch { throw new Error("editor_collaboration_patch_breaks_utf8"); }
}

export function transformEditorHTMLPatch(
  committed: RealtimeEditorHTMLPatch,
  incoming: RealtimeEditorHTMLPatch,
  incomingAfter = true,
): RealtimeEditorHTMLPatch {
  const result = { ...incoming };
  const aStart = committed.start_utf8;
  const aEnd = committed.start_utf8 + committed.delete_utf8;
  const aInsert = utf8Bytes(committed.insert);
  const bStart = incoming.start_utf8;
  const bEnd = incoming.start_utf8 + incoming.delete_utf8;
  const delta = aInsert - committed.delete_utf8;
  if (incoming.delete_utf8 === 0) {
    if (bStart < aStart) return result;
    if (bStart > aEnd) result.start_utf8 += delta;
    else if (bStart === aStart && committed.delete_utf8 === 0) { if (incomingAfter) result.start_utf8 += aInsert; }
    else if (bStart >= aEnd) result.start_utf8 += delta;
    else { result.start_utf8 = aStart + (incomingAfter ? aInsert : 0); }
    return result;
  }
  if (bEnd <= aStart) return result;
  if (bStart >= aEnd) { result.start_utf8 += delta; return result; }
  const newStart = bStart >= aStart ? aStart + aInsert : bStart;
  let newEnd = bEnd;
  if (bEnd >= aEnd) newEnd = bEnd + delta;
  else if (bEnd > aStart) newEnd = aStart;
  result.start_utf8 = newStart;
  result.delete_utf8 = Math.max(0, newEnd - newStart);
  return result;
}

function splitInsertText(text: string): string[] {
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const codePoint of text) {
    const bytes = utf8Bytes(codePoint);
    if (current && currentBytes + bytes > 24 * 1024) {
      chunks.push(current);
      current = codePoint;
      currentBytes = bytes;
    } else {
      current += codePoint;
      currentBytes += bytes;
    }
  }
  if (current || chunks.length === 0) chunks.push(current);
  return chunks;
}

export function splitEditorHTMLPatch(patch: RealtimeEditorHTMLPatch): RealtimeEditorHTMLPatch[] {
  if (patch.delete_utf8 === 0 && patch.insert === "") return [];
  if (encodedBytes(patch) <= EDITOR_COLLABORATION_OPERATION_TARGET_BYTES) return [patch];
  const chunks = splitInsertText(patch.insert);
  const parts: RealtimeEditorHTMLPatch[] = [];
  let position = patch.start_utf8;
  chunks.forEach((chunk, index) => {
    const part = { start_utf8: position, delete_utf8: index === 0 ? patch.delete_utf8 : 0, insert: chunk };
    if (encodedBytes(part) > EDITOR_COLLABORATION_OPERATION_TARGET_BYTES) throw new Error("editor_collaboration_operation_exceeds_transport_limit");
    parts.push(part);
    position += utf8Bytes(chunk);
  });
  return parts;
}

function patchesEqual(left: RealtimeEditorHTMLPatch, right: RealtimeEditorHTMLPatch): boolean {
  return left.start_utf8 === right.start_utf8 && left.delete_utf8 === right.delete_utf8 && left.insert === right.insert;
}

export class EditorTextboxSync {
  private readonly clientID: string;
  private readonly path: string;
  private readonly scope: string;
  private readonly pendingPrefix: string;
  private confirmedHTML: string;
  private optimisticHTML: string;
  private renderedHTML: string;
  private revision = 0;
  private pending: PendingEditorOperation[] = [];
  private batchTimer: number | undefined;
  private unsubscribe: (() => void) | undefined;
  private recovery: Promise<void> | undefined;
  private recoveryRequested = false;
  private drainPromise: Promise<void> | undefined;
  private persistenceChain: Promise<void> = Promise.resolve();
  private stateChain: Promise<void> = Promise.resolve();
  private buffered: RealtimeEditorPatchCommittedMessage[] = [];
  private deleted = false;
  private stopped = false;

  constructor(private readonly options: EditorTextboxSyncOptions) {
    this.clientID = tabClientID();
    this.confirmedHTML = options.initialHTML;
    this.optimisticHTML = options.initialHTML;
    this.renderedHTML = options.initialHTML;
    this.path = `/v1/editor-collaboration/${options.resourceType}/${options.resourceID}/documents/${options.documentID}?company_id=${encodeURIComponent(options.companyID)}`;
    this.scope = realtimeEditorScope(options.resourceType, options.resourceID, options.documentID);
    this.pendingPrefix = scopePrefix(options, this.clientID);
  }

  start(): void {
    this.stopped = false;
    cleanupLegacyEditorProjectionStorage();
    const subscribe = this.options.subscribe ??
      ((apiBase, companyID, scope, handlers) => subscribeRealtimeScope(apiBase, companyID, scope, handlers));
    this.unsubscribe = subscribe(this.options.apiBase, this.options.companyID, this.scope, {
      onEditorPatchCommitted: (message) => this.enqueueCommitted(message),
      onEditorSnapshotRequired: (message) => this.handleSnapshotRequired(message),
      onEditorDocumentDeleted: (message) => this.handleDeleted(message),
      onRecover: () => this.recover(),
      onRejected: () => this.options.onError?.(new Error("editor_collaboration_subscription_rejected")),
    });
    void this.recover().catch((cause) => this.options.onError?.(cause));
  }

  stop(): void {
    this.stopped = true;
    if (this.batchTimer !== undefined) window.clearTimeout(this.batchTimer);
    this.batchTimer = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  async shutdown(): Promise<void> {
    if (this.stopped) return;
    if (this.batchTimer !== undefined) window.clearTimeout(this.batchTimer);
    this.batchTimer = undefined;
    try {
      await this.flush();
    } finally {
      this.stop();
    }
  }

  schedule(nextHTML: string, immediate = false): void {
    this.queueDocumentChange(nextHTML, immediate);
  }

  private queueDocumentChange(
    nextHTML: string,
    immediate: boolean,
    operationIDForPart: (index: number) => string = () => stableID(),
  ): void {
    if (this.deleted || this.stopped) return;
    if (editorHTMLContainsForbiddenRealtimeContent(nextHTML)) {
      this.rollbackVisibleEdit("editor_collaboration_sensitive_content_rejected");
      return;
    }
    if (utf8Bytes(nextHTML) > EDITOR_COLLABORATION_PRODUCT_MAX_HTML_BYTES) {
      this.rollbackVisibleEdit("editor_collaboration_document_too_large");
      return;
    }
    if (this.recovery) this.recoveryRequested = true;
    this.renderedHTML = nextHTML;
    this.persistenceChain = this.persistenceChain.then(async () => {
      const patch = editorHTMLPatchForChange(this.optimisticHTML, nextHTML);
      const parts = splitEditorHTMLPatch(patch);
      if (parts.length === 0) return;
      const createdAt = Date.now();
      const records = parts.map((part, index): PendingEditorOperation => {
        const operationID = operationIDForPart(index);
        return {
          storage_key: this.pendingPrefix + encodeURIComponent(operationID),
          user_id: this.options.currentUserID,
          company_id: this.options.companyID,
          resource_type: this.options.resourceType,
          resource_id: this.options.resourceID,
          document_id: this.options.documentID,
          client_id: this.clientID,
          operation_id: operationID,
          base_revision: this.revision,
          patch: part,
          created_at: createdAt + index,
        };
      });
      await putPending(records);
      for (const record of records) {
        this.pending.push(record);
        this.optimisticHTML = applyEditorHTMLPatch(this.optimisticHTML, record.patch);
      }
      this.options.onPendingChange?.(this.pending.length);
      this.armDrain(immediate);
    }).catch((cause) => {
      this.renderOptimistic("recovery", true);
      this.options.onError?.(cause);
    });
  }

  private rollbackVisibleEdit(code: string): void {
    this.renderOptimistic("recovery", true);
    this.options.onError?.(new Error(code));
  }

  private async persistStagedLocalInput(): Promise<void> {
    this.options.flushPendingLocalInput?.();
    await this.persistenceChain;
  }

  private armDrain(immediate: boolean): void {
    if (this.batchTimer !== undefined) window.clearTimeout(this.batchTimer);
    if (immediate) {
      this.batchTimer = undefined;
      void this.drain().catch((cause) => this.options.onError?.(cause));
      return;
    }
    this.batchTimer = window.setTimeout(() => {
      this.batchTimer = undefined;
      void this.drain().catch((cause) => this.options.onError?.(cause));
    }, this.options.microBatchMs ?? 160);
  }

  async flush(): Promise<void> {
    if (this.batchTimer !== undefined) window.clearTimeout(this.batchTimer);
    this.batchTimer = undefined;
    await this.persistenceChain;
    await this.stateChain;
    await this.drain();
    await this.stateChain;
  }

  async recover(): Promise<void> {
    incrementEditorRuntimeMetric("recovery_requests");
    if (this.recovery) {
      this.recoveryRequested = true;
      return this.recovery;
    }
    this.recovery = (async () => {
      do {
        this.recoveryRequested = false;
        await this.performRecovery();
      } while (this.recoveryRequested);
    })().finally(() => { this.recovery = undefined; });
    return this.recovery;
  }

  private async performRecovery(): Promise<void> {
    await this.persistStagedLocalInput();
    const mirrored = await readPending(this.pendingPrefix);
    const snapshot = await this.options.requestJSON<EditorTextboxSyncSnapshot>(this.path);
    this.deleted = Boolean(snapshot.deleted);
    this.revision = snapshot.revision;
    this.confirmedHTML = snapshot.html;
    const records = new Map<string, PendingEditorOperation>();
    for (const record of [...mirrored, ...this.pending]) records.set(record.operation_id, record);
    this.pending = [...records.values()]
      .sort((left, right) => left.created_at - right.created_at || left.operation_id.localeCompare(right.operation_id));
    this.optimisticHTML = this.confirmedHTML;
    if (this.deleted) {
      this.options.onPendingChange?.(this.pending.length);
      this.options.onDeleted?.();
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      return;
    }
    const hadPending = this.pending.length > 0;
    if (hadPending) await this.drain();
    if (!hadPending) {
      const buffered = this.buffered.splice(0)
        .filter((event) => event.resource_revision > this.revision)
        .sort((left, right) => left.resource_revision - right.resource_revision);
      for (const event of buffered) {
        await this.applyCommittedCore({
          revision: event.resource_revision,
          operationID: event.operation_id,
          clientID: event.client_id,
          patch: event.patch,
        }, false);
      }
      this.rebuildOptimistic();
      if (!this.recoveryRequested) this.renderOptimistic("recovery", true);
      this.options.onPendingChange?.(this.pending.length);
      return;
    }
    // Every drained commit acknowledges the resulting revision and canonical
    // patch, so another full snapshot here would repeat the same network and
    // database read. Buffered higher revisions are still applied below.
    const buffered = this.buffered.splice(0)
      .filter((event) => event.resource_revision > this.revision)
      .sort((left, right) => left.resource_revision - right.resource_revision);
    for (const event of buffered) {
      await this.applyCommittedCore({
        revision: event.resource_revision,
        operationID: event.operation_id,
        clientID: event.client_id,
        patch: event.patch,
      }, false);
    }
    this.rebuildOptimistic();
    if (!this.recoveryRequested) this.renderOptimistic("recovery", true);
    this.options.onPendingChange?.(this.pending.length);
  }

  private async drain(): Promise<void> {
    await this.persistenceChain;
    if (this.drainPromise) return this.drainPromise;
    this.drainPromise = this.performDrain().finally(() => { this.drainPromise = undefined; });
    return this.drainPromise;
  }

  private async performDrain(): Promise<void> {
    const snapshotRetryCount = new Map<string, number>();
    while (!this.deleted) {
      const record = this.pending[0];
      if (!record) return;
      let commit: EditorTextboxSyncCommit;
      try {
        incrementEditorRuntimeMetric("network_saves");
        commit = await this.options.requestJSON<EditorTextboxSyncCommit>(this.path, {
          method: "POST",
          body: JSON.stringify({
            operation_id: record.operation_id,
            client_id: record.client_id,
            base_revision: record.base_revision,
            patch: record.patch,
          }),
        });
      } catch (cause) {
        if (!(cause instanceof Error) || cause.message !== "collaboration_snapshot_required") throw cause;
        const retries = (snapshotRetryCount.get(record.operation_id) ?? 0) + 1;
        snapshotRetryCount.set(record.operation_id, retries);
        if (retries > 1) throw cause;
        await this.reconcileSnapshotForPendingRetry();
        continue;
      }
      snapshotRetryCount.delete(record.operation_id);
      await this.enqueueState(() => this.processCommit(commit));
    }
  }

  private enqueueState(work: () => Promise<void>): Promise<void> {
    const next = this.stateChain.then(work);
    this.stateChain = next.catch(() => undefined);
    return next;
  }

  private async processCommit(commit: EditorTextboxSyncCommit): Promise<void> {
    await this.persistStagedLocalInput();
    const concurrent = [...(commit.concurrent_operations ?? [])].sort((left, right) => left.revision - right.revision);
    for (const operation of concurrent) {
      if (operation.revision <= this.revision) {
        if (this.pending.some((item) => item.base_revision < operation.revision)) {
          await this.rebasePendingAcrossCommittedPatch(operation.patch, operation.revision);
        }
        continue;
      }
      await this.applyCommittedCore({
        revision: operation.revision,
        operationID: operation.operation_id,
        clientID: operation.client_id,
        patch: operation.patch,
      }, !this.recovery);
    }
    const local = this.pending.find((item) => item.operation_id === commit.operation_id);
    if (commit.revision <= this.revision) {
      if (local && commit.deduplicated) {
        await deletePending([local]);
        this.pending = this.pending.filter((item) => item !== local);
        this.rebuildOptimistic();
        this.options.onPendingChange?.(this.pending.length);
      }
      return;
    }
    await this.applyCommittedCore({
      revision: commit.revision,
      operationID: commit.operation_id,
      clientID: local?.client_id ?? "acknowledgement",
      patch: commit.patch,
    }, !this.recovery);
  }

  private async rebasePendingAcrossCommittedPatch(patch: RealtimeEditorHTMLPatch, revision: number): Promise<void> {
    let remote = patch;
    for (const pending of this.pending) {
      const original = pending.patch;
      pending.patch = transformEditorHTMLPatch(remote, original, true);
      remote = transformEditorHTMLPatch(original, remote, false);
      pending.base_revision = Math.max(pending.base_revision, revision);
    }
    await putPending(this.pending);
    this.rebuildOptimistic();
  }

  private async applyCommittedCore(operation: CommittedEditorPatch, render: boolean): Promise<void> {
    await this.persistStagedLocalInput();
    if (operation.revision <= this.revision) return;
    if (operation.revision !== this.revision + 1) throw new Error("collaboration_revision_gap");
    const nextConfirmed = applyEditorHTMLPatch(this.confirmedHTML, operation.patch);
    const localIndex = this.pending.findIndex((item) => item.operation_id === operation.operationID);
    if (localIndex >= 0) {
      if (localIndex !== 0 || !patchesEqual(this.pending[localIndex].patch, operation.patch)) {
        throw new Error("collaboration_local_patch_rebase_mismatch");
      }
      const local = this.pending[localIndex];
      await deletePending([local]);
      this.pending.splice(localIndex, 1);
      this.confirmedHTML = nextConfirmed;
      this.revision = operation.revision;
      for (const pending of this.pending) pending.base_revision = this.revision;
      await putPending(this.pending);
      if (this.recovery) this.rebuildOptimistic();
      this.options.onPendingChange?.(this.pending.length);
      return;
    }
    let remoteForOptimistic = operation.patch;
    for (const pending of this.pending) {
      const original = pending.patch;
      const before = remoteForOptimistic;
      pending.patch = transformEditorHTMLPatch(before, original, true);
      remoteForOptimistic = transformEditorHTMLPatch(original, before, false);
      pending.base_revision = operation.revision;
    }
    this.confirmedHTML = nextConfirmed;
    this.revision = operation.revision;
    this.optimisticHTML = applyEditorHTMLPatch(this.optimisticHTML, remoteForOptimistic);
    await putPending(this.pending);
    if (render) this.renderOptimistic("remote");
    this.options.onPendingChange?.(this.pending.length);
  }

  private async reconcileSnapshotForPendingRetry(): Promise<void> {
    await this.persistStagedLocalInput();
    const snapshot = await this.options.requestJSON<EditorTextboxSyncSnapshot>(this.path);
    if (snapshot.deleted) {
      this.deleted = true;
      this.revision = Math.max(this.revision, snapshot.revision);
      this.options.onPendingChange?.(this.pending.length);
      this.options.onDeleted?.();
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      return;
    }
    const targetHTML = this.renderedHTML;
    const previous = this.pending;
    const patches = splitEditorHTMLPatch(editorHTMLPatchForChange(snapshot.html, targetHTML));
    const template = previous[0];
    if (!template && patches.length > 0) throw new Error("editor_collaboration_pending_reconciliation_failed");
    const replacement = patches.map((patch, index): PendingEditorOperation => {
      const existing = previous[index];
      const operationID = existing?.operation_id ?? stableID();
      return {
        storage_key: existing?.storage_key ?? this.pendingPrefix + encodeURIComponent(operationID),
        user_id: template.user_id,
        company_id: template.company_id,
        resource_type: template.resource_type,
        resource_id: template.resource_id,
        document_id: template.document_id,
        client_id: template.client_id,
        operation_id: operationID,
        base_revision: snapshot.revision,
        patch,
        created_at: existing?.created_at ?? Date.now() + index,
      };
    });
    await replacePending(previous, replacement);
    this.pending = replacement;
    this.revision = snapshot.revision;
    this.confirmedHTML = snapshot.html;
    this.rebuildOptimistic();
    if (this.optimisticHTML !== targetHTML) this.renderOptimistic("recovery", true);
    this.options.onPendingChange?.(this.pending.length);
  }

  private rebuildOptimistic(): void {
    this.optimisticHTML = this.confirmedHTML;
    for (const record of this.pending) this.optimisticHTML = applyEditorHTMLPatch(this.optimisticHTML, record.patch);
  }

  private renderOptimistic(source: "remote" | "recovery", force = false): void {
    if (!force && this.optimisticHTML === this.renderedHTML) return;
    this.renderedHTML = this.optimisticHTML;
    this.options.onHTML(this.optimisticHTML, source);
  }

  private enqueueCommitted(message: RealtimeEditorPatchCommittedMessage): void {
    if (this.recovery) {
      this.buffered.push(message);
      return;
    }
    void this.enqueueState(() => this.applyCommittedCore({
      revision: message.resource_revision,
      operationID: message.operation_id,
      clientID: message.client_id,
      patch: message.patch,
    }, true)).catch((cause) => {
      this.options.onError?.(cause);
      void this.recover().catch((recoveryCause) => this.options.onError?.(recoveryCause));
    });
  }

  private handleSnapshotRequired(message: RealtimeEditorSnapshotRequiredMessage): void {
    if (message.resource_revision <= this.revision) return;
    void this.recover().catch((cause) => this.options.onError?.(cause));
  }

  private handleDeleted(message: RealtimeEditorDocumentDeletedMessage): void {
    if (message.resource_revision <= this.revision) return;
    if (this.recovery) {
      this.recoveryRequested = true;
      return;
    }
    this.deleted = true;
    this.revision = message.resource_revision;
    this.options.onPendingChange?.(this.pending.length);
    this.options.onDeleted?.();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }
}
