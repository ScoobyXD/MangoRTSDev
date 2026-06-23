import { getNodeTitle, type NodeRecord } from "../node-map/shared.js";
import { getNodeTitle as getLogicGateTitle, type NodeRecord as LogicGateRecord } from "../logic-gate-map/shared.js";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem, CompanyExplorerFolderKind } from "../folders/companyExplorerFolders.js";
import type { KanbanBoard } from "../kanban/shared.js";
import type { ProjectRecord } from "../project-management/projectManagementApi.js";
import type { CompanyExplorerSearchResult, CompanyExplorerV2EntityType, CompanyExplorerV2Row } from "./companyExplorerLazyApi.js";
import {
  formatExplorerFolderLabel,
  isExplorerSystemFolderKey,
} from "./treePresentation.js";
import { sortExplorerRowsByPosition, TREE_ROW_POSITION_STEP } from "./companyExplorerDragDrop.js";
import type { ExplorerTreeNode } from "./companyExplorerTypes.js";

type BuildCompanyExplorerTreeRowsInput = {
  expanded: Set<string>;
  nodes: NodeRecord[];
  logicGates: LogicGateRecord[];
  projects: ProjectRecord[];
  kanbanBoards: KanbanBoard[];
  folders: CompanyExplorerFolder[];
  folderItems: CompanyExplorerFolderItem[];
  rootRowOrder: Record<string, number>;
  todayISODate?: string;
};

type BuildCompanyExplorerV2TreeRowsInput = {
  expanded: Set<string>;
  rows: CompanyExplorerV2Row[];
};

const ROOT_ROW_POSITION_OFFSET: Record<CompanyExplorerFolderKind, number> = {
  node: 0,
  logic_gate: 100_000_000,
  project: 200_000_000,
};

function normalizeFolderName(value: string): string {
  return value.trim().toLowerCase();
}

export function findCompanyExplorerRootFolderByName(
  folders: CompanyExplorerFolder[],
  folderKind: CompanyExplorerFolderKind,
  name: string,
): CompanyExplorerFolder | null {
  const normalizedName = normalizeFolderName(name);
  if (!normalizedName) return null;
  return [...folders]
    .filter((folder) =>
      folder.folder_kind === folderKind
      && !folder.parent_folder_id
      && normalizeFolderName(folder.name) === normalizedName
    )
    .sort((a, b) => a.position - b.position || a.created_timestamp.localeCompare(b.created_timestamp) || a.folder_id.localeCompare(b.folder_id))[0] ?? null;
}

export function buildScopedCompanyExplorerTreeRows(rows: ExplorerTreeNode[], rootFolderID: string): ExplorerTreeNode[] {
  const rootTreeID = `workspace-folder-${rootFolderID.trim()}`;
  if (rootTreeID === "workspace-folder-") return rows;
  const rootIndex = rows.findIndex((row) => row.id === rootTreeID);
  if (rootIndex < 0) return [];
  const rootDepth = rows[rootIndex].depth;
  const scopedRows: ExplorerTreeNode[] = [];
  for (let index = rootIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.depth <= rootDepth) break;
    const depth = Math.max(0, row.depth - rootDepth - 1);
    scopedRows.push({ ...row, depth, scopeLevel: depth });
  }
  return scopedRows;
}

function getLocalISODate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeISODate(value: string | null | undefined): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "";
}

