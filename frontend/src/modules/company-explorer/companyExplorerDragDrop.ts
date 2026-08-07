import type { DragEvent } from "react";
import type { CompanyExplorerFolder, CompanyExplorerFolderKind, CompanyExplorerItemType } from "../folders/companyExplorerFolders.js";
import {
  getExplorerDropPayloadItemType,
  getExplorerDropPayloadItems,
} from "./treePresentation.js";
import type {
  ExplorerDragPayload,
  ExplorerRowDropPlacement,
  ExplorerSelectionDomain,
  ExplorerTreeNode,
} from "./companyExplorerTypes.js";

export const EXPLORER_DRAG_MIME = "application/x-mangorts-company-explorer-row";
export const TREE_INDENT_PX = 13;
export const TREE_BASE_LEFT_PX = 4;
export const TREE_TOGGLE_SLOT_PX = 14;
export const TREE_ROW_POSITION_STEP = 1000;

export function getExplorerDragPayload(row: ExplorerTreeNode): ExplorerDragPayload | null {
  if (row.syntheticKind === "RACI_folder" || row.syntheticKind === "default_scope_folder") return null;
  if (row.kind === "folder" && row.folderID && (row.folderKind || row.entityType === "folder")) {
    return { kind: "folder", folderID: row.folderID, folderKind: row.folderKind ?? "logic_gate" };
  }
  if (row.kind === "logic_gate" && row.logicGateID) {
    return { kind: "logic_gate", itemID: row.logicGateID, itemType: "logic_gate", sourceTreeID: row.id };
  }
  if (row.kind === "project" && row.projectID) {
    return { kind: "project", itemID: row.projectID, itemType: "project", sourceTreeID: row.id };
  }
  if (row.kind === "kanban" && row.kanbanBoardID) {
    return { kind: "kanban", itemID: row.kanbanBoardID, itemType: "kanban", sourceTreeID: row.id };
  }
  return null;
}

export function getExplorerItemPayload(row: ExplorerTreeNode): { itemID: string; itemType: CompanyExplorerItemType } | null {
  if (row.kind === "logic_gate" && row.logicGateID) return { itemID: row.logicGateID, itemType: "logic_gate" };
  if (row.kind === "project" && row.projectID) return { itemID: row.projectID, itemType: "project" };
  if (row.kind === "kanban" && row.kanbanBoardID) return { itemID: row.kanbanBoardID, itemType: "kanban" };
  return null;
}

export function getExplorerDragPayloadForSelection(row: ExplorerTreeNode, selectedIDs: Set<string>, rows: ExplorerTreeNode[]): ExplorerDragPayload | null {
  const basePayload = getExplorerDragPayload(row);
  const baseItem = getExplorerItemPayload(row);
  if (!basePayload || !baseItem) return basePayload;
  if (baseItem.itemType === "kanban") return basePayload;

  const dragIDs = selectedIDs.has(row.id) ? selectedIDs : new Set([row.id]);
  const items: { itemID: string; itemType: CompanyExplorerItemType; treeID?: string }[] = [];
  const seen = new Set<string>();
  for (const candidate of rows) {
    if (!dragIDs.has(candidate.id)) continue;
    const item = getExplorerItemPayload(candidate);
    const key = item ? `${item.itemType}:${item.itemID}` : "";
    if (!item || item.itemType === "kanban" || seen.has(key)) continue;
    seen.add(key);
    items.push({ ...item, treeID: candidate.id });
  }
  if (items.length <= 1) return basePayload;
  const itemType = items.every((item) => item.itemType === items[0].itemType) ? items[0].itemType : undefined;
  return { kind: "batch", itemType, items };
}

