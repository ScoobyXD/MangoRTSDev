import { HocuspocusProvider, WebSocketStatus } from "@hocuspocus/provider";
import { yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";

import type { MangoTiptapPersistedAnnotation } from "./mangoTiptapAnnotations.js";
import { MANGO_TIPTAP_FORMAT, MANGO_TIPTAP_SCHEMA_VERSION, validateMangoTiptapDocument, type MangoTiptapDocument } from "./mangoTiptapDocument.js";
import type { MangoTiptapRequest, MangoTiptapResourceType } from "./mangoTiptapSync.js";

const DURABLE_ACK_TYPE = "node-v2-yjs.durable-ack.v1";
const DURABILITY_ERROR_TYPE = "node-v2-yjs.durability-error.v1";
const RECOVERY_STATE_KEY = "pending-server-durability-update";

type CollaborationTicket = {
  token: string;
  document_name: string;
  collaboration_epoch: string;
};

type EditorOwnerSnapshot = {
  document: MangoTiptapDocument;
  annotations?: MangoTiptapPersistedAnnotation[];
};

export type MangoTiptapMentionDelta = { user_id: string; label: string; kind: "regular" | "urgent" };
type PendingMentionNotification = { actor_user_id: string; mentions: MangoTiptapMentionDelta[] };

export type MangoTiptapProviderSyncOptions = {
  companyID: string;
  resourceType: MangoTiptapResourceType;
  resourceID: string;
  documentID: string;
  userID?: string;
  requestJSON: MangoTiptapRequest;
  collaborationURL?: string;
  onPendingChange?: (count: number) => void;
  onDocument?: (document: MangoTiptapDocument) => void;
  onAnnotations?: (annotations: readonly MangoTiptapPersistedAnnotation[]) => void;
  onError?: (cause: unknown) => void;
  onRecoveryStorageError?: (message: string) => void;
  onRecoveryStorageRecovered?: () => void;
};

function randomID(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function tabClientID(): string {
  const key = "mango-editor-owner-tab-client-id";
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const created = randomID();
    sessionStorage.setItem(key, created);
    return created;
  } catch { return randomID(); }
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function configuredCollaborationURL(explicit?: string): string {
  const value = explicit?.trim() || String(import.meta.env.VITE_NODE_V2_COLLAB_URL || "").trim();
  if (!value) throw new Error("Editor collaboration is active, but VITE_NODE_V2_COLLAB_URL is not configured.");
  if (!/^wss?:\/\//i.test(value)) throw new Error("VITE_NODE_V2_COLLAB_URL must start with ws:// or wss://.");
  return value.replace(/\/$/, "");
}

function parseAnnotations(document: Y.Doc): MangoTiptapPersistedAnnotation[] {
  const raw = document.getMap("mango-metadata").get("annotations");
  if (raw === undefined) return [];
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(value) ? value as MangoTiptapPersistedAnnotation[] : [];
  } catch { return []; }
}

export class MangoTiptapProviderSync {
  readonly document = new Y.Doc();
  readonly clientID = tabClientID();

  private persistence?: IndexeddbPersistence;
  private provider?: HocuspocusProvider;
  private documentName = "";
  private started = false;
  private stopped = false;
  private hydrated = false;
  private synced = false;
  private realtimeVisible = false;
  private connectPromise?: Promise<void>;
  private localDirty = false;
  private durableSnapshot?: Y.Snapshot;
  private durableWaiters = new Set<() => void>();
  private recoveryPersistence: Promise<unknown> = Promise.resolve();
  private mentionDrain?: Promise<void>;

  constructor(private readonly options: MangoTiptapProviderSyncOptions) {}

  private ticketPath(): string {
    return `/v1/editor-json/${encodeURIComponent(this.options.resourceType)}/${encodeURIComponent(this.options.resourceID)}/documents/${encodeURIComponent(this.options.documentID)}/collaboration-ticket?company_id=${encodeURIComponent(this.options.companyID)}`;
  }

  private documentPath(): string {
    return `/v1/editor-json/${encodeURIComponent(this.options.resourceType)}/${encodeURIComponent(this.options.resourceID)}/documents/${encodeURIComponent(this.options.documentID)}?company_id=${encodeURIComponent(this.options.companyID)}`;
  }

  private async collaborationTicket(): Promise<CollaborationTicket> {
    const ticket = await this.options.requestJSON<CollaborationTicket>(this.ticketPath(), { method: "POST", json: { client_id: this.clientID } });
    if (!ticket.token || !ticket.document_name) throw new Error("Editor collaboration ticket was incomplete.");
    if (this.documentName && ticket.document_name !== this.documentName) throw new Error("This editor was reset. Reload it before making more changes.");
    return ticket;
  }

  async start(): Promise<void> {
    if (this.started) return;
    const snapshot = await this.options.requestJSON<EditorOwnerSnapshot>(this.documentPath());
    const validation = validateMangoTiptapDocument(snapshot.document);
    if (!validation.valid) throw new Error(`invalid_collaboration_document:${validation.error}`);
    this.options.onDocument?.(validation.value);
    this.options.onAnnotations?.(Array.isArray(snapshot.annotations) ? snapshot.annotations : []);
    this.started = true;
  }

  private async initializeLocalDocument(): Promise<void> {
    if (this.persistence) return;
    const initialTicket = await this.collaborationTicket();
    this.documentName = initialTicket.document_name;
    const storageKey = ["mango-editor-owner", this.options.userID || "anonymous", this.documentName].join(":");
    this.persistence = new IndexeddbPersistence(storageKey, this.document);
    this.document.on("update", this.handleDocumentUpdate);
    this.document.getMap("mango-metadata").observe(this.handleMetadataChange);
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("offline", this.handleOffline);
    try {
      await this.persistence.whenSynced;
      this.localDirty = Boolean(await this.persistence.get(RECOVERY_STATE_KEY));
      this.options.onPendingChange?.(this.localDirty ? 1 : 0);
      if (this.document.getXmlFragment("default").length > 0) {
        this.hydrated = true;
        this.publishMaterialized();
      }
    } catch (cause) {
      this.options.onError?.(cause);
      throw cause;
    }
  }

  async connectAndSync(): Promise<void> {
    if (this.stopped) throw new Error("This editor is closed.");
    if (!this.started) await this.start();
    if (this.synced) return;
    if (this.connectPromise) return this.connectPromise;
    const work = (async () => {
      await this.initializeLocalDocument();
      const url = configuredCollaborationURL(this.options.collaborationURL);
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const timeout = window.setTimeout(() => {
          if (settled || this.stopped) return;
          settled = true;
          reject(new Error("Timed out connecting to editor collaboration."));
        }, 20_000);
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          error ? reject(error) : resolve();
        };
        if (!this.provider) {
          this.provider = new HocuspocusProvider({
            url,
            name: this.documentName,
            document: this.document,
            token: async () => (await this.collaborationTicket()).token,
            onSynced: ({ state }) => {
              if (!state) return;
              this.synced = true;
              this.hydrated = true;
              finish();
              this.maybeMarkDurable();
            },
            onStatus: ({ status }) => {
              if (status === WebSocketStatus.Disconnected) {
                this.synced = false;
                if (!this.stopped && this.localDirty) this.options.onPendingChange?.(1);
              }
            },
            onAuthenticationFailed: ({ reason }) => finish(new Error(reason || "Editor collaboration authorization failed.")),
            onStateless: ({ payload }) => this.handleStateless(payload),
          });
        } else {
          this.provider.connect();
        }
      });
      this.publishMaterialized();
      this.options.onAnnotations?.(parseAnnotations(this.document));
      this.options.onRecoveryStorageRecovered?.();
      if (!this.localDirty) void this.drainMentionNotifications();
    })().catch((cause) => {
      this.options.onError?.(cause);
      throw cause;
    }).finally(() => {
      if (this.connectPromise === work) this.connectPromise = undefined;
    });
    this.connectPromise = work;
    return work;
  }

  private readonly handleDocumentUpdate = (_update: Uint8Array, origin: unknown, _document: Y.Doc, transaction: Y.Transaction) => {
    if (origin !== this.persistence && transaction.local) {
      this.localDirty = true;
      this.options.onPendingChange?.(1);
      this.recoveryPersistence = this.recoveryPersistence.then(() => this.persistence?.set(RECOVERY_STATE_KEY, 1)).catch((cause) => {
        this.options.onRecoveryStorageError?.(cause instanceof Error ? cause.message : "This edit could not be stored for offline recovery.");
      });
    }
    this.maybeMarkDurable();
  };

  private readonly handleMetadataChange = () => this.options.onAnnotations?.(parseAnnotations(this.document));
  setAnnotations(annotations: readonly MangoTiptapPersistedAnnotation[]): void {
    const metadata = this.document.getMap("mango-metadata");
    const next = JSON.stringify(annotations);
    if (metadata.get("annotations") !== next) metadata.set("annotations", next);
  }

  queueMentionNotifications(mentions: readonly MangoTiptapMentionDelta[]): void {
    const actorUserID = this.options.userID?.trim() ?? "";
    if (!actorUserID || mentions.length === 0) return;
    const operationID = randomID();
    const pending: PendingMentionNotification = { actor_user_id: actorUserID, mentions: [...mentions] };
    this.document.getMap("mango-mention-notifications").set(operationID, JSON.stringify(pending));
  }

  private drainMentionNotifications(): Promise<void> {
    if (this.mentionDrain) return this.mentionDrain;
    const work = (async () => {
      if (!navigator.onLine || !this.documentName) return;
      const queue = this.document.getMap("mango-mention-notifications");
      for (const [operationID, raw] of queue.entries()) {
        let pending: PendingMentionNotification;
        try { pending = JSON.parse(String(raw)) as PendingMentionNotification; } catch { continue; }
        if (pending.actor_user_id !== this.options.userID?.trim() || !Array.isArray(pending.mentions) || pending.mentions.length === 0) continue;
        const path = `/v1/editor-json/${encodeURIComponent(this.options.resourceType)}/${encodeURIComponent(this.options.resourceID)}/documents/${encodeURIComponent(this.options.documentID)}/mentions?company_id=${encodeURIComponent(this.options.companyID)}`;
        await this.options.requestJSON(path, { method: "POST", json: { operation_id: operationID, mentions: pending.mentions } });
        queue.delete(operationID);
      }
    })().catch((cause) => this.options.onError?.(cause)).finally(() => {
      if (this.mentionDrain === work) this.mentionDrain = undefined;
    });
    this.mentionDrain = work;
    return work;
  }

  materialize(): { document: MangoTiptapDocument; annotations: MangoTiptapPersistedAnnotation[] } {
    const candidate: MangoTiptapDocument = {
      format: MANGO_TIPTAP_FORMAT,
      schema_version: MANGO_TIPTAP_SCHEMA_VERSION,
      document: yDocToProsemirrorJSON(this.document, "default"),
    };
    const validation = validateMangoTiptapDocument(candidate);
    if (!validation.valid) throw new Error(`invalid_collaboration_document:${validation.error}`);
    return { document: validation.value, annotations: parseAnnotations(this.document) };
  }

  publishMaterialized(): void {
    if (!this.hydrated) return;
    const materialized = this.materialize();
    this.options.onDocument?.(materialized.document);
    this.options.onAnnotations?.(materialized.annotations);
  }

  private maybeMarkDurable(): void {
    if (!this.localDirty || !this.durableSnapshot || !Y.equalSnapshots(Y.snapshot(this.document), this.durableSnapshot)) return;
    this.localDirty = false;
    this.recoveryPersistence = this.recoveryPersistence.then(() => this.persistence?.del(RECOVERY_STATE_KEY)).catch(() => undefined);
    this.options.onPendingChange?.(0);
    for (const resolve of this.durableWaiters) resolve();
    this.durableWaiters.clear();
    void this.drainMentionNotifications();
  }

  private handleStateless(payload: string): void {
    let message: Record<string, unknown>;
    try { message = JSON.parse(payload) as Record<string, unknown>; } catch { return; }
    if (message.type === DURABILITY_ERROR_TYPE) {
      this.options.onError?.(new Error(message.code === "editor_owner_text_limit_exceeded" ? "This editor is over its text limit." : "The collaboration service could not commit this edit. It remains in this browser."));
      this.provider?.disconnect();
      return;
    }
    if (message.type !== DURABLE_ACK_TYPE || typeof message.durable_snapshot_base64 !== "string") return;
    try {
      this.durableSnapshot = Y.decodeSnapshot(base64ToBytes(message.durable_snapshot_base64));
      this.maybeMarkDurable();
    } catch (cause) { this.options.onError?.(cause); }
  }

  private readonly handleOnline = () => {
    if (!this.stopped && this.realtimeVisible) void this.connectAndSync().catch(() => undefined);
  };
  private readonly handleOffline = () => { if (this.localDirty) this.options.onPendingChange?.(1); };

  async flush(): Promise<void> {
    if (this.stopped || !this.localDirty || !navigator.onLine) return;
    await this.connectAndSync();
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => { this.durableWaiters.delete(done); reject(new Error("Timed out waiting for the durable collaboration acknowledgement.")); }, 15_000);
      const done = () => { window.clearTimeout(timeout); resolve(); };
      this.durableWaiters.add(done);
    });
  }

  setRealtimeVisible(visible: boolean): void {
    this.realtimeVisible = visible;
    if (visible) void this.connectAndSync().catch(() => undefined);
    else {
      this.synced = false;
      this.provider?.disconnect();
    }
  }

  async shutdown(): Promise<void> {
    if (this.stopped) return;
    try { await this.flush(); } catch (cause) { this.options.onError?.(cause); }
    this.publishMaterialized();
    this.stopped = true;
    window.removeEventListener("online", this.handleOnline);
    window.removeEventListener("offline", this.handleOffline);
    if (this.persistence) {
      this.document.off("update", this.handleDocumentUpdate);
      this.document.getMap("mango-metadata").unobserve(this.handleMetadataChange);
    }
    for (const resolve of this.durableWaiters) resolve();
    this.durableWaiters.clear();
    this.provider?.destroy();
    await this.recoveryPersistence;
    await this.persistence?.destroy();
    this.document.destroy();
  }
}