export function buildCompanyExplorerTreeRows({
  expanded,
  nodes,
  logicGates,
  projects,
  kanbanBoards,
  folders,
  folderItems,
  rootRowOrder,
  todayISODate,
}: BuildCompanyExplorerTreeRowsInput): ExplorerTreeNode[] {
  void kanbanBoards;
  const rows: ExplorerTreeNode[] = [];
  const currentDate = normalizeISODate(todayISODate) || getLocalISODate();
  const nodeByID = new Map(nodes.map((node) => [node.node_id, node]));
  const logicGateByID = new Map(logicGates.map((logicGate) => [logicGate.logic_gate_id, logicGate]));
  const projectByID = new Map(projects.map((project) => [project.project_id, project]));
  const folderByID = new Map(folders.map((folder) => [folder.folder_id, folder]));
  const folderScopeForFolder = (folder?: CompanyExplorerFolder) => ({
    folderScopeType: folder?.scope_type,
    folderScopeID: folder?.scope_id?.trim() || undefined,
  });
  const folderPathLabelByID = new Map<string, string>();
  const getFolderPathLabel = (folderID: string): string => {
    if (!folderID) return "";
    const cached = folderPathLabelByID.get(folderID);
    if (cached !== undefined) return cached;
    const parts: string[] = [];
    let currentID = folderID;
    const seen = new Set<string>();
    while (currentID && !seen.has(currentID)) {
      seen.add(currentID);
      const folder = folderByID.get(currentID);
      if (!folder) break;
      parts.push(formatExplorerFolderLabel(folder.name));
      currentID = folder.parent_folder_id ?? "";
    }
    const label = parts.reverse().join(" / ");
    folderPathLabelByID.set(folderID, label);
    return label;
  };
  const assignedNodes = new Set(folderItems.filter((item) => item.item_type === "node").map((item) => item.item_id));
  const assignedLogicGates = new Set(folderItems.filter((item) => item.item_type === "logic_gate").map((item) => item.item_id));
  const assignedProjects = new Set(folderItems.filter((item) => item.item_type === "project").map((item) => item.item_id));
  const nodesByLogicGateID = new Map<string, NodeRecord[]>();
  for (const node of nodes) {
    for (const logicGateID of node.logic_gate_ids ?? []) {
      const cleanLogicGateID = logicGateID.trim();
      if (!cleanLogicGateID) continue;
      const bucket = nodesByLogicGateID.get(cleanLogicGateID) ?? [];
      bucket.push(node);
      nodesByLogicGateID.set(cleanLogicGateID, bucket);
    }
  }
  const foldersByParent = new Map<string, CompanyExplorerFolder[]>();
  for (const folder of folders) {
    const key = folder.parent_folder_id ?? "";
    const bucket = foldersByParent.get(key) ?? [];
    bucket.push(folder);
    foldersByParent.set(key, bucket);
  }
  const itemsByFolder = new Map<string, CompanyExplorerFolderItem[]>();
  for (const item of folderItems) {
    const key = item.folder_id;
    const bucket = itemsByFolder.get(key) ?? [];
    bucket.push(item);
    itemsByFolder.set(key, bucket);
  }

  const getRootAwarePosition = (folderKind: CompanyExplorerFolderKind, rowID: string, position: number): number => {
    return rootRowOrder[rowID] ?? position + ROOT_ROW_POSITION_OFFSET[folderKind];
  };

  const getLogicGateChildNodes = (logicGateID: string): NodeRecord[] => {
    return [...(nodesByLogicGateID.get(logicGateID) ?? [])].sort((a, b) => (
      getNodeTitle(a).localeCompare(getNodeTitle(b))
      || a.created_timestamp.localeCompare(b.created_timestamp)
      || a.node_id.localeCompare(b.node_id)
    ));
  };

  const buildLogicGateChildNodeRows = (logicGateID: string, depth: number): ExplorerTreeNode[] => {
    return getLogicGateChildNodes(logicGateID).map((node, index) => ({
      id: `logic-gate-${logicGateID}-node-${node.node_id}`,
      label: getNodeTitle(node) || node.node_id,
      depth,
      kind: "node",
      nodeID: node.node_id,
      scopeLevel: depth,
      position: (index + 1) * TREE_ROW_POSITION_STEP,
      createdTimestamp: node.created_timestamp,
      parentLogicGateID: logicGateID,
      syntheticKind: "logic_gate_children",
    }));
  };

  const buildFolderBranchRows = (folderKind: CompanyExplorerFolderKind, parentFolderID: string, depth: number): ExplorerTreeNode[] => {
    const parentFolder = folderByID.get(parentFolderID);
    const parentFolderKind = (parentFolder?.folder_kind ?? folderKind) as CompanyExplorerFolderKind;
    const parentFolderScope = folderScopeForFolder(parentFolder);
    const directItems = itemsByFolder.get(parentFolderID) ?? [];
    const branchRows: ExplorerTreeNode[] = [];
    let syntheticRootPosition = 0;
    if (parentFolderID === "" && folderKind === "node") {
      for (const node of nodes) {
        if (assignedNodes.has(node.node_id)) continue;
        syntheticRootPosition += TREE_ROW_POSITION_STEP;
        const rowID = `node-${node.node_id}`;
        branchRows.push({
          id: rowID,
          label: getNodeTitle(node) || node.node_id,
          depth,
          kind: "node",
          nodeID: node.node_id,
          folderID: "",
          folderKind,
          scopeLevel: depth,
          position: getRootAwarePosition(folderKind, rowID, syntheticRootPosition),
          createdTimestamp: node.created_timestamp,
        });
      }
    }
    if (parentFolderID === "" && folderKind === "logic_gate") {
      for (const logicGate of logicGates) {
        if (assignedLogicGates.has(logicGate.logic_gate_id)) continue;
        syntheticRootPosition += TREE_ROW_POSITION_STEP;
        const rowID = `logic-gate-${logicGate.logic_gate_id}`;
        branchRows.push({
          id: rowID,
          label: getLogicGateTitle(logicGate) || logicGate.logic_gate_id,
          depth,
          kind: "logic_gate",
          logicGateID: logicGate.logic_gate_id,
          folderID: "",
          folderKind,
          scopeLevel: depth,
          position: getRootAwarePosition(folderKind, rowID, syntheticRootPosition),
          createdTimestamp: logicGate.created_timestamp,
          hasChildren: true,
        });
      }
    }
    if (parentFolderID === "" && folderKind === "project") {
      for (const project of projects) {
        if (assignedProjects.has(project.project_id)) continue;
        syntheticRootPosition += TREE_ROW_POSITION_STEP;
        const rowID = `project-${project.project_id}`;
        branchRows.push({
          id: rowID,
          label: project.name || project.project_id,
          depth,
          kind: "project",
          projectID: project.project_id,
          folderID: "",
          folderKind,
          scopeLevel: depth,
          position: getRootAwarePosition(folderKind, rowID, syntheticRootPosition),
          createdTimestamp: project.created_timestamp,
        });
      }
    }
    for (const item of directItems) {
      if (item.item_type === "node") {
        const node = nodeByID.get(item.item_id);
        if (node) {
          branchRows.push({
            id: `node-${node.node_id}`,
            label: getNodeTitle(node) || node.node_id,
            depth,
            kind: "node",
            nodeID: node.node_id,
            folderID: parentFolderID,
            folderKind: parentFolderKind,
            ...parentFolderScope,
            folderLabel: getFolderPathLabel(parentFolderID),
            scopeLevel: depth,
            position: parentFolderID === "" ? getRootAwarePosition(folderKind, `node-${node.node_id}`, item.position || TREE_ROW_POSITION_STEP) : item.position || TREE_ROW_POSITION_STEP,
            createdTimestamp: item.created_timestamp,
          });
        }
      } else if (item.item_type === "logic_gate") {
        const logicGate = logicGateByID.get(item.item_id);
        if (logicGate) {
          branchRows.push({
            id: `logic-gate-${logicGate.logic_gate_id}`,
            label: getLogicGateTitle(logicGate) || logicGate.logic_gate_id,
            depth,
            kind: "logic_gate",
            logicGateID: logicGate.logic_gate_id,
            folderID: parentFolderID,
            folderKind: parentFolderKind,
            ...parentFolderScope,
            folderLabel: getFolderPathLabel(parentFolderID),
            scopeLevel: depth,
            position: parentFolderID === "" ? getRootAwarePosition(folderKind, `logic-gate-${logicGate.logic_gate_id}`, item.position || TREE_ROW_POSITION_STEP) : item.position || TREE_ROW_POSITION_STEP,
            createdTimestamp: item.created_timestamp,
            hasChildren: true,
          });
        }
      } else if (item.item_type === "project") {
        const project = projectByID.get(item.item_id);
        if (project) {
          branchRows.push({
            id: `project-${project.project_id}`,
            label: project.name || project.project_id,
            depth,
            kind: "project",
            projectID: project.project_id,
            folderID: parentFolderID,
            folderKind: parentFolderKind,
            ...parentFolderScope,
            folderLabel: getFolderPathLabel(parentFolderID),
            scopeLevel: depth,
            position: parentFolderID === "" ? getRootAwarePosition(folderKind, `project-${project.project_id}`, item.position || TREE_ROW_POSITION_STEP) : item.position || TREE_ROW_POSITION_STEP,
            createdTimestamp: item.created_timestamp,
          });
        }
      }
    }

    const childFolders = (foldersByParent.get(parentFolderID) ?? [])
      .filter((folder) => parentFolderID !== "" || folder.folder_kind === folderKind);
    for (const folder of childFolders) {
      if (folder.system_key === "kanban_boards") continue;
      const childFolderKind = folder.folder_kind as CompanyExplorerFolderKind;
      const rowID = `workspace-folder-${folder.folder_id}`;
      branchRows.push({
        id: rowID,
        label: formatExplorerFolderLabel(folder.name),
        depth,
        kind: "folder",
        folderID: folder.folder_id,
        parentFolderID: folder.parent_folder_id ?? "",
        folderKind: childFolderKind,
        ...folderScopeForFolder(folder),
        systemKey: isExplorerSystemFolderKey(folder.system_key) ? folder.system_key : undefined,
        folderLabel: getFolderPathLabel(folder.folder_id),
        scopeLevel: depth,
        position: parentFolderID === "" ? getRootAwarePosition(childFolderKind, rowID, folder.position || TREE_ROW_POSITION_STEP) : folder.position || TREE_ROW_POSITION_STEP,
        createdTimestamp: folder.created_timestamp,
      });
    }

    return sortExplorerRowsByPosition(branchRows);
  };

  const buildSystemFolderContentRows = (systemKey: string | undefined, depth: number): ExplorerTreeNode[] => {
    const contentRows: ExplorerTreeNode[] = [];
    if (systemKey === "history") {
      let historyPosition = 0;
      for (const node of nodes) {
        const dueDate = normalizeISODate(node.due_date);
        if (!dueDate || dueDate >= currentDate) continue;
        historyPosition += TREE_ROW_POSITION_STEP;
        contentRows.push({
          id: `system-history-node-${node.node_id}`,
          label: getNodeTitle(node) || node.node_id,
          depth,
          kind: "node",
          nodeID: node.node_id,
          scopeLevel: depth,
          position: historyPosition,
          createdTimestamp: node.created_timestamp,
        });
      }
    }
    return contentRows;
  };

  const pushFolderBranch = (folderKind: CompanyExplorerFolderKind, parentFolderID: string, depth: number) => {
    for (const row of buildFolderBranchRows(folderKind, parentFolderID, depth)) {
      rows.push(row);
      if (row.kind === "logic_gate" && expanded.has(row.id) && row.logicGateID) {
        rows.push(...buildLogicGateChildNodeRows(row.logicGateID, row.depth + 1));
      }
      if (row.kind !== "folder" || !expanded.has(row.id) || !row.folderID) continue;
      for (const systemRow of buildSystemFolderContentRows(row.systemKey, depth + 1)) rows.push(systemRow);
      pushFolderBranch(folderKind, row.folderID, depth + 1);
    }
  };

  // Durable folders/items share sparse positions inside each parent folder.
  // Unplaced root entities use local view positions until a folder placement
  // row exists, because their order is personal UI state rather than graph data.
  for (const row of sortExplorerRowsByPosition([
    ...buildFolderBranchRows("node", "", 0),
    ...buildFolderBranchRows("logic_gate", "", 0),
    ...buildFolderBranchRows("project", "", 0),
  ])) {
    rows.push(row);
    if (row.kind === "logic_gate" && expanded.has(row.id) && row.logicGateID) {
      rows.push(...buildLogicGateChildNodeRows(row.logicGateID, row.depth + 1));
    }
    if (row.kind !== "folder" || !expanded.has(row.id) || !row.folderID || !row.folderKind) continue;
    for (const systemRow of buildSystemFolderContentRows(row.systemKey, 1)) rows.push(systemRow);
    pushFolderBranch(row.folderKind, row.folderID, 1);
  }
  return rows;
}


