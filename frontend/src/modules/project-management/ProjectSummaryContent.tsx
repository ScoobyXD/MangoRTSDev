import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ConfirmActionMenu, confirmMenuPositionFromElement, type ConfirmActionMenuPosition } from "../../app/ConfirmActionMenu.js";
import { AppModalPortal } from "../../app/AppModalPortal.js";
import { requestAppDockTab } from "../../app/appDockTabs.js";
import { buildLogicGateRoute } from "../../app/deepLinkRoutes.js";
import {
  projectWorkPanelTabFromHistoryState,
  replaceProjectWorkPanelHistoryState,
  type ProjectLogicGateReturnContext,
  type ProjectWorkPanelTab,
} from "../../app/projectRouteHistory.js";
import { buildContextualNodeRoute, openAppPathInNewTab } from "../../app/resourceLinks.js";
import { requestAppSidebarPin } from "../../app/sidebarPins.js";
import { fetchCurrentUser, readAuthConfig } from "../../auth/cognitoAuth.js";
import { getActiveCompanyID } from "../../auth/currentCompany.js";
import { useCompanyAccounts } from "../accounts/AccountFilterControl.js";
import type { Account } from "../accounts/accountsApi.js";
import { convertTriageMessagesToExplorerTarget, listCompanyUserGroups, listCompanyUsers, type CommunicationsTriageConversionTarget, type CompanyUser, type CompanyUserGroup } from "../communications/communicationsApi.js";
import { EXPLORER_DRAG_MIME, readExplorerDragPayload } from "../company-explorer/companyExplorerDragDrop.js";
import {
  foldCommittedEntityTitlesSince,
  readCommittedEntityTitleVersion,
  subscribeCommittedEntityTitleUpdates,
} from "../realtime/committedEntityTitleUpdates.js";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../../icons/index.js";
import { CompanyExplorerSearchBox } from "../company-explorer/CompanyExplorerSearchBox.js";
import { fetchCompanyExplorerBranchResourceIDs, fetchCompanyExplorerSearchResults, type CompanyExplorerSearchResult } from "../company-explorer/companyExplorerLazyApi.js";
import { reconcileCompanyExplorerSearchResultTitles } from "../company-explorer/companyExplorerStore.js";
import { buildCompanyExplorerSearchTreeRows } from "../company-explorer/companyExplorerTreeRows.js";
import type { ExplorerTreeNode } from "../company-explorer/companyExplorerTypes.js";
import { getExplorerDropPayloadItems, getExplorerDropPayloadItemType, type ExplorerDropPayload } from "../company-explorer/treePresentation.js";
import { createRequestJSON } from "../api/requestJSON.js";
import { HierarchyBreadcrumb } from "../hierarchy/HierarchyBreadcrumb.js";
import { emitExplorerContextUpdated } from "../dashboardEvents.js";
import { openEditorEntityLink, type EditorEntityLink } from "../editor/editorEntityLinks.js";
import { UniversalEntityPicker, type UniversalEntityPickerAnchor, type UniversalEntityPickerMode } from "../editor/UniversalEntityPicker.js";
import { UniversalLinkerControls } from "../editor/UniversalLinkerControls.js";
import {
  buildEditorAttachedEmailPayload,
  buildEditorTextBlockChatPayload,
  EDITOR_ATTACHED_EMAIL_TYPE,
  EDITOR_TEXT_BLOCK_CHAT_TYPE,
  canEditEditorTextBlockChatMessage,
  listEditorTextBlockProjections,
  parseEditorAttachedEmails,
  parseEditorTextBlockChats,
  parseEditorTextBlockContent,
  type EditorAttachedEmail,
  type EditorChatAttachment,
  type EditorTextBlockContent,
  type EditorTextBlockChatMessage,
} from "../editor/editorProjection.js";
import { remapEditorChatEntityLinks, trimEditorChatDraft, type EditorChatEntityLink } from "../editor/chatEntityLinks.js";
import { mentionUserDisplayName, splitTextByMentions, type MentionableCompanyUser } from "../editor/editorMentions.js";
import { EditorTabBar } from "../editor/EditorTabBar.js";
import { EDITOR_PRIMARY_HEADER_TAB_IDS } from "../editor/editorTabs.js";
import { EditorContent } from "../editor/EditorContent.js";
import { EditorSavedTimestamp, EditorSaveStatusIcon, editorSaveNeedsFailureAttention } from "../editor/EditorSaveStatusIcon.js";
import { mangoTiptapPendingStorageKey } from "../editor/tiptap/mangoTiptapSync.js";
import { createTextBlockProjectionSaveController, type TextBlockProjectionSaveController } from "../editor/nodeTextBlockProjectionSaves.js";
import {
  editorChatAttachmentsReadyForSubmit,
  failEditorChatAttachmentTransfer,
  resolveEditorChatAttachmentTransfer,
  stageEditorChatAttachmentTransfer,
  transferTextBlockImageToChatDraft,
} from "../editor/nodeTextBlockAttachments.js";
import { prepareTextBlockImageFile } from "../editor/nodeTextBlockImageFiles.js";
import { generateStableInformationID } from "../editor/editorTypes.js";
import { createEditorScrollMemory } from "../editor/editorScroll.js";
import { scheduleTransientInformationFocus } from "../editor/transientInformationFocus.js";
import {
  resolveTextBlockViewportGeometry,
  TEXT_BLOCK_ROW_GAP,
  useBoundedEditorRowVirtualization,
} from "../editor/editorRowVirtualization.js";
import {
  UnifiedNodeShell,
  UnifiedNodeShellFullscreenIcon,
  UNIFIED_NODE_SHELL_CLOSE_BUTTON_TEMPLATE_STYLE,
} from "../editor/UnifiedNodeShell.js";
import {
  NODE_EDITOR_FULLSCREEN_HORIZONTAL_INSET_PX,
  NODE_EDITOR_FULLSCREEN_VERTICAL_INSET_PX,
  setNodeEditorFullscreenChromeActive,
} from "../editor/nodeEditorFullscreenChrome.js";
import type { EditorHighlightColor } from "../editor/richTextEditing.js";
import type { EditorDocumentFormattingController, EditorSelectionInlineFormatState, EditorTextAlignment } from "../editor/useEditorDocumentSurfaceHandlers.js";
import {
  AttachedEmailOrganizerPane,
  AttachmentCountDropdown,
  ChatPane,
  LinkedEmailPreviewPane,
  NodeTextBlockEditor,
  TextBlockActionsMenu,
  TimelineCell,
  type EmailChatHighlightsByMessageID,
} from "../editor/NodeWorkspaceSurfaceParts.js";
import {
  EDITOR_NEU_ACTIVE_SURFACE,
  EDITOR_NEU_EDGE_FRAME,
  EDITOR_NEU_PANEL_BACKGROUND,
  EDITOR_NEU_SHADOW,
  EDITOR_NEU_SOFT_BORDER,
  EDITOR_NEU_SURFACE,
  MailIcon,
  messageAttachmentPayload,
  PaperclipIcon,
  ChatIcon,
  TextEditorIcon,
  TEXT_BLOCK_FONT_SIZE,
  uploadEditorAttachment,
  type TextBlockImageDraft,
  type TextBlockSelectionDraft,
} from "../editor/NodeWorkspaceSurfaceShared.js";
import { useEditorPreferences } from "../editor/useEditorPreferences.js";
import {
  EMAIL_MESSAGE_TEXT_BOX_LINK_DRAG_MIME,
  createEmailSelectionDocument,
  linkedEmailMessageAccents,
  moveEmailChatComposerEntry,
  nextEmailTextBoxColor,
  parseEmailMessageTextBoxLinkDrag,
  textBoxHasLinkedEmailMessage,
} from "../editor/email/emailTextBoxRelationships.js";
import { useMangoEditorDataFormat } from "../editor/editorDataFormat.js";
import {
  markEditorHistoryChanged,
  registerEditorHistoryExitSaver,
  saveEditorHistory,
  type EditorHistoryResourceRef,
} from "../editor/editorExitHistory.js";
import { flushMangoTiptapDocument, flushMangoTiptapResource } from "../editor/tiptap/mangoTiptapFlushRegistry.js";
import { setEntityFieldAssignments, type EntityField } from "../fields/entityFieldsApi.js";
import { UniversalGroupingControls } from "../grouping/UniversalGroupingControls.js";
import {
  filterMangoResourceAttachments,
  invalidateMangoResourceAttachmentsCache,
  listMangoResourceAttachments,
  type MangoResourceAttachment,
} from "../attachments/attachmentApi.js";
import { moveLogicGateAssignment } from "../kanban/kanbanApi.js";
import type { NodeRecord } from "../nodes/types.js";
import { dispatchTriageConversionApplied } from "../triage/triageEvents.js";
import { hasTriageMessageDrag, normalizeTriageMessageIDs, readTriageMessageDrag } from "../triage/triageDragDrop.js";
import { EntityPermissionsDialog } from "../permissions/EntityPermissionsDialog.js";
import {
  addProjectInformation,
  deleteProjectManagementLogicGate,
  deleteProjectManagementNode,
  deleteProjectCriticalPathStep,
  createProjectNode,
  deleteProjectProjection,
  editProjectChatComment,
  deleteProjectRelationship,
  fetchProjectView,
  updateProject,
  upsertProjectCriticalPathStep,
  upsertProjectRelationship,
  type ProjectCriticalPathStep,
  type ProjectHealth,
  type ProjectInformation,
  type ProjectProjection,
  type ProjectRecord,
  type ProjectRelationshipProjection,
} from "./projectManagementApi.js";
import {
  ProjectFieldControl,
  PROJECT_HEALTH_CHOICES,
  projectStatusChoices,
  type ProjectFieldTone,
} from "./ProjectFieldControl.js";
import {
  reconcileProjectResourceDisplayTitles,
  reconcileRelationshipContextTitle,
  reconcileSelectedNodeTitle,
} from "./projectManagementCommittedTitles.js";
import {
  buildProjectRelationshipGroupingModel,
  buildVisibleProjectLogicGateIndex,
  collectProjectRelationshipGroupIDs,
  DEFAULT_PROJECT_RELATIONSHIP_GROUPINGS,
  flattenVisibleProjectRelationshipLeafRows,
  normalizeProjectRelationshipGroupingStack,
  PROJECT_RELATIONSHIP_GROUPING_FIELDS,
  type ProjectRelationshipGroupingSetting,
  type ProjectRelationshipNestedGroup,
} from "./projectRelationshipGrouping.js";

function projectChatMentionedUserIDs(draft: string, users: MentionableCompanyUser[]): string[] {
  const aliasCounts = new Map<string, number>();
  for (const user of users) {
    const alias = mentionUserDisplayName(user).trim().toLowerCase();
    if (alias) aliasCounts.set(alias, (aliasCounts.get(alias) ?? 0) + 1);
  }
  const unambiguousUsers = users.filter((user) => aliasCounts.get(mentionUserDisplayName(user).trim().toLowerCase()) === 1);
  return Array.from(new Set(splitTextByMentions(draft, unambiguousUsers)
    .filter((segment) => segment.mention)
    .map((segment) => segment.user?.user_id.trim() ?? "")
    .filter(Boolean)));
}

type ProjectSummaryContentProps = {
  projectID: string;
  entityFields: EntityField[];
  showFieldMetadata?: boolean;
  focusInformationID?: string;
  focusMentionUserID?: string;
  focusRequestID?: number;
  accent: string;
  refreshToken?: number;
  onNodeOpen?: (nodeID: string) => void;
  onProjectUpdated?: (project: ProjectRecord) => void;
  onLogicGateOpen?: (logicGateID: string, label?: string, returnContext?: ProjectLogicGateReturnContext) => void;
  onOpenInNewTab?: () => void;
  onCollapseToTab?: (target: { projectID: string; label: string }) => void;
  workspace?: ProjectSummaryWorkspaceSnapshot;
};

type ProjectTextBlockDraft = {
  id: string;
  title: string;
  document: string;
  attachments: EditorChatAttachment[];
  linkedEmailMessageIDs: string[];
  stagedEmailMessageID?: string;
  temporaryEmailChat?: boolean;
  color?: string;
  createdTimestamp: string;
  updatedTimestamp: string;
};

const PROJECT_SAVED_VERSION_TYPE = "Saved version";
const PROJECT_SAVED_VERSION_PREFIX = "MANGO_PROJECT_SAVE_V1:";

type ProjectSavedVersionBlockDTO = {
  id: string;
  title: string;
  document: string;
  attachments: EditorChatAttachment[];
  createdTimestamp: string;
  updatedTimestamp: string;
};

type ProjectSavedVersionSnapshot = {
  name: string;
  blocks: ProjectSavedVersionBlockDTO[];
};

type ProjectSavedVersion = {
  item: ProjectInformation;
  snapshot: ProjectSavedVersionSnapshot;
};

function parseProjectSavedVersion(item: ProjectInformation): ProjectSavedVersion | null {
  if (item.type !== PROJECT_SAVED_VERSION_TYPE || !item.information.startsWith(PROJECT_SAVED_VERSION_PREFIX)) return null;
  try {
    const snapshot = JSON.parse(item.information.slice(PROJECT_SAVED_VERSION_PREFIX.length)) as ProjectSavedVersionSnapshot;
    if (!snapshot || !Array.isArray(snapshot.blocks)) return null;
    return { item, snapshot };
  } catch {
    return null;
  }
}

function projectSavedDocumentText(serialized: string): string {
  try {
    const envelope = JSON.parse(serialized) as { document?: unknown };
    const parts: string[] = [];
    const visit = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      const node = value as { text?: unknown; content?: unknown };
      if (typeof node.text === "string") parts.push(node.text);
      if (Array.isArray(node.content)) {
        for (const child of node.content) visit(child);
        if (node.content.length > 0) parts.push("\n");
      }
    };
    visit(envelope.document);
    return parts.join("").replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    return serialized.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
}

