import type { CompanyExplorerFolderKind } from "../folders/companyExplorerFolders.js";

export type ExplorerSelectionState = {
  selectedNodeID: string;
  selectedLogicGateID: string;
  selectedFolderID: string;
  selectedFolderKind: CompanyExplorerFolderKind | undefined;
  selectedTreeID: string;
  selectedTreeIDs?: string[];
};

export function shouldBroadcastSelection(previous: ExplorerSelectionState, next: ExplorerSelectionState): boolean {
  return previous.selectedNodeID !== next.selectedNodeID
    || previous.selectedLogicGateID !== next.selectedLogicGateID
    || previous.selectedFolderID !== next.selectedFolderID
    || previous.selectedFolderKind !== next.selectedFolderKind
    || previous.selectedTreeID !== next.selectedTreeID
    || (previous.selectedTreeIDs ?? []).join("|") !== (next.selectedTreeIDs ?? []).join("|");
}

export function emptyExplorerSelectionState(): ExplorerSelectionState {
  return {
    selectedNodeID: "",
    selectedLogicGateID: "",
    selectedFolderID: "",
    selectedFolderKind: undefined,
    selectedTreeID: "",
    selectedTreeIDs: [],
  };
}
