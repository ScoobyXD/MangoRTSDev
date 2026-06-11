import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchCurrentUser } from "../../auth/cognitoAuth.js";
import { getActiveCompanyID } from "../../auth/currentCompany.js";
import { listCompanyUsers, type CompanyUser } from "../communications/communicationsApi.js";
import { EXPLORER_DRAG_MIME, readExplorerDragPayload } from "../company-explorer/companyExplorerDragDrop.js";
import { ExplorerRowIcon } from "../company-explorer/CompanyExplorerIcons.js";
import { getExplorerDropPayloadItems, getExplorerDropPayloadItemType, type ExplorerDropPayload } from "../company-explorer/treePresentation.js";
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
  AttachmentCountDropdown,
  AttachedEmailOrganizerPane,
  ChatPane,
  EmailPickerModal,
  NodeTextBlockEditor,
  TextBlockActionsMenu,
  TimelineCell,
  type TextBlockAttachmentListItem,
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
import type { LogicGateRecord } from "../logic-gate-map/shared.js";
import type { NodeRecord } from "../node-map/shared.js";
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

type SummarySplitResizeState = {
  left: number;
  width: number;
};

const PROJECT_SUMMARY_SURFACE_TEXT = "#172033";
const PROJECT_SUMMARY_RULE = "rgba(91, 141, 239, 0.24)";
const PROJECT_SUMMARY_SPLIT_MIN = 42;
const PROJECT_SUMMARY_SPLIT_MAX = 74;

export const ProjectSummaryContent: React.FC<ProjectSummaryContentProps> = ({
  projectID,
  accent,
  onBack,
  onNodeOpen,
  onLogicGateOpen,
  workspace,
}) => {
  const companyID = getActiveCompanyID();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [blocks, setBlocks] = useState<ProjectTextBlockDraft[]>([]);
  const [chatMessages, setChatMessages] = useState<EditorTextBlockChatMessage[]>([]);
  const [attachedEmails, setAttachedEmails] = useState<EditorAttachedEmail[]>([]);
  const [relationships, setRelationships] = useState<ProjectRelationshipProjection[]>([]);
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([]);
  const [currentUserID, setCurrentUserID] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingID, setSavingID] = useState("");
  const [error, setError] = useState("");
  const [gateIDDraft, setGateIDDraft] = useState("");
  const [nodeIDDraft, setNodeIDDraft] = useState("");
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
  const [relationshipDropActive, setRelationshipDropActive] = useState(false);
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
      setChatMessages(parseEditorTextBlockChats(view.projections ?? []));
      setAttachedEmails(parseEditorAttachedEmails(view.projections ?? []));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load project");
    } finally {
      setLoading(false);
    }
  }, [companyID, projectID]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

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

  const removeTextBlockAttachment = useCallback((blockID: string, attachmentID: string) => {
    const block = blocks.find((item) => item.id === blockID);
    if (!block) return;
    const nextAttachments = block.attachments.filter((attachment) => attachment.id !== attachmentID);
    setBlocks((current) => current.map((item) => item.id === blockID ? { ...item, attachments: nextAttachments } : item));
    void saveTextBlock(block, { attachments: nextAttachments });
  }, [blocks, saveTextBlock]);

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
      await loadProject();
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
      await loadProject();
    }
  }, [companyID, loadProject, projectID]);

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
      await Promise.all(uniqueTargets.map((target, index) => upsertProjectRelationship({
        companyID,
        projectID,
        resourceType: target.resourceType,
        resourceID: target.resourceID,
        position: relationships.length + index + 1,
      })));
      await loadProject();
    } catch (relationshipError) {
      setError(relationshipError instanceof Error ? relationshipError.message : "Failed to add relationships");
    }
  }, [companyID, loadProject, projectID, relationships]);

  const relationshipTargetsFromTransfer = useCallback((dataTransfer: DataTransfer): ProjectRelationshipDropTarget[] => {
    const payload = readExplorerDragPayload(dataTransfer);
    return resolveProjectRelationshipDropTargets(payload, workspace);
  }, [workspace]);

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
          <h2 style={summaryTitleStyle}>{project?.name || projectID}</h2>
        </div>
        <div style={summaryMetaPillsStyle}>
          <span style={statusPillStyle(accent)}>{project?.status || "Active"}</span>
          {project?.account_name ? <span style={plainPillStyle}>{project.account_name}</span> : null}
          {project?.team_name ? <span style={plainPillStyle}>{project.team_name}</span> : null}
        </div>
      </div>
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
                      <AttachmentCountDropdown
                        items={textBlockAttachmentItems(block)}
                        accent={accent}
                        surfaceText={PROJECT_SUMMARY_SURFACE_TEXT}
                        compact
                        editable
                        onRemove={removeTextBlockAttachment}
                      />
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
          <div
            className="kanban-board-scroll"
            style={relationshipScrollStyle(relationshipDropActive)}
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

function textBlockAttachmentItems(block: ProjectTextBlockDraft): TextBlockAttachmentListItem[] {
  return block.attachments.map((attachment) => ({
    blockID: block.id,
    blockTitle: block.title || "Project Summary",
    attachment,
  }));
}

function toggleSetValue(current: Set<string>, value: string): Set<string> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
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
  if (payload.kind === "batch") {
    if (itemType !== "logic_gate" && itemType !== "node") return [];
    return getExplorerDropPayloadItems(payload).map((item) => ({
      resourceType: itemType,
      resourceID: item.itemID,
    }));
  }
  if ((payload.itemType === "logic_gate" || payload.itemType === "node") && payload.itemID) {
    return [{ resourceType: payload.itemType, resourceID: payload.itemID }];
  }
  if (payload.kind !== "folder" || !workspace) return [];
  if (payload.folderKind === "logic_gate") {
    return Array.from(getScopedItemIDs({
      folders: workspace.logicGateFolders,
      folderItems: workspace.logicGateFolderItems,
      folderID: payload.folderID ?? "",
      itemType: "logic_gate",
    })).map((resourceID) => ({ resourceType: "logic_gate", resourceID }));
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

const relationshipScrollStyle = (dropActive: boolean): React.CSSProperties => ({
  minHeight: 0,
  flex: "1 1 auto",
  overflow: "auto",
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(120px, 1fr))",
  alignContent: "start",
  gap: 12,
  padding: 10,
  border: dropActive ? "1px dashed rgba(91, 141, 239, 0.58)" : "1px dashed rgba(148, 163, 184, 0.34)",
  borderRadius: 8,
  background: dropActive ? "rgba(239, 246, 255, 0.76)" : "rgba(255, 255, 255, 0.54)",
});

const gateGroupStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  minWidth: 0,
};

const logicGateBoxStyle: React.CSSProperties = {
  width: "100%",
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
  paddingLeft: 0,
  minWidth: 0,
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
