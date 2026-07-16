import type { EditorDeltaOp as Op } from "./quillDelta.js";
import {
  realtimeEditorScope,
  subscribeRealtimeScope,
  type RealtimeEditorDelta,
  type RealtimeEditorDeltaCommittedMessage,
  type RealtimeEditorDocumentDeletedMessage,
  type RealtimeEditorSnapshotRequiredMessage,
} from "../realtime/realtimeWebSocket.js";
import {
  applyStructuredEditorOperation,
  composeStructuredEditorOperations,
  structuredEditorDocumentFromHTML,
  structuredEditorDocumentToHTML,
  structuredEditorOperationEmpty,
  structuredEditorOperationForHTML,
  transformStructuredEditorOperation,
  type StructuredEditorDocument,
  type StructuredEditorOperation,
} from "./editorStructuredDocument.js";
import { EDITOR_RICH_TEXT_PREFIX } from "./richTextEditing.js";

export type EditorCollaborationResourceType = "node" | "logic_gate" | "project";
export type EditorCollaborationState = StructuredEditorDocument;
export type EditorCollaborationSnapshot = {
  revision: number;
  snapshot_revision: number;
  state: EditorCollaborationState;
  html: string;
  etag: string;
  deleted?: boolean;
};
type EditorCollaborationCommit = {
  operation_id: string;
  revision: number;
  deduplicated?: boolean;
  delta: RealtimeEditorDelta;
  concurrent_operations?: Array<{
    revision: number;
    delta: RealtimeEditorDelta;
  }>;
  snapshot: EditorCollaborationSnapshot;
};
export type EditorCollaborationRequest = <T>(path: string, init?: RequestInit) => Promise<T>;
export type EditorCollaborationControllerOptions = {
  apiBase: string;
  companyID: string;
  currentUserID: string;
  resourceType: EditorCollaborationResourceType;
  resourceID: string;
  documentID: string;
  initialHTML: string;
  requestJSON: EditorCollaborationRequest;
  onHTML: (html: string, source: "remote" | "recovery") => void;
  onPendingChange?: (pendingCount: number) => void;
  onDeleted?: () => void;
  onError?: (cause: unknown) => void;
  microBatchMs?: number;
  subscribe?: typeof subscribeRealtimeScope;
};
type PendingEditorOperation = {
  storage_key: string;
  user_id: string;
  company_id: string;
  resource_type: EditorCollaborationResourceType;
  resource_id: string;
  document_id: string;
  client_id: string;
  operation_id: string;
  base_revision: number;
  delta: RealtimeEditorDelta;
  created_at: number;
};

const CLIENT_PREFIX = "mango-editor-collaboration-tab-v2:";
const LEGACY_PREFIXES = [
  "mango-editor-projection-draft-v2",
  "mango-editor-projection-tab-v1",
  "mango-editor-collaboration-pending-v1:",
  "mango-editor-collaboration-client-v1:",
];
const DB_NAME = "mango-editor-collaboration-v2";
const DB_STORE = "pending_operations";
const DB_VERSION = 1;
export const EDITOR_COLLABORATION_OPERATION_TARGET_BYTES = 48 * 1024;
export const EDITOR_COLLABORATION_PRODUCT_MAX_HTML_BYTES = 2 * 1024 * 1024;
const EDITOR_COLLABORATION_FORBIDDEN_CONTENT = [
  "data:image/", ";base64,", "x-amz-credential", "x-amz-signature",
  "awsaccesskeyid", "presigned_url", "secret_access_key",
];

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

function scopePrefix(options: EditorCollaborationControllerOptions, clientID: string): string {
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
  return removed;
}

function storageError(code: string, cause?: unknown): Error {
  const error = new Error(code);
  if (cause !== undefined) (error as Error & { cause?: unknown }).cause = cause;
  return error;
}

function openPendingDB(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(storageError("editor_collaboration_storage_unavailable"));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE)) {
        request.result.createObjectStore(DB_STORE, { keyPath: "storage_key" });
      }
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
      const succeed = (value: T) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const fail = (cause: unknown) => {
        if (settled) return;
        settled = true;
        const name = cause instanceof DOMException ? cause.name : "";
        reject(storageError(
          name === "QuotaExceededError"
            ? "editor_collaboration_storage_quota_exceeded"
            : "editor_collaboration_storage_failed",
          cause,
        ));
      };
      const transaction = db.transaction(DB_STORE, mode);
      transaction.onerror = () => fail(transaction.error);
      transaction.onabort = () => fail(transaction.error);
      try {
        work(transaction.objectStore(DB_STORE), succeed, fail);
      } catch (cause) {
        fail(cause);
      }
    });
  } finally {
    db.close();
  }
}

