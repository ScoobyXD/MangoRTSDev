import { sha256 } from "hash-wasm";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import type { NodeV2Client } from "./nodeV2Api.js";
import type { NodeV2SyncPage } from "./nodeV2Types.js";

const REMOTE_ORIGIN = Symbol("mango-node-v2-remote");
const PENDING_DATABASE = "mango-node-v2-recovery-v1";
const PENDING_STORE = "updates";
const FLUSH_INTERVAL_MS = 180;
const POLL_INTERVAL_MS = 3_000;
const CHECKPOINT_IDLE_MS = 1_500;
const CHECKPOINT_UPDATE_COUNT = 512;
const CHECKPOINT_UPDATE_BYTES = 512 * 1024;

export type NodeV2SaveState = "loading" | "saved" | "saving" | "offline" | "error";

type PendingUpdate = {
  key: string;
  scope: string;
  updateID: string;
  updateSHA256: string;
  collaborationEpoch: string;
  clientID: string;
  payloadBase64: string;
  createdAt: number;
};

type NodeV2SyncControllerOptions = {
  client: NodeV2Client;
  textboxID: string;
  companyID: string;
  nodeID: string;
  userID: string;
  onSaveState: (state: NodeV2SaveState) => void;
  onCheckpointNeeded: () => void;
  onError: (message: string) => void;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunk, bytes.length)));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function isEmptyYjsUpdate(update: Uint8Array): boolean {
  return update.length === 2 && update[0] === 0 && update[1] === 0;
}

function randomID(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function tabClientID(): string {
  const key = "mango-node-v2-tab-client-id";
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const created = randomID();
    sessionStorage.setItem(key, created);
    return created;
  } catch {
    return randomID();
  }
}

function openPendingDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PENDING_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PENDING_STORE)) {
        const store = request.result.createObjectStore(PENDING_STORE, { keyPath: "key" });
        store.createIndex("scope", "scope", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open recovery storage"));
  });
}

async function withPendingStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason: unknown) => void) => void): Promise<T> {
  const database = await openPendingDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(PENDING_STORE, mode);
    operation(transaction.objectStore(PENDING_STORE), resolve, reject);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error ?? new Error("Recovery storage transaction failed"));
  });
}

