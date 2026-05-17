import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { publishLiveSelection } from "../selectionCoordinator";
import { EVENT_NODE_MAP_SELECTION_UPDATED } from "../node-map/eventbus";
import { NodeMapContent } from "../node-map/NodeMapContent";
import {
  getNodeRelationshipGraphSnapshot,
  subscribeNodeRelationshipGraph,
} from "../node-map/NodeRelationshipGraph";
import {
  buildNodeRelationshipTreeRows,
  type NodeRelationshipTreeRow,
} from "../node-map/nodeRelationshipStructure";
import { getNodeTitle, type NodeRecord, type NodeRelationship } from "../node-map/shared";

const InlineNodeEditorContent = React.lazy(() => import("./EditorContent").then((module) => ({
  default: module.EditorContent as React.FC<{
    accent: string;
    widgetId?: string;
    theme?: "mango" | "teal" | "light" | "dark";
    forcedEntityKind?: "node" | "logic_gate";
    forcedEntityID?: string;
    forcedLabel?: string;
    forcedEmptyMessage?: string;
  }>,
})));

type NodeRelationshipsSurfaceProps = {
  apiBase: string;
  companyID: string;
  nodeID: string;
  nodeTitle: string;
  scope: string;
  topPx: number;
  accent: string;
  surfaceText: string;
  panelBackground: string;
  strokeColor: string;
  ruleColor: string;
  scrollbarAccent: string;
  scrollbarTrack: string;
  theme: "mango" | "teal" | "light" | "dark";
};

const MIN_RELATIONSHIP_LIST_WIDTH = 236;
const MIN_RELATIONSHIP_VIEWER_WIDTH = 360;
const MIN_RELATIONSHIP_TREE_HEIGHT = 104;
const MIN_RELATIONSHIP_MAP_HEIGHT = 180;
const RELATIONSHIP_LAYOUT_KEY_PREFIX = "node-relationships-layout-v1";

type RelationshipPaneLayout = {
  listWidth: number | null;
  previewHeight: number | null;
};

function relationshipLayoutStorageKey(companyID: string, scope: string): string {
  return `${RELATIONSHIP_LAYOUT_KEY_PREFIX}:${companyID}:${scope}`;
}

function finitePositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

function readRelationshipPaneLayout(companyID: string, scope: string): RelationshipPaneLayout {
  try {
    const parsed = JSON.parse(localStorage.getItem(relationshipLayoutStorageKey(companyID, scope)) ?? "{}") as Partial<RelationshipPaneLayout>;
    return {
      listWidth: finitePositiveNumber(parsed.listWidth),
      previewHeight: finitePositiveNumber(parsed.previewHeight),
    };
  } catch {
    return { listWidth: null, previewHeight: null };
  }
}

function saveRelationshipPaneLayout(companyID: string, scope: string, layout: RelationshipPaneLayout): void {
  try {
    localStorage.setItem(relationshipLayoutStorageKey(companyID, scope), JSON.stringify({
      listWidth: finitePositiveNumber(layout.listWidth),
      previewHeight: finitePositiveNumber(layout.previewHeight),
    }));
  } catch {
    // Relationship split sizes are convenience state; storage failure should not block the editor.
  }
}

function roleLabel(row: NodeRelationshipTreeRow): string {
  if (row.role === "Current") return "Current";
  if (row.direct) return row.role;
  return "";
}

function rowAccentColor(row: NodeRelationshipTreeRow, accent: string): string {
  if (row.role === "Current") return accent;
  if (row.role === "Parent") return "#ff8a00";
  if (row.role === "Peer") return "#0095ff";
  if (row.role === "Child") return "#6f5cff";
  return "rgba(100,116,139,0.72)";
}

function clampRelationshipListWidth(value: number, totalWidth: number): number {
  if (!Number.isFinite(totalWidth) || totalWidth <= 0) return Math.max(MIN_RELATIONSHIP_LIST_WIDTH, Math.round(value));
  const maxWidth = Math.max(MIN_RELATIONSHIP_LIST_WIDTH, totalWidth - MIN_RELATIONSHIP_VIEWER_WIDTH);
  return Math.round(Math.min(Math.max(value, MIN_RELATIONSHIP_LIST_WIDTH), maxWidth));
}

function clampRelationshipMapHeight(value: number, totalHeight: number): number {
  if (!Number.isFinite(totalHeight) || totalHeight <= 0) return Math.max(MIN_RELATIONSHIP_MAP_HEIGHT, Math.round(value));
  const available = Math.max(MIN_RELATIONSHIP_MAP_HEIGHT, totalHeight - MIN_RELATIONSHIP_TREE_HEIGHT - 8);
  return Math.round(Math.min(Math.max(value, MIN_RELATIONSHIP_MAP_HEIGHT), available));
}

