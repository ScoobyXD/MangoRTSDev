import { publishEditorSaveState } from "../editorSaveStatusStore.js";
import { incrementEditorRuntimeMetric } from "../editorRuntimeMetrics.js";
import {
  beginEditorTraceSpan,
  editorTraceInstant,
  endEditorTraceSpan,
  traceEditorAsyncFunction,
  traceEditorFunction,
  type EditorTraceContext,
} from "../editorTrace.js";
import type { MangoTiptapPersistedAnnotation } from "./mangoTiptapAnnotations.js";
import { validateMangoTiptapDocument, type MangoTiptapDocument } from "./mangoTiptapDocument.js";

export type MangoTiptapResourceType = "node" | "project" | "logic_gate";
export type MangoTiptapRequest = <T>(path: string, init?: RequestInit & {
  json?: unknown; editorTraceContext?: EditorTraceContext | null }) => Promise<T>;

export type MangoTiptapSnapshot = {
  revision: number;
  schema_version: number;
  document: MangoTiptapDocument;
  annotations?: MangoTiptapPersistedAnnotation[];
  deleted?: boolean;
  updated_timestamp?: string;
  committed_at?: string;
};

export type MangoTiptapSaveAcknowledgement = {
  operation_id: string;
  revision: number;
  committed_at: string;
  deduplicated?: boolean;
};

export type MangoTiptapSaveState = {
  status: "pending" | "saving" | "saved" | "failed";
  updatedTimestamp?: string;
  revision?: number;
  message?: string;
  unresolvedFailure?: boolean;
};

export type MangoTiptapConflict = {
  local: MangoTiptapDocument;
  canonical: MangoTiptapSnapshot;
};

export type MangoTiptapRecoveryRecord = {
  record_version: 2;
  storage_key: string;
  company_id: string;
  resource_type: MangoTiptapResourceType;
  resource_id: string;
  document_id: string;
  document: MangoTiptapDocument;
  annotations: MangoTiptapPersistedAnnotation[];
  generation: number;
  operation_id: string;
  client_id: string;
  base_revision: number;
  captured_at: number;
};

export type MangoTiptapSyncOptions = {
  companyID: string;
  resourceType: MangoTiptapResourceType;
  resourceID: string;
  documentID: string;
  requestJSON: MangoTiptapRequest;
  traceContext?: EditorTraceContext | null;
  initialRevision?: number;
  onDocument: (document: MangoTiptapDocument, source: "canonical" | "recovery") => void;
  onAnnotations?: (annotations: readonly MangoTiptapPersistedAnnotation[], source: "canonical" | "recovery") => void;
  onSnapshot?: (document: MangoTiptapDocument, annotations: readonly MangoTiptapPersistedAnnotation[]) => void;
  onPendingChange?: (pendingCount: number) => void;
  onSaveStateChange?: (state: MangoTiptapSaveState) => void;
  onConflict?: (conflict: MangoTiptapConflict) => void;
  onError?: (cause: unknown) => void;
  onRecoveryStorageError?: (message: string) => void;
  onRecoveryStorageRecovered?: () => void;
  subscribeToCanonicalChange?: (recover: () => void, clientID: string) => () => void;
  batchMs?: number;
  maxBatchMs?: number;
};

const DB_NAME = "mango-tiptap-pending-v1";
const DB_STORE = "pending_documents";
const DB_VERSION = 2;
const CLIENT_KEY = "mango-tiptap-client-v1";

type LegacyPendingCommit = {
  operation_id?: unknown;
  client_id?: unknown;
  base_revision?: unknown;
  document?: unknown;
  annotations?: unknown;
  created_at?: unknown;
};

type LegacyPendingDocumentRecord = {
  storage_key?: unknown;
  company_id?: unknown;
  resource_type?: unknown;
  resource_id?: unknown;
  document_id?: unknown;
  commits?: unknown;
};

function stableID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function clientID(): string {
  if (typeof sessionStorage === "undefined") return stableID();
  const existing = sessionStorage.getItem(CLIENT_KEY)?.trim();
  if (existing) return existing;
  const created = stableID();
  sessionStorage.setItem(CLIENT_KEY, created);
  return created;
}

