import { useEffect } from "react";
import type React from "react";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../folders/companyExplorerFolders";
import { resolveMapSelectionAfterGraphLoad } from "../folders/companyExplorerFolders";
import {
  getNodeRelationshipGraphSnapshot,
  refreshNodeRelationshipGraphSnapshot,
  subscribeNodeRelationshipGraph,
} from "./NodeRelationshipGraph";
import type { NodePosition, NodeRecord, NodeRelationship, PersistedMapPosition } from "./shared";

type ExplorerSelectionOriginRef = React.RefObject<{ selectedEntityID: string } | null>;

type UseNodeMapGraphLoaderArgs = {
  apiBase: string;
  companyID: string;
  activeFolderID: string;
  activeFolderIDRef: React.MutableRefObject<string>;
  restoredSelectionRef: React.MutableRefObject<string>;
  selectedNodeIDRef: React.MutableRefObject<string>;
  explorerSelectionOriginRef: ExplorerSelectionOriginRef;
  suppressNextSelectionBroadcastRef: React.MutableRefObject<boolean>;
  allNodes: NodeRecord[];
  folders: CompanyExplorerFolder[];
  folderItems: CompanyExplorerFolderItem[];
  applyFolderScope: (
    snapshotNodes: NodeRecord[],
    snapshotRelationships: NodeRelationship[],
    snapshotFolders: CompanyExplorerFolder[],
    snapshotFolderItems: CompanyExplorerFolderItem[],
    folderID?: string,
  ) => NodeRecord[];
  applyServerMapPositions: (positions: PersistedMapPosition[]) => void;
  projectVisibleRelationships: (snapshotNodes: NodeRecord[], snapshotRelationships: NodeRelationship[]) => NodeRelationship[];
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<string>>;
  setSelectedNodeID: React.Dispatch<React.SetStateAction<string>>;
  setSelectedNodeIDs: React.Dispatch<React.SetStateAction<Set<string>>>;
  setRelationships: React.Dispatch<React.SetStateAction<NodeRelationship[]>>;
};

export function useNodeMapGraphLoader({
  apiBase,
  companyID,
  activeFolderID,
  activeFolderIDRef,
  restoredSelectionRef,
  selectedNodeIDRef,
  explorerSelectionOriginRef,
  suppressNextSelectionBroadcastRef,
  allNodes,
  folders,
  folderItems,
  applyFolderScope,
  applyServerMapPositions,
  projectVisibleRelationships,
  setLoading,
  setError,
  setSelectedNodeID,
  setSelectedNodeIDs,
  setRelationships,
}: UseNodeMapGraphLoaderArgs) {
  const loadNodes = async () => {
    setLoading(true);
    setError("");
    try {
      await refreshNodeRelationshipGraphSnapshot(apiBase, companyID);
      const snapshot = getNodeRelationshipGraphSnapshot(apiBase, companyID);
      const snapshotNodes = snapshot.nodes ?? [];
      const nextNodes = applyFolderScope(snapshotNodes, snapshot.relationships ?? [], snapshot.folders ?? [], snapshot.folder_items ?? [], activeFolderIDRef.current);
      applyServerMapPositions(snapshot.node_map_positions ?? []);

      const nextSelection = resolveMapSelectionAfterGraphLoad({
        currentSelectedID: selectedNodeIDRef.current,
        restoredSelectedID: restoredSelectionRef.current,
        visibleItemIDs: nextNodes.map((item) => item.node_id),
        knownItemIDs: snapshotNodes.map((item) => item.node_id),
        explorerRequestedID: explorerSelectionOriginRef.current?.selectedEntityID,
        hasExplorerNavigationIntent: !!explorerSelectionOriginRef.current,
      });
      if (nextSelection === null) return;
      suppressNextSelectionBroadcastRef.current = true;
      selectedNodeIDRef.current = nextSelection;
      setSelectedNodeID(nextSelection);
      setSelectedNodeIDs(nextSelection ? new Set([nextSelection]) : new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_load_nodes");
    } finally {
      setLoading(false);
    }
  };

  const loadGraphRelationshipsFromSnapshot = (graphNodes: NodeRecord[]) => {
    if (graphNodes.length === 0) {
      setRelationships([]);
      return;
    }
    const payload = getNodeRelationshipGraphSnapshot(apiBase, companyID);
    setRelationships(projectVisibleRelationships(graphNodes, payload.relationships ?? []));
  };

  useEffect(() => {
    void loadNodes();
  }, []);

  useEffect(() => {
    return subscribeNodeRelationshipGraph(apiBase, companyID, () => {
      const snapshot = getNodeRelationshipGraphSnapshot(apiBase, companyID);
      applyFolderScope(snapshot.nodes ?? [], snapshot.relationships ?? [], snapshot.folders ?? [], snapshot.folder_items ?? []);
      applyServerMapPositions(snapshot.node_map_positions ?? []);
    });
  }, [apiBase, companyID, activeFolderID]);

  useEffect(() => {
    const snapshot = getNodeRelationshipGraphSnapshot(apiBase, companyID);
    applyFolderScope(snapshot.nodes ?? allNodes, snapshot.relationships ?? [], snapshot.folders ?? folders, snapshot.folder_items ?? folderItems);
  }, [activeFolderID]);

  return { loadGraphRelationshipsFromSnapshot };
}
