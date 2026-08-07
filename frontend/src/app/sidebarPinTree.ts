import {
  type SidebarPin,
  type SidebarPinEntryRef,
  type SidebarPinFolder,
  type SidebarPinLayoutEntry,
  type SidebarPinTree,
} from "./sidebarPins.js";

export const SIDEBAR_PIN_POSITION_STEP = 1000;

export type SidebarPinTreeRow =
  | { entryType: "folder"; entryID: string; parentFolderID: string; depth: number; folder: SidebarPinFolder }
  | { entryType: "pin"; entryID: string; parentFolderID: string; depth: number; pin: SidebarPin };

export type SidebarPinTreeNode =
  | { entryType: "folder"; entryID: string; parentFolderID: string; depth: number; folder: SidebarPinFolder; children: SidebarPinTreeNode[] }
  | { entryType: "pin"; entryID: string; parentFolderID: string; depth: number; pin: SidebarPin };

export type SidebarPinDropPlacement = "before" | "after" | "inside";

export function emptySidebarPinTree(): SidebarPinTree {
  return { folders: [], pins: [] };
}

export function sortSidebarPinEntries<T extends { position: number; createdTimestamp: string }>(
  entries: Array<T & SidebarPinEntryRef>,
): Array<T & SidebarPinEntryRef> {
  return [...entries].sort((left, right) => (
    left.position - right.position
    || left.createdTimestamp.localeCompare(right.createdTimestamp)
    || left.entryType.localeCompare(right.entryType)
    || left.entryID.localeCompare(right.entryID)
  ));
}

export function buildSidebarPinTreeRows(tree: SidebarPinTree, expandedFolderIDs: ReadonlySet<string>): SidebarPinTreeRow[] {
  const rows: SidebarPinTreeRow[] = [];
  const append = (nodes: SidebarPinTreeNode[]) => {
    for (const node of nodes) {
      if (node.entryType === "folder") {
        const { children: _children, ...row } = node;
        rows.push(row);
        append(node.children);
      } else {
        rows.push(node);
      }
    }
  };
  append(buildSidebarPinTreeNodes(tree, expandedFolderIDs));
  return rows;
}

export function buildSidebarPinTreeNodes(tree: SidebarPinTree, expandedFolderIDs: ReadonlySet<string>): SidebarPinTreeNode[] {
  const foldersByParent = new Map<string, SidebarPinFolder[]>();
  const pinsByParent = new Map<string, SidebarPin[]>();
  for (const folder of tree.folders) {
    const items = foldersByParent.get(folder.parentFolderID) ?? [];
    items.push(folder);
    foldersByParent.set(folder.parentFolderID, items);
  }
  for (const pin of tree.pins) {
    const items = pinsByParent.get(pin.parentFolderID) ?? [];
    items.push(pin);
    pinsByParent.set(pin.parentFolderID, items);
  }

  const visited = new Set<string>();
  const visit = (parentFolderID: string, depth: number): SidebarPinTreeNode[] => {
    const entries = sortSidebarPinEntries([
      ...(foldersByParent.get(parentFolderID) ?? []).map((folder) => ({
        entryType: "folder" as const,
        entryID: folder.folderID,
        position: folder.position,
        createdTimestamp: folder.createdTimestamp,
        folder,
      })),
      ...(pinsByParent.get(parentFolderID) ?? []).map((pin) => ({
        entryType: "pin" as const,
        entryID: pin.pinID,
        position: pin.position,
        createdTimestamp: pin.createdTimestamp,
        pin,
      })),
    ]);
    const nodes: SidebarPinTreeNode[] = [];
    for (const entry of entries) {
      if (entry.entryType === "folder") {
        if (visited.has(entry.entryID)) continue;
        visited.add(entry.entryID);
        nodes.push({
          entryType: "folder",
          entryID: entry.entryID,
          parentFolderID,
          depth,
          folder: entry.folder,
          children: expandedFolderIDs.has(entry.entryID) ? visit(entry.entryID, depth + 1) : [],
        });
      } else {
        nodes.push({ entryType: "pin", entryID: entry.entryID, parentFolderID, depth, pin: entry.pin });
      }
    }
    return nodes;
  };
  return visit("", 0);
}

export function upsertSidebarPin(tree: SidebarPinTree, pin: SidebarPin): SidebarPinTree {
  const index = tree.pins.findIndex((item) => item.pinID === pin.pinID || (item.kind === pin.kind && item.id === pin.id));
  const pins = [...tree.pins];
  if (index >= 0) pins[index] = pin;
  else pins.push(pin);
  return { ...tree, pins };
}

export function upsertSidebarPinFolder(tree: SidebarPinTree, folder: SidebarPinFolder): SidebarPinTree {
  const index = tree.folders.findIndex((item) => item.folderID === folder.folderID);
  const folders = [...tree.folders];
  if (index >= 0) folders[index] = folder;
  else folders.push(folder);
  return { ...tree, folders };
}