const ProjectSavedVersionsDialog: React.FC<{
  versions: ProjectSavedVersion[];
  selectedID: string;
  saving: boolean;
  restoring: boolean;
  onSelect: (id: string) => void;
  onExitPreview: () => void;
  onSave: () => void;
  onRestore: (version: ProjectSavedVersion) => void;
  onClose: () => void;
}> = ({ versions, selectedID, saving, restoring, onSelect, onExitPreview, onSave, onRestore, onClose }) => {
  const selected = versions.find((version) => version.item.information_id === selectedID) ?? null;
  return (
    <AppModalPortal>
      <div role="dialog" aria-modal="true" aria-label="Project saved versions" style={{ position: "fixed", inset: 0, zIndex: 1800, display: "grid", placeItems: "center", padding: 24, background: "rgba(15,23,42,0.48)" }}>
        <div style={{ width: "min(1120px, 96vw)", maxHeight: "92vh", display: "grid", gridTemplateRows: "auto minmax(0,1fr)", border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 14, background: "#f8fafc", boxShadow: "0 24px 70px rgba(15,23,42,0.28)", overflow: "hidden" }}>
          <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 14px", borderBottom: `1px solid ${EDITOR_NEU_SOFT_BORDER}` }}>
            <div><strong>Project saved versions</strong><div style={{ fontSize: 10.5, color: "#64748b", marginTop: 2 }}>Manual snapshots stored in Project textbox history</div></div>
            <div style={{ display: "flex", gap: 7 }}>
              <button type="button" disabled={saving} onClick={onSave} style={{ minHeight: 30, border: "1px solid #60a5fa", borderRadius: 8, background: "#eff6ff", color: "#1d4ed8", padding: "0 10px", fontWeight: 900, cursor: saving ? "default" : "pointer" }}>{saving ? "Saving version" : "Save version"}</button>
              <button type="button" onClick={onClose} style={{ minHeight: 30, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 8, background: "#ffffff", padding: "0 10px", fontWeight: 850, cursor: "pointer" }}>Close</button>
            </div>
          </header>
          <div style={{ minHeight: 0, overflow: "auto", display: "grid", gap: 12, padding: 12, alignContent: "start" }}>
            {versions.length === 0 ? <div style={{ padding: 18, border: `1px dashed ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 10 }}>No project versions saved yet.</div> : (
              <div style={{ minWidth: 680, display: "grid", gridTemplateColumns: "repeat(5, minmax(120px, 1fr))", gap: 8 }}>
                {versions.map((version) => {
                  const preview = version.snapshot.blocks.map((block) => projectSavedDocumentText(block.document)).filter(Boolean).join("\n\n");
                  const active = selected?.item.information_id === version.item.information_id;
                  return (
                    <button key={version.item.information_id} type="button" onClick={() => onSelect(version.item.information_id)} style={{ height: 128, minWidth: 0, display: "grid", gridTemplateRows: "auto minmax(0,1fr) auto", gap: 5, border: `2px solid ${active ? "#2563eb" : EDITOR_NEU_SOFT_BORDER}`, borderRadius: 9, background: active ? "#eff6ff" : "#ffffff", padding: 8, textAlign: "left", cursor: "pointer", overflow: "hidden" }}>
                      <strong style={{ fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{new Date(version.item.created_timestamp).toLocaleString()}</strong>
                      <span style={{ overflow: "hidden", whiteSpace: "pre-wrap", background: "#f8fafc", border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 5, padding: 5, font: "9px/1.25 ui-monospace, Consolas, monospace" }}>{preview || "Empty project snapshot"}</span>
                      <span style={{ fontSize: 9.5, color: "#2563eb", fontWeight: 850 }}>{version.snapshot.blocks.length} text box{version.snapshot.blocks.length === 1 ? "" : "es"}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {selected && (
              <section style={{ display: "grid", gap: 9, border: "4px solid #f59e0b", borderRadius: 12, background: "#fffbeb", padding: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div><strong style={{ color: "#92400e" }}>Viewing an old project snapshot</strong><div style={{ color: "#92400e", fontSize: 10.5, fontWeight: 750 }}>Read-only. The current project is unchanged.</div></div>
                  <div style={{ display: "flex", gap: 7 }}>
                    <button type="button" onClick={onExitPreview} style={{ minHeight: 30, border: "1px solid #d97706", borderRadius: 8, background: "#ffffff", color: "#92400e", padding: "0 10px", fontWeight: 900, cursor: "pointer" }}>Exit preview</button>
                    <button type="button" disabled={restoring} onClick={() => onRestore(selected)} style={{ minHeight: 30, border: "1px solid #b45309", borderRadius: 8, background: "#f59e0b", color: "#451a03", padding: "0 10px", fontWeight: 950, cursor: restoring ? "default" : "pointer" }}>{restoring ? "Overwriting current" : "Overwrite current with this"}</button>
                  </div>
                </div>
                <div style={{ maxHeight: 420, overflow: "auto", display: "grid", gap: 8 }}>
                  {selected.snapshot.blocks.map((block, index) => <pre key={block.id} style={{ margin: 0, minHeight: 80, whiteSpace: "pre-wrap", overflowWrap: "anywhere", border: "1px solid #f59e0b", borderRadius: 8, background: "#ffffff", padding: 10, font: "11px/1.45 ui-monospace, Consolas, monospace" }}>Text box {index + 1}{"\n"}{projectSavedDocumentText(block.document) || "Empty text box"}</pre>)}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </AppModalPortal>
  );
};

type ProjectSummaryWorkspaceSnapshot = {
  nodes: NodeRecord[];
};

type ProjectRelationshipDropTarget = {
  resourceType: "node";
  resourceID: string;
};

type RelationshipCanvasContextMenuState = {
  x: number;
  y: number;
  logicGateID?: string;
  relationship?: {
    relationshipID: string;
    resourceType: "logic_gate" | "node";
    resourceID: string;
    displayTitle: string;
  };
};

type RelationshipContextTarget = NonNullable<RelationshipCanvasContextMenuState["relationship"]>;

type ProjectRelationshipNodeDragPayload = {
  nodeID: string;
  fromLogicGateID?: string;
  status?: string | null;
};

type SummarySplitResizeState = {
  left: number;
  width: number;
};

type CriticalPathStepUpdates = Partial<{
  name: string;
  relationshipID: string;
  dueDate: string;
  ownerType: "user" | "group" | "";
  ownerID: string;
  position: number;
  isCurrent: boolean;
}>;

type CriticalPathNodePreviewSelection = {
  stepID: string;
  nodeID: string;
  title: string;
};

type ProjectRelationshipNodePanelSelection = {
  projectID: string;
  relationshipID: string;
  nodeID: string;
  title: string;
};

const PROJECT_SUMMARY_SURFACE_TEXT = "#172033";
const PROJECT_SUMMARY_RULE = "rgba(91, 141, 239, 0.24)";
const PROJECT_TEXTBOX_HEADER_BACKGROUND = "linear-gradient(90deg, rgba(255,241,242,0.62), rgba(236,253,245,0.42) 52%, rgba(239,246,255,0.66))";
const PROJECT_SUMMARY_SPLIT_MIN = 42;
const PROJECT_SUMMARY_SPLIT_MAX = 74;
const PROJECT_RELATIONSHIP_NODE_DRAG_MIME = "application/x-mangorts-project-relationship-node";
const PROJECT_CRITICAL_STEP_DRAG_MIME = "application/x-mangorts-project-critical-step";
const PROJECT_RELATIONSHIP_GROUPING_STORAGE_KEY = "mangorts-project-relationship-groupings-v1";
const PROJECT_EMAIL_COLUMN_LAYOUT_ID = "project-email-column";
const PROJECT_HEALTH_OPTIONS: ProjectHealth[] = ["On Track", "AT RISK", "Off Track"];

export const ProjectSummaryContent: React.FC<ProjectSummaryContentProps> = ({
  projectID,
  entityFields,
  showFieldMetadata = false,
  focusInformationID,
  focusMentionUserID,
  focusRequestID,
  accent,
  refreshToken = 0,
  onNodeOpen,
  onProjectUpdated,
  onLogicGateOpen,
  onOpenInNewTab,
  onCollapseToTab,
  workspace,
}) => {
  const companyID = getActiveCompanyID();
  const apiBase = readAuthConfig().apiBase;
  const permissionsRequestJSON = useMemo(() => createRequestJSON(apiBase), [apiBase]);
  const attachmentRequestJSON = useMemo(() => createRequestJSON(apiBase), [apiBase]);
  const editorDataFormat = useMangoEditorDataFormat(apiBase, companyID, attachmentRequestJSON);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const textBlocksScrollRef = useRef<HTMLDivElement | null>(null);
  const projectDocumentPaneRef = useRef<HTMLDialogElement | null>(null);
  const projectDocumentScrollMemoryRef = useRef(createEditorScrollMemory());
  const projectInformationScrollMemoryRef = useRef(createEditorScrollMemory());
  const paneProjectIDRef = useRef("");
  const refreshTokenRef = useRef(refreshToken);
  const relationshipGroupIDsRef = useRef<Set<string>>(new Set());
  const relationshipGroupingSignatureRef = useRef("");
  const projectFormattingControllerRef = useRef<EditorDocumentFormattingController | null>(null);
  const projectTextBlockSaveTimersRef = useRef(new Map<string, number>());
  const projectTextBlockContentRef = useRef(new Map<string, EditorTextBlockContent>());
  const projectTextBlockContentRevisionRef = useRef(0);
  const projectLoadRequestRef = useRef(0);
  const projectSaveScopeRef = useRef("");
  const projectChatSubmissionsInProgressRef = useRef(new Set<string>());
  const handledProjectFocusRequestRef = useRef("");
  const { accounts } = useCompanyAccounts(companyID);
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [projectTitleEditing, setProjectTitleEditing] = useState(false);
  const [projectTitleDraft, setProjectTitleDraft] = useState("");
  const [blocks, setBlocks] = useState<ProjectTextBlockDraft[]>([]);
  const [textBlockSaveFailures, setTextBlockSaveFailures] = useState<Record<string, boolean>>({});
  const [projectSavedVersions, setProjectSavedVersions] = useState<ProjectSavedVersion[]>([]);
  const [projectSavedVersionsOpen, setProjectSavedVersionsOpen] = useState(false);
  const [selectedProjectSavedVersionID, setSelectedProjectSavedVersionID] = useState("");
  const [projectVersionSaving, setProjectVersionSaving] = useState(false);
  const [projectVersionRestoring, setProjectVersionRestoring] = useState(false);
  const [projectDocumentRemountRevision, setProjectDocumentRemountRevision] = useState(0);
  const [chatMessages, setChatMessages] = useState<EditorTextBlockChatMessage[]>([]);
  const [attachedEmails, setAttachedEmails] = useState<EditorAttachedEmail[]>([]);
  const [relationships, setRelationships] = useState<ProjectRelationshipProjection[]>([]);
  const [criticalPath, setCriticalPath] = useState<ProjectCriticalPathStep[]>([]);
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([]);
  const [groups, setGroups] = useState<CompanyUserGroup[]>([]);
  const [currentUserID, setCurrentUserID] = useState("");
  const [canEditProject, setCanEditProject] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingID, setSavingID] = useState("");
  const [error, setError] = useState("");
  const [summarySplitPct, setSummarySplitPct] = useState(58);
  const [splitResizeState, setSplitResizeState] = useState<SummarySplitResizeState | null>(null);
  const [focusedTextBlockID, setFocusedTextBlockID] = useState("");
  const [tiptapPinnedBlockIDs, setTiptapPinnedBlockIDs] = useState<Set<string>>(() => new Set());
  const [activeRichTextBlockID, setActiveRichTextBlockID] = useState("");
  const [activeRowBlockID, setActiveRowBlockID] = useState("");
  const [openEditorBlockIDs, setOpenEditorBlockIDs] = useState<Set<string>>(() => new Set());
  const [openChatBlockIDs, setOpenChatBlockIDs] = useState<Set<string>>(() => new Set());
  const [openEmailBlockIDs, setOpenEmailBlockIDs] = useState<Set<string>>(() => new Set());
  const [projectDocumentOpen, setProjectDocumentOpen] = useState(true);
  const [projectDocumentFullscreen, setProjectDocumentFullscreen] = useState(false);
  const [projectSidePaneWidths, setProjectSidePaneWidths] = useState({ document: 420, email: 340, chat: 340 });
  const [projectResourceAttachments, setProjectResourceAttachments] = useState<MangoResourceAttachment[]>([]);
  const [projectAttachmentsLoading, setProjectAttachmentsLoading] = useState(false);
  const [projectAttachmentsLoadError, setProjectAttachmentsLoadError] = useState("");
  const [projectAttachmentsRefreshKey, setProjectAttachmentsRefreshKey] = useState(0);
  const [chatDrafts, setChatDrafts] = useState<Record<string, string>>({});
  const [chatDraftEntityLinks, setChatDraftEntityLinks] = useState<Record<string, EditorChatEntityLink[]>>({});
  const [chatDraftAttachments, setChatDraftAttachments] = useState<Record<string, EditorChatAttachment[]>>({});
  const [chatReplyTargets, setChatReplyTargets] = useState<Record<string, string>>({});
  const [chatSelectionAnchors, setChatSelectionAnchors] = useState<Record<string, TextBlockSelectionDraft>>({});
  const [pendingProjectEmailChatSelection, setPendingProjectEmailChatSelection] = useState<TextBlockSelectionDraft | null>(null);
  const [projectEmailChatDestinationBlockID, setProjectEmailChatDestinationBlockID] = useState("");
  const [activeChatMessageIDs, setActiveChatMessageIDs] = useState<Record<string, string>>({});
  const [chatNavigationRequests, setChatNavigationRequests] = useState<Record<string, { anchorMessageID: string; requestID: number }>>({});
  const [chatMessageFocusRequests, setChatMessageFocusRequests] = useState<Record<string, { messageID: string; requestID: number }>>({});
  const [chatComposerFocusRequestIDs, setChatComposerFocusRequestIDs] = useState<Record<string, number>>({});
  const [selectedEmailIDsByBlock, setSelectedEmailIDsByBlock] = useState<Record<string, string>>({});
  const [emailPicker, setEmailPicker] = useState<UniversalEntityPickerAnchor | null>(null);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [assignmentsOpen, setAssignmentsOpen] = useState(false);
  const [assignmentAccountIDs, setAssignmentAccountIDs] = useState<string[]>([]);
  const [assignmentTeamIDs, setAssignmentTeamIDs] = useState<string[]>([]);
  const [projectMetadataSaving, setProjectMetadataSaving] = useState(false);
  const [assignmentsSaving, setAssignmentsSaving] = useState(false);
  const [relationshipContextMenu, setRelationshipContextMenu] = useState<RelationshipCanvasContextMenuState | null>(null);
  const [relationshipDeleteConfirmation, setRelationshipDeleteConfirmation] = useState<{ isLogicGate: boolean; resourceIDs: string[]; label: string; position?: ConfirmActionMenuPosition | null } | null>(null);
  const [relationshipDropActive, setRelationshipDropActive] = useState(false);
  const [relationshipPickerAnchor, setRelationshipPickerAnchor] = useState<UniversalEntityPickerAnchor | null>(null);
  const [relationshipActionBusy, setRelationshipActionBusy] = useState(false);
  const [relationshipGroupings, setRelationshipGroupings] = useState<ProjectRelationshipGroupingSetting[]>(() => (
    DEFAULT_PROJECT_RELATIONSHIP_GROUPINGS.map((grouping) => ({ ...grouping }))
  ));
  const [expandedRelationshipGroupIDs, setExpandedRelationshipGroupIDs] = useState<Set<string>>(() => new Set());
  const [hoveredRelationshipNodeID, setHoveredRelationshipNodeID] = useState("");
  const [selectedRelationshipNodeIDs, setSelectedRelationshipNodeIDs] = useState<Set<string>>(() => new Set());
  const [selectionAnchorRelationshipNodeID, setSelectionAnchorRelationshipNodeID] = useState("");
  const [activeRightPanelTab, setActiveRightPanelTab] = useState<ProjectWorkPanelTab>(() => (
    projectWorkPanelTabFromHistoryState(
      typeof window === "undefined" ? null : window.history.state,
      projectID,
    )
  ));
  const selectRightPanelTab = useCallback((workPanelTab: ProjectWorkPanelTab) => {
    setActiveRightPanelTab(workPanelTab);
    if (typeof window !== "undefined") {
      replaceProjectWorkPanelHistoryState(window.history, window.location.href, {
        projectID,
        workPanelTab,
      });
    }
  }, [projectID]);
  const [selectedCriticalPathNode, setSelectedCriticalPathNode] = useState<CriticalPathNodePreviewSelection | null>(null);
  const [selectedRelationshipNodePanel, setSelectedRelationshipNodePanel] = useState<ProjectRelationshipNodePanelSelection | null>(null);
  const [projectSelectionFontSize, setProjectSelectionFontSize] = useState(TEXT_BLOCK_FONT_SIZE);
  const [projectInlineFormat, setProjectInlineFormat] = useState<EditorSelectionInlineFormatState>({ bold: false, underline: false, italic: false, strikethrough: false });
  const [projectHighlightColor, setProjectHighlightColor] = useState<EditorHighlightColor | null>(null);
  const [projectTextAlignment, setProjectTextAlignment] = useState<EditorTextAlignment>("left");
  const [textBlocksViewportHeight, setTextBlocksViewportHeight] = useState(0);
  const { outlineStyle, setOutlineStyle } = useEditorPreferences(`project-summary-outline-style-v1:${companyID}:${projectID}`);
  const blocksRef = useRef(blocks);
  const projectRef = useRef(project);
  blocksRef.current = blocks;
  projectRef.current = project;
  const projectSaveScope = `${companyID}:${projectID.trim()}`;
  useEffect(() => setCanEditProject(false), [projectSaveScope]);
  useEffect(() => subscribeCommittedEntityTitleUpdates((update) => {
    setRelationships((current) => reconcileProjectResourceDisplayTitles(current, update, companyID));
    setCriticalPath((current) => reconcileProjectResourceDisplayTitles(current, update, companyID));
    setSelectedCriticalPathNode((current) => reconcileSelectedNodeTitle(current, update, companyID));
    setSelectedRelationshipNodePanel((current) => reconcileSelectedNodeTitle(current, update, companyID));
    setRelationshipContextMenu((current) => {
      if (!current?.relationship) return current;
      const relationship = reconcileRelationshipContextTitle(current.relationship, update, companyID);
      return relationship === current.relationship ? current : { ...current, relationship };
    });
  }), [companyID]);


  projectSaveScopeRef.current = projectSaveScope;
  const projectTextBlockSaveController = useMemo<TextBlockProjectionSaveController<EditorTextBlockContent>>(
    () => createTextBlockProjectionSaveController<EditorTextBlockContent>(),
    [projectSaveScope],
  );

  const refreshProjectSelectionFormat = useCallback(() => {
    const state = projectFormattingControllerRef.current?.readFormatState();
    if (!state) return;
    setProjectSelectionFontSize(state.fontSize);
    setProjectInlineFormat({ bold: state.bold, underline: state.underline, italic: state.italic, strikethrough: state.strikethrough });
    setProjectHighlightColor(state.highlightColor);
    setProjectTextAlignment(state.textAlignment);
  }, []);

  const runProjectFormatCommand = useCallback((command: (controller: EditorDocumentFormattingController) => boolean) => {
    const controller = projectFormattingControllerRef.current;
    if (!controller) return;
    command(controller);
    const state = controller.readFormatState();
    if (!state) return;
    setProjectSelectionFontSize(state.fontSize);
    setProjectInlineFormat({ bold: state.bold, underline: state.underline, italic: state.italic, strikethrough: state.strikethrough });
    setProjectHighlightColor(state.highlightColor);
    setProjectTextAlignment(state.textAlignment);
  }, []);

  useEffect(() => {
    projectLoadRequestRef.current += 1;
    setRelationshipPickerAnchor(null);
    setRelationshipActionBusy(false);
    projectTextBlockContentRef.current.clear();
    projectTextBlockContentRevisionRef.current = 0;
    setSavingID("");
    return () => {
      for (const timer of projectTextBlockSaveTimersRef.current.values()) window.clearTimeout(timer);
      projectTextBlockSaveTimersRef.current.clear();
      void projectTextBlockSaveController.flushChangedBlocks().catch(() => undefined);
    };
  }, [projectTextBlockSaveController]);

  const loadProject = useCallback(async (options: { showLoading?: boolean } = {}) => {
    const cleanProjectID = projectID.trim();
    if (!companyID || !cleanProjectID) return;
    const requestID = projectLoadRequestRef.current + 1;
    projectLoadRequestRef.current = requestID;
    const requestScope = `${companyID}:${cleanProjectID}`;
    const contentRevisionAtStart = projectTextBlockContentRevisionRef.current;
    const contentSaveWasPendingAtStart = projectTextBlockSaveController.hasAnyChangedOrSaveInProgress();
    const titleVersionAtStart = readCommittedEntityTitleVersion();
    if (options.showLoading !== false) setLoading(true);
    setError("");
    try {
      const [view, current, users, userGroups] = await Promise.all([
        fetchProjectView(companyID, cleanProjectID),
        fetchCurrentUser().catch(() => null),
        listCompanyUsers(companyID).catch(() => [] as CompanyUser[]),
        listCompanyUserGroups(companyID).catch(() => ({ groups: [] as CompanyUserGroup[], members: [] })),
      ]);
      if (projectLoadRequestRef.current !== requestID || projectSaveScopeRef.current !== requestScope) return;
      setProject(view.project);
      setCanEditProject(view.can_edit === true);
      setProjectTitleDraft(view.project.name || "");
      setProjectSavedVersions((view.information ?? [])
        .map(parseProjectSavedVersion)
        .filter((version): version is ProjectSavedVersion => version !== null)
        .sort((left, right) => right.item.created_timestamp.localeCompare(left.item.created_timestamp)));
      setRelationships(foldCommittedEntityTitlesSince(
        view.relationships ?? [], companyID, titleVersionAtStart,
        (current, update) => reconcileProjectResourceDisplayTitles(current, update, companyID),
      ));
      setCriticalPath(foldCommittedEntityTitlesSince(
        orderCriticalPathSteps(view.critical_path ?? []), companyID, titleVersionAtStart,
        (current, update) => reconcileProjectResourceDisplayTitles(current, update, companyID),
      ));
      setCompanyUsers(users);
      setGroups(userGroups.groups);
      setAssignmentAccountIDs(projectAccountIDs(view.project));
      setAssignmentTeamIDs(projectTeamIDs(view.project));
      setCurrentUserID(current?.user.user_id.trim() ?? "");
      const nextBlocks = blockDraftsFromProjections(view.projections ?? []);
      const nextChatMessages = parseEditorTextBlockChats(view.projections ?? []);
      const nextAttachedEmails = parseEditorAttachedEmails(view.projections ?? []);
      const chatBlockIDs = new Set(nextChatMessages.map((message) => message.blockID));
      if (
        !contentSaveWasPendingAtStart
        && projectTextBlockContentRevisionRef.current === contentRevisionAtStart
        && !projectTextBlockSaveController.hasAnyChangedOrSaveInProgress()
      ) {
        projectTextBlockContentRef.current = new Map(nextBlocks.map((block) => [
          block.id,
          { title: block.title, document: block.document, attachments: block.attachments },
        ]));
        projectTextBlockSaveController.replaceBlocksAsHasNotChanged(nextBlocks.map((block) => ({
          blockID: block.id,
          content: { title: block.title, document: block.document, attachments: block.attachments },
        })));
        setBlocks(nextBlocks);
        const nextBlockIDs = new Set(nextBlocks.map((block) => block.id));
        if (paneProjectIDRef.current !== cleanProjectID) {
          paneProjectIDRef.current = cleanProjectID;
          setOpenEditorBlockIDs(new Set(nextBlockIDs));
          setProjectDocumentOpen(true);
          setOpenEmailBlockIDs(new Set());
          setOpenChatBlockIDs(new Set(Array.from(chatBlockIDs).filter((id) => nextBlockIDs.has(id))));
        } else {
          setOpenEditorBlockIDs((current) => new Set(Array.from(current).filter((id) => nextBlockIDs.has(id))));
          setOpenEmailBlockIDs((current) => new Set(Array.from(current).filter((id) => id === PROJECT_EMAIL_COLUMN_LAYOUT_ID || nextBlockIDs.has(id))));
          setOpenChatBlockIDs((current) => new Set(Array.from(current).filter((id) => nextBlockIDs.has(id))));
        }
      }
      setChatMessages(nextChatMessages);
      setAttachedEmails(nextAttachedEmails);
    } catch (loadError) {
      if (projectLoadRequestRef.current !== requestID || projectSaveScopeRef.current !== requestScope) return;
      setError(loadError instanceof Error ? loadError.message : "Failed to load project");
    } finally {
      if (
        options.showLoading !== false
        && projectLoadRequestRef.current === requestID
        && projectSaveScopeRef.current === requestScope
      ) {
        setLoading(false);
      }
    }
  }, [companyID, projectID, projectTextBlockSaveController]);

  useEffect(() => {
    setLoading(true);
    setChatComposerFocusRequestIDs({});
    void loadProject({ showLoading: true });
  }, [loadProject]);

  useEffect(() => {
    setProjectDocumentOpen(true);
    setProjectDocumentFullscreen(false);
    setActiveRightPanelTab(projectWorkPanelTabFromHistoryState(
      typeof window === "undefined" ? null : window.history.state,
      projectID,
    ));
  }, [projectID]);

  useEffect(() => setNodeEditorFullscreenChromeActive(projectDocumentFullscreen), [projectDocumentFullscreen]);

  useEffect(() => {
    if (!companyID || !currentUserID) return;
    setRelationshipGroupings(readProjectRelationshipGroupingPreference(companyID, currentUserID));
  }, [companyID, currentUserID]);

  useEffect(() => {
    if (refreshToken === refreshTokenRef.current) return;
    refreshTokenRef.current = refreshToken;
    void loadProject({ showLoading: false });
  }, [loadProject, refreshToken]);

  useEffect(() => {
    if (!splitResizeState) return undefined;
    const onPointerMove = (event: PointerEvent) => {
      const nextPct = ((event.clientX - splitResizeState.left) / Math.max(1, splitResizeState.width)) * 100;
      setSummarySplitPct(clampNumber(nextPct, PROJECT_SUMMARY_SPLIT_MIN, PROJECT_SUMMARY_SPLIT_MAX));
    };
    const onPointerUp = () => setSplitResizeState(null);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [splitResizeState]);

  useEffect(() => {
    if (!relationshipContextMenu) return undefined;
    const close = () => setRelationshipContextMenu(null);
    const closeUnlessConfirming = () => {
      if (document.querySelector("[data-mango-confirm-action-menu='true']")) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", closeUnlessConfirming);
    window.addEventListener("mango:confirm-action-complete", close);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", closeUnlessConfirming);
      window.removeEventListener("mango:confirm-action-complete", close);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", close, true);
    };
  }, [relationshipContextMenu]);

  const relationshipGroupingModel = useMemo(
    () => buildProjectRelationshipGroupingModel(relationships, relationshipGroupings),
    [relationshipGroupings, relationships],
  );
  const visibleProjectLogicGateByID = useMemo(
    () => buildVisibleProjectLogicGateIndex(relationships),
    [relationships],
  );
  const relationshipNodeCountByGateID = useMemo(() => {
    const counts = new Map<string, number>();
    for (const relationship of relationships) {
      if (relationship.resource_type !== "node") continue;
      const gateID = relationship.logic_gate_id?.trim() ?? "";
      if (!gateID || !visibleProjectLogicGateByID.has(gateID)) continue;
      counts.set(gateID, (counts.get(gateID) ?? 0) + 1);
    }
    return counts;
  }, [relationships, visibleProjectLogicGateByID]);
  const visibleRelationshipRows = useMemo(
    () => flattenVisibleProjectRelationshipLeafRows(relationshipGroupingModel, expandedRelationshipGroupIDs),
    [expandedRelationshipGroupIDs, relationshipGroupingModel],
  );
  const visibleRelationshipNodeIDs = useMemo(
    () => visibleRelationshipRows
      .filter(({ row }) => row.resource_type === "node")
      .map(({ row }) => row.relationship_id),
    [visibleRelationshipRows],
  );
  const relationshipGroupingSignature = useMemo(
    () => relationshipGroupings.map((grouping) => grouping.field + ":" + grouping.direction).join("|"),
    [relationshipGroupings],
  );
  const currentCriticalStep = useMemo(() => criticalPath.find((step) => step.is_current) ?? null, [criticalPath]);
  const currentCriticalRelationshipID = currentCriticalStep?.relationship_id?.trim() ?? "";

  useEffect(() => {
    const nextGroupIDs = new Set(collectProjectRelationshipGroupIDs(relationshipGroupingModel.groups));
    const previousGroupIDs = relationshipGroupIDsRef.current;
    const groupingChanged = relationshipGroupingSignatureRef.current !== relationshipGroupingSignature;
    setExpandedRelationshipGroupIDs((current) => {
      if (groupingChanged || previousGroupIDs.size === 0) return nextGroupIDs;
      const next = new Set(Array.from(current).filter((groupID) => nextGroupIDs.has(groupID)));
      for (const groupID of nextGroupIDs) {
        if (!previousGroupIDs.has(groupID)) next.add(groupID);
      }
      return next;
    });
    relationshipGroupIDsRef.current = nextGroupIDs;
    relationshipGroupingSignatureRef.current = relationshipGroupingSignature;
  }, [relationshipGroupingModel.groups, relationshipGroupingSignature]);

  useEffect(() => {
    const visibleIDs = new Set(visibleRelationshipNodeIDs);
    setSelectedRelationshipNodeIDs((current) => {
      const next = new Set(Array.from(current).filter((relationshipID) => visibleIDs.has(relationshipID)));
      return next.size === current.size ? current : next;
    });
    setSelectionAnchorRelationshipNodeID((current) => (current && !visibleIDs.has(current) ? "" : current));
  }, [visibleRelationshipNodeIDs]);

  useEffect(() => {
    if (!selectedCriticalPathNode) return;
    const relationshipByID = new Map(relationships.map((relationship) => [relationship.relationship_id, relationship]));
    const stillVisible = criticalPath.some((step) => {
      const preview = criticalPathNodePreviewFromStep(step, relationshipByID);
      return preview?.stepID === selectedCriticalPathNode.stepID && preview.nodeID === selectedCriticalPathNode.nodeID;
    });
    if (!stillVisible) setSelectedCriticalPathNode(null);
  }, [criticalPath, relationships, selectedCriticalPathNode]);

  useEffect(() => {
    setSelectedRelationshipNodePanel((current) => {
      if (!current) return current;
      if (current.projectID !== projectID) return null;
      const relationship = relationships.find((item) => item.relationship_id === current.relationshipID);
      const nodeID = relationship ? (relationship.node_id || relationship.resource_id || "").trim() : "";
      if (!relationship || relationship.resource_type !== "node" || nodeID !== current.nodeID) return null;
      const title = relationship.display_title.trim() || "Node";
      return title === current.title ? current : { ...current, title };
    });
  }, [projectID, relationships]);

  const chatMessagesByBlockID = useMemo(() => {
    const grouped = new Map<string, EditorTextBlockChatMessage[]>();
    for (const message of chatMessages) {
      const bucket = grouped.get(message.blockID) ?? [];
      bucket.push(message);
      grouped.set(message.blockID, bucket);
    }
    return grouped;
  }, [chatMessages]);

  useEffect(() => {
    const visible = new Set(visibleRelationshipNodeIDs);
    setSelectedRelationshipNodeIDs((current) => {
      const next = new Set(Array.from(current).filter((relationshipID) => visible.has(relationshipID)));
      return next.size === current.size ? current : next;
    });
    setSelectionAnchorRelationshipNodeID((current) => (current && !visible.has(current) ? "" : current));
  }, [visibleRelationshipNodeIDs]);
  const projectAttachedEmails = useMemo(() => {
    const byThread = new Map<string, EditorAttachedEmail>();
    for (const email of attachedEmails) {
      if (email.blockID?.trim()) continue;
      const threadKey = email.emailThreadID?.trim() || email.threadID?.trim() || email.messageID;
      if (!byThread.has(threadKey)) byThread.set(threadKey, email);
    }
    return Array.from(byThread.values());
  }, [attachedEmails]);
  const projectDocumentID = projectID.trim();
  const projectDocumentBlock = useMemo(
    () => blocks.find((block) => block.id === projectDocumentID) ?? null,
    [blocks, projectDocumentID],
  );
  useLayoutEffect(() => {
    if (loading || !projectDocumentOpen || !projectDocumentBlock) return undefined;
    const pane = projectDocumentPaneRef.current;
    if (!pane) return undefined;
    if (pane.open) pane.close();
    if (projectDocumentFullscreen) pane.showModal();
    else pane.show();
    return () => {
      if (pane.open) pane.close();
    };
  }, [loading, projectDocumentBlock?.id, projectDocumentFullscreen, projectDocumentOpen]);
  const timelineBlocks = useMemo(
    () => blocks.filter((block) => block.id !== projectDocumentID),
    [blocks, projectDocumentID],
  );
  const projectEmailMessageAccents = useMemo(() => linkedEmailMessageAccents(timelineBlocks), [timelineBlocks]);
  const projectEmailChatHighlightsByMessageID = useMemo<EmailChatHighlightsByMessageID>(() => {
    const highlights: Record<string, Array<{ id: string; quote: string; startOffset: number; endOffset: number }>> = {};
    for (const chatMessage of chatMessages) {
      const messageID = chatMessage.selectionSource === "email" ? chatMessage.selectionMessageID?.trim() ?? "" : "";
      const quote = chatMessage.selectionQuote?.trim() ?? "";
      const startOffset = chatMessage.selectionStart;
      const endOffset = chatMessage.selectionEnd;
      if (!messageID || !quote || typeof startOffset !== "number" || typeof endOffset !== "number" || endOffset <= startOffset) continue;
      const group = highlights[messageID] ?? [];
      group.push({ id: `chat:${chatMessage.id}`, quote, startOffset, endOffset });
      highlights[messageID] = group;
    }
    return highlights;
  }, [chatMessages]);
  const activeProjectEmailChatMessage = useMemo(() => {
    const activeEntry = Object.entries(activeChatMessageIDs).find(([, messageID]) => Boolean(messageID));
    if (!activeEntry) return undefined;
    const [blockID, messageID] = activeEntry;
    return chatMessages.find((message) => message.blockID === blockID && message.id === messageID && message.selectionSource === "email");
  }, [activeChatMessageIDs, chatMessages]);
  const activeProjectChatBlockID = Object.entries(activeChatMessageIDs).find(([, messageID]) => Boolean(messageID))?.[0] ?? "";
  const pendingProjectEmailAnchor = pendingProjectEmailChatSelection
    ?? (activeProjectChatBlockID && chatSelectionAnchors[activeProjectChatBlockID]?.source === "email"
      ? chatSelectionAnchors[activeProjectChatBlockID]
      : undefined);
  const activeProjectEmailSelection = pendingProjectEmailAnchor?.messageID
    && pendingProjectEmailAnchor.quote
    && Number.isFinite(pendingProjectEmailAnchor.startOffset)
    && Number.isFinite(pendingProjectEmailAnchor.endOffset)
    ? {
      messageID: pendingProjectEmailAnchor.messageID,
      quote: pendingProjectEmailAnchor.quote,
      startOffset: pendingProjectEmailAnchor.startOffset,
      endOffset: pendingProjectEmailAnchor.endOffset,
    }
    : activeProjectEmailChatMessage?.selectionMessageID
      && activeProjectEmailChatMessage.selectionQuote
      && Number.isFinite(activeProjectEmailChatMessage.selectionStart)
      && Number.isFinite(activeProjectEmailChatMessage.selectionEnd)
      ? {
        messageID: activeProjectEmailChatMessage.selectionMessageID,
        quote: activeProjectEmailChatMessage.selectionQuote,
        startOffset: activeProjectEmailChatMessage.selectionStart ?? 0,
        endOffset: activeProjectEmailChatMessage.selectionEnd ?? 0,
      }
      : null;
  const projectFileAttachments = useMemo(() => filterMangoResourceAttachments(projectResourceAttachments, {
    relationshipKind: "file_attachment",
  }), [projectResourceAttachments]);
  const projectAttachmentDropdownItems = useMemo(() => projectFileAttachments.map((resourceAttachment) => ({
    resourceAttachment,
  })), [projectFileAttachments]);
  const refreshProjectAttachments = useCallback(() => {
    invalidateMangoResourceAttachmentsCache(attachmentRequestJSON, {
      apiBase,
      companyID,
      resourceType: "project",
      resourceID: projectDocumentID,
    });
    setProjectAttachmentsRefreshKey((key) => key + 1);
  }, [apiBase, attachmentRequestJSON, companyID, projectDocumentID]);

  useEffect(() => {
    if (!companyID.trim() || !projectDocumentID) {
      setProjectResourceAttachments([]);
      setProjectAttachmentsLoading(false);
      setProjectAttachmentsLoadError("");
      return undefined;
    }
    let cancelled = false;
    setProjectAttachmentsLoading(true);
    setProjectAttachmentsLoadError("");
    void listMangoResourceAttachments(attachmentRequestJSON, {
      apiBase,
      companyID,
      resourceType: "project",
      resourceID: projectDocumentID,
    }).then((payload) => {
      if (!cancelled) setProjectResourceAttachments(payload.attachments ?? []);
    }).catch((cause) => {
      if (cancelled) return;
      setProjectResourceAttachments([]);
      setProjectAttachmentsLoadError(cause instanceof Error ? cause.message : "Failed to load Project attachments");
    }).finally(() => {
      if (!cancelled) setProjectAttachmentsLoading(false);
    });
    return () => { cancelled = true; };
  }, [apiBase, attachmentRequestJSON, companyID, projectAttachmentsRefreshKey, projectDocumentID]);

  const focusTargetBlockID = useMemo(() => {
    const targetID = focusInformationID?.trim() ?? "";
    if (!targetID) return "";
    if (blocks.some((block) => block.id === targetID)) return targetID;
    const chatMessage = chatMessages.find((message) => message.id === targetID);
    if (chatMessage) return chatMessage.blockID;
    const attachedEmail = attachedEmails.find((email) => email.id === targetID || email.messageID === targetID || email.emailMessageID === targetID);
    return attachedEmail?.blockID?.trim() ?? "";
  }, [attachedEmails, blocks, chatMessages, focusInformationID]);
  const focusTargetIndex = useMemo(
    () => focusTargetBlockID ? timelineBlocks.findIndex((block) => block.id === focusTargetBlockID) : -1,
    [focusTargetBlockID, timelineBlocks],
  );
  const pinnedProjectRowIndices = useMemo(() => {
    const indices = new Set<number>();
    for (const blockID of [focusedTextBlockID, activeRichTextBlockID, activeRowBlockID]) {
      if (!blockID) continue;
      const index = timelineBlocks.findIndex((block) => block.id === blockID);
      if (index >= 0) indices.add(index);
    }
    for (const blockID of tiptapPinnedBlockIDs) {
      const index = timelineBlocks.findIndex((block) => block.id === blockID);
      if (index >= 0) indices.add(index);
    }
    return Array.from(indices);
  }, [activeRichTextBlockID, activeRowBlockID, focusedTextBlockID, timelineBlocks, tiptapPinnedBlockIDs]);
  const textBlockViewport = resolveTextBlockViewportGeometry(textBlocksViewportHeight);
  const projectRowVirtualizer = useBoundedEditorRowVirtualization({
    itemCount: timelineBlocks.length,
    rowHeight: textBlockViewport.rowHeight,
    rowGap: TEXT_BLOCK_ROW_GAP,
    scrollElementRef: textBlocksScrollRef,
    targetIndex: focusTargetIndex >= 0 ? focusTargetIndex : null,
    targetRequestKey: `${projectID}:${focusInformationID ?? ""}:${focusRequestID ?? 0}`,
    pinnedIndices: pinnedProjectRowIndices,
  });

  useLayoutEffect(() => {
    const element = textBlocksScrollRef.current;
    if (!element) return undefined;
    const measure = () => {
      const nextHeight = Math.floor(element.clientHeight);
      if (nextHeight <= 0) return;
      setTextBlocksViewportHeight((current) => current === nextHeight ? current : nextHeight);
    };
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    }
    const ownerWindow = element.ownerDocument.defaultView;
    ownerWindow?.addEventListener("resize", measure);
    return () => ownerWindow?.removeEventListener("resize", measure);
  }, [loading]);

  useEffect(() => {
    const targetID = focusInformationID?.trim() ?? "";
    if (!targetID) return;
    const requestKey = `${projectID}:${targetID}:${focusRequestID ?? 0}`;
    if (handledProjectFocusRequestRef.current === requestKey) return;
    if (targetID === projectDocumentID && projectDocumentBlock) {
      handledProjectFocusRequestRef.current = requestKey;
      setOpenEmailBlockIDs((current) => {
        const next = new Set(current);
        next.delete(PROJECT_EMAIL_COLUMN_LAYOUT_ID);
        return next;
      });
      setProjectDocumentOpen(true);
      setFocusedTextBlockID("");
      setActiveRichTextBlockID("");
      projectFormattingControllerRef.current = null;
      return;
    }
    if (focusTargetIndex < 0) return;
    handledProjectFocusRequestRef.current = requestKey;
    const block = timelineBlocks[focusTargetIndex];
    if (!block) return;
    const chatMessage = chatMessages.find((message) => message.id === targetID);
    const attachedEmail = attachedEmails.find((email) => email.id === targetID || email.messageID === targetID || email.emailMessageID === targetID);
    if (chatMessage) {
      setOpenChatBlockIDs((current) => new Set(current).add(block.id));
      setActiveChatMessageIDs({ [block.id]: chatMessage.id });
      setChatMessageFocusRequests((current) => ({
        ...current,
        [block.id]: { messageID: chatMessage.id, requestID: (current[block.id]?.requestID ?? 0) + 1 },
      }));
    } else if (attachedEmail) {
      setActiveRowBlockID(block.id);
      setOpenEmailBlockIDs((current) => new Set(current).add(block.id));
      setSelectedEmailIDsByBlock((current) => ({ ...current, [block.id]: attachedEmail.messageID }));
    } else {
      setOpenEditorBlockIDs((current) => new Set(current).add(block.id));
      setFocusedTextBlockID(block.id);
      setActiveRichTextBlockID(block.id);
    }
    return scheduleTransientInformationFocus({ root: () => textBlocksScrollRef.current, informationID: targetID, mentionUserID: focusMentionUserID });
  }, [attachedEmails, chatMessages, focusInformationID, focusMentionUserID, focusRequestID, focusTargetIndex, projectDocumentBlock, projectDocumentID, projectID, timelineBlocks]);

  const beginProjectColumnResize = useCallback((pane: "document" | "email" | "chat", event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = projectSidePaneWidths[pane];
    const ownerDocument = event.currentTarget.ownerDocument;
    const previousCursor = ownerDocument.body.style.cursor;
    ownerDocument.body.style.cursor = "col-resize";
    const onPointerMove = (pointerEvent: PointerEvent) => {
      pointerEvent.preventDefault();
      const delta = pane === "chat" ? startX - pointerEvent.clientX : pointerEvent.clientX - startX;
      const width = Math.max(260, Math.min(560, Math.round(startWidth + delta)));
      setProjectSidePaneWidths((current) => ({ ...current, [pane]: width }));
    };
    const finish = () => {
      ownerDocument.body.style.cursor = previousCursor;
      ownerDocument.removeEventListener("pointermove", onPointerMove);
      ownerDocument.removeEventListener("pointerup", finish);
      ownerDocument.removeEventListener("pointercancel", finish);
    };
    ownerDocument.addEventListener("pointermove", onPointerMove);
    ownerDocument.addEventListener("pointerup", finish);
    ownerDocument.addEventListener("pointercancel", finish);
  }, [projectSidePaneWidths]);
  const currentUserName = useMemo(() => {
    const cleanUserID = currentUserID.trim();
    const user = companyUsers.find((item) => item.user_id.trim() === cleanUserID);
    return user?.display_name?.trim() || user?.email?.trim() || cleanUserID || "Project user";
  }, [companyUsers, currentUserID]);

  useEffect(() => {
    const configuredScope = projectSaveScope;
    projectTextBlockSaveController.configure({
      saveBlock: async ({ blockID, content, sentVersion }) => {
        if (!editorDataFormat.gate) throw new Error("editor_data_format_not_ready");
        const savedTimestamp = new Date().toISOString();
        await attachmentRequestJSON(
          `/v1/editor-json/project/${projectID}/documents/${blockID}?company_id=${encodeURIComponent(companyID)}`,
          {
            method: "PATCH",
            body: JSON.stringify({ title: content.title, attachments: content.attachments ?? [] }),
          },
        );
        if (projectSaveScopeRef.current !== configuredScope) return;
        const snapshot = projectTextBlockSaveController.getSnapshot(blockID);
        if (!snapshot || snapshot.localVersion !== sentVersion) return;
        setBlocks((current) => current.map((item) => (
          item.id === blockID ? { ...item, updatedTimestamp: savedTimestamp } : item
        )));
      },
      onBlockSaveInProgressChange: (blockID, saveInProgress) => {
        if (projectSaveScopeRef.current !== configuredScope) return;
        setSavingID((current) => saveInProgress ? blockID : current === blockID ? "" : current);
      },
      onSaveError: (_blockID, saveError) => {
        if (projectSaveScopeRef.current !== configuredScope) return;
        setError(saveError instanceof Error ? saveError.message : "Failed to save project text");
      },
    });
  }, [attachmentRequestJSON, companyID, editorDataFormat.gate?.editor_format, projectID, projectSaveScope, projectTextBlockSaveController]);

  const updateProjectTextBlockContent = useCallback((
    blockID: string,
    updates: Partial<EditorTextBlockContent>,
  ): EditorTextBlockContent => {
    const existing = projectTextBlockContentRef.current.get(blockID) ?? {
      title: "",
      document: "",
      attachments: [],
    };
    const nextContent: EditorTextBlockContent = {
      title: updates.title ?? existing.title,
      document: updates.document ?? existing.document,
      attachments: updates.attachments ?? existing.attachments ?? [],
    };
    const unchanged = (
      nextContent.title === existing.title
      && nextContent.document === existing.document
      && nextContent.attachments === existing.attachments
    );
    if (unchanged) return existing;
    markEditorHistoryChanged({ companyID, resourceType: "project", resourceID: projectID });
    projectTextBlockContentRef.current.set(blockID, nextContent);
    projectTextBlockContentRevisionRef.current += 1;
    projectTextBlockSaveController.markHasChanged(blockID, nextContent);
    setBlocks((current) => current.map((block) => block.id === blockID ? {
      ...block,
      title: nextContent.title,
      document: nextContent.document,
      attachments: nextContent.attachments ?? [],
    } : block));
    return nextContent;
  }, [companyID, projectID, projectTextBlockSaveController]);

  const applyProjectSyncedDocument = useCallback((blockID: string, document: string) => {
    const existing = projectTextBlockContentRef.current.get(blockID) ?? { title: "", document: "", attachments: [] };
    if (existing.document === document) return;
    projectTextBlockContentRef.current.set(blockID, { ...existing, document });
    projectTextBlockContentRevisionRef.current += 1;
    setBlocks((current) => current.map((block) => block.id === blockID ? { ...block, document } : block));
  }, []);
  const flushProjectTextBlockSave = useCallback(async (
    blockID: string,
    updates: Partial<EditorTextBlockContent> = {},
  ) => {
    updateProjectTextBlockContent(blockID, updates);
    const timer = projectTextBlockSaveTimersRef.current.get(blockID);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      projectTextBlockSaveTimersRef.current.delete(blockID);
    }
    await projectTextBlockSaveController.saveLatestContent(blockID);
  }, [projectTextBlockSaveController, updateProjectTextBlockContent]);

  const createProjectVersion = useCallback(async () => {
    const currentBlocks = blocksRef.current;
    await flushMangoTiptapResource({ companyID, resourceType: "project", resourceID: projectID });
    await projectTextBlockSaveController.flushChangedBlocks();
    const snapshotBlocks: ProjectSavedVersionBlockDTO[] = await Promise.all(currentBlocks.map(async (block) => {
      const latest = projectTextBlockContentRef.current.get(block.id);
      const path = `/v1/editor-json/project/${projectID}/documents/${block.id}?company_id=${encodeURIComponent(companyID)}`;
      const committed = await attachmentRequestJSON<{ document: unknown; updated_timestamp?: string }>(path);
      return {
        id: block.id,
        title: latest?.title ?? block.title,
        document: JSON.stringify(committed.document),
        attachments: latest?.attachments ?? block.attachments,
        createdTimestamp: block.createdTimestamp,
        updatedTimestamp: committed.updated_timestamp ?? block.updatedTimestamp,
      };
    }));
    await addProjectInformation({
      companyID,
      projectID,
      informationID: generateStableInformationID(),
      type: PROJECT_SAVED_VERSION_TYPE,
      information: PROJECT_SAVED_VERSION_PREFIX + JSON.stringify({
        name: projectRef.current?.name || projectID,
        blocks: snapshotBlocks,
      } satisfies ProjectSavedVersionSnapshot),
    });
  }, [attachmentRequestJSON, companyID, projectID, projectTextBlockSaveController]);

  const saveProjectVersion = useCallback(async () => {
    if (!companyID || !projectID || projectVersionSaving) return;
    const historyRef: EditorHistoryResourceRef = { companyID, resourceType: "project", resourceID: projectID };
    setProjectVersionSaving(true);
    setError("");
    try {
      await saveEditorHistory(historyRef, createProjectVersion);
      await loadProject({ showLoading: false });
      setProjectSavedVersionsOpen(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save project version");
    } finally {
      setProjectVersionSaving(false);
    }
  }, [companyID, createProjectVersion, loadProject, projectID, projectVersionSaving]);

  useEffect(() => {
    if (!companyID || !projectID) return undefined;
    return registerEditorHistoryExitSaver(
      { companyID, resourceType: "project", resourceID: projectID },
      createProjectVersion,
    );
  }, [companyID, createProjectVersion, projectID]);

  const restoreProjectVersion = useCallback(async (version: ProjectSavedVersion) => {
    if (!companyID || !projectID || projectVersionRestoring) return;
    if (!window.confirm("Overwrite the current project text boxes with this saved version?")) return;
    if (!editorDataFormat.gate) {
      setError("Editor data format is still loading.");
      return;
    }
    setProjectVersionRestoring(true);
    setError("");
    try {
      await Promise.all(blocks.map((block) => flushMangoTiptapDocument({
        companyID,
        resourceType: "project",
        resourceID: projectID,
        documentID: block.id,
      })));
      const desiredIDs = new Set(version.snapshot.blocks.map((block) => block.id));
      const emptyDocumentEnvelope = {
        format: "mango-tiptap-json",
        schema_version: 1,
        document: { type: "doc", content: [{ type: "paragraph" }] },
      };
      for (const current of blocks) {
        if (desiredIDs.has(current.id)) continue;
        const path = `/v1/editor-json/project/${projectID}/documents/${current.id}?company_id=${encodeURIComponent(companyID)}`;
        if (current.id === projectDocumentID) {
          await attachmentRequestJSON(path, {
            method: "PATCH",
            body: JSON.stringify({ title: "Project document" }),
          });
          const currentSnapshot = await attachmentRequestJSON<{ revision: number; deleted?: boolean }>(path);
          if (currentSnapshot.deleted) throw new Error("The permanent Project document cannot be restored after deletion.");
          await attachmentRequestJSON(path, {
            method: "POST",
            body: JSON.stringify({
              operation_id: generateStableInformationID(),
              client_id: "project-save-version-restore",
              base_revision: currentSnapshot.revision,
              schema_version: 1,
              document: emptyDocumentEnvelope,
              annotations: [],
            }),
          });
          continue;
        }
        const currentSnapshot = await attachmentRequestJSON<{ revision: number }>(path);
        await attachmentRequestJSON(path, {
          method: "DELETE",
          body: JSON.stringify({
            operation_id: generateStableInformationID(),
            client_id: "project-save-version-restore",
            base_revision: currentSnapshot.revision,
          }),
        });
      }
      for (const saved of version.snapshot.blocks) {
        let documentID = saved.id;
        let path = `/v1/editor-json/project/${projectID}/documents/${documentID}?company_id=${encodeURIComponent(companyID)}`;
        await attachmentRequestJSON(path, {
          method: "PATCH",
          body: JSON.stringify({ title: saved.title, attachments: saved.attachments ?? [] }),
        });
        let currentSnapshot = await attachmentRequestJSON<{ revision: number; deleted?: boolean; annotations?: unknown[] }>(path);
        if (currentSnapshot.deleted) {
          if (documentID === projectDocumentID) throw new Error("The permanent Project document cannot be restored after deletion.");
          documentID = generateStableInformationID();
          path = `/v1/editor-json/project/${projectID}/documents/${documentID}?company_id=${encodeURIComponent(companyID)}`;
          await attachmentRequestJSON(path, {
            method: "PATCH",
            body: JSON.stringify({ title: saved.title, attachments: saved.attachments ?? [] }),
          });
          currentSnapshot = await attachmentRequestJSON<{ revision: number; annotations?: unknown[] }>(path);
        }
        const envelope = saved.document.trim()
          ? JSON.parse(saved.document)
          : emptyDocumentEnvelope;
        await attachmentRequestJSON(path, {
          method: "POST",
          body: JSON.stringify({
            operation_id: generateStableInformationID(),
            client_id: "project-save-version-restore",
            base_revision: currentSnapshot.revision,
            schema_version: 1,
            document: envelope,
            annotations: [],
          }),
        });
      }
      setSelectedProjectSavedVersionID("");
      setProjectSavedVersionsOpen(false);
      setProjectDocumentRemountRevision((current) => current + 1);
      await loadProject({ showLoading: false });
      refreshProjectAttachments();
      markEditorHistoryChanged({ companyID, resourceType: "project", resourceID: projectID });
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "Failed to restore project version");
    } finally {
      setProjectVersionRestoring(false);
    }
  }, [attachmentRequestJSON, blocks, companyID, editorDataFormat.gate?.editor_format, loadProject, projectDocumentID, projectID, projectVersionRestoring, refreshProjectAttachments]);

  const addTextBlock = useCallback((title = "Project Summary", deferSave = false, documentValue = "") => {
    if (!editorDataFormat.gate) {
      setError("Editor data format is still loading.");
      return "";
    }
    const id = generateStableInformationID();
    const initialContent: EditorTextBlockContent = {
      title,
      document: documentValue,
      attachments: [],
    };
      const nextBlock: ProjectTextBlockDraft = {
        id,
        ...initialContent,
        attachments: initialContent.attachments ?? [],
        linkedEmailMessageIDs: [],
        createdTimestamp: new Date().toISOString(),
        updatedTimestamp: new Date().toISOString(),
      };
    projectTextBlockContentRef.current.set(id, initialContent);
    projectTextBlockContentRevisionRef.current += 1;
    if (!deferSave) projectTextBlockSaveController.markHasChanged(id, initialContent);
    setError("");
    setBlocks((current) => [nextBlock, ...current]);
    setOpenEditorBlockIDs((current) => new Set(current).add(id));
    markEditorHistoryChanged({ companyID, resourceType: "project", resourceID: projectID });
    if (!deferSave) projectTextBlockSaveController.startLatestContentSave(id);
    return id;
  }, [companyID, editorDataFormat.gate, projectID, projectTextBlockSaveController]);

  const closeProjectDocument = useCallback(() => {
    setProjectDocumentFullscreen(false);
    setProjectDocumentOpen(false);
    setFocusedTextBlockID((current) => current === projectDocumentID ? "" : current);
    setActiveRichTextBlockID((current) => {
      if (current !== projectDocumentID) return current;
      projectFormattingControllerRef.current = null;
      return "";
    });
  }, [projectDocumentID]);

  const ensureProjectDocument = useCallback(() => {
    if (!editorDataFormat.gate || !projectDocumentID) return false;
    if (!projectTextBlockContentRef.current.has(projectDocumentID)) {
      const timestamp = new Date().toISOString();
      const initialContent: EditorTextBlockContent = {
        title: "Project document",
        document: "",
        attachments: [],
      };
      const nextBlock: ProjectTextBlockDraft = {
        id: projectDocumentID,
        ...initialContent,
        attachments: [],
        linkedEmailMessageIDs: [],
        createdTimestamp: timestamp,
        updatedTimestamp: timestamp,
      };
      projectTextBlockContentRef.current.set(projectDocumentID, initialContent);
      projectTextBlockContentRevisionRef.current += 1;
      projectTextBlockSaveController.markHasChanged(projectDocumentID, initialContent);
      setBlocks((current) => current.some((block) => block.id === projectDocumentID) ? current : [nextBlock, ...current]);
      markEditorHistoryChanged({ companyID, resourceType: "project", resourceID: projectID });
      projectTextBlockSaveController.startLatestContentSave(projectDocumentID);
    }
    return true;
  }, [companyID, editorDataFormat.gate, projectDocumentID, projectID, projectTextBlockSaveController]);

  const openProjectDocument = useCallback(() => {
    if (!editorDataFormat.gate) {
      setError("Editor data format is still loading.");
      return;
    }
    if (!ensureProjectDocument()) return;
    setOpenEmailBlockIDs((current) => {
      if (!current.has(PROJECT_EMAIL_COLUMN_LAYOUT_ID)) return current;
      const next = new Set(current);
      next.delete(PROJECT_EMAIL_COLUMN_LAYOUT_ID);
      return next;
    });
    setProjectDocumentOpen(true);
    setFocusedTextBlockID("");
    setActiveRichTextBlockID("");
    projectFormattingControllerRef.current = null;
    setError("");
  }, [editorDataFormat.gate, ensureProjectDocument]);

  const toggleProjectDocument = useCallback(() => {
    if (projectDocumentOpen) {
      closeProjectDocument();
      return;
    }
    openProjectDocument();
  }, [closeProjectDocument, openProjectDocument, projectDocumentOpen]);

  useEffect(() => {
    if (
      loading
      || !projectDocumentOpen
      || !editorDataFormat.gate
      || project?.project_id.trim() !== projectDocumentID
    ) return;
    ensureProjectDocument();
  }, [editorDataFormat.gate, ensureProjectDocument, loading, project?.project_id, projectDocumentID, projectDocumentOpen]);

  const toggleProjectEmailColumn = useCallback(() => {
    closeProjectDocument();
    setOpenEmailBlockIDs((current) => toggleSetValue(current, PROJECT_EMAIL_COLUMN_LAYOUT_ID));
  }, [closeProjectDocument]);

  const stageProjectEmailSelectionChatTextBlock = useCallback((messageID: string) => {
    const cleanMessageID = messageID.trim();
    if (!cleanMessageID || !editorDataFormat.gate) return "";
    const existingTemporary = blocks.find((block) => block.temporaryEmailChat && block.stagedEmailMessageID === cleanMessageID);
    if (existingTemporary) return existingTemporary.id;
    const blockID = generateStableInformationID();
    const timestamp = new Date().toISOString();
    const color = nextEmailTextBoxColor(timelineBlocks.map((block) => block.color ?? ""));
    const temporaryBlock: ProjectTextBlockDraft = {
      id: blockID,
      title: "Email text box",
      document: "",
      attachments: [],
      linkedEmailMessageIDs: [],
      stagedEmailMessageID: cleanMessageID,
      temporaryEmailChat: true,
      color,
      createdTimestamp: timestamp,
      updatedTimestamp: timestamp,
    };
    projectTextBlockContentRef.current.set(blockID, { title: temporaryBlock.title, document: "", attachments: [] });
    setBlocks((current) => [temporaryBlock, ...current.filter((block) => block.id !== blockID)]);
    setOpenEditorBlockIDs((current) => new Set(current).add(blockID));
    setActiveRowBlockID(blockID);
    return blockID;
  }, [blocks, editorDataFormat.gate, timelineBlocks]);

  const openProjectEmailSelectionChat = useCallback((messageID: string, selection: { quote: string; startOffset: number; endOffset: number; x: number; y: number }) => {
    const cleanMessageID = messageID.trim();
    if (!cleanMessageID) {
      setError("email_message_id_missing");
      return;
    }
    setChatSelectionAnchors((current) => Object.fromEntries(
      Object.entries(current).filter(([, anchor]) => anchor.source !== "email"),
    ));
    const linkedBlock = timelineBlocks.find((block) => textBoxHasLinkedEmailMessage(block, cleanMessageID));
    const blockID = linkedBlock?.id || stageProjectEmailSelectionChatTextBlock(cleanMessageID);
    if (!blockID) return;
    const anchor: TextBlockSelectionDraft = {
      blockID, source: "email", messageID: cleanMessageID, quote: selection.quote,
      startOffset: selection.startOffset, endOffset: selection.endOffset,
      x: selection.x, y: selection.y,
    };
    setPendingProjectEmailChatSelection(linkedBlock ? null : anchor);
    setProjectEmailChatDestinationBlockID(blockID);
    setChatSelectionAnchors((current) => ({ ...current, [blockID]: anchor }));
    setOpenChatBlockIDs((current) => new Set(current).add(blockID));
    setActiveRowBlockID(blockID);
    setFocusedTextBlockID(blockID);
    setChatComposerFocusRequestIDs((current) => ({ ...current, [blockID]: (current[blockID] ?? 0) + 1 }));
    setError("");
  }, [stageProjectEmailSelectionChatTextBlock, timelineBlocks]);

  const clearProjectEmailSelectionChat = useCallback((blockID: string) => {
    const isTemporary = blocks.some((block) => block.id === blockID && block.temporaryEmailChat);
    if (isTemporary) {
      projectTextBlockContentRef.current.delete(blockID);
      projectTextBlockSaveController.removeBlock(blockID);
      setBlocks((current) => current.filter((block) => block.id !== blockID));
      setOpenEditorBlockIDs((current) => {
        const next = new Set(current);
        next.delete(blockID);
        return next;
      });
      setOpenChatBlockIDs((current) => {
        const next = new Set(current);
        next.delete(blockID);
        return next;
      });
      setChatDrafts((current) => omitRecordKey(current, blockID));
      setChatDraftEntityLinks((current) => omitRecordKey(current, blockID));
      setChatDraftAttachments((current) => omitRecordKey(current, blockID));
      setChatReplyTargets((current) => omitRecordKey(current, blockID));
    }
    setChatSelectionAnchors((current) => omitRecordKey(current, blockID));
    setPendingProjectEmailChatSelection(null);
    setProjectEmailChatDestinationBlockID("");
  }, [blocks, projectTextBlockSaveController]);

  const chooseProjectEmailChatDestination = useCallback((blockID: string) => {
    if (!pendingProjectEmailChatSelection) return false;
    const linkedBlock = timelineBlocks.find((block) => textBoxHasLinkedEmailMessage(block, pendingProjectEmailChatSelection.messageID ?? ""));
    const requestedBlock = timelineBlocks.find((block) => block.id === blockID && !block.temporaryEmailChat);
    const destinationBlock = linkedBlock ?? requestedBlock;
    if (!destinationBlock) return false;
    const anchor = { ...pendingProjectEmailChatSelection, blockID: destinationBlock.id };
    const previousBlockID = projectEmailChatDestinationBlockID;
    if (previousBlockID === destinationBlock.id) return true;
    const destinationHasDraft = Boolean(
      chatDrafts[destinationBlock.id]
      || chatDraftEntityLinks[destinationBlock.id]?.length
      || chatDraftAttachments[destinationBlock.id]?.length
    );
    if (destinationHasDraft) {
      setError("This text box already has an unsent chat draft. Send or clear it before choosing it as the destination.");
      return false;
    }
    setChatDrafts((current) => moveEmailChatComposerEntry(current, previousBlockID, destinationBlock.id));
    setChatDraftEntityLinks((current) => moveEmailChatComposerEntry(current, previousBlockID, destinationBlock.id));
    setChatDraftAttachments((current) => moveEmailChatComposerEntry(current, previousBlockID, destinationBlock.id));
    if (blocks.some((block) => block.id === previousBlockID && block.temporaryEmailChat)) {
      projectTextBlockContentRef.current.delete(previousBlockID);
      projectTextBlockSaveController.removeBlock(previousBlockID);
      setBlocks((current) => current.filter((block) => block.id !== previousBlockID));
      setOpenEditorBlockIDs((current) => { const next = new Set(current); next.delete(previousBlockID); return next; });
    }
    setChatSelectionAnchors((current) => {
      const next = { ...current };
      delete next[previousBlockID];
      next[destinationBlock.id] = anchor;
      return next;
    });
    setOpenChatBlockIDs((current) => {
      const next = new Set(current);
      next.delete(previousBlockID);
      next.add(destinationBlock.id);
      return next;
    });
    setPendingProjectEmailChatSelection(anchor);
    setProjectEmailChatDestinationBlockID(destinationBlock.id);
    setFocusedTextBlockID(destinationBlock.id);
    setActiveRowBlockID(destinationBlock.id);
    setChatComposerFocusRequestIDs((current) => ({ ...current, [destinationBlock.id]: (current[destinationBlock.id] ?? 0) + 1 }));
    setError("");
    return true;
  }, [blocks, chatDraftAttachments, chatDraftEntityLinks, chatDrafts, pendingProjectEmailChatSelection, projectEmailChatDestinationBlockID, projectTextBlockSaveController, timelineBlocks]);

  const chooseProjectEmailChatNewTextBoxDestination = useCallback(() => {
    if (!pendingProjectEmailChatSelection) return;
    const linkedBlock = timelineBlocks.find((block) => textBoxHasLinkedEmailMessage(block, pendingProjectEmailChatSelection.messageID ?? ""));
    if (linkedBlock) {
      chooseProjectEmailChatDestination(linkedBlock.id);
      return;
    }
    const blockID = stageProjectEmailSelectionChatTextBlock(pendingProjectEmailChatSelection.messageID ?? "");
    if (!blockID || blockID === projectEmailChatDestinationBlockID) return;
    const previousBlockID = projectEmailChatDestinationBlockID;
    setChatDrafts((current) => moveEmailChatComposerEntry(current, previousBlockID, blockID));
    setChatDraftEntityLinks((current) => moveEmailChatComposerEntry(current, previousBlockID, blockID));
    setChatDraftAttachments((current) => moveEmailChatComposerEntry(current, previousBlockID, blockID));
    const anchor = { ...pendingProjectEmailChatSelection, blockID };
    setChatSelectionAnchors((current) => {
      const next = { ...current };
      delete next[previousBlockID];
      next[blockID] = anchor;
      return next;
    });
    setOpenChatBlockIDs((current) => {
      const next = new Set(current);
      next.delete(previousBlockID);
      next.add(blockID);
      return next;
    });
    setPendingProjectEmailChatSelection(anchor);
    setProjectEmailChatDestinationBlockID(blockID);
    setFocusedTextBlockID(blockID);
    setActiveRowBlockID(blockID);
    setChatComposerFocusRequestIDs((current) => ({ ...current, [blockID]: (current[blockID] ?? 0) + 1 }));
    setError("");
  }, [chooseProjectEmailChatDestination, pendingProjectEmailChatSelection, projectEmailChatDestinationBlockID, stageProjectEmailSelectionChatTextBlock, timelineBlocks]);

  useEffect(() => {
    if (!pendingProjectEmailChatSelection) return undefined;
    const cancelPendingDestination = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearProjectEmailSelectionChat(projectEmailChatDestinationBlockID);
    };
    window.addEventListener("keydown", cancelPendingDestination);
    return () => window.removeEventListener("keydown", cancelPendingDestination);
  }, [clearProjectEmailSelectionChat, pendingProjectEmailChatSelection, projectEmailChatDestinationBlockID]);

  const removeTextBlock = useCallback(async (blockID: string) => {
    if (blockID === projectDocumentID) return;
    if (!editorDataFormat.gate) {
      setError("Editor data format is still loading.");
      return;
    }
    const timer = projectTextBlockSaveTimersRef.current.get(blockID);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      projectTextBlockSaveTimersRef.current.delete(blockID);
    }
    try {
      await flushMangoTiptapDocument({ companyID, resourceType: "project", resourceID: projectID, documentID: blockID });
    } catch (flushError) {
      setError(flushError instanceof Error ? flushError.message : "Failed to save project text before deletion");
      return;
    }
    await projectTextBlockSaveController.waitForInProgressSaveThenRemoveBlock(blockID);
    const latestContent = projectTextBlockContentRef.current.get(blockID);
    const previousBlock = blocks.find((block) => block.id === blockID);
    const removedChatMessages = chatMessages.filter((message) => message.blockID === blockID);
    const removedAttachedEmails = attachedEmails.filter((email) => email.blockID === blockID);
    projectTextBlockContentRef.current.delete(blockID);
    projectTextBlockContentRevisionRef.current += 1;
    setBlocks((current) => current.filter((block) => block.id !== blockID));
    setChatMessages((current) => current.filter((message) => message.blockID !== blockID));
    setAttachedEmails((current) => current.filter((email) => email.blockID !== blockID));
    setError("");
    try {
      const editorPath = `/v1/editor-json/project/${projectID}/documents/${blockID}?company_id=${encodeURIComponent(companyID)}`;
      const baseRevision = (await attachmentRequestJSON<{ revision: number }>(editorPath)).revision;
      // The document DELETE is the sole owner command; the backend removes textbox chats and exact email links atomically.
      await attachmentRequestJSON(editorPath, {
        method: "DELETE",
        body: JSON.stringify({
          operation_id: generateStableInformationID(),
          client_id: `project-delete:${currentUserID || "browser"}`,
          base_revision: baseRevision,
        }),
      });
      refreshProjectAttachments();
      markEditorHistoryChanged({ companyID, resourceType: "project", resourceID: projectID });
    } catch (deleteError) {
      if (previousBlock && latestContent) {
        const restoredBlock: ProjectTextBlockDraft = {
          ...previousBlock,
          title: latestContent.title,
          document: latestContent.document,
          attachments: latestContent.attachments ?? [],
        };
        projectTextBlockContentRef.current.set(blockID, latestContent);
        projectTextBlockContentRevisionRef.current += 1;
        projectTextBlockSaveController.markHasChanged(blockID, latestContent);
        projectTextBlockSaveController.startLatestContentSave(blockID);
        setBlocks((current) => current.some((block) => block.id === blockID) ? current : [restoredBlock, ...current]);
      }
      setChatMessages((current) => {
        const currentIDs = new Set(current.map((message) => message.id));
        return [...removedChatMessages.filter((message) => !currentIDs.has(message.id)), ...current];
      });
      setAttachedEmails((current) => {
        const currentIDs = new Set(current.map((email) => email.id));
        return [...removedAttachedEmails.filter((email) => !currentIDs.has(email.id)), ...current];
      });
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete project text");
    }
  }, [attachedEmails, attachmentRequestJSON, blocks, chatMessages, companyID, currentUserID, editorDataFormat.gate?.editor_format, projectDocumentID, projectID, projectTextBlockSaveController, refreshProjectAttachments]);

  const addTextBlockAttachments = useCallback(async (block: ProjectTextBlockDraft, files: FileList | File[]) => {
    const incomingFiles = Array.from(files);
    if (incomingFiles.length === 0) return;
    setError("");
    const uploadScope = projectSaveScope;
    const results = await Promise.allSettled(incomingFiles.map((file) => uploadEditorAttachment(file, {
      requestJSON: attachmentRequestJSON,
      companyID,
      resourceType: "project",
      resourceID: projectID,
      sourceKind: "user_upload",
      relationshipKind: "file_attachment",
      informationID: block.id,
      editorSurface: "project_text_block",
    })));
    if (projectSaveScopeRef.current !== uploadScope) return;
    const attachments = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    if (attachments.length > 0) {
      const latest = projectTextBlockContentRef.current.get(block.id) ?? {
        title: block.title,
        document: block.document,
        attachments: block.attachments,
      };
      const nextAttachments = [...(latest.attachments ?? []), ...attachments];
      try {
        await flushProjectTextBlockSave(block.id, { attachments: nextAttachments });
        refreshProjectAttachments();
      } catch (attachmentError) {
        setError(attachmentError instanceof Error ? attachmentError.message : "Failed to save attachment references");
      }
    }
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length > 0) {
      const first = failures[0]?.reason;
      setError(first instanceof Error ? first.message : "Failed to add attachment");
    }
  }, [attachmentRequestJSON, companyID, flushProjectTextBlockSave, projectID, projectSaveScope, refreshProjectAttachments]);

  const submitChatMessage = useCallback(async (blockID: string) => {
    if (projectChatSubmissionsInProgressRef.current.has(blockID)) return;
    const { message, entityLinks } = trimEditorChatDraft(chatDrafts[blockID] ?? "", chatDraftEntityLinks[blockID] ?? []);
    const attachments = chatDraftAttachments[blockID] ?? [];
    if (!editorChatAttachmentsReadyForSubmit(attachments)) return;
    if (!message && attachments.length === 0) return;
    const id = generateStableInformationID();
    const timestamp = new Date().toISOString();
    const parentID = chatReplyTargets[blockID];
    const selection = parentID ? undefined : chatSelectionAnchors[blockID];
    const chatBlock = blocks.find((block) => block.id === blockID);
    const createsEmailTextBoxOnSend = Boolean(chatBlock?.temporaryEmailChat);
    const ensureEmailTextBoxLinkOnSend = selection?.source === "email"
      && Boolean(selection.messageID?.trim())
      && (!chatBlock || !textBoxHasLinkedEmailMessage(chatBlock, selection.messageID ?? ""));
    if (createsEmailTextBoxOnSend && !ensureEmailTextBoxLinkOnSend) return;
    const emailTextBoxColorOnSend = ensureEmailTextBoxLinkOnSend
      ? chatBlock?.color?.trim() || nextEmailTextBoxColor(timelineBlocks.map((block) => block.color ?? ""))
      : undefined;
    const nextMessage: EditorTextBlockChatMessage = {
      id,
      blockID,
      parentID: parentID || undefined,
      selectionSource: selection?.source ?? "text",
      selectionMessageID: selection?.messageID,
      selectionQuote: selection?.quote,
      selectionStart: selection?.startOffset,
      selectionEnd: selection?.endOffset,
      authorID: currentUserID,
      authorName: currentUserName,
      message,
      createdTimestamp: timestamp,
      attachments,
      entityLinks,
    };
    setError("");
    projectChatSubmissionsInProgressRef.current.add(blockID);
    try {
      await addProjectInformation({
        companyID,
        projectID,
        informationID: id,
        type: EDITOR_TEXT_BLOCK_CHAT_TYPE,
        information: buildEditorTextBlockChatPayload({
          blockID,
          ensureEmailTextBoxLinkOnSend,
          emailTextBoxColorOnSend,
          parentID,
          selectionSource: selection?.source,
          selectionBlockID: selection?.source === "email" ? blockID : undefined,
          selectionMessageID: selection?.messageID,
          selectionQuote: selection?.quote,
          selectionStart: selection?.startOffset,
          selectionEnd: selection?.endOffset,
          authorID: currentUserID,
          authorName: currentUserName,
          message,
          createdTimestamp: timestamp,
          attachments,
          entityLinks,
        }),
      });
      setChatMessages((current) => [...current, nextMessage]);
      setChatDrafts((current) => ({ ...current, [blockID]: "" }));
      setChatDraftEntityLinks((current) => omitRecordKey(current, blockID));
      setChatDraftAttachments((current) => ({ ...current, [blockID]: [] }));
      setChatReplyTargets((current) => omitRecordKey(current, blockID));
      setChatSelectionAnchors((current) => omitRecordKey(current, blockID));
      if (selection?.source === "email") {
        setBlocks((current) => current.map((block) => block.id === blockID ? {
          ...block,
          temporaryEmailChat: false,
          stagedEmailMessageID: undefined,
          color: block.color?.trim() || emailTextBoxColorOnSend,
          linkedEmailMessageIDs: selection.messageID
            ? Array.from(new Set([...block.linkedEmailMessageIDs, selection.messageID]))
            : block.linkedEmailMessageIDs,
        } : block));
        setPendingProjectEmailChatSelection(null);
        setProjectEmailChatDestinationBlockID("");
        markEditorHistoryChanged({ companyID, resourceType: "project", resourceID: projectID });
        await loadProject({ showLoading: false });
      }
    } catch (chatError) {
      setError(chatError instanceof Error ? chatError.message : "Failed to add chat message");
    } finally {
      projectChatSubmissionsInProgressRef.current.delete(blockID);
    }
  }, [blocks, chatDraftAttachments, chatDraftEntityLinks, chatDrafts, chatReplyTargets, chatSelectionAnchors, companyID, currentUserID, currentUserName, loadProject, projectID, timelineBlocks]);

  const deleteChatMessage = useCallback(async (messageID: string) => {
    setChatMessages((current) => current.filter((message) => message.id !== messageID));
    setError("");
    try {
      await deleteProjectProjection({ companyID, projectID, informationID: messageID });
    } catch (chatError) {
      setError(chatError instanceof Error ? chatError.message : "Failed to delete chat message");
      await loadProject({ showLoading: false });
    }
  }, [companyID, loadProject, projectID]);

  const editChatMessage = useCallback(async (messageID: string, nextText: string) => {
    const existing = chatMessages.find((item) => item.id === messageID);
    if (!existing || !canEditEditorTextBlockChatMessage(existing, currentUserID)) {
      const cause = new Error("cannot_edit_other_users_chat_message");
      setError(cause.message);
      throw cause;
    }
    const message = nextText.trim();
    if (!message && existing.attachments.length === 0) {
      const cause = new Error("chat_message_required");
      setError(cause.message);
      throw cause;
    }
    if (message === existing.message) return;
    const mentionedUserIDs = projectChatMentionedUserIDs(message, companyUsers);
    const entityLinks = remapEditorChatEntityLinks(existing.message, message, existing.entityLinks ?? []);
    const editedTimestamp = new Date().toISOString();
    setChatMessages((current) => current.map((item) => item.id === messageID ? {
      ...item,
      message,
      editedTimestamp,
      entityLinks,
      mentionedUserIDs,
    } : item));
    setError("");
    try {
      await editProjectChatComment({
        companyID,
        projectID,
        informationID: messageID,
        message,
        entityLinks,
        mentionedUserIDs,
        mentionedGroupIDs: existing.mentionedGroupIDs,
      });
    } catch (chatError) {
      setChatMessages((current) => current.map((item) => item.id === messageID ? existing : item));
      setError(chatError instanceof Error ? chatError.message : "Failed to edit chat message");
      throw chatError;
    }
  }, [chatMessages, companyID, companyUsers, currentUserID, projectID]);

  const attachChatDraftFiles = useCallback(async (blockID: string, files: FileList | File[]) => {
    const incomingFiles = Array.from(files);
    if (incomingFiles.length === 0) return;
    const results = await Promise.allSettled(incomingFiles.map((file) => uploadEditorAttachment(file, {
      requestJSON: attachmentRequestJSON,
      companyID,
      resourceType: "project",
      resourceID: projectID,
      sourceKind: "chat_upload",
      relationshipKind: "chat_attachment",
      informationID: blockID,
      editorSurface: "project_text_block_chat",
    })));
    const attachments = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    if (attachments.length > 0) {
      setChatDraftAttachments((current) => ({ ...current, [blockID]: [...(current[blockID] ?? []), ...attachments] }));
    }
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length > 0) {
      const first = failures[0]?.reason;
      setError(first instanceof Error ? first.message : "Failed to add chat attachment");
    }
  }, [attachmentRequestJSON, companyID, projectID]);

  const addImageChatComment = useCallback(async (image: TextBlockImageDraft) => {
    setOpenChatBlockIDs((current) => new Set(current).add(image.blockID));
    setChatComposerFocusRequestIDs((current) => ({
      ...current,
      [image.blockID]: (current[image.blockID] ?? 0) + 1,
    }));
    setChatMessageFocusRequests((current) => omitRecordKey(current, image.blockID));
    setActiveChatMessageIDs((current) => omitRecordKey(current, image.blockID));
    try {
      await transferTextBlockImageToChatDraft({
        image,
        requestJSON: attachmentRequestJSON,
        companyID,
        resourceType: "project",
        resourceID: projectID,
        editorSurface: "project_text_block_image_chat",
        createPendingID: generateStableInformationID,
        uploadLegacyImage: async () => {
          const file = await prepareTextBlockImageFile(image, apiBase, companyID);
          if (!file) throw new Error("Failed to prepare image attachment");
          return uploadEditorAttachment(file, {
            requestJSON: attachmentRequestJSON,
            companyID,
            resourceType: "project",
            resourceID: projectID,
            sourceKind: "chat_upload",
            relationshipKind: "chat_attachment",
            informationID: image.blockID,
            editorSurface: "project_text_block_image_chat",
          });
        },
        onStage: (attachment) => setChatDraftAttachments((current) => ({
          ...current,
          [image.blockID]: stageEditorChatAttachmentTransfer(current[image.blockID] ?? [], attachment),
        })),
        onResolve: (pendingID, attachment) => setChatDraftAttachments((current) => ({
          ...current,
          [image.blockID]: resolveEditorChatAttachmentTransfer(current[image.blockID] ?? [], pendingID, attachment),
        })),
        onReject: (pendingID) => setChatDraftAttachments((current) => ({
          ...current,
          [image.blockID]: failEditorChatAttachmentTransfer(current[image.blockID] ?? [], pendingID),
        })),
      });
    } catch (attachmentError) {
      setError(attachmentError instanceof Error ? attachmentError.message : "Failed to add chat attachment");
    }
  }, [apiBase, attachmentRequestJSON, companyID, projectID]);

  const attachEmailToProject = useCallback(async (message: Parameters<typeof messageAttachmentPayload>[0], scope: { sharedInboxID?: string; accountEmail?: string } = {}) => {
    const payload = messageAttachmentPayload(message, scope.sharedInboxID, scope.accountEmail);
    const id = generateStableInformationID();
    const nextEmail: EditorAttachedEmail = {
      id,
      messageID: payload.messageID,
      emailMessageID: payload.emailMessageID,
      emailThreadID: payload.emailThreadID,
      threadID: payload.threadID,
      sharedInboxID: payload.sharedInboxID,
      accountEmail: payload.accountEmail,
      subject: payload.subject,
      snippet: payload.snippet,
      from: payload.from,
      date: payload.date,
      attachedTimestamp: payload.attachedTimestamp,
    };
    setError("");
    try {
      await addProjectInformation({
        companyID,
        projectID,
        informationID: id,
        type: EDITOR_ATTACHED_EMAIL_TYPE,
        information: buildEditorAttachedEmailPayload({ ...payload, linkWholeThread: true }),
      });
      setAttachedEmails((current) => [nextEmail, ...current.filter((email) => email.messageID !== nextEmail.messageID || email.blockID?.trim())]);
      closeProjectDocument();
      setOpenEmailBlockIDs((current) => new Set(current).add(PROJECT_EMAIL_COLUMN_LAYOUT_ID));
      setSelectedEmailIDsByBlock((current) => ({ ...current, [PROJECT_EMAIL_COLUMN_LAYOUT_ID]: payload.messageID }));
      setEmailPicker(null);
    } catch (emailError) {
      const message = emailError instanceof Error ? emailError.message : "Failed to attach email";
      setError(message);
      throw emailError instanceof Error ? emailError : new Error(message);
    }
  }, [closeProjectDocument, companyID, projectID]);

  const linkEmailToProject = useCallback(async (entity: EditorEntityLink) => {
    if (entity.entityType !== "email_message" || !entity.emailMessage) {
      throw new Error("A Project can only link a selected Email.");
    }
    await attachEmailToProject(entity.emailMessage, {
      sharedInboxID: entity.emailSharedInboxID,
      accountEmail: entity.emailAccountEmail,
    });
  }, [attachEmailToProject]);

  const focusProjectEmailTextBlock = useCallback((blockID: string, color = "") => {
    const cleanBlockID = blockID.trim();
    if (!cleanBlockID || cleanBlockID === projectDocumentID) return;
    setActiveRowBlockID(cleanBlockID);
    setOpenEditorBlockIDs((current) => new Set(current).add(cleanBlockID));
    setOpenEmailBlockIDs((current) => new Set(current).add(cleanBlockID));
    setFocusedTextBlockID(cleanBlockID);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const target = Array.from(textBlocksScrollRef.current?.querySelectorAll<HTMLElement>("[data-project-text-box-row]") ?? [])
        .find((element) => element.dataset.projectTextBoxRow === cleanBlockID);
      target?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      target?.animate([
        { transform: "translateX(0)", boxShadow: "0 0 0 0 rgba(14,165,233,0)" },
        { transform: "translateX(3px)", boxShadow: `0 0 0 4px ${color.trim() || accent}33` },
        { transform: "translateX(0)", boxShadow: "0 0 0 0 rgba(14,165,233,0)" },
      ], { duration: 860, easing: "ease-out" });
    }));
  }, [accent, projectDocumentID]);

  const revealProjectEmailTextBlock = useCallback((messageID: string) => {
    const cleanMessageID = messageID.trim();
    const block = timelineBlocks.find((candidate) => textBoxHasLinkedEmailMessage(candidate, cleanMessageID));
    if (block) focusProjectEmailTextBlock(block.id, block.color);
  }, [focusProjectEmailTextBlock, timelineBlocks]);

  const linkEmailMessageToProjectTextBlock = useCallback(async (messageID: string, blockID: string, preferredColor = "") => {
    const cleanMessageID = messageID.trim();
    const cleanBlockID = blockID.trim();
    if (!cleanMessageID || !cleanBlockID || cleanBlockID === projectDocumentID) return;
    const linkedBlock = timelineBlocks.find((block) => textBoxHasLinkedEmailMessage(block, cleanMessageID));
    if (linkedBlock) {
      if (linkedBlock.id === cleanBlockID) {
        focusProjectEmailTextBlock(linkedBlock.id, linkedBlock.color);
        return;
      }
      throw new Error("This email message is already linked to another text box in this Project.");
    }
    const targetBlock = timelineBlocks.find((block) => block.id === cleanBlockID);
    if (!targetBlock && !projectTextBlockContentRef.current.has(cleanBlockID)) throw new Error("project_textbox_not_found");
    const color = targetBlock?.color?.trim().toUpperCase()
      || preferredColor.trim().toUpperCase()
      || nextEmailTextBoxColor(timelineBlocks.map((block) => block.color ?? ""));
    await projectTextBlockSaveController.saveLatestContent(cleanBlockID);
    setBlocks((current) => current.map((block) => block.id === cleanBlockID
      ? { ...block, stagedEmailMessageID: cleanMessageID }
      : block));
    try {
      await addProjectInformation({
        companyID,
        projectID,
        informationID: generateStableInformationID(),
        type: EDITOR_ATTACHED_EMAIL_TYPE,
        information: JSON.stringify({
          block_id: cleanBlockID,
          email_message_id: cleanMessageID,
          textbox_color: color,
          attached_timestamp: new Date().toISOString(),
          link_scope: "message",
        }),
      });
      setBlocks((current) => current.map((block) => block.id === cleanBlockID ? {
        ...block,
        stagedEmailMessageID: undefined,
        color: block.color?.trim().toUpperCase() || color,
        linkedEmailMessageIDs: Array.from(new Set([...block.linkedEmailMessageIDs, cleanMessageID])),
      } : block));
      setOpenEmailBlockIDs((current) => new Set(current).add(cleanBlockID));
      markEditorHistoryChanged({ companyID, resourceType: "project", resourceID: projectID });
      await loadProject({ showLoading: false });
      focusProjectEmailTextBlock(cleanBlockID, color);
    } catch (cause) {
      setBlocks((current) => current.map((block) => block.id === cleanBlockID && block.stagedEmailMessageID === cleanMessageID
        ? { ...block, stagedEmailMessageID: undefined }
        : block));
      throw cause;
    }
  }, [companyID, focusProjectEmailTextBlock, loadProject, projectDocumentID, projectID, projectTextBlockSaveController, timelineBlocks]);

  const createProjectEmailTextBlock = useCallback(async (messageID: string, quote = "") => {
    const cleanMessageID = messageID.trim();
    if (!cleanMessageID) return "";
    const existingBlock = timelineBlocks.find((block) => textBoxHasLinkedEmailMessage(block, cleanMessageID));
    if (existingBlock) {
      revealProjectEmailTextBlock(cleanMessageID);
      return existingBlock.id;
    }
    const sourceEmail = attachedEmails.find((email) => email.emailMessageID === cleanMessageID);
    const color = nextEmailTextBoxColor(timelineBlocks.map((block) => block.color ?? ""));
    const documentValue = quote.trim() && typeof document !== "undefined"
      ? createEmailSelectionDocument(document, quote.trim())
      : "";
    const blockID = addTextBlock(sourceEmail?.subject.trim() ? `Email: ${sourceEmail.subject.trim()}` : "Email text box", false, documentValue);
    if (!blockID) return "";
    setBlocks((current) => current.map((block) => block.id === blockID
      ? { ...block, stagedEmailMessageID: cleanMessageID, color }
      : block));
    setActiveRowBlockID(blockID);
    setFocusedTextBlockID(blockID);
    setOpenEmailBlockIDs((current) => new Set(current).add(blockID));
    try {
      await linkEmailMessageToProjectTextBlock(cleanMessageID, blockID, color);
      return blockID;
    } catch (cause) {
      setBlocks((current) => current.map((block) => block.id === blockID
        ? { ...block, stagedEmailMessageID: undefined, color: undefined }
        : block));
      setError(cause instanceof Error ? cause.message : "failed_to_link_email_to_project_text_box");
      return "";
    }
  }, [addTextBlock, attachedEmails, linkEmailMessageToProjectTextBlock, revealProjectEmailTextBlock, timelineBlocks]);

  const removeAttachedEmail = useCallback(async (emailID: string) => {
    const target = attachedEmails.find((email) => email.id === emailID);
    if (!target) return;
    setError("");
    try {
      await deleteProjectProjection({ companyID, projectID, informationID: target.id });
      setAttachedEmails((current) => current.filter((email) => email.id !== target.id));
      const blockID = target.blockID?.trim() ?? "";
      if (blockID) {
        setBlocks((current) => current.map((block) => {
          if (block.id !== blockID) return block;
          const linkedEmailMessageIDs = block.linkedEmailMessageIDs.filter((messageID) => messageID !== target.emailMessageID);
          return { ...block, linkedEmailMessageIDs, color: linkedEmailMessageIDs.length > 0 ? block.color : undefined };
        }));
      }
      setSelectedEmailIDsByBlock((current) => Object.fromEntries(
        Object.entries(current).filter(([, messageID]) => messageID !== target.messageID),
      ));
    } catch (emailError) {
      setError(emailError instanceof Error ? emailError.message : "Failed to remove email");
      await loadProject({ showLoading: false });
    }
  }, [attachedEmails, companyID, loadProject, projectID]);

  const addRelationshipTargets = useCallback(async (targets: ProjectRelationshipDropTarget[]): Promise<ProjectRelationshipProjection[]> => {
    const existingByKey = new Map(relationships.map((item) => [`${item.resource_type}:${item.resource_id}`, item]));
    const ensuredRelationships: ProjectRelationshipProjection[] = [];
    const uniqueTargets: ProjectRelationshipDropTarget[] = [];
    const incoming = new Set<string>();
    for (const target of targets) {
      const resourceID = target.resourceID.trim();
      if (!resourceID) continue;
      const key = `node:${resourceID}`;
      if (incoming.has(key)) continue;
      const existing = existingByKey.get(key);
      if (existing) {
        ensuredRelationships.push(existing);
        incoming.add(key);
        continue;
      }
      incoming.add(key);
      uniqueTargets.push({ resourceType: "node", resourceID });
    }
    if (uniqueTargets.length === 0) return ensuredRelationships;
    setError("");
    try {
      const results = await Promise.all(uniqueTargets.map((target, index) => upsertProjectRelationship({
        companyID,
        projectID,
        resourceType: "node",
        resourceID: target.resourceID,
        position: relationships.length + index + 1,
      })));
      const nextRelationships = results.flatMap((result) => [
        ...(result.implicit_relationships ?? []),
        ...(result.relationship ? [result.relationship] : []),
      ]);
      if (nextRelationships.length > 0) {
        setRelationships((current) => mergeProjectRelationships(current, nextRelationships));
      } else {
        await loadProject({ showLoading: false });
      }
      return [...ensuredRelationships, ...nextRelationships];
    } catch (relationshipError) {
      setError(relationshipError instanceof Error ? relationshipError.message : "Failed to add relationships");
      return ensuredRelationships;
    }
  }, [companyID, loadProject, projectID, relationships]);
  const addRelationshipFromPicker = useCallback(async (entity: EditorEntityLink) => {
    if (entity.entityType !== "node" || !entity.entityID.trim() || relationshipActionBusy) return;
    const resourceID = entity.entityID.trim();
    setRelationshipActionBusy(true);
    try {
      const ensured = await addRelationshipTargets([{ resourceType: "node", resourceID }]);
      if (ensured.some((relationship) => relationship.resource_type === "node" && relationship.resource_id === resourceID)) {
        setRelationshipPickerAnchor(null);
      }
    } finally {
      setRelationshipActionBusy(false);
    }
  }, [addRelationshipTargets, relationshipActionBusy]);
  const convertTriageMessagesToProject = useCallback(async (
    drag: ReturnType<typeof readTriageMessageDrag>,
    logicGateID = "",
  ) => {
    const messageIDs = normalizeTriageMessageIDs(drag.messageIDs);
    if (messageIDs.length === 0) return;
    const dragCompanyID = drag.companyID?.trim() ?? "";
    if (dragCompanyID && dragCompanyID !== companyID) {
      setError("Email drop belongs to another company");
      return;
    }
    const cleanProjectID = projectID.trim();
    const cleanLogicGateID = logicGateID.trim();
    if (!companyID || !cleanProjectID) return;
    if (!cleanLogicGateID) {
      setError("Add email work through a Process in this Project.");
      return;
    }
    const sharedInboxID = drag.sharedInboxID?.trim() || undefined;
    const accountEmail = sharedInboxID ? undefined : drag.accountEmail?.trim().toLowerCase() || undefined;
    setError("");
    setRelationshipDropActive(false);
    selectRightPanelTab("relationships");
    dispatchTriageConversionApplied({ companyID, messageIDs, sharedInboxID, accountEmail });
    try {
      const position = relationships.length + 1;
      const target: CommunicationsTriageConversionTarget = {
        mode: "existing_logic_gate", logicGateID: cleanLogicGateID, projectID: cleanProjectID, position,
      };
      const result = await convertTriageMessagesToExplorerTarget({
        companyID,
        sharedInboxID,
        accountEmail,
        target,
        messageIDs,
      });
      const nextRelationships = result.project_relationships ?? [];
      if (nextRelationships.length > 0) {
        setRelationships((current) => mergeProjectRelationships(current, nextRelationships));
      } else {
        await loadProject({ showLoading: false });
      }
      const convertedMessageIDs = normalizeTriageMessageIDs(result.deleted_message_ids?.length ? result.deleted_message_ids : messageIDs);
      const savedCards = result.cards ?? [];
      const boardIDs = Array.from(new Set([
        result.board?.board_id ?? "",
        ...savedCards.map((card) => card.board_id),
      ].map((id) => id.trim()).filter(Boolean)));
      dispatchTriageConversionApplied({
        companyID,
        messageIDs: convertedMessageIDs,
        sharedInboxID,
        accountEmail,
        logicGateID: result.board?.logic_gate_id?.trim() || cleanLogicGateID || undefined,
        nodeIDs: (result.nodes ?? []).map((node) => node.node_id),
        boardIDs,
        cardIDs: savedCards.map((card) => card.card_id),
        unstarredMessageIDs: normalizeTriageMessageIDs(result.unstarred_message_ids ?? []),
      });
      const createdNodeID = result.nodes?.[0]?.node_id?.trim() ?? "";
      if (createdNodeID) onNodeOpen?.(createdNodeID);
    } catch (dropError) {
      setError(dropError instanceof Error ? dropError.message : "Email drop failed");
      await loadProject({ showLoading: false });
    }
  }, [companyID, loadProject, onNodeOpen, projectID, relationships.length, selectRightPanelTab]);

  const saveProjectAssignments = useCallback(async () => {
    if (!project) return;
    setAssignmentsSaving(true);
    setError("");
    try {
      const accountIDs = uniqueStringIDs(assignmentAccountIDs);
      const teamIDs = uniqueStringIDs(assignmentTeamIDs);
      const result = await updateProject({
        companyID,
        projectID,
        name: project.name || "Untitled Project",
        status: project.status || "Active",
        health: normalizeProjectHealth(project.health),
        accountIDs,
        teamIDs,
      });
      if (result.project) {
        setProject(result.project);
        setAssignmentAccountIDs(projectAccountIDs(result.project));
        setAssignmentTeamIDs(projectTeamIDs(result.project));
      } else {
        await loadProject({ showLoading: false });
      }
      setAssignmentsOpen(false);
    } catch (assignmentError) {
      setError(assignmentError instanceof Error ? assignmentError.message : "Failed to save project assignments");
    } finally {
      setAssignmentsSaving(false);
    }
  }, [assignmentAccountIDs, assignmentTeamIDs, companyID, loadProject, project, projectID]);

  const saveProjectMetadata = useCallback(async (update: Partial<{
    status: string;
    health: ProjectHealth;
    accountIDs: string[];
    teamIDs: string[];
  }>) => {
    if (!project) return;
    const previous = project;
    const accountIDs = update.accountIDs ?? projectAccountIDs(project);
    const teamIDs = update.teamIDs ?? projectTeamIDs(project);
    const optimistic: ProjectRecord = {
      ...project,
      status: update.status ?? project.status ?? "Active",
      health: update.health ?? normalizeProjectHealth(project.health),
      accounts: accountIDs.map((accountID) => (
        accounts.find((account) => account.account_id === accountID)
        ?? project.accounts?.find((account) => account.account_id === accountID)
      )).filter((account): account is Account => Boolean(account)),
      teams: teamIDs.map((teamID) => {
        const existing = project.teams?.find((team) => team.group_id === teamID);
        if (existing) return existing;
        const group = groups.find((item) => item.group_id === teamID);
        return {
          company_id: companyID,
          group_id: teamID,
          parent_group_id: group?.parent_group_id,
          name: group?.name || teamID,
          position: group?.position ?? 0,
          created_timestamp: project.created_timestamp,
          updated_timestamp: project.updated_timestamp,
        };
      }),
    };
    setProjectMetadataSaving(true);
    setProject(optimistic);
    setError("");
    try {
      const result = await updateProject({
        companyID,
        projectID,
        name: optimistic.name || "Untitled Project",
        status: optimistic.status || "Active",
        health: normalizeProjectHealth(optimistic.health),
        accountIDs,
        teamIDs,
      });
      const saved = result.project ?? optimistic;
      setProject(saved);
      setAssignmentAccountIDs(projectAccountIDs(saved));
      setAssignmentTeamIDs(projectTeamIDs(saved));
      onProjectUpdated?.(saved);
    } catch (metadataError) {
      setProject(previous);
      setError(metadataError instanceof Error ? metadataError.message : "Failed to update project");
    } finally {
      setProjectMetadataSaving(false);
    }
  }, [accounts, companyID, groups, onProjectUpdated, project, projectID]);

  const saveProjectFields = useCallback(async (nextFieldIDs: string[]) => {
    if (!project || projectMetadataSaving) return;
    const fieldIDs = uniqueStringIDs(nextFieldIDs);
    const previous = project;
    const optimistic: ProjectRecord = {
      ...project,
      fields: fieldIDs.map((fieldID) => (
        entityFields.find((field) => field.field_id === fieldID)
        ?? project.fields?.find((field) => field.field_id === fieldID)
      )).filter((field): field is EntityField => Boolean(field)),
    };
    setProjectMetadataSaving(true);
    setProject(optimistic);
    setError("");
    try {
      const savedFields = await setEntityFieldAssignments({
        companyID,
        resourceType: "project",
        resourceID: projectID,
        fieldIDs,
      });
      const saved = { ...optimistic, fields: savedFields };
      setProject(saved);
      onProjectUpdated?.(saved);
    } catch (metadataError) {
      setProject(previous);
      setError(metadataError instanceof Error ? metadataError.message : "Failed to update project fields");
    } finally {
      setProjectMetadataSaving(false);
    }
  }, [companyID, entityFields, onProjectUpdated, project, projectID, projectMetadataSaving]);

  const selectRelationshipNode = useCallback((relationshipID: string, event: React.MouseEvent<HTMLElement>) => {
    const next = buildProjectRelationshipNodeSelectionUpdate({
      orderedIDs: visibleRelationshipNodeIDs,
      selectedIDs: selectedRelationshipNodeIDs,
      anchorID: selectionAnchorRelationshipNodeID,
      clickedID: relationshipID,
      shiftKey: event.shiftKey,
      additiveKey: event.ctrlKey || event.metaKey,
    });
    setSelectedRelationshipNodeIDs(next.selectedIDs);
    setSelectionAnchorRelationshipNodeID(next.anchorID);
  }, [selectedRelationshipNodeIDs, selectionAnchorRelationshipNodeID, visibleRelationshipNodeIDs]);

  const openRelationshipNodeContextMenu = useCallback((
    event: React.MouseEvent<HTMLElement>,
    node: ProjectRelationshipProjection,
    logicGateID = "",
  ) => {
    const relationshipID = node.relationship_id.trim();
    const resourceID = (node.node_id || node.resource_id || "").trim();
    if (!relationshipID || !resourceID) return;
    event.preventDefault();
    event.stopPropagation();
    if (!selectedRelationshipNodeIDs.has(relationshipID)) {
      setSelectedRelationshipNodeIDs(new Set([relationshipID]));
      setSelectionAnchorRelationshipNodeID(relationshipID);
    }
    setRelationshipContextMenu({
      x: event.clientX,
      y: event.clientY,
      logicGateID,
      relationship: {
        relationshipID,
        resourceType: "node",
        resourceID,
        displayTitle: node.display_title,
      },
    });
  }, [selectedRelationshipNodeIDs]);

  const createFloatingProjectNode = useCallback(async () => {
    if (relationshipActionBusy) return;
    setRelationshipActionBusy(true);
    setError("");
    try {
      const result = await createProjectNode({
        companyID,
        projectID,
        title: "New Node",
        position: relationships.length + 1,
      });
      const createdRelationships = [
        ...(result.implicit_relationships ?? []),
        ...(result.relationship ? [result.relationship] : []),
      ];
      if (createdRelationships.length > 0) {
        setRelationships((current) => mergeProjectRelationships(current, createdRelationships));
      } else {
        await loadProject({ showLoading: false });
      }
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create floating Node");
    } finally {
      setRelationshipActionBusy(false);
    }
  }, [companyID, loadProject, projectID, relationshipActionBusy, relationships.length]);

  const createRelationshipNode = useCallback(async () => {
    setRelationshipContextMenu(null);
    setError("");
    const targetLogicGateID = relationshipContextMenu?.logicGateID?.trim() ?? "";
    if (!targetLogicGateID) {
      setError("Create the Node from a Process in this Project.");
      return;
    }
    try {
      const result = await createProjectNode({
        companyID,
        projectID,
        title: "New Node",
        position: relationships.length + 1,
        logicGateID: targetLogicGateID,
      });
      const createdRelationships = [
        ...(result.implicit_relationships ?? []),
        ...(result.relationship ? [result.relationship] : []),
      ];
      if (createdRelationships.length > 0) {
        setRelationships((current) => mergeProjectRelationships(current, createdRelationships));
      } else {
        await loadProject({ showLoading: false });
      }
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create node");
    }
  }, [companyID, loadProject, projectID, relationshipContextMenu?.logicGateID, relationships.length]);
  const removeRelationshipFromProject = useCallback(async () => {
    const target = relationshipContextMenu?.relationship;
    if (!target) return;
    const targets = relationshipTargetsForContext(target, relationships, selectedRelationshipNodeIDs);
    if (targets.length === 0) return;
    setRelationshipContextMenu(null);
    setError("");
    try {
      await Promise.all(targets.map((item) => deleteProjectRelationship({
        companyID,
        projectID,
        relationshipID: item.relationshipID,
      })));
      const removedRelationshipIDs = new Set(targets.map((item) => item.relationshipID));
      setRelationships((current) => current.filter((item) => !removedRelationshipIDs.has(item.relationship_id)));
      setSelectedRelationshipNodeIDs((current) => new Set(Array.from(current).filter((relationshipID) => !removedRelationshipIDs.has(relationshipID))));
      setSelectionAnchorRelationshipNodeID((current) => (removedRelationshipIDs.has(current) ? "" : current));
    } catch (removeError) {
      const label = target.resourceType === "logic_gate" ? "process" : "node";
      setError(removeError instanceof Error ? removeError.message : `Failed to remove ${label} from project`);
    }
  }, [companyID, projectID, relationshipContextMenu?.relationship, relationships, selectedRelationshipNodeIDs]);

  const requestDeleteRelationshipResource = useCallback((position?: ConfirmActionMenuPosition) => {
    const target = relationshipContextMenu?.relationship;
    if (!target) return;
    const targets = relationshipTargetsForContext(target, relationships, selectedRelationshipNodeIDs);
    if (targets.length === 0) return;
    const isLogicGate = target.resourceType === "logic_gate";
    const uniqueResourceIDs = Array.from(new Set(targets.map((item) => item.resourceID).filter(Boolean)));
    if (uniqueResourceIDs.length === 0) return;
    const label = isLogicGate
      ? "process"
      : `${uniqueResourceIDs.length} node${uniqueResourceIDs.length === 1 ? "" : "s"}`;
    setRelationshipDeleteConfirmation({ isLogicGate, resourceIDs: uniqueResourceIDs, label, position: position ?? null });
  }, [relationshipContextMenu?.relationship, relationships, selectedRelationshipNodeIDs]);

  const deleteRelationshipResource = useCallback(async (confirmation: { isLogicGate: boolean; resourceIDs: string[]; label: string }, confirmationDisplayName: string) => {
    const { isLogicGate, resourceIDs } = confirmation;
    setRelationshipDeleteConfirmation(null);
    setError("");
    try {
      if (isLogicGate) {
        await deleteProjectManagementLogicGate(companyID, resourceIDs[0], confirmationDisplayName);
        emitExplorerContextUpdated({ companyID, kind: "company_explorer" });
      } else {
        await Promise.all(resourceIDs.map((nodeID) => deleteProjectManagementNode(companyID, nodeID, confirmationDisplayName)));
      }
      setSelectedRelationshipNodeIDs(new Set());
      setSelectionAnchorRelationshipNodeID("");
      setSelectedRelationshipNodePanel((current) => (current && resourceIDs.includes(current.nodeID) ? null : current));
      await loadProject({ showLoading: false });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : `Failed to delete ${isLogicGate ? "process" : "node"}`);
    }
  }, [companyID, loadProject]);

  const saveProjectTitle = useCallback(async () => {
    if (!project) return;
    const nextName = projectTitleDraft.trim();
    if (!nextName || nextName === project.name) {
      setProjectTitleDraft(project.name || "");
      setProjectTitleEditing(false);
      return;
    }
    setError("");
    try {
      const result = await updateProject({
        companyID,
        projectID,
        name: nextName,
        status: project.status || "Active",
        health: normalizeProjectHealth(project.health),
      });
      const renamedProject = result.project ?? { ...project, name: nextName };
      setProject(renamedProject);
      setProjectTitleDraft(renamedProject.name || nextName);
      onProjectUpdated?.(renamedProject);
      setProjectTitleEditing(false);
      emitExplorerContextUpdated({ companyID, kind: "company_explorer" });
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Failed to rename project");
      setProjectTitleDraft(project.name || "");
      setProjectTitleEditing(false);
    }
  }, [companyID, onProjectUpdated, project, projectID, projectTitleDraft]);

  const moveRelationshipNodeToGate = useCallback(async (payload: ProjectRelationshipNodeDragPayload, targetLogicGateID: string, position: number) => {
    const nodeID = payload.nodeID.trim();
    const toLogicGateID = targetLogicGateID.trim();
    const fromLogicGateID = payload.fromLogicGateID?.trim() ?? "";
    if (!nodeID || !toLogicGateID || fromLogicGateID === toLogicGateID) return;
    setError("");
    try {
      await moveLogicGateAssignment({
        apiBase: readAuthConfig().apiBase,
        companyID,
        logicGateID: toLogicGateID,
        fromLogicGateID,
        nodeID,
        status: payload.status ?? undefined,
        position,
        mutationOrigin: "matrix",
      });
      await loadProject({ showLoading: false });
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : "Failed to move node");
      await loadProject({ showLoading: false });
    }
  }, [companyID, loadProject]);

  const relationshipTargetsFromTransfer = useCallback((dataTransfer: DataTransfer): Promise<ProjectRelationshipDropTarget[]> => {
    const payload = readExplorerDragPayload(dataTransfer);
    return resolveProjectRelationshipDropTargets(readAuthConfig().apiBase, companyID, payload, workspace);
  }, [companyID, workspace]);

  const saveCriticalPathStep = useCallback(async (
    step: ProjectCriticalPathStep,
    updates: Partial<{
      name: string;
      relationshipID: string;
      dueDate: string;
      ownerType: "user" | "group" | "";
      ownerID: string;
      position: number;
      isCurrent: boolean;
    }>,
  ) => {
    const nextName = updates.name ?? step.name ?? "";
    const nextRelationshipID = updates.relationshipID ?? step.relationship_id?.trim() ?? "";
    const nextDueDate = updates.dueDate ?? step.due_date?.trim() ?? "";
    const nextOwnerType = updates.ownerType ?? step.owner_type ?? "";
    const nextOwnerID = updates.ownerID ?? step.owner_id?.trim() ?? "";
    const nextPosition = updates.position ?? step.position ?? 0;
    const nextIsCurrent = updates.isCurrent ?? Boolean(step.is_current);
    setError("");
    try {
      const result = await upsertProjectCriticalPathStep({
        companyID,
        projectID,
        stepID: step.step_id,
        name: nextName,
        relationshipID: nextRelationshipID,
        dueDate: nextDueDate,
        ownerType: nextOwnerType,
        ownerID: nextOwnerID,
        position: nextPosition,
        isCurrent: nextIsCurrent,
      });
      setCriticalPath((current) => mergeCriticalPathStep(current, result.step));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save critical path step");
      await loadProject({ showLoading: false });
    }
  }, [companyID, loadProject, projectID]);

  const addCriticalPathStep = useCallback(async () => {
    setError("");
    try {
      const result = await upsertProjectCriticalPathStep({
        companyID,
        projectID,
        name: "New critical step",
        position: criticalPath.length + 1,
        isCurrent: !criticalPath.some((step) => step.is_current),
      });
      setCriticalPath((current) => mergeCriticalPathStep(current, result.step));
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to add critical path step");
    }
  }, [companyID, criticalPath, projectID]);

  const removeCriticalPathStep = useCallback(async (step: ProjectCriticalPathStep) => {
    const previous = criticalPath;
    setCriticalPath((current) => current.filter((item) => item.step_id !== step.step_id));
    setError("");
    try {
      await deleteProjectCriticalPathStep({ companyID, projectID, stepID: step.step_id });
    } catch (deleteError) {
      setCriticalPath(previous);
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete critical path step");
    }
  }, [companyID, criticalPath, projectID]);

  const assignCriticalPathNode = useCallback(async (step: ProjectCriticalPathStep, nodeID: string) => {
    const cleanNodeID = nodeID.trim();
    if (!cleanNodeID) return;
    const ensured = await addRelationshipTargets([{ resourceType: "node", resourceID: cleanNodeID }]);
    const relationship = ensured.find((item) => item.resource_type === "node" && item.resource_id === cleanNodeID);
    if (!relationship) return;
    await saveCriticalPathStep(step, { relationshipID: relationship.relationship_id });
    setSelectedCriticalPathNode({
      stepID: step.step_id,
      nodeID: cleanNodeID,
      title: relationship.display_title || "Node",
    });
  }, [addRelationshipTargets, saveCriticalPathStep]);

  const setCurrentCriticalStep = useCallback(async (step: ProjectCriticalPathStep) => {
    if (step.is_current) return;
    setCriticalPath((current) => orderCriticalPathSteps(current.map((item) => ({ ...item, is_current: item.step_id === step.step_id }))));
    await saveCriticalPathStep(step, { isCurrent: true });
  }, [saveCriticalPathStep]);

  const toggleRelationshipGroup = useCallback((groupID: string) => {
    setExpandedRelationshipGroupIDs((current) => {
      const next = new Set(current);
      if (next.has(groupID)) next.delete(groupID);
      else next.add(groupID);
      return next;
    });
  }, []);

  const updateRelationshipGroupings = useCallback((nextStack: ProjectRelationshipGroupingSetting[]) => {
    const normalized = normalizeProjectRelationshipGroupingStack(nextStack);
    setRelationshipGroupings(normalized);
    if (companyID && currentUserID) {
      storeProjectRelationshipGroupingPreference(companyID, currentUserID, normalized);
    }
  }, [companyID, currentUserID]);

  const startSummarySplitResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = bodyRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    setSplitResizeState({ left: rect.left, width: rect.width });
  };

  const openRelationshipResourceInNewTab = (target: RelationshipContextTarget) => {
    const path = target.resourceType === "logic_gate"
      ? buildLogicGateRoute(target.resourceID)
      : buildContextualNodeRoute(target.resourceID);
    openAppPathInNewTab(path);
    setRelationshipContextMenu(null);
  };

  const openRelationshipGateContextMenu = (event: React.MouseEvent<HTMLElement>, gate: ProjectRelationshipProjection) => {
    const logicGateID = (gate.logic_gate_id || gate.resource_id || "").trim();
    if (!logicGateID) return;
    event.preventDefault();
    event.stopPropagation();
    setRelationshipContextMenu({
      x: event.clientX,
      y: event.clientY,
      logicGateID,
      relationship: {
        relationshipID: gate.relationship_id,
        resourceType: "logic_gate",
        resourceID: logicGateID,
        displayTitle: gate.display_title,
      },
    });
  };

  const handleRelationshipGateDragOver = (event: React.DragEvent<HTMLElement>, logicGateID: string) => {
    if (!logicGateID) return;
    const isTriageDrag = hasTriageMessageDrag(event.dataTransfer);
    if (!isTriageDrag && !Array.from(event.dataTransfer.types).includes(PROJECT_RELATIONSHIP_NODE_DRAG_MIME)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = isTriageDrag ? "copy" : "move";
  };

  const handleRelationshipGateDrop = (event: React.DragEvent<HTMLElement>, logicGateID: string) => {
    if (!logicGateID) return;
    const triageMessageDrag = readTriageMessageDrag(event.dataTransfer);
    if (triageMessageDrag.messageIDs.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      void convertTriageMessagesToProject(triageMessageDrag, logicGateID);
      return;
    }
    const payload = readProjectRelationshipNodeDragPayload(event.dataTransfer);
    if (!payload) return;
    event.preventDefault();
    event.stopPropagation();
    void moveRelationshipNodeToGate(payload, logicGateID, (relationshipNodeCountByGateID.get(logicGateID) ?? 0) + 1);
  };

  const renderRelationshipRows = (rows: ProjectRelationshipProjection[], depth: number): React.ReactNode => (
    <div style={relationshipRowsStyle}>
      {rows.map((relationship) => {
        const isCurrentCritical = currentCriticalRelationshipID === relationship.relationship_id;
        if (relationship.resource_type === "logic_gate") {
          const logicGateID = (relationship.logic_gate_id || relationship.resource_id || "").trim();
          return (
            <div
              key={relationship.relationship_id}
              role="row"
              data-project-relationship-row="true"
              style={relationshipLogicGateRowStyle(depth)}
              onContextMenu={(event) => openRelationshipGateContextMenu(event, relationship)}
              onDragOver={(event) => handleRelationshipGateDragOver(event, logicGateID)}
              onDrop={(event) => handleRelationshipGateDrop(event, logicGateID)}
            >
              <span style={relationshipResourceIconStyle}><ExplorerRowIcon kind="logic_gate" /></span>
              <span
                title={logicGateID ? "Double-click to open process" : undefined}
                style={relationshipResourceTitleStyle}
                onDoubleClick={() => logicGateID && onLogicGateOpen?.(logicGateID, relationship.display_title, {
                  projectID,
                  workPanelTab: "relationships",
                })}
              >
                {relationship.display_title}
              </span>
              <CriticalPulseBeacon visible={isCurrentCritical} compact />
            </div>
          );
        }

        const nodeID = (relationship.node_id || relationship.resource_id || "").trim();
        const referencedGateID = relationship.logic_gate_id?.trim() ?? "";
        const visibleGateID = referencedGateID && visibleProjectLogicGateByID.has(referencedGateID) ? referencedGateID : "";
        const expanded = selectedRelationshipNodePanel?.projectID === projectID
          && selectedRelationshipNodePanel.relationshipID === relationship.relationship_id
          && selectedRelationshipNodePanel.nodeID === nodeID;
        return (
          <React.Fragment key={relationship.relationship_id}>
          <button
            type="button"
            role="row"
            data-project-relationship-row="true"
            draggable={Boolean(nodeID && (!referencedGateID || visibleGateID))}
            style={relationshipNodeRowStyle(depth, hoveredRelationshipNodeID === relationship.relationship_id, selectedRelationshipNodeIDs.has(relationship.relationship_id))}
            aria-expanded={expanded}
            onClick={(event) => {
              selectRelationshipNode(relationship.relationship_id, event);
              if (!nodeID || event.shiftKey || event.ctrlKey || event.metaKey || event.detail > 1) return;
              setRelationshipContextMenu(null);
              setSelectedRelationshipNodePanel((current) => (
                current?.projectID === projectID
                && current.relationshipID === relationship.relationship_id
                && current.nodeID === nodeID
                  ? null
                  : {
                    projectID,
                    relationshipID: relationship.relationship_id,
                    nodeID,
                    title: relationship.display_title.trim() || "Node",
                  }
              ));
            }}
            onDragStart={(event) => startProjectRelationshipNodeDrag(event, relationship, visibleGateID)}
            onMouseEnter={() => setHoveredRelationshipNodeID(relationship.relationship_id)}
            onMouseLeave={() => setHoveredRelationshipNodeID((current) => current === relationship.relationship_id ? "" : current)}
            onContextMenu={(event) => openRelationshipNodeContextMenu(event, relationship, visibleGateID)}
          >
            <span style={relationshipResourceIconStyle}><ExplorerRowIcon kind="node" /></span>
            <span style={relationshipResourceTitleStyle}>{relationship.display_title}</span>
            <span
              title={relationship.created_from_email ? "Email node" : undefined}
              aria-label={relationship.created_from_email ? "Email node" : undefined}
              style={relationshipNodeEmailIconStyle}
            >
              {relationship.created_from_email ? <MailIcon color="#64748b" /> : null}
            </span>
            <CriticalPulseBeacon visible={isCurrentCritical} compact />
            {relationship.status ? <span style={nodeStatusDotStyle(relationship.status)} /> : null}
          </button>
          {expanded ? (
            <div style={relationshipNodePanelRowStyle()}>
              <ProjectRelationshipNodePanel
                key={`${projectID}:${nodeID}`}
                accent={accent}
                selection={selectedRelationshipNodePanel as ProjectRelationshipNodePanelSelection}
                onRequestDelete={(event) => setRelationshipDeleteConfirmation({
                  isLogicGate: false,
                  resourceIDs: [nodeID],
                  label: "node",
                  position: confirmMenuPositionFromElement(event.currentTarget),
                })}
                onClose={() => setSelectedRelationshipNodePanel(null)}
              />
            </div>
          ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );

  const renderRelationshipGroups = (nestedGroups: ProjectRelationshipNestedGroup[]): React.ReactNode => (
    <div style={relationshipGroupListStyle}>
      {nestedGroups.map((group) => {
        const open = expandedRelationshipGroupIDs.has(group.id);
        const hasDescendants = group.groups.length > 0 || group.rows.length > 0;
        const gateRelationship = group.field === "logic_gate" && group.key !== "none"
          ? visibleProjectLogicGateByID.get(group.key) ?? null
          : null;
        const logicGateID = gateRelationship
          ? (gateRelationship.logic_gate_id || gateRelationship.resource_id || "").trim()
          : "";
        const gateIsCurrentCritical = Boolean(
          gateRelationship && currentCriticalRelationshipID === gateRelationship.relationship_id,
        );
        return (
          <div key={group.id} style={relationshipGroupBlockStyle}>
            <div
              role="row"
              data-project-relationship-row="true"
              style={relationshipGroupHeaderStyle(group.depth, Boolean(gateRelationship))}
              onContextMenu={(event) => gateRelationship && openRelationshipGateContextMenu(event, gateRelationship)}
              onDragOver={(event) => handleRelationshipGateDragOver(event, logicGateID)}
              onDrop={(event) => handleRelationshipGateDrop(event, logicGateID)}
            >
              {hasDescendants ? (
                <button
                  type="button"
                  aria-label={`${open ? "Collapse" : "Expand"} ${group.label}`}
                  aria-expanded={open}
                  style={relationshipGroupDisclosureButtonStyle}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleRelationshipGroup(group.id);
                  }}
                  onDoubleClick={(event) => event.stopPropagation()}
                >
                  <ExplorerDisclosureIcon open={open} color="rgba(15, 23, 42, 0.66)" />
                </button>
              ) : <span aria-hidden="true" style={relationshipGroupDisclosurePlaceholderStyle} />}
              {gateRelationship ? (
                <button
                  type="button"
                  style={relationshipGroupResourceButtonStyle}
                  title="Double-click to open process"
                  onDoubleClick={() => logicGateID && onLogicGateOpen?.(logicGateID, group.label, {
                    projectID,
                    workPanelTab: "relationships",
                  })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && logicGateID) {
                      onLogicGateOpen?.(logicGateID, group.label, {
                        projectID,
                        workPanelTab: "relationships",
                      });
                    }
                  }}
                >
                  <ExplorerRowIcon kind="logic_gate" />
                  <span style={relationshipGroupLabelStyle}>{group.label}</span>
                  <CriticalPulseBeacon visible={gateIsCurrentCritical} compact />
                </button>
              ) : (
                <span style={relationshipGroupStaticContentStyle}>
                  <ProjectRelationshipGroupIcon group={group} />
                  <span style={relationshipGroupLabelStyle}>{group.label}</span>
                </span>
              )}
            </div>
            {open && group.groups.length > 0 ? renderRelationshipGroups(group.groups) : null}
            {open && group.rows.length > 0 ? renderRelationshipRows(group.rows, group.depth + 1) : null}
          </div>
        );
      })}
    </div>
  );

  const projectEditorToolbar = (
    <EditorTabBar
      activeTab={permissionsOpen ? "permissions" : "editor"}
      outlineStyle={outlineStyle}
      accent={accent}
      outlineMenuAccent={accent}
      strokeColor={EDITOR_NEU_SOFT_BORDER}
      surfaceText={PROJECT_SUMMARY_SURFACE_TEXT}
      tabBackground={EDITOR_NEU_SURFACE}
      tabSelectedBackground={EDITOR_NEU_ACTIVE_SURFACE}
      onSelectTab={(tabID) => {
        if (tabID === "permissions") setPermissionsOpen(true);
      }}
      onAdjustSelectionFontSize={(delta) => runProjectFormatCommand((controller) => controller.adjustFontSize(delta))}
      documentFontSize={projectSelectionFontSize}
      onSetSelectionFontSize={(fontSize) => runProjectFormatCommand((controller) => controller.applyFontSizeValue(fontSize))}
      boldActive={projectInlineFormat.bold}
      underlineActive={projectInlineFormat.underline}
      italicActive={projectInlineFormat.italic}
      strikethroughActive={projectInlineFormat.strikethrough}
      highlightColor={projectHighlightColor}
      textAlignment={projectTextAlignment}
      onToggleBold={() => runProjectFormatCommand((controller) => controller.toggleInlineFormat("bold"))}
      onToggleUnderline={() => runProjectFormatCommand((controller) => controller.toggleInlineFormat("underline"))}
      onToggleItalic={() => runProjectFormatCommand((controller) => controller.toggleInlineFormat("italic"))}
      onToggleStrikethrough={() => runProjectFormatCommand((controller) => controller.toggleInlineFormat("strikethrough"))}
      onSetSelectionHighlightColor={(color) => runProjectFormatCommand((controller) => controller.applyHighlightColor(color))}
      onSetTextAlignment={(alignment) => runProjectFormatCommand((controller) => controller.applyTextAlignment(alignment))}
      onOutlineStyleFocus={refreshProjectSelectionFormat}
      onOutlineStyleChange={setOutlineStyle}
      onInsertTable={() => runProjectFormatCommand((controller) => controller.insertTable())}
      onSaveCurrentVersion={() => { void saveProjectVersion(); }}
      saveCurrentVersionBusy={projectVersionSaving}
      saveCurrentVersionDisabled={projectVersionRestoring}
      reserveHeaderOffset={false}
      visibleTabIDs={EDITOR_PRIMARY_HEADER_TAB_IDS}
      secondaryActions={[
        { id: "saved-versions", label: "Saved versions", onSelect: () => setProjectSavedVersionsOpen(true) },
        { id: "assignments", label: "Assignments", onSelect: () => setAssignmentsOpen(true) },
        ...(onOpenInNewTab
          ? [{ id: "open-project-tab", label: "Open project in new tab", onSelect: () => onOpenInNewTab() }]
          : []),
        ...(onCollapseToTab
          ? [{
              id: "minimize-project",
              label: "Minimize project",
              onSelect: () => onCollapseToTab({ projectID, label: project?.name || projectID }),
            }]
          : []),
      ]}
      formattingDisabled={!activeRichTextBlockID || !blocks.some((block) => block.id === activeRichTextBlockID)}
    />
  );
  const projectDocumentSaveStorageKey = projectDocumentBlock
    ? mangoTiptapPendingStorageKey({ companyID, resourceType: "project", resourceID: projectID, documentID: projectDocumentBlock.id })
    : "";
  const projectDocumentSaveFallback = projectDocumentBlock && savingID === projectDocumentBlock.id
    ? { status: "saving" as const }
    : { status: "saved" as const, updatedTimestamp: projectDocumentBlock?.updatedTimestamp };
  const projectDocumentSaveFailed = Boolean(projectDocumentBlock && textBlockSaveFailures[projectDocumentBlock.id]);
  const projectDocumentDocked = Boolean(projectDocumentOpen && projectDocumentBlock && !projectDocumentFullscreen);
  const projectDocumentPane = projectDocumentBlock ? (
    <dialog
      ref={projectDocumentPaneRef}
      data-project-document-pane="true"
      data-project-document-fullscreen={projectDocumentFullscreen ? "true" : undefined}
      className={`mango-project-document-pane${projectDocumentSaveFailed ? " mango-editor-save-failed-frame" : ""}`}
      aria-modal={projectDocumentFullscreen || undefined}
      aria-label="Project document"
      onCancel={(event) => {
        event.preventDefault();
        setProjectDocumentFullscreen(false);
      }}
      style={projectDocumentPaneStyle(projectDocumentFullscreen)}
    >
      {projectDocumentFullscreen ? (
        <div style={projectDocumentFullscreenToolbarStyle}>
          {projectEditorToolbar}
        </div>
      ) : null}
      <header
        data-project-document-header="true"
        className="mango-editor-header-scroll"
        style={projectDocumentPaneHeaderStyle}
      >
        <div style={projectDocumentPaneHeaderContentStyle}>
          <span data-project-document-title="true" style={projectDocumentPaneTitleStyle}>
            <ProjectDocumentIcon color={accent} />
            <strong>Project document</strong>
          </span>
          <span data-project-document-actions="true" style={projectDocumentPaneActionsStyle}>
            <EditorSaveStatusIcon state={projectDocumentSaveFallback} storageKey={projectDocumentSaveStorageKey} compact />
            <EditorSavedTimestamp storageKey={projectDocumentSaveStorageKey} fallbackUpdatedTimestamp={projectDocumentBlock.updatedTimestamp} createdTimestamp={projectDocumentBlock.createdTimestamp} formatTimestamp={formatTextBlockMetadataTimestamp} />
            <label title="Add attachment" aria-label="Add attachment to Project document" style={projectTextBlockIconButtonStyle(accent, false)}>
              <PaperclipIcon color={accent} />
              <input type="file" multiple style={{ display: "none" }} onChange={(event) => {
                const files = event.currentTarget.files;
                if (files) void addTextBlockAttachments(projectDocumentBlock, files);
                event.currentTarget.value = "";
              }} />
            </label>
          </span>
          <span style={projectDocumentPaneTrailingActionStyle}>
            {projectDocumentFullscreen ? (
              <button
                type="button"
                data-project-document-fullscreen-close="true"
                title="Exit Project document full screen"
                aria-label="Exit Project document full screen"
                onClick={() => setProjectDocumentFullscreen(false)}
                style={projectDocumentFullscreenCloseButtonStyle}
              >
                X
              </button>
            ) : (
              <button
                type="button"
                title="Open Project document full screen"
                aria-label="Open Project document full screen"
                aria-pressed={false}
                onClick={() => setProjectDocumentFullscreen(true)}
                style={projectTextBlockIconButtonStyle(accent, false)}
              >
                <UnifiedNodeShellFullscreenIcon />
              </button>
            )}
          </span>
        </div>
      </header>
      <div style={projectDocumentEditorWrapStyle}>
        <NodeTextBlockEditor
          key={`${projectDocumentBlock.id}:${projectDocumentRemountRevision}`}
          blockID={projectDocumentBlock.id}
          surfaceKind="project"
          editable
          fillHeight
          nodeID={`project:${projectID}`}
          apiBase={apiBase}
          companyID={companyID}
          attachmentResourceType="project"
          attachmentResourceID={projectID}
          attachmentRequestJSON={attachmentRequestJSON}
          attachmentEditorSurface="project_text_block"
          currentUserID={currentUserID || "local-user"}
          companyUsers={companyUsers}
          documentValue={projectDocumentBlock.document}
          documentScrollMemoryRef={projectInformationScrollMemoryRef}
          chatMessages={[]}
          activeChatAnchorMessageID=""
          chatNavigationRequest={null}
          surfaceText={PROJECT_SUMMARY_SURFACE_TEXT}
          accent={accent}
          outlineStyle={outlineStyle}
          indentGuideColor={PROJECT_SUMMARY_RULE}
          scrollbarTrack="rgba(15, 23, 42, 0.08)"
          formattingControllerRef={projectFormattingControllerRef}
          formattingControllerActive={activeRichTextBlockID === projectDocumentBlock.id}
          onFocus={() => {
            setActiveRowBlockID(projectDocumentBlock.id);
            setFocusedTextBlockID(projectDocumentBlock.id);
            setActiveRichTextBlockID(projectDocumentBlock.id);
            window.setTimeout(refreshProjectSelectionFormat, 0);
          }}
          onBlur={() => undefined}
          onDocumentChange={(document) => applyProjectSyncedDocument(projectDocumentBlock.id, document)}
          onDocumentFlush={(document) => applyProjectSyncedDocument(projectDocumentBlock.id, document)}
          onDocumentConflict={() => setError("Mango is recovering the Project document from its committed snapshot.")}
          onDocumentError={setError}
          onSaveStateChange={(state) => {
            const failed = editorSaveNeedsFailureAttention(state);
            setTextBlockSaveFailures((current) => current[projectDocumentBlock.id] === failed ? current : { ...current, [projectDocumentBlock.id]: failed });
          }}
          onRecoveryStorageError={setError}
          onRecoveryStorageRecovered={() => setError("")}
          onSelectionFontSizeChange={setProjectSelectionFontSize}
          onSelectionInlineFormatChange={setProjectInlineFormat}
          onSelectionHighlightColorChange={setProjectHighlightColor}
          onSelectionTextAlignmentChange={setProjectTextAlignment}
        />
      </div>
    </dialog>
  ) : null;

  if (loading) {
    return <div style={summaryLoadingStyle}>Loading</div>;
  }

  return (
    <div className="mango-project-summary-shell" style={summaryShellStyle}>
      <div className="mango-project-summary-header" style={summaryHeaderStyle}>
        <div style={summaryTitleClusterStyle}>
          <HierarchyBreadcrumb
            apiBase={apiBase}
            companyID={companyID}
            kind="company_explorer"
            resourceType="project"
            resourceID={projectID}
          />
          <div style={summaryTitleRowStyle}>
            <span aria-label="Project" title="Project" style={summaryTitleIconStyle}><ExplorerRowIcon kind="project" /></span>
            {projectTitleEditing ? (
              <input
                autoFocus
                aria-label="Project title"
                value={projectTitleDraft}
                style={summaryTitleInputStyle}
                onChange={(event) => setProjectTitleDraft(event.currentTarget.value)}
                onBlur={() => void saveProjectTitle()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void saveProjectTitle();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setProjectTitleDraft(project?.name || "");
                    setProjectTitleEditing(false);
                  }
                }}
              />
            ) : (
              <h2
                tabIndex={0}
                aria-label={`Project title: ${project?.name || projectID}`}
                title="Rename project"
                style={summaryTitleStyle}
                onClick={() => {
                  setProjectTitleDraft(project?.name || "");
                  setProjectTitleEditing(true);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  setProjectTitleDraft(project?.name || "");
                  setProjectTitleEditing(true);
                }}
              >
                {project?.name || projectID}
              </h2>
            )}
          </div>
        </div>
        <div className="mango-project-summary-meta" style={summaryMetaPillsStyle}>
          {showFieldMetadata ? (
            <div style={summaryMetaFieldStyle}>
              <span style={summaryMetaFieldLabelStyle}>Fields</span>
              <ProjectFieldControl
                ariaLabel="Project fields"
                values={project?.fields?.map((field) => field.field_id) ?? []}
                choices={entityFields.map((field) => ({ id: field.field_id, label: field.name || field.field_id }))}
                multiple
                placeholder="Not set"
                disabled={projectMetadataSaving || !project}
                onChange={(fieldIDs) => void saveProjectFields(fieldIDs)}
              />
            </div>
          ) : null}
          <div style={summaryMetaFieldStyle}>
            <span style={summaryMetaFieldLabelStyle}>Status</span>
            <ProjectFieldControl
              ariaLabel="Project status"
              values={[project?.status || "Active"]}
              choices={projectStatusChoices(project?.status)}
              tone="status"
              disabled={projectMetadataSaving || !project}
              onChange={(values) => void saveProjectMetadata({ status: values[0] || "Active" })}
            />
          </div>
          <div style={summaryMetaFieldStyle}>
            <span style={summaryMetaFieldLabelStyle}>Health</span>
            <ProjectFieldControl
              ariaLabel="Project health"
              values={[normalizeProjectHealth(project?.health)]}
              choices={PROJECT_HEALTH_CHOICES}
              tone={projectSummaryHealthTone(normalizeProjectHealth(project?.health))}
              disabled={projectMetadataSaving || !project}
              onChange={(values) => void saveProjectMetadata({ health: normalizeProjectHealth(values[0]) })}
            />
          </div>
          <div style={summaryMetaFieldStyle}>
            <span style={summaryMetaFieldLabelStyle}>Account</span>
            <ProjectFieldControl
              ariaLabel="Project accounts"
              values={projectAccountIDs(project)}
              choices={accounts.map((account) => ({ id: account.account_id, label: account.name || account.account_id }))}
              multiple
              disabled={projectMetadataSaving || !project}
              onChange={(accountIDs) => void saveProjectMetadata({ accountIDs })}
            />
          </div>
          <div style={summaryMetaFieldStyle}>
            <span style={summaryMetaFieldLabelStyle}>Team</span>
            <ProjectFieldControl
              ariaLabel="Project teams"
              values={projectTeamIDs(project)}
              choices={groups.map((group) => ({ id: group.group_id, label: group.name || group.group_id }))}
              multiple
              disabled={projectMetadataSaving || !project}
              onChange={(teamIDs) => void saveProjectMetadata({ teamIDs })}
            />
          </div>
        </div>
      </div>
      {permissionsOpen && (
		<EntityPermissionsDialog
          requestJSON={permissionsRequestJSON}
          apiBase={apiBase}
								companyID={companyID}
          entityType="project"
          entityID={projectID}
          title={project?.name || projectID}
          onClose={() => setPermissionsOpen(false)}
          onSaved={() => void loadProject({ showLoading: false })}
        />
      )}
      {assignmentsOpen ? (
        <ProjectAssignmentsDialog
          accounts={accounts}
          groups={groups}
          selectedAccountIDs={assignmentAccountIDs}
          selectedTeamIDs={assignmentTeamIDs}
          saving={assignmentsSaving}
          onSetAccountIDs={setAssignmentAccountIDs}
          onSetTeamIDs={setAssignmentTeamIDs}
          onSave={() => void saveProjectAssignments()}
          onClose={() => {
            setAssignmentsOpen(false);
            if (project) {
              setAssignmentAccountIDs(projectAccountIDs(project));
              setAssignmentTeamIDs(projectTeamIDs(project));
            }
          }}
        />
      ) : null}
      {projectSavedVersionsOpen ? (
        <ProjectSavedVersionsDialog
          versions={projectSavedVersions}
          selectedID={selectedProjectSavedVersionID}
          saving={projectVersionSaving}
          restoring={projectVersionRestoring}
          onSelect={setSelectedProjectSavedVersionID}
          onExitPreview={() => setSelectedProjectSavedVersionID("")}
          onSave={() => { void saveProjectVersion(); }}
          onRestore={(version) => { void restoreProjectVersion(version); }}
          onClose={() => {
            setSelectedProjectSavedVersionID("");
            setProjectSavedVersionsOpen(false);
          }}
        />
      ) : null}
      {error ? <div style={summaryErrorStyle}>{error}</div> : null}
      <div ref={bodyRef} className="mango-project-summary-body" style={summaryBodyStyle}>
        <section className="mango-project-summary-timeline" style={textColumnStyle(summarySplitPct)}>
          <div
            data-project-timeline-heading-grid="true"
            style={projectTimelineHeadingGridStyle(projectDocumentDocked, projectSidePaneWidths.document)}
          >
            <div
              data-project-timeline-control-row="true"
              className="mango-editor-header-scroll"
              style={projectTimelineControlRowStyle}
            >
              <button
                type="button"
                data-project-add-text-box="true"
                title="Add text box"
                aria-label="Add text box"
                style={projectTimelineControlButtonStyle(accent, false)}
                onClick={() => void addTextBlock()}
              >
                <span aria-hidden="true" style={projectTimelinePlusStyle}>+</span>
              </button>
              <div style={projectTimelineControlsStyle}>
                <button
                  type="button"
                  data-project-document-toggle="true"
                  title={projectDocumentOpen ? "Close Project document" : "Open Project document"}
                  aria-label="Toggle Project document"
                  aria-pressed={projectDocumentOpen}
                  onClick={toggleProjectDocument}
                  style={projectTimelineControlButtonStyle(accent, projectDocumentOpen)}
                >
                  <ProjectDocumentIcon color={accent} />
                </button>
                <button
                  type="button"
                  data-project-email-count-toggle="true"
                  title={openEmailBlockIDs.has(PROJECT_EMAIL_COLUMN_LAYOUT_ID) ? "Hide Project email column" : "Show Project email column"}
                  aria-label="Toggle Project email column"
                  aria-pressed={openEmailBlockIDs.has(PROJECT_EMAIL_COLUMN_LAYOUT_ID)}
                  onClick={toggleProjectEmailColumn}
                  style={projectEmailCountButtonStyle(accent, openEmailBlockIDs.has(PROJECT_EMAIL_COLUMN_LAYOUT_ID))}
                >
                  <MailIcon color={accent} />
                  <span>{projectAttachedEmails.length}</span>
                </button>
                <AttachmentCountDropdown
                  items={projectAttachmentDropdownItems}
                  apiBase={apiBase}
                  companyID={companyID}
                  accent={accent}
                  surfaceText={PROJECT_SUMMARY_SURFACE_TEXT}
                  align="left"
                  compact
                  loading={projectAttachmentsLoading}
                  loadError={projectAttachmentsLoadError}
                  onRetry={refreshProjectAttachments}
                  onError={setError}
                />
                <div data-project-header-universal-linker="true" style={projectHeaderUniversalLinkerStyle}>
                  <UniversalLinkerControls
                    busy={relationshipActionBusy}
                    pickerOpen={Boolean(emailPicker)}
                    showCreateFloatingNode={false}
                    openPickerAriaLabel="Open universal picker to link this Project"
                    onTogglePicker={(event) => {
                      if (emailPicker) {
                        setEmailPicker(null);
                        return;
                      }
                      const bounds = event.currentTarget.getBoundingClientRect();
                      setEmailPicker({ left: bounds.left, top: bounds.bottom + 7 });
                    }}
                  />
                </div>
              </div>
            </div>
            <div data-project-timeline-toolbar="true" style={projectTimelineToolbarStyle(projectDocumentDocked)}>
              <div style={toolbarActionsStyle}>
                {!projectDocumentFullscreen ? projectEditorToolbar : null}
              </div>
            </div>
          </div>
          <div style={{ minHeight: 0, flex: "1 1 auto", overflow: "hidden", display: "grid", gridTemplateColumns: projectDocumentOpen && projectDocumentPane
            ? projectDocumentFullscreen
              ? "minmax(0, 1fr)"
              : `${projectSidePaneWidths.document}px 8px minmax(0, 1fr)`
            : openEmailBlockIDs.has(PROJECT_EMAIL_COLUMN_LAYOUT_ID)
              ? `${projectSidePaneWidths.email}px 8px minmax(0, 1fr)`
              : "minmax(0, 1fr)" }}>
            {projectDocumentOpen && projectDocumentPane ? projectDocumentPane : null}
            {projectDocumentOpen && projectDocumentPane && !projectDocumentFullscreen ? <div role="separator" aria-label="Resize Project document" aria-orientation="vertical" onPointerDown={(event) => beginProjectColumnResize("document", event)} style={projectColumnResizeHandleStyle} /> : null}
            {!projectDocumentOpen && openEmailBlockIDs.has(PROJECT_EMAIL_COLUMN_LAYOUT_ID) ? (
              <div style={{ ...projectEmailPaneWrapStyle, minHeight: 0, overflow: "hidden", borderRight: `1px solid ${EDITOR_NEU_SOFT_BORDER}` }}>
                <AttachedEmailOrganizerPane
                  emails={projectAttachedEmails}
                  repliesEnabled={canEditProject}
                  projectID={projectID}
                  apiBase={apiBase}
                  companyID={companyID}
                  currentUserID={currentUserID}
                  companyUsers={companyUsers}
                  attachmentRequestJSON={attachmentRequestJSON}
                  storageKey={`project-summary-email-pane:${companyID}:${projectID}`}
                  editable={canEditProject}
                  accent={accent}
                  surfaceText={PROJECT_SUMMARY_SURFACE_TEXT}
                  strokeColor={EDITOR_NEU_SOFT_BORDER}
                  ruleColor={PROJECT_SUMMARY_RULE}
                  selectedMessageID={selectedEmailIDsByBlock[PROJECT_EMAIL_COLUMN_LAYOUT_ID] ?? ""}
                  focusMessageID={activeProjectEmailChatMessage?.selectionMessageID}
                  focusBlockID={activeProjectEmailChatMessage?.blockID}
                  activeEmailSelection={activeProjectEmailSelection}
                  chatHighlightsByMessageID={projectEmailChatHighlightsByMessageID}
                  messageAccents={projectEmailMessageAccents}
                  onSelectMessage={(messageID) => setSelectedEmailIDsByBlock((current) => ({ ...current, [PROJECT_EMAIL_COLUMN_LAYOUT_ID]: messageID }))}
                  onClearSelectedMessage={() => setSelectedEmailIDsByBlock((current) => omitRecordKey(current, PROJECT_EMAIL_COLUMN_LAYOUT_ID))}
                  onRemoveEmail={removeAttachedEmail}
                  onEmailSelectionChatRequest={openProjectEmailSelectionChat}
                  onEmailSelectionTextBoxRequest={(messageID, quote) => { void createProjectEmailTextBlock(messageID, quote); }}
                  onEmailMessageTextBoxRequest={(messageID) => { void createProjectEmailTextBlock(messageID); }}
                  onEmailMessageActivate={revealProjectEmailTextBlock}
                  onReplyEditorFocus={() => {
                    setFocusedTextBlockID("");
                    setActiveRichTextBlockID("");
                    projectFormattingControllerRef.current = null;
                  }}
                  onError={setError}
                />
              </div>
            ) : null}
            {!projectDocumentOpen && openEmailBlockIDs.has(PROJECT_EMAIL_COLUMN_LAYOUT_ID) ? <div role="separator" aria-label="Resize Project email column" aria-orientation="vertical" onPointerDown={(event) => beginProjectColumnResize("email", event)} style={projectColumnResizeHandleStyle} /> : null}
            <div ref={textBlocksScrollRef} className="kanban-board-scroll" style={textBlocksScrollStyle}>
            {pendingProjectEmailChatSelection && !blocks.some((block) => block.id === projectEmailChatDestinationBlockID && block.temporaryEmailChat) ? (
              <button
                type="button"
                data-project-email-chat-parent-destination="true"
                onClick={chooseProjectEmailChatNewTextBoxDestination}
              >
                <ExplorerRowIcon kind="project" />
                <span>
                  <strong>{project?.name || "This Project"}</strong>
                  <small>Create a new text-box grouping for the highlighted message.</small>
                </span>
              </button>
            ) : null}
            <div ref={projectRowVirtualizer.listRef} data-mango-bounded-editor-rows="project" data-mounted-row-count={projectRowVirtualizer.mountedRowCount} style={{ display: "grid", gap: 0, minWidth: 0 }}>
              {projectRowVirtualizer.entries.map((entry) => {
                if (entry.kind === "spacer") return <div key={entry.key} aria-hidden="true" data-editor-row-spacer="true" style={{ height: entry.height, pointerEvents: "none" }} />;
                const index = entry.index;
                const block = timelineBlocks[index];
                if (!block) return null;
                const editorOpen = openEditorBlockIDs.has(block.id) || tiptapPinnedBlockIDs.has(block.id);
                const chatOpen = openChatBlockIDs.has(block.id);
                const displayedLinkedEmailMessageIDs = block.linkedEmailMessageIDs.length > 0
                  ? block.linkedEmailMessageIDs
                  : block.stagedEmailMessageID?.trim()
                    ? [block.stagedEmailMessageID.trim()]
                    : [];
                const hasLinkedEmailMessages = displayedLinkedEmailMessageIDs.length > 0;
                const linkedEmailOpen = hasLinkedEmailMessages && openEmailBlockIDs.has(block.id);
                const contentOpen = editorOpen || linkedEmailOpen;
                const bodyColumns = [
                  contentOpen ? "minmax(360px, 1fr)" : "",
                  chatOpen ? "8px" : "",
                  chatOpen ? `${projectSidePaneWidths.chat}px` : "",
                ].filter(Boolean).join(" ") || "minmax(0, 1fr)";
                const minimumWidth = (contentOpen ? 360 : 0) + (chatOpen ? projectSidePaneWidths.chat + 8 : 0);
                const blockSaveStorageKey = mangoTiptapPendingStorageKey({ companyID, resourceType: "project", resourceID: projectID, documentID: block.id });
                const blockSaveFallback = savingID === block.id ? { status: "saving" as const } : { status: "saved" as const, updatedTimestamp: block.updatedTimestamp };
                const blockSaveNeedsFailureAttention = Boolean(textBlockSaveFailures[block.id]);
                return (
                  <div key={block.id} style={{ ...projectTimelineRowStyle, height: textBlockViewport.rowHeight + TEXT_BLOCK_ROW_GAP, paddingBottom: TEXT_BLOCK_ROW_GAP, boxSizing: "border-box", overflow: "hidden" }}>
                    <TimelineCell accent={accent} muted={false} isLast={index === timelineBlocks.length - 1} minHeight={textBlockViewport.rowHeight} />
                    <div
                      className={`mango-fixed-editor-row${blockSaveNeedsFailureAttention ? " mango-editor-save-failed-frame" : ""}`}
                      data-project-text-box-row={block.id}
                      data-email-chat-destination={projectEmailChatDestinationBlockID === block.id ? "true" : undefined}
                      style={{ ...projectTextBlockCardStyle(focusedTextBlockID === block.id, block.color), height: textBlockViewport.rowHeight, display: "grid", gridTemplateRows: "38px minmax(0, 1fr)", outline: projectEmailChatDestinationBlockID === block.id ? `3px solid ${accent}` : undefined, outlineOffset: -2 }}
                    >
                      <div
                        className="mango-editor-header-scroll"
                        data-email-chat-destination-candidate={pendingProjectEmailChatSelection && !block.temporaryEmailChat ? "true" : undefined}
                        onClickCapture={pendingProjectEmailChatSelection && !block.temporaryEmailChat ? (event) => {
                          const target = event.target;
                          if (target instanceof Element && target.closest("button, a, input, textarea, select, label, details, summary")) return;
                          if (chooseProjectEmailChatDestination(block.id)) event.stopPropagation();
                        } : undefined}
                        onDragOver={(event) => {
                          if (block.temporaryEmailChat || !event.dataTransfer.types.includes(EMAIL_MESSAGE_TEXT_BOX_LINK_DRAG_MIME)) return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "copy";
                        }}
                        onDrop={(event) => {
                          if (block.temporaryEmailChat || !event.dataTransfer.types.includes(EMAIL_MESSAGE_TEXT_BOX_LINK_DRAG_MIME)) return;
                          event.preventDefault();
                          const dragged = parseEmailMessageTextBoxLinkDrag(event.dataTransfer);
                          if (!dragged || textBoxHasLinkedEmailMessage(block, dragged.emailMessageID)) return;
                          void linkEmailMessageToProjectTextBlock(dragged.emailMessageID, block.id).catch((cause) => {
                            setError(cause instanceof Error ? cause.message : "failed_to_link_email_to_project_text_box");
                          });
                        }}
                        style={{ minWidth: 0, overflowX: "auto", overflowY: "hidden", borderBottom: `1px solid ${PROJECT_SUMMARY_RULE}`, background: block.color ? `linear-gradient(90deg, ${block.color}30, ${block.color}0c 54%, rgba(255,255,255,0.88))` : PROJECT_TEXTBOX_HEADER_BACKGROUND }}
                      >
                        <div style={{ minWidth: Math.max(448, minimumWidth), height: 37, display: "grid", gridTemplateColumns: `${hasLinkedEmailMessages ? 128 : 44}px minmax(360px, 1fr) ${chatOpen ? projectSidePaneWidths.chat : 44}px`, alignItems: "center", gap: 4, padding: "4px 6px", boxSizing: "border-box" }}>
                          <div style={{ minWidth: 0, display: "flex", alignItems: "center", justifyContent: "flex-start" }}>
                            {hasLinkedEmailMessages ? (
                              <button
                                type="button"
                                aria-label={linkedEmailOpen ? "Hide linked email" : "Show linked email"}
                                aria-expanded={linkedEmailOpen}
                                title={linkedEmailOpen ? "Hide the linked email" : "Show the linked email"}
                                onClick={() => setOpenEmailBlockIDs((current) => toggleSetValue(current, block.id))}
                                style={{ minWidth: 0, minHeight: 26, display: "inline-flex", alignItems: "center", gap: 5, border: `1px solid ${block.color || EDITOR_NEU_SOFT_BORDER}`, borderRadius: 8, background: linkedEmailOpen ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE, color: block.color || accent, cursor: "pointer", padding: "2px 7px", fontSize: 10, fontWeight: 900, boxShadow: EDITOR_NEU_SHADOW }}
                              >
                                <MailIcon color={block.color || accent} />
                                <span>{linkedEmailOpen ? "Hide email" : "Show email"}</span>
                              </button>
                            ) : null}
                          </div>
                          <div style={{ minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                            <button type="button" title={editorOpen ? "Hide text editor" : "Open text editor"} aria-label="Toggle text editor column" aria-pressed={editorOpen} onClick={() => {
                              if (editorOpen) {
                                setFocusedTextBlockID("");
                                setActiveRichTextBlockID("");
                                projectFormattingControllerRef.current = null;
                              }
                              setOpenEditorBlockIDs((current) => {
                                const next = new Set(current);
                                if (editorOpen) next.delete(block.id);
                                else next.add(block.id);
                                return next;
                              });
                            }} style={projectTextBlockIconButtonStyle(accent, editorOpen)}>
                              <TextEditorIcon color={accent} />
                            </button>
                            {!block.temporaryEmailChat ? <EditorSaveStatusIcon state={blockSaveFallback} storageKey={blockSaveStorageKey} compact /> : null}
                            {!block.temporaryEmailChat ? <EditorSavedTimestamp storageKey={blockSaveStorageKey} fallbackUpdatedTimestamp={block.updatedTimestamp} createdTimestamp={block.createdTimestamp} formatTimestamp={formatTextBlockMetadataTimestamp} /> : null}
                            {!block.temporaryEmailChat ? <label title="Add attachment" aria-label="Add attachment" style={projectTextBlockIconButtonStyle(accent, false)}>
                              <PaperclipIcon color={accent} />
                              <input type="file" multiple style={{ display: "none" }} onChange={(event) => {
                                const files = event.currentTarget.files;
                                if (files) void addTextBlockAttachments(block, files);
                                event.currentTarget.value = "";
                              }} />
                            </label> : null}
                            {!block.temporaryEmailChat ? <TextBlockActionsMenu accent={accent} surfaceText={PROJECT_SUMMARY_SURFACE_TEXT} panelBackground={EDITOR_NEU_PANEL_BACKGROUND} strokeColor={EDITOR_NEU_SOFT_BORDER} onDelete={() => void removeTextBlock(block.id)} /> : null}
                          </div>
                          <div style={{ display: "flex", justifyContent: "flex-end" }}>
                            <button type="button" title={pendingProjectEmailChatSelection ? "Use this chat column for highlighted email text" : chatOpen ? "Hide chat" : "Open chat"} aria-label={pendingProjectEmailChatSelection ? "Use this chat column for highlighted email text" : "Toggle chat column"} aria-pressed={chatOpen} onClick={() => {
                              if (pendingProjectEmailChatSelection) {
                                chooseProjectEmailChatDestination(block.id);
                                return;
                              }
                              setOpenChatBlockIDs((current) => toggleSetValue(current, block.id));
                            }} style={projectTextBlockIconButtonStyle(accent, chatOpen)}>
                              <ChatIcon color={accent} />
                            </button>
                          </div>
                        </div>
                      </div>
                      <div style={{ minWidth: 0, minHeight: 0, overflowX: "auto", overflowY: "hidden" }}>
                        <div data-project-text-box-columns="email-editor-chat" style={{ minWidth: Math.max(1, minimumWidth), height: textBlockViewport.bodyHeight, display: "grid", gridTemplateColumns: bodyColumns }}>
                          {contentOpen && (
                            <div style={{ minWidth: 0, height: textBlockViewport.bodyHeight, display: "grid", gridTemplateRows: linkedEmailOpen && editorOpen ? "minmax(100px, 0.8fr) minmax(120px, 1fr)" : "minmax(0, 1fr)", overflow: "hidden" }}>
                              {linkedEmailOpen ? (
                                <div data-project-linked-email-content="true" style={{ minWidth: 0, minHeight: 0, overflow: "auto", borderBottom: editorOpen ? `1px solid ${EDITOR_NEU_SOFT_BORDER}` : undefined }}>
                                  <LinkedEmailPreviewPane
                                    messageIDs={displayedLinkedEmailMessageIDs}
                                    textBoxID={block.id}
                                    allowUnlinkedPreview={Boolean(block.stagedEmailMessageID)}
                                    emails={attachedEmails}
                                    projectID={projectID}
                                    apiBase={apiBase}
                                    companyID={companyID}
                                    currentUserID={currentUserID}
                                    companyUsers={companyUsers}
                                    attachmentRequestJSON={attachmentRequestJSON}
                                    editable={!block.temporaryEmailChat}
                                    accent={block.color || accent}
                                    surfaceText={PROJECT_SUMMARY_SURFACE_TEXT}
                                    strokeColor={EDITOR_NEU_SOFT_BORDER}
                                    activeSelection={activeProjectEmailSelection}
                                    chatHighlightsByMessageID={projectEmailChatHighlightsByMessageID}
                                    onEmailSelectionChatRequest={openProjectEmailSelectionChat}
                                    onEmailSelectionTextBoxRequest={(messageID, quote) => { void createProjectEmailTextBlock(messageID, quote); }}
                                    onRemoveEmail={(emailID) => { void removeAttachedEmail(emailID); }}
                                    onError={setError}
                                  />
                                </div>
                              ) : null}
                              {editorOpen ? (
                                <div style={{ minWidth: 0, minHeight: 0, overflow: "hidden" }}>
                                {block.temporaryEmailChat ? (
                                  <div data-project-pending-email-chat-text-box="true" aria-label="Pending email chat text box" style={{ height: "100%", background: "rgba(255,255,255,0.72)" }} />
                                ) : (
                              <NodeTextBlockEditor
                                key={`${block.id}:${projectDocumentRemountRevision}`}
                                fillHeight
                                blockID={block.id}
                                surfaceKind="project"
                                editable
                                nodeID={`project:${projectID}`}
                                apiBase={apiBase}
                                companyID={companyID}
                                attachmentResourceType="project"
                                attachmentResourceID={projectID}
                                attachmentRequestJSON={attachmentRequestJSON}
                                attachmentEditorSurface="project_text_block"
                                currentUserID={currentUserID || "local-user"}
                                companyUsers={companyUsers}
                                documentValue={block.document}
                                documentScrollMemoryRef={projectDocumentScrollMemoryRef}
                                 chatMessages={chatMessagesByBlockID.get(block.id) ?? []}
                                activeChatAnchorMessageID={activeChatMessageIDs[block.id] ?? ""}
                                chatNavigationRequest={chatNavigationRequests[block.id] ?? null}
                                surfaceText={PROJECT_SUMMARY_SURFACE_TEXT}
                                accent={accent}
                                outlineStyle={outlineStyle}
                                indentGuideColor={PROJECT_SUMMARY_RULE}
                                scrollbarTrack="rgba(15, 23, 42, 0.08)"
                                formattingControllerRef={projectFormattingControllerRef}
                                formattingControllerActive={activeRichTextBlockID === block.id}
                                onFocus={() => {
                                  setActiveRowBlockID(block.id);
                                  setFocusedTextBlockID(block.id);
                                  setActiveRichTextBlockID(block.id);
                                  window.setTimeout(refreshProjectSelectionFormat, 0);
                                }}
                                onBlur={() => undefined}
                                onPinChange={(pinned) => setTiptapPinnedBlockIDs((current) => {
                                  const has = current.has(block.id);
                                  if (has === pinned) return current;
                                  const next = new Set(current);
                                  if (pinned) next.add(block.id);
                                  else next.delete(block.id);
                                  return next;
                                })}
                                onDocumentChange={(document) => applyProjectSyncedDocument(block.id, document)}
                                onDocumentFlush={(document) => applyProjectSyncedDocument(block.id, document)}
                                onDocumentConflict={() => setError("Mango is recovering this project text box from its committed snapshot.")}
                                onDocumentError={setError}
                                onSaveStateChange={(state) => {
                                  const failed = editorSaveNeedsFailureAttention(state);
                                  setTextBlockSaveFailures((current) => current[block.id] === failed ? current : { ...current, [block.id]: failed });
                                }}
                                onRecoveryStorageError={setError}
                                onRecoveryStorageRecovered={() => setError("")}
                                onChatHighlightActivate={(messageID) => {
                                  setFocusedTextBlockID(block.id);
                                  setActiveRichTextBlockID("");
                                  projectFormattingControllerRef.current = null;
                                  setOpenChatBlockIDs((current) => new Set(current).add(block.id));
                                  setActiveChatMessageIDs({ [block.id]: messageID });
                                  setChatMessageFocusRequests((current) => ({ ...current, [block.id]: { messageID, requestID: (current[block.id]?.requestID ?? 0) + 1 } }));
                                }}
                                onSelectionChatRequest={(selection) => {
                                  setChatSelectionAnchors((current) => ({ ...current, [block.id]: selection }));
                                  setOpenChatBlockIDs((current) => new Set(current).add(block.id));
                                }}
                                onImageChatRequest={(image) => { void addImageChatComment(image); }}
                                onImageNodeRequest={() => undefined}
                                onSelectionFontSizeChange={setProjectSelectionFontSize}
                                onSelectionInlineFormatChange={setProjectInlineFormat}
                                onSelectionHighlightColorChange={setProjectHighlightColor}
                              />
                                )}
                                </div>
                              ) : null}
                            </div>
                          )}
                          {chatOpen && <div role="separator" aria-label="Resize chat column" aria-orientation="vertical" onPointerDown={(event) => beginProjectColumnResize("chat", event)} style={projectColumnResizeHandleStyle} />}
                          {chatOpen && (
                            <div style={{ minWidth: 0, height: textBlockViewport.bodyHeight, overflow: "hidden", borderLeft: `1px solid ${EDITOR_NEU_SOFT_BORDER}` }}>
                              <ChatPane
                                blockID={block.id}
                                editable
                                apiBase={apiBase}
                                companyID={companyID}
                                entityRequestJSON={attachmentRequestJSON}
                                messages={chatMessagesByBlockID.get(block.id) ?? []}
                                selectionAnchor={chatSelectionAnchors[block.id]}
                                composerDestination={chatSelectionAnchors[block.id]?.source === "email" ? {
                                  kind: block.temporaryEmailChat ? "existing_project_new_textbox" : "existing_project_existing_textbox",
                                  nodeID: projectID,
                                  nodeName: project?.name || "Project",
                                } : undefined}
                                draft={chatDrafts[block.id] ?? ""}
                                draftEntityLinks={chatDraftEntityLinks[block.id] ?? []}
                                companyUsers={companyUsers}
                                draftAttachments={chatDraftAttachments[block.id] ?? []}
                                attachmentsEnabled={!block.temporaryEmailChat}
                                replyTargetID={chatReplyTargets[block.id] ?? ""}
                                heightStorageKey={`project-summary-chat-pane-height:${companyID}:${projectID}:${block.id}`}
                                fixedHeight={textBlockViewport.bodyHeight}
                                active={focusedTextBlockID === block.id}
                                currentUserID={currentUserID || "local-user"}
                                activeMessageID={activeChatMessageIDs[block.id] ?? ""}
                                messageFocusRequest={chatMessageFocusRequests[block.id] ?? null}
                                composerFocusRequestID={chatComposerFocusRequestIDs[block.id] ?? 0}
                                accent={accent}
                                surfaceText={PROJECT_SUMMARY_SURFACE_TEXT}
                                panelBackground={EDITOR_NEU_PANEL_BACKGROUND}
                                strokeColor={EDITOR_NEU_SOFT_BORDER}
                                ruleColor={PROJECT_SUMMARY_RULE}
                                onFocus={() => {
                                  setActiveRowBlockID(block.id);
                                  setFocusedTextBlockID(block.id);
                                  setActiveRichTextBlockID("");
                                  projectFormattingControllerRef.current = null;
                                }}
                                onDraftChange={(draft) => setChatDrafts((current) => ({ ...current, [block.id]: draft }))}
                                onDraftEntityLinksChange={(links) => setChatDraftEntityLinks((current) => ({ ...current, [block.id]: links }))}
                                onActivateMessage={(messageID) => setActiveChatMessageIDs((current) => current[block.id] === messageID ? {} : { [block.id]: messageID })}
                                onNavigateToMessage={(messageID) => setChatNavigationRequests((current) => ({ ...current, [block.id]: { anchorMessageID: messageID, requestID: Date.now() } }))}
                                onReply={(messageID) => setChatReplyTargets((current) => ({ ...current, [block.id]: messageID }))}
                                onEditMessage={editChatMessage}
                                onDeleteMessage={(messageID) => void deleteChatMessage(messageID)}
                                onClearReply={() => setChatReplyTargets((current) => omitRecordKey(current, block.id))}
                                onClearSelectionAnchor={() => clearProjectEmailSelectionChat(block.id)}
                                onClearComposerDestination={() => clearProjectEmailSelectionChat(block.id)}
                                onAttachFiles={(files) => {
                                  if (!block.temporaryEmailChat) void attachChatDraftFiles(block.id, files);
                                }}
                                onRemoveDraftAttachment={(attachmentID) => setChatDraftAttachments((current) => ({ ...current, [block.id]: (current[block.id] ?? []).filter((attachment) => attachment.id !== attachmentID) }))}
                                onSubmit={() => void submitChatMessage(block.id)}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            </div>
          </div>
        </section>
        <div className="mango-project-summary-split-handle" role="separator" aria-orientation="vertical" style={summarySplitHandleStyle} onPointerDown={startSummarySplitResize} />
        <aside className="mango-project-summary-work-panel" style={relationshipsColumnStyle(summarySplitPct)}>
          <div className="mango-project-summary-work-toolbar" style={projectWorkPanelToolbarStyle}>
            <div className="mango-project-summary-tabs" role="tablist" aria-label="Project work panel" style={rightPanelTabsStyle}>
              <button
                type="button"
                role="tab"
                aria-selected={activeRightPanelTab === "relationships"}
                style={rightPanelTabStyle(activeRightPanelTab === "relationships")}
                onClick={() => selectRightPanelTab("relationships")}
              >
                Processes / Nodes
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeRightPanelTab === "critical-path"}
                style={rightPanelTabStyle(activeRightPanelTab === "critical-path")}
                onClick={() => selectRightPanelTab("critical-path")}
              >
                Critical Path
              </button>
            </div>
            {activeRightPanelTab === "relationships" ? (
              <div style={projectWorkPanelActionsStyle}>
                <UniversalLinkerControls
                  busy={relationshipActionBusy}
                  pickerOpen={Boolean(relationshipPickerAnchor)}
                  createFloatingNodeAriaLabel="Create floating Node in Project"
                  openPickerAriaLabel="Open Universal Picker to link a Node"
                  onCreateFloatingNode={() => {
                    setRelationshipPickerAnchor(null);
                    void createFloatingProjectNode();
                  }}
                  onTogglePicker={(event) => {
                    if (relationshipPickerAnchor) {
                      setRelationshipPickerAnchor(null);
                      return;
                    }
                    const bounds = event.currentTarget.getBoundingClientRect();
                    setRelationshipPickerAnchor({ left: bounds.left, top: bounds.bottom + 7 });
                  }}
                />
                <UniversalGroupingControls
                  groupings={relationshipGroupings}
                  fieldOptions={PROJECT_RELATIONSHIP_GROUPING_FIELDS}
                  onChange={updateRelationshipGroupings}
                  buttonLabel="Group"
                  popoverLabel="Project relationship grouping"
                  emptyLabel="Relationships are shown as a flat list"
                  accent={accent}
                />
              </div>
            ) : null}
          </div>
          {activeRightPanelTab === "relationships" ? (
          <div
            className="kanban-board-scroll"
            style={relationshipScrollStyle(relationshipDropActive)}
            onContextMenu={(event) => {
              if (projectRelationshipEventTargetsRow(event.target)) return;
              event.preventDefault();
            }}
            onMouseDown={(event) => {
              if (event.button !== 0 || projectRelationshipEventTargetsRow(event.target)) return;
              setSelectedRelationshipNodeIDs(new Set());
              setSelectionAnchorRelationshipNodeID("");
            }}
            onDragOver={(event) => {
              if (!Array.from(event.dataTransfer.types).includes(EXPLORER_DRAG_MIME)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setRelationshipDropActive(true);
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              setRelationshipDropActive(false);
            }}
            onDrop={(event) => {
              if (!Array.from(event.dataTransfer.types).includes(EXPLORER_DRAG_MIME)) return;
              event.preventDefault();
              setRelationshipDropActive(false);
              void relationshipTargetsFromTransfer(event.dataTransfer).then((targets) => {
                if (targets.length > 0) void addRelationshipTargets(targets);
              }, (cause) => {
                setError(cause instanceof Error ? cause.message : "Failed to load Company Explorer folder");
              });
            }}
          >
            {relationshipGroupingModel.groups.length > 0
              ? renderRelationshipGroups(relationshipGroupingModel.groups)
              : renderRelationshipRows(relationshipGroupingModel.ungroupedRows, 0)}
            {relationships.length === 0 ? (
              <div style={emptyRelationshipStyle}>No relationships</div>
            ) : null}
          </div>
          ) : (
            <CriticalPathTable
              accent={accent}
              companyID={companyID}
              steps={criticalPath}
              relationships={relationships}
              companyUsers={companyUsers}
              groups={groups}
              onAddStep={() => void addCriticalPathStep()}
              onSaveStep={(step, updates) => void saveCriticalPathStep(step, updates)}
              onDeleteStep={(step) => void removeCriticalPathStep(step)}
              onSetCurrent={(step) => void setCurrentCriticalStep(step)}
              onAssignNode={(step, nodeID) => void assignCriticalPathNode(step, nodeID)}
              selectedNodePreview={selectedCriticalPathNode}
              onSelectNodePreview={setSelectedCriticalPathNode}
              onClearNodePreview={() => setSelectedCriticalPathNode(null)}
              onNodeOpen={onNodeOpen}
              onLogicGateOpen={onLogicGateOpen ? (logicGateID, label) => onLogicGateOpen(logicGateID, label, {
                projectID,
                workPanelTab: "critical-path",
              }) : undefined}
            />
          )}
          {relationshipContextMenu ? (
            <div
              role="menu"
              style={relationshipContextMenuStyle(relationshipContextMenu.x, relationshipContextMenu.y)}
              onPointerDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
            >
              {relationshipContextMenu.relationship?.resourceType === "logic_gate" ? (
                <button type="button" role="menuitem" style={relationshipContextMenuButtonStyle} onClick={() => void createRelationshipNode()}>
                  Create new node in process
                </button>
              ) : null}
              {relationshipContextMenu.relationship ? (
                <button type="button" role="menuitem" style={relationshipContextMenuButtonStyle} onClick={() => openRelationshipResourceInNewTab(relationshipContextMenu.relationship!)}>
                  {relationshipContextMenu.relationship.resourceType === "logic_gate" ? "Open process in new browser tab" : "Open node in new browser tab"}
                </button>
              ) : null}
              {relationshipContextMenu.relationship ? (
                <button type="button" role="menuitem" style={relationshipContextMenuDangerButtonStyle} onClick={() => void removeRelationshipFromProject()}>
                  {relationshipContextMenu.relationship.resourceType === "logic_gate"
                    ? "Remove process from project"
                    : selectedRelationshipNodeIDs.has(relationshipContextMenu.relationship.relationshipID) && selectedRelationshipNodeIDs.size > 1
                      ? `Remove ${selectedRelationshipNodeIDs.size} nodes from project`
                      : "Remove node from project"}
                </button>
              ) : null}
              {relationshipContextMenu.relationship ? (
                <button type="button" role="menuitem" style={relationshipContextMenuDangerButtonStyle} onClick={(event) => requestDeleteRelationshipResource(confirmMenuPositionFromElement(event.currentTarget))}>
                  {relationshipContextMenu.relationship.resourceType === "logic_gate"
                    ? "Delete process"
                    : selectedRelationshipNodeIDs.has(relationshipContextMenu.relationship.relationshipID) && selectedRelationshipNodeIDs.size > 1
                      ? `Delete ${selectedRelationshipNodeIDs.size} nodes`
                      : "Delete node"}
                </button>
              ) : null}
            </div>
          ) : null}
          {relationshipDeleteConfirmation ? (
            <ConfirmActionMenu
              title={`Delete ${relationshipDeleteConfirmation.label}?`}
              detail={`This moves the underlying ${relationshipDeleteConfirmation.label} to the recycle bin.`}
              position={relationshipDeleteConfirmation.position}
              confirmLabel="Yes"
              cancelLabel="No"
              onConfirm={(confirmationDisplayName) => void deleteRelationshipResource(relationshipDeleteConfirmation, confirmationDisplayName)}
              onCancel={() => setRelationshipDeleteConfirmation(null)}
            />
          ) : null}
        </aside>
      </div>
      {relationshipPickerAnchor ? (
        <UniversalEntityPicker
          companyID={companyID}
          requestJSON={attachmentRequestJSON}
          sourceType="project"
          linkTargetTypes={["node"]}
          initialMode="link"
          initialCategory="node"
          lockMode
          anchor={relationshipPickerAnchor}
          onCancel={() => setRelationshipPickerAnchor(null)}
          onChoose={async (entity: EditorEntityLink, mode: UniversalEntityPickerMode) => {
            if (mode === "link") await addRelationshipFromPicker(entity);
            else openEditorEntityLink(entity);
          }}
        />
      ) : null}
      {emailPicker ? (
        <UniversalEntityPicker
          companyID={companyID}
          requestJSON={attachmentRequestJSON}
          sourceType="project"
          linkTargetTypes={["node", "email_message"]}
          initialMode="link"
          initialCategory="email_message"
          anchor={emailPicker}
          onCancel={() => setEmailPicker(null)}
          onChoose={async (entity: EditorEntityLink, mode: UniversalEntityPickerMode) => {
            if (mode === "link" && entity.entityType === "node") await addRelationshipFromPicker(entity);
            else if (mode === "link") await linkEmailToProject(entity);
            else openEditorEntityLink(entity);
            setEmailPicker(null);
          }}
        />
      ) : null}
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
      attachments: content.attachments ?? [],
      linkedEmailMessageIDs: content.linkedEmailMessageIDs,
      color: content.color,
      createdTimestamp: projection.created_timestamp ?? "",
      updatedTimestamp: projection.updated_timestamp ?? projection.created_timestamp ?? "",
    };
  });
}

function ProjectDocumentIcon({ color = "currentColor" }: { color?: string }) {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" style={{ display: "block" }}>
      <path d="M4 1.8h6.2L14 5.6v10.6H4z" fill="rgba(255,255,255,0.76)" stroke={color} strokeWidth="1.35" strokeLinejoin="round" />
      <path d="M10.2 1.8v3.8H14M6.4 8h5.2M6.4 10.5h5.2M6.4 13h3.7" fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CriticalPathTable({
  accent,
  companyID,
  steps,
  relationships,
  companyUsers,
  groups,
  onAddStep,
  onSaveStep,
  onDeleteStep,
  onSetCurrent,
  onAssignNode,
  selectedNodePreview,
  onSelectNodePreview,
  onClearNodePreview,
  onNodeOpen,
  onLogicGateOpen,
}: {
  accent: string;
  companyID: string;
  steps: ProjectCriticalPathStep[];
  relationships: ProjectRelationshipProjection[];
  companyUsers: CompanyUser[];
  groups: CompanyUserGroup[];
  onAddStep: () => void;
  onSaveStep: (step: ProjectCriticalPathStep, updates: CriticalPathStepUpdates) => void;
  onDeleteStep: (step: ProjectCriticalPathStep) => void;
  onSetCurrent: (step: ProjectCriticalPathStep) => void;
  onAssignNode: (step: ProjectCriticalPathStep, nodeID: string) => void;
  selectedNodePreview: CriticalPathNodePreviewSelection | null;
  onSelectNodePreview: (selection: CriticalPathNodePreviewSelection) => void;
  onClearNodePreview: () => void;
  onNodeOpen?: (nodeID: string) => void;
  onLogicGateOpen?: (logicGateID: string, label?: string) => void;
}) {
  const apiBase = readAuthConfig().apiBase;
  const nodePickerRequestRef = useRef(0);
  const [nodePickerStepID, setNodePickerStepID] = useState("");
  const [nodePickerQuery, setNodePickerQuery] = useState("");
  const [nodePickerResults, setNodePickerResults] = useState<CompanyExplorerSearchResult[]>([]);
  const [nodePickerLoading, setNodePickerLoading] = useState(false);
  const [nodePickerError, setNodePickerError] = useState("");
  const relationshipByID = useMemo(() => new Map(relationships.map((relationship) => [relationship.relationship_id, relationship])), [relationships]);
  const orderedSteps = useMemo(() => orderCriticalPathSteps(steps), [steps]);
  const nodePickerSearchText = nodePickerQuery.trim();
  const nodePickerRows = useMemo(() => (
    buildCompanyExplorerSearchTreeRows(nodePickerResults.filter((result) => result.resource_type === "node"))
      .filter((row) => row.syntheticKind === "search_result" && row.kind === "node" && row.nodeID)
  ), [nodePickerResults]);

  useEffect(() => subscribeCommittedEntityTitleUpdates((update) => {
    setNodePickerResults((current) => reconcileCompanyExplorerSearchResultTitles(current, update));
  }), [companyID]);

  useEffect(() => {
    if (!nodePickerStepID || !nodePickerSearchText) {
      setNodePickerResults([]);
      setNodePickerLoading(false);
      setNodePickerError("");
      return undefined;
    }
    const requestID = nodePickerRequestRef.current + 1;
    nodePickerRequestRef.current = requestID;
    let cancelled = false;
    setNodePickerLoading(true);
    setNodePickerError("");
    const titleVersionAtStart = readCommittedEntityTitleVersion();
    void fetchCompanyExplorerSearchResults(apiBase, companyID, nodePickerSearchText, 20)
      .then((payload) => {
        if (cancelled || nodePickerRequestRef.current !== requestID) return;
        setNodePickerResults(foldCommittedEntityTitlesSince(
          payload.results ?? [], companyID, titleVersionAtStart,
          reconcileCompanyExplorerSearchResultTitles,
        ));
      })
      .catch((searchError) => {
        if (cancelled || nodePickerRequestRef.current !== requestID) return;
        setNodePickerResults([]);
        setNodePickerError(searchError instanceof Error ? searchError.message : "Failed to search nodes");
      })
      .finally(() => {
        if (cancelled || nodePickerRequestRef.current !== requestID) return;
        setNodePickerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, companyID, nodePickerSearchText, nodePickerStepID]);

  useEffect(() => {
    if (!nodePickerStepID) return;
    if (!orderedSteps.some((step) => step.step_id === nodePickerStepID)) setNodePickerStepID("");
  }, [nodePickerStepID, orderedSteps]);

  const openNodePicker = useCallback((stepID: string) => {
    setNodePickerStepID(stepID);
    setNodePickerQuery("");
    setNodePickerResults([]);
    setNodePickerError("");
  }, []);

  const closeNodePicker = useCallback(() => {
    setNodePickerStepID("");
    setNodePickerQuery("");
    setNodePickerResults([]);
    setNodePickerError("");
    setNodePickerLoading(false);
  }, []);

  const assignNodeFromPicker = useCallback((step: ProjectCriticalPathStep, nodeID: string) => {
    closeNodePicker();
    onAssignNode(step, nodeID);
  }, [closeNodePicker, onAssignNode]);

  return (
    <div style={criticalPathPanelStyle}>
      <div style={criticalPathActionsStyle}>
        <button type="button" style={criticalPathAddButtonStyle(accent)} onClick={onAddStep}>Add Step</button>
      </div>
      <div role="table" aria-label="Critical path" className="kanban-board-scroll" style={criticalPathTableStyle}>
        <div role="row" style={criticalPathHeaderRowStyle}>
          <div style={criticalPathHeaderCellStyle}>Name</div>
          <div style={criticalPathHeaderCellStyle}>Node</div>
          <div style={criticalPathHeaderCellStyle}>Status</div>
          <div style={criticalPathHeaderCellStyle}>Due Date</div>
          <div style={criticalPathHeaderCellStyle}>Owner</div>
        </div>
        {orderedSteps.map((step) => {
          const relationship = step.relationship_id ? relationshipByID.get(step.relationship_id) : undefined;
          const resourceType = (step.resource_type || relationship?.resource_type || "") as "logic_gate" | "node" | "";
          const resourceID = step.resource_id || relationship?.resource_id || "";
          const logicGateID = step.logic_gate_id?.trim() || relationship?.logic_gate_id?.trim() || (resourceType === "logic_gate" ? resourceID : "");
          const nodeID = step.node_id?.trim() || relationship?.node_id?.trim() || (resourceType === "node" ? resourceID : "");
          const title = step.display_title || relationship?.display_title || "";
          const sourceStatus = step.status ?? relationship?.status ?? (resourceType === "logic_gate" ? "Process" : "");
          const status = resourceType === "logic_gate" && /^logic gate$/i.test(sourceStatus.trim()) ? "Process" : sourceStatus;
          const ownerValue = step.owner_type && step.owner_id ? `${step.owner_type}:${step.owner_id}` : "";
          const nodePickerOpen = nodePickerStepID === step.step_id;
          const nodePreview = criticalPathNodePreviewFromStep(step, relationshipByID);
          const nodePreviewSelected = Boolean(
            nodePreview &&
            selectedNodePreview?.stepID === nodePreview.stepID &&
            selectedNodePreview.nodeID === nodePreview.nodeID
          );
          return (
            <React.Fragment key={step.step_id}>
              <div
                role="row"
                style={criticalPathRowStyle(step.is_current, false, nodePreviewSelected || nodePickerOpen)}
                onDragOver={(event) => {
                  if (!Array.from(event.dataTransfer.types).includes(PROJECT_CRITICAL_STEP_DRAG_MIME)) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  if (!Array.from(event.dataTransfer.types).includes(PROJECT_CRITICAL_STEP_DRAG_MIME)) return;
                  event.preventDefault();
                  onSetCurrent(step);
                }}
              >
                <div role="cell" style={criticalPathNameCellStyle}>
                  <button type="button" aria-label="Delete step" title="Delete step" style={criticalPathDeleteButtonStyle} onClick={() => onDeleteStep(step)}>x</button>
                  <input
                    defaultValue={step.name}
                    style={criticalPathNameInputStyle}
                    onBlur={(event) => {
                      const nextName = event.currentTarget.value.trim();
                      if (nextName !== (step.name ?? "")) onSaveStep(step, { name: nextName });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.currentTarget.blur();
                      }
                    }}
                  />
                </div>
                <div role="cell" style={criticalPathNodeCellStyle}>
                  {title ? (
                    <button
                      type="button"
                      title={resourceType === "node" ? "Click to preview node. Click again to collapse. Double-click to open node." : "Open process"}
                      style={criticalPathLinkedResourceStyle(resourceType, nodePreviewSelected)}
                      onClick={() => {
                        if (resourceType === "logic_gate" && logicGateID) onLogicGateOpen?.(logicGateID, title);
                        if (resourceType === "node" && nodePreview) {
                          if (nodePreviewSelected) onClearNodePreview();
                          else onSelectNodePreview(nodePreview);
                        }
                      }}
                      onDoubleClick={(event) => {
                        if (!nodeID) return;
                        event.preventDefault();
                        event.stopPropagation();
                        onNodeOpen?.(nodeID);
                      }}
                    >
                      <span style={criticalPathResourceIconStyle(resourceType)}>
                        <ExplorerRowIcon kind={resourceType === "logic_gate" ? "logic_gate" : "node"} />
                      </span>
                      <span style={criticalPathResourceTitleStyle}>{title}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      style={criticalPathAddNodeCellButtonStyle(nodePickerOpen)}
                      onClick={() => openNodePicker(step.step_id)}
                    >
                      Add node
                    </button>
                  )}
                </div>
              <div role="cell" style={criticalPathCellStyle}>
                <span style={criticalPathStatusPillStyle(status || "No status")}>{status || "No status"}</span>
              </div>
              <div role="cell" style={criticalPathCellStyle}>
                <input
                  type="date"
                  value={step.due_date ?? ""}
                  style={criticalPathDateInputStyle}
                  onChange={(event) => onSaveStep(step, { dueDate: event.currentTarget.value })}
                />
              </div>
              <div role="cell" style={criticalPathOwnerCellStyle}>
                <select
                  value={ownerValue}
                  style={criticalPathOwnerSelectStyle}
                  onChange={(event) => {
                    const [ownerType, ownerID] = event.currentTarget.value.split(":");
                    onSaveStep(step, { ownerType: ownerType === "user" || ownerType === "group" ? ownerType : "", ownerID: ownerID ?? "" });
                  }}
                >
                  <option value="">Unassigned</option>
                  {companyUsers.map((user) => (
                    <option key={`user:${user.user_id}`} value={`user:${user.user_id}`}>
                      {`Person: ${user.display_name || user.email || user.user_id}`}
                    </option>
                  ))}
                  {groups.map((group) => (
                    <option key={`group:${group.group_id}`} value={`group:${group.group_id}`}>
                      {`Org: ${group.name || group.group_id}`}
                    </option>
                  ))}
                </select>
              </div>
              {step.is_current ? (
                <button
                  type="button"
                  draggable
                  aria-label="Current Critical Step"
                  title="Drag current critical step"
                  style={criticalPathCurrentMarkerStyle}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData(PROJECT_CRITICAL_STEP_DRAG_MIME, step.step_id);
                    event.dataTransfer.setData("text/plain", "Current Critical Step");
                  }}
                >
                  <span className="project-critical-pulse-dot" style={criticalPathCurrentDotStyle} />
                  Current Critical Step
                </button>
              ) : (
                <button type="button" style={criticalPathSetCurrentButtonStyle} onClick={() => onSetCurrent(step)}>
                  Set current
                </button>
              )}
              </div>
              {nodePickerOpen ? (
                <div role="row" style={criticalPathNodePickerRowStyle}>
                  <div role="cell" style={criticalPathNodePickerCellStyle}>
                    <CriticalPathNodeSearchPicker
                      accent={accent}
                      query={nodePickerQuery}
                      rows={nodePickerRows}
                      loading={nodePickerLoading}
                      error={nodePickerError}
                      onQueryChange={setNodePickerQuery}
                      onCancel={closeNodePicker}
                      onSelectNode={(nodeID) => assignNodeFromPicker(step, nodeID)}
                    />
                  </div>
                </div>
              ) : null}
              {nodePreviewSelected && nodePreview ? (
                <div role="row" style={criticalPathNodePreviewRowStyle}>
                  <div role="cell" style={criticalPathNodePreviewCellStyle}>
                    <ProjectCriticalPathNodeWindow
                      accent={accent}
                      selection={nodePreview}
                      onClose={onClearNodePreview}
                      onNodeOpen={onNodeOpen}
                    />
                  </div>
                </div>
              ) : null}
            </React.Fragment>
          );
        })}
        {orderedSteps.length === 0 ? (
          <button type="button" style={criticalPathEmptyButtonStyle} onClick={onAddStep}>
            Add Step
          </button>
        ) : null}
      </div>
    </div>
  );
}

function CriticalPathNodeSearchPicker({
  accent,
  query,
  rows,
  loading,
  error,
  onQueryChange,
  onCancel,
  onSelectNode,
}: {
  accent: string;
  query: string;
  rows: ExplorerTreeNode[];
  loading: boolean;
  error: string;
  onQueryChange: (value: string) => void;
  onCancel: () => void;
  onSelectNode: (nodeID: string) => void;
}) {
  const hasQuery = query.trim().length > 0;
  return (
    <div style={criticalPathNodePickerSurfaceStyle}>
      <div style={criticalPathNodePickerSearchRowStyle}>
        <CompanyExplorerSearchBox
          value={query}
          onChange={onQueryChange}
          onEscape={onCancel}
          placeholder="Search Explorer nodes"
          ariaLabel="Search Explorer nodes"
          autoFocus
          style={criticalPathNodePickerSearchBoxStyle}
        />
        <button type="button" style={criticalPathNodePickerCancelButtonStyle} onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div role="listbox" aria-label="Node search results" style={criticalPathNodePickerResultsStyle}>
        {!hasQuery ? (
          <div style={criticalPathNodePickerEmptyStyle}>Search for a node</div>
        ) : loading ? (
          <div style={criticalPathNodePickerEmptyStyle}>Searching...</div>
        ) : error ? (
          <div style={criticalPathNodePickerErrorStyle}>{error}</div>
        ) : rows.length === 0 ? (
          <div style={criticalPathNodePickerEmptyStyle}>No node matches</div>
        ) : (
          rows.map((row) => {
            const nodeID = row.nodeID?.trim() || row.resourceID?.trim() || "";
            if (!nodeID) return null;
            return (
              <button
                key={row.id}
                type="button"
                role="option"
                aria-selected="false"
                style={criticalPathNodePickerResultButtonStyle}
                onClick={() => onSelectNode(nodeID)}
              >
                <span style={criticalPathNodePickerResultIconStyle(accent)}>
                  <ExplorerRowIcon kind="node" />
                </span>
                <span style={criticalPathNodePickerResultTextStyle}>
                  <span style={criticalPathNodePickerResultTitleStyle}>{row.label}</span>
                  {row.folderLabel ? <span style={criticalPathNodePickerResultPathStyle}>{row.folderLabel}</span> : null}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function criticalPathNodePreviewFromStep(
  step: ProjectCriticalPathStep,
  relationshipByID: Map<string, ProjectRelationshipProjection>,
): CriticalPathNodePreviewSelection | null {
  const relationship = step.relationship_id ? relationshipByID.get(step.relationship_id) : undefined;
  const resourceType = (step.resource_type || relationship?.resource_type || "") as "logic_gate" | "node" | "";
  const resourceID = (step.resource_id || relationship?.resource_id || "").trim();
  const nodeID = step.node_id?.trim() || relationship?.node_id?.trim() || (resourceType === "node" ? resourceID : "");
  if (resourceType !== "node" || !nodeID) return null;
  return {
    stepID: step.step_id,
    nodeID,
    title: (step.display_title || relationship?.display_title || "Node").trim() || "Node",
  };
}

function ProjectCriticalPathNodeWindow({
  accent,
  selection,
  onClose,
  onNodeOpen,
}: {
  accent: string;
  selection: CriticalPathNodePreviewSelection;
  onClose: () => void;
  onNodeOpen?: (nodeID: string) => void;
}) {
  return (
    <UnifiedNodeShell
      className="project-critical-path-node-window"
      surfaceID="project-critical-path-inline-node"
      title={selection.title}
      style={criticalPathNodePreviewSurfaceStyle(accent)}
      bodyStyle={criticalPathNodePreviewEditorFrameStyle}
      actionButtonStyle={criticalPathNodePreviewActionButtonStyle}
      closeButtonStyle={criticalPathNodePreviewActionButtonStyle}
      actions={[
        {
          id: "open-in-new-tab",
          title: onNodeOpen ? "Open node window" : "Open node in new browser tab",
          ariaLabel: onNodeOpen ? "Open node window" : "Open node in new browser tab",
          onClick: () => {
            if (onNodeOpen) onNodeOpen(selection.nodeID);
            else openAppPathInNewTab(buildContextualNodeRoute(selection.nodeID));
          },
        },
        {
          id: "pin",
          title: "Pin node to Pinned",
          ariaLabel: "Pin node to Pinned",
          onClick: () => requestAppSidebarPin({ kind: "node", id: selection.nodeID, name: selection.title }),
        },
        {
          id: "close",
          title: "Close inline node window",
          ariaLabel: "Close inline node window",
          onClick: onClose,
        },
      ]}
    >
      <EditorContent
        key={`${selection.stepID}:${selection.nodeID}`}
        accent={accent}
        widgetId={`project-critical-path-node:${selection.stepID}:${selection.nodeID}`}
        theme="mango"
        forcedEntityKind="node"
        forcedEntityID={selection.nodeID}
        forcedLabel={selection.title}
        forcedEmptyMessage="Select a critical-path node."
        compactLinkedDocumentHeader
      />
    </UnifiedNodeShell>
  );
}

function ProjectRelationshipNodePanel({
  accent,
  selection,
  onClose,
  onRequestDelete,
}: {
  accent: string;
  selection: ProjectRelationshipNodePanelSelection;
  onClose: () => void;
  onRequestDelete: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => setNodeEditorFullscreenChromeActive(fullscreen), [fullscreen]);

  const shell = (
    <UnifiedNodeShell
      className="project-relationships-node-panel project-critical-path-node-window"
      surfaceID="project-relationships-inline-node"
      title={selection.title}
      role={fullscreen ? "dialog" : "group"}
      ariaModal={fullscreen}
      style={projectRelationshipNodePanelStyle(accent, fullscreen)}
      bodyStyle={projectRelationshipNodePanelBodyStyle(fullscreen)}
      actionButtonStyle={criticalPathNodePreviewActionButtonStyle}
      closeButtonStyle={criticalPathNodePreviewActionButtonStyle}
      actions={[
        {
          id: "delete",
          title: "Move node to Recycle Bin",
          ariaLabel: "Move node to Recycle Bin",
          danger: true,
          onClick: (event) => {
            setFullscreen(false);
            onRequestDelete(event);
          },
        },
        {
          id: "open-in-new-tab",
          title: "Open node in new browser tab",
          ariaLabel: "Open node in new browser tab",
          onClick: () => openAppPathInNewTab(buildContextualNodeRoute(selection.nodeID)),
        },
        {
          id: "pin",
          title: "Pin node to Pinned",
          ariaLabel: "Pin node to Pinned",
          onClick: () => requestAppSidebarPin({ kind: "node", id: selection.nodeID, name: selection.title }),
        },
        {
          id: "fullscreen",
          title: fullscreen ? "Exit full screen" : "Go full screen",
          ariaLabel: fullscreen ? "Exit full screen" : "Go full screen",
          pressed: fullscreen,
          onClick: () => setFullscreen((current) => !current),
        },
        {
          id: "minimize",
          title: "Minimize node",
          ariaLabel: "Minimize node",
          onClick: () => {
            requestAppDockTab({ kind: "node", entityID: selection.nodeID, label: selection.title });
            onClose();
          },
        },
        {
          id: "close",
          title: "Collapse inline node window",
          ariaLabel: "Collapse inline node window",
          onClick: onClose,
        },
      ]}
    >
      <EditorContent
        accent={accent}
        widgetId={`project-relationship-node:${selection.nodeID}`}
        theme="light"
        forcedEntityKind="node"
        forcedEntityID={selection.nodeID}
        forcedLabel={selection.title}
        forcedEmptyMessage="Select a project node."
        compactLinkedDocumentHeader
        onBeforeHierarchyNavigate={fullscreen ? () => setFullscreen(false) : undefined}
      />
    </UnifiedNodeShell>
  );

  if (!fullscreen) return shell;

  return (
    <AppModalPortal trapFocus onRequestClose={() => setFullscreen(false)}>
      <div
        data-mango-project-relationship-node-fullscreen="true"
        style={projectRelationshipNodeFullscreenBackdropStyle}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setFullscreen(false);
        }}
      >
        {shell}
      </div>
    </AppModalPortal>
  );
}

function CriticalPulseBeacon({ visible, compact = false }: { visible: boolean; compact?: boolean }) {
  if (!visible) return <span aria-hidden="true" style={compact ? criticalPulsePlaceholderCompactStyle : criticalPulsePlaceholderStyle} />;
  return (
    <span className="project-critical-pulse-badge" title="Current Critical Step" aria-label="Current Critical Step" style={criticalPulseBadgeStyle(compact)}>
      <span className="project-critical-pulse-dot" style={criticalPulseBadgeDotStyle} />
      {!compact ? <span style={criticalPulseBadgeTextStyle}>Current</span> : null}
    </span>
  );
}

function ProjectRelationshipGroupIcon({ group }: { group: ProjectRelationshipNestedGroup }) {
  if (group.field === "logic_gate") return <ExplorerRowIcon kind="logic_gate" />;
  if (group.field === "type" && (group.key === "logic_gate" || group.key === "node")) {
    return <ExplorerRowIcon kind={group.key} />;
  }
  if (group.field === "status") return <span aria-hidden="true" style={nodeStatusDotStyle(group.label)} />;
  if (group.field === "email_origin" && group.key === "email") return <MailIcon color="#64748b" />;
  return (
    <span aria-hidden="true" style={relationshipGroupBadgeStyle}>
      {group.field === "date_added" ? "D" : group.field === "email_origin" ? "N" : "T"}
    </span>
  );
}

function orderCriticalPathSteps(steps: ProjectCriticalPathStep[]): ProjectCriticalPathStep[] {
  return [...steps].sort((left, right) => (
    (Number.isFinite(Number(left.position)) ? Number(left.position) : 0) -
    (Number.isFinite(Number(right.position)) ? Number(right.position) : 0) ||
    (left.created_timestamp ?? "").localeCompare(right.created_timestamp ?? "") ||
    left.step_id.localeCompare(right.step_id)
  ));
}

function mergeCriticalPathStep(current: ProjectCriticalPathStep[], incoming: ProjectCriticalPathStep): ProjectCriticalPathStep[] {
  const next = current.map((step) => {
    if (step.step_id === incoming.step_id) return incoming;
    return incoming.is_current ? { ...step, is_current: false } : step;
  });
  if (!next.some((step) => step.step_id === incoming.step_id)) next.push(incoming);
  return orderCriticalPathSteps(next);
}

function normalizeProjectHealth(value: string | undefined | null): ProjectHealth {
  return PROJECT_HEALTH_OPTIONS.includes(value as ProjectHealth) ? value as ProjectHealth : "On Track";
}

function projectSummaryHealthTone(health: ProjectHealth): ProjectFieldTone {
  return health === "AT RISK" ? "warning" : health === "Off Track" ? "danger" : "healthy";
}

function compareRelationshipProjection(left: ProjectRelationshipProjection, right: ProjectRelationshipProjection): number {
  return (left.position ?? 0) - (right.position ?? 0)
    || left.display_title.localeCompare(right.display_title, undefined, { numeric: true, sensitivity: "base" })
    || left.relationship_id.localeCompare(right.relationship_id);
}

function projectRelationshipGroupingPreferenceKey(companyID: string, currentUserID: string): string {
  return [
    PROJECT_RELATIONSHIP_GROUPING_STORAGE_KEY,
    companyID.trim() || "company",
    currentUserID.trim() || "user",
  ].join(":");
}

function projectRelationshipEventTargetsRow(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("[data-project-relationship-row='true']"));
}

function readProjectRelationshipGroupingPreference(
  companyID: string,
  currentUserID: string,
): ProjectRelationshipGroupingSetting[] {
  try {
    const raw = localStorage.getItem(projectRelationshipGroupingPreferenceKey(companyID, currentUserID));
    if (!raw) return normalizeProjectRelationshipGroupingStack(undefined);
    return normalizeProjectRelationshipGroupingStack(JSON.parse(raw));
  } catch {
    return normalizeProjectRelationshipGroupingStack(undefined);
  }
}

function storeProjectRelationshipGroupingPreference(
  companyID: string,
  currentUserID: string,
  groupings: ProjectRelationshipGroupingSetting[],
): void {
  try {
    localStorage.setItem(
      projectRelationshipGroupingPreferenceKey(companyID, currentUserID),
      JSON.stringify(normalizeProjectRelationshipGroupingStack(groupings)),
    );
  } catch {}
}

function mergeProjectRelationships(
  current: ProjectRelationshipProjection[],
  incoming: ProjectRelationshipProjection[],
): ProjectRelationshipProjection[] {
  const byID = new Map(current.map((relationship) => [relationship.relationship_id, relationship]));
  for (const relationship of incoming) {
    byID.set(relationship.relationship_id, relationship);
  }
  return Array.from(byID.values()).sort(compareRelationshipProjection);
}

function buildProjectRelationshipNodeSelectionUpdate(args: {
  orderedIDs: string[];
  selectedIDs: Set<string>;
  anchorID: string;
  clickedID: string;
  shiftKey?: boolean;
  additiveKey?: boolean;
}): { selectedIDs: Set<string>; anchorID: string } {
  if (!args.orderedIDs.includes(args.clickedID)) {
    return { selectedIDs: new Set(args.selectedIDs), anchorID: args.anchorID };
  }
  if (args.shiftKey && args.anchorID && args.orderedIDs.includes(args.anchorID)) {
    const anchorIndex = args.orderedIDs.indexOf(args.anchorID);
    const clickedIndex = args.orderedIDs.indexOf(args.clickedID);
    const [start, end] = anchorIndex <= clickedIndex ? [anchorIndex, clickedIndex] : [clickedIndex, anchorIndex];
    const selected = new Set(args.selectedIDs);
    for (const relationshipID of args.orderedIDs.slice(start, end + 1)) selected.add(relationshipID);
    return { selectedIDs: new Set(args.orderedIDs.filter((relationshipID) => selected.has(relationshipID))), anchorID: args.anchorID };
  }
  if (args.additiveKey) {
    const selected = new Set(args.selectedIDs);
    if (selected.has(args.clickedID)) selected.delete(args.clickedID);
    else selected.add(args.clickedID);
    return { selectedIDs: new Set(args.orderedIDs.filter((relationshipID) => selected.has(relationshipID))), anchorID: args.clickedID };
  }
  return { selectedIDs: new Set([args.clickedID]), anchorID: args.clickedID };
}

function relationshipTargetsForContext(
  target: RelationshipContextTarget,
  relationships: ProjectRelationshipProjection[],
  selectedRelationshipNodeIDs: Set<string>,
): RelationshipContextTarget[] {
  if (target.resourceType === "logic_gate") return [target];
  const selectedIDs = selectedRelationshipNodeIDs.has(target.relationshipID)
    ? selectedRelationshipNodeIDs
    : new Set([target.relationshipID]);
  const targets: RelationshipContextTarget[] = [];
  for (const relationship of relationships) {
    if (relationship.resource_type !== "node" || !selectedIDs.has(relationship.relationship_id)) continue;
    const resourceID = (relationship.node_id || relationship.resource_id || "").trim();
    if (!resourceID) continue;
    targets.push({
      relationshipID: relationship.relationship_id,
      resourceType: "node",
      resourceID,
      displayTitle: relationship.display_title,
    });
  }
  return targets;
}

function startProjectRelationshipNodeDrag(
  event: React.DragEvent<HTMLElement>,
  node: ProjectRelationshipProjection,
  fromLogicGateID: string,
): void {
  const nodeID = (node.node_id || node.resource_id || "").trim();
  if (!nodeID) {
    event.preventDefault();
    return;
  }
  const payload: ProjectRelationshipNodeDragPayload = {
    nodeID,
    fromLogicGateID: fromLogicGateID.trim() || undefined,
    status: node.status,
  };
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData(PROJECT_RELATIONSHIP_NODE_DRAG_MIME, JSON.stringify(payload));
  event.dataTransfer.setData("text/plain", node.display_title || nodeID);
}

function readProjectRelationshipNodeDragPayload(dataTransfer: DataTransfer): ProjectRelationshipNodeDragPayload | null {
  const raw = dataTransfer.getData(PROJECT_RELATIONSHIP_NODE_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ProjectRelationshipNodeDragPayload>;
    const nodeID = typeof parsed.nodeID === "string" ? parsed.nodeID.trim() : "";
    if (!nodeID) return null;
    return {
      nodeID,
      fromLogicGateID: typeof parsed.fromLogicGateID === "string" ? parsed.fromLogicGateID.trim() : undefined,
      status: typeof parsed.status === "string" ? parsed.status : null,
    };
  } catch {
    return null;
  }
}

function uniqueStringIDs(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function projectAccountIDs(project?: ProjectRecord | null): string[] {
  const fromAccounts = project?.accounts?.map((account) => account.account_id) ?? [];
  return uniqueStringIDs(fromAccounts);
}

function projectTeamIDs(project?: ProjectRecord | null): string[] {
  const fromTeams = project?.teams?.map((team) => team.group_id) ?? [];
  return uniqueStringIDs(fromTeams);
}


function toggleSetValue(current: Set<string>, value: string): Set<string> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function ProjectAssignmentsDialog({
  accounts,
  groups,
  selectedAccountIDs,
  selectedTeamIDs,
  saving,
  onSetAccountIDs,
  onSetTeamIDs,
  onSave,
  onClose,
}: {
  accounts: Account[];
  groups: CompanyUserGroup[];
  selectedAccountIDs: string[];
  selectedTeamIDs: string[];
  saving: boolean;
  onSetAccountIDs: (accountIDs: string[]) => void;
  onSetTeamIDs: (teamIDs: string[]) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const selectedAccounts = new Set(selectedAccountIDs);
  const selectedTeams = new Set(selectedTeamIDs);
  const toggleAccount = (accountID: string) => {
    onSetAccountIDs(toggleStringIDList(selectedAccountIDs, accountID));
  };
  const toggleTeam = (teamID: string) => {
    onSetTeamIDs(toggleStringIDList(selectedTeamIDs, teamID));
  };

  return (
    <AppModalPortal onRequestClose={saving ? undefined : onClose}>
    <div style={assignmentDialogBackdropStyle} onPointerDown={() => { if (!saving) onClose(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-assignments-title"
        style={assignmentDialogStyle}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div style={assignmentDialogHeaderStyle}>
          <h3 id="project-assignments-title" style={assignmentDialogTitleStyle}>Project Assignments</h3>
          <button type="button" style={assignmentCloseButtonStyle} disabled={saving} onClick={onClose}>Close</button>
        </div>
        <div style={assignmentDialogColumnsStyle}>
          <div style={assignmentSectionStyle}>
            <div style={assignmentSectionTitleStyle}>Accounts</div>
            <div style={assignmentListStyle}>
              {accounts.map((account) => (
                <label key={account.account_id} style={assignmentOptionStyle}>
                  <input
                    type="checkbox"
                    disabled={saving}
                    checked={selectedAccounts.has(account.account_id)}
                    onChange={() => toggleAccount(account.account_id)}
                  />
                  <span style={assignmentOptionLabelStyle}>{account.name || account.account_id}</span>
                </label>
              ))}
              {accounts.length === 0 ? <div style={assignmentEmptyStyle}>No accounts</div> : null}
            </div>
          </div>
          <div style={assignmentSectionStyle}>
            <div style={assignmentSectionTitleStyle}>Teams</div>
            <div style={assignmentListStyle}>
              {groups.map((group) => (
                <label key={group.group_id} style={assignmentOptionStyle}>
                  <input
                    type="checkbox"
                    disabled={saving}
                    checked={selectedTeams.has(group.group_id)}
                    onChange={() => toggleTeam(group.group_id)}
                  />
                  <span style={assignmentOptionLabelStyle}>{group.name || group.group_id}</span>
                </label>
              ))}
              {groups.length === 0 ? <div style={assignmentEmptyStyle}>No teams</div> : null}
            </div>
          </div>
        </div>
        <div style={assignmentDialogActionsStyle}>
          <button type="button" style={assignmentCancelButtonStyle} disabled={saving} onClick={onClose}>Cancel</button>
          <button type="button" style={assignmentSaveButtonStyle} disabled={saving} onClick={onSave}>
            {saving ? "Saving" : "Save Assignments"}
          </button>
        </div>
      </div>
    </div>
    </AppModalPortal>
  );
}

function toggleStringIDList(values: string[], value: string): string[] {
  const cleanValue = value.trim();
  if (!cleanValue) return values;
  const current = new Set(values.map((item) => item.trim()).filter(Boolean));
  if (current.has(cleanValue)) current.delete(cleanValue);
  else current.add(cleanValue);
  return Array.from(current);
}

function omitRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function formatTextBlockMetadataTimestamp(value: string | number | undefined): string {
  if (value === undefined || value === "") return "";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
  const day = new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric", year: "numeric" }).format(date);
  return `${time} ${day}`;
}

async function resolveProjectRelationshipDropTargets(
  apiBase: string,
  companyID: string,
  payload: ExplorerDropPayload | null,
  workspace?: ProjectSummaryWorkspaceSnapshot,
): Promise<ProjectRelationshipDropTarget[]> {
  if (!payload || !workspace) return [];
  const itemType = getExplorerDropPayloadItemType(payload);
  if (payload.kind === "batch") {
    if (itemType !== "node") return [];
    return eligibleProjectNodeRelationshipTargets(
      getExplorerDropPayloadItems(payload).map((item) => item.itemID),
      workspace,
    );
  }
  if (payload.itemType === "node" && payload.itemID) {
    return eligibleProjectNodeRelationshipTargets([payload.itemID], workspace);
  }
  if (payload.kind === "folder" && payload.folderID) {
    const nodeIDs = await fetchCompanyExplorerBranchResourceIDs(apiBase, companyID, payload.folderID, "node");
    return eligibleProjectNodeRelationshipTargets(nodeIDs, workspace);
  }
  return [];
}

function eligibleProjectNodeRelationshipTargets(
  nodeIDs: string[],
  workspace: ProjectSummaryWorkspaceSnapshot,
): ProjectRelationshipDropTarget[] {
  const eligibleNodeIDs = new Set(workspace.nodes
    .filter((node) => (node.logic_gate_ids ?? []).some((logicGateID) => logicGateID.trim()))
    .map((node) => node.node_id.trim())
    .filter(Boolean));
  return uniqueStringIDs(nodeIDs)
    .filter((nodeID) => eligibleNodeIDs.has(nodeID))
    .map((resourceID) => ({ resourceType: "node", resourceID }));
}
const summaryShellStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  background: "radial-gradient(circle at 5% 0%, rgba(103,232,249,.13), transparent 28%), radial-gradient(circle at 96% 3%, rgba(196,181,253,.17), transparent 29%), linear-gradient(145deg, #f7f9fc, #edf2f8)",
  color: PROJECT_SUMMARY_SURFACE_TEXT,
  overflow: "hidden",
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
  minHeight: 88,
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 14,
  margin: "14px 14px 0",
  padding: "16px 18px",
  border: "1px solid rgba(255,255,255,.86)",
  borderRadius: 18,
  background: "linear-gradient(145deg, rgba(255,255,255,.96), rgba(239,244,250,.86))",
  boxShadow: "12px 12px 28px rgba(148,163,184,.20), -10px -10px 26px rgba(255,255,255,.92), inset 1px 1px 0 rgba(255,255,255,.96)",
  boxSizing: "border-box",
  flexShrink: 0,
};

const summaryTitleClusterStyle: React.CSSProperties = {
  minWidth: 0,
  flex: "1 1 auto",
  display: "grid",
  gap: 4,
};

const summaryTitleRowStyle: React.CSSProperties = { minWidth: 0, display: "flex", alignItems: "center", gap: 8 };
const summaryTitleIconStyle: React.CSSProperties = { flex: "0 0 auto", display: "inline-flex", alignItems: "center" };

const summaryTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 24,
  lineHeight: 1.1,
  fontWeight: 950,
  color: "#0f172a",
  letterSpacing: "-.025em",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  cursor: "text",
};

const summaryTitleInputStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  flex: "1 1 auto",
  height: 30,
  border: "1px solid rgba(91, 141, 239, 0.34)",
  borderRadius: 7,
  background: "#ffffff",
  color: "#0f172a",
  fontFamily: "inherit",
  fontSize: 22,
  fontWeight: 850,
  letterSpacing: 0,
  outline: "none",
  padding: "0 8px",
  boxSizing: "border-box",
};

const summaryMetaPillsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  gap: 8,
  flexWrap: "wrap",
  justifyContent: "flex-end",
};

const summaryMetaFieldStyle: React.CSSProperties = {
  minWidth: 132,
  maxWidth: 220,
  display: "grid",
  gap: 5,
  padding: "7px 8px",
  border: "1px solid rgba(255,255,255,.78)",
  borderRadius: 12,
  background: "linear-gradient(145deg, rgba(255,255,255,.82), rgba(241,245,249,.72))",
  boxShadow: "inset 1px 1px 0 rgba(255,255,255,.90), 4px 4px 11px rgba(148,163,184,.13), -4px -4px 11px rgba(255,255,255,.78)",
  boxSizing: "border-box",
};

const summaryMetaFieldLabelStyle: React.CSSProperties = {
  color: "#64748b",
  fontSize: 10,
  fontWeight: 900,
  textTransform: "uppercase",
  letterSpacing: 0.2,
};

const assignmentDialogBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1,
  display: "grid",
  placeItems: "center",
  padding: 18,
  background: "rgba(15, 23, 42, 0.28)",
  boxSizing: "border-box",
};

const assignmentDialogStyle: React.CSSProperties = {
  width: "min(760px, 100%)",
  maxHeight: "min(680px, calc(100vh - 36px))",
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr) auto",
  gap: 14,
  padding: 16,
  border: "1px solid rgba(148, 163, 184, 0.28)",
  borderRadius: 10,
  background: "#ffffff",
  boxShadow: "0 24px 60px rgba(15, 23, 42, 0.24)",
  boxSizing: "border-box",
};

const assignmentDialogHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const assignmentDialogTitleStyle: React.CSSProperties = {
  margin: 0,
  color: "#0f172a",
  fontSize: 16,
  fontWeight: 950,
};

const assignmentCloseButtonStyle: React.CSSProperties = {
  minHeight: 30,
  border: "1px solid rgba(148, 163, 184, 0.26)",
  borderRadius: 8,
  background: "#ffffff",
  color: "#475569",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 12,
  fontWeight: 900,
  padding: "0 10px",
};

const assignmentDialogColumnsStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 12,
};

const assignmentSectionStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: 8,
  border: "1px solid rgba(148, 163, 184, 0.22)",
  borderRadius: 8,
  padding: 10,
  background: "#f8fafc",
  boxSizing: "border-box",
};

const assignmentSectionTitleStyle: React.CSSProperties = {
  color: "#334155",
  fontSize: 12,
  fontWeight: 950,
};

const assignmentListStyle: React.CSSProperties = {
  minHeight: 180,
  maxHeight: 380,
  overflow: "auto",
  display: "grid",
  alignContent: "start",
  gap: 6,
};

const assignmentOptionStyle: React.CSSProperties = {
  minHeight: 32,
  display: "grid",
  gridTemplateColumns: "18px minmax(0, 1fr)",
  alignItems: "center",
  gap: 8,
  padding: "0 8px",
  borderRadius: 7,
  background: "#ffffff",
  color: "#334155",
  cursor: "pointer",
  boxSizing: "border-box",
};

const assignmentOptionLabelStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 12,
  fontWeight: 850,
};

const assignmentEmptyStyle: React.CSSProperties = {
  minHeight: 84,
  display: "grid",
  placeItems: "center",
  color: "#64748b",
  fontSize: 12,
  fontWeight: 850,
};

const assignmentDialogActionsStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
};

const assignmentCancelButtonStyle: React.CSSProperties = {
  minHeight: 34,
  border: "1px solid rgba(148, 163, 184, 0.26)",
  borderRadius: 8,
  background: "#ffffff",
  color: "#334155",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 12,
  fontWeight: 900,
  padding: "0 12px",
};

const assignmentSaveButtonStyle: React.CSSProperties = {
  ...assignmentCancelButtonStyle,
  border: "1px solid rgba(37, 99, 235, 0.26)",
  background: "#2563eb",
  color: "#ffffff",
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
  display: "flex",
  alignItems: "stretch",
  gap: 0,
  padding: 14,
  overflow: "hidden",
};

const textColumnStyle = (splitPct: number): React.CSSProperties => ({
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  flex: `0 0 calc(${splitPct}% - 10px)`,
  padding: 12,
  border: "1px solid rgba(255,255,255,.84)",
  borderRadius: 18,
  background: "linear-gradient(145deg, rgba(255,255,255,.90), rgba(240,244,249,.82))",
  boxShadow: "10px 10px 24px rgba(148,163,184,.17), -8px -8px 22px rgba(255,255,255,.86), inset 1px 1px 0 rgba(255,255,255,.92)",
  boxSizing: "border-box",
  overflow: "hidden",
});

const summarySplitHandleStyle: React.CSSProperties = {
  flex: "0 0 10px",
  cursor: "col-resize",
  position: "relative",
  margin: "46px 5px 4px",
  borderRadius: 999,
  background: "linear-gradient(180deg, transparent, rgba(99,102,241,.34), transparent)",
};

const relationshipsColumnStyle = (splitPct: number): React.CSSProperties => ({
  position: "relative",
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  padding: 12,
  border: "1px solid rgba(255,255,255,.84)",
  borderRadius: 18,
  background: "linear-gradient(145deg, rgba(255,255,255,.90), rgba(240,244,249,.82))",
  boxShadow: "10px 10px 24px rgba(148,163,184,.17), -8px -8px 22px rgba(255,255,255,.86), inset 1px 1px 0 rgba(255,255,255,.92)",
  boxSizing: "border-box",
  overflow: "hidden",
  flex: `1 1 calc(${100 - splitPct}% - 10px)`,
});

const columnToolbarStyle: React.CSSProperties = {
  minHeight: 44,
  display: "flex",
  alignItems: "center",
  padding: "2px 2px 10px",
  flexWrap: "wrap",
  alignContent: "center",
  justifyContent: "space-between",
  gap: 10,
  flexShrink: 0,
};

const projectWorkPanelToolbarStyle: React.CSSProperties = {
  ...columnToolbarStyle,
  flexWrap: "wrap",
  alignContent: "center",
  padding: "2px 2px 10px",
};

const projectWorkPanelActionsStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 8,
};

const toolbarActionsStyle: React.CSSProperties = {
  display: "flex",
  minWidth: 0,
  flex: "1 1 520px",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
  justifyContent: "flex-end",
};

const rightPanelTabsStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: 3,
  border: "1px solid rgba(255,255,255,.76)",
  borderRadius: 999,
  background: "linear-gradient(145deg, rgba(226,232,240,.92), rgba(241,245,249,.84))",
  gap: 2,
  boxShadow: "inset 3px 3px 8px rgba(148,163,184,.18), inset -3px -3px 8px rgba(255,255,255,.70)",
};

const rightPanelTabStyle = (active: boolean): React.CSSProperties => ({
  minHeight: 31,
  border: 0,
  borderRadius: 999,
  padding: "0 13px",
  background: active ? "linear-gradient(145deg, #ffffff, #f8fafc)" : "transparent",
  color: active ? "#3730a3" : "#64748b",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 12,
  fontWeight: 950,
  boxShadow: active ? "4px 4px 10px rgba(148,163,184,.17), -3px -3px 9px rgba(255,255,255,.90), inset 1px 1px 0 rgba(255,255,255,.96)" : undefined,
});

const criticalPathPanelStyle: React.CSSProperties = {
  minHeight: 0,
  flex: "1 1 auto",
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: 10,
};

const criticalPathActionsStyle: React.CSSProperties = {
  minHeight: 30,
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
};

const criticalPathAddButtonStyle = (accent: string): React.CSSProperties => ({
  minHeight: 34,
  border: 0,
  borderRadius: 10,
  background: `linear-gradient(135deg, ${accent}, #8b5cf6)`,
  color: "#ffffff",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 12,
  fontWeight: 950,
  padding: "0 14px",
  boxShadow: `0 9px 20px ${accent}32, inset 1px 1px 0 rgba(255,255,255,.34)`,
});

const criticalPathTableStyle: React.CSSProperties = {
  minHeight: 0,
  overflow: "auto",
  display: "grid",
  alignContent: "start",
  border: "1px solid rgba(255,255,255,.82)",
  borderRadius: 14,
  background: "linear-gradient(145deg, rgba(255,255,255,.84), rgba(241,245,249,.72))",
  boxShadow: "inset 3px 3px 9px rgba(148,163,184,.11), inset -3px -3px 9px rgba(255,255,255,.82)",
};

const criticalPathGridColumns = "minmax(130px, 1.15fr) minmax(150px, 1fr) minmax(92px, 0.68fr) 128px minmax(132px, 0.9fr)";

const criticalPathHeaderRowStyle: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 4,
  display: "grid",
  gridTemplateColumns: criticalPathGridColumns,
  minWidth: 760,
  minHeight: 42,
  background: "linear-gradient(180deg, rgba(255,255,255,.97), rgba(241,245,249,.92))",
  borderBottom: "1px solid rgba(148, 163, 184, 0.24)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,.96)",
};

const criticalPathHeaderCellStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "0 10px",
  borderRight: "1px solid rgba(148, 163, 184, 0.18)",
  color: "#475569",
  fontSize: 11,
  fontWeight: 950,
  boxSizing: "border-box",
};

function criticalPathRowStyle(current: boolean, dropActive: boolean, previewOpen = false): React.CSSProperties {
  return {
    position: "relative",
    display: "grid",
    gridTemplateColumns: criticalPathGridColumns,
    minWidth: 760,
    minHeight: 58,
    paddingRight: current ? 160 : 92,
    borderBottom: "1px solid rgba(226, 232, 240, 0.9)",
    background: current
      ? "linear-gradient(90deg, rgba(255, 247, 237, 0.96), rgba(255, 255, 255, 0.94))"
      : previewOpen
        ? "linear-gradient(90deg, rgba(240, 249, 255, 0.98), rgba(255, 255, 255, 0.96))"
      : dropActive
        ? "rgba(239, 246, 255, 0.90)"
        : "rgba(255,255,255,.82)",
    outline: current
      ? "2px solid rgba(249, 115, 22, 0.58)"
      : previewOpen
        ? "2px solid rgba(14, 165, 233, 0.46)"
        : dropActive ? "2px solid rgba(37, 99, 235, 0.28)" : "2px solid transparent",
    outlineOffset: -2,
    boxShadow: previewOpen ? "0 10px 22px rgba(14, 165, 233, 0.12)" : undefined,
    zIndex: previewOpen ? 3 : 1,
    boxSizing: "border-box",
    transition: "background 150ms ease, box-shadow 150ms ease, outline-color 150ms ease",
  };
}

const criticalPathCellStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  padding: "7px 9px",
  borderRight: "1px solid rgba(226, 232, 240, 0.88)",
  boxSizing: "border-box",
};

const criticalPathNameCellStyle: React.CSSProperties = {
  ...criticalPathCellStyle,
  gap: 6,
};

const criticalPathDeleteButtonStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  border: "1px solid rgba(148, 163, 184, 0.24)",
  borderRadius: 6,
  background: "#ffffff",
  color: "#64748b",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 12,
  fontWeight: 900,
  padding: 0,
  flex: "0 0 auto",
};

