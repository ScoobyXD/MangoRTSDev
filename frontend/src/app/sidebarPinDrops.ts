import { EXPLORER_DRAG_MIME, readExplorerDragPayload } from "../modules/company-explorer/companyExplorerDragDrop.js";
import { getExplorerDropPayloadItems, type ExplorerDropPayload } from "../modules/company-explorer/treePresentation.js";
import { EXPLORER_ENTITY_DRAG_MIME, KANBAN_CARD_DRAG_MIME, KANBAN_COLUMN_DRAG_MIME, parseExplorerEntityDragItems } from "../modules/kanban/shared.js";
import { TRIAGE_MESSAGE_DRAG_MIME } from "../pages/home/homeConstants.js";
import { readTriageMessageDrag } from "../pages/home/homeUtils.js";
import { sidebarPinFallbackName, type SidebarPin, type SidebarPinDraft, type SidebarPinKind } from "./sidebarPins.js";

export const APP_SIDEBAR_PIN_DRAG_MIME = "application/x-mangorts-sidebar-pin";

export type SidebarPinnedResourceDropAction =
  | { kind: "triage_to_logic_gate"; pin: SidebarPin; logicGateID: string; messageIDs: string[]; sharedInboxID?: string; accountEmail?: string }
  | { kind: "triage_to_node"; pin: SidebarPin; nodeID: string; messageIDs: string[]; sharedInboxID?: string; accountEmail?: string }
  | { kind: "nodes_to_logic_gate"; pin: SidebarPin; logicGateID: string; nodeIDs: string[] };

export type SidebarPinDropPlacement = "before" | "after" | "inside";

export function isSidebarPinKind(value: unknown): value is SidebarPinKind {
  return value === "node" || value === "logic_gate" || value === "project";
}

export function sidebarPinsFromDrop(dataTransfer: DataTransfer, parentFolderID?: string): SidebarPinDraft[] {
  const payload = readSidebarExplorerDragPayload(dataTransfer);
  const droppedText = dataTransfer.getData("text/plain").trim();

  if (payload && isSidebarPinKind(payload.kind) && payload.itemID) {
    const kind = payload.kind;
    return [{
      id: payload.itemID.trim(),
      kind,
      name: droppedText || sidebarPinFallbackName(kind, payload.itemID),
      ...(parentFolderID !== undefined ? { parentFolderID } : {}),
    }];
  }

  if (payload?.kind === "batch" && isSidebarPinKind(payload.itemType)) {
    const kind = payload.itemType;
    return getExplorerDropPayloadItems(payload).map((item) => ({
      id: item.itemID.trim(),
      kind,
      name: sidebarPinFallbackName(kind, item.itemID),
      ...(parentFolderID !== undefined ? { parentFolderID } : {}),
    }));
  }

  const nodeItems = readNodeDragItems(dataTransfer);
  if (nodeItems.length > 0) {
    return nodeItems.map((item) => ({
      id: item.nodeID,
      kind: "node",
      name: item.label.trim() || sidebarPinFallbackName("node", item.nodeID),
      ...(parentFolderID !== undefined ? { parentFolderID } : {}),
    }));
  }

  return [];
}

export function readSidebarPinnedResourceDropAction(pin: SidebarPin, dataTransfer: DataTransfer): SidebarPinnedResourceDropAction | null {
  if (hasSidebarPinDrag(dataTransfer)) return null;
  const pinID = pin.id.trim();
  if (!pinID || pin.kind === "project") return null;

  const triageMessageDrag = readTriageMessageDrag(dataTransfer);
  if (triageMessageDrag.messageIDs.length > 0) {
    if (pin.kind === "logic_gate") {
      return { kind: "triage_to_logic_gate", pin, logicGateID: pinID, messageIDs: triageMessageDrag.messageIDs, sharedInboxID: triageMessageDrag.sharedInboxID, accountEmail: triageMessageDrag.accountEmail };
    }
    return { kind: "triage_to_node", pin, nodeID: pinID, messageIDs: triageMessageDrag.messageIDs, sharedInboxID: triageMessageDrag.sharedInboxID, accountEmail: triageMessageDrag.accountEmail };
  }

  if (pin.kind === "logic_gate") {
    const nodeIDs = readSidebarNodeIDs(dataTransfer);
    if (nodeIDs.length > 0) return { kind: "nodes_to_logic_gate", pin, logicGateID: pinID, nodeIDs };
  }

  return null;
}

export function sidebarPinAcceptsPinnedResourceDrop(pin: SidebarPin, dataTransfer: DataTransfer): boolean {
  return readSidebarPinnedResourceDropAction(pin, dataTransfer) !== null;
}

export function sidebarPinAcceptsPinnedResourceDrag(pin: SidebarPin, dataTransfer: DataTransfer): boolean {
  if (hasSidebarPinDrag(dataTransfer)) return false;
  const pinID = pin.id.trim();
  if (!pinID || pin.kind === "project") return false;

  const types = Array.from(dataTransfer.types);
  if (types.includes(TRIAGE_MESSAGE_DRAG_MIME)) return pin.kind === "logic_gate" || pin.kind === "node";
  return pin.kind === "logic_gate" && types.includes(EXPLORER_ENTITY_DRAG_MIME);
}

export function hasSidebarPinSectionDrop(dataTransfer: DataTransfer): boolean {
  return sidebarPinsFromDrop(dataTransfer).length > 0;
}

export function hasSidebarPinDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(APP_SIDEBAR_PIN_DRAG_MIME);
}

export function hasMangoDragPayload(dataTransfer: DataTransfer): boolean {
  const types = Array.from(dataTransfer.types);
  return types.includes(EXPLORER_DRAG_MIME)
    || types.includes(EXPLORER_ENTITY_DRAG_MIME)
    || types.includes(KANBAN_CARD_DRAG_MIME)
    || types.includes(KANBAN_COLUMN_DRAG_MIME);
}

function readSidebarNodeIDs(dataTransfer: DataTransfer): string[] {
  const fromExplorerEntity = readNodeDragItems(dataTransfer).map((item) => item.nodeID);
  const payload = readSidebarExplorerDragPayload(dataTransfer);
  const fromExplorerPayload = payload
    ? payload.kind === "node" && payload.itemID
      ? [payload.itemID]
      : payload.kind === "batch"
        ? getExplorerDropPayloadItems(payload).filter((item) => item.itemType === "node").map((item) => item.itemID)
        : []
    : [];
  return cleanIDs([...fromExplorerEntity, ...fromExplorerPayload]);
}

function readNodeDragItems(dataTransfer: DataTransfer): Array<{ nodeID: string; label: string }> {
  return parseExplorerEntityDragItems(dataTransfer.getData(EXPLORER_ENTITY_DRAG_MIME))
    .map((item) => ({ nodeID: item.nodeID.trim(), label: item.label.trim() }))
    .filter((item) => item.nodeID);
}

function readSidebarExplorerDragPayload(dataTransfer: DataTransfer): ExplorerDropPayload | null {
  const payload = readExplorerDragPayload(dataTransfer);
  if (payload) return payload;
  try {
    const raw = dataTransfer.getData(EXPLORER_DRAG_MIME);
    if (!raw) return null;
    const candidate = JSON.parse(raw) as Partial<ExplorerDropPayload>;
    if (candidate.kind === "node" && typeof candidate.itemID === "string" && candidate.itemID.trim()) {
      return { ...candidate, kind: "node", itemID: candidate.itemID.trim(), itemType: "node" };
    }
  } catch {
    return null;
  }
  return null;
}

function cleanIDs(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = value.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}
