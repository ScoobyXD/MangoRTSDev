import type React from "react";
import { useEffect } from "react";
import { readFrameLinksFromStorage, readFrameRegistryFromStorage, resolveConnectedFrameTargets } from "../linkingGraph";
import { publishLiveSelection, readLiveSelectionForFrame, subscribeLiveSelection, type LiveSelectionChange, type SelectionIntent } from "../selectionCoordinator";
import type { CompanyExplorerFolderKind } from "../folders/companyExplorerFolders";
import { shouldBroadcastSelection, type ExplorerSelectionState } from "./selectionSync";
import { getExplorerSelectionDomain } from "./companyExplorerDragDrop";
import { resolveExplorerPublishedSelection, type ExplorerFindEntity } from "./treePresentation";
import type {
  CompanyExplorerFindRequestDetail,
  ExplorerSelectionDomain,
  ExplorerTreeNode,
} from "./companyExplorerTypes";
import { EVENT_COMPANY_EXPLORER_FIND_REQUESTED } from "../dashboardEvents";
import { nextLocalContextSequence } from "../contextSyncContract";

type LogicGateSelectionRef = React.MutableRefObject<{ selectedLogicGateID: string; selectedTreeID: string }>;
type LocalExplorerSelectionRef = React.MutableRefObject<{ domain: ExplorerSelectionDomain; changedAt: number }>;

type UseCompanyExplorerSelectionBridgeInput = {
  companyID: string;
  scope: string;
  selectedNodeID: string;
  selectedLogicGateID: string;
  selectedKanbanBoardID: string;
  selectedFolderID: string;
  selectedFolderKind: CompanyExplorerFolderKind | undefined;
  selectedFolderLabel: string;
  selectedKanbanBoardLabel: string;
  selectedTreeID: string;
  selectedTreeIDs: Set<string>;
  selectedTree: ExplorerTreeNode | undefined;
  selectionTargetFrameIDs?: string[];
  suppressNextExplorerBroadcastRef: React.MutableRefObject<boolean>;
  previousBroadcastSelectionRef: React.MutableRefObject<ExplorerSelectionState>;
  latestSelectionRef: React.MutableRefObject<ExplorerSelectionState>;
  latestLogicGateSelectionRef: LogicGateSelectionRef;
  latestExplorerDomainRef: React.MutableRefObject<ExplorerSelectionDomain>;
  lastLocalExplorerSelectionRef: LocalExplorerSelectionRef;
  pendingExplorerSelectionIntentRef: React.MutableRefObject<SelectionIntent>;
  explorerContextSequenceRef: React.MutableRefObject<number>;
  setSelectedTreeID: React.Dispatch<React.SetStateAction<string>>;
  setSelectedTreeIDs: React.Dispatch<React.SetStateAction<Set<string>>>;
  setSelectionAnchorTreeID: React.Dispatch<React.SetStateAction<string>>;
  setSelectedNodeID: React.Dispatch<React.SetStateAction<string>>;
  setSelectedLogicGateID: React.Dispatch<React.SetStateAction<string>>;
  setSelectedKanbanBoardID: React.Dispatch<React.SetStateAction<string>>;
  expandTreeIDs: (treeIDs: string[]) => void;
  applyExplorerPathSelection: (folderPathIDs: string[], selectRoot: boolean) => void;
  applyExplorerFindSelection: (entities: ExplorerFindEntity[]) => void;
};