export function mangoTiptapPendingStorageKey(options: Pick<MangoTiptapSyncOptions, "companyID" | "resourceType" | "resourceID" | "documentID">): string {
  return [options.companyID, options.resourceType, options.resourceID, options.documentID]
    .map(encodeURIComponent)
    .join(":");
}

function requiredString(value: unknown, error: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(error);
  return value;
}

function recoveryResourceType(value: unknown): MangoTiptapResourceType {
  if (value === "node" || value === "project" || value === "logic_gate") return value;
  throw new Error("invalid_tiptap_pending_resource_type");
}

function recoveryDocument(value: unknown): MangoTiptapDocument {
  const validation = validateMangoTiptapDocument(value);
  if (!validation.valid) throw new Error(`invalid_tiptap_pending_document: ${validation.error}`);
  return validation.value;
}

function migrateRecoveryRecord(storageKey: string, value: unknown): { record: MangoTiptapRecoveryRecord; changed: boolean } {
  if (!value || typeof value !== "object") throw new Error("invalid_tiptap_pending_record");
  const raw = value as LegacyPendingDocumentRecord & Partial<MangoTiptapRecoveryRecord>;
  const common = {
    record_version: 2 as const,
    storage_key: requiredString(raw.storage_key, "invalid_tiptap_pending_storage_key"),
    company_id: requiredString(raw.company_id, "invalid_tiptap_pending_company"),
    resource_type: recoveryResourceType(raw.resource_type),
    resource_id: requiredString(raw.resource_id, "invalid_tiptap_pending_resource"),
    document_id: requiredString(raw.document_id, "invalid_tiptap_pending_document_id"),
  };
  if (common.storage_key !== storageKey) throw new Error("invalid_tiptap_pending_storage_key");

  if (Array.isArray(raw.commits)) {
    const commit = [...raw.commits]
      .reverse()
      .find((candidate): candidate is LegacyPendingCommit => {
        if (!candidate || typeof candidate !== "object") return false;
        return validateMangoTiptapDocument((candidate as LegacyPendingCommit).document).valid;
      });
    if (!commit) throw new Error("invalid_tiptap_pending_legacy_record");
    return {
      changed: true,
      record: {
        ...common,
        document: recoveryDocument(commit.document),
        annotations: Array.isArray(commit.annotations) ? commit.annotations as MangoTiptapPersistedAnnotation[] : [],
        generation: 1,
        operation_id: requiredString(commit.operation_id, "invalid_tiptap_pending_operation"),
        client_id: requiredString(commit.client_id, "invalid_tiptap_pending_client"),
        base_revision: Number.isFinite(commit.base_revision) ? Math.max(0, Math.trunc(Number(commit.base_revision))) : 0,
        captured_at: Number.isFinite(commit.created_at) ? Number(commit.created_at) : Date.now(),
      },
    };
  }

  const record: MangoTiptapRecoveryRecord = {
    ...common,
    document: recoveryDocument(raw.document),
    annotations: Array.isArray(raw.annotations) ? raw.annotations : [],
    generation: Number.isFinite(raw.generation) ? Math.max(1, Math.trunc(Number(raw.generation))) : 1,
    operation_id: requiredString(raw.operation_id, "invalid_tiptap_pending_operation"),
    client_id: requiredString(raw.client_id, "invalid_tiptap_pending_client"),
    base_revision: Number.isFinite(raw.base_revision) ? Math.max(0, Math.trunc(Number(raw.base_revision))) : 0,
    captured_at: Number.isFinite(raw.captured_at) ? Number(raw.captured_at) : Date.now(),
  };
  return { record, changed: raw.record_version !== 2 };
}

