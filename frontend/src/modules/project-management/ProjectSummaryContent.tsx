import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmActionMenu, confirmMenuPositionFromElement, type ConfirmActionMenuPosition } from "../../app/ConfirmActionMenu.js";
import { buildLogicGateRoute } from "../../app/deepLinkRoutes.js";
import { MinimizeToLineIcon } from "../../app/nodeEditorPopupControls.js";
import { buildContextualNodeRoute, openAppPathInNewTab } from "../../app/resourceLinks.js";
import { requestAppSidebarPin } from "../../app/sidebarPins.js";
import { fetchCurrentUser, readAuthConfig } from "../../auth/cognitoAuth.js";
import { getActiveCompanyID } from "../../auth/currentCompany.js";
import { useCompanyAccounts } from "../accounts/AccountFilterControl.js";
import type { Account } from "../accounts/accountsApi.js";
import { convertTriageMessagesToExplorerTarget, listCompanyUserGroups, listCompanyUsers, type CommunicationsTriageConversionTarget, type CompanyUser, type CompanyUserGroup } from "../communications/communicationsApi.js";
import { EXPLORER_DRAG_MIME, readExplorerDragPayload } from "../company-explorer/companyExplorerDragDrop.js";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../company-explorer/CompanyExplorerIcons.js";
import { CompanyExplorerSearchBox } from "../company-explorer/CompanyExplorerSearchBox.js";
import { fetchCompanyExplorerSearchResults, type CompanyExplorerSearchResult } from "../company-explorer/companyExplorerLazyApi.js";
import { buildCompanyExplorerSearchTreeRows } from "../company-explorer/companyExplorerTreeRows.js";
import type { ExplorerTreeNode } from "../company-explorer/companyExplorerTypes.js";
import { getExplorerDropPayloadItems, getExplorerDropPayloadItemType, type ExplorerDropPayload } from "../company-explorer/treePresentation.js";
import { createRequestJSON } from "../api/requestJSON.js";
import { fileFromDataURL } from "../attachments/attachmentApi.js";
import {
  buildEditorAttachedEmailPayload,
  buildEditorTextBlockChatPayload,
  buildEditorTextBlockContentPayload,
  EDITOR_ATTACHED_EMAIL_TYPE,
  EDITOR_TEXT_BLOCK_CHAT_TYPE,
  EDITOR_TEXT_BLOCK_TYPE,
  listEditorTextBlockProjections,
  parseEditorAttachedEmails,
  parseEditorTextBlockChats,
  parseEditorTextBlockContent,
  type EditorAttachedEmail,
  type EditorChatAttachment,
  type EditorTextBlockChatMessage,
} from "../editor/editorProjection.js";
import { EditorTabBar } from "../editor/EditorTabBar.js";
import { UNIFIED_EDITOR_FORMAT_TOOLBAR_TAB_IDS } from "../editor/editorTabs.js";
import { EditorContent } from "../editor/EditorContent.js";
import { generateStableInformationID } from "../editor/editorTypes.js";
import { UnifiedNodeShell } from "../editor/UnifiedNodeShell.js";
import type { EditorDocumentFormattingController, EditorSelectionInlineFormatState } from "../editor/useEditorDocumentSurfaceHandlers.js";
import {
  AttachedEmailOrganizerPane,
  ChatPane,
  EmailPickerModal,
  NodeTextBlockEditor,
  TextBlockActionsMenu,
  TimelineCell,
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
  TableIcon,
  ChatIcon,
  TEXT_BLOCK_FONT_SIZE,
  uploadEditorAttachment,
  type TextBlockImageDraft,
  type TextBlockSelectionDraft,
} from "../editor/NodeWorkspaceSurfaceShared.js";
import { useEditorPreferences } from "../editor/useEditorPreferences.js";
import { getScopedItemIDs, type CompanyExplorerFolder, type CompanyExplorerFolderItem } from "../folders/companyExplorerFolders.js";
import { UniversalGroupingControls } from "../grouping/UniversalGroupingControls.js";
import { moveLogicGateAssignment } from "../kanban/kanbanApi.js";
import type { LogicGateRecord } from "../logic-gate-map/shared.js";
import type { NodeRecord } from "../node-map/shared.js";
import { EVENT_HOME_TRIAGE_CONVERSION_APPLIED, type HomeTriageConversionAppliedDetail } from "../../pages/home/homeConstants.js";
import { cleanIDList, hasTriageMessageDrag, readTriageMessageDrag } from "../../pages/home/homeUtils.js";
import { EntityPermissionsDialog } from "../permissions/EntityPermissionsDialog.js";
import {
  addProjectInformation,
  deleteProjectManagementLogicGate,
  deleteProjectManagementNode,
  deleteProjectCriticalPathStep,
  createProjectLogicGate,
  createProjectNode,
  deleteProjectProjection,
  deleteProjectRelationship,
  fetchProjectView,
  updateProject,
  upsertProjectCriticalPathStep,
  upsertProjectRelationship,
  type ProjectCriticalPathStep,
  type ProjectHealth,
  type ProjectProjection,
  type ProjectRecord,
  type ProjectRelationshipProjection,
} from "./projectManagementApi.js";
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

type ProjectSummaryContentProps = {
  projectID: string;
  accent: string;
  refreshToken?: number;
  onBack: () => void;
  onNodeOpen?: (nodeID: string) => void;
  onLogicGateOpen?: (logicGateID: string) => void;
  onOpenInNewTab?: () => void;
  onCollapseToTab?: (target: { projectID: string; label: string }) => void;
  workspace?: ProjectSummaryWorkspaceSnapshot;
};

type ProjectTextBlockDraft = {
  id: string;
  title: string;
  document: string;
  attachments: EditorChatAttachment[];
  createdTimestamp: string;
  updatedTimestamp: string;
};

type ProjectSummaryWorkspaceSnapshot = {
  nodeFolders: CompanyExplorerFolder[];
  nodeFolderItems: CompanyExplorerFolderItem[];
  nodes: NodeRecord[];
  logicGateFolders: CompanyExplorerFolder[];
  logicGateFolderItems: CompanyExplorerFolderItem[];
  logicGates: LogicGateRecord[];
};

type ProjectRelationshipDropTarget = {
  resourceType: "logic_gate" | "node";
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

const PROJECT_SUMMARY_SURFACE_TEXT = "#172033";
const PROJECT_SUMMARY_RULE = "rgba(91, 141, 239, 0.24)";
const PROJECT_SUMMARY_SPLIT_MIN = 42;
const PROJECT_SUMMARY_SPLIT_MAX = 74;
const PROJECT_RELATIONSHIP_NODE_DRAG_MIME = "application/x-mangorts-project-relationship-node";
const PROJECT_CRITICAL_STEP_DRAG_MIME = "application/x-mangorts-project-critical-step";
const PROJECT_RELATIONSHIP_GROUPING_STORAGE_KEY = "mangorts-project-relationship-groupings-v1";
const PROJECT_HEALTH_OPTIONS: ProjectHealth[] = ["On Track", "AT RISK", "Off Track"];
function dispatchHomeTriageConversionApplied(detail: HomeTriageConversionAppliedDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<HomeTriageConversionAppliedDetail>(EVENT_HOME_TRIAGE_CONVERSION_APPLIED, { detail }));
}

