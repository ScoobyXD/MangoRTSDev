import React, { useCallback, useEffect, useMemo, useState } from "react";
import { fetchCurrentUser } from "../../auth/cognitoAuth.js";
import { getActiveCompanyID } from "../../auth/currentCompany.js";
import { listCompanyUsers, type CompanyUser } from "../communications/communicationsApi.js";
import { ExplorerRowIcon } from "../company-explorer/CompanyExplorerIcons.js";
import { buildEditorTextBlockContentPayload, EDITOR_TEXT_BLOCK_TYPE, listEditorTextBlockProjections, parseEditorTextBlockContent } from "../editor/editorProjection.js";
import { generateStableInformationID } from "../editor/editorTypes.js";
import { NodeTextBlockEditor } from "../editor/NodeWorkspaceSurfaceParts.js";
import { useEditorPreferences } from "../editor/useEditorPreferences.js";
import {
  addProjectInformation,
  deleteProjectProjection,
  fetchProjectView,
  upsertProjectRelationship,
  type ProjectProjection,
  type ProjectRecord,
  type ProjectRelationshipProjection,
} from "./projectManagementApi.js";

type ProjectSummaryContentProps = {
  projectID: string;
  accent: string;
  onBack: () => void;
  onNodeOpen?: (nodeID: string) => void;
  onLogicGateOpen?: (logicGateID: string) => void;
};

type ProjectTextBlockDraft = {
  id: string;
  title: string;
  document: string;
  createdTimestamp: string;
};

type ProjectRelationshipGroup = {
  gate: ProjectRelationshipProjection;
  nodes: ProjectRelationshipProjection[];
};

const PROJECT_SUMMARY_SURFACE_TEXT = "#172033";
const PROJECT_SUMMARY_RULE = "rgba(91, 141, 239, 0.24)";

