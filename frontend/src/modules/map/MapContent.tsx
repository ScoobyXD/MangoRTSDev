import React, { useEffect, useState } from "react";
import { NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX } from "../node-map/shared";
import { LOGIC_GATE_MAP_EXPLORER_CONTEXT_KEY_PREFIX } from "../logic-gate-map/shared";
import { readLiveSelectionForFrame, subscribeLiveSelection, type LiveSelectionChange } from "../selectionCoordinator";
import { getActiveCompanyID } from "../../auth/currentCompany";
import { resolveInitialMapMode, resolveMapModeFromLiveSelection, type MapMode } from "./mapMode";

type MapProps = {
  accent: string;
  widgetId?: string;
  hideTopControls?: boolean;
  theme?: "mango" | "teal" | "light" | "dark";
  initialMode?: MapMode;
};

type MapSurfaceProps = Omit<MapProps, "initialMode">;

const LazyNodeMapContent = React.lazy(() => import("../node-map/NodeMapContent").then((module) => ({
  default: module.NodeMapContent as React.FC<MapSurfaceProps>,
})));
const LazyLogicGateMapContent = React.lazy(() => import("../logic-gate-map/LogicGateMapContent").then((module) => ({
  default: module.LogicGateMapContent as React.FC<MapSurfaceProps>,
})));
const mapSurfaceFallback = <div aria-busy="true" style={{ width: "100%", height: "100%", background: "transparent" }} />;

function readStoredContext(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export const MapContent: React.FC<MapProps> = ({ initialMode = "node", ...props }) => {
  const companyID = getActiveCompanyID();
  const scope = props.widgetId?.trim() ? props.widgetId : "global";
  const nodeContextKey = `${NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${scope}`;
  const logicGateContextKey = `${LOGIC_GATE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${scope}`;
  const [mode, setMode] = useState<MapMode>(() => resolveInitialMapMode({
    initialMode,
    nodeContextValue: readStoredContext(nodeContextKey),
    logicGateContextValue: readStoredContext(logicGateContextKey),
  }));

  const applyLiveSelectionMode = (selection: LiveSelectionChange): boolean => {
    const nextMode = resolveMapModeFromLiveSelection(selection, {
      companyID,
      nodeContextValue: readStoredContext(nodeContextKey),
      logicGateContextValue: readStoredContext(logicGateContextKey),
    });
    if (!nextMode) return false;
    setMode(nextMode);
    return true;
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
      setMode(resolveInitialMapMode({
        initialMode,
        nodeContextValue: readStoredContext(nodeContextKey),
        logicGateContextValue: readStoredContext(logicGateContextKey),
      }));
    };
    // Restore the mode after reload/remount only. Live mode switches use the
    // SelectionCoordinator event above and do not read storage snapshots.
    refreshModeFromExplorerContext();
  }, [initialMode, logicGateContextKey, nodeContextKey]);

  return (
    <React.Suspense fallback={mapSurfaceFallback}>
      {mode === "logic_gate" ? <LazyLogicGateMapContent {...props} /> : <LazyNodeMapContent {...props} />}
    </React.Suspense>
  );
};