function TreeRow({
  row,
  active,
  accent,
  surfaceText,
  strokeColor,
  panelBackground,
  onOpen,
}: {
  row: NodeRelationshipTreeRow;
  active: boolean;
  accent: string;
  surfaceText: string;
  strokeColor: string;
  panelBackground: string;
  onOpen?: (row: NodeRelationshipTreeRow) => void;
}) {
  const label = roleLabel(row);
  const roleColor = rowAccentColor(row, accent);
  return (
    <button
      type="button"
      title={row.title}
      onClick={() => onOpen?.(row)}
      style={{
        width: "100%",
        minWidth: 0,
        minHeight: 30,
        boxSizing: "border-box",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 7,
        padding: `4px 7px 4px ${8 + row.depth * 16}px`,
        border: `1px solid ${active ? accent : "transparent"}`,
        borderRadius: 6,
        background: active ? "rgba(255,136,32,0.12)" : panelBackground,
        color: surfaceText,
        cursor: "pointer",
        font: "inherit",
        textAlign: "left",
      }}
    >
      <span style={{ minWidth: 0, display: "inline-flex", alignItems: "center", gap: 7 }}>
        <span
          aria-hidden="true"
          style={{
            width: 9,
            height: 9,
            borderRadius: row.hasChildren ? 3 : 999,
            background: roleColor,
            flex: "0 0 auto",
          }}
        />
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, fontWeight: active ? 800 : 700 }}>
          {row.title}
        </span>
      </span>
      {label && (
        <span
          style={{
            flex: "0 0 auto",
            maxWidth: 74,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            border: `1px solid ${active ? accent : strokeColor}`,
            borderRadius: 5,
            padding: "2px 5px",
            color: roleColor,
            background: "rgba(255,255,255,0.72)",
            fontSize: 9,
            fontWeight: 800,
          }}
        >
          {label}
        </span>
      )}
    </button>
  );
}