function explorerKindForSearchEntity(entityType: CompanyExplorerV2EntityType): ExplorerTreeNode["kind"] {
  if (entityType === "node") return "node";
  if (entityType === "logic_gate") return "logic_gate";
  if (entityType === "project") return "project";
  return "folder";
}

function explorerFolderKindForSearchEntity(entityType: CompanyExplorerV2EntityType): CompanyExplorerFolderKind | undefined {
  if (entityType === "node") return "node";
  if (entityType === "project") return "project";
  return "logic_gate";
}

function searchTreeIDForEntity(entityType: CompanyExplorerV2EntityType, resourceID: string, entityID: string, prefix: string): string {
  const id = resourceID || entityID;
  if (entityType === "node") return `${prefix}node-${id}`;
  if (entityType === "logic_gate") return `${prefix}logic-gate-${id}`;
  if (entityType === "project") return `${prefix}project-${id}`;
  return `${prefix}workspace-folder-${entityID}`;
}

function isProtectedDefaultFolderContext(nativeContext?: Record<string, string>): boolean {
  return nativeContext?.protected_default_folder === "true";
}

export function isCompanyExplorerV2FolderItemPlacementRow(row: CompanyExplorerV2Row, rows: CompanyExplorerV2Row[]): boolean {
  if (!row.edge_id || row.entity_type === "company" || row.entity_type === "folder") return false;
  const parentEntityID = row.parent_entity_id?.trim() ?? "";
  if (!parentEntityID) return true;
  return rows.some((candidate) => candidate.entity_id === parentEntityID && candidate.entity_type === "folder");
}

