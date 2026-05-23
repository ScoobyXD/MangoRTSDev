import { requestJSON } from "../api/requestJSON";

export const EDITOR_COLLABORATION_WORKSPACE_EVENT = "editor_collaboration_event";
export const EDITOR_COLLABORATION_MAX_DOCUMENT_HTML_BYTES = 850_000;

const EDITOR_COLLABORATION_CLIENT_ID_KEY = "mango-editor-collaboration-client-id-v1";

export type EditorCollaborationEventType = "presence" | "document_update" | "leave";
export type EditorCollaborationEntityKind = "node" | "logic_gate";

export type EditorCollaborationTarget = {
  entityKind: EditorCollaborationEntityKind;
  entityID: string;
};

export type EditorCollaborationEventPayload = EditorCollaborationTarget & {
  eventType: EditorCollaborationEventType;
  informationID?: string;
  clientID: string;
  clientName?: string;
  documentHTML?: string;
  revision: number;
};

type WorkspaceEventEnvelope = {
  company_id?: unknown;
  type?: unknown;
  data?: unknown;
};

export function createEditorCollaborationClientID(): string {
  if (typeof sessionStorage !== "undefined") {
    const existing = sessionStorage.getItem(EDITOR_COLLABORATION_CLIENT_ID_KEY);
    if (existing) return existing;
  }
  const generated = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `editor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(EDITOR_COLLABORATION_CLIENT_ID_KEY, generated);
  }
  return generated;
}

export function sameEditorCollaborationTarget(a: EditorCollaborationTarget, b: EditorCollaborationTarget): boolean {
  return a.entityKind === b.entityKind && a.entityID === b.entityID;
}

export function editorCollaborationLabel(clientID: string, clientName?: string): string {
  const name = clientName?.trim();
  if (name) return name;
  const suffix = clientID.trim().slice(0, 4).toUpperCase();
  return suffix ? `Editor ${suffix}` : "Editor";
}

export function editorCollaboratorColor(clientID: string): string {
  void clientID;
  return `#475569`;
}

export async function publishEditorCollaborationEvent(
  apiBase: string,
  companyID: string,
  payload: EditorCollaborationEventPayload,
): Promise<void> {
  await requestJSON<{ status: string; revision: number }>(apiBase, "/v1/editor/collaboration/events", {
    method: "POST",
    timeoutMs: 5_000,
    json: {
      company_id: companyID,
      event_type: payload.eventType,
      entity_kind: payload.entityKind,
      entity_id: payload.entityID,
      information_id: payload.informationID ?? "",
      client_id: payload.clientID,
      client_name: payload.clientName ?? "",
      document_html: payload.documentHTML ?? "",
      revision: payload.revision,
    },
  });
}

export function canPublishEditorCollaborationDocumentHTML(documentHTML: string): boolean {
  if (!documentHTML) return true;
  const documentBytes = typeof TextEncoder !== "undefined"
    ? new TextEncoder().encode(documentHTML).length
    : documentHTML.length;
  return documentBytes <= EDITOR_COLLABORATION_MAX_DOCUMENT_HTML_BYTES;
}

export function parseEditorCollaborationWorkspaceEvent(rawData: string): EditorCollaborationEventPayload | null {
  if (!rawData.trim()) return null;
  let envelope: WorkspaceEventEnvelope;
  try {
    envelope = JSON.parse(rawData) as WorkspaceEventEnvelope;
  } catch {
    return null;
  }
  if (envelope.type !== EDITOR_COLLABORATION_WORKSPACE_EVENT || !isRecord(envelope.data)) return null;
  const data = envelope.data;
  const eventType = stringValue(data.event_type);
  const entityKind = stringValue(data.entity_kind);
  const entityID = stringValue(data.entity_id);
  const clientID = stringValue(data.client_id);
  const revision = numberValue(data.revision);
  if (!isEditorCollaborationEventType(eventType) || !isEditorCollaborationEntityKind(entityKind) || !entityID || !clientID) {
    return null;
  }
  return {
    eventType,
    entityKind,
    entityID,
    informationID: stringValue(data.information_id),
    clientID,
    clientName: stringValue(data.client_name),
    documentHTML: stringValue(data.document_html),
    revision: revision > 0 ? revision : Date.now(),
  };
}

function isEditorCollaborationEventType(value: string): value is EditorCollaborationEventType {
  return value === "presence" || value === "document_update" || value === "leave";
}

function isEditorCollaborationEntityKind(value: string): value is EditorCollaborationEntityKind {
  return value === "node" || value === "logic_gate";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
