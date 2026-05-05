// Explorer/Map selection sync helpers.
// Keep these pure so broadcast/echo behavior can be regression-tested without React wiring.

export type ExplorerSelectionState = {
  selectedNodeID: string;
  selectedLogicGateID?: string;
  selectedKanbanBoardID?: string;
  selectedFolderID?: string;
  selectedFolderKind?: string;
  selectedTreeID: string;
  selectedTreeIDs?: string[];
};

// Map-originated selection should only apply when it actually changes explorer state.
// This prevents arming "suppress next broadcast" logic for no-op echoes.
export function shouldApplyMapSelection(current: ExplorerSelectionState, nextNodeID: string): boolean {
  if (!nextNodeID) return false;
  const nextTreeID = `node-${nextNodeID}`;
  return current.selectedNodeID !== nextNodeID || current.selectedTreeID !== nextTreeID;
}

// Explorer should only broadcast semantic selection changes.
// This scopes event fan-out to real user-intent transitions and avoids churn.
export function shouldBroadcastSelection(previous: ExplorerSelectionState, next: ExplorerSelectionState): boolean {
  return previous.selectedNodeID !== next.selectedNodeID
    || (previous.selectedLogicGateID ?? "") !== (next.selectedLogicGateID ?? "")
    || (previous.selectedKanbanBoardID ?? "") !== (next.selectedKanbanBoardID ?? "")
    || (previous.selectedFolderID ?? "") !== (next.selectedFolderID ?? "")
    || (previous.selectedFolderKind ?? "") !== (next.selectedFolderKind ?? "")
    || previous.selectedTreeID !== next.selectedTreeID
    || (previous.selectedTreeIDs ?? []).join("\u001f") !== (next.selectedTreeIDs ?? []).join("\u001f");
}

// Map state is written through a small debounce, while selection events are
// dispatched immediately. If the event already carries the selected entity ID,
// using localStorage for sequence-gap recovery can reapply an older selection.
export function shouldReadMapStateForSelectionEvent(hasSequenceGap: boolean, hasEventSelection: boolean): boolean {
  return hasSequenceGap && !hasEventSelection;
}

export function shouldIgnoreSelfOriginatedMapSelection(sourceExplorerID: string | undefined, currentExplorerID: string): boolean {
  return !!sourceExplorerID && sourceExplorerID === currentExplorerID;
}
