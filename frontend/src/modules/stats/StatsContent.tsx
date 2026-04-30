import React, { useEffect, useMemo, useState } from "react";
import { NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX } from "../node-map/shared";
import { EVENT_EXPLORER_CONTEXT_UPDATED, EVENT_FRAME_LINK_GRAPH_UPDATED, EVENT_NODE_MAP_SELECTION_UPDATED } from "../node-map/eventbus";
import { FRAME_LINKS_KEY, FRAME_REGISTRY_KEY, classifyFrameKind, readFrameLinksFromStorage, readFrameRegistryFromStorage, resolveLinkedFrameByKindFromGraph } from "../linkingGraph";
import { getNodeRecordSingleFlight } from "../node-map/NodeRecordStore";

// Generic Stats module: displays metric cards for the nearest linked context source.
export const StatsContent: React.FC<{ accent: string; widgetId?: string; hideTopControls?: boolean }> = ({ accent, widgetId }) => {
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "http://localhost:8080";
  const companyID = (import.meta.env.VITE_COMPANY_ID as string | undefined)?.trim() ?? "11111111-1111-1111-1111-111111111111";
  const scope = widgetId?.trim() ? widgetId : "global";
  const [linkedMapWidgetID, setLinkedMapWidgetID] = useState("");
  const [linkedSourceKind, setLinkedSourceKind] = useState<"map" | "editor" | "explorer" | "logic-map" | "">("");
  const [selectedContextID, setSelectedContextID] = useState("");
  const [error, setError] = useState("");
  const [statsRows, setStatsRows] = useState<Array<{ label: string; value: string }>>([]);

  useEffect(() => {
    const refreshLinks = () => {
      const edges = readFrameLinksFromStorage();
      const registry = readFrameRegistryFromStorage();
      const mapFrameID = resolveLinkedFrameByKindFromGraph({ startFrameID: scope, targetKind: "map", edges, registry });
      setLinkedMapWidgetID(mapFrameID);

      const sourceKind = classifyFrameKind(registry[mapFrameID]?.kind ?? "") ?? "";
      setLinkedSourceKind(sourceKind);
    };

    refreshLinks();
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== FRAME_LINKS_KEY && event.key !== FRAME_REGISTRY_KEY) return;
      refreshLinks();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(EVENT_FRAME_LINK_GRAPH_UPDATED, refreshLinks);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EVENT_FRAME_LINK_GRAPH_UPDATED, refreshLinks);
    };
  }, [scope]);

  useEffect(() => {
    const refreshSelection = () => {
      if (linkedMapWidgetID) {
        try {
          const raw = localStorage.getItem(`node-map-state-v1:${companyID}:${linkedMapWidgetID}`);
          if (raw) {
            const parsed = JSON.parse(raw) as { selectedNodeID?: string };
            if (typeof parsed.selectedNodeID === "string") {
              setSelectedContextID(parsed.selectedNodeID);
              return;
            }
          }
        } catch {
          // ignore malformed map state
        }
      }
      try {
        const raw = localStorage.getItem(`${NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${scope}`);
        if (!raw) {
          setSelectedContextID("");
          return;
        }
        const parsed = JSON.parse(raw) as { selectedNodeID?: string };
        setSelectedContextID(typeof parsed.selectedNodeID === "string" ? parsed.selectedNodeID : "");
      } catch {
        setSelectedContextID("");
      }
    };

    refreshSelection();
    const onStorage = (event: StorageEvent) => {
      const mapStateKey = linkedMapWidgetID ? `node-map-state-v1:${companyID}:${linkedMapWidgetID}` : "";
      const explorerContextKey = `${NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${scope}`;
      if (event.key && event.key !== mapStateKey && event.key !== explorerContextKey) return;
      refreshSelection();
    };
    const onMapSelection = (event: Event) => {
      const detail = (event as CustomEvent<{ mapWidgetID?: string; selectedNodeID?: string }>).detail;
      if (!detail || detail.mapWidgetID !== linkedMapWidgetID || typeof detail.selectedNodeID !== "string") return;
      setSelectedContextID(detail.selectedNodeID);
    };
    const onExplorerUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string; targetID?: string }>).detail;
      if (!detail) return;
      const expectedKey = `${NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${scope}`;
      if (detail.key !== expectedKey && detail.targetID !== scope) return;
      refreshSelection();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(EVENT_NODE_MAP_SELECTION_UPDATED, onMapSelection);
    window.addEventListener(EVENT_EXPLORER_CONTEXT_UPDATED, onExplorerUpdate);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EVENT_NODE_MAP_SELECTION_UPDATED, onMapSelection);
      window.removeEventListener(EVENT_EXPLORER_CONTEXT_UPDATED, onExplorerUpdate);
    };
  }, [companyID, linkedMapWidgetID, scope]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedContextID) {
      setStatsRows([]);
      setError("");
      return;
    }

    if (linkedSourceKind === "logic-map") {
      setStatsRows([{ label: "Source", value: "Logic Map" }, { label: "Status", value: "Stats adapter coming soon" }]);
      setError("");
      return;
    }

    (async () => {
      try {
        setError("");
        const nodeRecord = await getNodeRecordSingleFlight(apiBase, companyID, selectedContextID);
        if (cancelled) return;
        setStatsRows([
          { label: "Source", value: linkedSourceKind || "map" },
          { label: "Relationships", value: String(nodeRecord.relationships.length) },
          { label: "Information Records", value: String(nodeRecord.information.length) },
          { label: "Entity Type", value: "node" },
        ]);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "failed_to_load_stats");
      }
    })();

    return () => { cancelled = true; };
  }, [apiBase, companyID, linkedSourceKind, selectedContextID]);

  const title = useMemo(() => selectedContextID ? `Stats for ${selectedContextID.slice(0, 8)}` : "Stats", [selectedContextID]);

  return (
    <div style={{ width: "100%", height: "100%", display: "grid", gridTemplateRows: "auto 1fr", background: "#ffffff", color: "#0f1f23" }}>
      <div style={{ padding: "12px 10px 8px", borderBottom: "1px solid rgba(3,25,30,0.14)", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: accent }}>{title}</div>
      <div style={{ overflow: "auto", padding: 12, display: "grid", gap: 8, alignContent: "start" }}>
        {statsRows.length === 0 && !error && <div style={{ fontSize: 12, opacity: 0.72 }}>Select a linked context source to view stats.</div>}
        {statsRows.map((row) => (
          <div key={row.label} style={{ border: "1px solid rgba(4,31,38,0.16)", borderRadius: 8, padding: "7px 8px", display: "flex", justifyContent: "space-between", fontSize: 12 }}>
            <span style={{ opacity: 0.82 }}>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
        {error && <div style={{ fontSize: 11, color: "#b00020" }}>{error}</div>}
      </div>
    </div>
  );
};