export function useCompanyExplorerSelectionBridge({
  companyID,
  scope,
  selectedNodeID,
  selectedLogicGateID,
  selectedKanbanBoardID,
  selectedFolderID,
  selectedFolderKind,
  selectedFolderLabel,
  selectedKanbanBoardLabel,
  selectedTreeID,
  selectedTreeIDs,
  selectedTree,
  selectionTargetFrameIDs = [],
  suppressNextExplorerBroadcastRef,
  previousBroadcastSelectionRef,
  latestSelectionRef,
  latestLogicGateSelectionRef,
  latestExplorerDomainRef,
  lastLocalExplorerSelectionRef,
  pendingExplorerSelectionIntentRef,
  explorerContextSequenceRef,
  setSelectedTreeID,
  setSelectedTreeIDs,
  setSelectionAnchorTreeID,
  setSelectedNodeID,
  setSelectedLogicGateID,
  setSelectedKanbanBoardID,
  expandTreeIDs,
  applyExplorerPathSelection,
  applyExplorerFindSelection,
}: UseCompanyExplorerSelectionBridgeInput) {
  useEffect(() => {
    const applyLiveSelection = (selection: LiveSelectionChange) => {
      if (selection.companyID !== companyID || selection.sourceFrameID === scope) return;
      const localSelection = lastLocalExplorerSelectionRef.current;
      if (localSelection.changedAt > 0 && selection.changedAt > 0 && selection.changedAt < localSelection.changedAt) return;

      const applyTreeSelection = (treeID: string, treeIDs: string[] = [treeID]) => {
        const cleanTreeIDs = Array.from(new Set(treeIDs.map((id) => id.trim()).filter(Boolean)));
        if (treeID && cleanTreeIDs.length === 0) cleanTreeIDs.push(treeID);
        setSelectedTreeID(treeID);
        setSelectedTreeIDs(new Set(cleanTreeIDs));
        setSelectionAnchorTreeID(treeID);
        expandTreeIDs(cleanTreeIDs);
      };

      suppressNextExplorerBroadcastRef.current = true;
      if (selection.entityKind === "folder") {
        const treeID = selection.selectedTreeID || (selection.folderID || selection.entityID ? `workspace-folder-${selection.folderID || selection.entityID}` : "folder-root");
        setSelectedNodeID("");
        setSelectedLogicGateID("");
        setSelectedKanbanBoardID("");
        applyTreeSelection(treeID, selection.selectedTreeIDs);
        return;
      }
      if (selection.entityKind === "node") {
        const treeID = selection.selectedTreeID || (selection.entityID ? `node-${selection.entityID}` : "folder-root");
        setSelectedNodeID(selection.entityID);
        setSelectedLogicGateID("");
        setSelectedKanbanBoardID("");
        const treeIDs = selection.selectedTreeIDs?.length
          ? selection.selectedTreeIDs
          : (selection.selectedEntityIDs?.length ? selection.selectedEntityIDs : selection.entityID ? [selection.entityID] : []).map((id) => `node-${id}`);
        applyTreeSelection(treeID, treeIDs);
        return;
      }
      if (selection.entityKind === "logic_gate") {
        const treeID = selection.selectedTreeID || (selection.entityID ? `logic-gate-${selection.entityID}` : "folder-root");
        setSelectedLogicGateID(selection.entityID);
        setSelectedNodeID("");
        setSelectedKanbanBoardID("");
        applyTreeSelection(treeID, selection.selectedTreeIDs?.length ? selection.selectedTreeIDs : selection.entityID ? [treeID] : []);
        return;
      }
      if (selection.entityKind === "kanban") {
        const boardID = selection.entityID.trim();
        if (!boardID) return;
        const treeID = selection.selectedTreeID || `kanban-${boardID}`;
        setSelectedKanbanBoardID(boardID);
        setSelectedNodeID("");
        setSelectedLogicGateID("");
        applyTreeSelection(treeID, selection.selectedTreeIDs?.length ? selection.selectedTreeIDs : [treeID]);
      }
    };

    const liveSelection = readLiveSelectionForFrame(companyID, scope);
    if (liveSelection) applyLiveSelection(liveSelection);
    return subscribeLiveSelection(scope, applyLiveSelection);
  }, [
    companyID,
    expandTreeIDs,
    lastLocalExplorerSelectionRef,
    scope,
    setSelectedKanbanBoardID,
    setSelectedLogicGateID,
    setSelectedNodeID,
    setSelectedTreeID,
    setSelectedTreeIDs,
    setSelectionAnchorTreeID,
    suppressNextExplorerBroadcastRef,
  ]);

  useEffect(() => {
    const onFindRequested = (event: Event) => {
      const detail = (event as CustomEvent<CompanyExplorerFindRequestDetail>).detail;
      if (!detail || (detail.companyID && detail.companyID !== companyID) || detail.sourceFrameID === scope) return;
      const targetFrameIDs = Array.isArray(detail.targetFrameIDs) ? detail.targetFrameIDs : [];
      if (targetFrameIDs.length > 0 && !targetFrameIDs.includes(scope)) return;
      const requestedFolders = (detail.folderPathIDs ?? []).map((id) => id.trim()).filter(Boolean);
      if (detail.selectRoot || requestedFolders.length > 0) {
        applyExplorerPathSelection(requestedFolders, detail.selectRoot === true);
        return;
      }
      const entities = (detail.entities ?? []).filter((entity): entity is ExplorerFindEntity => (
        (entity.kind === "node" || entity.kind === "logic_gate" || entity.kind === "project") && Boolean(entity.id)
      ));
      if (entities.length > 0) applyExplorerFindSelection(entities);
    };
    window.addEventListener(EVENT_COMPANY_EXPLORER_FIND_REQUESTED, onFindRequested);
    return () => window.removeEventListener(EVENT_COMPANY_EXPLORER_FIND_REQUESTED, onFindRequested);
  }, [applyExplorerFindSelection, applyExplorerPathSelection, companyID, scope]);

  useEffect(() => {
    const nextSelection: ExplorerSelectionState = {
      selectedNodeID,
      selectedLogicGateID,
      selectedKanbanBoardID,
      selectedFolderID,
      selectedFolderKind,
      selectedTreeID,
      selectedTreeIDs: Array.from(selectedTreeIDs),
    };
    if (!shouldBroadcastSelection(previousBroadcastSelectionRef.current, nextSelection)) return;
    previousBroadcastSelectionRef.current = nextSelection;
    if (suppressNextExplorerBroadcastRef.current) {
      suppressNextExplorerBroadcastRef.current = false;
      return;
    }

    const edges = readFrameLinksFromStorage();
    const registry = readFrameRegistryFromStorage();
    const targetIDs = new Set(resolveConnectedFrameTargets({ sourceFrameID: scope, edges, registry }));
    for (const targetFrameID of selectionTargetFrameIDs) {
      const cleanTargetFrameID = targetFrameID.trim();
      if (cleanTargetFrameID && cleanTargetFrameID !== scope) targetIDs.add(cleanTargetFrameID);
    }
    if (targetIDs.size === 0) return;

    const changedAt = Date.now();
    explorerContextSequenceRef.current = nextLocalContextSequence(`explorer_selection:${companyID}:${scope}`, changedAt);
    const publishedSelection = resolveExplorerPublishedSelection({
      selectedTreeID,
      selectedNodeID,
      selectedLogicGateID,
      selectedKanbanBoardID,
      selectedFolderID,
      selectedFolderKind,
    });
    const selectedEntityIDs = Array.from(selectedTreeIDs).map((treeID) => {
      if (publishedSelection.entityKind === "node" && treeID.startsWith("node-")) return treeID.slice("node-".length);
      if (publishedSelection.entityKind === "logic_gate" && treeID.startsWith("logic-gate-")) return treeID.slice("logic-gate-".length);
      if (publishedSelection.entityKind === "kanban" && treeID.startsWith("kanban-")) return treeID.slice("kanban-".length);
      return "";
    }).filter(Boolean);

    publishLiveSelection({
      companyID,
      entityKind: publishedSelection.entityKind,
      entityID: publishedSelection.entityID,
      label: selectedTree?.label || selectedKanbanBoardLabel || "",
      sourceFrameID: scope,
      sourceModule: "company-explorer",
      targetFrameIDs: Array.from(targetIDs),
      selectedTreeID,
      selectedTreeIDs: Array.from(selectedTreeIDs),
      selectedEntityIDs,
      folderKind: selectedFolderKind,
      folderID: selectedFolderID,
      folderLabel: selectedFolderLabel,
      changedAt,
      sequence: explorerContextSequenceRef.current,
      selectionIntent: pendingExplorerSelectionIntentRef.current,
    });
  }, [
    companyID,
    explorerContextSequenceRef,
    pendingExplorerSelectionIntentRef,
    previousBroadcastSelectionRef,
    scope,
    selectedFolderID,
    selectedFolderKind,
    selectedFolderLabel,
    selectedKanbanBoardID,
    selectedKanbanBoardLabel,
    selectedLogicGateID,
    selectedNodeID,
    selectionTargetFrameIDs,
    selectedTree,
    selectedTreeID,
    selectedTreeIDs,
    suppressNextExplorerBroadcastRef,
  ]);

  useEffect(() => {
    latestExplorerDomainRef.current = getExplorerSelectionDomain(selectedTree);
  }, [latestExplorerDomainRef, selectedTree]);

  useEffect(() => {
    latestSelectionRef.current = {
      selectedNodeID,
      selectedLogicGateID,
      selectedKanbanBoardID,
      selectedFolderID,
      selectedFolderKind,
      selectedTreeID,
      selectedTreeIDs: Array.from(selectedTreeIDs),
    };
    latestLogicGateSelectionRef.current = { selectedLogicGateID, selectedTreeID };
  }, [
    latestLogicGateSelectionRef,
    latestSelectionRef,
    selectedFolderID,
    selectedFolderKind,
    selectedKanbanBoardID,
    selectedLogicGateID,
    selectedNodeID,
    selectedTreeID,
    selectedTreeIDs,
  ]);
}
