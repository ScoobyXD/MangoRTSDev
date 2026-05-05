import type React from "react";
import { useEffect } from "react";
import { LOGIC_GATE_MAP_EXPLORER_CONTEXT_KEY_PREFIX } from "../logic-gate-map/shared";
import {
  emitDashboardEvent,
  EVENT_COMPANY_EXPLORER_FIND_REQUESTED,
  EVENT_EXPLORER_CONTEXT_UPDATED,
  EVENT_FRAME_LINK_GRAPH_UPDATED,
  EVENT_LOGIC_GATE_MAP_SELECTION_UPDATED,
  EVENT_NODE_MAP_SELECTION_UPDATED,
} from "../node-map/eventbus";
import { NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX } from "../node-map/shared";
import { hasSequenceGap, isNewerSequence, readIncomingSequence, type ContextMutationEnvelope } from "../contextSyncContract";
import { classifyFrameKind, FRAME_LINKS_KEY, FRAME_REGISTRY_KEY, readFrameLinksFromStorage, readFrameRegistryFromStorage, resolveConnectedFrameTargets, resolveLinkedFrameByKindFromGraph } from "../linkingGraph";
import { publishLiveSelection, readLiveSelectionForFrame, subscribeLiveSelection, type LiveSelectionChange, type SelectionIntent } from "../selectionCoordinator";
import type { CompanyExplorerFolderKind } from "../folders/companyExplorerFolders";
import { shouldApplyMapSelection, shouldBroadcastSelection, shouldIgnoreSelfOriginatedMapSelection, shouldReadMapStateForSelectionEvent, type ExplorerSelectionState } from "./explorerSync";
import { getExplorerSelectionDomain } from "./companyExplorerDragDrop";
import {
  resolveExplorerPublishedSelection,
  shouldAcceptMapSelectionAfterExplorerSelection,
  type ExplorerFindEntity,
} from "./treePresentation";
import type {
  CompanyExplorerFindRequestDetail,
  ExplorerSelectionDomain,
  ExplorerTreeNode,
} from "./companyExplorerTypes";

type LogicGateSelectionRef = React.MutableRefObject<{ selectedLogicGateID: string; selectedTreeID: string }>;
type LocalExplorerSelectionRef = React.MutableRefObject<{ domain: ExplorerSelectionDomain; changedAt: number }>;

type UseCompanyExplorerSelectionBridgeInput = {
  companyID: string;
  scope: string;
  linkedMapFrameID: string;
  linkedLogicMapFrameID: string;
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
  linkRevision: number;
  lastMapSelectionRevisionRef: React.MutableRefObject<number>;
  lastLogicMapSelectionRevisionRef: React.MutableRefObject<number>;
  suppressNextExplorerBroadcastRef: React.MutableRefObject<boolean>;
  previousBroadcastSelectionRef: React.MutableRefObject<ExplorerSelectionState>;
  latestSelectionRef: React.MutableRefObject<ExplorerSelectionState>;
  latestLogicGateSelectionRef: LogicGateSelectionRef;
  latestExplorerDomainRef: React.MutableRefObject<ExplorerSelectionDomain>;
  lastLocalExplorerSelectionRef: LocalExplorerSelectionRef;
  pendingExplorerSelectionIntentRef: React.MutableRefObject<SelectionIntent>;
  explorerContextSequenceRef: React.MutableRefObject<number>;
  setLinkedMapFrameID: React.Dispatch<React.SetStateAction<string>>;
  setLinkedLogicMapFrameID: React.Dispatch<React.SetStateAction<string>>;
  setLinkRevision: React.Dispatch<React.SetStateAction<number>>;
  setSelectedTreeID: React.Dispatch<React.SetStateAction<string>>;
  setSelectedTreeIDs: React.Dispatch<React.SetStateAction<Set<string>>>;
  setSelectionAnchorTreeID: React.Dispatch<React.SetStateAction<string>>;
  setSelectedNodeID: React.Dispatch<React.SetStateAction<string>>;
  setSelectedLogicGateID: React.Dispatch<React.SetStateAction<string>>;
  setSelectedKanbanBoardID: React.Dispatch<React.SetStateAction<string>>;
  expandTreeIDs: (treeIDs: string[]) => void;
  applyExplorerFindSelection: (entities: ExplorerFindEntity[]) => void;
};

