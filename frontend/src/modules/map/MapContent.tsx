import React, { useEffect, useState } from "react";
import { NodeMapContent } from "../node-map/NodeMapContent";
import { NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX } from "../node-map/shared";
import { LogicGateMapContent } from "../logic-gate-map/LogicGateMapContent";
import { LOGIC_GATE_MAP_EXPLORER_CONTEXT_KEY_PREFIX } from "../logic-gate-map/shared";
import { EVENT_EXPLORER_CONTEXT_UPDATED } from "../node-map/eventbus";

type MapMode = "node" | "logic_gate";

type MapProps = {
  accent: string;
  widgetId?: string;
  hideTopControls?: boolean;
  theme?: "teal" | "light" | "dark";
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
  const companyID = (import.meta.env.VITE_COMPANY_ID as string | undefined)?.trim() ?? "11111111-1111-1111-1111-111111111111";
  const scope = props.widgetId?.trim() ? props.widgetId : "global";
  const nodeContextKey = `${NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${scope}`;
  const logicGateContextKey = `${LOGIC_GATE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${scope}`;
  const [mode, setMode] = useState<MapMode>(initialMode);

  useEffect(() => {
    const refreshModeFromExplorerContext = () => {
      const nodeTs = contextTimestamp(localStorage.getItem(nodeContextKey));
      const logicGateTs = contextTimestamp(localStorage.getItem(logicGateContextKey));
      if (logicGateTs <= 0 && nodeTs <= 0) return;
      setMode(logicGateTs > nodeTs ? "logic_gate" : "node");
    };
    refreshModeFromExplorerContext();

    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== nodeContextKey && event.key !== logicGateContextKey) return;
      refreshModeFromExplorerContext();
    };
    const onExplorerContextUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail;
      if (!detail || (detail.key !== nodeContextKey && detail.key !== logicGateContextKey)) return;
      refreshModeFromExplorerContext();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(EVENT_EXPLORER_CONTEXT_UPDATED, onExplorerContextUpdated);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EVENT_EXPLORER_CONTEXT_UPDATED, onExplorerContextUpdated);
    };
  }, [logicGateContextKey, nodeContextKey]);

  return mode === "logic_gate" ? <LogicGateMapContent {...props} /> : <NodeMapContent {...props} />;
};