export const NodeRelationshipsSurface: React.FC<NodeRelationshipsSurfaceProps> = ({
  apiBase,
  companyID,
  nodeID,
  nodeTitle,
  scope,
  topPx,
  accent,
  surfaceText,
  panelBackground,
  strokeColor,
  ruleColor,
  scrollbarAccent,
  scrollbarTrack,
  theme,
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const leftBodyRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [leftBodyHeight, setLeftBodyHeight] = useState(0);
  const [listWidth, setListWidth] = useState<number | null>(() => readRelationshipPaneLayout(companyID, scope).listWidth);
  const [mapHeight, setMapHeight] = useState<number | null>(() => readRelationshipPaneLayout(companyID, scope).previewHeight);
  const [previewNodeID, setPreviewNodeID] = useState(nodeID);
  const [splitDrag, setSplitDrag] = useState<{ startX: number; startWidth: number } | null>(null);
  const [mapSplitDrag, setMapSplitDrag] = useState<{ startY: number; startHeight: number } | null>(null);
  const [graph, setGraph] = useState<{ nodes: NodeRecord[]; relationships: NodeRelationship[] }>(() => {
    const snapshot = getNodeRelationshipGraphSnapshot(apiBase, companyID);
    return { nodes: snapshot.nodes ?? [], relationships: snapshot.relationships ?? [] };
  });
  const mapWidgetID = `relationships-map:${scope}:${nodeID}`;

  useEffect(() => {
    const updateGraph = () => {
      const snapshot = getNodeRelationshipGraphSnapshot(apiBase, companyID);
      setGraph({ nodes: snapshot.nodes ?? [], relationships: snapshot.relationships ?? [] });
    };
    updateGraph();
    return subscribeNodeRelationshipGraph(apiBase, companyID, updateGraph);
  }, [apiBase, companyID]);

  useEffect(() => {
    const layout = readRelationshipPaneLayout(companyID, scope);
    setListWidth(layout.listWidth);
    setMapHeight(layout.previewHeight);
  }, [companyID, scope]);

  useEffect(() => {
    saveRelationshipPaneLayout(companyID, scope, { listWidth, previewHeight: mapHeight });
  }, [companyID, scope, listWidth, mapHeight]);

  useEffect(() => {
    setPreviewNodeID(nodeID);
  }, [nodeID]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const updateWidth = () => setWidth(root.getBoundingClientRect().width);
    updateWidth();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }
    const observer = new ResizeObserver(updateWidth);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const body = leftBodyRef.current;
    if (!body) return;
    const updateHeight = () => setLeftBodyHeight(body.getBoundingClientRect().height);
    updateHeight();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateHeight);
      return () => window.removeEventListener("resize", updateHeight);
    }
    const observer = new ResizeObserver(updateHeight);
    observer.observe(body);
    return () => observer.disconnect();
  }, []);

  const rows = useMemo(() => buildNodeRelationshipTreeRows({
    nodes: graph.nodes,
    relationships: graph.relationships,
    focusNodeID: nodeID,
    fallbackTitle: nodeTitle,
  }), [graph.nodes, graph.relationships, nodeID, nodeTitle]);
  const compact = width > 0 && width < 760;
  const listWidthPx = compact ? 0 : clampRelationshipListWidth(listWidth ?? width * 0.32, width);
  const mapHeightPx = clampRelationshipMapHeight(mapHeight ?? leftBodyHeight * 0.38, leftBodyHeight);
  const titleByNodeID = useMemo(() => {
    const titles = new Map<string, string>();
    for (const node of graph.nodes) titles.set(node.node_id, getNodeTitle(node));
    for (const row of rows) titles.set(row.nodeID, row.title);
    if (nodeID) titles.set(nodeID, nodeTitle || titles.get(nodeID) || nodeID);
    return titles;
  }, [graph.nodes, nodeID, nodeTitle, rows]);
  const previewNodeTitle = previewNodeID ? (titleByNodeID.get(previewNodeID) || previewNodeID) : "";
  const rowCountLabel = `${rows.length} node${rows.length === 1 ? "" : "s"}`;

  const selectPreviewNode = useCallback((selectedNodeID: string, selectedTitle: string, broadcastToMap: boolean) => {
    const nextNodeID = selectedNodeID.trim();
    if (!nextNodeID) return;
    setPreviewNodeID(nextNodeID);
    if (!broadcastToMap) return;
    publishLiveSelection({
      companyID,
      entityKind: "node",
      entityID: nextNodeID,
      label: selectedTitle || titleByNodeID.get(nextNodeID) || nextNodeID,
      sourceFrameID: `${scope}:relationships-list`,
      sourceModule: "editor",
      targetFrameIDs: [mapWidgetID],
      selectionIntent: "navigate",
    });
  }, [companyID, mapWidgetID, scope, titleByNodeID]);

  useEffect(() => {
    const onMapSelectionUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ mapWidgetID?: string; selectedNodeID?: string }>).detail;
      if (!detail || detail.mapWidgetID !== mapWidgetID || typeof detail.selectedNodeID !== "string") return;
      selectPreviewNode(detail.selectedNodeID, titleByNodeID.get(detail.selectedNodeID) || detail.selectedNodeID, false);
    };
    window.addEventListener(EVENT_NODE_MAP_SELECTION_UPDATED, onMapSelectionUpdated);
    return () => window.removeEventListener(EVENT_NODE_MAP_SELECTION_UPDATED, onMapSelectionUpdated);
  }, [mapWidgetID, selectPreviewNode, titleByNodeID]);

  useEffect(() => {
    if (!splitDrag) return;
    const onPointerMove = (event: PointerEvent) => {
      event.preventDefault();
      setListWidth(clampRelationshipListWidth(splitDrag.startWidth + event.clientX - splitDrag.startX, width));
    };
    const onPointerUp = () => setSplitDrag(null);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [splitDrag, width]);

  useEffect(() => {
    if (!mapSplitDrag) return;
    const onPointerMove = (event: PointerEvent) => {
      event.preventDefault();
      const deltaY = event.clientY - mapSplitDrag.startY;
      setMapHeight(clampRelationshipMapHeight(mapSplitDrag.startHeight - deltaY, leftBodyHeight));
    };
    const onPointerUp = () => setMapSplitDrag(null);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [leftBodyHeight, mapSplitDrag]);

  return (
    <div
      ref={rootRef}
      className="editor-document-scroll"
      onWheel={(event) => event.stopPropagation()}
      style={{
        position: "absolute",
        top: topPx,
        right: 0,
        bottom: 0,
        left: 0,
        display: "grid",
        gridTemplateColumns: compact ? "1fr" : `${listWidthPx}px 8px minmax(0, 1fr)`,
        gridTemplateRows: compact ? "minmax(320px, 45%) minmax(260px, 1fr)" : "1fr",
        minHeight: 0,
        overflow: "hidden",
        cursor: splitDrag ? "col-resize" : mapSplitDrag ? "row-resize" : "default",
        ["--editor-document-scroll-accent" as string]: scrollbarAccent,
        ["--editor-document-scroll-track" as string]: scrollbarTrack,
      }}
    >
      <aside
        style={{
          minWidth: 0,
          minHeight: 0,
          display: "grid",
          gridTemplateRows: "auto minmax(0, 1fr)",
          borderRight: "none",
          borderBottom: compact ? `1px solid ${ruleColor}` : "none",
          background: panelBackground,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minWidth: 0, padding: "9px 10px", borderBottom: `1px solid ${ruleColor}` }}>
          <div style={{ minWidth: 0, display: "grid", gap: 2 }}>
            <div style={{ color: accent, fontSize: 10, fontWeight: 800, letterSpacing: 0 }}>Relationships</div>
            <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: surfaceText, fontSize: 12, fontWeight: 800 }}>{nodeTitle || "Current node"}</div>
          </div>
          <span style={{ flex: "0 0 auto", color: surfaceText, opacity: 0.62, fontSize: 10, fontWeight: 800 }}>{rowCountLabel}</span>
        </div>
        <div
          ref={leftBodyRef}
          style={{
            minHeight: 0,
            display: "grid",
            gridTemplateRows: `minmax(${MIN_RELATIONSHIP_TREE_HEIGHT}px, 1fr) 8px ${mapHeightPx}px`,
            overflow: "hidden",
          }}
        >
          <div className="editor-document-scroll" style={{ minHeight: 0, overflowY: "auto", padding: 8, display: "grid", alignContent: "start", gap: 4, ["--editor-document-scroll-accent" as string]: scrollbarAccent, ["--editor-document-scroll-track" as string]: scrollbarTrack }}>
            {rows.length === 0 ? (
              <div style={{ border: `1px dashed ${strokeColor}`, borderRadius: 6, padding: 10, color: surfaceText, opacity: 0.68, fontSize: 11, fontWeight: 700 }}>
                No related nodes
              </div>
            ) : rows.map((row) => (
              <TreeRow
                key={`${row.nodeID}:${row.depth}`}
                row={row}
                active={row.nodeID === previewNodeID}
                accent={accent}
                surfaceText={surfaceText}
                strokeColor={strokeColor}
                panelBackground="rgba(255,255,255,0.58)"
                onOpen={(item) => selectPreviewNode(item.nodeID, item.title, true)}
              />
            ))}
          </div>
          <div
            role="separator"
            aria-orientation="horizontal"
            title="Resize relationship map"
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              setMapSplitDrag({ startY: event.clientY, startHeight: mapHeightPx });
            }}
            style={{
              minHeight: 8,
              cursor: "row-resize",
              touchAction: "none",
              background: mapSplitDrag ? "rgba(255,136,32,0.14)" : "transparent",
              borderTop: `1px solid ${ruleColor}`,
              borderBottom: `1px solid ${ruleColor}`,
            }}
          />
          <section style={{ minWidth: 0, minHeight: 0, position: "relative", background: "transparent", overflow: "hidden" }}>
            <NodeMapContent
              accent={accent}
              widgetId={mapWidgetID}
              hideTopControls
              theme={theme}
              structureNodeID={nodeID}
              initialSelectedNodeID={nodeID}
            />
          </section>
        </div>
      </aside>
      {!compact && (
        <div
          role="separator"
          aria-orientation="vertical"
          title="Resize relationship list"
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            setSplitDrag({ startX: event.clientX, startWidth: listWidthPx });
          }}
          style={{
            minWidth: 8,
            height: "100%",
            cursor: "col-resize",
            touchAction: "none",
            background: splitDrag ? "rgba(255,136,32,0.14)" : "transparent",
            borderLeft: `1px solid ${ruleColor}`,
            borderRight: `1px solid ${ruleColor}`,
          }}
        />
      )}
      <section style={{ minWidth: 0, minHeight: 0, overflow: "hidden", background: "#ffffff", position: "relative" }}>
        {previewNodeID ? (
          <React.Suspense fallback={<div style={{ padding: 10, color: surfaceText, opacity: 0.68, fontSize: 11, fontWeight: 700 }}>Loading node</div>}>
            <InlineNodeEditorContent
              key={previewNodeID}
              accent={accent}
              widgetId={`relationships-node-viewer:${scope}`}
              theme={theme}
              forcedEntityKind="node"
              forcedEntityID={previewNodeID}
              forcedLabel={previewNodeTitle}
              forcedEmptyMessage="Select a related node"
            />
          </React.Suspense>
        ) : (
          <div style={{ padding: 10, color: surfaceText, opacity: 0.68, fontSize: 11, fontWeight: 700 }}>
            Select a related node
          </div>
        )}
      </section>
    </div>
  );
};
