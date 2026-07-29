import { incrementEditorRuntimeMetric } from "../editorRuntimeMetrics.js";
import type { MangoTiptapPersistedAnnotation } from "./mangoTiptapAnnotations.js";
import {
  normalizeMangoTiptapDocument,
  parseMangoTiptapDocument,
  serializeMangoTiptapDocument,
  type MangoTiptapDocument,
} from "./mangoTiptapDocument.js";

export type MangoTiptapResourceType =
  | "node"
  | "project"
  | "logic_gate";

export type MangoTiptapRequest = <T>(path: string, init?: RequestInit & { json?: unknown }) => Promise<T>;

export type MangoTiptapSnapshot = {
  revision: number;
  schema_version: number;
  document: MangoTiptapDocument;
  annotations?: MangoTiptapPersistedAnnotation[];
  deleted?: boolean;
  updated_timestamp?: string;
  committed_at?: string;
};

export type MangoTiptapSaveState = {
  status: "pending" | "saving" | "saved" | "failed";
  updatedTimestamp?: string;
  revision?: number;
  message?: string;
};

export type MangoTiptapConflict = {
  local: MangoTiptapDocument;
  canonical: MangoTiptapSnapshot;
};

type PendingCommit = {
  operation_id: string;
  client_id: string;
  base_revision: number;
  document: MangoTiptapDocument;
  annotations: MangoTiptapPersistedAnnotation[];
  created_at: number;
  attempted: boolean;
};

type PendingDocumentRecord = {
  storage_key: string;
  company_id: string;
  resource_type: MangoTiptapResourceType;
  resource_id: string;
  document_id: string;
  commits: PendingCommit[];
};

