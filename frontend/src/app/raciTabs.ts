export const RACI_TAB_ROLES = ["responsible", "accountable", "consulted", "informed"] as const;

export type RACITabRole = typeof RACI_TAB_ROLES[number];

export const RACI_TAB_LABELS: Record<RACITabRole, string> = {
  responsible: "Responsible",
  accountable: "Accountable",
  consulted: "Consulted",
  informed: "Informed",
};

export type RACITabStatusCounts = {
  request: number;
  pending: number;
  inProgress: number;
  review: number;
};

export type RACITabItem = {
  companyID: string;
  userID: string;
  role: RACITabRole;
  logicGateID: string;
  folderID: string;
  name: string;
  position: number;
  createdTimestamp: string;
  updatedTimestamp: string;
  statusCounts: RACITabStatusCounts;
};

export type RACITabFolder = {
  companyID: string;
  folderID: string;
  userID: string;
  role: RACITabRole;
  parentFolderID: string;
  name: string;
  position: number;
  createdTimestamp: string;
  updatedTimestamp: string;
  hasChildren: boolean;
  statusCounts: RACITabStatusCounts;
};

export type RACITabRow =
  | { rowKind: "folder"; folder: RACITabFolder }
  | { rowKind: "item"; item: RACITabItem };

export type RACITabBranch = {
  role: RACITabRole;
  parentFolderID: string;
  rows: RACITabRow[];
  statusCounts: RACITabStatusCounts;
  nextCursor: string;
};

export type RACITabEntryRef = {
  entryType: "folder" | "item";
  entryID: string;
};

export type RACITabLayoutEntry = RACITabEntryRef & {
  parentFolderID: string;
  position: number;
};

export type RACITabVisibleRow = {
  key: string;
  depth: number;
  row: RACITabRow;
};

export function raciTabBranchKey(role: RACITabRole, parentFolderID: string): string {
  return `${role}:${parentFolderID.trim() || "root"}`;
}

export function raciTabRowKey(row: RACITabRow): string {
  return row.rowKind === "folder" ? `folder:${row.folder.folderID}` : `item:${row.item.logicGateID}`;
}

export function raciTabRowRef(row: RACITabRow): RACITabEntryRef {
  return row.rowKind === "folder"
    ? { entryType: "folder", entryID: row.folder.folderID }
    : { entryType: "item", entryID: row.item.logicGateID };
}

export function emptyRACITabStatusCounts(): RACITabStatusCounts {
  return { request: 0, pending: 0, inProgress: 0, review: 0 };
}

export function addRACITabStatusCounts(left: RACITabStatusCounts, right: RACITabStatusCounts): RACITabStatusCounts {
  return {
    request: Math.max(0, left.request + right.request),
    pending: Math.max(0, left.pending + right.pending),
    inProgress: Math.max(0, left.inProgress + right.inProgress),
    review: Math.max(0, left.review + right.review),
  };
}

export function subtractRACITabStatusCounts(next: RACITabStatusCounts, previous: RACITabStatusCounts): RACITabStatusCounts {
  return {
    request: next.request - previous.request,
    pending: next.pending - previous.pending,
    inProgress: next.inProgress - previous.inProgress,
    review: next.review - previous.review,
  };
}

export function buildVisibleRACITabRows(
  role: RACITabRole,
  branches: Readonly<Record<string, RACITabBranch | undefined>>,
  expandedFolderIDs: ReadonlySet<string>,
): RACITabVisibleRow[] {
  const visible: RACITabVisibleRow[] = [];
  const append = (parentFolderID: string, depth: number, visited: Set<string>) => {
    const branch = branches[raciTabBranchKey(role, parentFolderID)];
    if (!branch) return;
    for (const row of branch.rows) {
      visible.push({ key: raciTabRowKey(row), depth, row });
      if (row.rowKind !== "folder" || !expandedFolderIDs.has(row.folder.folderID) || visited.has(row.folder.folderID)) continue;
      const nextVisited = new Set(visited);
      nextVisited.add(row.folder.folderID);
      append(row.folder.folderID, depth + 1, nextVisited);
    }
  };
  append("", 0, new Set());
  return visible;
}