export const ProjectSummaryContent: React.FC<ProjectSummaryContentProps> = ({
  projectID,
  accent,
  refreshToken = 0,
  onBack,
  onNodeOpen,
  onLogicGateOpen,
  onOpenInNewTab,
  onCollapseToTab,
  workspace,
}) => {
  const companyID = getActiveCompanyID();
  const apiBase = readAuthConfig().apiBase;
  const permissionsRequestJSON = useMemo(() => createRequestJSON(apiBase), [apiBase]);
  const attachmentRequestJSON = useMemo(() => createRequestJSON(apiBase), [apiBase]);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const refreshTokenRef = useRef(refreshToken);
  const relationshipGroupIDsRef = useRef<Set<string>>(new Set());
  const relationshipGroupingSignatureRef = useRef("");
  const projectFormattingControllerRef = useRef<EditorDocumentFormattingController | null>(null);
  const { accounts } = useCompanyAccounts(companyID);
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [projectTitleEditing, setProjectTitleEditing] = useState(false);
  const [projectTitleDraft, setProjectTitleDraft] = useState("");
  const [blocks, setBlocks] = useState<ProjectTextBlockDraft[]>([]);
  const [chatMessages, setChatMessages] = useState<EditorTextBlockChatMessage[]>([]);
  const [attachedEmails, setAttachedEmails] = useState<EditorAttachedEmail[]>([]);
  const [relationships, setRelationships] = useState<ProjectRelationshipProjection[]>([]);
  const [criticalPath, setCriticalPath] = useState<ProjectCriticalPathStep[]>([]);
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([]);
  const [groups, setGroups] = useState<CompanyUserGroup[]>([]);
  const [currentUserID, setCurrentUserID] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingID, setSavingID] = useState("");
  const [error, setError] = useState("");
  const [summarySplitPct, setSummarySplitPct] = useState(58);
  const [splitResizeState, setSplitResizeState] = useState<SummarySplitResizeState | null>(null);
  const [focusedTextBlockID, setFocusedTextBlockID] = useState("");
  const [tableInsertRequests, setTableInsertRequests] = useState<Record<string, number>>({});
  const [openChatBlockIDs, setOpenChatBlockIDs] = useState<Set<string>>(() => new Set());
  const [openEmailBlockIDs, setOpenEmailBlockIDs] = useState<Set<string>>(() => new Set());
  const [activePaneTabs, setActivePaneTabs] = useState<Record<string, "chat" | "email">>({});
  const [chatDrafts, setChatDrafts] = useState<Record<string, string>>({});
  const [chatDraftAttachments, setChatDraftAttachments] = useState<Record<string, EditorChatAttachment[]>>({});
  const [chatReplyTargets, setChatReplyTargets] = useState<Record<string, string>>({});
  const [chatSelectionAnchors, setChatSelectionAnchors] = useState<Record<string, TextBlockSelectionDraft>>({});
  const [activeChatMessageIDs, setActiveChatMessageIDs] = useState<Record<string, string>>({});
  const [chatNavigationRequests, setChatNavigationRequests] = useState<Record<string, { anchorMessageID: string; requestID: number }>>({});
  const [selectedEmailIDsByBlock, setSelectedEmailIDsByBlock] = useState<Record<string, string>>({});
  const [emailPickerBlockID, setEmailPickerBlockID] = useState("");
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [assignmentsOpen, setAssignmentsOpen] = useState(false);
  const [assignmentAccountIDs, setAssignmentAccountIDs] = useState<string[]>([]);
  const [assignmentTeamIDs, setAssignmentTeamIDs] = useState<string[]>([]);
  const [assignmentsSaving, setAssignmentsSaving] = useState(false);
  const [relationshipContextMenu, setRelationshipContextMenu] = useState<RelationshipCanvasContextMenuState | null>(null);
  const [relationshipDeleteConfirmation, setRelationshipDeleteConfirmation] = useState<{ isLogicGate: boolean; resourceIDs: string[]; label: string; position?: ConfirmActionMenuPosition | null } | null>(null);
  const [relationshipDropActive, setRelationshipDropActive] = useState(false);
  const [relationshipGroupings, setRelationshipGroupings] = useState<ProjectRelationshipGroupingSetting[]>(() => (
    DEFAULT_PROJECT_RELATIONSHIP_GROUPINGS.map((grouping) => ({ ...grouping }))
  ));
  const [expandedRelationshipGroupIDs, setExpandedRelationshipGroupIDs] = useState<Set<string>>(() => new Set());
  const [hoveredRelationshipNodeID, setHoveredRelationshipNodeID] = useState("");
  const [selectedRelationshipNodeIDs, setSelectedRelationshipNodeIDs] = useState<Set<string>>(() => new Set());
  const [selectionAnchorRelationshipNodeID, setSelectionAnchorRelationshipNodeID] = useState("");
  const [activeRightPanelTab, setActiveRightPanelTab] = useState<"relationships" | "critical-path">("critical-path");
  const [selectedCriticalPathNode, setSelectedCriticalPathNode] = useState<CriticalPathNodePreviewSelection | null>(null);
  const [projectSelectionFontSize, setProjectSelectionFontSize] = useState(TEXT_BLOCK_FONT_SIZE);
  const [projectInlineFormat, setProjectInlineFormat] = useState<EditorSelectionInlineFormatState>({ bold: false, underline: false });
  const { outlineStyle, setOutlineStyle } = useEditorPreferences(`project-summary-outline-style-v1:${companyID}:${projectID}`);

  const refreshProjectSelectionFormat = useCallback(() => {
    const state = projectFormattingControllerRef.current?.readFormatState();
    if (!state) return;
    setProjectSelectionFontSize(state.fontSize);
    setProjectInlineFormat({ bold: state.bold, underline: state.underline });
  }, []);

  const runProjectFormatCommand = useCallback((command: (controller: EditorDocumentFormattingController) => boolean) => {
    const controller = projectFormattingControllerRef.current;
    if (!controller) return;
    command(controller);
    const state = controller.readFormatState();
    if (!state) return;
    setProjectSelectionFontSize(state.fontSize);
    setProjectInlineFormat({ bold: state.bold, underline: state.underline });
  }, []);

  const loadProject = useCallback(async (options: { showLoading?: boolean } = {}) => {
    const cleanProjectID = projectID.trim();
    if (!companyID || !cleanProjectID) return;
    if (options.showLoading !== false) setLoading(true);
    setError("");
    try {
      const [view, current, users, userGroups] = await Promise.all([
        fetchProjectView(companyID, cleanProjectID),
        fetchCurrentUser().catch(() => null),
        listCompanyUsers(companyID).catch(() => [] as CompanyUser[]),
        listCompanyUserGroups(companyID).catch(() => ({ groups: [] as CompanyUserGroup[], members: [] })),
      ]);
      setProject(view.project);
      setProjectTitleDraft(view.project.name || "");
      setRelationships(view.relationships ?? []);
      setCriticalPath(orderCriticalPathSteps(view.critical_path ?? []));
      setCompanyUsers(users);
      setGroups(userGroups.groups);
      setAssignmentAccountIDs(projectAccountIDs(view.project));
      setAssignmentTeamIDs(projectTeamIDs(view.project));
      setCurrentUserID(current?.user.user_id.trim() ?? "");
      setBlocks(blockDraftsFromProjections(view.projections ?? []));
      setChatMessages(parseEditorTextBlockChats(view.projections ?? []));
      setAttachedEmails(parseEditorAttachedEmails(view.projections ?? []));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load project");
    } finally {
      if (options.showLoading !== false) setLoading(false);
    }
  }, [companyID, projectID]);

  useEffect(() => {
    setLoading(true);
    void loadProject({ showLoading: true });
  }, [loadProject]);

  useEffect(() => {
    setActiveRightPanelTab("critical-path");
  }, [projectID]);

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
  const attachedEmailsByBlockID = useMemo(() => {
    const grouped = new Map<string, EditorAttachedEmail[]>();
    for (const email of attachedEmails) {
      const blockID = email.blockID ?? "";
      const bucket = grouped.get(blockID) ?? [];
      bucket.push(email);
      grouped.set(blockID, bucket);
    }
    return grouped;
  }, [attachedEmails]);
  const currentUserName = useMemo(() => {
    const cleanUserID = currentUserID.trim();
    const user = companyUsers.find((item) => item.user_id.trim() === cleanUserID);
    return user?.display_name?.trim() || user?.email?.trim() || cleanUserID || "Project user";
  }, [companyUsers, currentUserID]);

  const updateBlockDocument = useCallback((blockID: string, document: string) => {
    setBlocks((current) => current.map((block) => block.id === blockID ? { ...block, document } : block));
  }, []);

  const saveTextBlock = useCallback(async (block: ProjectTextBlockDraft, updates: Partial<Pick<ProjectTextBlockDraft, "title" | "document" | "attachments">> = {}) => {
    const nextBlock = {
      ...block,
      ...updates,
    };
    const now = new Date().toISOString();
    setSavingID(block.id);
    setError("");
    try {
      const information = buildEditorTextBlockContentPayload({
        title: nextBlock.title,
        document: nextBlock.document,
        attachments: nextBlock.attachments,
      });
      await addProjectInformation({
        companyID,
        projectID,
        informationID: block.id,
        type: EDITOR_TEXT_BLOCK_TYPE,
        information,
      });
      setBlocks((current) => current.map((item) => item.id === block.id ? { ...item, ...updates, updatedTimestamp: now } : item));
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
      attachments: [],
      createdTimestamp: new Date().toISOString(),
      updatedTimestamp: new Date().toISOString(),
    };
    setBlocks((current) => [nextBlock, ...current]);
    await saveTextBlock(nextBlock);
  }, [saveTextBlock]);

  const removeTextBlock = useCallback(async (blockID: string) => {
    const previous = blocks;
    const previousChatMessages = chatMessages;
    const previousAttachedEmails = attachedEmails;
    const relatedProjectionIDs = [
      ...chatMessages.filter((message) => message.blockID === blockID).map((message) => message.id),
      ...attachedEmails.filter((email) => email.blockID === blockID).map((email) => email.id),
    ];
    setBlocks((current) => current.filter((block) => block.id !== blockID));
    setChatMessages((current) => current.filter((message) => message.blockID !== blockID));
    setAttachedEmails((current) => current.filter((email) => email.blockID !== blockID));
    setError("");
    try {
      await Promise.all([
        deleteProjectProjection({ companyID, projectID, informationID: blockID }),
        ...relatedProjectionIDs.map((informationID) => deleteProjectProjection({ companyID, projectID, informationID })),
      ]);
    } catch (deleteError) {
      setBlocks(previous);
      setChatMessages(previousChatMessages);
      setAttachedEmails(previousAttachedEmails);
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete project text");
    }
  }, [attachedEmails, blocks, chatMessages, companyID, projectID]);

  const addTextBlockAttachments = useCallback(async (block: ProjectTextBlockDraft, files: FileList | File[]) => {
    const incomingFiles = Array.from(files);
    if (incomingFiles.length === 0) return;
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
    const attachments = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    if (attachments.length > 0) {
      const nextAttachments = [...block.attachments, ...attachments];
      setBlocks((current) => current.map((item) => item.id === block.id ? { ...item, attachments: nextAttachments } : item));
      try {
        await saveTextBlock(block, { attachments: nextAttachments });
      } catch (attachmentError) {
        setError(attachmentError instanceof Error ? attachmentError.message : "Failed to save attachment references");
      }
    }
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length > 0) {
      const first = failures[0]?.reason;
      setError(first instanceof Error ? first.message : "Failed to add attachment");
    }
  }, [attachmentRequestJSON, companyID, projectID, saveTextBlock]);

  const submitChatMessage = useCallback(async (blockID: string) => {
    const message = (chatDrafts[blockID] ?? "").trim();
    const attachments = chatDraftAttachments[blockID] ?? [];
    if (!message && attachments.length === 0) return;
    const id = generateStableInformationID();
    const timestamp = new Date().toISOString();
    const selection = chatSelectionAnchors[blockID];
    const parentID = chatReplyTargets[blockID];
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
    };
    setError("");
    try {
      await addProjectInformation({
        companyID,
        projectID,
        informationID: id,
        type: EDITOR_TEXT_BLOCK_CHAT_TYPE,
        information: buildEditorTextBlockChatPayload({
          blockID,
          parentID,
          selectionSource: selection?.source,
          selectionMessageID: selection?.messageID,
          selectionQuote: selection?.quote,
          selectionStart: selection?.startOffset,
          selectionEnd: selection?.endOffset,
          authorID: currentUserID,
          authorName: currentUserName,
          message,
          createdTimestamp: timestamp,
          attachments,
        }),
      });
      setChatMessages((current) => [...current, nextMessage]);
      setChatDrafts((current) => ({ ...current, [blockID]: "" }));
      setChatDraftAttachments((current) => ({ ...current, [blockID]: [] }));
      setChatReplyTargets((current) => omitRecordKey(current, blockID));
      setChatSelectionAnchors((current) => omitRecordKey(current, blockID));
    } catch (chatError) {
      setError(chatError instanceof Error ? chatError.message : "Failed to add chat message");
    }
  }, [chatDraftAttachments, chatDrafts, chatReplyTargets, chatSelectionAnchors, companyID, currentUserID, currentUserName, projectID]);

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
    const file = fileFromDataURL(image.dataURL, "selected-image.png");
    if (!file) {
      setError("Failed to prepare image attachment");
      return;
    }
    try {
      const attachment = await uploadEditorAttachment(file, {
        requestJSON: attachmentRequestJSON,
        companyID,
        resourceType: "project",
        resourceID: projectID,
        sourceKind: "chat_upload",
        relationshipKind: "chat_attachment",
        informationID: image.blockID,
        editorSurface: "project_text_block_image_chat",
      });
      setOpenChatBlockIDs((current) => new Set(current).add(image.blockID));
      setActivePaneTabs((current) => ({ ...current, [image.blockID]: "chat" }));
      setChatDraftAttachments((current) => ({
        ...current,
        [image.blockID]: [...(current[image.blockID] ?? []), attachment],
      }));
    } catch (attachmentError) {
      setError(attachmentError instanceof Error ? attachmentError.message : "Failed to add chat attachment");
    }
  }, [attachmentRequestJSON, companyID, projectID]);

  const attachEmailToBlock = useCallback(async (blockID: string, message: Parameters<typeof messageAttachmentPayload>[0], scope: { sharedInboxID?: string; accountEmail?: string } = {}) => {
    const payload = messageAttachmentPayload(message, scope.sharedInboxID, scope.accountEmail);
    const id = generateStableInformationID();
    const nextEmail: EditorAttachedEmail = {
      id,
      blockID,
      messageID: payload.messageID,
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
        information: buildEditorAttachedEmailPayload({ blockID, ...payload }),
      });
      setAttachedEmails((current) => [nextEmail, ...current.filter((email) => email.messageID !== nextEmail.messageID || email.blockID !== blockID)]);
      setOpenEmailBlockIDs((current) => new Set(current).add(blockID));
      setActivePaneTabs((current) => ({ ...current, [blockID]: "email" }));
      setSelectedEmailIDsByBlock((current) => ({ ...current, [blockID]: payload.messageID }));
      setEmailPickerBlockID("");
    } catch (emailError) {
      setError(emailError instanceof Error ? emailError.message : "Failed to attach email");
    }
  }, [companyID, projectID]);

  const removeAttachedEmail = useCallback(async (emailID: string) => {
    setAttachedEmails((current) => current.filter((email) => email.id !== emailID));
    setError("");
    try {
      await deleteProjectProjection({ companyID, projectID, informationID: emailID });
    } catch (emailError) {
      setError(emailError instanceof Error ? emailError.message : "Failed to remove email");
      await loadProject({ showLoading: false });
    }
  }, [companyID, loadProject, projectID]);

  const addRelationshipTargets = useCallback(async (targets: ProjectRelationshipDropTarget[]): Promise<ProjectRelationshipProjection[]> => {
    const existingByKey = new Map(relationships.map((item) => [`${item.resource_type}:${item.resource_id}`, item]));
    const ensuredRelationships: ProjectRelationshipProjection[] = [];
    const uniqueTargets: ProjectRelationshipDropTarget[] = [];
    const incoming = new Set<string>();
    for (const target of targets) {
      const key = `${target.resourceType}:${target.resourceID}`;
      if (!target.resourceID || incoming.has(key)) continue;
      const existing = existingByKey.get(key);
      if (existing) {
        ensuredRelationships.push(existing);
        incoming.add(key);
        continue;
      }
      incoming.add(key);
      uniqueTargets.push(target);
    }
    if (uniqueTargets.length === 0) return ensuredRelationships;
    setError("");
    try {
      const results = await Promise.all(uniqueTargets.map((target, index) => upsertProjectRelationship({
        companyID,
        projectID,
        resourceType: target.resourceType,
        resourceID: target.resourceID,
        position: relationships.length + index + 1,
      })));
      const nextRelationships = results.map((result) => result.relationship).filter((item): item is ProjectRelationshipProjection => Boolean(item));
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

  const convertTriageMessagesToProject = useCallback(async (
    drag: ReturnType<typeof readTriageMessageDrag>,
    logicGateID = "",
  ) => {
    const messageIDs = cleanIDList(drag.messageIDs);
    if (messageIDs.length === 0) return;
    const dragCompanyID = drag.companyID?.trim() ?? "";
    if (dragCompanyID && dragCompanyID !== companyID) {
      setError("Email drop belongs to another company");
      return;
    }
    const cleanProjectID = projectID.trim();
    const cleanLogicGateID = logicGateID.trim();
    if (!companyID || !cleanProjectID) return;
    const sharedInboxID = drag.sharedInboxID?.trim() || undefined;
    setError("");
    setRelationshipDropActive(false);
    setActiveRightPanelTab("relationships");
    dispatchHomeTriageConversionApplied({ companyID, messageIDs, sharedInboxID });
    try {
      const position = relationships.length + 1;
      const target: CommunicationsTriageConversionTarget = cleanLogicGateID
        ? { mode: "existing_logic_gate", logicGateID: cleanLogicGateID, projectID: cleanProjectID, position }
        : { mode: "project", projectID: cleanProjectID, position };
      const result = await convertTriageMessagesToExplorerTarget({
        companyID,
        sharedInboxID,
        target,
        messageIDs,
        priority: 3,
      });
      const nextRelationships = result.project_relationships ?? [];
      if (nextRelationships.length > 0) {
        setRelationships((current) => mergeProjectRelationships(current, nextRelationships));
      } else {
        await loadProject({ showLoading: false });
      }
      const convertedMessageIDs = cleanIDList(result.deleted_message_ids?.length ? result.deleted_message_ids : messageIDs);
      const savedCards = result.cards ?? [];
      const boardIDs = Array.from(new Set([
        result.board?.board_id ?? "",
        ...savedCards.map((card) => card.board_id),
      ].map((id) => id.trim()).filter(Boolean)));
      dispatchHomeTriageConversionApplied({
        companyID,
        messageIDs: convertedMessageIDs,
        sharedInboxID,
        logicGateID: result.board?.logic_gate_id?.trim() || cleanLogicGateID || undefined,
        nodeIDs: (result.nodes ?? []).map((node) => node.node_id),
        boardIDs,
        cardIDs: savedCards.map((card) => card.card_id),
        unstarredMessageIDs: cleanIDList(result.unstarred_message_ids ?? []),
      });
      const createdNodeID = result.nodes?.[0]?.node_id?.trim() ?? "";
      if (createdNodeID) onNodeOpen?.(createdNodeID);
    } catch (dropError) {
      setError(dropError instanceof Error ? dropError.message : "Email drop failed");
      await loadProject({ showLoading: false });
    }
  }, [companyID, loadProject, onNodeOpen, projectID, relationships.length]);

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

  const saveProjectHealth = useCallback(async (health: ProjectHealth) => {
    if (!project) return;
    const nextHealth = normalizeProjectHealth(health);
    const previous = project;
    setProject({ ...project, health: nextHealth });
    setError("");
    try {
      const result = await updateProject({
        companyID,
        projectID,
        name: project.name || "Untitled Project",
        status: project.status || "Active",
        health: nextHealth,
        accountIDs: projectAccountIDs(project),
        teamIDs: projectTeamIDs(project),
      });
      if (result.project) setProject(result.project);
    } catch (healthError) {
      setProject(previous);
      setError(healthError instanceof Error ? healthError.message : "Failed to update project health");
    }
  }, [companyID, project, projectID]);

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

  const createRelationshipResource = useCallback(async (resourceType: "logic_gate" | "node") => {
    setRelationshipContextMenu(null);
    setError("");
    const targetLogicGateID = relationshipContextMenu?.logicGateID?.trim() ?? "";
    try {
      const result = resourceType === "logic_gate"
        ? await createProjectLogicGate({
          companyID,
          projectID,
          header: "New Logic Gate",
          position: relationships.length + 1,
        })
        : await createProjectNode({
          companyID,
          projectID,
          title: "New Node",
          position: relationships.length + 1,
          logicGateID: targetLogicGateID,
        });
      if (result.relationship) {
        setRelationships((current) => mergeProjectRelationships(current, [result.relationship!]));
      } else {
        await loadProject({ showLoading: false });
      }
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : `Failed to create ${resourceType === "logic_gate" ? "logic gate" : "node"}`);
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
      const label = target.resourceType === "logic_gate" ? "logic gate" : "node";
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
      ? "logic gate"
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
      } else {
        await Promise.all(resourceIDs.map((nodeID) => deleteProjectManagementNode(companyID, nodeID, confirmationDisplayName)));
      }
      setSelectedRelationshipNodeIDs(new Set());
      setSelectionAnchorRelationshipNodeID("");
      await loadProject({ showLoading: false });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : `Failed to delete ${isLogicGate ? "logic gate" : "node"}`);
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
      if (result.project) {
        setProject(result.project);
        setProjectTitleDraft(result.project.name || nextName);
      } else {
        setProject((current) => current ? { ...current, name: nextName } : current);
        setProjectTitleDraft(nextName);
      }
      setProjectTitleEditing(false);
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Failed to rename project");
      setProjectTitleDraft(project.name || "");
      setProjectTitleEditing(false);
    }
  }, [companyID, project, projectID, projectTitleDraft]);

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

  const relationshipTargetsFromTransfer = useCallback((dataTransfer: DataTransfer): ProjectRelationshipDropTarget[] => {
    const payload = readExplorerDragPayload(dataTransfer);
    return resolveProjectRelationshipDropTargets(payload, workspace);
  }, [workspace]);

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
                title={logicGateID ? "Double-click to open logic gate" : undefined}
                style={relationshipResourceTitleStyle}
                onDoubleClick={() => logicGateID && onLogicGateOpen?.(logicGateID)}
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
        return (
          <button
            key={relationship.relationship_id}
            type="button"
            role="row"
            data-project-relationship-row="true"
            draggable={Boolean(nodeID && visibleGateID)}
            style={relationshipNodeRowStyle(depth, hoveredRelationshipNodeID === relationship.relationship_id, selectedRelationshipNodeIDs.has(relationship.relationship_id))}
            onClick={(event) => selectRelationshipNode(relationship.relationship_id, event)}
            onDragStart={(event) => startProjectRelationshipNodeDrag(event, relationship, visibleGateID)}
            onMouseEnter={() => setHoveredRelationshipNodeID(relationship.relationship_id)}
            onMouseLeave={() => setHoveredRelationshipNodeID((current) => current === relationship.relationship_id ? "" : current)}
            onDoubleClick={() => nodeID && onNodeOpen?.(nodeID)}
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
                  title="Double-click to open logic gate"
                  onDoubleClick={() => logicGateID && onLogicGateOpen?.(logicGateID)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && logicGateID) onLogicGateOpen?.(logicGateID);
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

  if (loading) {
    return <div style={summaryLoadingStyle}>Loading</div>;
  }

  return (
    <div style={summaryShellStyle}>
      <div style={summaryHeaderStyle}>
        <button type="button" style={backButtonStyle} onClick={onBack}>{"<"} Projects</button>
        <div style={summaryTitleClusterStyle}>
          <div style={summaryEyebrowStyle}>Project Summary</div>
          {projectTitleEditing ? (
            <input
              autoFocus
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
        <div style={summaryMetaPillsStyle}>
          {onCollapseToTab && (
            <button
              type="button"
              style={summaryMinimizeButtonStyle}
              title="Minimize project"
              aria-label="Minimize project"
              onClick={() => onCollapseToTab({ projectID, label: project?.name || projectID })}
            >
              <MinimizeToLineIcon />
            </button>
          )}
          {onOpenInNewTab && (
            <button type="button" style={summaryPermissionButtonStyle} onClick={onOpenInNewTab}>
              Open in new tab
            </button>
          )}
          <button type="button" style={summaryPermissionButtonStyle} onClick={() => setAssignmentsOpen(true)}>
            Assignments
          </button>
          <button type="button" style={summaryPermissionButtonStyle} onClick={() => setPermissionsOpen(true)}>
            Permissions
          </button>
          <span style={statusPillStyle(accent)}>{project?.status || "Active"}</span>
          <select
            aria-label="Project health"
            value={normalizeProjectHealth(project?.health)}
            style={healthSelectStyle(normalizeProjectHealth(project?.health))}
            onChange={(event) => void saveProjectHealth(event.currentTarget.value as ProjectHealth)}
          >
            {PROJECT_HEALTH_OPTIONS.map((health) => <option key={health} value={health}>{health}</option>)}
          </select>
          {projectAccountLabels(project).map((label) => <span key={`account:${label}`} style={plainPillStyle}>{label}</span>)}
          {projectTeamLabels(project).map((label) => <span key={`team:${label}`} style={plainPillStyle}>{label}</span>)}
        </div>
      </div>
      {permissionsOpen && (
        <EntityPermissionsDialog
          requestJSON={permissionsRequestJSON}
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
      {error ? <div style={summaryErrorStyle}>{error}</div> : null}
      <div ref={bodyRef} style={summaryBodyStyle}>
        <section style={textColumnStyle(summarySplitPct)}>
          <div style={columnToolbarStyle}>
            <div style={columnTitleStyle}>Timeline</div>
            <div style={toolbarActionsStyle}>
              <EditorTabBar
                activeTab="format"
                outlineStyle={outlineStyle}
                accent={accent}
                outlineMenuAccent={accent}
                strokeColor={EDITOR_NEU_SOFT_BORDER}
                surfaceText={PROJECT_SUMMARY_SURFACE_TEXT}
                tabBackground={EDITOR_NEU_SURFACE}
                tabSelectedBackground={EDITOR_NEU_ACTIVE_SURFACE}
                onSelectTab={() => undefined}
                onAdjustSelectionFontSize={(delta) => runProjectFormatCommand((controller) => controller.adjustFontSize(delta))}
                documentFontSize={projectSelectionFontSize}
                onSetSelectionFontSize={(fontSize) => runProjectFormatCommand((controller) => controller.applyFontSizeValue(fontSize))}
                boldActive={projectInlineFormat.bold}
                underlineActive={projectInlineFormat.underline}
                onToggleBold={() => runProjectFormatCommand((controller) => controller.toggleInlineFormat("bold"))}
                onToggleUnderline={() => runProjectFormatCommand((controller) => controller.toggleInlineFormat("underline"))}
                onOutlineStyleFocus={refreshProjectSelectionFormat}
                onOutlineStyleChange={setOutlineStyle}
                onInsertTable={() => {
                  const targetBlockID = focusedTextBlockID || blocks[0]?.id || "";
                  if (!targetBlockID) return;
                  setTableInsertRequests((current) => ({ ...current, [targetBlockID]: (current[targetBlockID] ?? 0) + 1 }));
                }}
                reserveHeaderOffset={false}
                visibleTabIDs={UNIFIED_EDITOR_FORMAT_TOOLBAR_TAB_IDS}
                disabled={!focusedTextBlockID}
              />
            </div>
          </div>
          <div className="kanban-board-scroll" style={textBlocksScrollStyle}>
            <button
              type="button"
              title="Add text box"
              aria-label="Add text box"
              style={projectTimelineAddButtonStyle(accent)}
              onClick={() => void addTextBlock()}
            >
              +
            </button>
            {blocks.map((block, index) => (
              <div key={block.id} style={projectTimelineRowStyle}>
                <TimelineCell accent={accent} muted={false} isLast={index === blocks.length - 1} />
                <div style={projectTextBlockGridStyle(openChatBlockIDs.has(block.id) || openEmailBlockIDs.has(block.id))}>
                  <div style={projectTextBlockCardStyle(focusedTextBlockID === block.id)}>
                    <div style={projectTextBlockHeaderStyle}>
                      <div style={projectTextBlockMetadataStyle}>
                        <span style={projectTextBlockMetadataInnerStyle}>
                          <span title={`Last Updated: ${formatTextBlockMetadataTimestamp(block.updatedTimestamp)}`} style={projectTextBlockMetadataTextStyle}>
                            Last Updated: {formatTextBlockMetadataTimestamp(block.updatedTimestamp)}
                          </span>
                          <span aria-hidden="true" style={projectTextBlockMetadataDividerStyle}>|</span>
                          <span title={`Created: ${formatTextBlockMetadataTimestamp(block.createdTimestamp)}`} style={projectTextBlockMetadataTextStyle}>
                            Created: {formatTextBlockMetadataTimestamp(block.createdTimestamp)}
                          </span>
                          {savingID === block.id ? <span style={savingStyle}>Saving</span> : null}
                        </span>
                      </div>
                      <label
                        title="Add attachment"
                        aria-label="Add attachment"
                        style={projectTextBlockIconButtonStyle(accent, false)}
                      >
                        <PaperclipIcon color={accent} />
                        <input
                          type="file"
                          multiple
                          style={{ display: "none" }}
                          onChange={(event) => {
                            const files = event.currentTarget.files;
                            if (files) void addTextBlockAttachments(block, files);
                            event.currentTarget.value = "";
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        title="Insert table"
                        aria-label="Insert table"
                        onClick={() => setTableInsertRequests((current) => ({ ...current, [block.id]: (current[block.id] ?? 0) + 1 }))}
                        style={projectTextBlockIconButtonStyle(accent, false)}
                      >
                        <TableIcon color={accent} />
                      </button>
                      <button
                        type="button"
                        title={openEmailBlockIDs.has(block.id) ? "Hide email" : "Open email"}
                        aria-label={openEmailBlockIDs.has(block.id) ? "Hide email" : "Open email"}
                        onClick={() => {
                          setOpenEmailBlockIDs((current) => toggleSetValue(current, block.id));
                          setActivePaneTabs((current) => ({ ...current, [block.id]: "email" }));
                        }}
                        style={projectTextBlockIconButtonStyle(accent, openEmailBlockIDs.has(block.id))}
                      >
                        <MailIcon color={accent} />
                      </button>
                      <button
                        type="button"
                        title={openChatBlockIDs.has(block.id) ? "Hide chat" : "Open chat"}
                        aria-label={openChatBlockIDs.has(block.id) ? "Hide chat" : "Open chat"}
                        onClick={() => {
                          setOpenChatBlockIDs((current) => toggleSetValue(current, block.id));
                          setActivePaneTabs((current) => ({ ...current, [block.id]: "chat" }));
                        }}
                        style={projectTextBlockIconButtonStyle(accent, openChatBlockIDs.has(block.id))}
                      >
                        <ChatIcon color={accent} />
                      </button>
                      <TextBlockActionsMenu
                        accent={accent}
                        surfaceText={PROJECT_SUMMARY_SURFACE_TEXT}
                        panelBackground={EDITOR_NEU_PANEL_BACKGROUND}
                        strokeColor={EDITOR_NEU_SOFT_BORDER}
                        onDelete={() => void removeTextBlock(block.id)}
                      />
                    </div>
                    <NodeTextBlockEditor
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
                      contentChanges={[]}
                      chatMessages={chatMessagesByBlockID.get(block.id) ?? []}
                      activeChatAnchorMessageID={activeChatMessageIDs[block.id] ?? ""}
                      chatNavigationRequest={chatNavigationRequests[block.id] ?? null}
                      tableInsertRequestID={tableInsertRequests[block.id] ?? 0}
                      surfaceText={PROJECT_SUMMARY_SURFACE_TEXT}
                      accent={accent}
                      outlineStyle={outlineStyle}
                      indentGuideColor={PROJECT_SUMMARY_RULE}
                      scrollbarTrack="rgba(15, 23, 42, 0.08)"
                      formattingControllerRef={projectFormattingControllerRef}
                      onFocus={() => {
                        setFocusedTextBlockID(block.id);
                        window.setTimeout(refreshProjectSelectionFormat, 0);
                      }}
                      onBlur={() => setFocusedTextBlockID((current) => current === block.id ? "" : current)}
                      onDocumentChange={(document) => updateBlockDocument(block.id, document)}
                      onDocumentFlush={(document) => {
                        updateBlockDocument(block.id, document);
                        void saveTextBlock(block, { document });
                      }}
                      onChangeSeen={() => undefined}
                      onSelectionChatRequest={(selection) => {
                        setChatSelectionAnchors((current) => ({ ...current, [block.id]: selection }));
                        setOpenChatBlockIDs((current) => new Set(current).add(block.id));
                        setActivePaneTabs((current) => ({ ...current, [block.id]: "chat" }));
                      }}
                      onImageChatRequest={(image) => { void addImageChatComment(image); }}
                      onImageNodeRequest={() => undefined}
                      onSelectionFontSizeChange={setProjectSelectionFontSize}
                      onSelectionInlineFormatChange={setProjectInlineFormat}
                    />
                  </div>
                  {(openChatBlockIDs.has(block.id) || openEmailBlockIDs.has(block.id)) ? (
                    <div style={projectSidePaneStyle}>
                      <ChatPane
                        blockID={block.id}
                        editable
                        apiBase={apiBase}
                        companyID={companyID}
                        messages={chatMessagesByBlockID.get(block.id) ?? []}
                        emailPane={
                          <div style={projectEmailPaneWrapStyle}>
                            <div style={projectEmailPaneToolbarStyle}>
                              <button type="button" style={projectEmailAttachButtonStyle} onClick={() => setEmailPickerBlockID(block.id)}>
                                Attach email
                              </button>
                            </div>
                            <AttachedEmailOrganizerPane
                              emails={attachedEmailsByBlockID.get(block.id) ?? []}
                              companyID={companyID}
                              storageKey={`project-summary-email-pane:${companyID}:${projectID}:${block.id}`}
                              editable
                              accent={accent}
                              surfaceText={PROJECT_SUMMARY_SURFACE_TEXT}
                              strokeColor={EDITOR_NEU_SOFT_BORDER}
                              ruleColor={PROJECT_SUMMARY_RULE}
                              selectedMessageID={selectedEmailIDsByBlock[block.id] ?? ""}
                              onSelectMessage={(messageID) => setSelectedEmailIDsByBlock((current) => ({ ...current, [block.id]: messageID }))}
                              onClearSelectedMessage={() => setSelectedEmailIDsByBlock((current) => omitRecordKey(current, block.id))}
                              onRemoveEmail={removeAttachedEmail}
                              onError={setError}
                            />
                          </div>
                        }
                        activeTab={activePaneTabs[block.id] ?? (openEmailBlockIDs.has(block.id) ? "email" : "chat")}
                        selectionAnchor={chatSelectionAnchors[block.id]}
                        draft={chatDrafts[block.id] ?? ""}
                        companyUsers={companyUsers}
                        draftAttachments={chatDraftAttachments[block.id] ?? []}
                        replyTargetID={chatReplyTargets[block.id] ?? ""}
                        heightStorageKey={`project-summary-chat-pane-height:${companyID}:${projectID}:${block.id}`}
                        active={focusedTextBlockID === block.id}
                        currentUserID={currentUserID || "local-user"}
                        activeMessageID={activeChatMessageIDs[block.id] ?? ""}
                        accent={accent}
                        surfaceText={PROJECT_SUMMARY_SURFACE_TEXT}
                        panelBackground={EDITOR_NEU_PANEL_BACKGROUND}
                        strokeColor={EDITOR_NEU_SOFT_BORDER}
                        ruleColor={PROJECT_SUMMARY_RULE}
                        onFocus={() => setFocusedTextBlockID(block.id)}
                        onActiveTabChange={(tab) => {
                          setActivePaneTabs((current) => ({ ...current, [block.id]: tab }));
                          if (tab === "email") setOpenEmailBlockIDs((current) => new Set(current).add(block.id));
                          if (tab === "chat") setOpenChatBlockIDs((current) => new Set(current).add(block.id));
                        }}
                        onDraftChange={(draft) => setChatDrafts((current) => ({ ...current, [block.id]: draft }))}
                        onActivateMessage={(messageID) => setActiveChatMessageIDs((current) => ({ ...current, [block.id]: current[block.id] === messageID ? "" : messageID }))}
                        onNavigateToMessage={(messageID) => setChatNavigationRequests((current) => ({ ...current, [block.id]: { anchorMessageID: messageID, requestID: Date.now() } }))}
                        onReply={(messageID) => setChatReplyTargets((current) => ({ ...current, [block.id]: messageID }))}
                        onDeleteMessage={(messageID) => void deleteChatMessage(messageID)}
                        onClearReply={() => setChatReplyTargets((current) => omitRecordKey(current, block.id))}
                        onClearSelectionAnchor={() => setChatSelectionAnchors((current) => omitRecordKey(current, block.id))}
                        onAttachFiles={(files) => attachChatDraftFiles(block.id, files)}
                        onRemoveDraftAttachment={(attachmentID) => setChatDraftAttachments((current) => ({ ...current, [block.id]: (current[block.id] ?? []).filter((attachment) => attachment.id !== attachmentID) }))}
                        onSubmit={() => void submitChatMessage(block.id)}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
        <div role="separator" aria-orientation="vertical" style={summarySplitHandleStyle} onPointerDown={startSummarySplitResize} />
        <aside style={relationshipsColumnStyle(summarySplitPct)}>
          <div style={projectWorkPanelToolbarStyle}>
            <div role="tablist" aria-label="Project work panel" style={rightPanelTabsStyle}>
              <button
                type="button"
                role="tab"
                aria-selected={activeRightPanelTab === "critical-path"}
                style={rightPanelTabStyle(activeRightPanelTab === "critical-path")}
                onClick={() => setActiveRightPanelTab("critical-path")}
              >
                Critical Path
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeRightPanelTab === "relationships"}
                style={rightPanelTabStyle(activeRightPanelTab === "relationships")}
                onClick={() => setActiveRightPanelTab("relationships")}
              >
                Logic Gates / Nodes
              </button>
            </div>
            {activeRightPanelTab === "relationships" ? (
              <UniversalGroupingControls
                groupings={relationshipGroupings}
                fieldOptions={PROJECT_RELATIONSHIP_GROUPING_FIELDS}
                onChange={updateRelationshipGroupings}
                buttonLabel="Group"
                popoverLabel="Project relationship grouping"
                emptyLabel="Relationships are shown as a flat list"
                accent={accent}
              />
            ) : null}
          </div>
          {activeRightPanelTab === "relationships" ? (
          <div
            className="kanban-board-scroll"
            style={relationshipScrollStyle(relationshipDropActive)}
            onContextMenu={(event) => {
              if (projectRelationshipEventTargetsRow(event.target)) return;
              event.preventDefault();
              event.stopPropagation();
              setRelationshipContextMenu({ x: event.clientX, y: event.clientY });
            }}
            onMouseDown={(event) => {
              if (event.button !== 0 || projectRelationshipEventTargetsRow(event.target)) return;
              setSelectedRelationshipNodeIDs(new Set());
              setSelectionAnchorRelationshipNodeID("");
            }}
            onDragOver={(event) => {
              if (!Array.from(event.dataTransfer.types).includes(EXPLORER_DRAG_MIME) && !hasTriageMessageDrag(event.dataTransfer)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setRelationshipDropActive(true);
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              setRelationshipDropActive(false);
            }}
            onDrop={(event) => {
              const triageMessageDrag = readTriageMessageDrag(event.dataTransfer);
              if (triageMessageDrag.messageIDs.length > 0) {
                event.preventDefault();
                event.stopPropagation();
                void convertTriageMessagesToProject(triageMessageDrag);
                return;
              }
              const targets = relationshipTargetsFromTransfer(event.dataTransfer);
              if (targets.length === 0) return;
              event.preventDefault();
              setRelationshipDropActive(false);
              void addRelationshipTargets(targets);
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
              onLogicGateOpen={onLogicGateOpen}
            />
          )}
          {relationshipContextMenu ? (
            <div
              role="menu"
              style={relationshipContextMenuStyle(relationshipContextMenu.x, relationshipContextMenu.y)}
              onPointerDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
            >
              {!relationshipContextMenu.relationship ? (
                <button type="button" role="menuitem" style={relationshipContextMenuButtonStyle} onClick={() => void createRelationshipResource("logic_gate")}>
                  Create new logic gate
                </button>
              ) : null}
              {!relationshipContextMenu.relationship || relationshipContextMenu.relationship.resourceType === "logic_gate" ? (
                <button type="button" role="menuitem" style={relationshipContextMenuButtonStyle} onClick={() => void createRelationshipResource("node")}>
                  {relationshipContextMenu.logicGateID ? "Create new node in logic gate" : "Create new node"}
                </button>
              ) : null}
              {relationshipContextMenu.relationship ? (
                <button type="button" role="menuitem" style={relationshipContextMenuButtonStyle} onClick={() => openRelationshipResourceInNewTab(relationshipContextMenu.relationship!)}>
                  {relationshipContextMenu.relationship.resourceType === "logic_gate" ? "Open logic gate in new browser tab" : "Open node in new browser tab"}
                </button>
              ) : null}
              {relationshipContextMenu.relationship ? (
                <button type="button" role="menuitem" style={relationshipContextMenuDangerButtonStyle} onClick={() => void removeRelationshipFromProject()}>
                  {relationshipContextMenu.relationship.resourceType === "logic_gate"
                    ? "Remove logic gate from project"
                    : selectedRelationshipNodeIDs.has(relationshipContextMenu.relationship.relationshipID) && selectedRelationshipNodeIDs.size > 1
                      ? `Remove ${selectedRelationshipNodeIDs.size} nodes from project`
                      : "Remove node from project"}
                </button>
              ) : null}
              {relationshipContextMenu.relationship ? (
                <button type="button" role="menuitem" style={relationshipContextMenuDangerButtonStyle} onClick={(event) => requestDeleteRelationshipResource(confirmMenuPositionFromElement(event.currentTarget))}>
                  {relationshipContextMenu.relationship.resourceType === "logic_gate"
                    ? "Delete logic gate"
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
      {emailPickerBlockID ? (
        <EmailPickerModal
          accent={accent}
          surfaceText={PROJECT_SUMMARY_SURFACE_TEXT}
          panelBackground={EDITOR_NEU_PANEL_BACKGROUND}
          strokeColor={EDITOR_NEU_SOFT_BORDER}
          onClose={() => setEmailPickerBlockID("")}
          onAttach={(message, scope) => void attachEmailToBlock(emailPickerBlockID, message, scope)}
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
      createdTimestamp: projection.created_timestamp ?? "",
      updatedTimestamp: projection.updated_timestamp ?? projection.created_timestamp ?? "",
    };
  });
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
  onLogicGateOpen?: (logicGateID: string) => void;
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
    void fetchCompanyExplorerSearchResults(apiBase, companyID, nodePickerSearchText, 20)
      .then((payload) => {
        if (cancelled || nodePickerRequestRef.current !== requestID) return;
        setNodePickerResults(payload.results ?? []);
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
          const status = step.status ?? relationship?.status ?? (resourceType === "logic_gate" ? "Logic Gate" : "");
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
                      title={resourceType === "node" ? "Click to preview node. Click again to collapse. Double-click to open node." : "Open logic gate"}
                      style={criticalPathLinkedResourceStyle(resourceType, nodePreviewSelected)}
                      onClick={() => {
                        if (resourceType === "logic_gate" && logicGateID) onLogicGateOpen?.(logicGateID);
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

function projectAccountLabels(project?: ProjectRecord | null): string[] {
  const labels = (project?.accounts ?? []).map((account) => account.name || account.account_id).filter(Boolean);
  return labels;
}

function projectTeamLabels(project?: ProjectRecord | null): string[] {
  const labels = (project?.teams ?? []).map((team) => team.name || team.group_id).filter(Boolean);
  return labels;
}

function toggleSetValue(current: Set<string>, value: string): Set<string> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function ProjectAssignmentsDialog({
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
    <div style={assignmentDialogBackdropStyle} onPointerDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-assignments-title"
        style={assignmentDialogStyle}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div style={assignmentDialogHeaderStyle}>
          <h3 id="project-assignments-title" style={assignmentDialogTitleStyle}>Project Assignments</h3>
          <button type="button" style={assignmentCloseButtonStyle} onClick={onClose}>Close</button>
        </div>
        <div style={assignmentDialogColumnsStyle}>
          <div style={assignmentSectionStyle}>
            <div style={assignmentSectionTitleStyle}>Accounts</div>
            <div style={assignmentListStyle}>
              {accounts.map((account) => (
                <label key={account.account_id} style={assignmentOptionStyle}>
                  <input
                    type="checkbox"
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
          <button type="button" style={assignmentCancelButtonStyle} onClick={onClose}>Cancel</button>
          <button type="button" style={assignmentSaveButtonStyle} disabled={saving} onClick={onSave}>
            {saving ? "Saving" : "Save Assignments"}
          </button>
        </div>
      </div>
    </div>
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

function resolveProjectRelationshipDropTargets(payload: ExplorerDropPayload | null, workspace?: ProjectSummaryWorkspaceSnapshot): ProjectRelationshipDropTarget[] {
  if (!payload) return [];
  const itemType = getExplorerDropPayloadItemType(payload);
  let targets: ProjectRelationshipDropTarget[] = [];
  if (payload.kind === "batch") {
    if (itemType !== "logic_gate" && itemType !== "node") return [];
    targets = getExplorerDropPayloadItems(payload).map((item) => ({
      resourceType: itemType,
      resourceID: item.itemID,
    }));
    return expandLogicGateRelationshipTargets(targets, workspace);
  }
  if ((payload.itemType === "logic_gate" || payload.itemType === "node") && payload.itemID) {
    return expandLogicGateRelationshipTargets([{ resourceType: payload.itemType, resourceID: payload.itemID }], workspace);
  }
  if (payload.kind !== "folder" || !workspace) return [];
  if (payload.folderKind === "logic_gate") {
    targets = Array.from(getScopedItemIDs({
      folders: workspace.logicGateFolders,
      folderItems: workspace.logicGateFolderItems,
      folderID: payload.folderID ?? "",
      itemType: "logic_gate",
    })).map((resourceID) => ({ resourceType: "logic_gate", resourceID }));
    return expandLogicGateRelationshipTargets(targets, workspace);
  }
  if (payload.folderKind === "node") {
    return Array.from(getScopedItemIDs({
      folders: workspace.nodeFolders,
      folderItems: workspace.nodeFolderItems,
      folderID: payload.folderID ?? "",
      itemType: "node",
    })).map((resourceID) => ({ resourceType: "node", resourceID }));
  }
  return [];
}

function expandLogicGateRelationshipTargets(
  targets: ProjectRelationshipDropTarget[],
  workspace?: ProjectSummaryWorkspaceSnapshot,
): ProjectRelationshipDropTarget[] {
  if (!workspace) return targets;
  const expanded: ProjectRelationshipDropTarget[] = [];
  const seen = new Set<string>();
  const addTarget = (target: ProjectRelationshipDropTarget) => {
    const cleanResourceID = target.resourceID.trim();
    if (!cleanResourceID) return;
    const key = `${target.resourceType}:${cleanResourceID}`;
    if (seen.has(key)) return;
    seen.add(key);
    expanded.push({ resourceType: target.resourceType, resourceID: cleanResourceID });
  };
  for (const target of targets) {
    addTarget(target);
    if (target.resourceType !== "logic_gate") continue;
    const gateID = target.resourceID.trim();
    const childNodes = workspace.nodes
      .filter((node) => (node.logic_gate_ids ?? []).some((logicGateID) => logicGateID.trim() === gateID))
      .sort((left, right) => (
        (left.name || left.node_id).localeCompare(right.name || right.node_id, undefined, { numeric: true, sensitivity: "base" })
        || left.node_id.localeCompare(right.node_id)
      ));
    for (const node of childNodes) {
      addTarget({ resourceType: "node", resourceID: node.node_id });
    }
  }
  return expanded;
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
  cursor: "text",
};

const summaryTitleInputStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
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
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
  justifyContent: "flex-end",
};

const summaryPermissionButtonStyle: React.CSSProperties = {
  minHeight: 30,
  border: "1px solid rgba(91, 141, 239, 0.34)",
  borderRadius: 8,
  background: "#ffffff",
  color: "#1d4ed8",
  fontSize: 12,
  fontWeight: 850,
  cursor: "pointer",
  padding: "0 12px",
};

const summaryMinimizeButtonStyle: React.CSSProperties = {
  ...summaryPermissionButtonStyle,
  width: 32,
  minWidth: 32,
  padding: 0,
  display: "grid",
  placeItems: "center",
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

const assignmentDialogBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 120,
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
};

const textColumnStyle = (splitPct: number): React.CSSProperties => ({
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  flex: `0 0 calc(${splitPct}% - 5px)`,
});

const summarySplitHandleStyle: React.CSSProperties = {
  flex: "0 0 10px",
  cursor: "col-resize",
  position: "relative",
  margin: "40px 8px 0",
  borderRadius: 999,
  background: "linear-gradient(180deg, rgba(148,163,184,0.12), rgba(91,141,239,0.30), rgba(148,163,184,0.12))",
};

const relationshipsColumnStyle = (splitPct: number): React.CSSProperties => ({
  minWidth: 0,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  borderLeft: "1px solid rgba(148, 163, 184, 0.26)",
  paddingLeft: 14,
  flex: `1 1 calc(${100 - splitPct}% - 5px)`,
});

const columnToolbarStyle: React.CSSProperties = {
  minHeight: 40,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  flexShrink: 0,
};

const projectWorkPanelToolbarStyle: React.CSSProperties = {
  ...columnToolbarStyle,
  flexWrap: "wrap",
  alignContent: "center",
  padding: "4px 0",
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

const rightPanelTabsStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: 3,
  borderRadius: 999,
  background: "#e2e8f0",
  gap: 2,
};

const rightPanelTabStyle = (active: boolean): React.CSSProperties => ({
  minHeight: 28,
  border: 0,
  borderRadius: 999,
  padding: "0 11px",
  background: active ? "#ffffff" : "transparent",
  color: active ? "#0f172a" : "#64748b",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 12,
  fontWeight: 900,
});

function healthSelectStyle(health: ProjectHealth): React.CSSProperties {
  const colors = health === "AT RISK"
    ? { background: "#fff7ed", color: "#c2410c", border: "rgba(249, 115, 22, 0.42)" }
    : health === "Off Track"
      ? { background: "#fef2f2", color: "#b91c1c", border: "rgba(239, 68, 68, 0.42)" }
      : { background: "#ecfdf5", color: "#047857", border: "rgba(16, 185, 129, 0.34)" };
  return {
    minHeight: 28,
    border: `1px solid ${colors.border}`,
    borderRadius: 999,
    background: colors.background,
    color: colors.color,
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 12,
    fontWeight: 950,
    padding: "0 28px 0 10px",
    outline: "none",
  };
}

const criticalPathPanelStyle: React.CSSProperties = {
  minHeight: 0,
  flex: "1 1 auto",
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: 8,
};

const criticalPathActionsStyle: React.CSSProperties = {
  minHeight: 30,
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
};

const criticalPathAddButtonStyle = (accent: string): React.CSSProperties => ({
  minHeight: 30,
  border: 0,
  borderRadius: 8,
  background: accent,
  color: "#ffffff",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 12,
  fontWeight: 900,
  padding: "0 11px",
  boxShadow: "0 8px 18px rgba(37, 99, 235, 0.15)",
});

const criticalPathTableStyle: React.CSSProperties = {
  minHeight: 0,
  overflow: "auto",
  display: "grid",
  alignContent: "start",
  border: "1px solid rgba(148, 163, 184, 0.24)",
  borderRadius: 8,
  background: "rgba(255, 255, 255, 0.68)",
};

const criticalPathGridColumns = "minmax(130px, 1.15fr) minmax(150px, 1fr) minmax(92px, 0.68fr) 128px minmax(132px, 0.9fr)";

const criticalPathHeaderRowStyle: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 4,
  display: "grid",
  gridTemplateColumns: criticalPathGridColumns,
  minWidth: 760,
  minHeight: 36,
  background: "#f8fafc",
  borderBottom: "1px solid rgba(148, 163, 184, 0.24)",
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
    minHeight: 54,
    paddingRight: current ? 160 : 92,
    borderBottom: "1px solid rgba(226, 232, 240, 0.9)",
    background: current
      ? "linear-gradient(90deg, rgba(255, 247, 237, 0.96), rgba(255, 255, 255, 0.94))"
      : previewOpen
        ? "linear-gradient(90deg, rgba(240, 249, 255, 0.98), rgba(255, 255, 255, 0.96))"
      : dropActive
        ? "rgba(239, 246, 255, 0.90)"
        : "#ffffff",
    outline: current
      ? "2px solid rgba(249, 115, 22, 0.58)"
      : previewOpen
        ? "2px solid rgba(14, 165, 233, 0.46)"
        : dropActive ? "2px solid rgba(37, 99, 235, 0.28)" : "2px solid transparent",
    outlineOffset: -2,
    boxShadow: previewOpen ? "0 10px 22px rgba(14, 165, 233, 0.12)" : undefined,
    zIndex: previewOpen ? 3 : 1,
    boxSizing: "border-box",
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
  minHeight: 0,
  height: "clamp(500px, 64vh, 820px)",
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
  flexDirection: "column",
  gap: 12,
  paddingRight: 4,
};

const projectTimelineAddButtonStyle = (accent: string): React.CSSProperties => ({
  position: "absolute",
  top: 4,
  left: 3,
  zIndex: 8,
  width: 30,
  height: 30,
  display: "grid",
  placeItems: "center",
  border: "1px solid rgba(91, 141, 239, 0.34)",
  borderRadius: 999,
  background: "#ffffff",
  color: accent,
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 22,
  fontWeight: 850,
  lineHeight: 1,
  padding: "0 0 2px",
  boxShadow: "4px 4px 10px rgba(174,174,192,0.22), -4px -4px 10px rgba(255,255,255,0.90)",
});

const projectTimelineRowStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gridTemplateColumns: "42px minmax(0, 1fr)",
  gap: 0,
  alignItems: "start",
};

const projectTextBlockGridStyle = (sidePaneOpen: boolean): React.CSSProperties => ({
  minWidth: 0,
  display: "grid",
  gridTemplateColumns: sidePaneOpen ? "minmax(0, 1fr) minmax(320px, 34%)" : "minmax(0, 1fr)",
  columnGap: 10,
  rowGap: 8,
  alignItems: "start",
});

const projectTextBlockCardStyle = (focused: boolean): React.CSSProperties => ({
  minWidth: 0,
  border: focused ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
  borderRadius: 14,
  background: `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${focused ? EDITOR_NEU_EDGE_FRAME : "linear-gradient(135deg, rgba(255,255,255,0.76), rgba(255,255,255,0.76))"} border-box`,
  overflow: "hidden",
  boxShadow: focused
    ? "8px 8px 20px rgba(174,174,192,0.26), -7px -7px 16px rgba(255,255,255,0.92), 0 0 18px rgba(183,124,255,0.16), inset 1px 1px 0 rgba(255,255,255,0.88)"
    : EDITOR_NEU_SHADOW,
});

const projectTextBlockHeaderStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 26px minmax(38px, auto) 26px 26px 26px 26px",
  alignItems: "center",
  gap: 6,
  minHeight: 34,
  borderBottom: `1px solid ${PROJECT_SUMMARY_RULE}`,
  padding: "5px 6px 5px 8px",
  background: "linear-gradient(90deg, rgba(255,241,242,0.62), rgba(236,253,245,0.42) 52%, rgba(239,246,255,0.66))",
  overflow: "visible",
};

const projectTextBlockMetadataStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-start",
  gap: 6,
  paddingRight: 6,
  color: PROJECT_SUMMARY_SURFACE_TEXT,
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: 0,
  whiteSpace: "nowrap",
  overflow: "visible",
};

const projectTextBlockMetadataInnerStyle: React.CSSProperties = {
  minWidth: 0,
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  overflow: "hidden",
  opacity: 0.58,
};

const projectTextBlockMetadataTextStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const projectTextBlockMetadataDividerStyle: React.CSSProperties = {
  flex: "0 0 auto",
  opacity: 0.62,
};

const projectTextBlockIconButtonStyle = (accent: string, active: boolean): React.CSSProperties => ({
  width: 26,
  height: 24,
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

const projectSidePaneStyle: React.CSSProperties = {
  minWidth: 0,
  border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
  borderRadius: 14,
  background: EDITOR_NEU_PANEL_BACKGROUND,
  overflow: "hidden",
  boxShadow: EDITOR_NEU_SHADOW,
};

const projectEmailPaneWrapStyle: React.CSSProperties = {
  height: "100%",
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
};

const projectEmailPaneToolbarStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  padding: "6px 7px",
  borderBottom: `1px solid ${PROJECT_SUMMARY_RULE}`,
};

const projectEmailAttachButtonStyle: React.CSSProperties = {
  minHeight: 26,
  border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
  borderRadius: 8,
  background: EDITOR_NEU_SURFACE,
  color: PROJECT_SUMMARY_SURFACE_TEXT,
  fontSize: 11,
  fontWeight: 900,
  cursor: "pointer",
  padding: "0 9px",
  boxShadow: "2px 2px 7px rgba(174,174,192,0.14), -2px -2px 7px rgba(255,255,255,0.78)",
};

const savingStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#64748b",
  fontWeight: 700,
};

const relationshipScrollStyle = (dropActive: boolean): React.CSSProperties => ({
  minHeight: 0,
  flex: "1 1 auto",
  overflow: "auto",
  display: "grid",
  alignContent: "start",
  gap: 2,
  padding: "6px 10px 24px 2px",
  border: dropActive ? "1px dashed rgba(91, 141, 239, 0.58)" : "1px dashed rgba(148, 163, 184, 0.34)",
  borderRadius: 8,
  background: dropActive ? "rgba(239, 246, 255, 0.76)" : "rgba(255, 255, 255, 0.54)",
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
    minHeight: 32,
    display: "grid",
    gridTemplateColumns: "16px minmax(0, 1fr)",
    alignItems: "center",
    gap: 5,
    marginLeft: leftOffset,
    borderBottom: "1px solid rgba(148, 163, 184, 0.25)",
    background: isLogicGate ? "rgba(240, 253, 244, 0.48)" : "transparent",
    color: "#111827",
    padding: "0 8px 0 3px",
    boxSizing: "border-box",
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
    minHeight: 34,
    display: "grid",
    gridTemplateColumns: "16px minmax(0, 1fr) auto",
    alignItems: "center",
    gap: 7,
    marginLeft: leftOffset,
    borderBottom: "1px solid rgba(148, 163, 184, 0.24)",
    background: "rgba(255, 255, 255, 0.78)",
    color: "#111827",
    padding: "0 8px",
    boxSizing: "border-box",
  };
}

function relationshipNodeRowStyle(depth: number, hovered: boolean, selected: boolean): React.CSSProperties {
  const leftOffset = relationshipRowLeftOffset(depth);
  return {
    width: "calc(100% - " + leftOffset + "px)",
    minWidth: 0,
    minHeight: 36,
    display: "grid",
    gridTemplateColumns: "16px minmax(0, 1fr) 16px auto auto",
    alignItems: "center",
    gap: 6,
    marginLeft: leftOffset,
    border: selected ? "1px solid rgba(37, 99, 235, 0.55)" : "1px solid transparent",
    borderBottom: "1px solid rgba(148, 163, 184, 0.26)",
    borderRadius: selected ? 5 : 0,
    background: selected ? "rgba(37, 99, 235, 0.08)" : hovered ? "rgba(15, 23, 42, 0.035)" : "#ffffff",
    color: "#111827",
    font: "inherit",
    padding: "0 8px",
    textAlign: "left",
    cursor: "pointer",
    boxSizing: "border-box",
    userSelect: "none",
    WebkitUserSelect: "none",
    transition: "background 120ms ease, border-color 120ms ease",
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