export function readExplorerDragPayload(dataTransfer: DataTransfer): ExplorerDragPayload | null {
  try {
    const raw = dataTransfer.getData(EXPLORER_DRAG_MIME);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ExplorerDragPayload;
    if (parsed.kind === "folder" && parsed.folderID && parsed.folderKind) return parsed;
    if ((parsed.kind === "logic_gate" || parsed.kind === "project" || parsed.kind === "kanban") && parsed.itemID && parsed.itemType) return {
      ...parsed,
      sourceTreeID: typeof parsed.sourceTreeID === "string" ? parsed.sourceTreeID : undefined,
    };
    if (parsed.kind === "batch") {
      const itemType = getExplorerDropPayloadItemType(parsed);
      const items = getExplorerDropPayloadItems(parsed);
      if (items.length > 0) return { kind: "batch", itemType: itemType ?? undefined, items };
    }
  } catch {
    // Drag payloads can come from outside the app; ignore anything we do not own.
  }
  return null;
}

export function collectFolderSubtreeIDs(folders: CompanyExplorerFolder[], rootFolderID: string): Set<string> {
  const deleted = new Set<string>();
  if (!rootFolderID || !folders.some((folder) => folder.folder_id === rootFolderID)) return deleted;
  deleted.add(rootFolderID);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (!folder.parent_folder_id || !deleted.has(folder.parent_folder_id) || deleted.has(folder.folder_id)) continue;
      deleted.add(folder.folder_id);
      changed = true;
    }
  }
  return deleted;
}

export function explorerRowOrder(row: ExplorerTreeNode): { position: number; createdTimestamp: string; id: string } {
  return { id: row.id, position: row.position || TREE_ROW_POSITION_STEP, createdTimestamp: row.createdTimestamp || "" };
}

export function sortExplorerRowsByPosition(rows: ExplorerTreeNode[]): ExplorerTreeNode[] {
  return [...rows].sort((a, b) => a.position - b.position || a.createdTimestamp.localeCompare(b.createdTimestamp) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

export function getExplorerRowContainerID(row: ExplorerTreeNode): string | null {
  if (row.kind === "folder") return row.parentEntityID ?? row.parentFolderID ?? "";
  if (row.kind === "node") return null;
  if (row.folderKind || row.parentEntityID) return row.parentEntityID ?? row.folderID ?? "";
  return null;
}

export function getExplorerRowOrderKind(row: ExplorerTreeNode): CompanyExplorerItemType | CompanyExplorerFolderKind | null {
  if (row.kind === "folder") return row.folderKind ?? (row.entityID ? "logic_gate" : null);
  return row.kind === "logic_gate" ? "logic_gate" : row.kind === "project" ? "project" : row.kind === "kanban" ? "kanban" : null;
}

export function getExplorerSelectionDomain(row?: ExplorerTreeNode | null): ExplorerSelectionDomain {
  if (!row) return "root";
  if (row.kind === "node") return "node";
  if (row.kind === "logic_gate") return "logic_gate";
  if (row.kind === "project") return "project";
  if (row.kind === "kanban") return "kanban";
  return row.folderKind ?? "root";
}

export function isExplorerTextInputTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  return Boolean(element?.closest("input, textarea, [contenteditable='true']"));
}

export function getExplorerDropIntent(event: DragEvent<HTMLElement>, hitTarget: HTMLElement = event.currentTarget): ExplorerRowDropPlacement | "inside" {
  const rect = hitTarget.getBoundingClientRect();
  const y = event.clientY - rect.top;
  if (y < rect.height * 0.25) return "before";
  if (y > rect.height * 0.75) return "after";
  return "inside";
}

export function getExplorerRowReorderPlacement(event: DragEvent<HTMLElement>): ExplorerRowDropPlacement {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2 ? "after" : "before";
}

export function readScrollTopFromStorage(key: string): number {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function readRootRowOrderFromStorage(key: string): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const next: Record<string, number> = {};
    for (const [rowID, value] of Object.entries(parsed)) {
      if (typeof rowID === "string" && typeof value === "number" && Number.isFinite(value) && value > 0) next[rowID] = value;
    }
    return next;
  } catch {
    return {};
  }
}
