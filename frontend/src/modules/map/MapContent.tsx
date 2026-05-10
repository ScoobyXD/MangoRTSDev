import React, { useEffect, useState } from "react";
import { NodeMapContent } from "../node-map/NodeMapContent";
import { NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX } from "../node-map/shared";
import { LogicGateMapContent } from "../logic-gate-map/LogicGateMapContent";
import { LOGIC_GATE_MAP_EXPLORER_CONTEXT_KEY_PREFIX } from "../logic-gate-map/shared";
import { readLiveSelectionForFrame, subscribeLiveSelection, type LiveSelectionChange } from "../selectionCoordinator";
import { getActiveCompanyID } from "../../auth/currentCompany";

type MapMode = "node" | "logic_gate";

type MapProps = {
  accent: string;
  widgetId?: string;
  hideTopControls?: boolean;
  theme?: "mango" | "teal" | "light" | "dark";
  initialMode?: MapMode;
};

function contextTimestamp(raw: string | null): number {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as { ts?: unknown };
    return typeof parsed.ts === "number" && Number.isFinite(parsed.ts) ? parsed.ts : 0;
  } catch {
    return 0;
  }
}

export const MapContent: React.FC<MapProps> = ({ initialMode = "node", ...props }) => {
  const companyID = getActiveCompanyID();
  const scope = props.widgetId?.trim() ? props.widgetId : "global";
  const nodeContextKey = `${NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${scope}`;
  const logicGateContextKey = `${LOGIC_GATE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${scope}`;
  const [mode, setMode] = useState<MapMode>(initialMode);

  const applyLiveSelectionMode = (selection: LiveSelectionChange): boolean => {
    if (selection.companyID !== companyID) return false;
    const latestExplorerContextTimestamp = Math.max(
      contextTimestamp(localStorage.getItem(nodeContextKey)),
      contextTimestamp(localStorage.getItem(logicGateContextKey)),
    );
    if (latestExplorerContextTimestamp > 0 && selection.changedAt < latestExplorerContextTimestamp) return false;
    if (selection.entityKind === "logic_gate" || selection.folderKind === "logic_gate") {
      setMode("logic_gate");
      return true;
    }
    if (selection.entityKind === "node" || selection.folderKind === "node") {
      setMode("node");
      return true;
    }
    return false;
  };

  useEffect(() => {
    const liveSelection = readLiveSelectionForFrame(companyID, scope);
    if (liveSelection) applyLiveSelectionMode(liveSelection);
    return subscribeLiveSelection(scope, applyLiveSelectionMode);
  }, [companyID, scope]);

  useEffect(() => {
    const refreshModeFromExplorerContext = () => {
      const liveSelection = readLiveSelectionForFrame(companyID, scope);
      if (liveSelection) {
        const liveSelectionApplied = applyLiveSelectionMode(liveSelection);
        if (liveSelectionApplied) return;
      }
      const nodeTs = contextTimestamp(localStorage.getItem(nodeContextKey));
      const logicGateTs = contextTimestamp(localStorage.getItem(logicGateContextKey));
      if (logicGateTs <= 0 && nodeTs <= 0) return;
      setMode(logicGateTs > nodeTs ? "logic_gate" : "node");
    };
    // Restore the mode after reload/remount only. Live mode switches use the
    // SelectionCoordinator event above and do not read storage snapshots.
    refreshModeFromExplorerContext();
  }, [logicGateContextKey, nodeContextKey]);

  return mode === "logic_gate" ? <LogicGateMapContent {...props} /> : <NodeMapContent {...props} />;
};