export function resolveRACITabSelection(
  visibleKeys: string[],
  selectedKeys: ReadonlySet<string>,
  anchorKey: string,
  clickedKey: string,
  options: { toggle: boolean; range: boolean },
): { selectedKeys: Set<string>; anchorKey: string } {
  if (options.range && anchorKey) {
    const start = visibleKeys.indexOf(anchorKey);
    const end = visibleKeys.indexOf(clickedKey);
    if (start >= 0 && end >= 0) {
      const next = new Set(selectedKeys);
      for (let index = Math.min(start, end); index <= Math.max(start, end); index += 1) next.add(visibleKeys[index]);
      return { selectedKeys: next, anchorKey };
    }
  }
  if (options.toggle) {
    const next = new Set(selectedKeys);
    if (next.has(clickedKey)) next.delete(clickedKey);
    else next.add(clickedKey);
    return { selectedKeys: next, anchorKey: clickedKey };
  }
  return { selectedKeys: new Set([clickedKey]), anchorKey: clickedKey };
}

export function planRACITabDrop(
  role: RACITabRole,
  branches: Readonly<Record<string, RACITabBranch | undefined>>,
  moving: RACITabEntryRef[],
  target: RACITabEntryRef | null,
  placement: "inside" | "before" | "after",
): RACITabLayoutEntry[] {
  if (moving.length === 0) return [];
  const rowByKey = new Map<string, RACITabRow>();
  const parentByKey = new Map<string, string>();
  for (const branch of Object.values(branches)) {
    if (!branch || branch.role !== role) continue;
    for (const row of branch.rows) {
      const key = raciTabRowKey(row);
      rowByKey.set(key, row);
      parentByKey.set(key, branch.parentFolderID);
    }
  }
  const movingKeys = moving.map((entry) => `${entry.entryType}:${entry.entryID}`);
  if (moving.some((entry) => !rowByKey.has(`${entry.entryType}:${entry.entryID}`))) return [];
  const movingFolder = moving.find((entry) => entry.entryType === "folder");
  if (movingFolder && moving.length !== 1) return [];
  if (target && movingKeys.includes(`${target.entryType}:${target.entryID}`)) return [];

  let targetParentID = "";
  let insertionIndex = Number.MAX_SAFE_INTEGER;
  if (target) {
    const targetKey = `${target.entryType}:${target.entryID}`;
    const targetRow = rowByKey.get(targetKey);
    if (!targetRow) return [];
    if (placement === "inside") {
      if (target.entryType !== "folder") return [];
      targetParentID = target.entryID;
    } else {
      targetParentID = parentByKey.get(targetKey) ?? "";
      const targetBranch = branches[raciTabBranchKey(role, targetParentID)];
      const targetRows = (targetBranch?.rows ?? []).filter((row) => !movingKeys.includes(raciTabRowKey(row)));
      const targetIndex = targetRows.findIndex((row) => raciTabRowKey(row) === targetKey);
      if (targetIndex < 0) return [];
      insertionIndex = targetIndex + (placement === "after" ? 1 : 0);
    }
  }
  if (movingFolder && isRACITabFolderDescendant(branches, movingFolder.entryID, targetParentID)) return [];

  const affectedParents = new Set(movingKeys.map((key) => parentByKey.get(key) ?? ""));
  affectedParents.add(targetParentID);
  const updates: RACITabLayoutEntry[] = [];
  for (const parentFolderID of affectedParents) {
    const branchRows = [...(branches[raciTabBranchKey(role, parentFolderID)]?.rows ?? [])];
    const remaining = branchRows.filter((row) => !movingKeys.includes(raciTabRowKey(row)));
    if (parentFolderID === targetParentID) {
      const movingRows = movingKeys.map((key) => rowByKey.get(key)).filter((row): row is RACITabRow => !!row);
      const at = Math.min(insertionIndex, remaining.length);
      remaining.splice(at, 0, ...movingRows);
    }
    remaining.forEach((row, index) => updates.push({ ...raciTabRowRef(row), parentFolderID, position: (index + 1) * 1000 }));
  }
  return updates;
}

export function isRACITabFolderDescendant(
  branches: Readonly<Record<string, RACITabBranch | undefined>>,
  ancestorFolderID: string,
  candidateFolderID: string,
): boolean {
  if (!candidateFolderID) return false;
  if (ancestorFolderID === candidateFolderID) return true;
  const parents = new Map<string, string>();
  for (const branch of Object.values(branches)) {
    if (!branch) continue;
    for (const row of branch.rows) if (row.rowKind === "folder") parents.set(row.folder.folderID, row.folder.parentFolderID);
  }
  const visited = new Set<string>();
  for (let folderID = candidateFolderID; folderID && !visited.has(folderID); folderID = parents.get(folderID) ?? "") {
    if (folderID === ancestorFolderID) return true;
    visited.add(folderID);
  }
  return false;
}