const criticalPathNameInputStyle: React.CSSProperties = {
  minWidth: 0,
  width: "100%",
  height: 32,
  border: "1px solid transparent",
  borderRadius: 7,
  background: "transparent",
  color: "#0f172a",
  fontFamily: "inherit",
  fontSize: 12,
  fontWeight: 850,
  outline: "none",
  padding: "0 6px",
  boxSizing: "border-box",
};

const criticalPathNodeCellStyle: React.CSSProperties = {
  ...criticalPathCellStyle,
  position: "relative",
};

function criticalPathAddNodeCellButtonStyle(active: boolean): React.CSSProperties {
  return {
    width: "100%",
    minHeight: 32,
    display: "grid",
    placeItems: "center",
    border: active ? "1px solid transparent" : "1px dashed rgba(14, 165, 233, 0.34)",
    borderRadius: 8,
    background: active ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : "#f8fafc",
    color: active ? "#0284c7" : "#64748b",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 11,
    fontWeight: 900,
    padding: "0 10px",
    boxShadow: active ? "4px 4px 10px rgba(174,174,192,0.16), -4px -4px 10px rgba(255,255,255,0.84)" : undefined,
  };
}

function criticalPathLinkedResourceStyle(resourceType: "logic_gate" | "node" | "", selected = false): React.CSSProperties {
  const selectedNode = selected && resourceType === "node";
  return {
    minWidth: 0,
    width: "100%",
    height: 32,
    display: "grid",
    gridTemplateColumns: "20px minmax(0, 1fr)",
    alignItems: "center",
    gap: 7,
    border: selectedNode ? "1px solid transparent" : resourceType === "logic_gate" ? "1px solid rgba(34, 197, 94, 0.34)" : "1px solid rgba(14, 165, 233, 0.28)",
    borderRadius: 8,
    background: selectedNode ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : resourceType === "logic_gate" ? "#f0fdf4" : "#f0f9ff",
    color: "#0f172a",
    cursor: "pointer",
    fontFamily: "inherit",
    padding: "0 8px",
    textAlign: "left",
    boxShadow: selectedNode ? "4px 4px 10px rgba(174,174,192,0.20), -4px -4px 10px rgba(255,255,255,0.88), 0 0 0 4px rgba(14,165,233,0.08)" : undefined,
    transform: selectedNode ? "translateY(-1px)" : undefined,
    boxSizing: "border-box",
  };
}

