import { buildLogicGateRoute, buildNodeRoute, buildProjectRoute } from "../../app/deepLinkRoutes.js";
import { createExplorerEntityIconElement } from "../company-explorer/CompanyExplorerEntityIcon.js";
import { createNodeFromSelectionTitle, normalizeSelectedTextForNodeTitle } from "../node-map/selectionNodeCreation.js";

export type EditorEntityType = "node" | "logic_gate" | "project";

export type EditorEntityLink = {
  entityType: EditorEntityType;
  entityID: string;
  label: string;
  updatedTimestamp?: string;
};

export type EditorEntityLinkRequest = <T>(path: string, init?: RequestInit & { json?: unknown }) => Promise<T>;

export type EditorEntityLinkContext = {
  companyID: string;
  requestJSON: EditorEntityLinkRequest;
  onOpen?: (entity: EditorEntityLink) => void;
};

export type ActiveEntityLinkDraft = {
  start: number;
  end: number;
  query: string;
  trigger: "#";
};

type CompanyExplorerEntitySearchResponse = {
  results?: Array<{
    resource_type?: string;
    resource_id?: string;
    display_name?: string;
    updated_timestamp?: string;
  }>;
};

export const EDITOR_ENTITY_LINK_ATTRIBUTE = "data-mango-entity-link";
export const EDITOR_ENTITY_TYPE_ATTRIBUTE = "data-mango-entity-type";
export const EDITOR_ENTITY_ID_ATTRIBUTE = "data-mango-entity-id";
export const EDITOR_ENTITY_LABEL_ATTRIBUTE = "data-mango-entity-label";

