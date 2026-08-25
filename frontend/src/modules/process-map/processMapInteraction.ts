import type { ExplorerDragPayload } from "../company-explorer/companyExplorerTypes.js";
import type { ProcessMapResourceRef } from "./processMapApi.js";

export type ProcessMapDropDecision =
  | { kind: "place"; resource: ProcessMapResourceRef; mapParentFolderID: string | null }
  | { kind: "reject"; message: string }
  | { kind: "ignore" };

export function decideProcessMapExplorerDrop(
  payload: ExplorerDragPayload | null,
  folderID?: string,
): ProcessMapDropDecision {
  if (!payload || (payload.kind !== "folder" && payload.kind !== "logic_gate")) return { kind: "ignore" };
  const mapParentFolderID = folderID?.trim() || null;
  const resourceID = (payload.kind === "folder" ? payload.folderID : payload.itemID)?.trim() ?? "";
  if (!resourceID) return { kind: "ignore" };
  const resource: ProcessMapResourceRef = payload.kind === "folder"
    ? { resource_type: "company_explorer_folder", resource_id: resourceID }
    : { resource_type: "logic_gate", resource_id: resourceID };
  if (!mapParentFolderID && resource.resource_type === "logic_gate") {
    return {
      kind: "reject",
      message: "Processes can be placed inside Folder layers. The root layer accepts Folders only.",
    };
  }
  if (
    mapParentFolderID
    && resource.resource_type === "company_explorer_folder"
    && resource.resource_id === mapParentFolderID
  ) {
    return { kind: "reject", message: "A Folder cannot be placed inside its own layer." };
  }
  return { kind: "place", resource, mapParentFolderID };
}

export function processMapSelectionTarget(nodeID: string, restricted: boolean): string | null {
  return restricted ? null : nodeID;
}

export function processMapFolderDrillTarget(resource: ProcessMapResourceRef | null): string | null {
  return resource?.resource_type === "company_explorer_folder" ? resource.resource_id : null;
}

export function isValidProcessMapConnection(connection: {
  source?: string | null;
  target?: string | null;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}): boolean {
  return Boolean(
    connection.source
    && connection.target
    && connection.source !== connection.target
    && connection.sourceHandle === "output"
    && connection.targetHandle === "input"
  );
}

export function shouldApplyProcessMapCommit(currentRevision: number, savedRevision: number): boolean {
  return Number.isSafeInteger(savedRevision) && savedRevision >= currentRevision;
}

export function shouldRollbackProcessMapOptimisticSave(saveGeneration: number, latestGeneration: number): boolean {
  return saveGeneration === latestGeneration;
}