const criticalPathNodePreviewRowStyle: React.CSSProperties = {
  position: "relative",
  display: "grid",
  gridTemplateColumns: criticalPathGridColumns,
  minWidth: 760,
  borderBottom: "1px solid rgba(186, 230, 253, 0.82)",
  background: "#ffffff",
  zIndex: 2,
};

const criticalPathNodePreviewCellStyle: React.CSSProperties = {
  position: "relative",
  gridColumn: "1 / -1",
  minWidth: 0,
  padding: "0 8px 14px",
  boxSizing: "border-box",
};

const criticalPathNodePickerRowStyle: React.CSSProperties = {
  position: "relative",
  display: "grid",
  gridTemplateColumns: criticalPathGridColumns,
  minWidth: 760,
  borderBottom: "1px solid rgba(186, 230, 253, 0.70)",
  background: "linear-gradient(180deg, rgba(240, 249, 255, 0.66), rgba(248, 250, 252, 0.42))",
  zIndex: 5,
};

const criticalPathNodePickerCellStyle: React.CSSProperties = {
  gridColumn: "1 / -1",
  minWidth: 0,
  padding: "0 12px 14px",
  boxSizing: "border-box",
};

const criticalPathNodePickerSurfaceStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 8,
  border: "1px solid transparent",
  borderRadius: 12,
  background: `${EDITOR_NEU_PANEL_BACKGROUND} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box`,
  padding: 10,
  boxShadow: "9px 10px 22px rgba(174,174,192,0.22), -7px -7px 16px rgba(255,255,255,0.86), inset 1px 1px 0 rgba(255,255,255,0.78)",
};

const criticalPathNodePickerSearchRowStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 8,
};

const criticalPathNodePickerSearchBoxStyle: React.CSSProperties = {
  height: 34,
};

const criticalPathNodePickerCancelButtonStyle: React.CSSProperties = {
  height: 32,
  border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
  borderRadius: 8,
  background: EDITOR_NEU_SURFACE,
  color: "#64748b",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 11,
  fontWeight: 900,
  padding: "0 10px",
  boxShadow: "2px 2px 7px rgba(174,174,192,0.16), -2px -2px 7px rgba(255,255,255,0.78)",
};

const criticalPathNodePickerResultsStyle: React.CSSProperties = {
  minWidth: 0,
  maxHeight: 220,
  overflow: "auto",
  display: "grid",
  alignContent: "start",
  gap: 6,
};

const criticalPathNodePickerEmptyStyle: React.CSSProperties = {
  minHeight: 34,
  display: "flex",
  alignItems: "center",
  color: "rgba(71, 85, 105, 0.78)",
  fontSize: 11,
  fontWeight: 800,
  padding: "0 4px",
};

const criticalPathNodePickerErrorStyle: React.CSSProperties = {
  ...criticalPathNodePickerEmptyStyle,
  color: "#b91c1c",
};

const criticalPathNodePickerResultButtonStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 42,
  display: "grid",
  gridTemplateColumns: "24px minmax(0, 1fr)",
  alignItems: "center",
  gap: 8,
  border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
  borderRadius: 9,
  background: EDITOR_NEU_SURFACE,
  color: PROJECT_SUMMARY_SURFACE_TEXT,
  cursor: "pointer",
  fontFamily: "inherit",
  padding: "7px 9px",
  textAlign: "left",
  boxShadow: "2px 2px 8px rgba(174,174,192,0.12), -2px -2px 8px rgba(255,255,255,0.76)",
};

