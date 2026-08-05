import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { publishLiveSelection } from "../selectionCoordinator";
import {
  getNodeRelationshipGraphSnapshot,
  subscribeNodeRelationshipGraph,
} from "../nodes/nodeRelationshipGraph";
import {
  buildNodeRelationshipHierarchyRows,
  collectNodeStructureIDs,
  type NodeRelationshipHierarchyRow,
} from "../nodes/nodeRelationshipStructure";
import { getNodeTitle, type NodeRecord, type NodeRelationship } from "../nodes/types";
import {
  EDITOR_NEU_ACTIVE_SURFACE,
  EDITOR_NEU_EDGE_FRAME,
  EDITOR_NEU_PANEL_SHADOW,
  EDITOR_NEU_SHADOW,
  EDITOR_NEU_SOFT_BORDER,
  EDITOR_NEU_SURFACE,
} from "./NodeWorkspaceSurfaceShared";

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
  relationshipAnchorCenterPx?: number | null;
};

const RELATIONSHIP_DROPDOWN_WIDTH = 430;
const RELATIONSHIP_DROPDOWN_MIN_WIDTH = 292;
const RELATIONSHIP_DROPDOWN_EDGE_GAP = 12;

type RelationshipIconKind = "parent" | "peer" | "child" | "related";

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

function rowIconKind(row: NodeRelationshipHierarchyRow): RelationshipIconKind {
  if (row.role === "Peer") return "peer";
  if (row.role === "Child") return "child";
  if (row.role === "Parent" || row.hasChildren || row.depth === 0) return "parent";
  return "related";
}

function roleColor(kind: RelationshipIconKind, accent: string): string {
  if (kind === "parent") return "#0891b2";
  if (kind === "peer") return "#7c3aed";
  if (kind === "child") return "#059669";
  return accent;
}

function roleLabel(row: NodeRelationshipHierarchyRow, current: boolean): string {
  if (current) return "Current";
  const kind = rowIconKind(row);
  if (kind === "parent") return "Parent";
  if (kind === "peer") return "Peer";
  if (kind === "child") return "Child";
  return "";
}

const RelationshipCheckIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" style={{ display: "block" }}>
    <path d="m3.4 8.15 2.8 2.75 6.35-6.65" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const RelationshipRoleIcon: React.FC<{ kind: RelationshipIconKind; color: string }> = ({ kind, color }) => {
  const boxFill = "rgba(255,255,255,0.9)";
  if (kind === "peer") {
    return (
      <svg aria-hidden="true" width="28" height="28" viewBox="0 0 28 28" style={{ display: "block" }}>
        <path d="M3.5 14h6.1M18.4 14h6.1" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
        <rect x="9.6" y="8.8" width="8.8" height="10.4" rx="2.4" fill={boxFill} stroke={color} strokeWidth="1.8" />
      </svg>
    );
  }
  if (kind === "child") {
    return (
      <svg aria-hidden="true" width="28" height="28" viewBox="0 0 28 28" style={{ display: "block" }}>
        <path d="M14 3.5v7.2" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
        <rect x="9.6" y="10.7" width="8.8" height="10.4" rx="2.4" fill={boxFill} stroke={color} strokeWidth="1.8" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" width="28" height="28" viewBox="0 0 28 28" style={{ display: "block" }}>
      <rect x="9.6" y="6.7" width="8.8" height="10.4" rx="2.4" fill={boxFill} stroke={color} strokeWidth="1.8" />
      <path d="M14 17.1v7.4" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
};

function TreeRow({
  row,
  current,
  hovered,
  accent,
  surfaceText,
  strokeColor,
  onOpen,
  onHover,
}: {
  row: NodeRelationshipHierarchyRow;
  current: boolean;
  hovered: boolean;
  accent: string;
  surfaceText: string;
  strokeColor: string;
  onOpen: (row: NodeRelationshipHierarchyRow) => void;
  onHover: (nodeID: string) => void;
}) {
  const kind = rowIconKind(row);
  const color = current ? accent : roleColor(kind, accent);
  const label = roleLabel(row, current);
  const highlighted = current || hovered;
  return (
    <button
      type="button"
      title={row.title}
      aria-current={current ? "true" : undefined}
      onClick={() => onOpen(row)}
      onMouseEnter={() => onHover(row.nodeID)}
      onMouseLeave={() => onHover("")}
      style={{
        width: "100%",
        minWidth: 0,
        minHeight: 38,
        boxSizing: "border-box",
        display: "grid",
        gridTemplateColumns: "30px minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 8,
        padding: `5px 8px 5px ${10 + row.depth * 18}px`,
        border: highlighted ? "1px solid transparent" : `1px solid ${strokeColor}`,
        borderRadius: 8,
        background: highlighted
          ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, linear-gradient(135deg, rgba(6,182,212,0.8), rgba(124,58,237,0.72), rgba(16,185,129,0.62)) border-box`
          : "rgba(255,255,255,0.7)",
        color: surfaceText,
        cursor: "pointer",
        font: "inherit",
        textAlign: "left",
        boxShadow: highlighted ? `${EDITOR_NEU_SHADOW}, inset 1px 1px 0 rgba(255,255,255,0.86)` : "inset 1px 1px 0 rgba(255,255,255,0.72)",
        transition: "background 140ms ease, border-color 140ms ease, box-shadow 160ms ease, transform 160ms ease",
        transform: hovered && !current ? "translateY(-1px)" : "translateY(0)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          display: "grid",
          placeItems: "center",
          background: `linear-gradient(135deg, rgba(255,255,255,0.95), ${color}22)`,
          boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.86)",
        }}
      >
        <RelationshipRoleIcon kind={kind} color={color} />
      </span>
      <span style={{ minWidth: 0, display: "grid", gap: 2 }}>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: current ? 900 : 780 }}>
          {row.title}
        </span>
        {label && (
          <span style={{ color, fontSize: 9.5, fontWeight: 850, letterSpacing: 0 }}>
            {label}
          </span>
        )}
      </span>
      <span
        aria-hidden="true"
        style={{
          width: 24,
          height: 24,
          borderRadius: 8,
          display: "grid",
          placeItems: "center",
          border: current ? `1px solid ${color}` : `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
          background: current ? "#ffffff" : "rgba(255,255,255,0.56)",
          opacity: current ? 1 : 0,
          boxShadow: current ? "0 6px 14px rgba(15,23,42,0.12)" : undefined,
        }}
      >
        {current && <RelationshipCheckIcon color={color} />}
      </span>
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
  relationshipAnchorCenterPx = null,
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [hoveredNodeID, setHoveredNodeID] = useState("");
  const [graph, setGraph] = useState<{ nodes: NodeRecord[]; relationships: NodeRelationship[] }>(() => {
    const snapshot = getNodeRelationshipGraphSnapshot(apiBase, companyID);
    return { nodes: snapshot.nodes ?? [], relationships: snapshot.relationships ?? [] };
  });

  useEffect(() => {
    const updateGraph = () => {
      const snapshot = getNodeRelationshipGraphSnapshot(apiBase, companyID);
      setGraph({ nodes: snapshot.nodes ?? [], relationships: snapshot.relationships ?? [] });
    };
    updateGraph();
    return subscribeNodeRelationshipGraph(apiBase, companyID, updateGraph);
  }, [apiBase, companyID]);

  useEffect(() => {
    const parent = rootRef.current?.parentElement;
    if (!parent) return;
    const updateWidth = () => setContainerWidth(parent.getBoundingClientRect().width);
    updateWidth();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }
    const observer = new ResizeObserver(updateWidth);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  const rows = useMemo(() => {
    const cleanNodeID = nodeID.trim();
    if (!cleanNodeID) return [];
    const structureIDs = Array.from(collectNodeStructureIDs(cleanNodeID, graph.relationships));
    const requestedIDs = structureIDs.length > 0 ? structureIDs : [cleanNodeID];
    const hasCurrentNode = graph.nodes.some((node) => node.node_id === cleanNodeID);
    const nodes = hasCurrentNode
      ? graph.nodes
      : [
        ...graph.nodes,
        {
          company_id: companyID,
          node_id: cleanNodeID,
          name: nodeTitle.trim() || "Current node",
          created_timestamp: "",
        },
      ];
    return buildNodeRelationshipHierarchyRows({
      nodes,
      relationships: graph.relationships,
      nodeIDs: requestedIDs,
    });
  }, [companyID, graph.nodes, graph.relationships, nodeID, nodeTitle]);

  const titleByNodeID = useMemo(() => {
    const titles = new Map<string, string>();
    for (const node of graph.nodes) titles.set(node.node_id, getNodeTitle(node));
    for (const row of rows) titles.set(row.nodeID, row.title);
    if (nodeID) titles.set(nodeID, nodeTitle || titles.get(nodeID) || nodeID);
    return titles;
  }, [graph.nodes, nodeID, nodeTitle, rows]);

  const openRow = useCallback((row: NodeRelationshipHierarchyRow) => {
    publishLiveSelection({
      companyID,
      entityKind: "node",
      entityID: row.nodeID,
      label: row.title || titleByNodeID.get(row.nodeID) || row.nodeID,
      sourceFrameID: `${scope}:relationships-menu`,
      sourceModule: "editor",
      targetFrameIDs: [scope],
      selectionIntent: "navigate",
    });
  }, [companyID, scope, titleByNodeID]);

  const panelWidth = containerWidth > 0
    ? Math.min(RELATIONSHIP_DROPDOWN_WIDTH, Math.max(RELATIONSHIP_DROPDOWN_MIN_WIDTH, containerWidth - (RELATIONSHIP_DROPDOWN_EDGE_GAP * 2)))
    : RELATIONSHIP_DROPDOWN_WIDTH;
  const anchorCenter = Number.isFinite(relationshipAnchorCenterPx ?? NaN)
    ? relationshipAnchorCenterPx ?? 0
    : containerWidth * 0.58;
  const panelLeft = containerWidth > 0
    ? clampNumber(anchorCenter - (panelWidth / 2), RELATIONSHIP_DROPDOWN_EDGE_GAP, containerWidth - panelWidth - RELATIONSHIP_DROPDOWN_EDGE_GAP)
    : RELATIONSHIP_DROPDOWN_EDGE_GAP;
  const rowCountLabel = `${rows.length} linked`;

  return (
    <div
      ref={rootRef}
      className="mango-editor-hover-highlight"
      onWheel={(event) => event.stopPropagation()}
      style={{
        position: "absolute",
        top: topPx,
        left: panelLeft,
        width: panelWidth,
        maxHeight: `calc(100% - ${topPx + 14}px)`,
        zIndex: 5,
        minHeight: 0,
        display: "grid",
        gridTemplateRows: "auto minmax(0, 1fr)",
        overflow: "hidden",
        border: "1px solid transparent",
        borderRadius: 10,
        background: `${panelBackground} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box`,
        color: surfaceText,
        boxShadow: `${EDITOR_NEU_PANEL_SHADOW}, 0 0 18px rgba(183,124,255,0.18)`,
        cursor: "default",
        pointerEvents: "auto",
      }}
    >
      <div style={{ minWidth: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: 10, padding: "10px 11px 8px", borderBottom: `1px solid ${ruleColor}`, background: `linear-gradient(135deg, rgba(6,182,212,0.12), rgba(255,255,255,0.72) 44%, rgba(124,58,237,0.12))` }}>
        <div style={{ minWidth: 0, display: "grid", gap: 2 }}>
          <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: surfaceText, fontSize: 12, fontWeight: 950 }}>
            Relationship
          </div>
          <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(100,116,139,0.82)", fontSize: 10, fontWeight: 760 }}>
            {nodeTitle || "Current node"}
          </div>
        </div>
        <span style={{ flex: "0 0 auto", border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 999, padding: "3px 7px", background: EDITOR_NEU_SURFACE, color: accent, fontSize: 10, fontWeight: 900, boxShadow: EDITOR_NEU_SHADOW }}>
          {rowCountLabel}
        </span>
      </div>
      <div
        className="editor-document-scroll"
        style={{
          minHeight: 0,
          overflowY: "auto",
          padding: 8,
          display: "grid",
          alignContent: "start",
          gap: 5,
          background: "rgba(255,255,255,0.58)",
          ["--editor-document-scroll-accent" as string]: scrollbarAccent,
          ["--editor-document-scroll-track" as string]: scrollbarTrack,
        }}
      >
        {rows.length === 0 ? (
          <div style={{ border: `1px dashed ${strokeColor}`, borderRadius: 8, padding: 10, color: surfaceText, opacity: 0.68, fontSize: 11, fontWeight: 760 }}>
            No related nodes
          </div>
        ) : rows.map((row) => (
          <TreeRow
            key={`${row.nodeID}:${row.depth}`}
            row={row}
            current={row.nodeID === nodeID}
            hovered={hoveredNodeID === row.nodeID}
            accent={accent}
            surfaceText={surfaceText}
            strokeColor={strokeColor}
            onOpen={openRow}
            onHover={setHoveredNodeID}
          />
        ))}
      </div>
    </div>
  );
};
