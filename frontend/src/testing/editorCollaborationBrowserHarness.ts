import {
  EditorCollaborationController,
  applyEditorCollaborationDelta,
  materializeEditorCollaborationState,
  newEditorCollaborationState,
  type EditorCollaborationResourceType,
  type EditorCollaborationSnapshot,
  type EditorCollaborationState,
} from "../modules/editor/editorCollaboration.js";
import {
  MangoRealtimeClient,
  realtimeEditorScope,
  type RealtimeEditorDelta,
} from "../modules/realtime/realtimeWebSocket.js";

type DocumentRef = {
  resourceType: EditorCollaborationResourceType;
  resourceID: string;
  documentID: string;
};

type StoredOperation = {
  eventID: string;
  revision: number;
};

type StoredEvent = {
  type: "editor.delta.committed";
  company_id: string;
  scope: string;
  event_id: string;
  resource_type: EditorCollaborationResourceType;
  resource_id: string;
  document_id: string;
  resource_revision: number;
  operation_id: string;
  client_id: string;
  delta: RealtimeEditorDelta;
};

type StoredDocument = {
  revision: number;
  state: EditorCollaborationState;
  operations: Record<string, StoredOperation>;
  events: StoredEvent[];
};

type DeliveryMode = "ack_before_broadcast" | "broadcast_before_ack" | "duplicate" | "no_broadcast" | "lost_ack_after_commit";

type MountedEditor = {
  ref: DocumentRef;
  controller: EditorCollaborationController;
  element: HTMLDivElement;
  pending: number;
  renders: number;
  errors: string[];
};

const params = new URLSearchParams(window.location.search);
const companyID = params.get("company") || "browser-company-a";
const currentUserID = params.get("user") || "browser-user-a";
const storagePrefix = "mango-editor-browser-harness:";
const channelName = "mango-editor-browser-harness-v1";
const pageEvents: Array<Record<string, unknown>> = [];
const mounts = new Map<string, MountedEditor>();
let deliveryMode: DeliveryMode = "ack_before_broadcast";

function documentKey(ref: DocumentRef): string {
  return storagePrefix + "document:" + [companyID, ref.resourceType, ref.resourceID, ref.documentID].map(encodeURIComponent).join(":");
}

function permissionKey(userID: string, scope: string): string {
  return storagePrefix + "permission:" + [companyID, userID, scope].map(encodeURIComponent).join(":");
}

function loadDocument(ref: DocumentRef): StoredDocument {
  const raw = localStorage.getItem(documentKey(ref));
  if (raw) return JSON.parse(raw) as StoredDocument;
  return { revision: 0, state: newEditorCollaborationState(""), operations: {}, events: [] };
}

function saveDocument(ref: DocumentRef, document: StoredDocument): void {
  localStorage.setItem(documentKey(ref), JSON.stringify(document));
}

function snapshot(document: StoredDocument): EditorCollaborationSnapshot {
  return {
    revision: document.revision,
    snapshot_revision: document.revision,
    state: document.state,
    html: materializeEditorCollaborationState(document.state),
    etag: '"browser-harness-' + document.revision + '"',
  };
}

function allowed(userID: string, scope: string): boolean {
  return localStorage.getItem(permissionKey(userID, scope)) !== "denied";
}

function record(kind: string, values: Record<string, unknown> = {}): void {
  pageEvents.push({ kind, at: Date.now(), ...values });
  const output = document.querySelector<HTMLElement>("#harness-events");
  if (output) output.textContent = JSON.stringify(pageEvents, null, 2);
}

const transportChannel = new BroadcastChannel(channelName);

class HarnessWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = HarnessWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  private readonly scopes = new Set<string>();
  private readonly channel = new BroadcastChannel(channelName);

  constructor(_url: string) {
    this.channel.onmessage = (event) => {
      const message = event.data as StoredEvent;
      if (this.readyState !== HarnessWebSocket.OPEN || message.company_id !== companyID || !this.scopes.has(message.scope)) return;
      if (!allowed(currentUserID, message.scope)) {
        record("delivery-blocked", { scope: message.scope, userID: currentUserID, operationID: message.operation_id });
        return;
      }
      record("delivery", { scope: message.scope, userID: currentUserID, operationID: message.operation_id, revision: message.resource_revision });
      this.emit(message);
    };
    window.setTimeout(() => {
      if (this.readyState !== HarnessWebSocket.CONNECTING) return;
      this.readyState = HarnessWebSocket.OPEN;
      record("socket-open", { userID: currentUserID });
      this.onopen?.(new Event("open"));
      this.emit({ type: "ready", user_id: currentUserID, connection_id: "browser-harness" });
      this.emit({ type: "heartbeat.confirmed", nonce: "browser-harness", server_time: new Date().toISOString() });
    }, 0);
  }

  send(raw: string): void {
    const message = JSON.parse(raw) as { type?: string; scope?: string; nonce?: string };
    if (message.type === "subscribe" && message.scope) {
      this.scopes.add(message.scope);
      record("subscribe", { scope: message.scope, userID: currentUserID });
      if (allowed(currentUserID, message.scope)) this.emit({ type: "subscription.accepted", scope: message.scope });
      else this.emit({ type: "subscription.rejected", scope: message.scope, error: "resource_not_found" });
      return;
    }
    if (message.type === "unsubscribe" && message.scope) {
      this.scopes.delete(message.scope);
      record("unsubscribe", { scope: message.scope, userID: currentUserID });
      return;
    }
    if (message.type === "heartbeat.response") {
      this.emit({ type: "heartbeat.confirmed", nonce: message.nonce || "browser-harness" });
    }
  }

  close(): void {
    if (this.readyState === HarnessWebSocket.CLOSED) return;
    this.readyState = HarnessWebSocket.CLOSED;
    this.channel.close();
    record("socket-close", { userID: currentUserID });
    this.onclose?.(new CloseEvent("close"));
  }

  private emit(message: unknown): void {
    window.setTimeout(() => this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(message) })), 0);
  }
}

function createRealtimeClient(): MangoRealtimeClient {
  return new MangoRealtimeClient("http://browser-harness.invalid", companyID, {
    getTicket: async () => undefined,
    getAccessToken: async () => "browser-harness-token",
    WebSocketCtor: HarnessWebSocket as unknown as typeof WebSocket,
    reconnectDelayMs: 20,
    heartbeatGraceMs: 60_000,
    attemptingAfterMs: 100,
    disconnectedAfterMs: 500,
  });
}

let realtimeClient = createRealtimeClient();

function requestFor(ref: DocumentRef) {
  return async <T,>(_path: string, init?: RequestInit): Promise<T> => {
    const document = loadDocument(ref);
    if (!init?.method || init.method === "GET") return snapshot(document) as T;
    const input = JSON.parse(String(init.body)) as {
      operation_id: string;
      client_id: string;
      delta: RealtimeEditorDelta;
    };
    const existing = document.operations[input.operation_id];
    if (existing) {
      record("deduplicated", { operationID: input.operation_id, revision: existing.revision });
      return {
        operation_id: input.operation_id,
        revision: existing.revision,
        deduplicated: true,
        snapshot: snapshot(document),
      } as T;
    }

    document.state = applyEditorCollaborationDelta(document.state, input.delta);
    document.revision += 1;
    const event: StoredEvent = {
      type: "editor.delta.committed",
      company_id: companyID,
      scope: realtimeEditorScope(ref.resourceType, ref.resourceID, ref.documentID),
      event_id: crypto.randomUUID(),
      resource_type: ref.resourceType,
      resource_id: ref.resourceID,
      document_id: ref.documentID,
      resource_revision: document.revision,
      operation_id: input.operation_id,
      client_id: input.client_id,
      delta: input.delta,
    };
    document.operations[input.operation_id] = { eventID: event.event_id, revision: document.revision };
    document.events.push(event);
    saveDocument(ref, document);
    record("commit", { operationID: input.operation_id, revision: document.revision, mode: deliveryMode });

    const mode = deliveryMode;
    deliveryMode = "ack_before_broadcast";
    if (mode === "broadcast_before_ack") {
      transportChannel.postMessage(event);
      await new Promise((resolve) => window.setTimeout(resolve, 30));
    } else if (mode === "ack_before_broadcast") {
      window.setTimeout(() => transportChannel.postMessage(event), 30);
    } else if (mode === "duplicate") {
      window.setTimeout(() => {
        transportChannel.postMessage(event);
        transportChannel.postMessage(event);
      }, 10);
    } else if (mode === "lost_ack_after_commit") {
      throw new Error("acknowledgement_lost_after_commit");
    }

    return {
      operation_id: input.operation_id,
      revision: document.revision,
      snapshot: snapshot(document),
    } as T;
  };
}