function criticalPathNodePickerResultIconStyle(accent: string): React.CSSProperties {
  return {
    width: 22,
    height: 22,
    display: "grid",
    placeItems: "center",
    borderRadius: 7,
    color: accent,
    background: "#ffffff",
  };
}

const criticalPathNodePickerResultTextStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 2,
};

const criticalPathNodePickerResultTitleStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 12,
  fontWeight: 900,
};

const criticalPathNodePickerResultPathStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "rgba(71, 85, 105, 0.72)",
  fontSize: 10,
  fontWeight: 800,
};

function criticalPathNodePreviewSurfaceStyle(accent: string): React.CSSProperties {
  return {
    position: "relative",
    minWidth: 0,
    border: "1px solid transparent",
    borderRadius: 10,
    background: `${EDITOR_NEU_PANEL_BACKGROUND} padding-box, linear-gradient(135deg, rgba(255,255,255,0.95), ${accent}) border-box`,
    color: PROJECT_SUMMARY_SURFACE_TEXT,
    overflow: "hidden",
    boxShadow: "8px 10px 22px rgba(174,174,192,0.18), -6px -6px 16px rgba(255,255,255,0.84), inset 1px 1px 0 rgba(255,255,255,0.86)",
    transformOrigin: "top center",
  };
}