const ENTITY_DRAFT_BOUNDARY_PATTERN = /[A-Za-z0-9_#.-]/;
const ENTITY_TYPES = new Set<EditorEntityType>(["node", "logic_gate", "project"]);

export function isEditorEntityType(value: unknown): value is EditorEntityType {
  return typeof value === "string" && ENTITY_TYPES.has(value as EditorEntityType);
}

export function editorEntityTypeLabel(type: EditorEntityType): string {
  if (type === "logic_gate") return "Logic Gate";
  return type === "project" ? "Project" : "Node";
}

export function editorEntityRoute(entity: Pick<EditorEntityLink, "entityType" | "entityID">): string {
  if (entity.entityType === "logic_gate") return buildLogicGateRoute(entity.entityID);
  if (entity.entityType === "project") return buildProjectRoute(entity.entityID);
  return buildNodeRoute(entity.entityID);
}

export function openEditorEntityLink(entity: EditorEntityLink, context?: Pick<EditorEntityLinkContext, "onOpen">): void {
  if (context?.onOpen) {
    context.onOpen(entity);
    return;
  }
  if (typeof window !== "undefined") window.location.assign(editorEntityRoute(entity));
}

export function normalizeEditorSelectionNodeTitle(value: string): string {
  return normalizeSelectedTextForNodeTitle(value);
}

export function readActiveEntityLinkDraft(value: string, caretIndex: number | null): ActiveEntityLinkDraft | null {
  if (caretIndex === null || caretIndex < 0 || caretIndex > value.length) return null;
  const beforeCaret = value.slice(0, caretIndex);
  const start = beforeCaret.lastIndexOf("#");
  if (start < 0) return null;
  const prefix = start > 0 ? value[start - 1] : "";
  if (prefix && ENTITY_DRAFT_BOUNDARY_PATTERN.test(prefix)) return null;
  const query = beforeCaret.slice(start + 1);
  if (query.includes("\n") || query.includes("\r") || query.length > 120) return null;
  if (/[,;:()[\]{}]/.test(query)) return null;
  return { start, end: caretIndex, query, trigger: "#" };
}

export async function searchEditorEntityLinks(
  context: Pick<EditorEntityLinkContext, "companyID" | "requestJSON">,
  query: string,
  limit = 20,
): Promise<EditorEntityLink[]> {
  const params = new URLSearchParams({
    company_id: context.companyID.trim(),
    q: query.trim(),
    limit: String(Math.max(1, Math.min(50, Math.round(limit)))),
    resource_types: "node,logic_gate,project",
    ranking: "editor_entities",
  });
  const response = await context.requestJSON<CompanyExplorerEntitySearchResponse>(`/v1/company-explorer/search?${params.toString()}`);
  const seen = new Set<string>();
  return (response.results ?? []).flatMap((result) => {
    const entityType = result.resource_type;
    const entityID = result.resource_id?.trim() ?? "";
    const label = result.display_name?.trim() ?? "";
    if (!isEditorEntityType(entityType) || !entityID || !label) return [];
    const key = `${entityType}:${entityID}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ entityType, entityID, label, updatedTimestamp: result.updated_timestamp }];
  });
}

export async function createNodeEntityFromSelection(
  context: Pick<EditorEntityLinkContext, "companyID" | "requestJSON">,
  selectedText: string,
): Promise<EditorEntityLink> {
  const title = normalizeEditorSelectionNodeTitle(selectedText);
  if (!title) throw new Error("selection_node_title_empty");
  const node = await createNodeFromSelectionTitle({
    companyID: context.companyID,
    title,
    requestJSON: context.requestJSON,
  });
  return {
    entityType: "node",
    entityID: node.node_id,
    label: node.name?.trim() || title,
    updatedTimestamp: node.created_timestamp,
  };
}

export function applyEditorEntityLinkStyle(element: HTMLElement, entityType?: EditorEntityType): void {
  element.setAttribute(EDITOR_ENTITY_LINK_ATTRIBUTE, "true");
  element.setAttribute("contenteditable", "false");
  element.setAttribute("role", "link");
  element.setAttribute("tabindex", "0");
  element.classList.add("mango-editor-entity-link");
  if (entityType) element.classList.add(`mango-editor-entity-link--${entityType}`);
}

export function createEditorEntityIconElement(ownerDocument: Document, entityType: EditorEntityType): SVGSVGElement {
  const icon = createExplorerEntityIconElement(ownerDocument, entityType);
  icon.classList.add("mango-editor-entity-icon", `mango-editor-entity-icon--${entityType}`);
  return icon;
}

export function createEditorEntityLinkElement(ownerDocument: Document, entity: EditorEntityLink): HTMLSpanElement {
  const element = ownerDocument.createElement("span");
  applyEditorEntityLinkStyle(element, entity.entityType);
  element.setAttribute(EDITOR_ENTITY_TYPE_ATTRIBUTE, entity.entityType);
  element.setAttribute(EDITOR_ENTITY_ID_ATTRIBUTE, entity.entityID.trim());
  element.setAttribute(EDITOR_ENTITY_LABEL_ATTRIBUTE, entity.label.trim());
  element.setAttribute("aria-label", `Open ${editorEntityTypeLabel(entity.entityType)} ${entity.label.trim()}`);
  element.setAttribute("title", `Open ${editorEntityTypeLabel(entity.entityType)}: ${entity.label.trim()}`);
  const label = ownerDocument.createElement("span");
  label.className = "mango-editor-entity-label";
  label.textContent = entity.label.trim();
  element.append(createEditorEntityIconElement(ownerDocument, entity.entityType), label);
  return element;
}

export function readEditorEntityLinkElement(element: Element | null): EditorEntityLink | null {
  if (!(element instanceof HTMLElement) || element.getAttribute(EDITOR_ENTITY_LINK_ATTRIBUTE) !== "true") return null;
  const entityType = element.getAttribute(EDITOR_ENTITY_TYPE_ATTRIBUTE);
  const entityID = element.getAttribute(EDITOR_ENTITY_ID_ATTRIBUTE)?.trim() ?? "";
  const label = element.getAttribute(EDITOR_ENTITY_LABEL_ATTRIBUTE)?.trim() || element.textContent?.trim() || "";
  return isEditorEntityType(entityType) && entityID && label ? { entityType, entityID, label } : null;
}