async function putPending(update: PendingUpdate): Promise<void> {
  await withPendingStore<void>("readwrite", (store, resolve, reject) => {
    const request = store.put(update);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function deletePending(key: string): Promise<void> {
  await withPendingStore<void>("readwrite", (store, resolve, reject) => {
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function listPending(scope: string): Promise<PendingUpdate[]> {
  return withPendingStore<PendingUpdate[]>("readonly", (store, resolve, reject) => {
    const request = store.index("scope").getAll(IDBKeyRange.only(scope));
    request.onsuccess = () => resolve((request.result as PendingUpdate[]).sort((left, right) => left.createdAt - right.createdAt));
    request.onerror = () => reject(request.error);
  });
}

async function applySyncPage(target: Y.Doc, page: NodeV2SyncPage): Promise<number> {
  if (page.checkpoint?.payload_base64) Y.applyUpdate(target, base64ToBytes(page.checkpoint.payload_base64), REMOTE_ORIGIN);
  page.updates.forEach((update) => Y.applyUpdate(target, base64ToBytes(update.payload_base64), REMOTE_ORIGIN));
  return page.updates[page.updates.length - 1]?.update_sequence ?? page.checkpoint?.through_update_sequence ?? page.textbox.materialized_through_sequence ?? 0;
}

export class NodeV2SyncController {
  readonly document = new Y.Doc();
  readonly storageKey: string;

  private readonly options: NodeV2SyncControllerOptions;
  private readonly clientID = tabClientID();
  private readonly persistence: IndexeddbPersistence;
  private collaborationEpoch = "";
  private serverSequence = 0;
  private localUpdates: Uint8Array[] = [];
  private localUpdateBytes = 0;
  private updatesSinceCheckpoint = 0;
  private bytesSinceCheckpoint = 0;
  private flushTimer?: ReturnType<typeof setTimeout>;
  private pollTimer?: ReturnType<typeof setInterval>;
  private checkpointTimer?: ReturnType<typeof setTimeout>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private retryDelay = 1_000;
  private stopped = false;
  private flushing?: Promise<void>;

  constructor(options: NodeV2SyncControllerOptions) {
    this.options = options;
    this.storageKey = ["node-v2", options.userID, options.companyID, options.nodeID, options.textboxID].join(":");
    this.persistence = new IndexeddbPersistence(this.storageKey, this.document);
  }

  async start(): Promise<void> {
    this.options.onSaveState("loading");
    await this.persistence.whenSynced;
    const initialServer = await this.loadServerDocument();
    this.collaborationEpoch = initialServer.page.textbox.collaboration_epoch;
    this.serverSequence = initialServer.sequence;
    await this.sendPending();

    const canonical = await this.loadServerDocument();
    this.serverSequence = canonical.sequence;
    const localDelta = Y.encodeStateAsUpdate(this.document, Y.encodeStateVector(canonical.document));
    const canonicalDelta = Y.encodeStateAsUpdate(canonical.document, Y.encodeStateVector(this.document));
    if (!isEmptyYjsUpdate(canonicalDelta)) Y.applyUpdate(this.document, canonicalDelta, REMOTE_ORIGIN);
    if (!isEmptyYjsUpdate(localDelta)) await this.stageUpdate(localDelta);

    this.document.on("update", this.handleDocumentUpdate);
    this.pollTimer = setInterval(() => { void this.pullRemote(); }, POLL_INTERVAL_MS);
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("offline", this.handleOffline);
    window.addEventListener("pagehide", this.handlePageHide);
    this.options.onSaveState(navigator.onLine ? "saved" : "offline");
  }

  private async loadServerDocument(): Promise<{ document: Y.Doc; page: NodeV2SyncPage; sequence: number }> {
    const canonical = new Y.Doc();
    let page = await this.options.client.sync(this.options.textboxID, 0, true);
    let sequence = await applySyncPage(canonical, page);
    while (page.has_more) {
      page = await this.options.client.sync(this.options.textboxID, sequence, false);
      sequence = await applySyncPage(canonical, page);
    }
    return { document: canonical, page, sequence };
  }

  private readonly handleDocumentUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE_ORIGIN || origin === this.persistence) return;
    this.localUpdates.push(update);
    this.localUpdateBytes += update.byteLength;
    this.options.onSaveState("saving");
    if (!navigator.onLine || this.localUpdateBytes >= CHECKPOINT_UPDATE_BYTES) {
      // Offline state is only shown after flush has durably queued the update in
      // IndexedDB. That makes "Offline" safe to use as the close/navigation gate.
      void this.flush().catch(() => undefined);
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => { this.flushTimer = undefined; void this.flush().catch(() => undefined); }, FLUSH_INTERVAL_MS);
    }
    if (this.checkpointTimer) clearTimeout(this.checkpointTimer);
    this.checkpointTimer = setTimeout(() => this.options.onCheckpointNeeded(), CHECKPOINT_IDLE_MS);
  };

  private readonly handleOnline = () => {
    this.retryDelay = 1_000;
    void this.flush().catch(() => undefined);
  };

  private readonly handleOffline = () => {
    if (this.localUpdates.length === 0 && !this.flushing) {
      this.options.onSaveState("offline");
      return;
    }
    this.options.onSaveState("saving");
    void this.flush().catch(() => undefined);
  };

  private readonly handlePageHide = () => {
    void this.flush(true);
  };

  private async stageUpdate(payload: Uint8Array): Promise<void> {
    if (!this.collaborationEpoch || isEmptyYjsUpdate(payload)) return;
    const updateID = randomID();
    const pending: PendingUpdate = {
      key: `${this.storageKey}:${updateID}`,
      scope: this.storageKey,
      updateID,
      updateSHA256: await sha256(payload),
      collaborationEpoch: this.collaborationEpoch,
      clientID: this.clientID,
      payloadBase64: bytesToBase64(payload),
      createdAt: Date.now(),
    };
    await putPending(pending);
    await this.sendOne(pending);
  }

  private async sendOne(pending: PendingUpdate, keepalive = false): Promise<void> {
    const result = await this.options.client.appendUpdate(this.options.textboxID, {
      collaboration_epoch: pending.collaborationEpoch,
      update_id: pending.updateID,
      update_sha256: pending.updateSHA256,
      client_id: pending.clientID,
      payload_base64: pending.payloadBase64,
    }, keepalive);
    this.serverSequence = Math.max(this.serverSequence, result.update_sequence ?? 0);
    this.updatesSinceCheckpoint += 1;
    this.bytesSinceCheckpoint += base64ToBytes(pending.payloadBase64).byteLength;
    await deletePending(pending.key);
  }

  private async sendPending(keepalive = false): Promise<void> {
    for (const pending of await listPending(this.storageKey)) await this.sendOne(pending, keepalive);
  }

  async flush(keepalive = false): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      if (this.flushTimer) clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
      const updates = this.localUpdates;
      this.localUpdates = [];
      this.localUpdateBytes = 0;
      try {
        if (updates.length > 0) await this.stageUpdate(Y.mergeUpdates(updates));
        await this.sendPending(keepalive);
        this.retryDelay = 1_000;
        this.options.onSaveState("saved");
        if (this.updatesSinceCheckpoint >= CHECKPOINT_UPDATE_COUNT || this.bytesSinceCheckpoint >= CHECKPOINT_UPDATE_BYTES) this.options.onCheckpointNeeded();
      } catch (cause) {
        this.options.onSaveState(navigator.onLine ? "error" : "offline");
        if (!this.stopped) {
          clearTimeout(this.retryTimer);
          this.retryTimer = setTimeout(() => { void this.flush().catch(() => undefined); }, this.retryDelay);
          this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
        }
        if (keepalive) return;
        throw cause;
      } finally {
        this.flushing = undefined;
      }
    })();
    return this.flushing;
  }

  async pullRemote(): Promise<void> {
    if (this.stopped || !navigator.onLine) return;
    try {
      let page = await this.options.client.sync(this.options.textboxID, this.serverSequence, false);
      while (true) {
        page.updates.forEach((update) => Y.applyUpdate(this.document, base64ToBytes(update.payload_base64), REMOTE_ORIGIN));
        this.serverSequence = page.updates[page.updates.length - 1]?.update_sequence ?? this.serverSequence;
        if (!page.has_more) break;
        page = await this.options.client.sync(this.options.textboxID, this.serverSequence, false);
      }
    } catch {
      // Poll failures use the update retry path; local typing remains available.
    }
  }

  async checkpoint(documentJSON: Record<string, unknown>, plainText: string, reason: string): Promise<void> {
    await this.flush();
    await this.pullRemote();
    await this.options.client.checkpoint(this.options.textboxID, {
      checkpoint_id: randomID(),
      collaboration_epoch: this.collaborationEpoch,
      through_update_sequence: this.serverSequence,
      payload_base64: bytesToBase64(Y.encodeStateAsUpdate(this.document)),
      state_vector_base64: bytesToBase64(Y.encodeStateVector(this.document)),
      document_json: {
        format: "mango-tiptap-json",
        schema_version: 1,
        document: documentJSON,
      },
      plain_text: plainText,
      reason: reason === "manual_recovery" ? reason : "idle",
    });
    this.updatesSinceCheckpoint = 0;
    this.bytesSinceCheckpoint = 0;
    this.options.onSaveState("saved");
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.flushTimer);
    clearTimeout(this.checkpointTimer);
    clearTimeout(this.retryTimer);
    clearInterval(this.pollTimer);
    window.removeEventListener("online", this.handleOnline);
    window.removeEventListener("offline", this.handleOffline);
    window.removeEventListener("pagehide", this.handlePageHide);
    this.document.off("update", this.handleDocumentUpdate);
    try {
      await this.flush();
    } catch (cause) {
      this.options.onError(cause instanceof Error ? cause.message : "The text box remains safely queued for retry.");
    }
    this.persistence.destroy();
    this.document.destroy();
  }
}