export function useCompanyExplorerSelectionBridge({
  companyID,
  scope,
  linkedMapFrameID,
  linkedLogicMapFrameID,
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
  linkRevision,
  lastMapSelectionRevisionRef,
  lastLogicMapSelectionRevisionRef,
  suppressNextExplorerBroadcastRef,
  previousBroadcastSelectionRef,
  latestSelectionRef,
  latestLogicGateSelectionRef,
  latestExplorerDomainRef,
  lastLocalExplorerSelectionRef,
  pendingExplorerSelectionIntentRef,
  explorerContextSequenceRef,
  setLinkedMapFrameID,
  setLinkedLogicMapFrameID,
  setLinkRevision,
  setSelectedTreeID,
  setSelectedTreeIDs,
  setSelectionAnchorTreeID,
  setSelectedNodeID,
  setSelectedLogicGateID,
  setSelectedKanbanBoardID,
  expandTreeIDs,
  applyExplorerFindSelection,
}: UseCompanyExplorerSelectionBridgeInput) {
  useEffect(() => {
    const refreshLinkedMap = () => {
      const edges = readFrameLinksFromStorage();
      const registry = readFrameRegistryFromStorage();
      setLinkedMapFrameID(resolveLinkedFrameByKindFromGraph({
        startFrameID: scope,
        targetKind: "map",
        edges,
        registry,
      }));
      setLinkedLogicMapFrameID(resolveLinkedFrameByKindFromGraph({
        startFrameID: scope,
        targetKind: "logic-map",
        edges,
        registry,
      }));
    };
    refreshLinkedMap();
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== FRAME_LINKS_KEY && event.key !== FRAME_REGISTRY_KEY) return;
      refreshLinkedMap();
    };
    const onGraphUpdated = () => refreshLinkedMap();
    window.addEventListener("storage", onStorage);
    window.addEventListener(EVENT_FRAME_LINK_GRAPH_UPDATED, onGraphUpdated);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EVENT_FRAME_LINK_GRAPH_UPDATED, onGraphUpdated);
    };
  }, [scope, setLinkedLogicMapFrameID, setLinkedMapFrameID]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== FRAME_LINKS_KEY) return;
      setLinkRevision((value) => value + 1);
    };
    const onGraphUpdated = () => setLinkRevision((value) => value + 1);
    window.addEventListener("storage", onStorage);
    window.addEventListener(EVENT_FRAME_LINK_GRAPH_UPDATED, onGraphUpdated);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EVENT_FRAME_LINK_GRAPH_UPDATED, onGraphUpdated);
    };
  }, [setLinkRevision]);

  useEffect(() => {
    const applyLiveSelection = (selection: LiveSelectionChange) => {
      if (selection.companyID !== companyID || selection.sourceFrameID === scope) return;

      const applyTreeSelection = (treeID: string, treeIDs: string[] = [treeID]) => {
        const cleanTreeIDs = Array.from(new Set(treeIDs.map((id) => id.trim()).filter(Boolean)));
        if (cleanTreeIDs.length === 0) cleanTreeIDs.push(treeID);
        setSelectedTreeID(treeID);
        setSelectedTreeIDs(new Set(cleanTreeIDs));
        setSelectionAnchorTreeID(treeID);
        expandTreeIDs(cleanTreeIDs);
      };

      if (selection.entityKind === "folder") {
        suppressNextExplorerBroadcastRef.current = true;
        const treeID = selection.selectedTreeID || (selection.folderID || selection.entityID ? `workspace-folder-${selection.folderID || selection.entityID}` : "folder-root");
        setSelectedNodeID("");
        setSelectedLogicGateID("");
        setSelectedKanbanBoardID("");
        applyTreeSelection(treeID);
        return;
      }

      if (selection.entityKind === "node") {
        if (!selection.entityID) {
          suppressNextExplorerBroadcastRef.current = true;
          setSelectedNodeID("");
          setSelectedLogicGateID("");
          setSelectedKanbanBoardID("");
          applyTreeSelection(selection.selectedTreeID || "folder-root");
          return;
        }
        const localSelection = lastLocalExplorerSelectionRef.current;
        if (!shouldAcceptMapSelectionAfterExplorerSelection({
          incomingDomain: "node",
          currentDomain: latestExplorerDomainRef.current,
          localSelectionChangedAt: localSelection.changedAt,
          incomingChangedAt: selection.changedAt,
          now: Date.now(),
        })) return;
        const nextTreeID = selection.selectedTreeID || `node-${selection.entityID}`;
        const current = latestSelectionRef.current;
        if (current.selectedNodeID === selection.entityID && current.selectedTreeID === nextTreeID) return;
        suppressNextExplorerBroadcastRef.current = true;
        setSelectedNodeID(selection.entityID);
        setSelectedLogicGateID("");
        setSelectedKanbanBoardID("");
        const selectedNodeTreeIDs = (selection.selectedEntityIDs?.length ? selection.selectedEntityIDs : [selection.entityID]).map((id) => `node-${id}`);
        applyTreeSelection(nextTreeID, selection.selectedTreeIDs?.length ? selection.selectedTreeIDs : selectedNodeTreeIDs);
        return;
      }

      if (selection.entityKind === "logic_gate") {
        if (!selection.entityID) {
          suppressNextExplorerBroadcastRef.current = true;
          setSelectedLogicGateID("");
          setSelectedNodeID("");
          setSelectedKanbanBoardID("");
          applyTreeSelection(selection.selectedTreeID || "folder-root");
          return;
        }
        const localSelection = lastLocalExplorerSelectionRef.current;
        if (!shouldAcceptMapSelectionAfterExplorerSelection({
          incomingDomain: "logic_gate",
          currentDomain: latestExplorerDomainRef.current,
          localSelectionChangedAt: localSelection.changedAt,
          incomingChangedAt: selection.changedAt,
          now: Date.now(),
        })) return;
        const nextTreeID = selection.selectedTreeID || `logic-gate-${selection.entityID}`;
        const current = latestLogicGateSelectionRef.current;
        if (current.selectedLogicGateID === selection.entityID && current.selectedTreeID === nextTreeID) return;
        suppressNextExplorerBroadcastRef.current = true;
        setSelectedLogicGateID(selection.entityID);
        setSelectedNodeID("");
        setSelectedKanbanBoardID("");
        applyTreeSelection(nextTreeID, selection.selectedTreeIDs?.length ? selection.selectedTreeIDs : [`logic-gate-${selection.entityID}`]);
        return;
      }

      if (selection.entityKind === "kanban") {
        const boardID = selection.entityID.trim();
        if (!boardID) return;
        const nextTreeID = selection.selectedTreeID || `kanban-${boardID}`;
        suppressNextExplorerBroadcastRef.current = true;
        setSelectedKanbanBoardID(boardID);
        setSelectedNodeID("");
        setSelectedLogicGateID("");
        applyTreeSelection(nextTreeID, selection.selectedTreeIDs?.length ? selection.selectedTreeIDs : [nextTreeID]);
      }
    };

    const liveSelection = readLiveSelectionForFrame(companyID, scope);
    if (liveSelection) applyLiveSelection(liveSelection);
    return subscribeLiveSelection(scope, applyLiveSelection);
  }, [
    companyID,
    expandTreeIDs,
    lastLocalExplorerSelectionRef,
    latestExplorerDomainRef,
    latestLogicGateSelectionRef,
    latestSelectionRef,
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
      if (!detail || (detail.companyID && detail.companyID !== companyID)) return;
      if (detail.sourceFrameID === scope) return;
      const targetFrameIDs = Array.isArray(detail.targetFrameIDs) ? detail.targetFrameIDs : [];
      if (targetFrameIDs.length > 0 && !targetFrameIDs.includes(scope)) return;

      const entities: ExplorerFindEntity[] = [];
      for (const entity of detail.entities ?? []) {
        if ((entity.kind !== "node" && entity.kind !== "logic_gate") || !entity.id) continue;
        entities.push({ kind: entity.kind, id: entity.id });
      }
      if (entities.length === 0) return;
      applyExplorerFindSelection(entities);
    };

    window.addEventListener(EVENT_COMPANY_EXPLORER_FIND_REQUESTED, onFindRequested);
    return () => window.removeEventListener(EVENT_COMPANY_EXPLORER_FIND_REQUESTED, onFindRequested);
  }, [applyExplorerFindSelection, companyID, scope]);

  useEffect(() => {
    const applyMapSelection = (selectedFromMap: string, changedAt?: number) => {
      const current = latestSelectionRef.current;
      const localSelection = lastLocalExplorerSelectionRef.current;
      if (!shouldAcceptMapSelectionAfterExplorerSelection({
        incomingDomain: "node",
        currentDomain: latestExplorerDomainRef.current,
        localSelectionChangedAt: localSelection.changedAt,
        incomingChangedAt: changedAt,
        now: Date.now(),
      })) return;
      if (!shouldApplyMapSelection(current, selectedFromMap)) return;
      suppressNextExplorerBroadcastRef.current = true;
      setSelectedNodeID(selectedFromMap);
      setSelectedLogicGateID("");
      setSelectedKanbanBoardID("");
      const nextTreeID = `node-${selectedFromMap}`;
      setSelectedTreeID(nextTreeID);
      setSelectedTreeIDs(new Set([nextTreeID]));
      setSelectionAnchorTreeID(nextTreeID);
      expandTreeIDs([nextTreeID]);
    };
    const readFromMapState = () => {
      if (!linkedMapFrameID) return;
      const mapStateKey = `node-map-state-v1:${companyID}:${linkedMapFrameID}`;
      try {
        const raw = localStorage.getItem(mapStateKey);
        if (!raw) return;
        const parsed = JSON.parse(raw) as { selectedNodeID?: string };
        if (typeof parsed.selectedNodeID === "string") applyMapSelection(parsed.selectedNodeID);
      } catch {
        // ignore malformed map state payload
      }
    };
    readFromMapState();
    const onMapSelectionUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ mapWidgetID?: string; selectedNodeID?: string; revision?: number; changedAt?: number; sourceExplorerID?: string; envelope?: ContextMutationEnvelope }>).detail;
      if (!detail || detail.mapWidgetID !== linkedMapFrameID) return;
      const revision = readIncomingSequence(detail);
      if (revision > 0 && !isNewerSequence(lastMapSelectionRevisionRef.current, revision)) return;
      if (shouldIgnoreSelfOriginatedMapSelection(detail.sourceExplorerID, scope)) {
        if (revision > 0) lastMapSelectionRevisionRef.current = revision;
        return;
      }
      const eventSelectedNodeID = typeof detail.selectedNodeID === "string" ? detail.selectedNodeID : "";
      const eventHasSelection = typeof detail.selectedNodeID === "string";
      if (revision > 0 && shouldReadMapStateForSelectionEvent(hasSequenceGap(lastMapSelectionRevisionRef.current, revision), eventHasSelection)) readFromMapState();
      if (revision > 0) lastMapSelectionRevisionRef.current = revision;
      if (!eventHasSelection) return;
      applyMapSelection(eventSelectedNodeID, detail.changedAt);
    };
    window.addEventListener(EVENT_NODE_MAP_SELECTION_UPDATED, onMapSelectionUpdated);
    return () => {
      window.removeEventListener(EVENT_NODE_MAP_SELECTION_UPDATED, onMapSelectionUpdated);
    };
  }, [
    companyID,
    expandTreeIDs,
    lastLocalExplorerSelectionRef,
    lastMapSelectionRevisionRef,
    latestExplorerDomainRef,
    latestSelectionRef,
    linkedMapFrameID,
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
    const applyLogicGateMapSelection = (selectedFromMap: string, changedAt?: number) => {
      if (!selectedFromMap) return;
      const localSelection = lastLocalExplorerSelectionRef.current;
      if (!shouldAcceptMapSelectionAfterExplorerSelection({
        incomingDomain: "logic_gate",
        currentDomain: latestExplorerDomainRef.current,
        localSelectionChangedAt: localSelection.changedAt,
        incomingChangedAt: changedAt,
        now: Date.now(),
      })) return;
      const nextTreeID = `logic-gate-${selectedFromMap}`;
      const current = latestLogicGateSelectionRef.current;
      if (current.selectedLogicGateID === selectedFromMap && current.selectedTreeID === nextTreeID) return;
      suppressNextExplorerBroadcastRef.current = true;
      setSelectedLogicGateID(selectedFromMap);
      setSelectedNodeID("");
      setSelectedKanbanBoardID("");
      setSelectedTreeID(nextTreeID);
      setSelectedTreeIDs(new Set([nextTreeID]));
      setSelectionAnchorTreeID(nextTreeID);
      expandTreeIDs([nextTreeID]);
    };
    const readFromLogicMapState = () => {
      const logicContextFrameID = linkedLogicMapFrameID || linkedMapFrameID;
      if (!logicContextFrameID) return;
      const mapStateKey = `logic-gate-map-state-v1:${companyID}:${logicContextFrameID}`;
      try {
        const raw = localStorage.getItem(mapStateKey);
        if (!raw) return;
        const parsed = JSON.parse(raw) as { selectedNodeID?: string; selectedLogicGateID?: string };
        const selected = typeof parsed.selectedLogicGateID === "string" ? parsed.selectedLogicGateID : parsed.selectedNodeID;
        if (typeof selected === "string") applyLogicGateMapSelection(selected);
      } catch {
        // ignore malformed logic-gate map state payload
      }
    };
    readFromLogicMapState();
    const onLogicMapSelectionUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ mapWidgetID?: string; selectedNodeID?: string; selectedLogicGateID?: string; revision?: number; changedAt?: number; sourceExplorerID?: string; envelope?: ContextMutationEnvelope }>).detail;
      const logicContextFrameID = linkedLogicMapFrameID || linkedMapFrameID;
      if (!detail || detail.mapWidgetID !== logicContextFrameID) return;
      const revision = readIncomingSequence(detail);
      if (revision > 0 && !isNewerSequence(lastLogicMapSelectionRevisionRef.current, revision)) return;
      if (shouldIgnoreSelfOriginatedMapSelection(detail.sourceExplorerID, scope)) {
        if (revision > 0) lastLogicMapSelectionRevisionRef.current = revision;
        return;
      }
      const selected = typeof detail.selectedLogicGateID === "string" ? detail.selectedLogicGateID : detail.selectedNodeID;
      const eventHasSelection = typeof selected === "string";
      if (revision > 0 && shouldReadMapStateForSelectionEvent(hasSequenceGap(lastLogicMapSelectionRevisionRef.current, revision), eventHasSelection)) readFromLogicMapState();
      if (revision > 0) lastLogicMapSelectionRevisionRef.current = revision;
      if (!eventHasSelection) return;
      applyLogicGateMapSelection(selected, detail.changedAt);
    };
    window.addEventListener(EVENT_LOGIC_GATE_MAP_SELECTION_UPDATED, onLogicMapSelectionUpdated);
    return () => {
      window.removeEventListener(EVENT_LOGIC_GATE_MAP_SELECTION_UPDATED, onLogicMapSelectionUpdated);
    };
  }, [
    companyID,
    expandTreeIDs,
    lastLocalExplorerSelectionRef,
    lastLogicMapSelectionRevisionRef,
    latestExplorerDomainRef,
    latestLogicGateSelectionRef,
    linkedLogicMapFrameID,
    linkedMapFrameID,
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
    // Other modules can target the Explorer with node context. This lets a
    // linked Kanban card click highlight the matching Explorer row without a
    // special Kanban-only event bus.
    const applyTargetedExplorerSelection = (selectedFromContext: string) => {
      if (!selectedFromContext) return;
      const nextTreeID = `node-${selectedFromContext}`;
      const current = latestSelectionRef.current;
      if (current.selectedNodeID === selectedFromContext && current.selectedTreeID === nextTreeID) return;
      setSelectedNodeID(selectedFromContext);
      setSelectedLogicGateID("");
      setSelectedKanbanBoardID("");
      setSelectedTreeID(nextTreeID);
      setSelectedTreeIDs(new Set([nextTreeID]));
      setSelectionAnchorTreeID(nextTreeID);
      expandTreeIDs([nextTreeID]);
    };
    const readTargetedExplorerContext = () => {
      const key = `${NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${scope}`;
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return;
        const parsed = JSON.parse(raw) as { selectedNodeID?: unknown };
        if (typeof parsed.selectedNodeID === "string") applyTargetedExplorerSelection(parsed.selectedNodeID);
      } catch {
        // ignore malformed cross-module context payloads
      }
    };
    readTargetedExplorerContext();
  }, [
    companyID,
    expandTreeIDs,
    latestSelectionRef,
    scope,
    setSelectedKanbanBoardID,
    setSelectedLogicGateID,
    setSelectedNodeID,
    setSelectedTreeID,
    setSelectedTreeIDs,
    setSelectionAnchorTreeID,
  ]);

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
    try {
      const graph = readFrameLinksFromStorage();
      const registry = readFrameRegistryFromStorage();
      const targetIDs = new Set(resolveConnectedFrameTargets({ sourceFrameID: scope, edges: graph, registry }));
      if (targetIDs.size === 0) return;

      explorerContextSequenceRef.current += 1;
      const changedAt = Date.now();
      const targetFrameIDs = Array.from(targetIDs);
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
      const selectionIntent = pendingExplorerSelectionIntentRef.current;
      publishLiveSelection({
        companyID,
        entityKind: publishedSelection.entityKind,
        entityID: publishedSelection.entityID,
        label: selectedTree?.label || selectedKanbanBoardLabel || "",
        sourceFrameID: scope,
        sourceModule: "company-explorer",
        targetFrameIDs,
        selectedTreeID,
        selectedTreeIDs: Array.from(selectedTreeIDs),
        selectedEntityIDs,
        folderKind: selectedFolderKind,
        folderID: selectedFolderID,
        folderLabel: selectedFolderLabel,
        changedAt,
        sequence: explorerContextSequenceRef.current,
        selectionIntent,
      });
      if (publishedSelection.selectedKanbanBoardID) return;
      for (const targetID of targetIDs) {
        if (!targetID) continue;
        const targetKind = classifyFrameKind(registry[targetID]?.kind ?? "");
        const targetSelection = resolveExplorerPublishedSelection({
          selectedTreeID,
          selectedNodeID,
          selectedLogicGateID,
          selectedKanbanBoardID,
          selectedFolderID,
          selectedFolderKind,
          targetFrameKind: targetKind,
        });
        const payload = {
          sourceExplorerID: scope,
          // The tree row is the user's primary intent. Normalizing here keeps
          // stale opposite-domain state from sending a node click to a logic map.
          selectedNodeID: targetSelection.selectedNodeID,
          selectedLogicGateID: targetSelection.selectedLogicGateID,
          selectedFolderID,
          selectedFolderKind,
          selectedFolderLabel,
          selectedTreeID,
          scopeLevel: selectedTree?.scopeLevel ?? 0,
          selectedLabel: selectedTree?.label ?? "",
          selectionIntent,
          ts: changedAt,
          envelope: {
            context_id: `explorer_navigation_context:${companyID}:${targetID}`,
            source_module_id: scope,
            sequence: explorerContextSequenceRef.current,
            timestamp: new Date().toISOString(),
            user_action_type: "explorer_selection_changed",
          } satisfies ContextMutationEnvelope,
        };
        const keyPrefix = targetSelection.isLogicGateContext ? LOGIC_GATE_MAP_EXPLORER_CONTEXT_KEY_PREFIX : NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX;
        const key = `${keyPrefix}:${companyID}:${targetID}`;
        localStorage.setItem(key, JSON.stringify(payload));
        emitDashboardEvent(EVENT_EXPLORER_CONTEXT_UPDATED, { key, sourceExplorerID: scope, targetID });
      }
    } catch {
      // ignore local storage failures
    }
  }, [
    companyID,
    explorerContextSequenceRef,
    linkRevision,
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
    selectedTree,
    selectedTreeID,
    selectedTreeIDs,
    suppressNextExplorerBroadcastRef,
  ]);

  useEffect(() => {
    latestExplorerDomainRef.current = getExplorerSelectionDomain(selectedTree);
  }, [latestExplorerDomainRef, selectedTree]);
}
