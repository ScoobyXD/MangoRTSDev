import {
  EditorCollaborationController,
  type EditorCollaborationRequest,
} from "../modules/editor/editorCollaboration.js";
import {
  MangoRealtimeClient,
  type RealtimeSubscriptionHandlers,
} from "../modules/realtime/realtimeWebSocket.js";

declare global {
  interface Window {
    __mangoE2E?: {
      flush: () => Promise<void>;
      setHTML: (html: string, immediate?: boolean) => void;
      getState: () => { html: string; status: string; health: string; errors: string[]; maxAckConcurrentOperations: number };
      stop: () => void;
      reconnect: () => void;
      dropNextAck: () => void;
      delayNextAck: (milliseconds: number) => void;
      dropNextBroadcast: () => void;
      duplicateNextBroadcast: () => void;
      delayNextBroadcast: (milliseconds: number) => void;
      addProbe: (scope: string) => number;
      removeProbe: (id: number) => void;
    };
  }
}

const params = new URLSearchParams(window.location.search);
const apiBase = params.get("api") ?? "http://127.0.0.1:18080";
const companyID = params.get("company") ?? "";
const subject = params.get("subject") ?? "";
const resourceType = (params.get("resource_type") ?? "node") as "node" | "logic_gate" | "project";
const resourceID = params.get("resource") ?? "";
const documentID = params.get("document") ?? "";
const editor = document.querySelector<HTMLDivElement>("#editor")!;
const status = document.querySelector<HTMLDivElement>("#status")!;
const health = document.querySelector<HTMLDivElement>("#health")!;
const errorsElement = document.querySelector<HTMLDivElement>("#errors")!;
const errors: string[] = [];
let shouldDropNextAck = false;
let nextAckDelayMs = 0;
let shouldDropNextBroadcast = false;
let shouldDuplicateNextBroadcast = false;
let nextBroadcastDelayMs = 0;
let maxAckConcurrentOperations = 0;

async function authenticatedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("X-Mango-Test-Subject", subject);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(new URL(path, apiBase), { ...init, headers, credentials: "include" });
}

const requestJSON: EditorCollaborationRequest = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await authenticatedFetch(path, init);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error ?? `request_failed_${response.status}`);
  }
  const payload = await response.json() as T;
  if (init.method === "POST" && path.includes("/v1/editor-collaboration/")) {
    const concurrent = (payload as { concurrent_operations?: unknown[] }).concurrent_operations;
    maxAckConcurrentOperations = Math.max(maxAckConcurrentOperations, Array.isArray(concurrent) ? concurrent.length : 0);
    if (nextAckDelayMs > 0) {
      const delay = nextAckDelayMs;
      nextAckDelayMs = 0;
      await new Promise((resolve) => window.setTimeout(resolve, delay));
    }
    if (shouldDropNextAck) {
      shouldDropNextAck = false;
      throw new Error("simulated_lost_acknowledgement");
    }
  }
  return payload;
};

const realtime = new MangoRealtimeClient(apiBase, companyID, {
  getTicket: async () => {
    const response = await authenticatedFetch("/v1/realtime/ticket", {
      method: "POST",
      body: JSON.stringify({ company_id: companyID }),
    });
    if (!response.ok) throw new Error("realtime_ticket_failed");
  },
  reconnectDelayMs: 50,
  attemptingAfterMs: 100,
  disconnectedAfterMs: 500,
});

const probeSubscriptions = new Map<number, () => void>();
let nextProbeID = 1;
let applyingRemote = false;
const controller = new EditorCollaborationController({
  apiBase,
  companyID,
  currentUserID: subject,
  resourceType,
  resourceID,
  documentID,
  initialHTML: "",
  requestJSON,
  onHTML: (html) => {
    applyingRemote = true;
    editor.innerHTML = html;
    applyingRemote = false;
  },
  onPendingChange: (count) => {
    status.textContent = count > 0 ? `Saving (${count})` : "Saved";
    status.dataset.pending = String(count);
  },
  onDeleted: () => {
    status.textContent = "Deleted";
  },
  onError: (cause) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    errors.push(message);
    errorsElement.textContent = message;
  },
  microBatchMs: 25,
  subscribe: (_api, _company, scope, handlers: RealtimeSubscriptionHandlers) => realtime.subscribe(scope, {
    ...handlers,
    onEditorDeltaCommitted: (message) => {
      if (shouldDropNextBroadcast) {
        shouldDropNextBroadcast = false;
        return;
      }
      const deliver = () => {
        handlers.onEditorDeltaCommitted?.(message);
        if (shouldDuplicateNextBroadcast) {
          shouldDuplicateNextBroadcast = false;
          handlers.onEditorDeltaCommitted?.(message);
        }
      };
      if (nextBroadcastDelayMs > 0) {
        const delay = nextBroadcastDelayMs;
        nextBroadcastDelayMs = 0;
        window.setTimeout(deliver, delay);
      } else {
        deliver();
      }
    },
    onAccepted: (message) => {
      health.textContent = "Connected";
      health.dataset.health = "connected";
      handlers.onAccepted?.(message);
    },
    onRejected: (message) => {
      health.textContent = "Rejected";
      health.dataset.health = "rejected";
      handlers.onRejected?.(message);
    },
  }),
});

editor.addEventListener("input", () => {
  if (!applyingRemote) controller.schedule(editor.innerHTML);
});

controller.start();
window.__mangoE2E = {
  flush: () => controller.flush(),
  setHTML: (html, immediate = false) => {
    editor.innerHTML = html;
    controller.schedule(html, immediate);
  },
  getState: () => ({
    html: editor.innerHTML,
    status: status.textContent ?? "",
    health: health.dataset.health ?? "",
    errors: [...errors],
    maxAckConcurrentOperations,
  }),
  stop: () => { controller.stop(); },
  reconnect: () => {
    realtime.close();
    realtime.ensureOpen();
  },
  dropNextAck: () => { shouldDropNextAck = true; },
  delayNextAck: (milliseconds) => { nextAckDelayMs = Math.max(0, milliseconds); },
  dropNextBroadcast: () => { shouldDropNextBroadcast = true; },
  duplicateNextBroadcast: () => { shouldDuplicateNextBroadcast = true; },
  delayNextBroadcast: (milliseconds) => { nextBroadcastDelayMs = Math.max(0, milliseconds); },
  addProbe: (scope) => {
    const id = nextProbeID++;
    probeSubscriptions.set(id, realtime.subscribe(scope, {}));
    return id;
  },
  removeProbe: (id) => {
    probeSubscriptions.get(id)?.();
    probeSubscriptions.delete(id);
  },
};
