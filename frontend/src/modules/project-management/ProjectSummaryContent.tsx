import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchCurrentUser, readAuthConfig } from "../../auth/cognitoAuth.js";
import { getActiveCompanyID } from "../../auth/currentCompany.js";
import { useCompanyAccounts } from "../accounts/AccountFilterControl.js";
import type { Account } from "../accounts/accountsApi.js";
import { listCompanyUserGroups, listCompanyUsers, type CompanyUser, type CompanyUserGroup } from "../communications/communicationsApi.js";
import { EXPLORER_DRAG_MIME, readExplorerDragPayload } from "../company-explorer/companyExplorerDragDrop.js";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../company-explorer/CompanyExplorerIcons.js";
import { getExplorerDropPayloadItems, getExplorerDropPayloadItemType, type ExplorerDropPayload } from "../company-explorer/treePresentation.js";
import { createRequestJSON } from "../api/requestJSON.js";
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
import { generateStableInformationID } from "../editor/editorTypes.js";
import {
  AttachedEmailOrganizerPane,
  ChatPane,
  EmailPickerModal,
  NodeTextBlockEditor,
  TextBlockActionsMenu,
  TimelineCell,
} from "../editor/NodeWorkspaceSurfaceParts.js";
import {
  CHAT_ATTACHMENT_MAX_BYTES,
  EDITOR_NEU_ACTIVE_SURFACE,
  EDITOR_NEU_EDGE_FRAME,
  EDITOR_NEU_PANEL_BACKGROUND,
  EDITOR_NEU_SHADOW,
  EDITOR_NEU_SOFT_BORDER,
  EDITOR_NEU_SURFACE,
  formatFileSize,
  MailIcon,
  messageAttachmentPayload,
  PaperclipIcon,
  readChatAttachment,
  TableIcon,
  ChatIcon,
  type TextBlockSelectionDraft,
} from "../editor/NodeWorkspaceSurfaceShared.js";
import { useEditorPreferences } from "../editor/useEditorPreferences.js";
import { getScopedItemIDs, type CompanyExplorerFolder, type CompanyExplorerFolderItem } from "../folders/companyExplorerFolders.js";
import { moveLogicGateAssignment } from "../kanban/kanbanApi.js";
import type { LogicGateRecord } from "../logic-gate-map/shared.js";
import type { NodeRecord } from "../node-map/shared.js";
import { EntityPermissionsDialog } from "../permissions/EntityPermissionsDialog.js";
import {
  addProjectInformation,
  createProjectLogicGate,
  createProjectNode,
  deleteProjectProjection,
  fetchProjectView,
  updateProject,
  upsertProjectRelationship,
  type ProjectProjection,
  type ProjectRecord,
  type ProjectRelationshipProjection,
} from "./projectManagementApi.js";