export const ProjectSummaryContent: React.FC<ProjectSummaryContentProps> = ({
  projectID,
  accent,
  onBack,
  onNodeOpen,
  onLogicGateOpen,
}) => {
  const companyID = getActiveCompanyID();
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [blocks, setBlocks] = useState<ProjectTextBlockDraft[]>([]);
  const [relationships, setRelationships] = useState<ProjectRelationshipProjection[]>([]);
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([]);
  const [currentUserID, setCurrentUserID] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingID, setSavingID] = useState("");
  const [error, setError] = useState("");
  const [gateIDDraft, setGateIDDraft] = useState("");
  const [nodeIDDraft, setNodeIDDraft] = useState("");
  const { outlineStyle, setOutlineStyle } = useEditorPreferences(`project-summary-outline-style-v1:${companyID}:${projectID}`);

  const loadProject = useCallback(async () => {
    const cleanProjectID = projectID.trim();
    if (!companyID || !cleanProjectID) return;
    setLoading(true);
    setError("");
    try {
      const [view, current, users] = await Promise.all([
        fetchProjectView(companyID, cleanProjectID),
        fetchCurrentUser().catch(() => null),
        listCompanyUsers(companyID).catch(() => [] as CompanyUser[]),
      ]);
      setProject(view.project);
      setRelationships(view.relationships ?? []);
      setCompanyUsers(users);
      setCurrentUserID(current?.user.user_id.trim() ?? "");
      setBlocks(blockDraftsFromProjections(view.projections ?? []));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load project");
    } finally {
      setLoading(false);
    }
  }, [companyID, projectID]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

  const relationshipGroups = useMemo(() => buildRelationshipGroups(relationships), [relationships]);
  const ungroupedNodes = useMemo(() => {
    const groupedNodeIDs = new Set(relationshipGroups.flatMap((group) => group.nodes.map((node) => node.relationship_id)));
    return relationships
      .filter((item) => item.resource_type === "node" && !groupedNodeIDs.has(item.relationship_id))
      .sort(compareRelationshipProjection);
  }, [relationshipGroups, relationships]);

  const updateBlockDocument = useCallback((blockID: string, document: string) => {
    setBlocks((current) => current.map((block) => block.id === blockID ? { ...block, document } : block));
  }, []);

  const saveTextBlock = useCallback(async (block: ProjectTextBlockDraft, document: string) => {
    setSavingID(block.id);
    setError("");
    try {
      const information = buildEditorTextBlockContentPayload({ title: block.title, document, attachments: [] });
      await addProjectInformation({
        companyID,
        projectID,
        informationID: block.id,
        type: EDITOR_TEXT_BLOCK_TYPE,
        information,
      });
      setBlocks((current) => current.map((item) => item.id === block.id ? { ...item, document } : item));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save project text");
    } finally {
      setSavingID("");
    }
  }, [companyID, projectID]);

  const addTextBlock = useCallback(async () => {
    const id = generateStableInformationID();
    const nextBlock: ProjectTextBlockDraft = {
      id,
      title: "Project Summary",
      document: "",
      createdTimestamp: new Date().toISOString(),
    };
    setBlocks((current) => [nextBlock, ...current]);
    await saveTextBlock(nextBlock, "");
  }, [saveTextBlock]);

  const removeTextBlock = useCallback(async (blockID: string) => {
    const previous = blocks;
    setBlocks((current) => current.filter((block) => block.id !== blockID));
    setError("");
    try {
      await deleteProjectProjection({ companyID, projectID, informationID: blockID });
    } catch (deleteError) {
      setBlocks(previous);
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete project text");
    }
  }, [blocks, companyID, projectID]);

  const addRelationship = useCallback(async (resourceType: "logic_gate" | "node", value: string) => {
    const resourceID = value.trim();
    if (!resourceID) return;
    setError("");
    try {
      await upsertProjectRelationship({
        companyID,
        projectID,
        resourceType,
        resourceID,
        position: relationships.length + 1,
      });
      if (resourceType === "logic_gate") setGateIDDraft("");
      else setNodeIDDraft("");
      await loadProject();
    } catch (relationshipError) {
      setError(relationshipError instanceof Error ? relationshipError.message : "Failed to add relationship");
    }
  }, [companyID, loadProject, projectID, relationships.length]);

  if (loading) {
    return <div style={summaryLoadingStyle}>Loading</div>;
  }

  return (
    <div style={summaryShellStyle}>
      <div style={summaryHeaderStyle}>
        <button type="button" style={backButtonStyle} onClick={onBack}>{"<"} Project Management</button>
        <div style={summaryTitleClusterStyle}>
          <div style={summaryEyebrowStyle}>Project Summary</div>
          <h2 style={summaryTitleStyle}>{project?.name || projectID}</h2>
        </div>
        <div style={summaryMetaPillsStyle}>
          <span style={statusPillStyle(accent)}>{project?.status || "Active"}</span>
          {project?.account_name ? <span style={plainPillStyle}>{project.account_name}</span> : null}
          {project?.team_name ? <span style={plainPillStyle}>{project.team_name}</span> : null}
        </div>
      </div>
      {error ? <div style={summaryErrorStyle}>{error}</div> : null}
      <div style={summaryBodyStyle}>
        <section style={textColumnStyle}>
          <div style={columnToolbarStyle}>
            <div style={columnTitleStyle}>Timeline</div>
            <div style={toolbarActionsStyle}>
              <div role="group" aria-label="Outline style" style={outlineToggleStyle}>
                <button
                  type="button"
                  style={outlineToggleButtonStyle(outlineStyle === "indent-guides")}
                  onClick={() => setOutlineStyle("indent-guides")}
                >
                  Indent
                </button>
                <button
                  type="button"
                  style={outlineToggleButtonStyle(outlineStyle === "automatic-outline-numbering")}
                  onClick={() => setOutlineStyle("automatic-outline-numbering")}
                >
                  A1
                </button>
              </div>
              <button type="button" style={primaryButtonStyle(accent)} onClick={() => void addTextBlock()}>New Text Box</button>
            </div>
          </div>
          <div className="kanban-board-scroll" style={textBlocksScrollStyle}>
            {blocks.map((block) => (
              <div key={block.id} style={textBlockShellStyle}>
                <div style={textBlockHeaderStyle}>
                  <input
                    value={block.title}
                    onChange={(event) => {
                      const title = event.currentTarget.value;
                      setBlocks((current) => current.map((item) => item.id === block.id ? { ...item, title } : item));
                    }}
                    onBlur={() => void saveTextBlock(block, block.document)}
                    style={textBlockTitleInputStyle}
                    aria-label="Text box title"
                  />
                  <div style={textBlockHeaderActionsStyle}>
                    {savingID === block.id ? <span style={savingStyle}>Saving</span> : null}
                    <button type="button" style={deleteButtonStyle} onClick={() => void removeTextBlock(block.id)}>Delete</button>
                  </div>
                </div>
                <NodeTextBlockEditor
                  blockID={block.id}
                  editable
                  nodeID={`project:${projectID}`}
                  companyID={companyID}
                  currentUserID={currentUserID || "local-user"}
                  companyUsers={companyUsers}
                  documentValue={block.document}
                  contentChanges={[]}
                  chatMessages={[]}
                  activeChatAnchorMessageID=""
                  chatNavigationRequest={null}
                  tableInsertRequestID={0}
                  surfaceText={PROJECT_SUMMARY_SURFACE_TEXT}
                  accent={accent}
                  outlineStyle={outlineStyle}
                  indentGuideColor={PROJECT_SUMMARY_RULE}
                  scrollbarTrack="rgba(15, 23, 42, 0.08)"
                  onFocus={() => undefined}
                  onBlur={() => undefined}
                  onDocumentChange={(document) => updateBlockDocument(block.id, document)}
                  onDocumentFlush={(document) => {
                    updateBlockDocument(block.id, document);
                    void saveTextBlock(block, document);
                  }}
                  onChangeSeen={() => undefined}
                  onSelectionChatRequest={() => undefined}
                  onImageChatRequest={() => undefined}
                  onImageNodeRequest={() => undefined}
                />
              </div>
            ))}
            {blocks.length === 0 ? (
              <button type="button" style={emptyTextButtonStyle} onClick={() => void addTextBlock()}>
                New Text Box
              </button>
            ) : null}
          </div>
        </section>
        <aside style={relationshipsColumnStyle}>
          <div style={columnToolbarStyle}>
            <div style={columnTitleStyle}>Logic Gates / Nodes</div>
          </div>
          <div style={relationshipInputsStyle}>
            <input
              value={gateIDDraft}
              onChange={(event) => setGateIDDraft(event.currentTarget.value)}
              placeholder="Logic gate ID"
              style={relationshipInputStyle}
            />
            <button type="button" style={secondaryActionButtonStyle} onClick={() => void addRelationship("logic_gate", gateIDDraft)}>Add Gate</button>
            <input
              value={nodeIDDraft}
              onChange={(event) => setNodeIDDraft(event.currentTarget.value)}
              placeholder="Node ID"
              style={relationshipInputStyle}
            />
            <button type="button" style={secondaryActionButtonStyle} onClick={() => void addRelationship("node", nodeIDDraft)}>Add Node</button>
          </div>
          <div className="kanban-board-scroll" style={relationshipScrollStyle}>
            {relationshipGroups.map((group) => (
              <div key={group.gate.relationship_id} style={gateGroupStyle}>
                <button
                  type="button"
                  style={logicGateBoxStyle}
                  onDoubleClick={() => group.gate.logic_gate_id && onLogicGateOpen?.(group.gate.logic_gate_id)}
                >
                  <span style={relationshipIconStyle}><ExplorerRowIcon kind="logic_gate" /></span>
                  <span style={relationshipTitleStyle}>{group.gate.display_title}</span>
                  <span style={relationshipStatusStyle}>{group.gate.status || "Logic Gate"}</span>
                </button>
                <div style={nestedNodesStyle}>
                  {group.nodes.map((node) => (
                    <button
                      key={node.relationship_id}
                      type="button"
                      style={nestedNodeStyle}
                      onDoubleClick={() => node.node_id && onNodeOpen?.(node.node_id)}
                    >
                      <span style={relationshipIconStyle}><ExplorerRowIcon kind="node" /></span>
                      <span style={relationshipTitleStyle}>{node.display_title}</span>
                      {node.status ? <span style={nodeStatusDotStyle(node.status_color)} /> : null}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {ungroupedNodes.length > 0 ? (
              <div style={gateGroupStyle}>
                <div style={ungroupedHeaderStyle}>Nodes</div>
                <div style={nestedNodesStyle}>
                  {ungroupedNodes.map((node) => (
                    <button
                      key={node.relationship_id}
                      type="button"
                      style={nestedNodeStyle}
                      onDoubleClick={() => node.node_id && onNodeOpen?.(node.node_id)}
                    >
                      <span style={relationshipIconStyle}><ExplorerRowIcon kind="node" /></span>
                      <span style={relationshipTitleStyle}>{node.display_title}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {relationshipGroups.length === 0 && ungroupedNodes.length === 0 ? (
              <div style={emptyRelationshipStyle}>No relationships</div>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
};

function blockDraftsFromProjections(projections: ProjectProjection[]): ProjectTextBlockDraft[] {
  return listEditorTextBlockProjections(projections).map((projection) => {
    const content = parseEditorTextBlockContent(projection.information);
    return {
      id: projection.information_id,
      title: content.title || "Project Summary",
      document: content.document,
      createdTimestamp: projection.created_timestamp ?? "",
    };
  });
}

function compareRelationshipProjection(left: ProjectRelationshipProjection, right: ProjectRelationshipProjection): number {
  return (left.position ?? 0) - (right.position ?? 0)
    || left.display_title.localeCompare(right.display_title, undefined, { numeric: true, sensitivity: "base" })
    || left.relationship_id.localeCompare(right.relationship_id);
}

function buildRelationshipGroups(relationships: ProjectRelationshipProjection[]): ProjectRelationshipGroup[] {
  const gates = relationships
    .filter((item) => item.resource_type === "logic_gate" && item.logic_gate_id)
    .sort(compareRelationshipProjection);
  const nodesByGateID = new Map<string, ProjectRelationshipProjection[]>();
  for (const node of relationships.filter((item) => item.resource_type === "node")) {
    const gateID = node.logic_gate_id?.trim() ?? "";
    if (!gateID) continue;
    const bucket = nodesByGateID.get(gateID) ?? [];
    bucket.push(node);
    nodesByGateID.set(gateID, bucket);
  }
  return gates.map((gate) => ({
    gate,
    nodes: [...(nodesByGateID.get(gate.logic_gate_id ?? "") ?? [])].sort(compareRelationshipProjection),
  }));
}

const summaryShellStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  background: "#f8fbff",
  color: PROJECT_SUMMARY_SURFACE_TEXT,
};

const summaryLoadingStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "grid",
  placeItems: "center",
  color: "#64748b",
  fontWeight: 700,
};

const summaryHeaderStyle: React.CSSProperties = {
  minHeight: 78,
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: "12px 18px",
  borderBottom: "1px solid rgba(148, 163, 184, 0.28)",
  background: "#ffffff",
  flexShrink: 0,
};

const backButtonStyle: React.CSSProperties = {
  minHeight: 34,
  border: "1px solid rgba(91, 141, 239, 0.32)",
  borderRadius: 8,
  background: "#ffffff",
  color: "#1d4ed8",
  fontWeight: 800,
  cursor: "pointer",
  padding: "0 12px",
};

const summaryTitleClusterStyle: React.CSSProperties = {
  minWidth: 0,
  flex: "1 1 auto",
};

const summaryEyebrowStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase",
  color: "#64748b",
  letterSpacing: 0,
};

const summaryTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 22,
  lineHeight: 1.1,
  fontWeight: 850,
  color: "#0f172a",
  letterSpacing: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const summaryMetaPillsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
  justifyContent: "flex-end",
};

const statusPillStyle = (accent: string): React.CSSProperties => ({
  minHeight: 28,
  display: "inline-flex",
  alignItems: "center",
  borderRadius: 999,
  padding: "0 10px",
  background: `${accent}18`,
  color: "#1d4ed8",
  fontSize: 12,
  fontWeight: 800,
});

const plainPillStyle: React.CSSProperties = {
  minHeight: 28,
  display: "inline-flex",
  alignItems: "center",
  borderRadius: 999,
  padding: "0 10px",
  background: "#eef2f7",
  color: "#334155",
  fontSize: 12,
  fontWeight: 700,
};

const summaryErrorStyle: React.CSSProperties = {
  margin: "10px 18px 0",
  padding: "9px 12px",
  border: "1px solid rgba(220, 38, 38, 0.28)",
  borderRadius: 8,
  background: "#fff1f2",
  color: "#991b1b",
  fontWeight: 700,
  fontSize: 13,
};

const summaryBodyStyle: React.CSSProperties = {
  minHeight: 0,
  flex: "1 1 auto",
  display: "grid",
  gridTemplateColumns: "minmax(360px, 1fr) minmax(320px, 44%)",
  gap: 14,
  padding: 14,
};

const textColumnStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
};

const relationshipsColumnStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  borderLeft: "1px solid rgba(148, 163, 184, 0.26)",
  paddingLeft: 14,
};

const columnToolbarStyle: React.CSSProperties = {
  minHeight: 40,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  flexShrink: 0,
};

const columnTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 850,
  color: "#0f172a",
};

const toolbarActionsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
  justifyContent: "flex-end",
};

const outlineToggleStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: 3,
  borderRadius: 999,
  background: "#e2e8f0",
  gap: 2,
};

const outlineToggleButtonStyle = (active: boolean): React.CSSProperties => ({
  minHeight: 26,
  border: 0,
  borderRadius: 999,
  padding: "0 10px",
  background: active ? "#ffffff" : "transparent",
  color: active ? "#0f172a" : "#64748b",
  fontWeight: 800,
  cursor: "pointer",
});

const primaryButtonStyle = (accent: string): React.CSSProperties => ({
  minHeight: 32,
  border: 0,
  borderRadius: 8,
  background: accent,
  color: "#ffffff",
  padding: "0 12px",
  fontWeight: 850,
  cursor: "pointer",
  boxShadow: "0 8px 18px rgba(37, 99, 235, 0.16)",
});

const textBlocksScrollStyle: React.CSSProperties = {
  minHeight: 0,
  flex: "1 1 auto",
  overflow: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 12,
  paddingRight: 4,
};

const textBlockShellStyle: React.CSSProperties = {
  border: "1px solid rgba(148, 163, 184, 0.28)",
  borderRadius: 8,
  background: "#ffffff",
  boxShadow: "0 10px 26px rgba(15, 23, 42, 0.05)",
  overflow: "hidden",
};

const textBlockHeaderStyle: React.CSSProperties = {
  minHeight: 42,
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "7px 10px",
  borderBottom: "1px solid rgba(148, 163, 184, 0.20)",
};

const textBlockTitleInputStyle: React.CSSProperties = {
  minWidth: 0,
  flex: "1 1 auto",
  minHeight: 28,
  border: "1px solid transparent",
  borderRadius: 6,
  background: "transparent",
  color: "#0f172a",
  fontWeight: 850,
  fontSize: 14,
  outline: "none",
};

const textBlockHeaderActionsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const savingStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#64748b",
  fontWeight: 700,
};

const deleteButtonStyle: React.CSSProperties = {
  minHeight: 28,
  border: "1px solid rgba(220, 38, 38, 0.24)",
  borderRadius: 7,
  background: "#fff7f7",
  color: "#b91c1c",
  padding: "0 9px",
  fontWeight: 800,
  cursor: "pointer",
};

const emptyTextButtonStyle: React.CSSProperties = {
  minHeight: 120,
  border: "1px dashed rgba(91, 141, 239, 0.45)",
  borderRadius: 8,
  background: "#ffffff",
  color: "#1d4ed8",
  fontWeight: 850,
  cursor: "pointer",
};

const relationshipInputsStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 8,
  padding: "6px 0 12px",
  flexShrink: 0,
};

const relationshipInputStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 34,
  border: "1px solid rgba(148, 163, 184, 0.45)",
  borderRadius: 7,
  padding: "0 10px",
  color: "#0f172a",
  background: "#ffffff",
};

const secondaryActionButtonStyle: React.CSSProperties = {
  minHeight: 34,
  border: "1px solid rgba(15, 23, 42, 0.12)",
  borderRadius: 7,
  background: "#ffffff",
  color: "#0f172a",
  fontWeight: 800,
  cursor: "pointer",
  padding: "0 10px",
};

const relationshipScrollStyle: React.CSSProperties = {
  minHeight: 0,
  flex: "1 1 auto",
  overflow: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 12,
  paddingRight: 4,
};

const gateGroupStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const logicGateBoxStyle: React.CSSProperties = {
  width: "min(100%, 184px)",
  aspectRatio: "1 / 1",
  border: "1px solid rgba(16, 185, 129, 0.36)",
  borderRadius: 8,
  background: "#f3fff8",
  color: "#065f46",
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  justifyContent: "space-between",
  padding: 12,
  textAlign: "left",
  cursor: "pointer",
};

const nestedNodesStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  paddingLeft: 22,
};

const nestedNodeStyle: React.CSSProperties = {
  minHeight: 40,
  border: "1px solid rgba(14, 165, 233, 0.24)",
  borderRadius: 8,
  background: "#ffffff",
  color: "#0f172a",
  display: "grid",
  gridTemplateColumns: "18px minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 8,
  padding: "0 10px",
  textAlign: "left",
  cursor: "pointer",
};

const relationshipIconStyle: React.CSSProperties = {
  width: 18,
  height: 18,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const relationshipTitleStyle: React.CSSProperties = {
  minWidth: 0,
  fontWeight: 850,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const relationshipStatusStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#047857",
  fontWeight: 800,
};

const nodeStatusDotStyle = (color?: string | null): React.CSSProperties => ({
  width: 9,
  height: 9,
  borderRadius: 999,
  background: color || "#38bdf8",
});

const ungroupedHeaderStyle: React.CSSProperties = {
  color: "#64748b",
  fontSize: 12,
  fontWeight: 850,
  textTransform: "uppercase",
  letterSpacing: 0,
};

const emptyRelationshipStyle: React.CSSProperties = {
  minHeight: 100,
  border: "1px dashed rgba(148, 163, 184, 0.42)",
  borderRadius: 8,
  display: "grid",
  placeItems: "center",
  color: "#64748b",
  fontWeight: 800,
  background: "#ffffff",
};