function editorHost(id: string): HTMLDivElement {
  const element = document.createElement("div");
  element.contentEditable = "true";
  element.dataset.editorId = id;
  element.setAttribute("role", "textbox");
  element.setAttribute("aria-label", "Collaboration editor " + id);
  document.querySelector("#editors")?.append(element);
  return element;
}

async function mount(id: string, ref: DocumentRef): Promise<void> {
  if (mounts.has(id)) throw new Error("duplicate_editor_id");
  const initial = snapshot(loadDocument(ref));
  const element = editorHost(id);
  element.innerHTML = initial.html;
  const mounted: MountedEditor = {
    ref,
    element,
    pending: 0,
    renders: 0,
    errors: [],
    controller: undefined as unknown as EditorCollaborationController,
  };
  const subscribe = (_apiBase: string, _company: string, scope: string, handlers: Parameters<MangoRealtimeClient["subscribe"]>[1]) =>
    realtimeClient.subscribe(scope, handlers);
  mounted.controller = new EditorCollaborationController({
    apiBase: "http://browser-harness.invalid",
    companyID,
    currentUserID,
    resourceType: ref.resourceType,
    resourceID: ref.resourceID,
    documentID: ref.documentID,
    initialHTML: initial.html,
    requestJSON: requestFor(ref),
    subscribe,
    microBatchMs: 1,
    onHTML: (html, source) => {
      mounted.renders += 1;
      mounted.element.innerHTML = html;
      mounted.element.dataset.lastSource = source;
      mounted.element.dataset.renderCount = String(mounted.renders);
      record("visible-render", { id, source, htmlLength: html.length });
    },
    onPendingChange: (count) => {
      mounted.pending = count;
      mounted.element.dataset.pending = String(count);
    },
    onError: (cause) => {
      mounted.errors.push(cause instanceof Error ? cause.message : String(cause));
      mounted.element.dataset.error = mounted.errors[mounted.errors.length - 1] || "";
    },
  });
  mounts.set(id, mounted);
  mounted.controller.start();
  await mounted.controller.recover();
  await new Promise((resolve) => window.setTimeout(resolve, 20));
}

async function edit(id: string, html: string, mode: DeliveryMode = "ack_before_broadcast"): Promise<{ error?: string }> {
  const mounted = mounts.get(id);
  if (!mounted) throw new Error("editor_not_mounted");
  deliveryMode = mode;
  mounted.element.innerHTML = html;
  mounted.controller.schedule(html, true);
  try {
    await mounted.controller.flush();
    await new Promise((resolve) => window.setTimeout(resolve, 60));
    return {};
  } catch (cause) {
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    return { error: cause instanceof Error ? cause.message : String(cause) };
  }
}

function dispose(id: string): void {
  const mounted = mounts.get(id);
  if (!mounted) return;
  mounted.controller.stop();
  mounted.element.remove();
  mounts.delete(id);
}

async function reconnect(): Promise<void> {
  realtimeClient.close();
  realtimeClient.ensureOpen();
  await new Promise((resolve) => window.setTimeout(resolve, 100));
}

function setPermission(userID: string, ref: DocumentRef, value: "edit" | "no_access"): void {
  const scope = realtimeEditorScope(ref.resourceType, ref.resourceID, ref.documentID);
  localStorage.setItem(permissionKey(userID, scope), value === "edit" ? "edit" : "denied");
  record("permission", { userID, scope, value });
}

function broadcastStored(ref: DocumentRef, eventIndex = -1): void {
  const events = loadDocument(ref).events;
  const event = eventIndex < 0 ? events[events.length - 1] : events[eventIndex];
  if (event) transportChannel.postMessage(event);
}