export function removeSidebarPinFolderSubtree(tree: SidebarPinTree, folderID: string): SidebarPinTree {
  const removed = new Set<string>([folderID]);
  for (let changed = true; changed;) {
    changed = false;
    for (const folder of tree.folders) {
      if (removed.has(folder.folderID) || !removed.has(folder.parentFolderID)) continue;
      removed.add(folder.folderID);
      changed = true;
    }
  }
  return {
    folders: tree.folders.filter((folder) => !removed.has(folder.folderID)),
    pins: tree.pins.filter((pin) => !removed.has(pin.parentFolderID)),
  };
}

export function planSidebarPinMove(
  tree: SidebarPinTree,
  moving: SidebarPinEntryRef,
  target: SidebarPinEntryRef | null,
  placement: SidebarPinDropPlacement,
): { tree: SidebarPinTree; updates: SidebarPinLayoutEntry[] } {
  if (target && moving.entryType === target.entryType && moving.entryID === target.entryID) {
    return { tree, updates: [] };
  }
  const movingFolder = moving.entryType === "folder" ? tree.folders.find((folder) => folder.folderID === moving.entryID) : undefined;
  const movingPin = moving.entryType === "pin" ? tree.pins.find((pin) => pin.pinID === moving.entryID) : undefined;
  if (!movingFolder && !movingPin) return { tree, updates: [] };

  let destinationParentID = "";
  if (target) {
    const targetFolder = target.entryType === "folder" ? tree.folders.find((folder) => folder.folderID === target.entryID) : undefined;
    const targetPin = target.entryType === "pin" ? tree.pins.find((pin) => pin.pinID === target.entryID) : undefined;
    if (!targetFolder && !targetPin) return { tree, updates: [] };
    if (placement === "inside") {
      if (!targetFolder) return { tree, updates: [] };
      destinationParentID = targetFolder.folderID;
    } else {
      destinationParentID = targetFolder?.parentFolderID ?? targetPin?.parentFolderID ?? "";
    }
  }
  if (movingFolder && isSidebarPinFolderDescendant(tree.folders, movingFolder.folderID, destinationParentID)) {
    return { tree, updates: [] };
  }

  const siblings = siblingEntryRefs(tree, destinationParentID)
    .filter((entry) => entry.entryType !== moving.entryType || entry.entryID !== moving.entryID);
  let insertIndex = siblings.length;
  if (target && placement !== "inside") {
    const targetIndex = siblings.findIndex((entry) => entry.entryType === target.entryType && entry.entryID === target.entryID);
    if (targetIndex < 0) return { tree, updates: [] };
    insertIndex = placement === "after" ? targetIndex + 1 : targetIndex;
  }
  const ordered = [...siblings];
  ordered.splice(insertIndex, 0, moving);
  const updates = ordered.map((entry, index) => ({
    ...entry,
    parentFolderID: destinationParentID,
    position: (index + 1) * SIDEBAR_PIN_POSITION_STEP,
  }));
  const updateByKey = new Map(updates.map((entry) => [entryKey(entry), entry]));
  return {
    tree: {
      folders: tree.folders.map((folder) => {
        const update = updateByKey.get(entryKey({ entryType: "folder", entryID: folder.folderID }));
        return update ? { ...folder, parentFolderID: update.parentFolderID, position: update.position } : folder;
      }),
      pins: tree.pins.map((pin) => {
        const update = updateByKey.get(entryKey({ entryType: "pin", entryID: pin.pinID }));
        return update ? { ...pin, parentFolderID: update.parentFolderID, position: update.position } : pin;
      }),
    },
    updates,
  };
}

export function isSidebarPinFolderDescendant(folders: SidebarPinFolder[], ancestorFolderID: string, candidateFolderID: string): boolean {
  if (!ancestorFolderID || !candidateFolderID) return false;
  if (ancestorFolderID === candidateFolderID) return true;
  const parentByID = new Map(folders.map((folder) => [folder.folderID, folder.parentFolderID]));
  const visited = new Set<string>();
  for (let current = candidateFolderID; current && !visited.has(current); current = parentByID.get(current) ?? "") {
    if (current === ancestorFolderID) return true;
    visited.add(current);
  }
  return false;
}

function siblingEntryRefs(tree: SidebarPinTree, parentFolderID: string): SidebarPinEntryRef[] {
  return sortSidebarPinEntries([
    ...tree.folders.filter((folder) => folder.parentFolderID === parentFolderID).map((folder) => ({
      entryType: "folder" as const,
      entryID: folder.folderID,
      position: folder.position,
      createdTimestamp: folder.createdTimestamp,
    })),
    ...tree.pins.filter((pin) => pin.parentFolderID === parentFolderID).map((pin) => ({
      entryType: "pin" as const,
      entryID: pin.pinID,
      position: pin.position,
      createdTimestamp: pin.createdTimestamp,
    })),
  ]).map(({ entryType, entryID }) => ({ entryType, entryID }));
}

function entryKey(entry: SidebarPinEntryRef): string {
  return `${entry.entryType}:${entry.entryID}`;
}
