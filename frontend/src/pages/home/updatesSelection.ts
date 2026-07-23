export function resolveUpdateClickSelection(input: {
  orderedIDs: string[];
  previousSelectedIDs: Set<string>;
  anchorID: string;
  clickedID: string;
  shiftKey: boolean;
  ctrlKey: boolean;
}): { selectedIDs: Set<string>; anchorID: string } {
  const { orderedIDs, previousSelectedIDs, anchorID, clickedID, shiftKey, ctrlKey } = input;
  if (!clickedID) return { selectedIDs: new Set(previousSelectedIDs), anchorID };

  if (shiftKey && anchorID) {
    const anchorIndex = orderedIDs.indexOf(anchorID);
    const clickedIndex = orderedIDs.indexOf(clickedID);
    if (anchorIndex >= 0 && clickedIndex >= 0) {
      const start = Math.min(anchorIndex, clickedIndex);
      const end = Math.max(anchorIndex, clickedIndex);
      const selectedIDs = new Set(previousSelectedIDs);
      for (const id of orderedIDs.slice(start, end + 1)) selectedIDs.add(id);
      return { selectedIDs, anchorID };
    }
  }

  if (ctrlKey) {
    const selectedIDs = new Set(previousSelectedIDs);
    if (selectedIDs.has(clickedID)) selectedIDs.delete(clickedID);
    else selectedIDs.add(clickedID);
    return { selectedIDs, anchorID: clickedID };
  }

  return { selectedIDs: new Set([clickedID]), anchorID: clickedID };
}

export function orderedUpdateSelection(orderedIDs: string[], selectedIDs: Set<string>): string[] {
  return orderedIDs.filter((id) => selectedIDs.has(id));
}

export type UpdateSeenRow = {
  rowKey: string;
  notificationKey: string;
};

export function updateNotificationVisibleInView(
  item: { read_timestamp?: string },
  viewMode: "current" | "seen",
): boolean {
  return viewMode === "seen" ? Boolean(item.read_timestamp) : !item.read_timestamp;
}

export function updateSeenActionForView(viewMode: "current" | "seen"): {
  label: "Seen" | "Unsee";
  read: boolean;
} {
  return viewMode === "seen"
    ? { label: "Unsee", read: false }
    : { label: "Seen", read: true };
}

export function resolveUpdateSeenSuccessor(
  orderedRows: readonly UpdateSeenRow[],
  seenRowKey: string,
  hiddenNotificationKeys: ReadonlySet<string>,
): string {
  const seenIndex = orderedRows.findIndex((row) => row.rowKey === seenRowKey);
  if (seenIndex < 0) return "";
  return orderedRows
    .slice(seenIndex + 1)
    .find((row) => !hiddenNotificationKeys.has(row.notificationKey))
    ?.rowKey ?? "";
}

export function resolveUpdateSeenPresentation(
  orderedRows: readonly UpdateSeenRow[],
  seenRowKey: string,
  hiddenNotificationKeys: ReadonlySet<string>,
): { previewRowKey: string; successorRowKey: string } {
  const successorRowKey = resolveUpdateSeenSuccessor(orderedRows, seenRowKey, hiddenNotificationKeys);
  const clickedRowKey = orderedRows.some((row) => row.rowKey === seenRowKey) ? seenRowKey : "";
  return {
    previewRowKey: successorRowKey || clickedRowKey,
    successorRowKey,
  };
}

export function updatesNotificationEventRequiresReload(input: {
  activeCompanyID: string;
  eventCompanyID?: string;
  source?: string;
  localSeenSource: string;
}): boolean {
  const eventCompanyID = input.eventCompanyID?.trim() ?? "";
  if (eventCompanyID && eventCompanyID !== input.activeCompanyID.trim()) return false;
  const source = input.source?.trim() ?? "";
  return source !== input.localSeenSource.trim();
}