type ProjectSummaryContentProps = {
  projectID: string;
  accent: string;
  refreshToken?: number;
  onBack: () => void;
  onNodeOpen?: (nodeID: string) => void;
  onLogicGateOpen?: (logicGateID: string) => void;
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

type ProjectRelationshipGroup = {
  gate: ProjectRelationshipProjection;
  nodes: ProjectRelationshipProjection[];
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
};

type ProjectRelationshipNodeDragPayload = {
  nodeID: string;
  fromLogicGateID?: string;
  status?: string | null;
};

type SummarySplitResizeState = {
  left: number;
  width: number;
};

const PROJECT_SUMMARY_SURFACE_TEXT = "#172033";
const PROJECT_SUMMARY_RULE = "rgba(91, 141, 239, 0.24)";
const PROJECT_SUMMARY_SPLIT_MIN = 42;
const PROJECT_SUMMARY_SPLIT_MAX = 74;
const PROJECT_RELATIONSHIP_NODE_DRAG_MIME = "application/x-mangorts-project-relationship-node";

export const ProjectSummaryContent: React.FC<ProjectSummaryContentProps> = ({
  projectID,
  accent,
  refreshToken = 0,
  onBack,
  onNodeOpen,
  onLogicGateOpen,
  workspace,
}) => {
  const companyID = getActiveCompanyID();
  const permissionsRequestJSON = useMemo(() => createRequestJSON(readAuthConfig().apiBase), []);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const refreshTokenRef = useRef(refreshToken);
  const { accounts } = useCompanyAccounts(companyID);
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [projectTitleEditing, setProjectTitleEditing] = useState(false);
  const [projectTitleDraft, setProjectTitleDraft] = useState("");
  const [blocks, setBlocks] = useState<ProjectTextBlockDraft[]>([]);
  const [chatMessages, setChatMessages] = useState<EditorTextBlockChatMessage[]>([]);
  const [attachedEmails, setAttachedEmails] = useState<EditorAttachedEmail[]>([]);
  const [relationships, setRelationships] = useState<ProjectRelationshipProjection[]>([]);
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
  const [relationshipDropActive, setRelationshipDropActive] = useState(false);
  const [collapsedGateRelationshipIDs, setCollapsedGateRelationshipIDs] = useState<Set<string>>(() => new Set());
  const [hoveredRelationshipNodeID, setHoveredRelationshipNodeID] = useState("");
  const { outlineStyle, setOutlineStyle } = useEditorPreferences(`project-summary-outline-style-v1:${companyID}:${projectID}`);

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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", close, true);
    };
  }, [relationshipContextMenu]);

  const relationshipGroups = useMemo(() => buildRelationshipGroups(relationships), [relationships]);
  const ungroupedNodes = useMemo(() => {
    const groupedNodeIDs = new Set(relationshipGroups.flatMap((group) => group.nodes.map((node) => node.relationship_id)));
    return relationships
      .filter((item) => item.resource_type === "node" && !groupedNodeIDs.has(item.relationship_id))
      .sort(compareRelationshipProjection);
  }, [relationshipGroups, relationships]);
  const chatMessagesByBlockID = useMemo(() => {
    const grouped = new Map<string, EditorTextBlockChatMessage[]>();
    for (const message of chatMessages) {
      const bucket = grouped.get(message.blockID) ?? [];
      bucket.push(message);
      grouped.set(message.blockID, bucket);
    }
    return grouped;
  }, [chatMessages]);
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
    const acceptedFiles = incomingFiles.filter((file) => {
      if (file.size <= CHAT_ATTACHMENT_MAX_BYTES) return true;
      setError(`${file.name} is larger than ${formatFileSize(CHAT_ATTACHMENT_MAX_BYTES)}.`);
      return false;
    });
    if (acceptedFiles.length === 0) return;
    try {
      const attachments = await Promise.all(acceptedFiles.map((file) => readChatAttachment(file)));
      const nextAttachments = [...block.attachments, ...attachments];
      setBlocks((current) => current.map((item) => item.id === block.id ? { ...item, attachments: nextAttachments } : item));
      await saveTextBlock(block, { attachments: nextAttachments });
    } catch (attachmentError) {
      setError(attachmentError instanceof Error ? attachmentError.message : "Failed to add attachment");
    }
  }, [saveTextBlock]);

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

  const attachChatDraftFiles = useCallback((blockID: string, files: FileList | File[]) => {
    const incomingFiles = Array.from(files);
    if (incomingFiles.length === 0) return;
    void Promise.all(incomingFiles.map((file) => readChatAttachment(file)))
      .then((attachments) => {
        setChatDraftAttachments((current) => ({ ...current, [blockID]: [...(current[blockID] ?? []), ...attachments] }));
      })
      .catch((attachmentError) => {
        setError(attachmentError instanceof Error ? attachmentError.message : "Failed to add chat attachment");
      });
  }, []);

  const attachEmailToBlock = useCallback(async (blockID: string, message: Parameters<typeof messageAttachmentPayload>[0]) => {
    const payload = messageAttachmentPayload(message);
    const id = generateStableInformationID();
    const nextEmail: EditorAttachedEmail = {
      id,
      blockID,
      messageID: payload.messageID,
      threadID: payload.threadID,
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

  const addRelationshipTargets = useCallback(async (targets: ProjectRelationshipDropTarget[]) => {
    const existing = new Set(relationships.map((item) => `${item.resource_type}:${item.resource_id}`));
    const uniqueTargets: ProjectRelationshipDropTarget[] = [];
    const incoming = new Set<string>();
    for (const target of targets) {
      const key = `${target.resourceType}:${target.resourceID}`;
      if (!target.resourceID || existing.has(key) || incoming.has(key)) continue;
      incoming.add(key);
      uniqueTargets.push(target);
    }
    if (uniqueTargets.length === 0) return;
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
    } catch (relationshipError) {
      setError(relationshipError instanceof Error ? relationshipError.message : "Failed to add relationships");
    }
  }, [companyID, loadProject, projectID, relationships]);

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

  const toggleGateCollapsed = useCallback((relationshipID: string) => {
    setCollapsedGateRelationshipIDs((current) => {
      const next = new Set(current);
      if (next.has(relationshipID)) next.delete(relationshipID);
      else next.add(relationshipID);
      return next;
    });
  }, []);

  const startSummarySplitResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = bodyRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    setSplitResizeState({ left: rect.left, width: rect.width });
  };

  if (loading) {
    return <div style={summaryLoadingStyle}>Loading</div>;
  }

  return (
    <div style={summaryShellStyle}>
      <div style={summaryHeaderStyle}>
        <button type="button" style={backButtonStyle} onClick={onBack}>{"<"} Project Management</button>
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
          <button type="button" style={summaryPermissionButtonStyle} onClick={() => setAssignmentsOpen(true)}>
            Assignments
          </button>
          <button type="button" style={summaryPermissionButtonStyle} onClick={() => setPermissionsOpen(true)}>
            Permissions
          </button>
          <span style={statusPillStyle(accent)}>{project?.status || "Active"}</span>
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
                      editable
                      nodeID={`project:${projectID}`}
                      companyID={companyID}
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
                      onFocus={() => setFocusedTextBlockID(block.id)}
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
                      onImageChatRequest={() => {
                        setOpenChatBlockIDs((current) => new Set(current).add(block.id));
                        setActivePaneTabs((current) => ({ ...current, [block.id]: "chat" }));
                      }}
                      onImageNodeRequest={() => undefined}
                    />
                  </div>
                  {(openChatBlockIDs.has(block.id) || openEmailBlockIDs.has(block.id)) ? (
                    <div style={projectSidePaneStyle}>
                      <ChatPane
                        blockID={block.id}
                        editable
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
                        onAttachFiles={(files) => attachChatDraftFiles(block.id, files)}
                        onRemoveDraftAttachment={(attachmentID) => setChatDraftAttachments((current) => ({ ...current, [block.id]: (current[block.id] ?? []).filter((attachment) => attachment.id !== attachmentID) }))}
                        onSubmit={() => void submitChatMessage(block.id)}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
            {blocks.length === 0 ? (
              <button type="button" style={emptyTextButtonStyle} onClick={() => void addTextBlock()}>
                New Text Box
              </button>
            ) : null}
          </div>
        </section>
        <div role="separator" aria-orientation="vertical" style={summarySplitHandleStyle} onPointerDown={startSummarySplitResize} />
        <aside style={relationshipsColumnStyle(summarySplitPct)}>
          <div style={columnToolbarStyle}>
            <div style={columnTitleStyle}>Logic Gates / Nodes</div>
          </div>
          <div
            className="kanban-board-scroll"
            style={relationshipScrollStyle(relationshipDropActive)}
            onContextMenu={(event) => {
              if (event.target !== event.currentTarget) return;
              event.preventDefault();
              event.stopPropagation();
              setRelationshipContextMenu({ x: event.clientX, y: event.clientY });
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
              const targets = relationshipTargetsFromTransfer(event.dataTransfer);
              if (targets.length === 0) return;
              event.preventDefault();
              setRelationshipDropActive(false);
              void addRelationshipTargets(targets);
            }}
          >
            {relationshipGroups.map((group) => {
              const collapsed = collapsedGateRelationshipIDs.has(group.gate.relationship_id);
              const gateLogicGateID = group.gate.logic_gate_id?.trim() ?? "";
              return (
                <div
                  key={group.gate.relationship_id}
                  style={gateGroupStyle(collapsed)}
                  onContextMenu={(event) => {
                    if (!gateLogicGateID) return;
                    event.preventDefault();
                    event.stopPropagation();
                    setRelationshipContextMenu({ x: event.clientX, y: event.clientY, logicGateID: gateLogicGateID });
                  }}
                  onDragOver={(event) => {
                    if (!Array.from(event.dataTransfer.types).includes(PROJECT_RELATIONSHIP_NODE_DRAG_MIME)) return;
                    event.preventDefault();
                    event.stopPropagation();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => {
                    if (!gateLogicGateID) return;
                    const payload = readProjectRelationshipNodeDragPayload(event.dataTransfer);
                    if (!payload) return;
                    event.preventDefault();
                    event.stopPropagation();
                    void moveRelationshipNodeToGate(payload, gateLogicGateID, group.nodes.length + 1);
                  }}
                >
                  <div style={logicGateCardHeaderStyle}>
                    <span style={logicGateIconBadgeStyle}><ExplorerRowIcon kind="logic_gate" /></span>
                    <span
                      title={group.gate.logic_gate_id ? "Double-click to open logic gate" : undefined}
                      style={logicGateCardTitleStyle}
                      onDoubleClick={() => group.gate.logic_gate_id && onLogicGateOpen?.(group.gate.logic_gate_id)}
                    >
                      {group.gate.display_title}
                    </span>
                    <button
                      type="button"
                      aria-label={collapsed ? "Expand logic gate" : "Collapse logic gate"}
                      aria-expanded={!collapsed}
                      title={collapsed ? "Expand logic gate" : "Collapse logic gate"}
                      style={logicGateDisclosureButtonStyle}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleGateCollapsed(group.gate.relationship_id);
                      }}
                      onDoubleClick={(event) => event.stopPropagation()}
                    >
                      <ExplorerDisclosureIcon open={!collapsed} color="rgba(15, 23, 42, 0.62)" />
                    </button>
                  </div>
                  {!collapsed ? (
                    <div style={logicGateNodeListStyle}>
                      {group.nodes.map((node) => (
                        <button
                          key={node.relationship_id}
                          type="button"
                          draggable={Boolean(node.node_id || node.resource_id)}
                          style={logicGateNodeRowStyle(hoveredRelationshipNodeID === node.relationship_id)}
                          onDragStart={(event) => startProjectRelationshipNodeDrag(event, node, gateLogicGateID)}
                          onMouseEnter={() => setHoveredRelationshipNodeID(node.relationship_id)}
                          onMouseLeave={() => setHoveredRelationshipNodeID((current) => current === node.relationship_id ? "" : current)}
                          onDoubleClick={() => node.node_id && onNodeOpen?.(node.node_id)}
                        >
                          <span style={relationshipNodeIconStyle}><ExplorerRowIcon kind="node" /></span>
                          <span style={relationshipNodeTitleStyle}>{node.display_title}</span>
                          {node.status ? <span style={nodeStatusDotStyle(node.status_color)} /> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {ungroupedNodes.length > 0 ? (
              <div style={gateGroupStyle(false)}>
                <div style={ungroupedHeaderStyle}>Nodes</div>
                {ungroupedNodes.map((node) => (
                  <button
                    key={node.relationship_id}
                    type="button"
                    style={logicGateNodeRowStyle(hoveredRelationshipNodeID === node.relationship_id)}
                    onMouseEnter={() => setHoveredRelationshipNodeID(node.relationship_id)}
                    onMouseLeave={() => setHoveredRelationshipNodeID((current) => current === node.relationship_id ? "" : current)}
                    onDoubleClick={() => node.node_id && onNodeOpen?.(node.node_id)}
                  >
                    <span style={relationshipNodeIconStyle}><ExplorerRowIcon kind="node" /></span>
                    <span style={relationshipNodeTitleStyle}>{node.display_title}</span>
                    {node.status ? <span style={nodeStatusDotStyle(node.status_color)} /> : null}
                  </button>
                ))}
              </div>
            ) : null}
            {relationshipGroups.length === 0 && ungroupedNodes.length === 0 ? (
              <div style={emptyRelationshipStyle}>No relationships</div>
            ) : null}
          </div>
          {relationshipContextMenu ? (
            <div
              role="menu"
              style={relationshipContextMenuStyle(relationshipContextMenu.x, relationshipContextMenu.y)}
              onPointerDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
            >
              {relationshipContextMenu.logicGateID ? null : (
                <button type="button" role="menuitem" style={relationshipContextMenuButtonStyle} onClick={() => void createRelationshipResource("logic_gate")}>
                  Create new logic gate
                </button>
              )}
              <button type="button" role="menuitem" style={relationshipContextMenuButtonStyle} onClick={() => void createRelationshipResource("node")}>
                {relationshipContextMenu.logicGateID ? "Create new node in logic gate" : "Create new node"}
              </button>
            </div>
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
          onAttach={(message) => void attachEmailToBlock(emailPickerBlockID, message)}
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
        (left.title || left.node_id).localeCompare(right.title || right.node_id, undefined, { numeric: true, sensitivity: "base" })
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

const emptyTextButtonStyle: React.CSSProperties = {
  minHeight: 120,
  border: "1px dashed rgba(91, 141, 239, 0.45)",
  borderRadius: 8,
  background: "#ffffff",
  color: "#1d4ed8",
  fontWeight: 850,
  cursor: "pointer",
};

const relationshipScrollStyle = (dropActive: boolean): React.CSSProperties => ({
  minHeight: 0,
  flex: "1 1 auto",
  overflow: "auto",
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(170px, 1fr))",
  gridAutoRows: "auto",
  alignContent: "start",
  gap: 12,
  padding: 12,
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

const gateGroupStyle = (collapsed: boolean): React.CSSProperties => ({
  display: "flex",
  flexDirection: "column",
  gap: collapsed ? 0 : 10,
  minWidth: 0,
  minHeight: collapsed ? 52 : 190,
  border: "1px solid rgba(226, 232, 240, 0.92)",
  borderRadius: 8,
  background: "#ffffff",
  color: "#0f172a",
  padding: collapsed ? "10px 12px" : 12,
  boxShadow: "0 8px 18px rgba(15, 23, 42, 0.05)",
  alignSelf: "start",
});

const logicGateCardHeaderStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 40,
  display: "grid",
  gridTemplateColumns: "28px minmax(0, 1fr) 42px",
  alignItems: "center",
  gap: 8,
  padding: 0,
  textAlign: "left",
  cursor: "default",
};

const logicGateIconBadgeStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 7,
  border: "1px solid rgba(34, 197, 94, 0.68)",
  background: "#f0fdf4",
  color: "#16a34a",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const logicGateCardTitleStyle: React.CSSProperties = {
  minWidth: 0,
  color: "#0f172a",
  fontSize: 12,
  lineHeight: 1.2,
  fontWeight: 850,
  cursor: "pointer",
  overflow: "hidden",
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
};

const logicGateDisclosureButtonStyle: React.CSSProperties = {
  width: 42,
  height: 40,
  border: "none",
  borderRadius: 8,
  background: "transparent",
  color: "rgba(15, 23, 42, 0.62)",
  cursor: "pointer",
  display: "grid",
  placeItems: "center",
  padding: 0,
  justifySelf: "end",
};

const logicGateNodeListStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  paddingTop: 2,
  minWidth: 0,
};

const logicGateNodeRowStyle = (hovered: boolean): React.CSSProperties => ({
  minHeight: 24,
  minWidth: 0,
  border: `1px solid ${hovered ? "#19a8ff" : "transparent"}`,
  borderRadius: 6,
  background: hovered ? "#f8fbff" : "rgba(255, 255, 255, 0.94)",
  color: "#111827",
  display: "grid",
  gridTemplateColumns: "16px minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 4,
  padding: "3px 5px",
  textAlign: "left",
  cursor: "grab",
  boxShadow: hovered ? "0 1px 2px rgba(15, 23, 42, 0.04)" : "none",
  transition: "background 120ms ease, border-color 120ms ease, box-shadow 120ms ease",
});

const relationshipNodeIconStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#38bdf8",
};

const relationshipNodeTitleStyle: React.CSSProperties = {
  minWidth: 0,
  fontSize: 11,
  fontWeight: 600,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const nodeStatusDotStyle = (color?: string | null): React.CSSProperties => ({
  width: 8,
  height: 8,
  borderRadius: 999,
  background: color || "#22c55e",
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
