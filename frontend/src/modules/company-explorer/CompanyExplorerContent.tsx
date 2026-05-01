import React, { useEffect, useMemo, useRef, useState } from "react";
import { getNodeTitle, NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX, NodeRecord, NodeRelationship } from "../node-map/shared";
import { LOGIC_GATE_MAP_EXPLORER_CONTEXT_KEY_PREFIX, getNodeTitle as getLogicGateTitle, NodeRecord as LogicGateRecord, NodeRelationship as LogicGateRelationship } from "../logic-gate-map/shared";
import { emitDashboardEvent, EVENT_EXPLORER_CONTEXT_UPDATED, EVENT_FRAME_LINK_GRAPH_UPDATED, EVENT_LOGIC_GATE_MAP_SELECTION_UPDATED, EVENT_NODE_MAP_SELECTION_UPDATED } from "../node-map/eventbus";
import { getNodeRelationshipGraphSnapshot, refreshNodeRelationshipGraphSnapshot, subscribeNodeRelationshipGraph } from "../node-map/NodeRelationshipGraph";
import { getLogicGateRelationshipGraphSnapshot, refreshLogicGateRelationshipGraphSnapshot, subscribeLogicGateRelationshipGraph } from "../logic-gate-map/LogicGateRelationshipGraph";
import { FRAME_LINKS_KEY, FRAME_REGISTRY_KEY, readFrameLinksFromStorage, readFrameRegistryFromStorage, resolveDirectLinkedTargets, resolveLinkedFrameByKindFromGraph } from "../linkingGraph";
import { shouldApplyMapSelection, shouldBroadcastSelection, type ExplorerSelectionState } from "./explorerSync";
import { hasSequenceGap, isNewerSequence, readIncomingSequence, type ContextMutationEnvelope } from "../contextSyncContract";

type ExplorerTreeNode = {
  id: string;
  label: string;
  depth: number;
  kind: "folder" | "node" | "logic_gate";
  nodeID?: string;
  logicGateID?: string;
  scopeLevel: number;
};