const criticalPathNodePreviewEditorFrameStyle: React.CSSProperties = {
  minWidth: 0,
  height: "min(980px, calc(100dvh - 16px))",
  minHeight: "min(500px, calc(100dvh - 16px))",
  overflow: "hidden",
  background: EDITOR_NEU_PANEL_BACKGROUND,
};

const criticalPathNodePreviewActionButtonStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  display: "grid",
  placeItems: "center",
  border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
  borderRadius: 7,
  background: "#ffffff",
  color: "#334155",
  cursor: "pointer",
  padding: 0,
  boxShadow: EDITOR_NEU_SHADOW,
};

function relationshipNodePanelRowStyle(): React.CSSProperties {
  return {
    width: "100%",
    minWidth: 0,
    marginLeft: 0,
    padding: "8px 0 12px",
    boxSizing: "border-box",
  };
}

const projectRelationshipNodeFullscreenBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1,
  background: "rgba(15, 23, 42, 0.18)",
  pointerEvents: "auto",
};

function projectRelationshipNodePanelStyle(accent: string, fullscreen: boolean): React.CSSProperties {
  return {
    ...criticalPathNodePreviewSurfaceStyle(accent),
    position: fullscreen ? "fixed" : "relative",
    zIndex: fullscreen ? 2 : undefined,
    top: fullscreen ? NODE_EDITOR_FULLSCREEN_VERTICAL_INSET_PX : undefined,
    left: fullscreen ? NODE_EDITOR_FULLSCREEN_HORIZONTAL_INSET_PX : undefined,
    width: fullscreen ? `calc(100vw - ${NODE_EDITOR_FULLSCREEN_HORIZONTAL_INSET_PX * 2}px)` : "100%",
    height: fullscreen ? `calc(100vh - ${NODE_EDITOR_FULLSCREEN_VERTICAL_INSET_PX * 2}px)` : undefined,
    maxWidth: fullscreen ? `calc(100vw - ${NODE_EDITOR_FULLSCREEN_HORIZONTAL_INSET_PX * 2}px)` : undefined,
    maxHeight: fullscreen ? `calc(100vh - ${NODE_EDITOR_FULLSCREEN_VERTICAL_INSET_PX * 2}px)` : undefined,
    minWidth: 0,
    minHeight: fullscreen ? 0 : undefined,
    borderRadius: fullscreen ? 14 : 10,
  };
}

