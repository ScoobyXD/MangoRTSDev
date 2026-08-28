import { buildLogicGateRoute, buildNodeRoute, buildProjectRoute, parseDeepLinkRoute } from "../../app/deepLinkRoutes.js";
import { createExplorerEntityIconElement } from "../../icons/index.js";
import type { BoundRequestJSON } from "../api/requestJSON.js";
import type { EmailMessage } from "../communications/communicationsApi.js";
import { searchEntities } from "../entities/entitiesApi.js";
import { createNodeFromSelectionTitle, normalizeSelectedTextForNodeTitle } from "../nodes/selectionNodeCreation.js";

export type EditorWorkspaceEntityType = "node" | "logic_gate" | "project";
export type EditorSearchableEntityType = EditorWorkspaceEntityType | "entity";
export type EditorEntityType = EditorSearchableEntityType | "email_message";

export type EditorEntityLink = {
  entityType: EditorEntityType;
  entityID: string;
  label: string;
  updatedTimestamp?: string;
  emailMessageID?: string;
  emailThreadID?: string;
  emailAccountEmail?: string;
  emailSharedInboxID?: string;
  emailMessage?: EmailMessage;
};

export type EditorEntityLinkRequest = BoundRequestJSON;

export type EditorEntityLinkContext = {
  companyID: string;
  requestJSON: EditorEntityLinkRequest;
  onOpen?: (entity: EditorEntityLink) => void;
  includeEntityReferences?: boolean;
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
export const EDITOR_ENTITY_NAVIGATION_STATE_KEY = "mangoInlineEditorEntityNavigation";
export const EVENT_EDITOR_EMAIL_REFERENCE_OPEN = "mangorts:editor-email-reference-open";
export const EVENT_EDITOR_ENTITY_REFERENCE_OPEN = "mangorts:editor-entity-reference-open";

const ENTITY_DRAFT_BOUNDARY_PATTERN = /[A-Za-z0-9_#.-]/;
const ENTITY_TYPES = new Set<EditorEntityType>(["node", "logic_gate", "project", "entity", "email_message"]);
const WORKSPACE_ENTITY_TYPES = new Set<EditorWorkspaceEntityType>(["node", "logic_gate", "project"]);

export function isEditorEntityType(value: unknown): value is EditorEntityType {
  return typeof value === "string" && ENTITY_TYPES.has(value as EditorEntityType);
}

export function editorEntityTypeLabel(type: EditorEntityType): string {
  if (type === "email_message") return "Email";
  if (type === "logic_gate") return "Process";
  if (type === "project") return "Project";
  return type === "entity" ? "Entity" : "Node";
}

export function editorEntityRoute(entity: Pick<EditorEntityLink, "entityType" | "entityID">): string {
  if (entity.entityType === "email_message") throw new Error("Email references open through their exact mailbox scope, not an app route.");
  if (entity.entityType === "entity") throw new Error("Entity references open in their detail preview, not an app route.");
  if (entity.entityType === "logic_gate") return buildLogicGateRoute(entity.entityID);
  if (entity.entityType === "project") return buildProjectRoute(entity.entityID);
  return buildNodeRoute(entity.entityID);
}

type EditorEntityNavigationState = {
  kind: "node_from_node";
  sourcePath: string;
  targetNodeID: string;
};

export function readEditorEntitySourceNodePath(targetNodeID: string, state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const navigation = (state as Record<string, unknown>)[EDITOR_ENTITY_NAVIGATION_STATE_KEY];
  if (!navigation || typeof navigation !== "object") return null;
  const value = navigation as Partial<EditorEntityNavigationState>;
  if (value.kind !== "node_from_node" || value.targetNodeID !== targetNodeID.trim() || typeof value.sourcePath !== "string") return null;
  const sourceRoute = parseDeepLinkRoute(value.sourcePath);
  return sourceRoute?.kind === "node" && sourceRoute.nodeID !== value.targetNodeID ? value.sourcePath : null;
}

export function returnToEditorEntitySourceNode(targetNodeID: string): boolean {
  if (typeof window === "undefined" || !readEditorEntitySourceNodePath(targetNodeID, window.history.state)) return false;
  window.history.back();
  return true;
}

export function openEditorEntityLink(entity: EditorEntityLink, context?: Pick<EditorEntityLinkContext, "onOpen">): void {
  if (context?.onOpen) {
    context.onOpen(entity);
    return;
  }
  if (typeof window === "undefined") return;
  if (entity.entityType === "email_message") {
    window.dispatchEvent(new window.CustomEvent<EditorEntityLink>(EVENT_EDITOR_EMAIL_REFERENCE_OPEN, { detail: entity }));
    return;
  }
  if (entity.entityType === "entity") {
    window.dispatchEvent(new window.CustomEvent<EditorEntityLink>(EVENT_EDITOR_ENTITY_REFERENCE_OPEN, { detail: entity }));
    return;
  }
  const targetPath = editorEntityRoute(entity);
  if (window.location.pathname === targetPath) return;
  const sourceRoute = parseDeepLinkRoute(window.location.pathname);
  const navigationState: Record<string, unknown> = {};
  if (sourceRoute?.kind === "node" && entity.entityType === "node" && sourceRoute.nodeID !== entity.entityID.trim()) {
    navigationState[EDITOR_ENTITY_NAVIGATION_STATE_KEY] = {
      kind: "node_from_node",
      sourcePath: window.location.pathname,
      targetNodeID: entity.entityID.trim(),
    } satisfies EditorEntityNavigationState;
  }
  window.history.pushState(navigationState, "", targetPath);
  const popStateEvent = typeof window.PopStateEvent === "function"
    ? new window.PopStateEvent("popstate", { state: navigationState })
    : new window.Event("popstate");
  window.dispatchEvent(popStateEvent);
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
  entityTypes: readonly EditorSearchableEntityType[] = ["node", "logic_gate", "project"],
  signal?: AbortSignal,
): Promise<EditorEntityLink[]> {
  const requestedTypes = entityTypes.filter((type, index) => entityTypes.indexOf(type) === index);
  const requestedTypeSet = new Set(requestedTypes);
  if (requestedTypes.length === 0) return [];
  const boundedLimit = Math.max(1, Math.min(50, Math.round(limit)));
  const workspaceTypes = requestedTypes.filter((type): type is EditorWorkspaceEntityType => WORKSPACE_ENTITY_TYPES.has(type as EditorWorkspaceEntityType));
  const params = new URLSearchParams({
    company_id: context.companyID.trim(),
    q: query.trim(),
    limit: String(boundedLimit),
    resource_types: workspaceTypes.join(","),
    ranking: "editor_entities",
  });
  const [response, entities] = await Promise.all([
    workspaceTypes.length > 0
      ? context.requestJSON<CompanyExplorerEntitySearchResponse>(`/v1/company-explorer/search?${params.toString()}`, { signal })
      : Promise.resolve({ results: [] } satisfies CompanyExplorerEntitySearchResponse),
    requestedTypeSet.has("entity")
      ? searchEntities(context.requestJSON, {
          companyID: context.companyID,
          query: query.trim() || undefined,
          limit: boundedLimit,
          signal,
        })
      : Promise.resolve([]),
  ]);
  const seen = new Set<string>();
  const workspaceResults = (response.results ?? []).flatMap((result, responseIndex) => {
    const entityType = result.resource_type;
    const entityID = result.resource_id?.trim() ?? "";
    const label = result.display_name?.trim() ?? "";
    if (!isEditorEntityType(entityType) || !WORKSPACE_ENTITY_TYPES.has(entityType as EditorWorkspaceEntityType) || !requestedTypeSet.has(entityType as EditorWorkspaceEntityType) || !entityID || !label) return [];
    const key = `${entityType}:${entityID}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ entityType, entityID, label, updatedTimestamp: result.updated_timestamp, responseIndex }];
  });
  const entityResults = entities.flatMap((entity, responseIndex) => {
    const entityID = entity.entity_id.trim();
    const label = entity.name.trim();
    const key = `entity:${entityID}`;
    if (!entityID || !label || seen.has(key)) return [];
    seen.add(key);
    return [{ entityType: "entity" as const, entityID, label, updatedTimestamp: entity.updated_timestamp, responseIndex }];
  });
  const typeOrder = new Map(requestedTypes.map((type, index) => [type, index]));
  return [...workspaceResults, ...entityResults]
    .sort((left, right) => (typeOrder.get(left.entityType as EditorSearchableEntityType) ?? requestedTypes.length) - (typeOrder.get(right.entityType as EditorSearchableEntityType) ?? requestedTypes.length) || left.responseIndex - right.responseIndex)
    .slice(0, boundedLimit)
    .map(({ entityType, entityID, label, updatedTimestamp }) => ({ entityType, entityID, label, updatedTimestamp }));
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
  if (entityType === "entity") {
    element.style.setProperty("--mango-entity-chip-border", "rgba(13,148,136,0.42)");
    element.style.setProperty("--mango-entity-chip-background", "linear-gradient(135deg, rgba(255,255,255,0.98), rgba(204,251,241,0.9), rgba(219,234,254,0.82))");
    element.style.setProperty("--mango-entity-chip-shadow", "rgba(15,118,110,0.16)");
  }
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
  if (entity.emailMessageID?.trim()) element.setAttribute("data-mango-email-message-id", entity.emailMessageID.trim());
  if (entity.emailThreadID?.trim()) element.setAttribute("data-mango-email-thread-id", entity.emailThreadID.trim());
  if (entity.emailAccountEmail?.trim()) element.setAttribute("data-mango-email-account-email", entity.emailAccountEmail.trim().toLowerCase());
  if (entity.emailSharedInboxID?.trim()) element.setAttribute("data-mango-email-shared-inbox-id", entity.emailSharedInboxID.trim());
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
  if (!isEditorEntityType(entityType) || !entityID || !label) return null;
  return {
    entityType,
    entityID,
    label,
    ...(entityType === "email_message" ? {
      emailMessageID: element.dataset.mangoEmailMessageId?.trim() || undefined,
      emailThreadID: element.dataset.mangoEmailThreadId?.trim() || undefined,
      emailAccountEmail: element.dataset.mangoEmailAccountEmail?.trim().toLowerCase() || undefined,
      emailSharedInboxID: element.dataset.mangoEmailSharedInboxId?.trim() || undefined,
    } : {}),
  };
}

export function replaceEditorEntityReferencesWithLabels(root: ParentNode): boolean {
  const entityReferences = root.querySelectorAll<HTMLElement>(
    `[${EDITOR_ENTITY_LINK_ATTRIBUTE}="true"][${EDITOR_ENTITY_TYPE_ATTRIBUTE}="entity"]`,
  );
  let changed = false;
  for (const element of entityReferences) {
    const label = element.getAttribute(EDITOR_ENTITY_LABEL_ATTRIBUTE)?.trim() || element.textContent?.trim() || "Entity";
    element.replaceWith(element.ownerDocument.createTextNode(label));
    changed = true;
  }
  return changed;
}

function editorEntityLinkImmediatelyBeforeCaret(root: HTMLElement): HTMLElement | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;
  let cursor: Node = range.startContainer;
  let candidate: Node | null = null;
  if (cursor.nodeType === 3) {
    if (range.startOffset > 0) return null;
    candidate = cursor.previousSibling;
  } else {
    candidate = cursor.childNodes.item(range.startOffset - 1);
  }
  while (!candidate && cursor.parentNode && cursor.parentNode !== root) {
    cursor = cursor.parentNode;
    candidate = cursor.previousSibling;
  }
  while (candidate) {
    if (candidate instanceof HTMLElement && candidate.getAttribute(EDITOR_ENTITY_LINK_ATTRIBUTE) === "true") return candidate;
    if (candidate.nodeType === 3) {
      if (candidate.textContent) return null;
      candidate = candidate.previousSibling;
      continue;
    }
    if (candidate.lastChild) {
      candidate = candidate.lastChild;
      continue;
    }
    candidate = candidate.previousSibling;
  }
  return null;
}

export function replaceEditorEntityLinkWithLabel(root: HTMLElement, focusedElement?: HTMLElement | null): boolean {
  const element = focusedElement && root.contains(focusedElement)
    ? focusedElement
    : editorEntityLinkImmediatelyBeforeCaret(root);
  const entity = readEditorEntityLinkElement(element ?? null);
  if (!element || !entity) return false;
  const labelText = root.ownerDocument.createTextNode(entity.label);
  element.replaceWith(labelText);
  root.focus({ preventScroll: true });
  const selection = root.ownerDocument.getSelection();
  if (selection) {
    const range = root.ownerDocument.createRange();
    range.setStart(labelText, labelText.data.length);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  return true;
}