async function readPending(prefix: string): Promise<PendingEditorOperation[]> {
  return pendingTransaction<PendingEditorOperation[]>("readonly", (store, resolve, reject) => {
    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(
      (request.result as PendingEditorOperation[])
        .filter((record) => record.storage_key.startsWith(prefix))
        .sort((left, right) => left.created_at - right.created_at || left.operation_id.localeCompare(right.operation_id)),
    );
  });
}

async function putPending(records: PendingEditorOperation[]): Promise<void> {
  if (records.length === 0) return;
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
  await pendingTransaction<void>("readwrite", (store, resolve, reject) => {
    for (const record of records) {
      const request = store.delete(record.storage_key);
      request.onerror = () => reject(request.error);
    }
    store.transaction.oncomplete = () => resolve();
  });
}

async function replacePending(
  previous: PendingEditorOperation[],
  replacement: PendingEditorOperation[],
): Promise<void> {
  if (previous.length === 0 && replacement.length === 0) return;
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

function asStructured(operation: RealtimeEditorDelta): StructuredEditorOperation {
  return operation as StructuredEditorOperation;
}

function asRealtime(operation: StructuredEditorOperation): RealtimeEditorDelta {
  return operation as RealtimeEditorDelta;
}

export function newEditorCollaborationState(html: string): EditorCollaborationState {
  return structuredEditorDocumentFromHTML(html);
}

export function applyEditorCollaborationDelta(
  state: EditorCollaborationState,
  delta: RealtimeEditorDelta,
): EditorCollaborationState {
  return applyStructuredEditorOperation(state, asStructured(delta));
}

export function materializeEditorCollaborationState(state: EditorCollaborationState): string {
  const html = structuredEditorDocumentToHTML(state);
  return html ? EDITOR_RICH_TEXT_PREFIX + html : "";
}

export function editorCollaborationDeltaForHTML(
  state: EditorCollaborationState,
  nextHTML: string,
  _operationPrefix?: string,
): RealtimeEditorDelta {
  return asRealtime(structuredEditorOperationForHTML(state, nextHTML));
}

function emptyDelta(delta: RealtimeEditorDelta): boolean {
  return structuredEditorOperationEmpty(asStructured(delta));
}

function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function editorHTMLContainsForbiddenRealtimeContent(value: string): boolean {
  const lower = value.toLowerCase();
  return EDITOR_COLLABORATION_FORBIDDEN_CONTENT.some((item) => lower.includes(item));
}

function operationRetain(position: number): Op[] {
  return position > 0 ? [{ retain: position }] : [];
}

function insertedLength(insert: NonNullable<Op["insert"]>): number {
  return typeof insert === "string" ? insert.length : 1;
}

function splitInsertText(text: string): string[] {
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const codePoint of text) {
    const codePointBytes = utf8Bytes(codePoint);
    if (current && currentBytes + codePointBytes > 24 * 1024) {
      chunks.push(current);
      current = codePoint;
      currentBytes = codePointBytes;
    } else {
      current += codePoint;
      currentBytes += codePointBytes;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function atomicStructuredOperations(delta: RealtimeEditorDelta): StructuredEditorOperation[] {
  const output: StructuredEditorOperation[] = [];
  let position = 0;
  for (const operation of delta.ops) {
    if (operation.retain) {
      if (operation.attributes && Object.keys(operation.attributes).length > 0) {
        output.push({ ops: [
          ...operationRetain(position),
          { retain: operation.retain, attributes: operation.attributes },
        ] as Op[] });
      }
      position += operation.retain;
      continue;
    }
    if (operation.delete) {
      output.push({ ops: [...operationRetain(position), { delete: operation.delete }] });
      continue;
    }
    if (operation.insert !== undefined) {
      const values = typeof operation.insert === "string"
        ? splitInsertText(operation.insert)
        : [operation.insert];
      for (const value of values) {
        output.push({ ops: [
          ...operationRetain(position),
          { insert: value, attributes: operation.attributes },
        ] as Op[] });
        position += insertedLength(value as NonNullable<Op["insert"]>);
      }
    }
  }
  return output;
}

export function splitEditorCollaborationDelta(delta: RealtimeEditorDelta): RealtimeEditorDelta[] {
  if (emptyDelta(delta)) return [];
  const parts: StructuredEditorOperation[] = [];
  let current: StructuredEditorOperation = { ops: [] };
  for (const atomic of atomicStructuredOperations(delta)) {
    const candidate = current.ops.length === 0
      ? atomic
      : composeStructuredEditorOperations(current, atomic);
    if (current.ops.length > 0 && encodedBytes(candidate) > EDITOR_COLLABORATION_OPERATION_TARGET_BYTES) {
      parts.push(current);
      current = atomic;
    } else {
      current = candidate;
    }
    if (encodedBytes(current) > EDITOR_COLLABORATION_OPERATION_TARGET_BYTES) {
      throw new Error("editor_collaboration_operation_exceeds_transport_limit");
    }
  }
  if (current.ops.length > 0) parts.push(current);
  return parts.map(asRealtime);
}

export class EditorCollaborationController {
  private readonly clientID: string;
  private readonly path: string;
  private readonly scope: string;
  private readonly pendingPrefix: string;
  private confirmed: EditorCollaborationState;
  private optimistic: EditorCollaborationState;
  private revision = 0;
  private pending: PendingEditorOperation[] = [];
  private batchTimer: number | undefined;
  private unsubscribe: (() => void) | undefined;
  private recovery: Promise<void> | undefined;
  private recoveryRequested = false;
  private drainPromise: Promise<void> | undefined;
  private persistenceChain: Promise<void> = Promise.resolve();
  private eventChain: Promise<void> = Promise.resolve();
  private buffered: RealtimeEditorDeltaCommittedMessage[] = [];
  private deleted = false;
  private renderedHTML: string;
  private stopped = false;

  constructor(private readonly options: EditorCollaborationControllerOptions) {
    this.clientID = tabClientID();
    this.confirmed = newEditorCollaborationState(options.initialHTML);
    this.optimistic = newEditorCollaborationState(options.initialHTML);
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
      onEditorDeltaCommitted: (message) => this.enqueueCommitted(message),
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

  schedule(nextHTML: string, immediate = false): void {
    if (this.deleted || this.stopped) return;
    if (editorHTMLContainsForbiddenRealtimeContent(nextHTML)) {
      this.rollbackVisibleEdit("editor_collaboration_sensitive_content_rejected");
      return;
    }
    if (utf8Bytes(nextHTML) > EDITOR_COLLABORATION_PRODUCT_MAX_HTML_BYTES) {
      this.rollbackVisibleEdit("editor_collaboration_document_too_large");
      return;
    }
    this.renderedHTML = nextHTML;
    this.persistenceChain = this.persistenceChain.then(async () => {
      const delta = editorCollaborationDeltaForHTML(this.optimistic, nextHTML);
      if (emptyDelta(delta)) return;
      const parts = splitEditorCollaborationDelta(delta);
      const createdAt = Date.now();
      const records = parts.map((part, index): PendingEditorOperation => {
        const operationID = stableID();
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
          delta: part,
          created_at: createdAt + index,
        };
      });
      await putPending(records);
      for (const record of records) {
        this.pending.push(record);
        this.optimistic = applyEditorCollaborationDelta(this.optimistic, record.delta);
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
    await this.eventChain;
    await this.drain();
  }

  async recover(): Promise<void> {
    if (this.recovery) {
      this.recoveryRequested = true;
      return this.recovery;
    }
    this.recovery = (async () => {
      do {
        this.recoveryRequested = false;
        await this.performRecovery();
      } while (this.recoveryRequested);
    })().finally(() => {
      this.recovery = undefined;
    });
    return this.recovery;
  }

  private async performRecovery(): Promise<void> {
    await this.persistenceChain;
    const mirrored = await readPending(this.pendingPrefix);
    const snapshot = await this.options.requestJSON<EditorCollaborationSnapshot>(this.path);
    this.deleted = Boolean(snapshot.deleted);
    this.revision = snapshot.revision;
    this.confirmed = snapshot.state;
    const records = new Map<string, PendingEditorOperation>();
    for (const record of [...mirrored, ...this.pending]) records.set(record.operation_id, record);
    this.pending = [...records.values()]
      .sort((left, right) => left.created_at - right.created_at || left.operation_id.localeCompare(right.operation_id));
    if (this.deleted) {
      this.options.onPendingChange?.(this.pending.length);
      this.options.onDeleted?.();
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      return;
    }

    const buffered = this.buffered.splice(0)
      .filter((event) => event.resource_revision > this.revision)
      .sort((left, right) => left.resource_revision - right.resource_revision);
    for (const event of buffered) {
      if (event.resource_revision !== this.revision + 1) {
        this.recoveryRequested = true;
        return;
      }
      await this.applyCommitted(event);
    }

    if (this.pending.length > 0) {
      await this.drain();
    } else {
      this.optimistic = structuredEditorDocumentFromHTML(snapshot.html);
      this.renderOptimistic("recovery", true);
      this.options.onPendingChange?.(0);
    }
  }

  private async drain(): Promise<void> {
    await this.persistenceChain;
    if (this.drainPromise) return this.drainPromise;
    this.drainPromise = this.performDrain().finally(() => {
      this.drainPromise = undefined;
    });
    return this.drainPromise;
  }

  private async performDrain(): Promise<void> {
    const snapshotRetryCount = new Map<string, number>();
    while (!this.deleted) {
      const record = this.pending[0];
      if (!record) return;
      const appliedRevision = this.revision;
      let commit: EditorCollaborationCommit;
      try {
        commit = await this.options.requestJSON<EditorCollaborationCommit>(this.path, {
          method: "POST",
          body: JSON.stringify({
            operation_id: record.operation_id,
            client_id: record.client_id,
            base_revision: record.base_revision,
            delta: record.delta,
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
      await deletePending([record]);
      this.pending = this.pending.filter((item) => item.operation_id !== record.operation_id);
      let submitted = asStructured(record.delta);
      for (const operation of commit.concurrent_operations ?? []) {
        if (operation.revision <= appliedRevision || operation.revision >= commit.revision) continue;
        let remote = asStructured(operation.delta);
        const originalSubmitted = submitted;
        submitted = transformStructuredEditorOperation(remote, originalSubmitted, true);
        remote = transformStructuredEditorOperation(originalSubmitted, remote, false);
        for (const pending of this.pending) {
          const original = asStructured(pending.delta);
          pending.delta = asRealtime(transformStructuredEditorOperation(remote, original, true));
          remote = transformStructuredEditorOperation(original, remote, false);
        }
      }
      this.revision = commit.snapshot.revision;
      this.confirmed = commit.snapshot.state;
      if (this.pending.length > 0) {
        for (const pending of this.pending) pending.base_revision = this.revision;
        await putPending(this.pending);
      }
      this.rebuild();
      this.renderOptimistic("remote");
      this.options.onPendingChange?.(this.pending.length);
    }
  }

  private async reconcileSnapshotForPendingRetry(): Promise<void> {
    const snapshot = await this.options.requestJSON<EditorCollaborationSnapshot>(this.path);
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
    const replacementDeltas = splitEditorCollaborationDelta(
      editorCollaborationDeltaForHTML(snapshot.state, targetHTML),
    );
    const template = previous[0];
    if (!template && replacementDeltas.length > 0) {
      throw new Error("editor_collaboration_pending_reconciliation_failed");
    }
    const replacement = replacementDeltas.map((delta, index): PendingEditorOperation => {
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
        delta,
        created_at: existing?.created_at ?? Date.now() + index,
      };
    });
    await replacePending(previous, replacement);
    this.pending = replacement;
    this.revision = snapshot.revision;
    this.confirmed = snapshot.state;
    this.rebuild();
    this.renderOptimistic("recovery", true);
    this.options.onPendingChange?.(this.pending.length);
  }

  private rebuild(): void {
    this.optimistic = { ops: this.confirmed.ops.map((operation) => structuredClone(operation)) };
    for (const record of this.pending) {
      this.optimistic = applyEditorCollaborationDelta(this.optimistic, record.delta);
    }
  }

  private renderOptimistic(source: "remote" | "recovery", force = false): void {
    const html = materializeEditorCollaborationState(this.optimistic);
    if (!force && html === this.renderedHTML) return;
    this.renderedHTML = html;
    this.options.onHTML(html, source);
  }

  private enqueueCommitted(message: RealtimeEditorDeltaCommittedMessage): void {
    if (this.recovery) {
      this.buffered.push(message);
      return;
    }
    this.eventChain = this.eventChain
      .then(() => this.applyCommitted(message))
      .catch((cause) => {
        this.options.onError?.(cause);
        return this.recover();
      });
  }

  private async applyCommitted(message: RealtimeEditorDeltaCommittedMessage): Promise<void> {
    if (message.resource_revision <= this.revision) return;
    if (message.resource_revision !== this.revision + 1) {
      throw new Error("collaboration_revision_gap");
    }
    this.confirmed = applyEditorCollaborationDelta(this.confirmed, message.delta);
    this.revision = message.resource_revision;
    const local = this.pending.find((item) => item.operation_id === message.operation_id);
    if (local) {
      await deletePending([local]);
      this.pending = this.pending.filter((item) => item !== local);
    } else if (this.pending.length > 0) {
      let remote = asStructured(message.delta);
      for (const pending of this.pending) {
        const original = asStructured(pending.delta);
        pending.delta = asRealtime(transformStructuredEditorOperation(remote, original, true));
        remote = transformStructuredEditorOperation(original, remote, false);
      }
    }
    for (const pending of this.pending) pending.base_revision = this.revision;
    await putPending(this.pending);
    this.rebuild();
    if (!local) this.renderOptimistic("remote");
    this.options.onPendingChange?.(this.pending.length);
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