// Company Explorer module: tree navigation + node context handoff into Node Map and Editor.
export const CompanyExplorerContent: React.FC<{ accent: string; widgetId?: string; hideTopControls?: boolean; theme?: "teal" | "light" | "dark" }> = ({ accent, widgetId, theme = "teal" }) => {
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "http://localhost:8080";
  const companyID = (import.meta.env.VITE_COMPANY_ID as string | undefined)?.trim() ?? "11111111-1111-1111-1111-111111111111";
  const scope = widgetId?.trim() ? widgetId : "global";

  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [logicGates, setLogicGates] = useState<LogicGateRecord[]>([]);
  const [selectedTreeID, setSelectedTreeID] = useState("folder-all");
  const [selectedNodeID, setSelectedNodeID] = useState("");
  const [selectedLogicGateID, setSelectedLogicGateID] = useState("");
  const [relationships, setRelationships] = useState<NodeRelationship[]>([]);
  const [logicGateRelationships, setLogicGateRelationships] = useState<LogicGateRelationship[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["folder-root", "folder-nodes", "folder-notes", "folder-logic"]));
  const treeViewportRef = useRef<HTMLDivElement | null>(null);
  const [treeScrollTop, setTreeScrollTop] = useState(0);
  const [treeViewportHeight, setTreeViewportHeight] = useState(480);
  const [linkRevision, setLinkRevision] = useState(0);
  const [linkedMapFrameID, setLinkedMapFrameID] = useState("");
  const [linkedLogicMapFrameID, setLinkedLogicMapFrameID] = useState("");
  const lastMapSelectionRevisionRef = useRef(0);
  const lastLogicMapSelectionRevisionRef = useRef(0);
  const suppressNextExplorerBroadcastRef = useRef(false);
  const previousBroadcastSelectionRef = useRef({ selectedNodeID: "", selectedTreeID: "" });
  const latestSelectionRef = useRef<ExplorerSelectionState>({ selectedNodeID: "", selectedTreeID: "" });
  const latestLogicGateSelectionRef = useRef({ selectedLogicGateID: "", selectedTreeID: "" });
  const explorerContextSequenceRef = useRef(0);

  const TREE_ROW_HEIGHT = 30;
  const TREE_OVERSCAN = 8;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refreshNodeRelationshipGraphSnapshot(apiBase, companyID);
        if (cancelled) return;
        const snapshot = getNodeRelationshipGraphSnapshot(apiBase, companyID);
        setNodes(snapshot.nodes ?? []);
        setRelationships(snapshot.relationships ?? []);
      } catch {
        // ignore initial load failures; subscription updates can still hydrate state later
      }
    })();
    return () => { cancelled = true; };
  }, [apiBase, companyID]);

  useEffect(() => {
    return subscribeNodeRelationshipGraph(apiBase, companyID, () => {
      const snapshot = getNodeRelationshipGraphSnapshot(apiBase, companyID);
      setNodes(snapshot.nodes ?? []);
      setRelationships(snapshot.relationships ?? []);
    });
  }, [apiBase, companyID]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refreshLogicGateRelationshipGraphSnapshot(apiBase, companyID);
        if (cancelled) return;
        const snapshot = getLogicGateRelationshipGraphSnapshot(apiBase, companyID);
        setLogicGates(snapshot.nodes ?? []);
        setLogicGateRelationships(snapshot.relationships ?? []);
      } catch {
        // Logic Gate Map has its own graph cache; subscription updates can still hydrate later.
      }
    })();
    return () => { cancelled = true; };
  }, [apiBase, companyID]);

  useEffect(() => {
    return subscribeLogicGateRelationshipGraph(apiBase, companyID, () => {
      const snapshot = getLogicGateRelationshipGraphSnapshot(apiBase, companyID);
      setLogicGates(snapshot.nodes ?? []);
      setLogicGateRelationships(snapshot.relationships ?? []);
    });
  }, [apiBase, companyID]);

  const unattachedNodeIDs = useMemo(() => {
    const attached = new Set<string>();
    for (const relationship of relationships) {
      attached.add(relationship.node_id_a);
      attached.add(relationship.node_id_b);
    }
    return new Set(nodes.filter((node) => !attached.has(node.node_id)).map((node) => node.node_id));
  }, [nodes, relationships]);

  // Build ctrl+f-friendly hierarchy rows (Company/Nodes/Logic Gates/Knowledge Notes).
  const treeRows = useMemo<ExplorerTreeNode[]>(() => {
    const rows: ExplorerTreeNode[] = [];
    rows.push({ id: "folder-root", label: "Company", depth: 0, kind: "folder", scopeLevel: 0 });

    rows.push({ id: "folder-nodes", label: "Nodes", depth: 1, kind: "folder", scopeLevel: 1 });
    if (expanded.has("folder-nodes")) {
      rows.push({ id: "folder-all", label: `All Nodes (${nodes.length})`, depth: 2, kind: "folder", scopeLevel: 1 });
      for (const node of nodes) {
        rows.push({ id: `node-${node.node_id}`, label: getNodeTitle(node) || node.node_id, depth: 3, kind: "node", nodeID: node.node_id, scopeLevel: 3 });
      }
    }

    rows.push({ id: "folder-logic", label: "Logic Gates", depth: 1, kind: "folder", scopeLevel: 1 });
    if (expanded.has("folder-logic")) {
      rows.push({ id: "folder-logic-all", label: `All Logic Gates (${logicGates.length})`, depth: 2, kind: "folder", scopeLevel: 2 });
      for (const logicGate of logicGates) {
        rows.push({
          id: `logic-gate-${logicGate.logic_gate_id}`,
          label: getLogicGateTitle(logicGate) || logicGate.logic_gate_id,
          depth: 3,
          kind: "logic_gate",
          logicGateID: logicGate.logic_gate_id,
          scopeLevel: 3,
        });
      }
    }

    rows.push({ id: "folder-notes", label: "Knowledge Notes", depth: 1, kind: "folder", scopeLevel: 1 });
    if (expanded.has("folder-notes")) {
      rows.push({ id: "folder-notes-unattached", label: `Unattached Notes (${unattachedNodeIDs.size})`, depth: 2, kind: "folder", scopeLevel: 2 });
    }

    return rows;
  }, [expanded, nodes, logicGates, unattachedNodeIDs]);

  const selectedTree = useMemo(() => treeRows.find((row) => row.id === selectedTreeID) ?? treeRows[0], [selectedTreeID, treeRows]);

  useEffect(() => {
    latestSelectionRef.current = { selectedNodeID, selectedTreeID };
  }, [selectedNodeID, selectedTreeID]);

  useEffect(() => {
    latestLogicGateSelectionRef.current = { selectedLogicGateID, selectedTreeID };
  }, [selectedLogicGateID, selectedTreeID]);

  useEffect(() => {
    if (!treeViewportRef.current) return;
    const measure = () => {
      const height = treeViewportRef.current?.clientHeight ?? 0;
      if (height > 0) setTreeViewportHeight(height);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Virtualization window: keeps tree rendering fast when node counts grow.
  const virtualizedTree = useMemo(() => {
    const total = treeRows.length;
    if (total === 0) return { rows: [] as ExplorerTreeNode[], topSpacer: 0, bottomSpacer: 0 };
    const visibleCount = Math.max(1, Math.ceil(treeViewportHeight / TREE_ROW_HEIGHT));
    const start = Math.max(0, Math.floor(treeScrollTop / TREE_ROW_HEIGHT) - TREE_OVERSCAN);
    const end = Math.min(total, start + visibleCount + TREE_OVERSCAN * 2);
    const rows = treeRows.slice(start, end);
    return {
      rows,
      topSpacer: start * TREE_ROW_HEIGHT,
      bottomSpacer: Math.max(0, (total - end) * TREE_ROW_HEIGHT),
    };
  }, [treeRows, treeViewportHeight, treeScrollTop]);

  useEffect(() => {
    const refreshLinkedMap = () => {
      const edges = readFrameLinksFromStorage();
      const registry = readFrameRegistryFromStorage();
      const resolved = resolveLinkedFrameByKindFromGraph({
        startFrameID: scope,
        targetKind: "map",
        edges,
        registry,
      });
      const resolvedLogicMap = resolveLinkedFrameByKindFromGraph({
        startFrameID: scope,
        targetKind: "logic-map",
        edges,
        registry,
      });
      setLinkedMapFrameID(resolved);
      setLinkedLogicMapFrameID(resolvedLogicMap);
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
  }, [scope]);

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
  }, []);

  useEffect(() => {
    const applyMapSelection = (selectedFromMap: string) => {
      const current = latestSelectionRef.current;
      if (!shouldApplyMapSelection(current, selectedFromMap)) return;
      suppressNextExplorerBroadcastRef.current = true;
      setSelectedNodeID(selectedFromMap);
      setSelectedLogicGateID("");
      setSelectedTreeID(`node-${selectedFromMap}`);
      setExpanded((previous) => {
        if (previous.has("folder-root") && previous.has("folder-nodes")) return previous;
        const next = new Set(previous);
        next.add("folder-root");
        next.add("folder-nodes");
        return next;
      });
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
      const detail = (event as CustomEvent<{ mapWidgetID?: string; selectedNodeID?: string; revision?: number; envelope?: ContextMutationEnvelope }>).detail;
      if (!detail || detail.mapWidgetID !== linkedMapFrameID) return;
      const revision = readIncomingSequence(detail);
      if (revision > 0 && !isNewerSequence(lastMapSelectionRevisionRef.current, revision)) return;
      if (revision > 0 && hasSequenceGap(lastMapSelectionRevisionRef.current, revision)) readFromMapState();
      if (revision > 0) lastMapSelectionRevisionRef.current = revision;
      if (typeof detail.selectedNodeID !== "string") return;
      applyMapSelection(detail.selectedNodeID);
    };
    window.addEventListener(EVENT_NODE_MAP_SELECTION_UPDATED, onMapSelectionUpdated);
    return () => {
      window.removeEventListener(EVENT_NODE_MAP_SELECTION_UPDATED, onMapSelectionUpdated);
    };
  }, [companyID, linkedMapFrameID]);

  useEffect(() => {
    const applyLogicGateMapSelection = (selectedFromMap: string) => {
      if (!selectedFromMap) return;
      const nextTreeID = `logic-gate-${selectedFromMap}`;
      const current = latestLogicGateSelectionRef.current;
      if (current.selectedLogicGateID === selectedFromMap && current.selectedTreeID === nextTreeID) return;
      suppressNextExplorerBroadcastRef.current = true;
      setSelectedLogicGateID(selectedFromMap);
      setSelectedNodeID("");
      setSelectedTreeID(nextTreeID);
      setExpanded((previous) => {
        if (previous.has("folder-root") && previous.has("folder-logic")) return previous;
        const next = new Set(previous);
        next.add("folder-root");
        next.add("folder-logic");
        return next;
      });
    };
    const readFromLogicMapState = () => {
      if (!linkedLogicMapFrameID) return;
      const mapStateKey = `logic-gate-map-state-v1:${companyID}:${linkedLogicMapFrameID}`;
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
      const detail = (event as CustomEvent<{ mapWidgetID?: string; selectedNodeID?: string; selectedLogicGateID?: string; revision?: number; envelope?: ContextMutationEnvelope }>).detail;
      if (!detail || detail.mapWidgetID !== linkedLogicMapFrameID) return;
      const revision = readIncomingSequence(detail);
      if (revision > 0 && !isNewerSequence(lastLogicMapSelectionRevisionRef.current, revision)) return;
      if (revision > 0 && hasSequenceGap(lastLogicMapSelectionRevisionRef.current, revision)) readFromLogicMapState();
      if (revision > 0) lastLogicMapSelectionRevisionRef.current = revision;
      const selected = typeof detail.selectedLogicGateID === "string" ? detail.selectedLogicGateID : detail.selectedNodeID;
      if (typeof selected !== "string") return;
      applyLogicGateMapSelection(selected);
    };
    window.addEventListener(EVENT_LOGIC_GATE_MAP_SELECTION_UPDATED, onLogicMapSelectionUpdated);
    return () => {
      window.removeEventListener(EVENT_LOGIC_GATE_MAP_SELECTION_UPDATED, onLogicMapSelectionUpdated);
    };
  }, [companyID, linkedLogicMapFrameID]);

  useEffect(() => {
    const nextSelection = { selectedNodeID, selectedTreeID };
    if (!shouldBroadcastSelection(previousBroadcastSelectionRef.current, nextSelection)) return;
    previousBroadcastSelectionRef.current = nextSelection;

    if (suppressNextExplorerBroadcastRef.current) {
      suppressNextExplorerBroadcastRef.current = false;
      return;
    }
    try {
      const graph = readFrameLinksFromStorage();
      const targetIDs = new Set(resolveDirectLinkedTargets({ sourceFrameID: scope, edges: graph }));
      if (targetIDs.size === 0) return;

      explorerContextSequenceRef.current += 1;
      for (const targetID of targetIDs) {
        if (!targetID) continue;
        const isLogicGateContext = selectedLogicGateID.trim().length > 0;
        const payload = {
          sourceExplorerID: scope,
          selectedNodeID,
          selectedLogicGateID,
          selectedTreeID,
          scopeLevel: selectedTree?.scopeLevel ?? 0,
          selectedLabel: selectedTree?.label ?? "",
          ts: Date.now(),
          envelope: {
            context_id: `explorer_navigation_context:${companyID}:${targetID}`,
            source_module_id: scope,
            sequence: explorerContextSequenceRef.current,
            timestamp: new Date().toISOString(),
            user_action_type: "explorer_selection_changed",
          } satisfies ContextMutationEnvelope,
        };
        const keyPrefix = isLogicGateContext ? LOGIC_GATE_MAP_EXPLORER_CONTEXT_KEY_PREFIX : NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX;
        const key = `${keyPrefix}:${companyID}:${targetID}`;
        localStorage.setItem(key, JSON.stringify(payload));
        emitDashboardEvent(EVENT_EXPLORER_CONTEXT_UPDATED, { key, sourceExplorerID: scope, targetID });
      }
    } catch {
      // ignore local storage failures
    }
  }, [companyID, scope, selectedNodeID, selectedLogicGateID, selectedTreeID, selectedTree, linkRevision]);

  const isDarkTheme = theme === "dark";
  const surfaceBackground = isDarkTheme ? "#0f1216" : "#ffffff";
  const surfaceText = isDarkTheme ? "#f4f7fa" : "#0f1f23";
  const ruleColor = isDarkTheme ? "rgba(255,255,255,0.16)" : "rgba(3,25,30,0.14)";
  const rowRuleColor = isDarkTheme ? "rgba(255,255,255,0.08)" : "rgba(3,25,30,0.06)";
  const selectedRowBackground = isDarkTheme ? "rgba(0,233,255,0.2)" : "rgba(0, 233, 255, 0.28)";
  const treeGuideColor = isDarkTheme ? "rgba(185,222,230,0.3)" : "rgba(15,56,66,0.22)";
  const folderToggleColor = isDarkTheme ? "#95c7d1" : "#326872";

  return (
    <div style={{ width: "100%", height: "100%", display: "grid", gridTemplateColumns: "minmax(240px, 1fr)", background: surfaceBackground, color: surfaceText, overflow: "hidden", minWidth: 0 }}>
      <div
        className="company-explorer-scroll"
        ref={treeViewportRef}
        onScroll={(event) => setTreeScrollTop((event.currentTarget as HTMLDivElement).scrollTop)}
        style={{ overflow: "auto", minWidth: 0, ["--company-explorer-scroll-accent" as string]: accent }}
      >
        <div style={{ padding: "9px 10px", borderBottom: `1px solid ${ruleColor}`, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: accent }}>Company Explorer</div>
        <div style={{ height: virtualizedTree.topSpacer }} />
        {virtualizedTree.rows.map((row) => {
          const isFolder = row.kind === "folder";
          const isOpen = expanded.has(row.id);
          const isSelected = selectedTreeID === row.id;
          return (
            <div
              key={row.id}
              onClick={() => {
                setSelectedTreeID(row.id);
                if (row.kind === "node") {
                  setSelectedNodeID(row.nodeID ?? "");
                  setSelectedLogicGateID("");
                }
                if (row.kind === "logic_gate") {
                  setSelectedLogicGateID(row.logicGateID ?? "");
                  setSelectedNodeID("");
                }
                if (row.kind === "folder" && (row.id === "folder-all" || row.id === "folder-logic-all")) {
                  setSelectedNodeID("");
                  setSelectedLogicGateID("");
                }
              }}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                gap: 6,
                minHeight: TREE_ROW_HEIGHT,
                padding: "4px 8px",
                paddingLeft: 10 + row.depth * 16,
                fontSize: 12,
                cursor: "pointer",
                background: isSelected ? selectedRowBackground : "transparent",
                borderBottom: `1px solid ${rowRuleColor}`,
              }}
            >
              {row.depth > 0 && (
                <div
                  style={{
                    position: "absolute",
                    left: 10 + row.depth * 16 - 8,
                    top: 0,
                    bottom: 0,
                    borderLeft: `1px solid ${treeGuideColor}`,
                  }}
                />
              )}
              {isFolder ? (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    setExpanded((previous) => {
                      const next = new Set(previous);
                      if (next.has(row.id)) next.delete(row.id);
                      else next.add(row.id);
                      return next;
                    });
                  }}
                  style={{ border: "none", background: "transparent", width: 18, cursor: "pointer", color: folderToggleColor, fontWeight: 700 }}
                >
                  {isOpen ? "▾" : "▸"}
                </button>
              ) : <span style={{ width: 18 }} />}
              <span>{row.label}</span>
            </div>
          );
        })}
        <div style={{ height: virtualizedTree.bottomSpacer }} />
      </div>

    </div>
  );
};