function openDB(traceContext?: EditorTraceContext | null): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("tiptap_pending_storage_unavailable"));
  return new Promise((resolve, reject) => {
    const span = beginEditorTraceSpan(traceContext ?? null, "indexeddb.open", "indexeddb", {
      database_version: DB_VERSION,
    });
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      editorTraceInstant(traceContext ?? null, "indexeddb.upgrade", "indexeddb", {
        old_version: event.oldVersion,
      });
      if (!request.result.objectStoreNames.contains(DB_STORE)) {
        request.result.createObjectStore(DB_STORE, { keyPath: "storage_key" });
      }
    };
    request.onsuccess = () => {
      endEditorTraceSpan(span, { result: "success" });
      resolve(request.result);
    };
    request.onerror = () => {
      endEditorTraceSpan(span, { result: "error" }, "error");
      reject(request.error ?? new Error("tiptap_pending_storage_unavailable"));
    };
    request.onblocked = () => {
      endEditorTraceSpan(span, { result: "blocked" }, "error");
      reject(new Error("tiptap_pending_storage_blocked"));
    };
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore, resolve: (value: T) => void, reject: (cause: unknown) => void) => void,
  traceContext?: EditorTraceContext | null,
  operation = "unknown",
): Promise<T> {
  return traceEditorAsyncFunction(traceContext ?? null, `indexeddb.${operation}.transaction`, "indexeddb", async () => {
    const db = await openDB(traceContext);
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(DB_STORE, mode);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
      work(transaction.objectStore(DB_STORE), resolve, reject);
    });
  } finally {
    db.close();
  }
  });
}

export async function readExactMangoTiptapPending(
  storageKey: string,
  traceContext?: EditorTraceContext | null,
): Promise<MangoTiptapRecoveryRecord | null> {
  incrementEditorRuntimeMetric("indexeddb_reads");
  return withStore("readwrite", (store, resolve, reject) => {
    const requestSpan = beginEditorTraceSpan(traceContext ?? null, "indexeddb.pending.get", "indexeddb");
    const request = store.get(storageKey);
    request.onerror = () => {
      endEditorTraceSpan(requestSpan, { result: "error" }, "error");
      reject(request.error);
    };
    request.onsuccess = () => {
      endEditorTraceSpan(requestSpan, { found: request.result !== undefined });
      if (request.result === undefined) {
        resolve(null);
        return;
      }
      try {
        const migrated = migrateRecoveryRecord(storageKey, request.result);
        if (!migrated.changed) {
          resolve(migrated.record);
          return;
        }
        const write = store.put(migrated.record);
        write.onerror = () => reject(write.error);
        store.transaction.oncomplete = () => resolve(migrated.record);
      } catch (cause) {
        reject(cause);
      }
    };
  }, traceContext, "pending.read");
}

async function writePending(record: MangoTiptapRecoveryRecord, traceContext?: EditorTraceContext | null): Promise<void> {
  incrementEditorRuntimeMetric("indexeddb_writes");
  await withStore<void>("readwrite", (store, resolve, reject) => {
    const requestSpan = beginEditorTraceSpan(traceContext ?? null, "indexeddb.pending.put", "indexeddb");
    const request = store.put(record);
    request.onerror = () => {
      endEditorTraceSpan(requestSpan, { result: "error" }, "error");
      reject(request.error);
    };
    store.transaction.oncomplete = () => {
      endEditorTraceSpan(requestSpan, { result: "committed" });
      resolve();
    };
  }, traceContext, "pending.write");
}

async function deletePendingIfOperation(storageKey: string, operationID: string, traceContext?: EditorTraceContext | null): Promise<void> {
  incrementEditorRuntimeMetric("indexeddb_writes");
  await withStore<void>("readwrite", (store, resolve, reject) => {
    const requestSpan = beginEditorTraceSpan(traceContext ?? null, "indexeddb.pending.delete_if_operation", "indexeddb");
    const read = store.get(storageKey);
    read.onerror = () => {
      endEditorTraceSpan(requestSpan, { stage: "read" }, "error");
      reject(read.error);
    };
    read.onsuccess = () => {
      const record = read.result as MangoTiptapRecoveryRecord | undefined;
      if (record?.operation_id !== operationID) return;
      try {
        const deletion = store.delete(storageKey);
        deletion.onerror = () => reject(deletion.error);
      } catch (cause) {
        reject(cause);
      }
    };
    store.transaction.oncomplete = () => {
      endEditorTraceSpan(requestSpan, { result: "committed" });
      resolve();
    };
  }, traceContext, "pending.delete");
}

function isConflict(cause: unknown): boolean {
  return (typeof cause === "object" && cause !== null && "status" in cause && Number((cause as { status?: unknown }).status) === 409)
    || (cause instanceof Error && /conflict|revision|stale/i.test(cause.message));
}

