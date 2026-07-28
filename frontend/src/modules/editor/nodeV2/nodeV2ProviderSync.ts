import { HocuspocusProvider, WebSocketStatus } from "@hocuspocus/provider";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";

import type { NodeV2Client } from "./nodeV2Api.js";

const DURABLE_ACK_TYPE = "node-v2-yjs.durable-ack.v1";
const DURABILITY_ERROR_TYPE = "node-v2-yjs.durability-error.v1";
const RECOVERY_STATE_KEY = "pending-server-durability-update";

export type NodeV2SaveState = "loading" | "saved" | "saving" | "offline" | "error";

type NodeV2ProviderSyncControllerOptions = {
  client: NodeV2Client;
  textboxID: string;
  companyID: string;
  nodeID: string;
  userID: string;
  collaborationURL?: string;
  onSaveState: (state: NodeV2SaveState) => void;
  onError: (message: string) => void;
};

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

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}


function configuredCollaborationURL(explicit?: string): string {
  const value = explicit?.trim() || String(import.meta.env.VITE_NODE_V2_COLLAB_URL || "").trim();
  if (!value) throw new Error("Node V2 collaboration is active, but VITE_NODE_V2_COLLAB_URL is not configured.");
  if (!/^wss?:\/\//i.test(value)) throw new Error("VITE_NODE_V2_COLLAB_URL must start with ws:// or wss://.");
  return value.replace(/\/$/, "");
}

export class NodeV2ProviderSyncController {
  readonly document = new Y.Doc();
  readonly storageKey: string;

  private readonly options: NodeV2ProviderSyncControllerOptions;
  private readonly clientID = tabClientID();
  private readonly persistence: IndexeddbPersistence;
  private provider?: HocuspocusProvider;
  private stopped = false;
  private localDirty = false;
  private durableSnapshot?: Y.Snapshot;
  private durableWaiters = new Set<() => void>();
  private recoveryPersistence: Promise<unknown> = Promise.resolve();

  constructor(options: NodeV2ProviderSyncControllerOptions) {
    this.options = options;
    this.storageKey = ["node-v2", options.userID, options.companyID, options.nodeID, options.textboxID].join(":");
    this.persistence = new IndexeddbPersistence(this.storageKey, this.document);
  }

  async start(): Promise<void> {
    this.options.onSaveState("loading");
    this.document.on("update", this.handleDocumentUpdate);
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("offline", this.handleOffline);
    await this.persistence.whenSynced;
    if (this.stopped) return;
    const recoveryState = await this.persistence.get(RECOVERY_STATE_KEY);
    if (recoveryState instanceof Uint8Array) {
      Y.applyUpdate(this.document, recoveryState, this.persistence);
    } else if (recoveryState instanceof ArrayBuffer) {
      Y.applyUpdate(this.document, new Uint8Array(recoveryState), this.persistence);
    }
    // A browser crash loses in-memory dirty state but not IndexedDB. Treat every
    // recovered document as pending until an exact PostgreSQL snapshot proves it
    // durable; a normal clean mount receives the same status immediately.
    this.localDirty = true;

    const url = configuredCollaborationURL(this.options.collaborationURL);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (settled || this.stopped) return;
        settled = true;
        reject(new Error("Timed out connecting to Node V2 collaboration."));
      }, 20_000);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        error ? reject(error) : resolve();
      };
      this.provider = new HocuspocusProvider({
        url,
        name: ["node-textbox", this.options.companyID.toLowerCase(), this.options.nodeID.toLowerCase(), this.options.textboxID.toLowerCase()].join(":"),
        document: this.document,
        token: async () => (await this.options.client.collaborationTicket(this.options.textboxID, this.clientID)).token,
        onSynced: ({ state }) => {
          if (!state) return;
          finish();
          this.maybeMarkDurable();
          if (this.localDirty) this.options.onSaveState(navigator.onLine ? "saving" : "offline");
        },
        onStatus: ({ status }) => {
          if (status === WebSocketStatus.Disconnected && !this.stopped) {
            this.options.onSaveState(navigator.onLine ? "saving" : "offline");
          }
        },
        onAuthenticationFailed: ({ reason }) => {
          finish(new Error(reason || "Node V2 collaboration authorization failed."));
          this.options.onSaveState("error");
        },
        onStateless: ({ payload }) => this.handleStateless(payload),
      });
    });
  }

  private readonly handleDocumentUpdate = (
    _update: Uint8Array,
    origin: unknown,
    _document: Y.Doc,
    transaction: Y.Transaction,
  ) => {
    if (origin !== this.persistence && transaction.local) {
      this.localDirty = true;
      this.options.onSaveState("saving");
      const recoveryState = Y.encodeStateAsUpdate(this.document);
      this.recoveryPersistence = this.recoveryPersistence
        .then(() => this.persistence.set(RECOVERY_STATE_KEY, recoveryState))
        .then(() => {
          if (!navigator.onLine && this.localDirty && !this.stopped) this.options.onSaveState("offline");
        })
        .catch(() => {
          if (!this.stopped) {
            this.options.onSaveState("error");
            this.options.onError("This edit could not be stored for offline recovery.");
          }
        });
    }
    // A durability status can arrive before a remote sync update. Re-checking
    // after every document update makes that ordering safe.
    this.maybeMarkDurable();
  };

  private maybeMarkDurable(): void {
    if (!this.localDirty || !this.durableSnapshot) return;
    if (!Y.equalSnapshots(Y.snapshot(this.document), this.durableSnapshot)) return;
    this.localDirty = false;
    this.recoveryPersistence = this.recoveryPersistence
      .then(() => this.persistence.del(RECOVERY_STATE_KEY))
      .catch(() => {
        // A stale recovery snapshot is safe: the next exact server status clears it.
      });
    this.options.onSaveState(navigator.onLine ? "saved" : "offline");
    for (const resolve of this.durableWaiters) resolve();
    this.durableWaiters.clear();
  }

  private handleStateless(payload: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return;
    }
    if (message.type === DURABILITY_ERROR_TYPE) {
      this.options.onSaveState("error");
      this.options.onError("The collaboration service could not commit this edit. It remains in this browser and will retry after reconnect.");
      this.provider?.disconnect();
      return;
    }
    if (message.type !== DURABLE_ACK_TYPE || typeof message.durable_snapshot_base64 !== "string") return;
    try {
      this.durableSnapshot = Y.decodeSnapshot(base64ToBytes(message.durable_snapshot_base64));
      this.maybeMarkDurable();
    } catch {
      this.options.onSaveState("error");
    }
  }

  private readonly handleOnline = () => {
    if (this.stopped) return;
    this.options.onSaveState(this.localDirty ? "saving" : "saved");
    void this.provider?.connect();
  };

  private readonly handleOffline = () => {
    this.options.onSaveState("offline");
  };

  async flush(): Promise<void> {
    if (this.stopped || !this.localDirty) return;
    if (!navigator.onLine) {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      this.options.onSaveState("offline");
      return;
    }
    this.options.onSaveState("saving");
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.durableWaiters.delete(done);
        reject(new Error("Timed out waiting for the durable collaboration acknowledgement."));
      }, 15_000);
      const done = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      this.durableWaiters.add(done);
    });
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    window.removeEventListener("online", this.handleOnline);
    window.removeEventListener("offline", this.handleOffline);
    this.document.off("update", this.handleDocumentUpdate);
    for (const resolve of this.durableWaiters) resolve();
    this.durableWaiters.clear();
    this.provider?.destroy();
    this.provider = undefined;
    await this.recoveryPersistence;
    await this.persistence.destroy();
    this.document.destroy();
  }
}
