import { incrementEditorRuntimeMetric } from "../editorRuntimeMetrics.js";
import {
  parseMangoTiptapDocument,
  serializeMangoTiptapDocument,
  type MangoTiptapDocument,
} from "./mangoTiptapDocument.js";

export type MangoTiptapResourceType =
  | "node"
  | "project"
  | "logic_gate"
  | "email_draft"
  | "email_signature";

export type MangoTiptapRequest = <T>(path: string, init?: RequestInit & { json?: unknown }) => Promise<T>;

export type MangoTiptapSnapshot = {
  revision: number;
  schema_version: number;
  document: MangoTiptapDocument;
  deleted?: boolean;
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
  created_at: number;
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
  onPendingChange?: (pendingCount: number) => void;
  onConflict?: (conflict: MangoTiptapConflict) => void;
  onError?: (cause: unknown) => void;
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
  private unsubscribe: (() => void) | undefined;
  private stopped = false;
  private conflicted = false;

  constructor(private readonly options: MangoTiptapSyncOptions) {
    this.storageKey = mangoTiptapPendingStorageKey(options);
    this.clientID = clientID();
    this.revision = Math.max(0, Math.trunc(options.initialRevision ?? 0));
    this.path = `/v1/editor-json/${encodeURIComponent(options.resourceType)}/${encodeURIComponent(options.resourceID)}/documents/${encodeURIComponent(options.documentID)}?company_id=${encodeURIComponent(options.companyID)}`;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.unsubscribe = this.options.subscribeToCanonicalChange?.(() => {
      void this.recover().catch((cause) => this.options.onError?.(cause));
    }, this.clientID);
    await this.recover();
  }

  schedule(document: MangoTiptapDocument, immediate = false): void {
    if (this.stopped || this.conflicted) return;
    const serialized = serializeMangoTiptapDocument(document);
    this.persistence = this.persistence.then(async () => {
      const pendingDocument = JSON.parse(serialized) as MangoTiptapDocument;
      const last = this.pending[this.pending.length - 1];
      if (last && this.drainPromise === undefined) {
        last.document = pendingDocument;
      } else {
        this.pending.push({
          operation_id: stableID(),
          client_id: this.clientID,
          base_revision: this.revision + this.pending.length,
          document: pendingDocument,
          created_at: Date.now(),
        });
      }
      await this.persistPending();
      this.options.onPendingChange?.(this.pending.length);
      this.armDrain(immediate);
    }).catch((cause) => this.options.onError?.(cause));
  }

  async flush(): Promise<void> {
    this.clearTimers();
    await this.persistence;
    await this.drain();
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    this.clearTimers();
    await this.persistence;
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
    await this.persistence;
    const [record, canonical] = await Promise.all([
      readExactMangoTiptapPending(this.storageKey),
      this.options.requestJSON<MangoTiptapSnapshot>(this.path),
    ]);
    const validation = parseMangoTiptapDocument(JSON.stringify(canonical.document));
    if (!validation.valid) throw new Error(`invalid_canonical_tiptap_document: ${validation.error}`);
    this.revision = canonical.revision;
    this.pending = record?.commits ?? [];
    this.options.onPendingChange?.(this.pending.length);
    if (canonical.deleted) {
      this.pending = [];
      await this.persistPending();
      this.options.onDocument(validation.value, "canonical");
      return;
    }
    if (this.pending.length > 0 && this.pending[0].base_revision !== canonical.revision) {
      this.raiseConflict(this.pending[this.pending.length - 1]?.document ?? validation.value, { ...canonical, document: validation.value });
      return;
    }
    this.options.onDocument(this.pending[this.pending.length - 1]?.document ?? validation.value, this.pending.length ? "recovery" : "canonical");
    if (this.pending.length > 0) await this.drain();
  }

  async resolveConflict(choice: "keep-local" | "use-canonical"): Promise<void> {
    const canonical = await this.options.requestJSON<MangoTiptapSnapshot>(this.path);
    const validation = parseMangoTiptapDocument(JSON.stringify(canonical.document));
    if (!validation.valid) throw new Error(`invalid_canonical_tiptap_document: ${validation.error}`);
    const local = this.pending[this.pending.length - 1]?.document;
    this.revision = canonical.revision;
    this.pending = [];
    this.conflicted = false;
    if (choice === "keep-local" && local) {
      this.pending.push({
        operation_id: stableID(),
        client_id: this.clientID,
        base_revision: canonical.revision,
        document: local,
        created_at: Date.now(),
      });
      await this.persistPending();
      this.options.onDocument(local, "recovery");
      await this.drain();
      return;
    }
    await this.persistPending();
    this.options.onPendingChange?.(0);
    this.options.onDocument(validation.value, "canonical");
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

  private armDrain(immediate: boolean): void {
    this.clearTimer("batch");
    if (immediate) {
      void this.drain().catch((cause) => this.options.onError?.(cause));
      return;
    }
    this.batchTimer = setTimeout(() => {
      this.batchTimer = undefined;
      void this.drain().catch((cause) => this.options.onError?.(cause));
    }, this.options.batchMs ?? 500);
    if (this.maxBatchTimer === undefined) {
      this.maxBatchTimer = setTimeout(() => {
        this.maxBatchTimer = undefined;
        void this.drain().catch((cause) => this.options.onError?.(cause));
      }, this.options.maxBatchMs ?? 2_000);
    }
  }

  private async drain(): Promise<void> {
    if (this.drainPromise) return this.drainPromise;
    this.clearTimers();
    this.drainPromise = (async () => {
      while (this.pending.length > 0 && !this.conflicted) {
        const commit = this.pending[0];
        try {
          incrementEditorRuntimeMetric("network_saves");
          const response = await this.options.requestJSON<MangoTiptapSnapshot & { deduplicated?: boolean }>(this.path, {
            method: "POST",
            json: {
              operation_id: commit.operation_id,
              client_id: commit.client_id,
              base_revision: commit.base_revision,
              schema_version: commit.document.schema_version,
              document: commit.document,
            },
          });
          const validation = parseMangoTiptapDocument(JSON.stringify(response.document));
          if (!validation.valid) throw new Error(`invalid_committed_tiptap_document: ${validation.error}`);
          this.revision = response.revision;
          this.retryAttempt = 0;
          this.pending.shift();
          this.pending.forEach((next, index) => { next.base_revision = this.revision + index; });
          await this.persistPending();
          this.options.onPendingChange?.(this.pending.length);
        } catch (cause) {
          if (isConflict(cause)) {
            const canonical = await this.options.requestJSON<MangoTiptapSnapshot>(this.path);
            this.raiseConflict(commit.document, canonical);
          } else {
            this.armRetry();
          }
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