function emitRevisionGap(ref: DocumentRef): void {
  const document = loadDocument(ref);
  transportChannel.postMessage({
    type: "editor.snapshot.required",
    company_id: companyID,
    scope: realtimeEditorScope(ref.resourceType, ref.resourceID, ref.documentID),
    event_id: crypto.randomUUID(),
    resource_type: ref.resourceType,
    resource_id: ref.resourceID,
    document_id: ref.documentID,
    resource_revision: document.revision + 2,
    operation_id: "browser-gap",
    client_id: "browser-gap",
    reason: "revision_gap",
  });
}

function state() {
  return {
    companyID,
    currentUserID,
    editors: Object.fromEntries([...mounts].map(([id, mounted]) => [id, {
      html: mounted.element.innerHTML,
      pending: mounted.pending,
      renders: mounted.renders,
      errors: [...mounted.errors],
      source: mounted.element.dataset.lastSource || "",
    }])),
    events: [...pageEvents],
  };
}

function reset(): void {
  for (const id of [...mounts.keys()]) dispose(id);
  realtimeClient.close();
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(storagePrefix) || key?.startsWith("mango-editor-collaboration-pending-v1:") || key?.startsWith("mango-editor-collaboration-client-v1:")) {
      localStorage.removeItem(key);
    }
  }
  pageEvents.splice(0, pageEvents.length);
  realtimeClient = createRealtimeClient();
  record("reset");
}

function field<T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id: string): T {
  return document.querySelector<T>("#" + id)!;
}

function selectedRef(): DocumentRef {
  return {
    resourceType: field<HTMLSelectElement>("resource-type").value as EditorCollaborationResourceType,
    resourceID: field<HTMLInputElement>("resource-id").value,
    documentID: field<HTMLInputElement>("document-id").value,
  };
}

function setStatus(value: unknown): void {
  document.querySelector<HTMLOutputElement>("#harness-status")!.value = typeof value === "string" ? value : JSON.stringify(value);
}

document.querySelector<HTMLFormElement>("#mount-form")!.addEventListener("submit", (event) => {
  event.preventDefault();
  void mount(field<HTMLInputElement>("mount-id").value, selectedRef())
    .then(() => setStatus("mounted"))
    .catch((cause) => setStatus({ error: cause instanceof Error ? cause.message : String(cause) }));
});

document.querySelector<HTMLFormElement>("#edit-form")!.addEventListener("submit", (event) => {
  event.preventDefault();
  void edit(
    field<HTMLInputElement>("edit-id").value,
    field<HTMLTextAreaElement>("edit-html").value,
    field<HTMLSelectElement>("edit-mode").value as DeliveryMode,
  ).then(setStatus).catch((cause) => setStatus({ error: cause instanceof Error ? cause.message : String(cause) }));
});

document.querySelector<HTMLButtonElement>("#permission-button")!.addEventListener("click", () => {
  setPermission(
    field<HTMLInputElement>("permission-user").value,
    selectedRef(),
    field<HTMLSelectElement>("permission-value").value as "edit" | "no_access",
  );
  setStatus("permission-set");
});
document.querySelector<HTMLButtonElement>("#dispose-button")!.addEventListener("click", () => {
  dispose(field<HTMLInputElement>("edit-id").value);
  setStatus("disposed");
});
document.querySelector<HTMLButtonElement>("#broadcast-button")!.addEventListener("click", () => {
  broadcastStored(selectedRef(), Number(field<HTMLInputElement>("event-index").value));
  setStatus("broadcasted");
});
document.querySelector<HTMLButtonElement>("#gap-button")!.addEventListener("click", () => {
  emitRevisionGap(selectedRef());
  setStatus("gap-emitted");
});
document.querySelector<HTMLButtonElement>("#reconnect-button")!.addEventListener("click", () => {
  void reconnect().then(() => setStatus("reconnected"));
});
document.querySelector<HTMLButtonElement>("#reset-button")!.addEventListener("click", () => {
  reset();
  setStatus("reset");
});

(window as unknown as { collaborationHarness: unknown }).collaborationHarness = {
  companyID,
  currentUserID,
  mount,
  edit,
  dispose,
  reconnect,
  setPermission,
  broadcastStored,
  emitRevisionGap,
  state,
  reset,
};

document.querySelector("#identity")!.textContent = companyID + " / " + currentUserID;
document.documentElement.dataset.harnessReady = "true";
record("ready", { companyID, currentUserID });