function projectRelationshipNodePanelBodyStyle(fullscreen: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    minHeight: fullscreen ? 0 : 360,
    width: "100%",
    height: fullscreen ? "100%" : "min(720px, calc(100dvh - 180px))",
    overflow: "hidden",
    background: EDITOR_NEU_PANEL_BACKGROUND,
  };
}

function criticalPathResourceIconStyle(resourceType: "logic_gate" | "node" | ""): React.CSSProperties {
  return {
    width: 18,
    height: 18,
    display: "grid",
    placeItems: "center",
    color: resourceType === "logic_gate" ? "#16a34a" : "#0284c7",
  };
}

const criticalPathResourceTitleStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 11,
  fontWeight: 900,
};

function criticalPathStatusPillStyle(status: string): React.CSSProperties {
  const normalized = status.toLowerCase();
  const color = normalized.includes("done") || normalized.includes("complete")
    ? { bg: "#ecfdf5", fg: "#047857", border: "rgba(16, 185, 129, 0.25)" }
    : normalized.includes("progress")
      ? { bg: "#eff6ff", fg: "#1d4ed8", border: "rgba(59, 130, 246, 0.24)" }
      : normalized.includes("review") || normalized.includes("verify")
        ? { bg: "#f5f3ff", fg: "#6d28d9", border: "rgba(124, 58, 237, 0.24)" }
        : normalized.includes("block") || normalized.includes("issue")
          ? { bg: "#fef2f2", fg: "#b91c1c", border: "rgba(239, 68, 68, 0.24)" }
          : { bg: "#f8fafc", fg: "#475569", border: "rgba(148, 163, 184, 0.26)" };
  return {
    display: "inline-flex",
    alignItems: "center",
    minHeight: 24,
    maxWidth: "100%",
    border: `1px solid ${color.border}`,
    borderRadius: 999,
    background: color.bg,
    color: color.fg,
    padding: "0 8px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 11,
    fontWeight: 900,
  };
}

const criticalPathDateInputStyle: React.CSSProperties = {
  width: "100%",
  height: 30,
  border: "1px solid rgba(148, 163, 184, 0.26)",
  borderRadius: 7,
  background: "#ffffff",
  color: "#334155",
  fontFamily: "inherit",
  fontSize: 11,
  fontWeight: 800,
  padding: "0 6px",
  boxSizing: "border-box",
};

const criticalPathOwnerCellStyle: React.CSSProperties = {
  ...criticalPathCellStyle,
  borderRight: 0,
};

const criticalPathOwnerSelectStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  height: 30,
  border: "1px solid rgba(148, 163, 184, 0.26)",
  borderRadius: 7,
  background: "#ffffff",
  color: "#334155",
  fontFamily: "inherit",
  fontSize: 11,
  fontWeight: 850,
  padding: "0 6px",
  boxSizing: "border-box",
};

const criticalPathCurrentMarkerStyle: React.CSSProperties = {
  position: "absolute",
  top: "50%",
  right: 8,
  transform: "translateY(-50%)",
  height: 32,
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  border: "1px solid rgba(249, 115, 22, 0.70)",
  borderRadius: 999,
  background: "#fff7ed",
  color: "#c2410c",
  cursor: "grab",
  fontFamily: "inherit",
  fontSize: 11,
  fontWeight: 950,
  padding: "0 10px",
  boxShadow: "0 0 0 4px rgba(249, 115, 22, 0.08), 0 8px 18px rgba(249, 115, 22, 0.16)",
};

const criticalPathCurrentDotStyle: React.CSSProperties = {
  width: 9,
  height: 9,
  borderRadius: 999,
  background: "#f97316",
  boxShadow: "0 0 0 4px rgba(249, 115, 22, 0.18)",
};

const criticalPathSetCurrentButtonStyle: React.CSSProperties = {
  position: "absolute",
  top: "50%",
  right: 8,
  transform: "translateY(-50%)",
  height: 28,
  border: "1px solid rgba(148, 163, 184, 0.22)",
  borderRadius: 999,
  background: "#ffffff",
  color: "#64748b",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 10,
  fontWeight: 900,
  padding: "0 8px",
};

const criticalPathEmptyButtonStyle: React.CSSProperties = {
  minHeight: 96,
  border: "1px dashed rgba(91, 141, 239, 0.42)",
  borderRadius: 8,
  background: "#ffffff",
  color: "#1d4ed8",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 12,
  fontWeight: 900,
  margin: 10,
};

const criticalPulsePlaceholderStyle: React.CSSProperties = {
  width: 84,
  height: 22,
  justifySelf: "end",
};

const criticalPulsePlaceholderCompactStyle: React.CSSProperties = {
  width: 18,
  height: 18,
};

function criticalPulseBadgeStyle(compact: boolean): React.CSSProperties {
  return {
    minWidth: compact ? 18 : 84,
    height: compact ? 18 : 22,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: compact ? 0 : 5,
    border: "1px solid rgba(249, 115, 22, 0.72)",
    borderRadius: 999,
    background: "#fff7ed",
    color: "#c2410c",
    boxShadow: "0 0 0 3px rgba(249, 115, 22, 0.10)",
    justifySelf: "end",
    pointerEvents: "none",
  };
}

const criticalPulseBadgeDotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 999,
  background: "#f97316",
  boxShadow: "0 0 0 4px rgba(249, 115, 22, 0.16)",
};

const criticalPulseBadgeTextStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 950,
  lineHeight: 1,
};

const textBlocksScrollStyle: React.CSSProperties = {
  position: "relative",
  minHeight: 0,
  flex: "1 1 auto",
  overflow: "auto",
  display: "flex",
  overflowAnchor: "none",
  flexDirection: "column",
  gap: 12,
  paddingRight: 4,
};

const projectTimelineHeadingGridStyle = (documentDocked: boolean, documentWidth: number): React.CSSProperties => ({
  minWidth: 0,
  display: "grid",
  gridTemplateColumns: documentDocked
    ? `${documentWidth}px 8px 42px minmax(0, 1fr)`
    : "minmax(0, 1fr) minmax(0, 2fr)",
  gridTemplateRows: "auto",
  flexShrink: 0,
});

const projectTimelineControlRowStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gridTemplateColumns: "42px minmax(0, 1fr)",
  alignItems: "center",
  padding: "0 0 8px",
  overflowX: "auto",
  overflowY: "hidden",
  gridColumn: "1",
  gridRow: "1",
};

const projectTimelineToolbarStyle = (documentDocked: boolean): React.CSSProperties => ({
  ...columnToolbarStyle,
  minWidth: 0,
  justifyContent: "flex-end",
  gridColumn: documentDocked ? "4" : "2",
  gridRow: "1",
});

const projectTimelineControlsStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 7,
};

const projectTimelineControlButtonStyle = (accent: string, active: boolean): React.CSSProperties => ({
  width: 30,
  height: 30,
  display: "grid",
  placeItems: "center",
  border: active ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
  borderRadius: 9,
  background: active ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE,
  color: accent,
  cursor: "pointer",
  fontFamily: "inherit",
  padding: 0,
  boxShadow: EDITOR_NEU_SHADOW,
});

const projectTimelinePlusStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 850,
  lineHeight: 1,
  transform: "translateY(-1px)",
};

const projectEmailCountButtonStyle = (accent: string, active: boolean): React.CSSProperties => ({
  ...projectTimelineControlButtonStyle(accent, active),
  width: "auto",
  minWidth: 48,
  gridTemplateColumns: "auto auto",
  gap: 5,
  padding: "0 8px",
  fontSize: 11,
  fontWeight: 900,
});

const projectHeaderUniversalLinkerStyle: React.CSSProperties = {
  minWidth: 184,
  flex: "1 1 220px",
};

const projectTimelineRowStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gridTemplateColumns: "42px minmax(0, 1fr)",
  gap: 0,
  alignItems: "start",
};

const projectTextBlockCardStyle = (focused: boolean, color = ""): React.CSSProperties => ({
  minWidth: 0,
  border: focused ? "1px solid transparent" : `1px solid ${color || EDITOR_NEU_SOFT_BORDER}`,
  borderLeft: `${color ? 4 : 1}px solid ${color || (focused ? "transparent" : EDITOR_NEU_SOFT_BORDER)}`,
  borderRadius: 14,
  background: color ? "#ffffff" : `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${focused ? EDITOR_NEU_EDGE_FRAME : "linear-gradient(135deg, rgba(255,255,255,0.76), rgba(255,255,255,0.76))"} border-box`,
  overflow: "hidden",
  boxShadow: focused
    ? "8px 8px 20px rgba(174,174,192,0.26), -7px -7px 16px rgba(255,255,255,0.92), 0 0 18px rgba(183,124,255,0.16), inset 1px 1px 0 rgba(255,255,255,0.88)"
    : EDITOR_NEU_SHADOW,
});

const projectTextBlockIconButtonStyle = (accent: string, active: boolean): React.CSSProperties => ({
  width: 26,
  height: 24,
  flex: "0 0 auto",
  borderRadius: 8,
  border: active ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
  background: active ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE,
  color: accent,
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  padding: 0,
  boxShadow: "2px 2px 7px rgba(174,174,192,0.16), -2px -2px 7px rgba(255,255,255,0.78)",
});

const projectColumnResizeHandleStyle: React.CSSProperties = {
  minWidth: 8,
  height: "100%",
  cursor: "col-resize",
  touchAction: "none",
  background: `linear-gradient(90deg, transparent 3px, ${PROJECT_SUMMARY_RULE} 3px, ${PROJECT_SUMMARY_RULE} 5px, transparent 5px)`,
};

const projectEmailPaneWrapStyle: React.CSSProperties = {
  height: "100%",
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "minmax(0, 1fr)",
};

const projectDocumentPaneStyle = (fullscreen: boolean): React.CSSProperties => ({
  minWidth: 0,
  minHeight: 0,
  width: fullscreen ? "auto" : "100%",
  height: fullscreen ? "auto" : "100%",
  maxWidth: "none",
  maxHeight: "none",
  margin: 0,
  padding: 0,
  display: "grid",
  gridTemplateRows: fullscreen ? "auto 38px minmax(0, 1fr)" : "38px minmax(0, 1fr)",
  border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
  borderRadius: fullscreen ? 18 : 10,
  background: EDITOR_NEU_SURFACE,
  overflow: "hidden",
  boxShadow: fullscreen ? "0 28px 80px rgba(15,23,42,0.34)" : EDITOR_NEU_SHADOW,
  boxSizing: "border-box",
  ...(fullscreen ? {
    position: "fixed",
    top: NODE_EDITOR_FULLSCREEN_VERTICAL_INSET_PX,
    right: NODE_EDITOR_FULLSCREEN_HORIZONTAL_INSET_PX,
    bottom: NODE_EDITOR_FULLSCREEN_VERTICAL_INSET_PX,
    left: NODE_EDITOR_FULLSCREEN_HORIZONTAL_INSET_PX,
    zIndex: 1901,
  } : {
    position: "relative",
    inset: "auto",
  }),
});

const projectDocumentPaneHeaderStyle: React.CSSProperties = {
  minWidth: 0,
  height: 38,
  overflowX: "auto",
  overflowY: "hidden",
  borderBottom: `1px solid ${PROJECT_SUMMARY_RULE}`,
  background: PROJECT_TEXTBOX_HEADER_BACKGROUND,
  boxSizing: "border-box",
};

const projectDocumentPaneHeaderContentStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  height: 37,
  display: "grid",
  gridTemplateColumns: "max-content minmax(0, 1fr) 30px",
  alignItems: "center",
  gap: 4,
  padding: "4px 6px",
  boxSizing: "border-box",
};

const projectDocumentPaneTitleStyle: React.CSSProperties = {
  minWidth: "max-content",
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  color: PROJECT_SUMMARY_SURFACE_TEXT,
  fontSize: 12,
  whiteSpace: "nowrap",
};

const projectDocumentPaneActionsStyle: React.CSSProperties = {
  minWidth: 0,
  width: "100%",
  overflow: "visible",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 5,
};

const projectDocumentPaneTrailingActionStyle: React.CSSProperties = {
  width: 30,
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
};

const projectDocumentFullscreenCloseButtonStyle: React.CSSProperties = {
  ...UNIFIED_NODE_SHELL_CLOSE_BUTTON_TEMPLATE_STYLE,
  flex: "0 0 auto",
};

const projectDocumentEditorWrapStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  height: "100%",
  overflow: "hidden",
};

const projectDocumentFullscreenToolbarStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  justifyContent: "flex-end",
  overflowX: "auto",
  padding: "6px 8px",
  borderBottom: `1px solid ${PROJECT_SUMMARY_RULE}`,
};


const relationshipScrollStyle = (dropActive: boolean): React.CSSProperties => ({
  minHeight: 0,
  flex: "1 1 auto",
  overflow: "auto",
  display: "grid",
  alignContent: "start",
  gap: 5,
  padding: "9px 10px 24px",
  border: dropActive ? "1px dashed rgba(99,102,241,.58)" : "1px solid rgba(255,255,255,.78)",
  borderRadius: 14,
  background: dropActive ? "linear-gradient(145deg, rgba(238,242,255,.88), rgba(239,246,255,.76))" : "linear-gradient(145deg, rgba(255,255,255,.76), rgba(241,245,249,.66))",
  boxShadow: "inset 3px 3px 9px rgba(148,163,184,.11), inset -3px -3px 9px rgba(255,255,255,.80)",
});

function relationshipContextMenuStyle(x: number, y: number): React.CSSProperties {
  return {
    position: "fixed",
    left: x,
    top: y,
    zIndex: 90,
    minWidth: 190,
    display: "grid",
    gap: 2,
    padding: 5,
    border: "1px solid rgba(100, 116, 139, 0.24)",
    borderRadius: 8,
    background: "rgba(255, 255, 255, 0.98)",
    boxShadow: "0 14px 34px rgba(15, 23, 42, 0.18)",
    boxSizing: "border-box",
  };
}

const relationshipContextMenuButtonStyle: React.CSSProperties = {
  minHeight: 30,
  width: "100%",
  border: 0,
  borderRadius: 6,
  background: "transparent",
  color: "#334155",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 11,
  fontWeight: 850,
  textAlign: "left",
  padding: "0 9px",
};

const relationshipContextMenuDangerButtonStyle: React.CSSProperties = {
  ...relationshipContextMenuButtonStyle,
  color: "#dc2626",
};

const relationshipGroupListStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  alignContent: "start",
  gap: 2,
};

const relationshipGroupBlockStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  alignContent: "start",
  gap: 1,
};

function relationshipGroupHeaderStyle(depth: number, isLogicGate: boolean): React.CSSProperties {
  const leftOffset = Math.max(0, depth) * 28;
  return {
    width: "calc(100% - " + leftOffset + "px)",
    minWidth: 0,
    minHeight: 36,
    display: "grid",
    gridTemplateColumns: "16px minmax(0, 1fr)",
    alignItems: "center",
    gap: 5,
    marginLeft: leftOffset,
    border: "1px solid rgba(255,255,255,.70)",
    borderRadius: 10,
    background: isLogicGate ? "linear-gradient(90deg, rgba(236,253,245,.88), rgba(255,255,255,.72))" : "linear-gradient(90deg, rgba(241,245,249,.84), rgba(255,255,255,.68))",
    color: "#111827",
    padding: "0 9px 0 5px",
    boxSizing: "border-box",
    boxShadow: "3px 3px 9px rgba(148,163,184,.10), -3px -3px 9px rgba(255,255,255,.70)",
  };
}

const relationshipGroupDisclosureButtonStyle: React.CSSProperties = {
  width: 16,
  height: 26,
  minWidth: 16,
  border: "none",
  background: "transparent",
  color: "rgba(15, 23, 42, 0.62)",
  cursor: "pointer",
  display: "grid",
  placeItems: "center",
  padding: 0,
};

const relationshipGroupDisclosurePlaceholderStyle: React.CSSProperties = {
  width: 16,
  height: 26,
  display: "block",
};

const relationshipGroupResourceButtonStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 30,
  display: "grid",
  gridTemplateColumns: "16px minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 6,
  border: "none",
  background: "transparent",
  color: "#111827",
  font: "inherit",
  padding: 0,
  textAlign: "left",
  cursor: "pointer",
};

const relationshipGroupStaticContentStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 30,
  display: "grid",
  gridTemplateColumns: "16px minmax(0, 1fr)",
  alignItems: "center",
  gap: 6,
};

const relationshipGroupLabelStyle: React.CSSProperties = {
  minWidth: 0,
  color: "#111827",
  fontSize: 13,
  fontWeight: 800,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const relationshipGroupBadgeStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  borderRadius: 4,
  display: "grid",
  placeItems: "center",
  background: "rgba(148, 163, 184, 0.14)",
  color: "#475569",
  fontSize: 9,
  fontWeight: 900,
};

const relationshipRowsStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  alignContent: "start",
};

function relationshipRowLeftOffset(depth: number): number {
  return depth > 0 ? depth * 28 + 20 : 0;
}

function relationshipLogicGateRowStyle(depth: number): React.CSSProperties {
  const leftOffset = relationshipRowLeftOffset(depth);
  return {
    width: "calc(100% - " + leftOffset + "px)",
    minWidth: 0,
    minHeight: 38,
    display: "grid",
    gridTemplateColumns: "16px minmax(0, 1fr) auto",
    alignItems: "center",
    gap: 7,
    marginLeft: leftOffset,
    border: "1px solid rgba(16,185,129,.12)",
    borderRadius: 10,
    background: "linear-gradient(90deg, rgba(236,253,245,.82), rgba(255,255,255,.82))",
    color: "#111827",
    padding: "0 10px",
    boxSizing: "border-box",
    boxShadow: "3px 3px 9px rgba(148,163,184,.09), -3px -3px 9px rgba(255,255,255,.68)",
  };
}

function relationshipNodeRowStyle(depth: number, hovered: boolean, selected: boolean): React.CSSProperties {
  const leftOffset = relationshipRowLeftOffset(depth);
  return {
    width: "calc(100% - " + leftOffset + "px)",
    minWidth: 0,
    minHeight: 40,
    display: "grid",
    gridTemplateColumns: "16px minmax(0, 1fr) 16px auto auto",
    alignItems: "center",
    gap: 6,
    marginLeft: leftOffset,
    border: selected ? "1px solid rgba(99,102,241,.48)" : "1px solid rgba(255,255,255,.72)",
    borderRadius: 10,
    background: selected ? "linear-gradient(90deg, rgba(224,231,255,.94), rgba(239,246,255,.84))" : hovered ? "linear-gradient(90deg, rgba(241,245,249,.94), rgba(255,255,255,.84))" : "rgba(255,255,255,.76)",
    color: "#111827",
    font: "inherit",
    padding: "0 10px",
    textAlign: "left",
    cursor: "pointer",
    boxSizing: "border-box",
    boxShadow: selected ? "0 7px 17px rgba(99,102,241,.12), inset 3px 0 0 #6366f1" : "2px 2px 7px rgba(148,163,184,.08), -2px -2px 7px rgba(255,255,255,.62)",
    userSelect: "none",
    WebkitUserSelect: "none",
    transition: "background 140ms ease, border-color 140ms ease, box-shadow 140ms ease",
  };
}

const relationshipResourceIconStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#38bdf8",
};

const relationshipResourceTitleStyle: React.CSSProperties = {
  minWidth: 0,
  fontSize: 12,
  fontWeight: 700,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  cursor: "pointer",
};

const relationshipNodeEmailIconStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  opacity: 0.78,
};

const nodeStatusDotStyle = (status?: string | null): React.CSSProperties => {
  const normalized = status?.trim().toLowerCase() ?? "";
  const background = normalized.includes("done") || normalized.includes("complete")
    ? "#22c55e"
    : normalized.includes("progress")
      ? "#3b82f6"
      : normalized.includes("review")
        ? "#a855f7"
        : normalized.includes("blocked")
          ? "#ef4444"
          : normalized.includes("pending") || normalized.includes("backlog")
            ? "#d97706"
            : "#64748b";
  return {
    width: 8,
    height: 8,
    borderRadius: 999,
    background,
  };
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