export function buildCompanyExplorerSearchTreeRows(results: CompanyExplorerSearchResult[]): ExplorerTreeNode[] {
  const rows: ExplorerTreeNode[] = [];
  results.forEach((result, resultIndex) => {
    const pathLabelParts: string[] = [];
    const rowPrefix = `company-explorer-search-${result.resource_type}-${result.resource_id || result.entity_id}-${resultIndex}-`;
    result.location_path.forEach((segment, segmentIndex) => {
      const kind = explorerKindForSearchEntity(segment.entity_type);
      const resourceID = segment.resource_id || segment.entity_id;
      pathLabelParts.push(formatExplorerFolderLabel(segment.name || resourceID));
      rows.push({
        id: searchTreeIDForEntity(segment.entity_type, resourceID, segment.entity_id, `${rowPrefix}path-${segmentIndex}-`),
        label: segment.name || resourceID,
        depth: segmentIndex,
        kind,
        entityID: segment.entity_id,
        entityType: segment.entity_type,
        resourceID: resourceID || undefined,
        parentEntityID: segmentIndex > 0 ? result.location_path[segmentIndex - 1]?.entity_id ?? "" : "",
        nodeID: segment.entity_type === "node" ? resourceID : undefined,
        logicGateID: segment.entity_type === "logic_gate" ? resourceID : undefined,
        projectID: segment.entity_type === "project" ? resourceID : undefined,
        folderID: kind === "folder" ? segment.entity_id : undefined,
        parentFolderID: segmentIndex > 0 ? result.location_path[segmentIndex - 1]?.entity_id ?? "" : "",
        folderKind: explorerFolderKindForSearchEntity(segment.entity_type),
        protectedDefaultFolder: Boolean(segment.protected_default_folder),
        folderLabel: pathLabelParts.join(" / "),
        scopeLevel: segmentIndex,
        position: ((resultIndex + 1) * TREE_ROW_POSITION_STEP) + segmentIndex,
        createdTimestamp: result.created_timestamp,
        hasChildren: true,
        syntheticKind: "search_path",
      });
    });

    const resourceID = result.resource_id || result.entity_id;
    const kind = explorerKindForSearchEntity(result.resource_type);
    const folderKind = explorerFolderKindForSearchEntity(result.resource_type);
    const parentSegment = result.location_path[result.location_path.length - 1];
    rows.push({
      id: `company-explorer-search-result-${result.resource_type}-${resourceID || result.entity_id}`,
      label: result.display_name || resourceID || result.entity_id,
      depth: result.location_path.length,
      kind,
      entityID: result.entity_id,
      entityType: result.resource_type,
      resourceID: resourceID || undefined,
      parentEntityID: parentSegment?.entity_id ?? "",
      nodeID: result.resource_type === "node" ? resourceID : undefined,
      logicGateID: result.resource_type === "logic_gate" ? resourceID : undefined,
      projectID: result.resource_type === "project" ? resourceID : undefined,
      folderID: kind === "folder" ? result.entity_id : parentSegment?.entity_id ?? "",
      parentFolderID: parentSegment?.entity_id ?? "",
      folderKind,
      protectedDefaultFolder: Boolean(result.protected_default_folder),
      folderLabel: pathLabelParts.join(" / "),
      scopeLevel: result.location_path.length,
      position: ((resultIndex + 1) * TREE_ROW_POSITION_STEP) + result.location_path.length,
      createdTimestamp: result.created_timestamp,
      hasChildren: Boolean(result.has_children),
    });
  });
  return rows;
}export function buildCompanyExplorerV2TreeRows({
  expanded,
  rows,
}: BuildCompanyExplorerV2TreeRowsInput): ExplorerTreeNode[] {
  const rowByKey = new Map<string, CompanyExplorerV2Row>();
  for (const row of rows) {
    const rowKey = row.edge_id || `${row.parent_entity_id ?? ""}:${row.entity_id}`;
    if (!rowKey) continue;
    rowByKey.set(rowKey, row);
  }
  const uniqueRows = [...rowByKey.values()];
  const rowByEntityID = new Map<string, CompanyExplorerV2Row>();
  const rowCountByEntityID = new Map<string, number>();
  for (const row of uniqueRows) {
    if (!rowByEntityID.has(row.entity_id)) rowByEntityID.set(row.entity_id, row);
    rowCountByEntityID.set(row.entity_id, (rowCountByEntityID.get(row.entity_id) ?? 0) + 1);
  }
  const rowsByParentEntityID = new Map<string, CompanyExplorerV2Row[]>();
  for (const row of uniqueRows) {
    const parentID = row.parent_entity_id?.trim() ?? "";
    const bucket = rowsByParentEntityID.get(parentID) ?? [];
    bucket.push(row);
    rowsByParentEntityID.set(parentID, bucket);
  }
  for (const bucket of rowsByParentEntityID.values()) {
    bucket.sort((left, right) => (
      (left.position - right.position)
      || String(left.created_timestamp ?? "").localeCompare(String(right.created_timestamp ?? ""))
      || left.name.localeCompare(right.name)
      || left.entity_id.localeCompare(right.entity_id)
    ));
  }

  const treeIDForRow = (row: CompanyExplorerV2Row): string => {
    const resourceID = row.resource_id || row.entity_id;
    if (row.entity_type === "company" && !row.parent_entity_id) return "folder-root";
    if (row.entity_type === "folder") return `workspace-folder-${row.entity_id}`;
    const contextSuffix = (rowCountByEntityID.get(row.entity_id) ?? 0) > 1 && row.parent_entity_id
      ? `-context-${row.edge_id || row.parent_entity_id}`
      : "";
    if (row.entity_type === "node") {
      const parent = row.parent_entity_id ? rowByEntityID.get(row.parent_entity_id) : undefined;
      if (parent?.entity_type === "logic_gate" && parent.resource_id) return `logic-gate-${parent.resource_id}-node-${resourceID}`;
      return `node-${resourceID}${contextSuffix}`;
    }
    if (row.entity_type === "logic_gate") return `logic-gate-${resourceID}${contextSuffix}`;
    if (row.entity_type === "project") return `project-${resourceID}${contextSuffix}`;
    return `company-explorer-${row.entity_type}-${row.entity_id}`;
  };

  const rowKindForEntity = (row: CompanyExplorerV2Row): ExplorerTreeNode["kind"] => {
    if (row.entity_type === "node") return "node";
    if (row.entity_type === "logic_gate") return "logic_gate";
    if (row.entity_type === "project") return "project";
    return "folder";
  };

  const folderKindForRow = (row: CompanyExplorerV2Row): CompanyExplorerFolderKind | undefined => {
    if (row.entity_type === "node") return "node";
    if (row.entity_type === "logic_gate") return "logic_gate";
    if (row.entity_type === "project") return "project";
    if (row.entity_type === "folder") return "logic_gate";
    return undefined;
  };

  const toTreeRow = (row: CompanyExplorerV2Row, depth: number): ExplorerTreeNode => {
    const kind = rowKindForEntity(row);
    const displayID = row.resource_id || row.entity_id;
    const resourceID = row.resource_id || "";
    const folderKind = folderKindForRow(row);
    return {
      id: treeIDForRow(row),
      label: row.name || displayID,
      depth,
      kind,
      entityID: row.entity_id,
      entityType: row.entity_type,
      edgeID: row.edge_id,
      parentEntityID: row.parent_entity_id ?? "",
      resourceID: resourceID || undefined,
      nodeID: row.entity_type === "node" && resourceID ? resourceID : undefined,
      logicGateID: row.entity_type === "logic_gate" && resourceID ? resourceID : undefined,
      projectID: row.entity_type === "project" && resourceID ? resourceID : undefined,
      folderID: kind === "folder" ? row.entity_id : row.parent_entity_id,
      parentFolderID: row.parent_entity_id ?? "",
      folderKind,
      protectedDefaultFolder: row.entity_type === "folder" && isProtectedDefaultFolderContext(row.native_context),
      folderLabel: row.parent_entity_id ? rowByEntityID.get(row.parent_entity_id)?.name : undefined,
      scopeLevel: depth,
      position: row.position || TREE_ROW_POSITION_STEP,
      createdTimestamp: String(row.created_timestamp ?? ""),
      hasChildren: Boolean(row.has_children),
    };
  };

  const out: ExplorerTreeNode[] = [];
  const pushBranch = (parentEntityID: string, depth: number, seen: Set<string>) => {
    for (const row of rowsByParentEntityID.get(parentEntityID) ?? []) {
      const treeRow = toTreeRow(row, depth);
      out.push(treeRow);
      const loadedChildren = rowsByParentEntityID.get(row.entity_id) ?? [];
      if ((!row.has_children && loadedChildren.length === 0) || seen.has(row.entity_id)) continue;
      if (!expanded.has(treeRow.id) && !expanded.has("*")) continue;
      const nextSeen = new Set(seen).add(row.entity_id);
      pushBranch(row.entity_id, depth + 1, nextSeen);
    }
  };

  pushBranch("", 0, new Set());
  return out;
}
