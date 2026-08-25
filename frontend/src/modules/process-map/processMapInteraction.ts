import type { CompanyExplorerV2Row } from "../company-explorer/companyExplorerLazyApi.js";
import type { ExplorerDragPayload } from "../company-explorer/companyExplorerTypes.js";
import { formatExplorerFolderLabel } from "../company-explorer/treePresentation.js";
import type { ProcessMapResourceRef } from "./processMapApi.js";

export type ProcessMapDropDecision =
  | { kind: "place"; resource: ProcessMapResourceRef; label: string; mapParentFolderID: string | null }
  | { kind: "reject"; message: string }
  | { kind: "ignore" };

export type ProcessMapTrayCandidate = {
  resource: ProcessMapResourceRef;
  label: string;
  dragPayload: ExplorerDragPayload;
};

export function processMapResourceNodeID(resource: ProcessMapResourceRef): string {
  return `${resource.resource_type}:${resource.resource_id}`;
}

export function processMapTrayCandidates(
  rows: CompanyExplorerV2Row[],
  folderID: string | undefined,
  unavailableNodeIDs: ReadonlySet<string>,
): ProcessMapTrayCandidate[] {
  const mapParentFolderID = folderID?.trim() ?? "";
  const seen = new Set<string>();
  const candidates: ProcessMapTrayCandidate[] = [];
  for (const row of rows) {
    const label = (row.entity_type === "folder" ? formatExplorerFolderLabel(row.name) : row.name).trim();
    let candidate: ProcessMapTrayCandidate | null = null;
    if (row.entity_type === "folder") {
      const resourceID = row.entity_id.trim();
      if (!resourceID || resourceID === mapParentFolderID || !label) continue;
      candidate = {
        resource: { resource_type: "company_explorer_folder", resource_id: resourceID },
        label,
        dragPayload: { kind: "folder", label, folderID: resourceID, folderKind: "logic_gate" },
      };
    } else if (mapParentFolderID && row.entity_type === "logic_gate") {
      const resourceID = (row.resource_id || row.entity_id).trim();
      if (!resourceID || !label) continue;
      candidate = {
        resource: { resource_type: "logic_gate", resource_id: resourceID },
        label,
        dragPayload: { kind: "logic_gate", label, itemID: resourceID, itemType: "logic_gate" },
      };
    }
    if (!candidate) continue;
    const nodeID = processMapResourceNodeID(candidate.resource);
    if (seen.has(nodeID) || unavailableNodeIDs.has(nodeID)) continue;
    seen.add(nodeID);
    candidates.push(candidate);
  }
  return candidates;
}

export function decideProcessMapExplorerDrop(
  payload: ExplorerDragPayload | null,
  folderID?: string,
): ProcessMapDropDecision {
  if (!payload || (payload.kind !== "folder" && payload.kind !== "logic_gate")) return { kind: "ignore" };
  const mapParentFolderID = folderID?.trim() || null;
  const resourceID = (payload.kind === "folder" ? payload.folderID : payload.itemID)?.trim() ?? "";
  const label = payload.label?.trim() ?? "";
  if (!resourceID || !label) return { kind: "ignore" };
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
  return { kind: "place", resource, label, mapParentFolderID };
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

export function shouldApplyProcessMapMutationAck(
  requestCanonicalGeneration: number,
  currentCanonicalGeneration: number,
  operationGeneration: number,
  currentOperationGeneration: number,
): boolean {
  return requestCanonicalGeneration === currentCanonicalGeneration
    && operationGeneration === currentOperationGeneration;
}