function requireSnapshotDocument(snapshot: MangoTiptapSnapshot): MangoTiptapDocument {
  const validation = validateMangoTiptapDocument(snapshot.document);
  if (!validation.valid) throw new Error(`invalid_canonical_tiptap_document: ${validation.error}`);
  return validation.value;
}

export class MangoTiptapSync {
  private readonly storageKey: string;
  private readonly clientID: string;
  private readonly path: string;
  private revision: number;
  private generation = 0;
  private acknowledgedGeneration = 0;
  private latest: MangoTiptapRecoveryRecord | null = null;
  private inFlight: MangoTiptapRecoveryRecord | null = null;
  private persistence = Promise.resolve();
  private drainPromise: Promise<void> | undefined;
  private recoverPromise: Promise<void> | undefined;
  private batchTimer: ReturnType<typeof setTimeout> | undefined;
  private maxBatchTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private batchTimerExpectedAt = 0;
  private maxBatchTimerExpectedAt = 0;
  private retryTimerExpectedAt = 0;
  private retryAttempt = 0;
  private snapshotProvider: (() => MangoTiptapDocument) | undefined;
  private annotationProvider: (() => readonly MangoTiptapPersistedAnnotation[]) | undefined;
  private unsubscribe: (() => void) | undefined;
  private realtimeVisible = false;
  private stopped = false;
  private conflicted = false;
  private initialRecoveryComplete = false;
  private recoveryStorageFailed = false;
  private unresolvedSaveFailureMessage: string | undefined;
  private lastSaveState: MangoTiptapSaveState | undefined;
  private lastPendingCount = -1;

  constructor(private readonly options: MangoTiptapSyncOptions) {
    this.storageKey = mangoTiptapPendingStorageKey(options);
    this.clientID = clientID();
    this.revision = Math.max(0, Math.trunc(options.initialRevision ?? 0));
    this.path = `/v1/editor-json/${encodeURIComponent(options.resourceType)}/${encodeURIComponent(options.resourceID)}/documents/${encodeURIComponent(options.documentID)}?company_id=${encodeURIComponent(options.companyID)}`;
  }

  async start(): Promise<void> {
    return traceEditorAsyncFunction(this.options.traceContext ?? null, "sync.start", "editor.sync", async () => {
      this.stopped = false;
      await this.recover();
      this.initialRecoveryComplete = true;
    });
  }

  setRealtimeVisible(visible: boolean): void {
    if (this.realtimeVisible === visible) return;
    this.realtimeVisible = visible;
    if (!visible) {
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      return;
    }
    if (this.stopped || this.unsubscribe) return;
    this.unsubscribe = this.options.subscribeToCanonicalChange?.(() => {
      void this.recover().catch((cause) => this.options.onError?.(cause));
    }, this.clientID);
  }

  schedule(
    document: MangoTiptapDocument | (() => MangoTiptapDocument),
    immediate = false,
    annotations?: () => readonly MangoTiptapPersistedAnnotation[],
  ): void {
    return traceEditorFunction(this.options.traceContext ?? null, "sync.schedule", "editor.sync", () => {
      if (this.stopped || this.conflicted) return;
      this.generation += 1;
      this.snapshotProvider = typeof document === "function" ? document : () => document;
      this.annotationProvider = annotations;
      this.publishPendingCount();
      this.emitSaveState({ status: "pending", unresolvedFailure: Boolean(this.unresolvedSaveFailureMessage) });
      this.armDrain(immediate);
    }, { immediate, next_generation: this.generation + 1 });
  }

  reportFailure(message: string): void {
    const detail = message.trim() || "Unable to save this text box";
    this.unresolvedSaveFailureMessage = detail;
    this.emitSaveState({ status: "failed", message: detail, unresolvedFailure: true });
  }