export type MangoTiptapSyncOptions = {
  companyID: string;
  resourceType: MangoTiptapResourceType;
  resourceID: string;
  documentID: string;
  requestJSON: MangoTiptapRequest;
  initialRevision?: number;
  onDocument: (document: MangoTiptapDocument, source: "canonical" | "recovery") => void;
  onAnnotations?: (annotations: readonly MangoTiptapPersistedAnnotation[], source: "canonical" | "recovery") => void;
  onSnapshot?: (document: MangoTiptapDocument, serialized: string, annotations: readonly MangoTiptapPersistedAnnotation[]) => void;
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
const DB_VERSION = 1;
const CLIENT_KEY = "mango-tiptap-client-v1";

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

function openDB(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("tiptap_pending_storage_unavailable"));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE)) {
        request.result.createObjectStore(DB_STORE, { keyPath: "storage_key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("tiptap_pending_storage_unavailable"));
    request.onblocked = () => reject(new Error("tiptap_pending_storage_blocked"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore, resolve: (value: T) => void, reject: (cause: unknown) => void) => void,
): Promise<T> {
  const db = await openDB();
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
}

export async function readExactMangoTiptapPending(storage_key: string): Promise<PendingDocumentRecord | null> {
  incrementEditorRuntimeMetric("indexeddb_reads");
  return withStore("readonly", (store, resolve, reject) => {
    const request = store.get(storage_key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve((request.result as PendingDocumentRecord | undefined) ?? null);
  });
}

async function writePending(record: PendingDocumentRecord): Promise<void> {
  incrementEditorRuntimeMetric("indexeddb_writes");
  await withStore<void>("readwrite", (store, resolve, reject) => {
    const request = record.commits.length > 0 ? store.put(record) : store.delete(record.storage_key);
    request.onerror = () => reject(request.error);
    store.transaction.oncomplete = () => resolve();
  });
}

function isConflict(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "status" in cause && Number((cause as { status?: unknown }).status) === 409
    || cause instanceof Error && /conflict|revision|stale/i.test(cause.message);
}

export class MangoTiptapSync {
  private readonly storageKey: string;
  private readonly clientID: string;
  private readonly path: string;
  private revision: number;
  private pending: PendingCommit[] = [];
  private persistence = Promise.resolve();
  private drainPromise: Promise<void> | undefined;
  private recoverPromise: Promise<void> | undefined;
  private batchTimer: ReturnType<typeof setTimeout> | undefined;
  private maxBatchTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryAttempt = 0;
  private snapshotProvider: (() => MangoTiptapDocument) | undefined;
  private annotationProvider: (() => readonly MangoTiptapPersistedAnnotation[]) | undefined;
  private unsubscribe: (() => void) | undefined;
  private realtimeVisible = false;
  private stopped = false;
  private conflicted = false;
  private recoveryStorageFailed = false;

  constructor(private readonly options: MangoTiptapSyncOptions) {
    this.storageKey = mangoTiptapPendingStorageKey(options);
    this.clientID = clientID();
    this.revision = Math.max(0, Math.trunc(options.initialRevision ?? 0));
    this.path = `/v1/editor-json/${encodeURIComponent(options.resourceType)}/${encodeURIComponent(options.resourceID)}/documents/${encodeURIComponent(options.documentID)}?company_id=${encodeURIComponent(options.companyID)}`;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.recover();
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
    if (this.stopped || this.conflicted) return;
    this.snapshotProvider = typeof document === "function" ? document : () => document;
    this.annotationProvider = annotations;
    this.options.onSaveStateChange?.({ status: "pending" });
    this.armDrain(immediate);
  }

  private captureScheduledSnapshot(): Promise<void> {
    const provider = this.snapshotProvider;
    const annotationProvider = this.annotationProvider;
    this.snapshotProvider = undefined;
    this.annotationProvider = undefined;
    if (!provider) return this.persistence;
    let serialized: string;
    let pendingDocument: MangoTiptapDocument;
    let annotations: MangoTiptapPersistedAnnotation[];
    try {
      pendingDocument = normalizeMangoTiptapDocument(provider());
      serialized = serializeMangoTiptapDocument(pendingDocument);
      annotations = [...(annotationProvider?.() ?? [])];
    } catch (cause) {
      this.options.onSaveStateChange?.({
        status: "failed",
        message: cause instanceof Error ? cause.message : "Unable to prepare this text box for saving",
      });
      this.options.onError?.(cause);
      return this.persistence;
    }
    this.options.onSnapshot?.(pendingDocument, serialized, annotations);
    this.persistence = this.persistence.catch(() => undefined).then(async () => {
      const last = this.pending[this.pending.length - 1];
      if (last && !last.attempted) {
        last.document = pendingDocument;
        last.annotations = annotations;
      } else {
        this.pending.push({
          operation_id: stableID(),
          client_id: this.clientID,
          base_revision: this.revision + this.pending.length,
          document: pendingDocument,
          annotations,
          created_at: Date.now(),
          attempted: this.pending.length === 0 && this.drainPromise === undefined,
        });
      }
      this.options.onPendingChange?.(this.pending.length);
      await this.persistPendingBestEffort();
    });
    return this.persistence;
  }

  private async captureAndDrain(): Promise<void> {
    this.clearTimers();
    await this.captureScheduledSnapshot();
    await this.drain();
  }

  async flush(): Promise<void> {
    this.clearTimers();
    await this.captureScheduledSnapshot();
    await this.drain();
  }

  async shutdown(): Promise<void> {
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
  }

  recover(): Promise<void> {
    if (this.recoverPromise) return this.recoverPromise;
    const recovery = this.performRecovery().finally(() => {
      if (this.recoverPromise === recovery) this.recoverPromise = undefined;
    });
    this.recoverPromise = recovery;
    return recovery;
  }

  private async performRecovery(): Promise<void> {
    incrementEditorRuntimeMetric("recovery_requests");
    await this.captureScheduledSnapshot();
    let recoveryStorageAvailable = true;
    const [record, canonical] = await Promise.all([
      readExactMangoTiptapPending(this.storageKey).then((record) => {
        this.reportRecoveryStorageRecovered();
        return record;
      }).catch((cause) => {
        recoveryStorageAvailable = false;
        this.reportRecoveryStorageFailure(cause);
        return null;
      }),
      this.options.requestJSON<MangoTiptapSnapshot>(this.path),
    ]);
    const validation = parseMangoTiptapDocument(JSON.stringify(canonical.document));
    if (!validation.valid) throw new Error(`invalid_canonical_tiptap_document: ${validation.error}`);
    this.revision = canonical.revision;
    if (recoveryStorageAvailable) {
      this.pending = (record?.commits ?? []).map((commit) => ({ ...commit, annotations: commit.annotations ?? [], attempted: commit.attempted !== false }));
    } else {
      // Storage failure must not erase an in-memory operation that still needs its
      // canonical backend acknowledgement during an active browser session.
      this.pending = this.pending.map((commit) => ({ ...commit, annotations: commit.annotations ?? [], attempted: commit.attempted !== false }));
    }
    this.options.onPendingChange?.(this.pending.length);
    this.options.onSaveStateChange?.(this.pending.length > 0
      ? { status: "pending" }
      : {
        status: "saved",
        updatedTimestamp: canonical.updated_timestamp ?? canonical.committed_at,
        revision: canonical.revision,
      });
    if (canonical.deleted) {
      this.pending = [];
      this.options.onPendingChange?.(0);
      await this.persistPendingBestEffort();
      this.options.onDocument(validation.value, "canonical");
      this.options.onAnnotations?.(canonical.annotations ?? [], "canonical");
      return;
    }
    const recovered = this.pending[this.pending.length - 1];
    this.options.onDocument(recovered?.document ?? validation.value, recovered ? "recovery" : "canonical");
    this.options.onAnnotations?.(recovered?.annotations ?? canonical.annotations ?? [], recovered ? "recovery" : "canonical");
    // Replay the exact stable operation before interpreting a revision mismatch. The
    // backend deduplicates an already-accepted operation ID before its base check.
    if (this.pending.length > 0) await this.drain();
  }

  async resolveConflict(choice: "keep-local" | "use-canonical"): Promise<void> {
    const canonical = await this.options.requestJSON<MangoTiptapSnapshot>(this.path);
    const validation = parseMangoTiptapDocument(JSON.stringify(canonical.document));
    if (!validation.valid) throw new Error(`invalid_canonical_tiptap_document: ${validation.error}`);
    const localCommit = this.pending[this.pending.length - 1];
    this.revision = canonical.revision;
    this.pending = [];
    this.conflicted = false;
    if (choice === "keep-local" && localCommit) {
      this.pending.push({
        operation_id: stableID(),
        client_id: this.clientID,
        base_revision: canonical.revision,
        document: localCommit.document,
        annotations: localCommit.annotations ?? [],
        created_at: Date.now(),
        attempted: true,
      });
      this.options.onPendingChange?.(1);
      await this.persistPendingBestEffort();
      this.options.onDocument(localCommit.document, "recovery");
      this.options.onAnnotations?.(localCommit.annotations ?? [], "recovery");
      await this.drain();
      return;
    }
    this.options.onPendingChange?.(0);
    await this.persistPendingBestEffort();
    this.options.onDocument(validation.value, "canonical");
    this.options.onAnnotations?.(canonical.annotations ?? [], "canonical");
  }

  private async persistPending(): Promise<void> {
    await writePending({
      storage_key: this.storageKey,
      company_id: this.options.companyID,
      resource_type: this.options.resourceType,
      resource_id: this.options.resourceID,
      document_id: this.options.documentID,
      commits: this.pending,
    });
  }

  private async persistPendingBestEffort(): Promise<boolean> {
    try {
      await this.persistPending();
      if (this.pending.length > 0) this.reportRecoveryStorageRecovered();
      return true;
    } catch (cause) {
      this.reportRecoveryStorageFailure(cause);
      return false;
    }
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
      void this.captureAndDrain().catch((cause) => this.options.onError?.(cause));
      return;
    }
    this.batchTimer = setTimeout(() => {
      this.batchTimer = undefined;
      void this.captureAndDrain().catch((cause) => this.options.onError?.(cause));
    }, this.options.batchMs ?? 180);
    if (this.maxBatchTimer === undefined) {
      this.maxBatchTimer = setTimeout(() => {
        this.maxBatchTimer = undefined;
        void this.captureAndDrain().catch((cause) => this.options.onError?.(cause));
      }, this.options.maxBatchMs ?? 1_500);
    }
  }

  private async drain(): Promise<void> {
    if (this.drainPromise) return this.drainPromise;
    this.drainPromise = (async () => {
      while (this.pending.length > 0 && !this.conflicted) {
        const commit = this.pending[0];
        try {
          this.options.onSaveStateChange?.({ status: "saving" });
          if (!commit.attempted) {
            commit.attempted = true;
            await this.persistPendingBestEffort();
          }
          incrementEditorRuntimeMetric("network_saves");
          const response = await this.options.requestJSON<MangoTiptapSnapshot & { deduplicated?: boolean }>(this.path, {
            method: "POST",
            json: {
              operation_id: commit.operation_id,
              client_id: commit.client_id,
              base_revision: commit.base_revision,
              schema_version: commit.document.schema_version,
              document: commit.document,
              annotations: commit.annotations ?? [],
            },
          });
          const validation = parseMangoTiptapDocument(JSON.stringify(response.document));
          if (!validation.valid) throw new Error(`invalid_committed_tiptap_document: ${validation.error}`);
          this.revision = response.revision;
          this.retryAttempt = 0;
          this.pending.shift();
          this.pending.forEach((next, index) => { if (!next.attempted) next.base_revision = this.revision + index; });
          // The server acknowledgement is canonical even when local browser storage
          // cleanup fails. Release virtualization pins before best-effort cleanup.
          this.options.onPendingChange?.(this.pending.length);
          this.options.onSaveStateChange?.(this.pending.length > 0 || this.snapshotProvider
            ? { status: "pending" }
            : {
              status: "saved",
              updatedTimestamp: response.committed_at ?? response.updated_timestamp,
              revision: response.revision,
            });
          this.options.onAnnotations?.(response.annotations ?? commit.annotations ?? [], "canonical");
          await this.persistPendingBestEffort();
        } catch (cause) {
          if (isConflict(cause)) {
            const canonical = await this.options.requestJSON<MangoTiptapSnapshot>(this.path);
            this.raiseConflict(commit.document, canonical);
          } else {
            this.armRetry();
          }
          this.options.onSaveStateChange?.({
            status: "failed",
            message: cause instanceof Error ? cause.message : "Unable to save this text box",
          });
          throw cause;
        }
      }
    })().finally(() => { this.drainPromise = undefined; });
    return this.drainPromise;
  }

  private raiseConflict(local: MangoTiptapDocument, canonical: MangoTiptapSnapshot): void {
    this.conflicted = true;
    incrementEditorRuntimeMetric("conflicts");
    this.options.onConflict?.({ local, canonical });
  }

  private clearTimer(which: "batch" | "max"): void {
    if (which === "batch" && this.batchTimer !== undefined) clearTimeout(this.batchTimer);
    if (which === "max" && this.maxBatchTimer !== undefined) clearTimeout(this.maxBatchTimer);
    if (which === "batch") this.batchTimer = undefined;
    else this.maxBatchTimer = undefined;
  }

  private clearTimers(): void {
    this.clearTimer("batch");
    this.clearTimer("max");
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  private armRetry(): void {
    if (this.stopped || this.conflicted || this.retryTimer !== undefined || this.pending.length === 0) return;
    const delay = Math.min(30_000, 1_000 * (2 ** Math.min(5, this.retryAttempt)));
    this.retryAttempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.drain().catch((cause) => this.options.onError?.(cause));
    }, delay);
  }
}