  private async captureScheduledSnapshot(): Promise<void> {
    return traceEditorAsyncFunction(this.options.traceContext ?? null, "sync.capture_scheduled_snapshot", "editor.snapshot", async () => {
    const provider = this.snapshotProvider;
    const annotationProvider = this.annotationProvider;
    const generation = this.generation;
    this.snapshotProvider = undefined;
    this.annotationProvider = undefined;
    if (!provider) {
      await this.persistence;
      return;
    }
    let document: MangoTiptapDocument;
    let annotations: MangoTiptapPersistedAnnotation[];
    try {
      document = traceEditorFunction(
        this.options.traceContext ?? null,
        "sync.snapshot_provider",
        "editor.snapshot",
        provider,
      );
      annotations = traceEditorFunction(
        this.options.traceContext ?? null,
        "sync.annotation_provider",
        "editor.snapshot",
        () => [...(annotationProvider?.() ?? [])],
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to prepare this text box for saving";
      this.reportFailure(message);
      this.options.onError?.(cause);
      return;
    }
    const record: MangoTiptapRecoveryRecord = {
      record_version: 2,
      storage_key: this.storageKey,
      company_id: this.options.companyID,
      resource_type: this.options.resourceType,
      resource_id: this.options.resourceID,
      document_id: this.options.documentID,
      document,
      annotations,
      generation,
      operation_id: stableID(),
      client_id: this.clientID,
      base_revision: this.revision,
      captured_at: Date.now(),
    };
    this.latest = record;
    traceEditorFunction(
      this.options.traceContext ?? null,
      "sync.on_snapshot",
      "editor.snapshot",
      () => this.options.onSnapshot?.(document, annotations),
    );
    await this.persistRecordBestEffort(record);
    });
  }

  private async retryFailedBeforeCapture(): Promise<void> {
    if (this.latest && this.unresolvedSaveFailureMessage && this.snapshotProvider) await this.drain();
  }

  private async captureAndDrain(): Promise<void> {
    return traceEditorAsyncFunction(this.options.traceContext ?? null, "sync.capture_and_drain", "editor.sync", async () => {
      this.clearTimers();
      await this.retryFailedBeforeCapture();
      await this.captureScheduledSnapshot();
      await this.drain();
    });
  }

  async flush(): Promise<void> {
    return traceEditorAsyncFunction(this.options.traceContext ?? null, "sync.flush", "editor.sync", async () => {
      this.clearTimers();
      await this.retryFailedBeforeCapture();
      await this.captureScheduledSnapshot();
      await this.drain();
    });
  }

  async shutdown(): Promise<void> {
    return traceEditorAsyncFunction(this.options.traceContext ?? null, "sync.shutdown", "editor.sync", async () => {
      this.setRealtimeVisible(false);
      this.clearTimers();
      await this.captureScheduledSnapshot();
      this.stopped = true;
      try {
        await this.drain();
      } catch (cause) {
        this.options.onError?.(cause);
      } finally {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
      }
    });
  }

  recover(): Promise<void> {
    if (this.recoverPromise) return this.recoverPromise;
    const recovery = this.performRecovery().finally(() => {
      if (this.recoverPromise === recovery) this.recoverPromise = undefined;
    });
    this.recoverPromise = recovery;
    return recovery;
  }

  refreshCanonical(): Promise<void> {
    const activeRecovery = this.recoverPromise;
    if (!activeRecovery) return this.recover();
    return activeRecovery.then(() => {
      if (this.stopped) return;
      return this.recover();
    });
  }

  private hasUnsavedLocalEdits(): boolean {
    return this.generation > this.acknowledgedGeneration
      || Boolean(this.snapshotProvider || this.latest || this.inFlight || this.unresolvedSaveFailureMessage);
  }

  private async performRecovery(): Promise<void> {
    return traceEditorAsyncFunction(this.options.traceContext ?? null, "sync.perform_recovery", "editor.recovery", async () => {
    incrementEditorRuntimeMetric("recovery_requests");
    await this.captureScheduledSnapshot();
    if (this.initialRecoveryComplete && this.hasUnsavedLocalEdits()) return;
    let recoveryStorageAvailable = true;
    const [record, canonical] = await Promise.all([
      readExactMangoTiptapPending(this.storageKey, this.options.traceContext).then((value) => {
        this.reportRecoveryStorageRecovered();
        return value;
      }).catch((cause) => {
        recoveryStorageAvailable = false;
        this.reportRecoveryStorageFailure(cause);
        return null;
      }),
      this.options.requestJSON<MangoTiptapSnapshot>(this.path, {
        editorTraceContext: this.options.traceContext,
      }),
    ]);
    const canonicalDocument = requireSnapshotDocument(canonical);
    this.revision = canonical.revision;
    if (record) {
      this.latest = { ...record, annotations: record.annotations ?? [] };
      this.generation = Math.max(this.generation, record.generation);
      this.acknowledgedGeneration = Math.min(this.acknowledgedGeneration, Math.max(0, record.generation - 1));
      this.publishPendingCount();
      this.emitSaveState({ status: "pending", unresolvedFailure: Boolean(this.unresolvedSaveFailureMessage) });
      this.options.onDocument(record.document, "recovery");
      this.options.onAnnotations?.(record.annotations ?? [], "recovery");
      await this.drain();
      return;
    }
    if (!recoveryStorageAvailable && this.latest) return;
    this.latest = null;
    this.acknowledgedGeneration = this.generation;
    this.publishPendingCount();
    this.emitSaveState(this.unresolvedSaveFailureMessage
      ? { status: "failed", message: this.unresolvedSaveFailureMessage, unresolvedFailure: true }
      : {
        status: "saved",
        updatedTimestamp: canonical.updated_timestamp ?? canonical.committed_at,
        revision: canonical.revision,
        unresolvedFailure: false,
      });
    this.options.onDocument(canonicalDocument, "canonical");
    this.options.onAnnotations?.(canonical.annotations ?? [], "canonical");
    });
  }

  async resolveConflict(choice: "keep-local" | "use-canonical"): Promise<void> {
    const canonical = await this.options.requestJSON<MangoTiptapSnapshot>(this.path, {
      editorTraceContext: this.options.traceContext,
    });
    const canonicalDocument = requireSnapshotDocument(canonical);
    const local = this.latest;
    this.revision = canonical.revision;
    this.conflicted = false;
    if (choice === "keep-local" && local) {
      this.generation = Math.max(this.generation + 1, local.generation + 1);
      this.latest = {
        ...local,
        generation: this.generation,
        operation_id: stableID(),
        client_id: this.clientID,
        base_revision: canonical.revision,
        captured_at: Date.now(),
      };
      this.publishPendingCount();
      this.emitSaveState({ status: "pending" });
      await this.persistRecordBestEffort(this.latest);
      this.options.onDocument(this.latest.document, "recovery");
      this.options.onAnnotations?.(this.latest.annotations, "recovery");
      await this.drain();
      return;
    }
    this.latest = null;
    this.inFlight = null;
    this.generation = this.acknowledgedGeneration;
    if (local) await this.deleteRecordBestEffort(local.operation_id);
    this.publishPendingCount();
    this.emitSaveState({
      status: "saved",
      updatedTimestamp: canonical.updated_timestamp ?? canonical.committed_at,
      revision: canonical.revision,
      unresolvedFailure: false,
    });
    this.options.onDocument(canonicalDocument, "canonical");
    this.options.onAnnotations?.(canonical.annotations ?? [], "canonical");
  }

  private async persistRecordBestEffort(record: MangoTiptapRecoveryRecord): Promise<boolean> {
    let succeeded = false;
    const snapshot = { ...record, annotations: [...record.annotations] };
    this.persistence = this.persistence.catch(() => undefined).then(async () => {
      try {
        await writePending(snapshot, this.options.traceContext);
        this.reportRecoveryStorageRecovered();
        succeeded = true;
      } catch (cause) {
        this.reportRecoveryStorageFailure(cause);
      }
    });
    await this.persistence;
    return succeeded;
  }

  private async deleteRecordBestEffort(operationID: string): Promise<boolean> {
    let succeeded = false;
    this.persistence = this.persistence.catch(() => undefined).then(async () => {
      try {
        await deletePendingIfOperation(this.storageKey, operationID, this.options.traceContext);
        this.reportRecoveryStorageRecovered();
        succeeded = true;
      } catch (cause) {
        this.reportRecoveryStorageFailure(cause);
      }
    });
    await this.persistence;
    return succeeded;
  }

  private reportRecoveryStorageFailure(cause: unknown): void {
    this.recoveryStorageFailed = true;
    const detail = cause instanceof Error && cause.message.trim() ? cause.message.trim() : String(cause || "unavailable");
    this.options.onRecoveryStorageError?.(
      `Browser recovery storage failed: ${detail}. Changes will still be sent to Mango, but this browser cannot safely recover them after a refresh until storage works.`,
    );
  }

  private reportRecoveryStorageRecovered(): void {
    if (!this.recoveryStorageFailed) return;
    this.recoveryStorageFailed = false;
    this.options.onRecoveryStorageRecovered?.();
  }

  private armDrain(immediate: boolean): void {
    this.clearTimer("batch");
    if (immediate) {
      editorTraceInstant(this.options.traceContext ?? null, "sync.immediate_drain", "editor.timer", { generation: this.generation });
      void this.captureAndDrain().catch((cause) => this.options.onError?.(cause));
      return;
    }
    const batchDelay = this.options.batchMs ?? 500;
    this.batchTimerExpectedAt = Date.now() + batchDelay;
    editorTraceInstant(this.options.traceContext ?? null, "sync.batch_timer.armed", "editor.timer", { delay_ms: batchDelay, generation: this.generation });
    this.batchTimer = setTimeout(() => {
      const actualAt = Date.now();
      editorTraceInstant(this.options.traceContext ?? null, "sync.batch_timer.fired", "editor.timer", { late_by_ms: Math.max(0, actualAt - this.batchTimerExpectedAt), generation: this.generation });
      this.batchTimer = undefined;
      void this.captureAndDrain().catch((cause) => this.options.onError?.(cause));
    }, batchDelay);
    if (this.maxBatchTimer === undefined) {
      const maxBatchDelay = this.options.maxBatchMs ?? 10_000;
      this.maxBatchTimerExpectedAt = Date.now() + maxBatchDelay;
      editorTraceInstant(this.options.traceContext ?? null, "sync.max_batch_timer.armed", "editor.timer", { delay_ms: maxBatchDelay, generation: this.generation });
      this.maxBatchTimer = setTimeout(() => {
        const actualAt = Date.now();
        editorTraceInstant(this.options.traceContext ?? null, "sync.max_batch_timer.fired", "editor.timer", { late_by_ms: Math.max(0, actualAt - this.maxBatchTimerExpectedAt), generation: this.generation });
        this.maxBatchTimer = undefined;
        void this.captureAndDrain().catch((cause) => this.options.onError?.(cause));
      }, maxBatchDelay);
    }
  }

  private async drain(): Promise<void> {
    if (this.drainPromise) return this.drainPromise;
    this.drainPromise = traceEditorAsyncFunction(this.options.traceContext ?? null, "sync.drain", "editor.sync", async () => {
      while (this.latest && !this.conflicted) {
        const commit = this.latest;
        this.inFlight = commit;
        if (commit.generation === this.generation && !this.snapshotProvider) {
          this.emitSaveState({ status: "saving", unresolvedFailure: Boolean(this.unresolvedSaveFailureMessage) });
        }
        try {
          incrementEditorRuntimeMetric("network_saves");
          incrementEditorRuntimeMetric("full_document_serializations");
          const response = await this.options.requestJSON<MangoTiptapSaveAcknowledgement>(this.path, {
            method: "POST",
            editorTraceContext: this.options.traceContext,
            json: {
              operation_id: commit.operation_id,
              client_id: commit.client_id,
              base_revision: commit.base_revision,
              schema_version: commit.document.schema_version,
              document: commit.document,
              annotations: commit.annotations,
            },
          });
          if (response.operation_id !== commit.operation_id || !Number.isFinite(response.revision) || !response.committed_at) {
            throw new Error("invalid_editor_save_acknowledgement");
          }
          this.revision = response.revision;
          this.retryAttempt = 0;
          this.unresolvedSaveFailureMessage = undefined;
          this.acknowledgedGeneration = Math.max(this.acknowledgedGeneration, commit.generation);
          if (this.latest?.operation_id === commit.operation_id) this.latest = null;
          this.inFlight = null;
          if (this.latest) {
            this.latest = { ...this.latest, base_revision: this.revision };
            await this.persistRecordBestEffort(this.latest);
          }
          const acknowledgementIsLatest = commit.generation === this.generation && !this.snapshotProvider && !this.latest;
          if (acknowledgementIsLatest) {
            await this.deleteRecordBestEffort(commit.operation_id);
            this.emitSaveState({
              status: "saved",
              updatedTimestamp: response.committed_at,
              revision: response.revision,
              unresolvedFailure: false,
            });
          } else {
            this.emitSaveState({ status: "pending" });
          }
          this.publishPendingCount();
        } catch (cause) {
          this.inFlight = null;
          if (isConflict(cause)) {
            await this.captureScheduledSnapshot();
            const canonical = await this.options.requestJSON<MangoTiptapSnapshot>(this.path, {
              editorTraceContext: this.options.traceContext,
            });
            requireSnapshotDocument(canonical);
            this.raiseConflict(this.latest?.document ?? commit.document, canonical);
          } else {
            if (!this.latest) this.latest = commit;
            this.armRetry();
          }
          const message = cause instanceof Error ? cause.message : "Unable to save this text box";
          this.reportFailure(message);
          this.publishPendingCount();
          throw cause;
        }
      }
    }).finally(() => { this.drainPromise = undefined; });
    return this.drainPromise;
  }

  private raiseConflict(local: MangoTiptapDocument, canonical: MangoTiptapSnapshot): void {
    this.conflicted = true;
    incrementEditorRuntimeMetric("conflicts");
    this.options.onConflict?.({ local, canonical });
  }

  private emitSaveState(state: MangoTiptapSaveState): void {
    const published = publishEditorSaveState(this.storageKey, state);
    const previous = this.lastSaveState;
    if (previous?.status === published.status
      && previous.updatedTimestamp === published.updatedTimestamp
      && previous.revision === published.revision
      && previous.message === published.message
      && previous.unresolvedFailure === published.unresolvedFailure) return;
    this.lastSaveState = published;
    editorTraceInstant(this.options.traceContext ?? null, "sync.save_state.published", "editor.save_state", {
      status: published.status,
      revision: published.revision,
      unresolved_failure: Boolean(published.unresolvedFailure),
      has_message: Boolean(published.message),
    });
    this.options.onSaveStateChange?.(published);
  }

  private publishPendingCount(): void {
    const count = this.hasUnsavedLocalEdits() ? 1 : 0;
    if (count === this.lastPendingCount) return;
    this.lastPendingCount = count;
    editorTraceInstant(this.options.traceContext ?? null, "sync.pending_count.changed", "editor.pin", { pending_count: count });
    this.options.onPendingChange?.(count);
  }

  private clearTimer(which: "batch" | "max"): void {
    const active = which === "batch" ? this.batchTimer !== undefined : this.maxBatchTimer !== undefined;
    if (active) editorTraceInstant(this.options.traceContext ?? null, `sync.${which}_timer.cancelled`, "editor.timer");
    if (which === "batch" && this.batchTimer !== undefined) clearTimeout(this.batchTimer);
    if (which === "max" && this.maxBatchTimer !== undefined) clearTimeout(this.maxBatchTimer);
    if (which === "batch") {
      this.batchTimer = undefined;
      this.batchTimerExpectedAt = 0;
    } else {
      this.maxBatchTimer = undefined;
      this.maxBatchTimerExpectedAt = 0;
    }
  }

  private clearTimers(): void {
    this.clearTimer("batch");
    this.clearTimer("max");
    if (this.retryTimer !== undefined) {
      editorTraceInstant(this.options.traceContext ?? null, "sync.retry_timer.cancelled", "editor.timer");
      clearTimeout(this.retryTimer);
    }
    this.retryTimer = undefined;
    this.retryTimerExpectedAt = 0;
  }

  private armRetry(): void {
    if (this.stopped || this.conflicted || this.retryTimer !== undefined || !this.latest) return;
    const delay = Math.min(30_000, 1_000 * (2 ** Math.min(5, this.retryAttempt)));
    this.retryAttempt += 1;
    this.retryTimerExpectedAt = Date.now() + delay;
    editorTraceInstant(this.options.traceContext ?? null, "sync.retry_timer.armed", "editor.timer", { delay_ms: delay, attempt: this.retryAttempt });
    this.retryTimer = setTimeout(() => {
      const actualAt = Date.now();
      editorTraceInstant(this.options.traceContext ?? null, "sync.retry_timer.fired", "editor.timer", { late_by_ms: Math.max(0, actualAt - this.retryTimerExpectedAt), attempt: this.retryAttempt });
      this.retryTimer = undefined;
      void this.captureAndDrain().catch((cause) => this.options.onError?.(cause));
    }, delay);
  }
}
