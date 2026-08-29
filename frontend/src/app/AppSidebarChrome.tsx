import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getActiveCompanyID } from "../auth/currentCompany";
import { readAuthConfig } from "../auth/cognitoAuth";
import { WORKTREE_VERSION } from "./worktreeVersion";
import { ConfirmActionMenu, confirmMenuPositionFromElement, type ConfirmActionMenuPosition } from "./ConfirmActionMenu";
import { AppModalPortal } from "./AppModalPortal";
import FrameRightClickMenu from "./framerightclickmenu";
import { AppSidebarPinnedSection } from "./AppSidebarPinnedSection";
import { AppSidebarRACITabsSection } from "./AppSidebarRACITabsSection";
import { HeaderAccountManagerIcon, HeaderExplorerIcon, HeaderMapIcon, HeaderMyWorkIcon, HeaderProjectManagementIcon, HeaderSharedTriageIcon, HeaderTeamsIcon, HeaderTriageIcon, HeaderUpdatesIcon } from "../icons/index.js";
import { MangoWordmark } from "../icons/index.js";
import { UI_THEME } from "./frameLayoutTypes";
import { preloadAccountManagerSurface, preloadEntitiesSurface, preloadMyWorkSurface, preloadProcessMapSurface, preloadProjectManagementSurface, preloadTeamsSurface } from "./preloadDashboardModules";
import { requestProjectViewSettings } from "../modules/project-management/projectViewEvents";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../icons/index.js";
import { CompanyExplorerSearchBox } from "../modules/company-explorer/CompanyExplorerSearchBox";
import type { CompanyExplorerTriageMessageDropHandler } from "../modules/company-explorer/CompanyExplorerContentModel";
import { resolveExplorerClickSelection } from "../modules/company-explorer/treePresentation";
import { subscribeCommittedEntityTitleUpdates } from "../modules/realtime/committedEntityTitleUpdates";
import {
  requestAppSidebarPin,
  type SidebarPin,
  type SidebarPinEntryRef,
  type SidebarPinFolder,
  type SidebarPinTree,
} from "./sidebarPins";
import { resolveCurrentAppSidebarPin } from "./appCommittedTitleState";
import { NODE_EDITOR_POPUP_RESIZE_HANDLES, type NodeEditorPopupResizeHandle } from "./nodeEditorPopupControls";
import {
  NODE_EDITOR_FULLSCREEN_HORIZONTAL_INSET_PX,
  NODE_EDITOR_STANDARD_VERTICAL_INSET_PX,
  NODE_EDITOR_FULLSCREEN_VERTICAL_INSET_PX,
  fullscreenNodeEditorViewportRect,
  readNodeEditorFullscreenChromeActive,
  setNodeEditorFullscreenChromeActive as setNodeEditorFullscreenChromeActiveFlag,
  subscribeNodeEditorFullscreenChrome,
} from "../modules/editor/nodeEditorFullscreenChrome";
import {
  createCommunicationsSharedInbox,
  deleteCommunicationsSharedInbox,
  EVENT_COMMUNICATIONS_SHARED_INBOXES_UPDATED,
  fetchCommunicationsAuthURL,
  fetchCommunicationsStatus,
  listCommunicationsSharedInboxes,
  removeCommunicationsSharedInbox,
  updateCommunicationsSharedInbox,
  type CommunicationsSharedInbox,
  type CommunicationsSharedInboxCreateIntent,
  type CommunicationsTriageConversionTarget,
  type EmailProvider,
} from "../modules/communications/communicationsApi";
import { NOTIFICATION_TYPE_MENTION, NOTIFICATION_TYPE_URGENT_MENTION, type NotificationSummary, type UpdateFeedFilter } from "../modules/notifications/notificationsApi";
import { useNotificationSummary } from "../modules/notifications/useNotificationSummary";
import { requestUpdatesFilter } from "../modules/notifications/updatesFilterRequests";
import { assignNodeToLogicGateStatus } from "../modules/kanban/kanbanApi";
import {
  getKanbanBoardContentsSingleFlight,
  invalidateKanbanBoardContentsCache,
} from "../modules/kanban/KanbanBoardContentStore";
import {
  EVENT_KANBAN_BOARD_CONTENTS_UPDATED,
  logicGateIDFromKanbanBoardID,
  logicGateKanbanBoardID,
  type KanbanBoardContentsUpdatedDetail,
} from "../modules/kanban/shared";
import { subscribeRealtimeScope } from "../modules/realtime/realtimeWebSocket";
import { UnifiedNodeShell, type UnifiedNodeShellAction } from "../modules/editor/UnifiedNodeShell";
import { INBOX_PRIORITIES } from "../pages/home/homeConstants";
import { dispatchTriageConversionApplied } from "../modules/triage/triageEvents";
import { convertMessagesToExplorerTargetCommand } from "../pages/home/homeCommands";
import { HomeSavedViewsSidebarSection, restoreSelectedHomeSavedView } from "../pages/home/HomeSavedViewsSidebar";
import {
  buildSharedInboxRows,
  cleanIDList,
  collectSharedInboxSubtreeIDs,
  getSharedInboxChildPosition,
  getSharedInboxSiblingPosition,
  isSharedInboxFolderDescendant,
  type SharedInboxDropPlacement,
  type SharedInboxTreeRow,
} from "../pages/home/homeUtils";
import {
  readSidebarPinnedResourceDropAction,
  sidebarPinAcceptsPinnedResourceDrag,
  type SidebarPinnedResourceDropAction,
} from "./sidebarPinDrops";
import type { SidebarPinDropPlacement } from "./sidebarPinTree";
import {
  countSidebarLogicGateStatuses,
  emptySidebarLogicGateStatusCounts,
  type SidebarLogicGateStatusCounts,
} from "./sidebarLogicGateStatusCounts";
import { HuddleExplorerSection } from "../modules/huddles/HuddleExplorerSection";
import { useExplorerSearchQuery } from "../modules/hierarchy/useExplorerSearchQuery.js";

const SidebarCompanyExplorerContent = React.lazy(() => import("../modules/company-explorer/CompanyExplorerContent").then((module) => ({ default: module.CompanyExplorerContent })));
const AppNodeEditorContent = React.lazy(() => import("../modules/editor/EditorContent").then((module) => ({
  default: module.EditorContent as React.FC<{
    accent: string;
    widgetId?: string;
    theme?: "mango" | "teal" | "light" | "dark";
    forcedEntityKind?: "node" | "logic_gate";
    forcedEntityID?: string;
    forcedLabel?: string;
    focusInformationID?: string;
    focusRequestID?: number;
    onBeforeHierarchyNavigate?: () => void;
  }>,
})));

const fullPageFallback = <div aria-busy="true" style={{ width: "100%", height: "100%", background: "#ffffff" }} />;
const PAGE_SURFACE_RADIUS = 16;
export const SIDEBAR_EXPLORER_WIDGET_ID = "app-sidebar-explorer";
const SHARED_TRIAGE_FOLDER_DRAG_MIME = "application/x-mangorts-shared-triage-folder";
const SIDEBAR_SECTION_OPEN_KEY_PREFIX = "mangorts.app-sidebar-section-open.v2";
const NODE_EDITOR_POPUP_MIN_WIDTH = 420;
const NODE_EDITOR_POPUP_MIN_HEIGHT = 320;

const NODE_EDITOR_POPUP_VIEWPORT_WIDTH_INSET = 44;
const NODE_EDITOR_POPUP_VIEWPORT_HEIGHT_INSET = NODE_EDITOR_STANDARD_VERTICAL_INSET_PX;

function notificationTypeCount(summary: NotificationSummary, type: string): number {
  return normalizeSidebarNotificationCount(summary.type_counts.find((item) => item.type === type)?.count);
}
const NODE_EDITOR_POPUP_SIDEBAR_BUFFER = 14;
const NODE_EDITOR_POPUP_SIZE_STORAGE_KEY_PREFIX = "app-node-editor-popup-size-v2";
const SIDEBAR_ELEVATED_RADIUS = 11;
const SIDEBAR_SCROLL_ACCENT = "rgba(203, 213, 225, 0.82)";
const SIDEBAR_ACCOUNT_ICON_COLOR = "#14b8a6";
const SIDEBAR_TEAMS_ICON_COLOR = "#6366f1";
const SIDEBAR_ENTITIES_ICON_COLOR = "#0f766e";
const SIDEBAR_STATE_ACTIVE_BG = "rgba(15, 23, 42, 0.045)";
const SIDEBAR_STATE_DROP_BG = "rgba(15, 23, 42, 0.055)";
const SIDEBAR_STATE_HOVER_BG = "rgba(15, 23, 42, 0.055)";
const SIDEBAR_STATE_ACTIVE_BORDER = "rgba(148, 163, 184, 0.34)";
const SIDEBAR_STATE_OPEN_BORDER = "rgba(148, 163, 184, 0.28)";
const SIDEBAR_DIVIDER = "rgba(15, 23, 42, 0.12)";
const SIDEBAR_SOFT_BORDER = "rgba(255, 255, 255, 0.76)";
const SIDEBAR_NEUMORPHIC_SURFACE = "linear-gradient(145deg, #ffffff 0%, #f6f7fb 100%)";
const SIDEBAR_NEUMORPHIC_ACTIVE_SURFACE = "linear-gradient(145deg, #ffffff 0%, #f5f6fa 100%)";
const SIDEBAR_NEUMORPHIC_SHADOW = "7px 7px 16px rgba(174, 174, 192, 0.26), -7px -7px 16px rgba(255, 255, 255, 0.92), inset 1px 1px 0 rgba(255, 255, 255, 0.86)";
const SIDEBAR_NEUMORPHIC_RAISED_SHADOW = "10px 10px 22px rgba(174, 174, 192, 0.32), -8px -8px 18px rgba(255, 255, 255, 0.96), inset 1px 1px 0 rgba(255, 255, 255, 0.9)";
const SIDEBAR_NEUMORPHIC_ACTIVE_SHADOW = "8px 8px 20px rgba(174, 174, 192, 0.30), -7px -7px 16px rgba(255, 255, 255, 0.95), inset 0 0 0 1px rgba(148, 163, 184, 0.14)";
const SIDEBAR_EDGE_FRAME_GRADIENT = "linear-gradient(135deg, rgba(92, 238, 255, 0.92) 0%, rgba(128, 216, 255, 0.82) 34%, rgba(183, 124, 255, 0.88) 72%, rgba(255, 255, 255, 0.86) 100%)";
const SIDEBAR_EDGE_FRAME_SHADOW = "0 0 0 1px rgba(120, 224, 255, 0.22), 0 8px 22px rgba(96, 165, 250, 0.12), 0 0 16px rgba(183, 124, 255, 0.24), inset 1px 1px 0 rgba(255, 255, 255, 0.9)";
const SIDEBAR_ACTIVE_TEXT = "#111111";

type SidebarSectionID = "shared-triage";

export type HomeKeyViewID = "my-triage" | "shared-root" | "r-inbox" | "a-inbox" | "c-inbox" | "i-inbox" | "o-inbox" | "updates" | `shared:${string}`;
export type { SidebarPin, SidebarPinKind } from "./sidebarPins";

type AppSidebarPrimaryPage = "home" | "my-work" | "logic-gate-arena" | "project-management" | "process-map" | "entities" | "account-manager" | "teams";

type AppSidebarProps = {
  accountChrome?: React.ReactNode;
  activePage: AppSidebarPrimaryPage | null;
  activeHomeView: HomeKeyViewID;
  currentUserID: string;
  pinTree: SidebarPinTree;
  pinDropActive: boolean;
  explorerSelectionTargetFrameIDs: string[];
  onHomeViewSelect: (view: HomeKeyViewID) => void;
  onPageSelect: (page: AppSidebarPrimaryPage) => void;
  onPinOpen: (pin: SidebarPin) => void;
  onPinOpenInNewTab: (pin: SidebarPin) => void;
  onPinRemove: (pin: SidebarPin) => void;
  onPinCreateFolder: (parentFolderID: string) => Promise<string | null>;
  onPinRenameFolder: (folder: SidebarPinFolder, name: string) => Promise<void>;
  onPinDeleteFolder: (folder: SidebarPinFolder) => Promise<void>;
  onPinMoveEntry: (moving: SidebarPinEntryRef, target: SidebarPinEntryRef | null, placement: SidebarPinDropPlacement) => void;
  onPinGroup: (dragged: SidebarPin, target: SidebarPin) => Promise<string | null>;
  onPinExternalDrop: (event: React.DragEvent<HTMLElement>, parentFolderID: string, target: SidebarPinEntryRef | null, placement: "before" | "after" | "inside") => void;
  onPinDragEnter: () => void;
  onPinDragLeave: () => void;
};

function sidebarExplorerTriageConversionTarget(target: Parameters<CompanyExplorerTriageMessageDropHandler>[0]): CommunicationsTriageConversionTarget | null {
  const logicGateID = target.logicGateID.trim();
  return logicGateID ? { mode: "existing_logic_gate", logicGateID } : null;
}
type SidebarExplorerTriagePriorityMenuState = {
  x: number;
  y: number;
  target: Parameters<CompanyExplorerTriageMessageDropHandler>[0];
  messageIDs: string[];
  sharedInboxID?: string;
  accountEmail?: string;
};

type SidebarPinTriageDropAction = Extract<SidebarPinnedResourceDropAction, { kind: "triage_to_logic_gate" | "triage_to_node" }>;

type SidebarPinTriagePriorityMenuState = {
  x: number;
  y: number;
  action: SidebarPinTriageDropAction;
};

type SidebarSharedInboxCreateDialogState = {
  mode: "folder" | "shared_inbox";
  parentFolderID: string;
  parentName: string;
  name: string;
  accountEmail: string;
  error: string;
};

type SidebarSharedInboxDeleteDialogState = {
  folder: CommunicationsSharedInbox;
  action: "delete" | "remove";
  title: string;
  detail: string;
  label: string;
  confirmLabel: string;
  subtreeIDs: Set<string>;
  position?: ConfirmActionMenuPosition | null;
};

function readSharedTriageFolderDrag(dataTransfer: DataTransfer): string {
  return dataTransfer.getData(SHARED_TRIAGE_FOLDER_DRAG_MIME).trim();
}

function getSharedTriageDropPlacement(event: React.DragEvent<HTMLElement>): SharedInboxDropPlacement {
  const rect = event.currentTarget.getBoundingClientRect();
  const y = event.clientY - rect.top;
  if (y < rect.height * 0.25) return "before";
  if (y > rect.height * 0.75) return "after";
  return "inside";
}

function sidebarSectionOpenStorageKey(sectionID: SidebarSectionID): string {
  return `${SIDEBAR_SECTION_OPEN_KEY_PREFIX}:${sectionID}`;
}

function readSidebarSectionOpen(sectionID: SidebarSectionID, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(sidebarSectionOpenStorageKey(sectionID));
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch {}
  return fallback;
}

function saveSidebarSectionOpen(sectionID: SidebarSectionID, open: boolean): void {
  try {
    localStorage.setItem(sidebarSectionOpenStorageKey(sectionID), open ? "true" : "false");
  } catch {}
}

function isValidSharedInboxEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim().toLowerCase());
}

function isSharedInboxEmailConnectionError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("shared_inbox_email_account_not_connected");
}

function formatSidebarSharedInboxError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.trim() : "";
  if (message.includes("shared_inbox_storage_unavailable")) {
    return `${fallback}: Shared Emails storage is not ready. Run the pending database migrations, then try again.`;
  }
  if (message.includes("failed_to_list_shared_inboxes")) {
    return `${fallback}: the shared inbox list could not be loaded.`;
  }
  if (message.includes("failed_to_create_shared_inbox")) {
    return `${fallback}: the folder could not be created.`;
  }
  return message ? `${fallback}: ${message}` : fallback;
}

function usePersistedSidebarSectionOpen(sectionID: SidebarSectionID, fallback: boolean): [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  const [open, setOpen] = useState(() => readSidebarSectionOpen(sectionID, fallback));
  useEffect(() => {
    saveSidebarSectionOpen(sectionID, open);
  }, [open, sectionID]);
  return [open, setOpen];
}

export function AppSidebar({
  accountChrome,
  activePage,
  activeHomeView,
  currentUserID,
  pinTree,
  pinDropActive,
  explorerSelectionTargetFrameIDs,
  onHomeViewSelect,
  onPageSelect,
  onPinOpen,
  onPinOpenInNewTab,
  onPinRemove,
  onPinCreateFolder,
  onPinRenameFolder,
  onPinDeleteFolder,
  onPinMoveEntry,
  onPinGroup,
  onPinExternalDrop,
  onPinDragEnter,
  onPinDragLeave,
}: AppSidebarProps): React.ReactElement {
  const homeActive = activePage === "home";
  const companyID = getActiveCompanyID();
  const apiBase = readAuthConfig().apiBase;
  const pins = pinTree.pins;
  const pinnedLogicGateIDs = useMemo(
    () => Array.from(new Set(pins.filter((pin) => pin.kind === "logic_gate").map((pin) => pin.id.trim()).filter(Boolean))).sort(),
    [pins],
  );
  const pinnedLogicGateIDKey = pinnedLogicGateIDs.join("\u0000");
  const [logicGateStatusCountsByID, setLogicGateStatusCountsByID] = useState<Record<string, SidebarLogicGateStatusCounts>>({});
  const notificationSummary = useNotificationSummary(companyID);
  const [sharedTriageOpen, setSharedTriageOpen] = usePersistedSidebarSectionOpen("shared-triage", false);
  const [sharedInboxes, setSharedInboxes] = useState<CommunicationsSharedInbox[]>([]);
  const [connectedAccountEmail, setConnectedAccountEmail] = useState("");
  const [loadingSharedInboxes, setLoadingSharedInboxes] = useState(false);
  const [sharedBusy, setSharedBusy] = useState(false);
  const [sharedError, setSharedError] = useState("");
  const [expandedSharedFolderIDs, setExpandedSharedFolderIDs] = useState<Set<string>>(new Set());
  const [selectedSharedTreeIDs, setSelectedSharedTreeIDs] = useState<Set<string>>(new Set());
  const [sharedSelectionAnchorTreeID, setSharedSelectionAnchorTreeID] = useState("");
  const [renamingSharedFolderID, setRenamingSharedFolderID] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [draggingSharedFolderID, setDraggingSharedFolderID] = useState("");
  const [dropTarget, setDropTarget] = useState<{ folderID: string; placement: SharedInboxDropPlacement } | null>(null);
  const [sharedContextMenu, setSharedContextMenu] = useState<{ x: number; y: number; folder: CommunicationsSharedInbox | null } | null>(null);
  const [sharedCreateDialog, setSharedCreateDialog] = useState<SidebarSharedInboxCreateDialogState | null>(null);
  const [sharedEmailDialog, setSharedEmailDialog] = useState<{ folder: CommunicationsSharedInbox; draft: string; error: string } | null>(null);
  const [sharedDeleteDialog, setSharedDeleteDialog] = useState<SidebarSharedInboxDeleteDialogState | null>(null);
  const [sharedEmailConnectionDialog, setSharedEmailConnectionDialog] = useState<{ accountEmail: string; createIntent?: CommunicationsSharedInboxCreateIntent } | null>(null);
  const [explorerTriagePriorityMenu, setExplorerTriagePriorityMenu] = useState<SidebarExplorerTriagePriorityMenuState | null>(null);
  const [pinTriagePriorityMenu, setPinTriagePriorityMenu] = useState<SidebarPinTriagePriorityMenuState | null>(null);
  const [explorerTriageBusy, setExplorerTriageBusy] = useState(false);
  const [pinnedResourceDropBusy, setPinnedResourceDropBusy] = useState(false);
  const [explorerDropSuccess, setExplorerDropSuccess] = useState("");
  const [pinDropSuccess, setPinDropSuccess] = useState("");
  const [mailUnreadCounts, setMailUnreadCounts] = useState({ myTriage: 0, sharedTriage: 0 });
  const [explorerSearchQuery, setExplorerSearchQuery] = useExplorerSearchQuery(companyID);
  const [nodeEditorFullscreenChromeActive, setNodeEditorFullscreenChromeActiveState] = useState(readNodeEditorFullscreenChromeActive);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const sharedCreateNameInputRef = useRef<HTMLInputElement | null>(null);
  const sharedEmailInputRef = useRef<HTMLInputElement | null>(null);
  const skipRenameBlurRef = useRef(false);
  const pinnedBoardSubscriptionByLogicGateIDRef = useRef(new Map<string, () => void>());
  const trackedPinnedLogicGateIDsRef = useRef(new Set<string>());
  const pinnedCountRequestVersionByLogicGateIDRef = useRef(new Map<string, number>());
  const refreshPinnedLogicGateCountsRef = useRef<(logicGateID: string, boardID?: string) => void>(() => undefined);

  refreshPinnedLogicGateCountsRef.current = (logicGateID: string, boardID = logicGateKanbanBoardID(logicGateID)) => {
    if (!trackedPinnedLogicGateIDsRef.current.has(logicGateID)) return;
    const version = (pinnedCountRequestVersionByLogicGateIDRef.current.get(logicGateID) ?? 0) + 1;
    pinnedCountRequestVersionByLogicGateIDRef.current.set(logicGateID, version);
    invalidateKanbanBoardContentsCache(apiBase, companyID, boardID);
    void getKanbanBoardContentsSingleFlight(apiBase, companyID, boardID, Number.MAX_SAFE_INTEGER).then(
      (contents) => {
        if (!trackedPinnedLogicGateIDsRef.current.has(logicGateID)
          || pinnedCountRequestVersionByLogicGateIDRef.current.get(logicGateID) !== version) return;
        setLogicGateStatusCountsByID((current) => ({
          ...current,
          [logicGateID]: countSidebarLogicGateStatuses(contents),
        }));
      },
      () => {
        if (!trackedPinnedLogicGateIDsRef.current.has(logicGateID)
          || pinnedCountRequestVersionByLogicGateIDRef.current.get(logicGateID) !== version) return;
        setLogicGateStatusCountsByID((current) => ({
          ...current,
          [logicGateID]: emptySidebarLogicGateStatusCounts(),
        }));
      },
    );
  };

  useEffect(() => {
    const onLocalBoardChange = (event: Event) => {
      const detail = (event as CustomEvent<KanbanBoardContentsUpdatedDetail>).detail;
      if (detail?.companyID && detail.companyID !== companyID) return;
      const boardID = detail?.boardID?.trim() ?? "";
      const logicGateID = detail?.logicGateID?.trim() || logicGateIDFromKanbanBoardID(boardID);
      if (logicGateID) refreshPinnedLogicGateCountsRef.current(logicGateID, boardID || logicGateKanbanBoardID(logicGateID));
    };
    window.addEventListener(EVENT_KANBAN_BOARD_CONTENTS_UPDATED, onLocalBoardChange);
    return () => {
      window.removeEventListener(EVENT_KANBAN_BOARD_CONTENTS_UPDATED, onLocalBoardChange);
      for (const unsubscribe of pinnedBoardSubscriptionByLogicGateIDRef.current.values()) unsubscribe();
      pinnedBoardSubscriptionByLogicGateIDRef.current.clear();
      trackedPinnedLogicGateIDsRef.current.clear();
      pinnedCountRequestVersionByLogicGateIDRef.current.clear();
    };
  }, [apiBase, companyID]);

  useEffect(() => {
    const nextLogicGateIDs = new Set(pinnedLogicGateIDs);
    trackedPinnedLogicGateIDsRef.current = nextLogicGateIDs;
    for (const [logicGateID, unsubscribe] of pinnedBoardSubscriptionByLogicGateIDRef.current) {
      if (nextLogicGateIDs.has(logicGateID)) continue;
      unsubscribe();
      pinnedBoardSubscriptionByLogicGateIDRef.current.delete(logicGateID);
      pinnedCountRequestVersionByLogicGateIDRef.current.delete(logicGateID);
    }
    setLogicGateStatusCountsByID((current) => Object.fromEntries(
      Object.entries(current).filter(([logicGateID]) => nextLogicGateIDs.has(logicGateID)),
    ));
    if (!companyID.trim()) return;
    for (const logicGateID of pinnedLogicGateIDs) {
      if (pinnedBoardSubscriptionByLogicGateIDRef.current.has(logicGateID)) continue;
      const boardID = logicGateKanbanBoardID(logicGateID);
      let acceptedOnce = false;
      const unsubscribe = subscribeRealtimeScope(apiBase, companyID, `board:${boardID}`, {
        onAccepted() {
          if (acceptedOnce) refreshPinnedLogicGateCountsRef.current(logicGateID, boardID);
          acceptedOnce = true;
        },
        onKanbanChanged(message) {
          if (message.company_id !== companyID || message.board_id !== boardID) return;
          refreshPinnedLogicGateCountsRef.current(logicGateID, boardID);
        },
      });
      pinnedBoardSubscriptionByLogicGateIDRef.current.set(logicGateID, unsubscribe);
      refreshPinnedLogicGateCountsRef.current(logicGateID, boardID);
    }
  }, [apiBase, companyID, pinnedLogicGateIDKey]);
  useEffect(() => subscribeCommittedEntityTitleUpdates((update) => {
    if (update.companyID !== companyID.trim() || update.entityType !== "logic_gate") return;
    const title = update.title.trim();
    if (!title) return;
    setExplorerTriagePriorityMenu((current) => {
      if (!current || current.target.logicGateID.trim() !== update.resourceID || current.target.label === title) return current;
      return { ...current, target: { ...current.target, label: title } };
    });
  }), [companyID]);
  useEffect(() => {
    setPinTriagePriorityMenu((current) => {
      if (!current) return current;
      const pin = resolveCurrentAppSidebarPin(pins, current.action.pin);
      return pin === current.action.pin ? current : { ...current, action: { ...current.action, pin } };
    });
  }, [pins]);
  const cleanConnectedAccountEmail = connectedAccountEmail.trim().toLowerCase();
  const sharedRows = useMemo(
    () => sharedTriageOpen ? buildSharedInboxRows(sharedInboxes, expandedSharedFolderIDs) : [],
    [expandedSharedFolderIDs, sharedInboxes, sharedTriageOpen],
  );
  const sharedTriageActive = homeActive && activeHomeView.startsWith("shared:");
  const myTriageNotificationCount = useMemo(
    () => mailUnreadCounts.myTriage,
    [mailUnreadCounts.myTriage],
  );
  const sharedTriageNotificationCount = useMemo(
    () => mailUnreadCounts.sharedTriage,
    [mailUnreadCounts.sharedTriage],
  );
  const updatesUrgentNotificationCount = useMemo(
    () => notificationTypeCount(notificationSummary, NOTIFICATION_TYPE_URGENT_MENTION),
    [notificationSummary],
  );
  const updatesMentionNotificationCount = useMemo(
    () => notificationTypeCount(notificationSummary, NOTIFICATION_TYPE_MENTION),
    [notificationSummary],
  );
  const updatesOtherNotificationCount = useMemo(
    () => Math.max(0, normalizeSidebarNotificationCount(notificationSummary.total_unread) - updatesUrgentNotificationCount - updatesMentionNotificationCount),
    [notificationSummary.total_unread, updatesMentionNotificationCount, updatesUrgentNotificationCount],
  );
  const openUpdatesFilter = useCallback((filter: UpdateFeedFilter) => {
    restoreSelectedHomeSavedView("updates", companyID, currentUserID);
    requestUpdatesFilter(companyID, filter);
    onHomeViewSelect("updates");
  }, [companyID, currentUserID, onHomeViewSelect]);
  const [sharedTriageHovered, setSharedTriageHovered] = useState(false);
  const [sharedTriageFocused, setSharedTriageFocused] = useState(false);
  const [hoveredSharedFolderID, setHoveredSharedFolderID] = useState("");
  useEffect(() => {
    const onHomeUnreadCountsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ companyID?: string; viewID?: HomeKeyViewID; unreadCount?: number }>).detail;
      if (detail?.companyID && detail.companyID !== companyID) return;
      const count = normalizeSidebarNotificationCount(detail?.unreadCount);
      if (detail?.viewID === "my-triage") {
        setMailUnreadCounts((current) => ({ ...current, myTriage: count }));
      } else if (detail?.viewID === "shared-root" || detail?.viewID?.startsWith("shared:")) {
        setMailUnreadCounts((current) => ({ ...current, sharedTriage: count }));
      }
    };
    window.addEventListener("mangorts:home-unread-counts-updated", onHomeUnreadCountsUpdated);
    return () => window.removeEventListener("mangorts:home-unread-counts-updated", onHomeUnreadCountsUpdated);
  }, [companyID]);
  useEffect(() => {
    if (!pinDropSuccess) return undefined;
    const timerID = window.setTimeout(() => {
      setPinDropSuccess((current) => current === pinDropSuccess ? "" : current);
    }, 3_000);
    return () => window.clearTimeout(timerID);
  }, [pinDropSuccess]);
  useEffect(() => {
    if (!explorerDropSuccess) return undefined;
    const timerID = window.setTimeout(() => {
      setExplorerDropSuccess((current) => current === explorerDropSuccess ? "" : current);
    }, 3_000);
    return () => window.clearTimeout(timerID);
  }, [explorerDropSuccess]);

  useEffect(() => subscribeNodeEditorFullscreenChrome(setNodeEditorFullscreenChromeActiveState), []);

  const openMailBadgeView = useCallback((view: HomeKeyViewID) => {
    onPageSelect("home");
    onHomeViewSelect(view);
  }, [onHomeViewSelect, onPageSelect]);

  const requestExplorerTriageMessageDrop = useCallback<CompanyExplorerTriageMessageDropHandler>((target, messageIDs, point, source) => {
    const ids = cleanIDList(messageIDs);
    if (ids.length === 0) return;
    const sharedInboxID = source?.sharedInboxID?.trim() || undefined;
    setExplorerTriagePriorityMenu({
      target,
      messageIDs: ids,
      sharedInboxID,
      accountEmail: sharedInboxID ? undefined : source?.accountEmail?.trim().toLowerCase() || undefined,
      x: point.x,
      y: point.y,
    });
  }, []);

  const pickExplorerTriagePriority = useCallback(async (priority: number) => {
    const menu = explorerTriagePriorityMenu;
    const cleanCompanyID = companyID.trim();
    if (!menu || explorerTriageBusy || !cleanCompanyID) return;
    setExplorerTriagePriorityMenu(null);
    setExplorerTriageBusy(true);
    setSharedError("");
    setExplorerDropSuccess("");
    try {
      const target = sidebarExplorerTriageConversionTarget(menu.target);
      if (!target) {
        setSharedError("This Explorer location cannot receive email.");
        return;
      }
      dispatchTriageConversionApplied({
        companyID: cleanCompanyID,
        messageIDs: menu.messageIDs,
        sharedInboxID: menu.sharedInboxID,
        accountEmail: menu.accountEmail,
      });
      const conversion = await convertMessagesToExplorerTargetCommand({
        apiBase: readAuthConfig().apiBase,
        companyID: cleanCompanyID,
        sharedInboxID: menu.sharedInboxID,
        accountEmail: menu.accountEmail,
        target,
        messageIDs: menu.messageIDs,
        priority,
      });
      const convertedMessageIDs = conversion?.convertedMessageIDs.length ? conversion.convertedMessageIDs : menu.messageIDs;
      dispatchTriageConversionApplied({
        companyID: cleanCompanyID,
        messageIDs: convertedMessageIDs,
        sharedInboxID: menu.sharedInboxID,
        accountEmail: menu.accountEmail,
        logicGateID: conversion?.logicGateID || (target.mode === "existing_logic_gate" ? target.logicGateID : undefined),
        nodeIDs: conversion?.result.nodes?.map((node) => node.node_id) ?? [],
        boardIDs: [
          conversion?.boardID ?? "",
          ...(conversion?.result.cards ?? []).map((card) => card.board_id),
        ],
        cardIDs: (conversion?.result.cards ?? []).map((card) => card.card_id),
        unstarredMessageIDs: conversion?.unstarredMessageIDs ?? [],
      });
      setExplorerDropSuccess(convertedMessageIDs.length === 1 ? "Email added to Process." : `${convertedMessageIDs.length} emails added to Process.`);
    } catch (error) {
      console.error("Failed to assign triage email from sidebar Explorer", error);
      setExplorerDropSuccess("");
      setSharedError(error instanceof Error ? error.message : "Failed to assign email.");
    } finally {
      setExplorerTriageBusy(false);
    }
  }, [companyID, explorerTriageBusy, explorerTriagePriorityMenu]);

  const pinAcceptsResourceDrag = useCallback((pin: SidebarPin, dataTransfer: DataTransfer): boolean => (
    !pinnedResourceDropBusy && sidebarPinAcceptsPinnedResourceDrag(pin, dataTransfer)
  ), [pinnedResourceDropBusy]);

  const assignNodesToPinnedLogicGate = useCallback(async (action: Extract<SidebarPinnedResourceDropAction, { kind: "nodes_to_logic_gate" }>) => {
    const cleanCompanyID = companyID.trim();
    if (pinnedResourceDropBusy || !cleanCompanyID || action.nodeIDs.length === 0) return;
    setPinnedResourceDropBusy(true);
    setSharedError("");
    setPinDropSuccess("");
    try {
      await Promise.all(action.nodeIDs.map((nodeID) => assignNodeToLogicGateStatus({
        apiBase: readAuthConfig().apiBase,
        companyID: cleanCompanyID,
        logicGateID: action.logicGateID,
        nodeID,
        status: "pending",
        priority: null,
        position: 0,
      })));
      setPinDropSuccess(action.nodeIDs.length === 1 ? `Node added to ${action.pin.name}.` : `${action.nodeIDs.length} nodes added to ${action.pin.name}.`);
    } catch (error) {
      console.error("Failed to add pinned drop nodes to Logic Gate", error);
      setPinDropSuccess("");
      setSharedError(error instanceof Error ? error.message : "Failed to add node to pinned Process.");
    } finally {
      setPinnedResourceDropBusy(false);
    }
  }, [companyID, pinnedResourceDropBusy]);

  const pickPinnedResourceTriagePriority = useCallback(async (priority: number) => {
    const menu = pinTriagePriorityMenu;
    const cleanCompanyID = companyID.trim();
    if (!menu || pinnedResourceDropBusy || !cleanCompanyID) return;
    setPinTriagePriorityMenu(null);
    setPinnedResourceDropBusy(true);
    setSharedError("");
    setPinDropSuccess("");
    try {
      const target: CommunicationsTriageConversionTarget = menu.action.kind === "triage_to_logic_gate"
        ? { mode: "existing_logic_gate", logicGateID: menu.action.logicGateID }
        : { mode: "existing_node", nodeID: menu.action.nodeID };
      dispatchTriageConversionApplied({
        companyID: cleanCompanyID,
        messageIDs: menu.action.messageIDs,
        sharedInboxID: menu.action.sharedInboxID,
        accountEmail: menu.action.accountEmail,
      });
      const conversion = await convertMessagesToExplorerTargetCommand({
        apiBase: readAuthConfig().apiBase,
        companyID: cleanCompanyID,
        sharedInboxID: menu.action.sharedInboxID,
        accountEmail: menu.action.accountEmail,
        target,
        messageIDs: menu.action.messageIDs,
        priority,
      });
      const convertedMessageIDs = conversion?.convertedMessageIDs.length ? conversion.convertedMessageIDs : menu.action.messageIDs;
      dispatchTriageConversionApplied({
        companyID: cleanCompanyID,
        messageIDs: convertedMessageIDs,
        sharedInboxID: menu.action.sharedInboxID,
        accountEmail: menu.action.accountEmail,
        logicGateID: conversion?.logicGateID || (menu.action.kind === "triage_to_logic_gate" ? menu.action.logicGateID : undefined),
        nodeIDs: conversion?.result.nodes?.map((node) => node.node_id) ?? [],
        boardIDs: [
          conversion?.boardID ?? "",
          ...(conversion?.result.cards ?? []).map((card) => card.board_id),
        ],
        cardIDs: (conversion?.result.cards ?? []).map((card) => card.card_id),
        unstarredMessageIDs: conversion?.unstarredMessageIDs ?? [],
      });
      setPinDropSuccess(convertedMessageIDs.length === 1 ? `Email added to ${menu.action.pin.name}.` : `${convertedMessageIDs.length} emails added to ${menu.action.pin.name}.`);
    } catch (error) {
      console.error("Failed to assign triage email from sidebar pin", error);
      setPinDropSuccess("");
      setSharedError(error instanceof Error ? error.message : "Failed to assign email.");
    } finally {
      setPinnedResourceDropBusy(false);
    }
  }, [companyID, pinTriagePriorityMenu, pinnedResourceDropBusy]);

  const handlePinnedResourceDrop = useCallback((pin: SidebarPin, event: React.DragEvent<HTMLElement>): boolean => {
    if (pinnedResourceDropBusy) return false;
    const action = readSidebarPinnedResourceDropAction(pin, event.dataTransfer);
    if (!action) return false;
    event.preventDefault();
    event.stopPropagation();
    if (action.kind === "nodes_to_logic_gate") {
      void assignNodesToPinnedLogicGate(action);
      return true;
    }
    setPinTriagePriorityMenu({ x: event.clientX, y: event.clientY, action });
    return true;
  }, [assignNodesToPinnedLogicGate, pinnedResourceDropBusy]);

  useEffect(() => {
    if (activeHomeView.startsWith("shared:")) return;
    setSelectedSharedTreeIDs((previous) => previous.size === 0 ? previous : new Set());
    setSharedSelectionAnchorTreeID("");
  }, [activeHomeView]);

  useEffect(() => {
    if (!companyID) {
      setSharedInboxes([]);
      return;
    }
    let cancelled = false;
    setLoadingSharedInboxes(true);
    listCommunicationsSharedInboxes(companyID)
      .then((folders) => {
        if (!cancelled) {
          setSharedError("");
          setSharedInboxes(folders);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSharedError(formatSidebarSharedInboxError(error, "Failed to load Shared Emails folders"));
          console.error("Failed to load shared triage folders", error);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSharedInboxes(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyID]);

  useEffect(() => {
    let cancelled = false;
    fetchCommunicationsStatus()
      .then((status) => {
        if (!cancelled) setConnectedAccountEmail(status.connected ? status.connection?.account_email ?? "" : "");
      })
      .catch(() => {
        if (!cancelled) setConnectedAccountEmail("");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!companyID) return undefined;
    const onSharedInboxesUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ companyID?: string }>).detail;
      if (detail?.companyID && detail.companyID !== companyID) return;
      setLoadingSharedInboxes(true);
      listCommunicationsSharedInboxes(companyID)
        .then((folders) => {
          setSharedError("");
          setSharedInboxes(folders);
        })
        .catch((error) => {
          setSharedError(formatSidebarSharedInboxError(error, "Failed to refresh Shared Emails folders"));
          console.error("Failed to refresh shared triage folders", error);
        })
        .finally(() => setLoadingSharedInboxes(false));
    };
    window.addEventListener(EVENT_COMMUNICATIONS_SHARED_INBOXES_UPDATED, onSharedInboxesUpdated);
    return () => window.removeEventListener(EVENT_COMMUNICATIONS_SHARED_INBOXES_UPDATED, onSharedInboxesUpdated);
  }, [companyID]);

  useEffect(() => {
    setExpandedSharedFolderIDs((previous) => {
      if (previous.size > 0 || sharedInboxes.length === 0) return previous;
      return new Set(sharedInboxes.filter((folder) => !folder.parent_folder_id).map((folder) => folder.folder_id));
    });
  }, [sharedInboxes]);

  useEffect(() => {
    const activeFolderID = activeHomeView.startsWith("shared:") ? activeHomeView.slice("shared:".length) : "";
    if (!activeFolderID) return;
    setSharedTriageOpen(true);
    setExpandedSharedFolderIDs((previous) => {
      const next = new Set(previous);
      let current = sharedInboxes.find((folder) => folder.folder_id === activeFolderID);
      let changed = false;
      const seen = new Set<string>();
      while (current?.parent_folder_id && !seen.has(current.parent_folder_id)) {
        seen.add(current.parent_folder_id);
        if (!next.has(current.parent_folder_id)) {
          next.add(current.parent_folder_id);
          changed = true;
        }
        current = sharedInboxes.find((folder) => folder.folder_id === current?.parent_folder_id);
      }
      return changed ? next : previous;
    });
  }, [activeHomeView, sharedInboxes]);

  useEffect(() => {
    if (!renamingSharedFolderID) return;
    window.setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 0);
  }, [renamingSharedFolderID]);

  useEffect(() => {
    if (!sharedEmailDialog) return;
    window.setTimeout(() => {
      sharedEmailInputRef.current?.focus();
      sharedEmailInputRef.current?.select();
    }, 0);
  }, [sharedEmailDialog?.folder.folder_id]);

  useEffect(() => {
    if (!sharedCreateDialog) return;
    window.setTimeout(() => {
      sharedCreateNameInputRef.current?.focus();
      sharedCreateNameInputRef.current?.select();
    }, 0);
  }, [sharedCreateDialog?.parentFolderID]);

  const openSharedContextMenu = useCallback((event: React.MouseEvent, folder: CommunicationsSharedInbox | null) => {
    event.preventDefault();
    event.stopPropagation();
    void fetchCommunicationsStatus()
      .then((status) => setConnectedAccountEmail(status.connected ? status.connection?.account_email ?? "" : ""))
      .catch(() => setConnectedAccountEmail(""));
    setSharedContextMenu({ x: event.clientX, y: event.clientY, folder });
  }, []);

  const toggleSharedFolder = useCallback((folderID: string) => {
    setExpandedSharedFolderIDs((previous) => {
      const next = new Set(previous);
      if (next.has(folderID)) next.delete(folderID);
      else next.add(folderID);
      return next;
    });
  }, []);

  const startSharedRename = useCallback((folder: CommunicationsSharedInbox) => {
    setSharedContextMenu(null);
    skipRenameBlurRef.current = false;
    setRenamingSharedFolderID(folder.folder_id);
    setRenameDraft(folder.name);
  }, []);

  const replaceSharedFolder = useCallback((updated: CommunicationsSharedInbox) => {
    setSharedInboxes((previous) => previous.map((folder) => folder.folder_id === updated.folder_id ? updated : folder));
  }, []);

  const requestSharedInboxEmailConnection = useCallback((connectionError: unknown, accountEmail: string, createIntent?: CommunicationsSharedInboxCreateIntent): boolean => {
    const cleanAccountEmail = accountEmail.trim().toLowerCase();
    if (!cleanAccountEmail || !isSharedInboxEmailConnectionError(connectionError)) return false;
    setSharedEmailConnectionDialog({ accountEmail: cleanAccountEmail, createIntent });
    return true;
  }, []);

  const startSharedInboxEmailConnection = useCallback(async (provider: EmailProvider) => {
    const accountEmail = sharedEmailConnectionDialog?.accountEmail.trim().toLowerCase() ?? "";
    if (!accountEmail || sharedBusy) return;
    setSharedBusy(true);
    setSharedError("");
    try {
      const authURL = await fetchCommunicationsAuthURL(provider, accountEmail, sharedEmailConnectionDialog?.createIntent);
      window.location.assign(authURL);
    } catch (error) {
      setSharedError(formatSidebarSharedInboxError(error, "Failed to start shared inbox email connection"));
      setSharedBusy(false);
    }
  }, [sharedBusy, sharedEmailConnectionDialog]);

  const createSharedFolder = useCallback(async (parentFolderID: string, accountEmail = "", rawName = "") => {
    if (!companyID || sharedBusy) return;
    setSharedContextMenu(null);
    setSharedBusy(true);
    setSharedError("");
    const name = rawName.trim() || accountEmail.trim() || "New Folder";
    try {
      const folder = await createCommunicationsSharedInbox({ companyID, parentFolderID, name, accountEmail });
      setSharedInboxes((previous) => [...previous.filter((item) => item.folder_id !== folder.folder_id), folder]);
      if (parentFolderID) setExpandedSharedFolderIDs((previous) => new Set(previous).add(parentFolderID));
      setSharedTriageOpen(true);
      onHomeViewSelect(`shared:${folder.folder_id}`);
    } catch (error) {
      if (requestSharedInboxEmailConnection(error, accountEmail, { companyID, parentFolderID, name })) return;
      setSharedError(formatSidebarSharedInboxError(error, "Failed to create Shared Emails folder"));
      console.error("Failed to create shared triage folder", error);
    } finally {
      setSharedBusy(false);
    }
  }, [companyID, onHomeViewSelect, requestSharedInboxEmailConnection, sharedBusy]);

  const openSharedInboxCreateDialog = useCallback((parentFolder: CommunicationsSharedInbox | null, mode: "folder" | "shared_inbox") => {
    setSharedContextMenu(null);
    setSharedCreateDialog({
      mode,
      parentFolderID: parentFolder?.folder_id ?? "",
      parentName: parentFolder?.name ?? "",
      name: "",
      accountEmail: mode === "shared_inbox" ? cleanConnectedAccountEmail : "",
      error: "",
    });
  }, [cleanConnectedAccountEmail]);

  const submitSharedInboxCreateDialog = useCallback(async () => {
    if (!companyID || !sharedCreateDialog || sharedBusy) return;
    const name = sharedCreateDialog.name.trim();
    const accountEmail = sharedCreateDialog.accountEmail.trim().toLowerCase();
    if (!name) {
      setSharedCreateDialog((current) => current ? { ...current, error: sharedCreateDialog.mode === "shared_inbox" ? "Enter a shared inbox name." : "Enter a folder name." } : current);
      return;
    }
    if (sharedCreateDialog.mode === "shared_inbox" && !isValidSharedInboxEmail(accountEmail)) {
      setSharedCreateDialog((current) => current ? { ...current, error: "Enter a valid email address." } : current);
      return;
    }
    const parentFolderID = sharedCreateDialog.parentFolderID;
    setSharedCreateDialog(null);
    await createSharedFolder(parentFolderID, sharedCreateDialog.mode === "shared_inbox" ? accountEmail : "", name);
  }, [companyID, createSharedFolder, sharedBusy, sharedCreateDialog]);

  const setSharedFolderAccountEmail = useCallback(async (folderID: string, accountEmail: string) => {
    if (!companyID || sharedBusy) return;
    const current = sharedInboxes.find((folder) => folder.folder_id === folderID.trim());
    if (!current || current.entry_type !== "shared_inbox") {
      setSharedContextMenu(null);
      return;
    }
    setSharedContextMenu(null);
    setSharedBusy(true);
    setSharedError("");
    try {
      const updated = await updateCommunicationsSharedInbox({ companyID, folderID, accountEmail });
      replaceSharedFolder(updated);
    } catch (error) {
      if (requestSharedInboxEmailConnection(error, accountEmail, { companyID, folderID })) return;
      setSharedError(formatSidebarSharedInboxError(error, "Failed to update Shared Emails account"));
      console.error("Failed to update shared triage email account", error);
    } finally {
      setSharedBusy(false);
    }
  }, [companyID, replaceSharedFolder, requestSharedInboxEmailConnection, sharedBusy, sharedInboxes]);

  const openSharedEmailDialog = useCallback((folder: CommunicationsSharedInbox) => {
    if (folder.entry_type !== "shared_inbox") {
      setSharedContextMenu(null);
      return;
    }
    setSharedContextMenu(null);
    setSharedEmailDialog({
      folder,
      draft: (folder.account_email ?? cleanConnectedAccountEmail).trim().toLowerCase(),
      error: "",
    });
  }, [cleanConnectedAccountEmail]);

  const submitSharedEmailDialog = useCallback(() => {
    if (!sharedEmailDialog || sharedBusy) return;
    const accountEmail = sharedEmailDialog.draft.trim().toLowerCase();
    if (!isValidSharedInboxEmail(accountEmail)) {
      setSharedEmailDialog((current) => current ? { ...current, error: "Enter a valid email address." } : current);
      return;
    }
    const folderID = sharedEmailDialog.folder.folder_id;
    setSharedEmailDialog(null);
    void setSharedFolderAccountEmail(folderID, accountEmail);
  }, [setSharedFolderAccountEmail, sharedBusy, sharedEmailDialog]);

  const commitSharedRename = useCallback(async () => {
    const folderID = renamingSharedFolderID.trim();
    const name = renameDraft.trim();
    if (!folderID) return;
    const current = sharedInboxes.find((folder) => folder.folder_id === folderID);
    setRenamingSharedFolderID("");
    setRenameDraft("");
    if (!companyID || !name || name === current?.name) return;
    setSharedBusy(true);
    setSharedError("");
    try {
      const updated = await updateCommunicationsSharedInbox({ companyID, folderID, name });
      replaceSharedFolder(updated);
    } catch (error) {
      setSharedError(formatSidebarSharedInboxError(error, "Failed to rename Shared Emails folder"));
      console.error("Failed to rename shared triage folder", error);
    } finally {
      setSharedBusy(false);
    }
  }, [companyID, renameDraft, renamingSharedFolderID, replaceSharedFolder, sharedInboxes]);

  const canDropSharedFolder = useCallback((sourceFolderID: string, targetFolderID: string) => {
    if (!sourceFolderID || sourceFolderID === targetFolderID) return false;
    if (targetFolderID && isSharedInboxFolderDescendant(sharedInboxes, sourceFolderID, targetFolderID)) return false;
    return sharedInboxes.some((folder) => folder.folder_id === sourceFolderID);
  }, [sharedInboxes]);

  const moveSharedFolder = useCallback(async (sourceFolderID: string, targetFolderID: string, placement: SharedInboxDropPlacement) => {
    if (!companyID || sharedBusy || !canDropSharedFolder(sourceFolderID, targetFolderID)) return;
    let parentFolderID = "";
    let position = getSharedInboxChildPosition(sharedInboxes, "", sourceFolderID);
    if (targetFolderID) {
      const target = sharedInboxes.find((folder) => folder.folder_id === targetFolderID);
      if (!target) return;
      if (placement === "inside") {
        if (target.entry_type === "shared_inbox") return;
        parentFolderID = target.folder_id;
        position = getSharedInboxChildPosition(sharedInboxes, target.folder_id, sourceFolderID);
        setExpandedSharedFolderIDs((previous) => new Set(previous).add(target.folder_id));
      } else {
        parentFolderID = target.parent_folder_id ?? "";
        position = getSharedInboxSiblingPosition(sharedInboxes, sourceFolderID, target.folder_id, placement);
      }
    }
    setDropTarget(null);
    setSharedBusy(true);
    setSharedError("");
    try {
      const updated = await updateCommunicationsSharedInbox({ companyID, folderID: sourceFolderID, parentFolderID, position });
      replaceSharedFolder(updated);
    } catch (error) {
      setSharedError(formatSidebarSharedInboxError(error, "Failed to move Shared Emails folder"));
      console.error("Failed to move shared triage folder", error);
    } finally {
      setSharedBusy(false);
    }
  }, [canDropSharedFolder, companyID, replaceSharedFolder, sharedBusy, sharedInboxes]);

  const requestRemoveSharedFolder = useCallback(async (folder: CommunicationsSharedInbox, position?: ConfirmActionMenuPosition) => {
    if (!companyID || sharedBusy) return;
    const subtreeIDs = collectSharedInboxSubtreeIDs(sharedInboxes, folder.folder_id);
    const label = folder.name.trim() || "this folder";
    if (folder.entry_type === "shared_inbox") {
      if (subtreeIDs.size === 0) subtreeIDs.add(folder.folder_id);
      setSharedDeleteDialog({
        folder,
        action: "remove",
        title: "Remove from Shared Emails",
        detail: "this Shared Emails inbox while keeping the company email connection",
        label,
        confirmLabel: "Remove",
        subtreeIDs,
        position: position ?? null,
      });
      return;
    }
  }, [companyID, sharedBusy, sharedInboxes]);

  const requestDeleteSharedFolder = useCallback(async (folder: CommunicationsSharedInbox, position?: ConfirmActionMenuPosition) => {
    if (!companyID || sharedBusy) return;
    const subtreeIDs = collectSharedInboxSubtreeIDs(sharedInboxes, folder.folder_id);
    const label = folder.name.trim() || "this folder";
    if (folder.entry_type === "shared_inbox") {
      if (subtreeIDs.size === 0) subtreeIDs.add(folder.folder_id);
      setSharedDeleteDialog({
        folder,
        action: "delete",
        title: "Delete email connection",
        detail: "this Shared Emails inbox and its company email connection",
        label,
        confirmLabel: "Delete email",
        subtreeIDs,
        position: position ?? null,
      });
      return;
    }
    const count = subtreeIDs.size || 1;
    const detail = count === 1 ? "this folder" : `this folder and ${count - 1} child item${count === 2 ? "" : "s"}`;
    setSharedDeleteDialog({ folder, action: "delete", title: "Delete folder", detail, label, confirmLabel: "Delete", subtreeIDs, position: position ?? null });
  }, [companyID, sharedBusy, sharedInboxes]);

  const confirmDeleteSharedFolder = useCallback(async () => {
    const dialog = sharedDeleteDialog;
    if (!companyID || !dialog || sharedBusy) return;
    setSharedDeleteDialog(null);
    setSharedBusy(true);
    setSharedError("");
    try {
      if (dialog.action === "remove") {
        await removeCommunicationsSharedInbox(companyID, dialog.folder.folder_id);
      } else {
        await deleteCommunicationsSharedInbox(companyID, dialog.folder.folder_id);
      }
      setSharedInboxes((previous) => previous.filter((item) => !dialog.subtreeIDs.has(item.folder_id)));
      const activeFolderID = activeHomeView.startsWith("shared:") ? activeHomeView.slice("shared:".length) : "";
      if (activeFolderID && dialog.subtreeIDs.has(activeFolderID)) onHomeViewSelect("shared-root");
    } catch (error) {
      setSharedError(formatSidebarSharedInboxError(error, dialog.action === "remove" ? "Failed to remove Shared Emails inbox" : "Failed to delete Shared Emails folder"));
      console.error("Failed to delete shared triage folder", error);
    } finally {
      setSharedBusy(false);
    }
  }, [activeHomeView, companyID, onHomeViewSelect, sharedBusy, sharedDeleteDialog]);

  const selectSharedFolderRow = useCallback((row: SharedInboxTreeRow, event?: React.MouseEvent) => {
    const orderedIDs = sharedRows.map((item) => item.treeID);
    const selected = resolveExplorerClickSelection({
      orderedIDs,
      previousSelectedIDs: selectedSharedTreeIDs,
      anchorID: sharedSelectionAnchorTreeID,
      clickedID: row.treeID,
      shiftKey: !!event?.shiftKey,
      ctrlKey: !!event?.ctrlKey || !!event?.metaKey,
    });
    if (selected.selectedIDs.size === 0) selected.selectedIDs.add(row.treeID);
    const orderedSelectedIDs = orderedIDs.filter((id) => selected.selectedIDs.has(id));
    const nextSelectedIDs = orderedSelectedIDs.length > 0 ? orderedSelectedIDs : [row.treeID];
    setSelectedSharedTreeIDs(new Set(nextSelectedIDs));
    setSharedSelectionAnchorTreeID(selected.anchorID);
    const primaryTreeID = (selected.selectedIDs.has(row.treeID) ? row.treeID : nextSelectedIDs[0]) ?? row.treeID;
    const primaryRow = sharedRows.find((item) => item.treeID === primaryTreeID) ?? row;
    if (primaryRow.folder.entry_type === "shared_inbox") {
      onHomeViewSelect(primaryTreeID as HomeKeyViewID);
    }
  }, [onHomeViewSelect, selectedSharedTreeIDs, sharedRows, sharedSelectionAnchorTreeID]);
  const handleSharedRootDragOver = useCallback((event: React.DragEvent<HTMLElement>) => {
    const sourceFolderID = readSharedTriageFolderDrag(event.dataTransfer) || draggingSharedFolderID;
    if (!canDropSharedFolder(sourceFolderID, "")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget({ folderID: "", placement: "inside" });
  }, [canDropSharedFolder, draggingSharedFolderID]);

  const handleSharedRootDrop = useCallback((event: React.DragEvent<HTMLElement>) => {
    const sourceFolderID = readSharedTriageFolderDrag(event.dataTransfer) || draggingSharedFolderID;
    if (!canDropSharedFolder(sourceFolderID, "")) return;
    event.preventDefault();
    void moveSharedFolder(sourceFolderID, "", "inside");
  }, [canDropSharedFolder, draggingSharedFolderID, moveSharedFolder]);

  const renderSharedFolderRow = (row: SharedInboxTreeRow) => {
    const folder = row.folder;
    const isSharedInbox = folder.entry_type === "shared_inbox";
    const isRenaming = renamingSharedFolderID === folder.folder_id;
    const rowDropPlacement = dropTarget?.folderID === folder.folder_id ? dropTarget.placement : null;
    const treeID = row.treeID as HomeKeyViewID;
    const active = homeActive && (activeHomeView === treeID || selectedSharedTreeIDs.has(row.treeID));
    const hovered = hoveredSharedFolderID === folder.folder_id;
    return (
      <div
        key={folder.folder_id}
        role="button"
        tabIndex={0}
        draggable={!isRenaming && !sharedBusy}
        style={appSidebarSharedFolderRowStyle(row.depth, active, rowDropPlacement, hovered)}
        onPointerEnter={() => setHoveredSharedFolderID(folder.folder_id)}
        onPointerLeave={() => setHoveredSharedFolderID((current) => current === folder.folder_id ? "" : current)}
        onClick={(event) => {
          selectSharedFolderRow(row, event);
          if (!isSharedInbox && row.hasChildren && event.detail <= 1 && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
            toggleSharedFolder(folder.folder_id);
          }
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
          event.preventDefault();
          selectSharedFolderRow(row);
          if (!isSharedInbox && row.hasChildren) toggleSharedFolder(folder.folder_id);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          startSharedRename(folder);
        }}
        onContextMenu={(event) => openSharedContextMenu(event, folder)}
        onDragStart={(event) => {
          if (sharedBusy) {
            event.preventDefault();
            return;
          }
          setDraggingSharedFolderID(folder.folder_id);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(SHARED_TRIAGE_FOLDER_DRAG_MIME, folder.folder_id);
          event.dataTransfer.setData("text/plain", folder.name);
        }}
        onDragOver={(event) => {
          const sourceFolderID = readSharedTriageFolderDrag(event.dataTransfer) || draggingSharedFolderID;
          const placement = getSharedTriageDropPlacement(event);
          if (placement === "inside" && isSharedInbox) return;
          if (!canDropSharedFolder(sourceFolderID, folder.folder_id)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDropTarget({ folderID: folder.folder_id, placement });
        }}
        onDragLeave={() => {
          setDropTarget((current) => current?.folderID === folder.folder_id ? null : current);
        }}
        onDrop={(event) => {
          const sourceFolderID = readSharedTriageFolderDrag(event.dataTransfer) || draggingSharedFolderID;
          const placement = dropTarget?.folderID === folder.folder_id ? dropTarget.placement : getSharedTriageDropPlacement(event);
          if (!canDropSharedFolder(sourceFolderID, folder.folder_id)) return;
          event.preventDefault();
          void moveSharedFolder(sourceFolderID, folder.folder_id, placement);
        }}
        onDragEnd={() => {
          setDraggingSharedFolderID("");
          setDropTarget(null);
        }}
      >
        {row.hasChildren ? (
          <button
            type="button"
            title={expandedSharedFolderIDs.has(folder.folder_id) ? "Collapse folder" : "Expand folder"}
            draggable={false}
            style={appSidebarSharedDisclosureStyle}
            onClick={(event) => {
              event.stopPropagation();
              toggleSharedFolder(folder.folder_id);
            }}
          >
            <ExplorerDisclosureIcon open={expandedSharedFolderIDs.has(folder.folder_id)} color="rgba(15, 23, 42, 0.62)" />
          </button>
        ) : (
          <span style={{ width: 18, height: 20 }} />
        )}
        <span style={appSidebarSharedFolderIconStyle}>
          {isSharedInbox ? <SharedInboxAssignedEmailIcon /> : <ExplorerRowIcon kind="folder" />}
        </span>
        {isRenaming ? (
          <input
            ref={renameInputRef}
            style={appSidebarSharedRenameInputStyle}
            value={renameDraft}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onChange={(event) => setRenameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                void commitSharedRename();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                skipRenameBlurRef.current = true;
                setRenamingSharedFolderID("");
                setRenameDraft("");
              }
            }}
            onBlur={() => {
              if (skipRenameBlurRef.current) {
                skipRenameBlurRef.current = false;
                return;
              }
              void commitSharedRename();
            }}
          />
        ) : (
          <span style={appSidebarSharedLabelStackStyle}>
            <span style={appSidebarTextStyle}>{folder.name}</span>
            {folder.account_email && <span style={appSidebarSharedMetaStyle}>{folder.account_email}</span>}
          </span>
        )}
      </div>
    );
  };

  const explorerSearchHidden = nodeEditorFullscreenChromeActive;
  const explorerSearchActive = !explorerSearchHidden && explorerSearchQuery.trim().length > 0;

  return (
    <aside className="company-explorer-scroll" data-app-sidebar="primary" style={appSidebarStyle}>
      <div style={appSidebarBrandStyle} aria-label="MangoRTS">
        <MangoWordmark size={22} weight={600} />
        {accountChrome && <div style={appSidebarAccountChromeStyle}>{accountChrome}</div>}
      </div>

      {!explorerSearchHidden && (
        <div data-frame-interactive="true" style={appSidebarExplorerSearchContainerStyle}>
          <CompanyExplorerSearchBox
            value={explorerSearchQuery}
            onChange={setExplorerSearchQuery}
            onEscape={() => setExplorerSearchQuery("")}
          />
        </div>
      )}
      {!explorerSearchActive && (
        <>
      <section style={appSidebarNavSectionStyle} aria-label="Live Feed">
        <AppSidebarSectionHeader label="Live Feed" />
        <AppSidebarButton
          label="My Emails"
          active={homeActive && activeHomeView === "my-triage"}
          icon={<HeaderTriageIcon color="#0ea5e9" />}
          elevated
          trailing={<SidebarNotificationBadges badges={[{
            key: "my-triage",
            count: myTriageNotificationCount,
            tone: "mail",
            title: "Open My Emails unread mail",
            onClick: () => openMailBadgeView("my-triage"),
          }]} />}
          onClick={() => onHomeViewSelect("my-triage")}
        />
        <div
          style={appSidebarSharedRootBlockStyle(sharedTriageActive || dropTarget?.folderID === "", sharedTriageHovered || sharedTriageFocused)}
          onPointerEnter={() => setSharedTriageHovered(true)}
          onPointerLeave={() => setSharedTriageHovered(false)}
          onFocus={() => setSharedTriageFocused(true)}
          onBlur={(event) => {
            if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
            setSharedTriageFocused(false);
          }}
        >
          <div
            style={appSidebarSharedTriageRowStyle(sharedTriageActive, dropTarget?.folderID === "", true, sharedTriageOpen)}
            onContextMenu={(event) => openSharedContextMenu(event, null)}
            onClick={() => {
              setSharedTriageOpen((open) => !open);
            }}
            onDragOver={handleSharedRootDragOver}
            onDragLeave={() => setDropTarget((current) => current?.folderID === "" ? null : current)}
            onDrop={handleSharedRootDrop}
          >
            <button
              type="button"
              style={appSidebarSharedTriageButtonStyle}
              onClick={(event) => {
                event.stopPropagation();
                setSharedTriageOpen((open) => !open);
              }}
            >
              <span style={appSidebarSharedIconStyle}><HeaderSharedTriageIcon color="#8b5cf6" /></span>
              <span style={appSidebarTextStyle}>Shared Emails</span>
              <span style={appSidebarTrailingStyle}>
                {loadingSharedInboxes && <span style={appSidebarSharedMetaStyle}>Loading</span>}
                <SidebarNotificationBadges badges={[{
                  key: "shared-triage",
                  count: sharedTriageNotificationCount,
                  tone: "mail",
                  title: "Open Shared Emails unread mail",
                  onClick: () => openMailBadgeView("shared-root"),
                }]} />
              </span>
            </button>
            <button
              type="button"
              title={sharedTriageOpen ? "Collapse Shared Emails folders" : "Expand Shared Emails folders"}
              aria-label={sharedTriageOpen ? "Collapse Shared Emails folders" : "Expand Shared Emails folders"}
              style={appSidebarSharedDisclosureStyle}
              onClick={(event) => {
                event.stopPropagation();
                setSharedTriageOpen((open) => !open);
              }}
            >
              <ExplorerDisclosureIcon open={sharedTriageOpen} color="rgba(15, 23, 42, 0.68)" />
            </button>
          </div>
          {sharedTriageOpen && (
            <div className="app-sidebar-elevated-dropdown" style={appSidebarSharedRowsStyle}>
              {sharedRows.map(renderSharedFolderRow)}
            </div>
          )}
          {sharedError && <div style={appSidebarSharedErrorStyle}>{sharedError}</div>}
        </div>
        <AppSidebarButton
          label="Updates"
          active={homeActive && activeHomeView === "updates"}
          icon={<HeaderUpdatesIcon color="#f59e0b" />}
          splitTrailing
          trailing={<SidebarNotificationBadges large badges={[
            { key: "updates-urgent", label: "!", count: updatesUrgentNotificationCount, tone: "urgent", title: `${updatesUrgentNotificationCount} urgent mentions`, showZero: true, onClick: () => openUpdatesFilter("urgent") },
            { key: "updates-mentions", label: "@", count: updatesMentionNotificationCount, tone: "mention", title: `${updatesMentionNotificationCount} mentions`, showZero: true, onClick: () => openUpdatesFilter("mention") },
            { key: "updates-other", label: <HeaderUpdatesIcon />, count: updatesOtherNotificationCount, tone: "updates", title: `${updatesOtherNotificationCount} regular updates`, showZero: true, onClick: () => openUpdatesFilter("update") },
          ]} />}
          elevated
          onClick={() => {
            restoreSelectedHomeSavedView("updates", companyID, currentUserID);
            onHomeViewSelect("updates");
          }}
        />
        <HomeSavedViewsSidebarSection
          apiBase={apiBase}
          companyID={companyID}
          currentUserID={currentUserID}
          surface="updates"
          active={homeActive && activeHomeView === "updates"}
          onSelectSurface={() => onHomeViewSelect("updates")}
        />
      </section>

      <AppSidebarPinnedSection
        tree={pinTree}
        logicGateStatusCountsByID={logicGateStatusCountsByID}
        dropActive={pinDropActive}
        dropSuccess={pinDropSuccess}
        pinnedResourceDropBusy={pinnedResourceDropBusy}
        onPinOpen={onPinOpen}
        onPinOpenInNewTab={onPinOpenInNewTab}
        onPinRemove={onPinRemove}
        onCreateFolder={onPinCreateFolder}
        onRenameFolder={onPinRenameFolder}
        onDeleteFolder={onPinDeleteFolder}
        onMoveEntry={onPinMoveEntry}
        onGroupPins={onPinGroup}
        onExternalDrop={onPinExternalDrop}
        pinAcceptsResourceDrag={pinAcceptsResourceDrag}
        onPinnedResourceDrop={handlePinnedResourceDrop}
        onPinDragEnter={onPinDragEnter}
        onPinDragLeave={onPinDragLeave}
      />

      <section style={appSidebarNavSectionStyle} aria-label="Tower">
        <AppSidebarSectionHeader label="Tower" />
        <AppSidebarButton
          label="My Work"
          active={activePage === "my-work"}
          icon={<HeaderMyWorkIcon color="#2563eb" />}
          elevated
          onPointerEnter={preloadMyWorkSurface}
          onFocus={preloadMyWorkSurface}
          onPointerDown={preloadMyWorkSurface}
          onClick={() => onPageSelect("my-work")}
        />
        <AppSidebarElevatedActionButton
          label="Projects"
          active={activePage === "project-management"}
          icon={<HeaderProjectManagementIcon color="#3b82f6" />}
          onSelect={() => onPageSelect("project-management")}
          onPreload={preloadProjectManagementSurface}
          actionLabel="Edit Projects view"
          onAction={requestProjectViewSettings}
        />
        <AppSidebarRACITabsSection
          apiBase={apiBase}
          companyID={companyID}
          onOpenLogicGate={(logicGateID, name) => onPinOpen({
            pinID: "",
            id: logicGateID,
            kind: "logic_gate",
            parentFolderID: "",
            name,
            position: 0,
            createdTimestamp: "",
          })}
        />
        <AppSidebarButton
          label="Process Map"
          active={activePage === "process-map"}
          icon={<HeaderMapIcon color="#0ea5e9" />}
          elevated
          onPointerEnter={preloadProcessMapSurface}
          onFocus={preloadProcessMapSurface}
          onPointerDown={preloadProcessMapSurface}
          onClick={() => onPageSelect("process-map")}
        />
        <AppSidebarButton
          label="Entities"
          active={activePage === "entities"}
          icon={<HeaderExplorerIcon color={SIDEBAR_ENTITIES_ICON_COLOR} />}
          elevated
          onPointerEnter={preloadEntitiesSurface}
          onFocus={preloadEntitiesSurface}
          onPointerDown={preloadEntitiesSurface}
          onClick={() => onPageSelect("entities")}
        />
      </section>

        </>
      )}

      <div hidden={explorerSearchActive}>
        <HuddleExplorerSection apiBase={apiBase} companyID={companyID} currentUserID={currentUserID} />
      </div>

      {!explorerSearchActive && (
        <>
      <section style={appSidebarNavSectionStyle} aria-label="Organization">
        <AppSidebarSectionHeader label="Organization" />
        <AppSidebarButton
          label="Accounts"
          active={activePage === "account-manager"}
          icon={<HeaderAccountManagerIcon color={SIDEBAR_ACCOUNT_ICON_COLOR} />}
          elevated
          onPointerEnter={preloadAccountManagerSurface}
          onFocus={preloadAccountManagerSurface}
          onPointerDown={preloadAccountManagerSurface}
          onClick={() => onPageSelect("account-manager")}
        />
        <AppSidebarButton
          label="Teams"
          active={activePage === "teams"}
          icon={<HeaderTeamsIcon color={SIDEBAR_TEAMS_ICON_COLOR} />}
          elevated
          onPointerEnter={preloadTeamsSurface}
          onFocus={preloadTeamsSurface}
          onPointerDown={preloadTeamsSurface}
          onClick={() => onPageSelect("teams")}
        />
      </section>

        </>
      )}

      <AppSidebarCompanyExplorerSection
        selectionTargetFrameIDs={explorerSelectionTargetFrameIDs}
        explorerSearchQuery={explorerSearchQuery}
        explorerSearchActive={explorerSearchActive}
        onExplorerSearchQueryChange={setExplorerSearchQuery}
        onTriageMessagesDrop={requestExplorerTriageMessageDrop}
        dropSuccess={explorerDropSuccess}
      />
      {!explorerSearchActive && WORKTREE_VERSION && (
        <div aria-label={`Worktree version ${WORKTREE_VERSION}`} style={appSidebarVersionStyle}>
          v{WORKTREE_VERSION}
        </div>
      )}
      {explorerTriagePriorityMenu && (
        <FrameRightClickMenu
          x={explorerTriagePriorityMenu.x}
          y={explorerTriagePriorityMenu.y}
          width={244}
          minWidth={244}
          maxWidth={244}
          onClose={() => setExplorerTriagePriorityMenu(null)}
        >
          <div style={appSidebarPriorityMenuTitleStyle}>Priority</div>
          <div style={appSidebarPriorityMenuTargetStyle}>
            Create in {explorerTriagePriorityMenu.target.label}
          </div>
          {INBOX_PRIORITIES.map((priority) => (
            <button
              key={priority.value}
              type="button"
              style={appSidebarPriorityMenuButtonStyle}
              disabled={explorerTriageBusy}
              onClick={() => void pickExplorerTriagePriority(priority.value)}
            >
              {priority.label.replace(/\u00A0/g, " ")}
            </button>
          ))}
        </FrameRightClickMenu>
      )}
      {pinTriagePriorityMenu && (
        <FrameRightClickMenu
          x={pinTriagePriorityMenu.x}
          y={pinTriagePriorityMenu.y}
          width={244}
          minWidth={244}
          maxWidth={244}
          onClose={() => setPinTriagePriorityMenu(null)}
        >
          <div style={appSidebarPriorityMenuTitleStyle}>Priority</div>
          <div style={appSidebarPriorityMenuTargetStyle}>
            {pinTriagePriorityMenu.action.kind === "triage_to_node" ? "Attach to" : "Create in"} {pinTriagePriorityMenu.action.pin.name}
          </div>
          {INBOX_PRIORITIES.map((priority) => (
            <button
              key={priority.value}
              type="button"
              style={appSidebarPriorityMenuButtonStyle}
              disabled={pinnedResourceDropBusy}
              onClick={() => void pickPinnedResourceTriagePriority(priority.value)}
            >
              {priority.label.replace(/\u00A0/g, " ")}
            </button>
          ))}
        </FrameRightClickMenu>
      )}
      {sharedContextMenu && (() => {
        const contextFolder = sharedContextMenu.folder;
        const contextFolderAcceptsChildren = !contextFolder || contextFolder.entry_type !== "shared_inbox";
        return (
          <FrameRightClickMenu x={sharedContextMenu.x} y={sharedContextMenu.y} onClose={() => setSharedContextMenu(null)} width={190}>
            {contextFolderAcceptsChildren && (
              <>
                <button
                  type="button"
                  style={appSidebarContextMenuButtonStyle}
                  disabled={sharedBusy}
                  onClick={() => openSharedInboxCreateDialog(contextFolder, "folder")}
                >
                  Create folder
                </button>
                <button
                  type="button"
                  style={appSidebarContextMenuButtonStyle}
                  disabled={sharedBusy}
                  onClick={() => openSharedInboxCreateDialog(contextFolder, "shared_inbox")}
                >
                  Create shared inbox
                </button>
              </>
            )}
            {contextFolder && (
              <>
                {contextFolder.entry_type === "shared_inbox" && (
                  <>
                    <button
                      type="button"
                      style={appSidebarContextMenuButtonStyle}
                      disabled={sharedBusy}
                      onClick={() => openSharedEmailDialog(contextFolder)}
                    >
                      Change inbox email
                    </button>
                    <button
                      type="button"
                      style={appSidebarContextMenuButtonStyle}
                      disabled={sharedBusy}
                      onClick={(event) => void requestRemoveSharedFolder(contextFolder, confirmMenuPositionFromElement(event.currentTarget))}
                    >
                      Remove from Shared Emails
                    </button>
                  </>
                )}
                <button
                  type="button"
                  style={appSidebarContextMenuButtonStyle}
                  onClick={() => startSharedRename(contextFolder)}
                >
                  Rename
                </button>
                <button
                  type="button"
                  style={{ ...appSidebarContextMenuButtonStyle, color: "#dc2626" }}
                  disabled={sharedBusy}
                  onClick={(event) => void requestDeleteSharedFolder(contextFolder, confirmMenuPositionFromElement(event.currentTarget))}
                >
                  {contextFolder.entry_type === "shared_inbox" ? "Delete email" : "Delete"}
                </button>
              </>
            )}
          </FrameRightClickMenu>
        );
      })()}
      {sharedCreateDialog && (
        <SharedInboxCreateDialog
          nameInputRef={sharedCreateNameInputRef}
          parentName={sharedCreateDialog.parentName}
          mode={sharedCreateDialog.mode}
          name={sharedCreateDialog.name}
          accountEmail={sharedCreateDialog.accountEmail}
          error={sharedCreateDialog.error}
          busy={sharedBusy}
          onNameChange={(name) => setSharedCreateDialog((current) => current ? { ...current, name, error: "" } : current)}
          onAccountEmailChange={(accountEmail) => setSharedCreateDialog((current) => current ? { ...current, accountEmail, error: "" } : current)}
          onCancel={() => setSharedCreateDialog(null)}
          onSubmit={() => { void submitSharedInboxCreateDialog(); }}
        />
      )}
      {sharedEmailDialog && (
        <SharedInboxEmailDialog
          inputRef={sharedEmailInputRef}
          folderName={sharedEmailDialog.folder.name}
          draft={sharedEmailDialog.draft}
          error={sharedEmailDialog.error}
          busy={sharedBusy}
          onDraftChange={(draft) => setSharedEmailDialog((current) => current ? { ...current, draft, error: "" } : current)}
          onCancel={() => setSharedEmailDialog(null)}
          onSubmit={submitSharedEmailDialog}
        />
      )}
      {sharedDeleteDialog && (
        <SharedInboxDeleteDialog
          title={sharedDeleteDialog.title}
          label={sharedDeleteDialog.label}
          detail={sharedDeleteDialog.detail}
          confirmLabel={sharedDeleteDialog.confirmLabel}
          position={sharedDeleteDialog.position}
          busy={sharedBusy}
          onCancel={() => setSharedDeleteDialog(null)}
          onConfirm={() => { void confirmDeleteSharedFolder(); }}
        />
      )}
      {sharedEmailConnectionDialog && (
        <SharedInboxEmailConnectionDialog
          accountEmail={sharedEmailConnectionDialog.accountEmail}
          busy={sharedBusy}
          onCancel={() => setSharedEmailConnectionDialog(null)}
          onConnect={(provider) => { void startSharedInboxEmailConnection(provider); }}
        />
      )}
    </aside>
  );
}

function AppSidebarSectionHeader({ label, icon }: { label: string; icon?: React.ReactNode }): React.ReactElement {
  return (
    <div style={appSidebarSectionHeaderShellStyle}>
      <span style={appSidebarSectionTitleRowStyle}>
        {icon && <span style={appSidebarSectionIconStyle}>{icon}</span>}
        <span style={appSidebarSectionTitleStyle}>{label}</span>
      </span>
      <span aria-hidden="true" style={appSidebarSectionHeaderLineStyle} />
    </div>
  );
}

function AppSidebarCompanyExplorerSection({
  selectionTargetFrameIDs,
  explorerSearchQuery,
  explorerSearchActive,
  onExplorerSearchQueryChange,
  onTriageMessagesDrop,
  dropSuccess,
}: {
  selectionTargetFrameIDs: string[];
  explorerSearchQuery: string;
  explorerSearchActive: boolean;
  onExplorerSearchQueryChange: React.Dispatch<React.SetStateAction<string>>;
  onTriageMessagesDrop: CompanyExplorerTriageMessageDropHandler;
  dropSuccess: string;
}): React.ReactElement {
  return (
    <section style={appSidebarCompanyExplorerSectionStyle(explorerSearchActive)} aria-label="Company Explorer">
      {!explorerSearchActive && <AppSidebarSectionHeader label="Explorer" icon={<HeaderExplorerIcon color="#f97316" />} />}
      {dropSuccess && (
        <div role="status" style={appSidebarExplorerSuccessStyle}>
          {dropSuccess}
        </div>
      )}
      <React.Suspense fallback={<div aria-busy="true" style={appSidebarExplorerFallbackStyle} />}>
        <SidebarCompanyExplorerContent
          accent={SIDEBAR_ACTIVE_TEXT}
          widgetId={SIDEBAR_EXPLORER_WIDGET_ID}
          theme="light"
          useParentScroll
          selectionTargetFrameIDs={selectionTargetFrameIDs}
          externalSearchQuery={explorerSearchQuery}
          hideTopControls={explorerSearchActive}
          onSearchResultSelect={() => {
            onExplorerSearchQueryChange("");
          }}
          onTriageMessagesDrop={onTriageMessagesDrop}
        />
      </React.Suspense>
    </section>
  );
}

type SidebarNotificationBadgeTone = "mail" | "urgent" | "mention" | "updates";

type SidebarNotificationBadge = {
  key: string;
  label?: React.ReactNode;
  count: number;
  tone: SidebarNotificationBadgeTone;
  title: string;
  showZero?: boolean;
  onClick?: (event: React.MouseEvent) => void;
};

function normalizeSidebarNotificationCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function SidebarNotificationBadges({ badges, large = false }: { badges: SidebarNotificationBadge[]; large?: boolean }): React.ReactElement | null {
  const visible = badges.filter((badge) => badge.showZero || normalizeSidebarNotificationCount(badge.count) > 0);
  if (visible.length === 0) return null;
  return (
    <span style={large ? appSidebarLargeBadgeStripStyle : appSidebarBadgeStripStyle} aria-label="Update counts">
      {visible.map((badge) => {
        const highlighted = !large || normalizeSidebarNotificationCount(badge.count) > 0;
        return (
          <span
            key={badge.key}
            title={badge.title}
            aria-label={badge.title}
            style={appSidebarNotificationBadgeStyle(badge.tone, highlighted, large)}
            onClick={(event) => {
              if (!badge.onClick) return;
              event.preventDefault();
              event.stopPropagation();
              badge.onClick(event);
            }}
          >
            {badge.label && <span style={appSidebarNotificationBadgeLabelStyle(large)}>{badge.label}</span>}
            <span style={appSidebarNotificationBadgeCountStyle(large)}>{formatSidebarNotificationCount(badge.count)}</span>
          </span>
        );
      })}
    </span>
  );
}

function formatSidebarNotificationCount(count: number): string {
  const normalized = normalizeSidebarNotificationCount(count);
  return normalized > 99 ? "99+" : String(normalized);
}

function AppSidebarButton({
  label,
  active,
  icon,
  trailing,
  splitTrailing = false,
  elevated = false,
  onClick,
  onPointerEnter,
  onFocus,
  onPointerDown,
}: {
  label: string;
  active: boolean;
  icon?: React.ReactNode;
  trailing?: React.ReactNode;
  splitTrailing?: boolean;
  elevated?: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onPointerEnter?: () => void;
  onFocus?: () => void;
  onPointerDown?: () => void;
}): React.ReactElement {
  const [raised, setRaised] = useState(false);
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      style={appSidebarButtonStyle(active, !!icon, !!trailing, elevated, raised, splitTrailing)}
      onPointerEnter={() => {
        setRaised(true);
        onPointerEnter?.();
      }}
      onPointerLeave={() => setRaised(false)}
      onFocus={() => {
        setRaised(true);
        onFocus?.();
      }}
      onBlur={() => setRaised(false)}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      {splitTrailing ? (
        <span style={appSidebarLeadingStyle}>
          {icon && <span style={appSidebarButtonIconStyle}>{icon}</span>}
          <span style={appSidebarTextStyle}>{label}</span>
        </span>
      ) : (
        <>
          {icon && <span style={appSidebarButtonIconStyle}>{icon}</span>}
          <span style={appSidebarTextStyle}>{label}</span>
        </>
      )}
      {trailing && <span style={splitTrailing ? appSidebarSplitTrailingStyle : appSidebarTrailingStyle}>{trailing}</span>}
    </button>
  );
}

function AppSidebarElevatedActionButton({
  label,
  active,
  icon,
  actionLabel,
  onSelect,
  onPreload,
  onAction,
}: {
  label: string;
  active: boolean;
  icon: React.ReactNode;
  actionLabel: string;
  onSelect: () => void;
  onPreload?: () => void;
  onAction: (anchor: DOMRect) => void;
}): React.ReactElement {
  const [raised, setRaised] = useState(false);
  return (
    <div
      style={appSidebarSharedRootBlockStyle(active, raised)}
      onPointerEnter={() => {
        setRaised(true);
        onPreload?.();
      }}
      onPointerLeave={() => setRaised(false)}
      onFocus={() => {
        setRaised(true);
        onPreload?.();
      }}
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        setRaised(false);
      }}
      onPointerDown={onPreload}
    >
      <div style={appSidebarSharedTriageRowStyle(active, false, true)}>
        <button
          type="button"
          aria-current={active ? "page" : undefined}
          style={appSidebarSharedTriageButtonStyle}
          onClick={onSelect}
        >
          <span style={appSidebarSharedIconStyle}>{icon}</span>
          <span style={appSidebarTextStyle}>{label}</span>
        </button>
        <button
          type="button"
          title={actionLabel}
          aria-label={actionLabel}
          style={appSidebarSharedDisclosureStyle}
          onClick={(event) => {
            event.stopPropagation();
            onAction(event.currentTarget.getBoundingClientRect());
          }}
        >
          <span aria-hidden="true" style={appSidebarEllipsisStyle}>•••</span>
        </button>
      </div>
    </div>
  );
}

const SharedInboxAssignedEmailIcon: React.FC = () => (
  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" style={{ display: "block", flexShrink: 0 }}>
    <rect x="2.35" y="3.15" width="11.3" height="9.7" rx="1.9" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <path d="m3.35 5.25 3.78 3.02c.51.41 1.23.41 1.74 0l3.78-3.02" fill="none" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M4.45 10.55h7.1" fill="none" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
  </svg>
);

function nodeEditorPopupMaxSize(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 1180, height: 820 };
  return {
    width: Math.max(NODE_EDITOR_POPUP_MIN_WIDTH, window.innerWidth - NODE_EDITOR_POPUP_VIEWPORT_WIDTH_INSET),
    height: Math.max(NODE_EDITOR_POPUP_MIN_HEIGHT, window.innerHeight - NODE_EDITOR_POPUP_VIEWPORT_HEIGHT_INSET),
  };
}

function clampNodeEditorPopupSize(size: { width: number; height: number }): { width: number; height: number } {
  const max = nodeEditorPopupMaxSize();
  return {
    width: Math.max(NODE_EDITOR_POPUP_MIN_WIDTH, Math.min(Math.round(size.width), max.width)),
    height: Math.max(NODE_EDITOR_POPUP_MIN_HEIGHT, Math.min(Math.round(size.height), max.height)),
  };
}

type NodeEditorPopupRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function nodeEditorPopupViewportPadding(): { x: number; y: number } {
  return {
    x: NODE_EDITOR_POPUP_VIEWPORT_WIDTH_INSET / 2,
    y: NODE_EDITOR_POPUP_VIEWPORT_HEIGHT_INSET / 2,
  };
}

function nodeEditorPopupSidebarBoundary(): number | null {
  if (typeof document === "undefined") return null;
  const selectors = [
    "[data-app-sidebar=\"primary\"]",
    "[data-app-sidebar-resize-handle=\"primary\"]",
  ];
  let boundary: number | null = null;
  for (const selector of selectors) {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) continue;
    boundary = Math.max(boundary ?? 0, rect.right);
  }
  return boundary;
}

function nodeEditorPopupMinimumLeft(): number {
  const padding = nodeEditorPopupViewportPadding();
  const sidebarBoundary = nodeEditorPopupSidebarBoundary();
  if (sidebarBoundary == null) return padding.x;
  return Math.max(padding.x, Math.ceil(sidebarBoundary) + NODE_EDITOR_POPUP_SIDEBAR_BUFFER);
}

function nodeEditorPopupAvailableWidth(left: number): number {
  if (typeof window === "undefined") return Number.POSITIVE_INFINITY;
  const padding = nodeEditorPopupViewportPadding();
  return Math.max(1, window.innerWidth - padding.x - left);
}

function nodeEditorPopupDynamicBoundsStyle(left: number): React.CSSProperties {
  if (typeof window === "undefined") return {};
  const availableWidth = nodeEditorPopupAvailableWidth(left);
  return {
    maxWidth: availableWidth,
    minWidth: Math.min(NODE_EDITOR_POPUP_MIN_WIDTH, availableWidth),
  };
}

function clampNodeEditorPopupRect(rect: NodeEditorPopupRect): NodeEditorPopupRect {
  let size = clampNodeEditorPopupSize(rect);
  if (typeof window === "undefined") {
    return { left: Math.max(0, Math.round(rect.left)), top: Math.max(0, Math.round(rect.top)), ...size };
  }
  const padding = nodeEditorPopupViewportPadding();
  const minLeft = nodeEditorPopupMinimumLeft();
  size = { ...size, width: Math.min(size.width, nodeEditorPopupAvailableWidth(minLeft)) };
  const minTop = padding.y;
  const maxLeft = Math.max(minLeft, window.innerWidth - padding.x - size.width);
  const maxTop = Math.max(minTop, window.innerHeight - padding.y - size.height);
  return {
    left: Math.max(minLeft, Math.min(Math.round(rect.left), maxLeft)),
    top: Math.max(minTop, Math.min(Math.round(rect.top), maxTop)),
    ...size,
  };
}

function nodeEditorPopupSizeStorageKey(): string {
  const companyID = getActiveCompanyID().trim() || "global";
  return `${NODE_EDITOR_POPUP_SIZE_STORAGE_KEY_PREFIX}:${companyID}`;
}

function readStoredNodeEditorPopupSize(): { width: number; height: number } | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(nodeEditorPopupSizeStorageKey()) ?? "") as Partial<{ width: number; height: number }>;
    const width = parsed.width;
    const height = parsed.height;
    if (typeof width !== "number" || typeof height !== "number") return null;
    return clampNodeEditorPopupSize({ width, height });
  } catch {
    return null;
  }
}

function SharedInboxEmailDialog({ inputRef, folderName, draft, error, busy, onDraftChange, onSubmit, onCancel }: {
  inputRef: React.RefObject<HTMLInputElement>;
  folderName: string;
  draft: string;
  error: string;
  busy: boolean;
  onDraftChange: (draft: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}): React.ReactElement {
  const label = folderName.trim() || "this inbox";
  return (
    <AppModalPortal onRequestClose={busy ? undefined : onCancel}>
    <div style={sharedInboxEmailModalBackdropStyle} onPointerDown={(event) => { if (!busy && event.target === event.currentTarget) onCancel(); }}>
      <form
        className="mango-shared-inbox-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Assign email to inbox"
        style={sharedInboxEmailModalStyle}
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div aria-hidden="true" style={sharedInboxEmailModalAccentStyle} />
        <div style={sharedInboxEmailModalTitleStyle}>Assign email to inbox</div>
        <div style={sharedInboxEmailModalDetailStyle}>Type down the email that you want to use here.</div>
        <label style={sharedInboxEmailModalLabelStyle}>
          <span>{label}</span>
          <input
            ref={inputRef}
            type="email"
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder="name@example.com"
            disabled={busy}
            className="mango-shared-inbox-dialog-input"
            style={sharedInboxEmailModalInputStyle}
          />
        </label>
        {error && <div style={sharedInboxEmailModalErrorStyle}>{error}</div>}
        <div style={sharedInboxEmailModalActionsStyle}>
          <button className="mango-shared-inbox-dialog-action mango-shared-inbox-dialog-action-secondary" type="button" disabled={busy} onClick={onCancel} style={sharedInboxEmailModalSecondaryButtonStyle}>Cancel</button>
          <button className="mango-shared-inbox-dialog-action mango-shared-inbox-dialog-action-primary" type="submit" disabled={busy} style={sharedInboxEmailModalPrimaryButtonStyle}>{busy ? "Saving" : "Save"}</button>
        </div>
      </form>
    </div>
    </AppModalPortal>
  );
}

function SharedInboxCreateDialog({ nameInputRef, parentName, mode, name, accountEmail, error, busy, onNameChange, onAccountEmailChange, onSubmit, onCancel }: {
  nameInputRef: React.RefObject<HTMLInputElement>;
  parentName: string;
  mode: "folder" | "shared_inbox";
  name: string;
  accountEmail: string;
  error: string;
  busy: boolean;
  onNameChange: (name: string) => void;
  onAccountEmailChange: (accountEmail: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}): React.ReactElement {
  const parentLabel = parentName.trim();
  const isSharedInbox = mode === "shared_inbox";
  return (
    <AppModalPortal onRequestClose={busy ? undefined : onCancel}>
    <div style={sharedInboxEmailModalBackdropStyle} onPointerDown={(event) => { if (!busy && event.target === event.currentTarget) onCancel(); }}>
      <form
        className="mango-shared-inbox-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={isSharedInbox ? "Create shared inbox" : "Create Shared Emails folder"}
        style={sharedInboxEmailModalStyle}
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div aria-hidden="true" style={sharedInboxEmailModalAccentStyle} />
        <div style={sharedInboxEmailModalTitleStyle}>{isSharedInbox ? "Create shared inbox" : "Create folder"}</div>
        <div style={sharedInboxEmailModalDetailStyle}>{parentLabel ? `Inside ${parentLabel}` : "Shared Emails"}</div>
        <label style={sharedInboxEmailModalLabelStyle}>
          <span>Name</span>
          <input
            ref={nameInputRef}
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder={isSharedInbox ? "Support inbox" : "Finance"}
            disabled={busy}
            className="mango-shared-inbox-dialog-input"
            style={sharedInboxEmailModalInputStyle}
          />
        </label>
        {isSharedInbox && (
          <label style={sharedInboxEmailModalLabelStyle}>
            <span>Email</span>
            <input
              type="email"
              value={accountEmail}
              onChange={(event) => onAccountEmailChange(event.target.value)}
              placeholder="support@example.com"
              disabled={busy}
              className="mango-shared-inbox-dialog-input"
              style={sharedInboxEmailModalInputStyle}
            />
          </label>
        )}
        {error && <div style={sharedInboxEmailModalErrorStyle}>{error}</div>}
        <div style={sharedInboxEmailModalActionsStyle}>
          <button className="mango-shared-inbox-dialog-action mango-shared-inbox-dialog-action-secondary" type="button" disabled={busy} onClick={onCancel} style={sharedInboxEmailModalSecondaryButtonStyle}>Cancel</button>
          <button className="mango-shared-inbox-dialog-action mango-shared-inbox-dialog-action-primary" type="submit" disabled={busy} style={sharedInboxEmailModalPrimaryButtonStyle}>{busy ? "Creating" : "Create"}</button>
        </div>
      </form>
    </div>
    </AppModalPortal>
  );
}

function SharedInboxDeleteDialog({ title, label, detail, confirmLabel, position, busy, onConfirm, onCancel }: {
  title: string;
  label: string;
  detail: string;
  confirmLabel: string;
  position?: ConfirmActionMenuPosition | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactElement {
  return (
    <ConfirmActionMenu
      title={title}
      detail={`Delete ${detail}: ${label}?`}
      position={position}
      confirmLabel={busy ? "Deleting" : confirmLabel}
      cancelLabel="No"
      confirmDisabled={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

function SharedInboxEmailConnectionDialog({ accountEmail, busy, onConnect, onCancel }: {
  accountEmail: string;
  busy: boolean;
  onConnect: (provider: EmailProvider) => void;
  onCancel: () => void;
}): React.ReactElement {
  return (
    <AppModalPortal onRequestClose={busy ? undefined : onCancel}>
    <div style={sharedInboxEmailModalBackdropStyle} onPointerDown={(event) => { if (!busy && event.target === event.currentTarget) onCancel(); }}>
      <div
        className="mango-shared-inbox-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Connect shared inbox email"
        style={sharedInboxEmailModalStyle}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div aria-hidden="true" style={sharedInboxEmailModalAccentStyle} />
        <div style={sharedInboxEmailModalTitleStyle}>Connect shared inbox email</div>
        <div style={sharedInboxEmailModalDetailStyle}>{accountEmail} is not connected yet.</div>
        <div style={sharedInboxEmailModalActionsStyle}>
          <button className="mango-shared-inbox-dialog-action mango-shared-inbox-dialog-action-primary" type="button" disabled={busy} onClick={() => onConnect("google")} style={sharedInboxEmailModalPrimaryButtonStyle}>Google</button>
          <button className="mango-shared-inbox-dialog-action mango-shared-inbox-dialog-action-primary" type="button" disabled={busy} onClick={() => onConnect("microsoft")} style={sharedInboxEmailModalPrimaryButtonStyle}>Microsoft</button>
        </div>
        <button className="mango-shared-inbox-dialog-action mango-shared-inbox-dialog-action-secondary" type="button" disabled={busy} onClick={onCancel} style={sharedInboxEmailModalSecondaryButtonStyle}>Cancel</button>
      </div>
    </div>
    </AppModalPortal>
  );
}

function storeNodeEditorPopupSize(size: { width: number; height: number }) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(nodeEditorPopupSizeStorageKey(), JSON.stringify(clampNodeEditorPopupSize(size)));
}

function defaultNodeEditorPopupSize(): { width: number; height: number } {
  return readStoredNodeEditorPopupSize() ?? nodeEditorPopupMaxSize();
}

function defaultNodeEditorPopupRect(): NodeEditorPopupRect {
  const size = defaultNodeEditorPopupSize();
  if (typeof window === "undefined") return { left: 0, top: 0, ...size };
  return clampNodeEditorPopupRect({
    left: (window.innerWidth - size.width) / 2,
    top: (window.innerHeight - size.height) / 2,
    ...size,
  });
}

function fullscreenNodeEditorPopupRect(): NodeEditorPopupRect {
  if (typeof window === "undefined") return defaultNodeEditorPopupRect();
  return fullscreenNodeEditorViewportRect();
}

function sidebarFillNodeEditorPopupRect(): NodeEditorPopupRect {
  if (typeof window === "undefined") return defaultNodeEditorPopupRect();
  const left = Math.max(0, Math.min(window.innerWidth, Math.ceil(nodeEditorPopupSidebarBoundary() ?? 0)));
  return {
    left,
    top: 0,
    width: Math.max(0, window.innerWidth - left),
    height: Math.max(0, window.innerHeight),
  };
}

type NodeEditorPopupViewMode = "windowed" | "sidebar-fill" | "fullscreen";

type NodeEditorPopupRestoreState = {
  rect: NodeEditorPopupRect;
  viewMode: Exclude<NodeEditorPopupViewMode, "fullscreen">;
};

export function AppNodeEditorPopup({ nodeID, nodeTitle, surfaceID = "app-sidebar-node-popup", focusInformationID, focusRequestID, initialSidebarFill = false, onClose, onHierarchyNavigate, onCollapseToTab, onOpenInNewTab, onDeleteNode }: {
  nodeID: string;
  nodeTitle: string;
  surfaceID?: "app-sidebar-node-popup" | "dock-restored-node-popup";
  focusInformationID?: string;
  focusRequestID?: number;
  initialSidebarFill?: boolean;
  onClose: () => void;
  onHierarchyNavigate?: () => void;
  onCollapseToTab?: () => void;
  onOpenInNewTab?: () => void;
  onDeleteNode?: (nodeID: string, confirmationDisplayName: string) => boolean | void | Promise<boolean | void>;
}): React.ReactElement {
  const [popupRect, setPopupRect] = useState(() => initialSidebarFill ? sidebarFillNodeEditorPopupRect() : defaultNodeEditorPopupRect());
  const [popupViewMode, setPopupViewMode] = useState<NodeEditorPopupViewMode>(initialSidebarFill ? "sidebar-fill" : "windowed");
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ position?: ConfirmActionMenuPosition | null } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const popupRectRef = useRef(popupRect);
  const restorePopupRef = useRef<NodeEditorPopupRestoreState | null>(null);
  const popupFullscreen = popupViewMode === "fullscreen";
  const popupSidebarFill = popupViewMode === "sidebar-fill";

  useEffect(() => {
    popupRectRef.current = popupRect;
  }, [popupRect]);

  useEffect(() => setNodeEditorFullscreenChromeActiveFlag(popupFullscreen), [popupFullscreen]);

  useEffect(() => {
    const onResize = () => setPopupRect((current) => {
      if (popupFullscreen) return fullscreenNodeEditorPopupRect();
      if (popupSidebarFill) return sidebarFillNodeEditorPopupRect();
      return clampNodeEditorPopupRect(current);
    });
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onResize);
    for (const selector of ["[data-app-sidebar=\"primary\"]", "[data-app-sidebar-resize-handle=\"primary\"]"]) {
      const element = document.querySelector<HTMLElement>(selector);
      if (element) resizeObserver?.observe(element);
    }
    window.addEventListener("resize", onResize);
    onResize();
    return () => {
      window.removeEventListener("resize", onResize);
      resizeObserver?.disconnect();
    };
  }, [popupFullscreen, popupSidebarFill]);

  const togglePopupFullscreen = useCallback(() => {
    if (popupFullscreen) {
      const restore = restorePopupRef.current;
      const restoredViewMode = restore?.viewMode ?? "windowed";
      const restoredRect = restoredViewMode === "sidebar-fill"
        ? sidebarFillNodeEditorPopupRect()
        : restore
          ? clampNodeEditorPopupRect(restore.rect)
          : defaultNodeEditorPopupRect();
      restorePopupRef.current = null;
      popupRectRef.current = restoredRect;
      setPopupRect(restoredRect);
      setPopupViewMode(restoredViewMode);
      return;
    }
    restorePopupRef.current = { rect: popupRectRef.current, viewMode: popupSidebarFill ? "sidebar-fill" : "windowed" };
    const next = fullscreenNodeEditorPopupRect();
    popupRectRef.current = next;
    setPopupRect(next);
    setPopupViewMode("fullscreen");
  }, [popupFullscreen, popupSidebarFill]);

  const startPopupResize = useCallback((event: React.PointerEvent<HTMLDivElement>, handle: NodeEditorPopupResizeHandle) => {
    event.preventDefault();
    event.stopPropagation();
    const ownerDocument = event.currentTarget.ownerDocument;
    const startX = event.clientX;
    const startY = event.clientY;
    const startRect = popupRectRef.current;
    const previousCursor = ownerDocument.body.style.cursor;
    ownerDocument.body.style.cursor = handle.cursor;

    const onPointerMove = (pointerEvent: PointerEvent) => {
      const deltaX = pointerEvent.clientX - startX;
      const deltaY = pointerEvent.clientY - startY;
      const desiredWidth = handle.horizontal < 0
        ? startRect.width - deltaX
        : handle.horizontal > 0
          ? startRect.width + deltaX
          : startRect.width;
      const desiredHeight = handle.vertical < 0
        ? startRect.height - deltaY
        : handle.vertical > 0
          ? startRect.height + deltaY
          : startRect.height;
      const nextSize = clampNodeEditorPopupSize({ width: desiredWidth, height: desiredHeight });
      const nextRect = clampNodeEditorPopupRect({
        left: handle.horizontal < 0 ? startRect.left + startRect.width - nextSize.width : startRect.left,
        top: handle.vertical < 0 ? startRect.top + startRect.height - nextSize.height : startRect.top,
        ...nextSize,
      });
      popupRectRef.current = nextRect;
      setPopupRect(nextRect);
      setPopupViewMode("windowed");
    };
    const finish = () => {
      ownerDocument.body.style.cursor = previousCursor;
      ownerDocument.removeEventListener("pointermove", onPointerMove);
      ownerDocument.removeEventListener("pointerup", finish);
      ownerDocument.removeEventListener("pointercancel", finish);
      storeNodeEditorPopupSize(popupRectRef.current);
    };

    ownerDocument.addEventListener("pointermove", onPointerMove);
    ownerDocument.addEventListener("pointerup", finish);
    ownerDocument.addEventListener("pointercancel", finish);
  }, []);

  const requestDeleteNode = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setDeleteConfirmation({ position: confirmMenuPositionFromElement(event.currentTarget) });
  }, []);

  const confirmDeleteNode = useCallback(async (confirmationDisplayName: string) => {
    if (!onDeleteNode || deleteBusy) return;
    setDeleteBusy(true);
    try {
      const deleted = await onDeleteNode(nodeID, confirmationDisplayName);
      if (deleted === false) return;
      setDeleteConfirmation(null);
      onClose();
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteBusy, nodeID, onClose, onDeleteNode]);

  return (
    <AppModalPortal trapFocus={!popupSidebarFill} onRequestClose={onClose}>
      <div
      style={{
        ...nodeEditorPopupBackdropStyle,
        left: popupSidebarFill ? popupRect.left : 0,
        background: popupSidebarFill ? "transparent" : nodeEditorPopupBackdropStyle.background,
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <UnifiedNodeShell
        surfaceID={surfaceID}
        title={nodeTitle}
        role={popupSidebarFill ? "group" : "dialog"}
        ariaModal={!popupSidebarFill}
        actionButtonStyle={nodeEditorPopupCollapseButtonStyle}
        closeButtonStyle={nodeEditorPopupCloseButtonStyle}
        style={{ ...nodeEditorPopupStyle, ...(popupFullscreen ? nodeEditorPopupFullscreenStyle : popupSidebarFill ? nodeEditorPopupSidebarFillStyle : nodeEditorPopupDynamicBoundsStyle(popupRect.left)), left: popupSidebarFill ? 0 : popupRect.left, top: popupRect.top, width: popupRect.width, height: popupRect.height }}
        onMouseDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
        actions={([
          onDeleteNode ? {
            id: "delete",
            danger: true,
            onClick: requestDeleteNode,
          } : null,
          onOpenInNewTab ? {
            id: "open-in-new-tab",
            onClick: onOpenInNewTab,
          } : null,
          {
            id: "pin",
            title: "Pin node to Pinned",
            ariaLabel: "Pin node to Pinned",
            onClick: () => requestAppSidebarPin({ kind: "node", id: nodeID, name: nodeTitle }),
          },
          onCollapseToTab ? {
            id: "minimize",
            onClick: onCollapseToTab,
          } : null,
          {
            id: "fullscreen",
            pressed: popupFullscreen,
            onClick: togglePopupFullscreen,
          },
          {
            id: "close",
            onClick: onClose,
          },
        ].filter(Boolean) as UnifiedNodeShellAction[])}
        chrome={NODE_EDITOR_POPUP_RESIZE_HANDLES.map((handle) => (
          <div
            key={handle.key}
            role="separator"
            aria-label={`Resize node editor ${handle.key}`}
            data-frame-interactive="true"
            onPointerDown={(event) => startPopupResize(event, handle)}
            style={{
              position: "absolute",
              zIndex: 9,
              touchAction: "none",
              cursor: handle.cursor,
              background: "transparent",
              ...handle.style,
            }}
          />
        ))}
      >
        <React.Suspense fallback={fullPageFallback}>
          <AppNodeEditorContent
            accent="#334155"
            widgetId={`app-explorer-node-editor-popup:${nodeID}`}
            theme="mango"
            forcedEntityKind="node"
            forcedEntityID={nodeID}
            forcedLabel={nodeTitle}
            focusInformationID={focusInformationID}
            focusRequestID={focusRequestID}
            onBeforeHierarchyNavigate={popupSidebarFill ? undefined : (onHierarchyNavigate ?? onClose)}
          />
        </React.Suspense>
        {deleteConfirmation && (
          <ConfirmActionMenu
            title="Are you sure you want to delete this node?"
            detail="This moves the node to the Recycle Bin."
            position={deleteConfirmation.position}
            confirmLabel={deleteBusy ? "Deleting" : "Yes"}
            cancelLabel="No"
            confirmDisabled={deleteBusy}
            onConfirm={(confirmationDisplayName) => { void confirmDeleteNode(confirmationDisplayName); }}
            onCancel={() => setDeleteConfirmation(null)}
          />
        )}
      </UnifiedNodeShell>
      </div>
    </AppModalPortal>
  );
}

const appSidebarStyle: React.CSSProperties = {
  minHeight: 0,
  height: "100%",
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: 10,
  padding: 10,
  borderRadius: PAGE_SURFACE_RADIUS,
  background: "linear-gradient(180deg, #fbfbfd 0%, #f2f4f8 100%)",
  color: UI_THEME.text,
  boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.72), inset 5px 5px 16px rgba(174, 174, 192, 0.16), inset -5px -5px 16px rgba(255, 255, 255, 0.86), 0 12px 28px rgba(15, 23, 42, 0.14)",
  overflowY: "auto",
  overflowX: "hidden",
  overscrollBehavior: "contain",
  scrollbarGutter: "stable",
  ["--company-explorer-scroll-accent" as string]: SIDEBAR_SCROLL_ACCENT,
  ["--company-explorer-scroll-track" as string]: "rgba(100, 116, 139, 0.10)",
  ["--company-explorer-hover-bg" as string]: SIDEBAR_STATE_HOVER_BG,
};

const appSidebarBrandStyle: React.CSSProperties = {
  flex: "0 0 auto",
  minHeight: 42,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 8,
  padding: "5px 6px 5px",
  color: "#111827",
  minWidth: 0,
};

const appSidebarAccountChromeStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  minWidth: 0,
};

const appSidebarExplorerSearchContainerStyle: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 40,
  flex: "0 0 auto",
  display: "grid",
  minWidth: 0,
  margin: "-2px 3px 0",
  borderRadius: 10,
  background: "transparent",
  boxShadow: "none",
};

const appSidebarNavSectionStyle: React.CSSProperties = {
  position: "relative",
  flex: "0 0 auto",
  display: "grid",
  gap: 8,
  minWidth: 0,
  padding: "0 3px 10px",
};

const appSidebarSectionHeaderShellStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gridTemplateRows: "auto 1px",
  gap: 5,
  padding: "0 3px",
};

const appSidebarSectionTitleRowStyle: React.CSSProperties = {
  minWidth: 0,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

const appSidebarSectionIconStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  display: "grid",
  placeItems: "center",
  flex: "0 0 auto",
};

const appSidebarSectionHeaderLineStyle: React.CSSProperties = {
  minWidth: 0,
  height: 1,
  background: SIDEBAR_DIVIDER,
};

function appSidebarCompanyExplorerSectionStyle(searchActive: boolean): React.CSSProperties {
  return {
    flex: searchActive ? "1 1 auto" : "0 0 auto",
    minHeight: searchActive ? 0 : undefined,
    minWidth: 0,
    display: "grid",
    position: "relative",
    alignContent: searchActive ? "stretch" : undefined,
    gap: searchActive ? 0 : 6,
    padding: searchActive ? "0" : "0 0 10px",
  };
}

const appSidebarSectionTitleStyle: React.CSSProperties = {
  padding: "0 6px",
  color: "#111111",
  fontSize: 12,
  fontWeight: 650,
  letterSpacing: 0,
};

function appSidebarButtonStyle(active: boolean, hasIcon: boolean, hasTrailing: boolean, elevated: boolean, raised = false, splitTrailing = false): React.CSSProperties {
  if (elevated) {
    const framed = active || raised;
    const surface = active ? SIDEBAR_NEUMORPHIC_ACTIVE_SURFACE : SIDEBAR_NEUMORPHIC_SURFACE;
    return {
      width: "100%",
      minHeight: 44,
      display: "grid",
      gridTemplateColumns: splitTrailing ? "repeat(2, minmax(0, 1fr))" : appSidebarButtonGridColumns(hasIcon, hasTrailing),
      alignItems: "center",
      gap: splitTrailing ? 0 : 8,
      margin: 0,
      border: `1px solid ${framed ? "transparent" : SIDEBAR_SOFT_BORDER}`,
      borderRadius: SIDEBAR_ELEVATED_RADIUS,
      background: framed ? `${surface} padding-box, ${SIDEBAR_EDGE_FRAME_GRADIENT} border-box` : surface,
      color: SIDEBAR_ACTIVE_TEXT,
      boxShadow: framed ? `${active ? SIDEBAR_NEUMORPHIC_ACTIVE_SHADOW : SIDEBAR_NEUMORPHIC_RAISED_SHADOW}, ${SIDEBAR_EDGE_FRAME_SHADOW}` : SIDEBAR_NEUMORPHIC_SHADOW,
      transform: raised ? "translateY(-2px)" : "translateY(0)",
      cursor: "pointer",
      font: "inherit",
      fontSize: 13,
      fontWeight: active ? 700 : 650,
      letterSpacing: 0,
      lineHeight: 1.1,
      padding: splitTrailing ? 0 : hasIcon ? "0 12px" : "0 12px 0 14px",
      textAlign: "left",
      minWidth: 0,
      overflow: splitTrailing ? "hidden" : undefined,
      transition: "background 140ms ease, border-color 140ms ease, box-shadow 160ms ease, transform 160ms ease",
    };
  }
  return {
    width: "100%",
    minHeight: 31,
    display: "grid",
    gridTemplateColumns: splitTrailing ? "repeat(2, minmax(0, 1fr))" : appSidebarButtonGridColumns(hasIcon, hasTrailing),
    alignItems: "center",
    gap: splitTrailing ? 0 : 7,
    border: `1px solid ${active ? SIDEBAR_STATE_ACTIVE_BORDER : "transparent"}`,
    borderRadius: 6,
    background: active ? SIDEBAR_STATE_ACTIVE_BG : "transparent",
    color: active ? SIDEBAR_ACTIVE_TEXT : "#334155",
    cursor: "pointer",
    font: "inherit",
    fontSize: 12,
    fontWeight: active ? 600 : 500,
    letterSpacing: 0,
    padding: splitTrailing ? 0 : "0 8px",
    textAlign: "left",
    minWidth: 0,
  };
}

const appSidebarButtonIconStyle: React.CSSProperties = {
  width: 16,
  display: "grid",
  placeItems: "center",
};

const appSidebarLeadingStyle: React.CSSProperties = {
  minWidth: 0,
  height: "100%",
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "0 8px 0 12px",
  boxSizing: "border-box",
};

const appSidebarTextStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

function appSidebarButtonGridColumns(hasIcon: boolean, hasTrailing: boolean): string {
  if (hasIcon && hasTrailing) return "auto minmax(0, 1fr) auto";
  if (hasIcon) return "auto minmax(0, 1fr)";
  if (hasTrailing) return "minmax(0, 1fr) auto";
  return "minmax(0, 1fr)";
}

const appSidebarTrailingStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 4,
};

const appSidebarSplitTrailingStyle: React.CSSProperties = {
  minWidth: 0,
  width: "100%",
  height: "100%",
  alignSelf: "stretch",
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 0,
};

const appSidebarBadgeStripStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 3,
  overflow: "hidden",
};

const appSidebarLargeBadgeStripStyle: React.CSSProperties = {
  minWidth: 0,
  width: "100%",
  height: "100%",
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  alignItems: "stretch",
  overflow: "hidden",
};

function appSidebarNotificationBadgeStyle(tone: SidebarNotificationBadgeTone, highlighted: boolean, large: boolean): React.CSSProperties {
  const colors = sidebarNotificationBadgeColors(tone, highlighted);
  if (large) {
    return {
      minWidth: 0,
      width: "100%",
      height: "100%",
      display: "grid",
      gridTemplateRows: "16px 12px",
      alignContent: "center",
      justifyItems: "center",
      rowGap: 3,
      border: "none",
      borderLeft: `1px solid ${colors.border}`,
      borderRadius: 0,
      background: colors.background,
      color: colors.color,
      cursor: "inherit",
      fontFamily: "inherit",
      fontSize: 13,
      fontWeight: 900,
      lineHeight: 1,
      padding: "3px 2px 4px",
      boxSizing: "border-box",
      flex: "0 0 auto",
      boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.78), inset 0 -1px 0 rgba(15, 23, 42, 0.06)",
    };
  }
  return {
    minWidth: 22,
    height: 20,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    border: `1px solid ${colors.border}`,
    borderRadius: 6,
    background: colors.background,
    color: colors.color,
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 10,
    fontWeight: 800,
    lineHeight: 1,
    padding: "0 4px",
    boxSizing: "border-box",
    flex: "0 0 auto",
    boxShadow: "2px 2px 5px rgba(174, 174, 192, 0.22), -2px -2px 5px rgba(255, 255, 255, 0.86)",
  };
}

function appSidebarNotificationBadgeLabelStyle(large: boolean): React.CSSProperties {
  if (large) {
    return {
      width: 16,
      height: 16,
      display: "grid",
      placeItems: "center",
      fontSize: 15,
      fontWeight: 950,
      lineHeight: "16px",
    };
  }
  return { fontSize: 10, fontWeight: 950, lineHeight: 1 };
}

function appSidebarNotificationBadgeCountStyle(large: boolean): React.CSSProperties {
  if (large) {
    return {
      height: 12,
      display: "grid",
      placeItems: "center",
      fontSize: 13,
      fontWeight: 900,
      lineHeight: "12px",
      fontVariantNumeric: "tabular-nums",
    };
  }
  return { lineHeight: 1, fontVariantNumeric: "tabular-nums" };
}

function sidebarNotificationBadgeColors(tone: SidebarNotificationBadgeTone, highlighted = true): { background: string; border: string; color: string } {
  if (!highlighted) return { background: "linear-gradient(135deg, rgba(248, 250, 252, 0.72), rgba(226, 232, 240, 0.42))", border: "rgba(148, 163, 184, 0.34)", color: "#94a3b8" };
  if (tone === "urgent") return { background: "linear-gradient(145deg, rgba(255, 247, 237, 0.98) 0%, rgba(254, 215, 170, 0.94) 30%, rgba(251, 113, 133, 0.82) 66%, rgba(234, 88, 12, 0.88) 100%)", border: "rgba(234, 88, 12, 0.56)", color: "#9f1239" };
  if (tone === "mention") return { background: "linear-gradient(145deg, rgba(236, 254, 255, 0.98) 0%, rgba(165, 243, 252, 0.94) 30%, rgba(45, 212, 191, 0.78) 64%, rgba(14, 165, 233, 0.86) 100%)", border: "rgba(8, 145, 178, 0.52)", color: "#0f5f78" };
  if (tone === "updates") return { background: "linear-gradient(145deg, rgba(255, 251, 235, 0.98) 0%, rgba(254, 240, 138, 0.94) 30%, rgba(251, 191, 36, 0.82) 64%, rgba(249, 115, 22, 0.88) 100%)", border: "rgba(234, 88, 12, 0.5)", color: "#9a4310" };
  if (tone === "mail") return { background: "#fff7ed", border: "rgba(255, 136, 32, 0.36)", color: "#c2410c" };
  return { background: "#fff7ed", border: "rgba(255, 136, 32, 0.36)", color: "#c2410c" };
}
function appSidebarSharedRootBlockStyle(active: boolean, raised: boolean): React.CSSProperties {
  const framed = active || raised;
  const surface = active ? SIDEBAR_NEUMORPHIC_ACTIVE_SURFACE : SIDEBAR_NEUMORPHIC_SURFACE;
  return {
    display: "grid",
    gap: 0,
    minWidth: 0,
    margin: 0,
    border: `1px solid ${framed ? "transparent" : SIDEBAR_SOFT_BORDER}`,
    borderRadius: SIDEBAR_ELEVATED_RADIUS,
    background: framed ? `${surface} padding-box, ${SIDEBAR_EDGE_FRAME_GRADIENT} border-box` : surface,
    boxShadow: framed ? `${active ? SIDEBAR_NEUMORPHIC_ACTIVE_SHADOW : SIDEBAR_NEUMORPHIC_RAISED_SHADOW}, ${SIDEBAR_EDGE_FRAME_SHADOW}` : SIDEBAR_NEUMORPHIC_SHADOW,
    transform: raised ? "translateY(-2px)" : "translateY(0)",
    overflow: "hidden",
    transition: "background 140ms ease, border-color 140ms ease, box-shadow 160ms ease, transform 160ms ease",
  };
}

function appSidebarSharedTriageRowStyle(active: boolean, dropActive: boolean, elevated = false, open = false): React.CSSProperties {
  if (elevated) {
    return {
      width: "100%",
      minHeight: 44,
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr) 34px",
      alignItems: "center",
      gap: 0,
      border: "none",
      borderRadius: open ? `${SIDEBAR_ELEVATED_RADIUS - 1}px ${SIDEBAR_ELEVATED_RADIUS - 1}px 0 0` : SIDEBAR_ELEVATED_RADIUS - 1,
      background: active || dropActive ? SIDEBAR_NEUMORPHIC_ACTIVE_SURFACE : "transparent",
      color: SIDEBAR_ACTIVE_TEXT,
      minWidth: 0,
      cursor: "pointer",
      transition: "background 120ms ease",
    };
  }
  return {
    width: "100%",
    minHeight: 31,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 22px",
    alignItems: "center",
    gap: 0,
    border: `1px solid ${active ? SIDEBAR_STATE_ACTIVE_BORDER : dropActive ? SIDEBAR_STATE_OPEN_BORDER : "transparent"}`,
    borderRadius: 6,
    background: active ? SIDEBAR_STATE_ACTIVE_BG : dropActive ? SIDEBAR_STATE_DROP_BG : "transparent",
    color: active ? SIDEBAR_ACTIVE_TEXT : "#334155",
    minWidth: 0,
    cursor: "pointer",
  };
}

const appSidebarSharedTriageButtonStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 42,
  display: "grid",
  gridTemplateColumns: "20px minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 6,
  border: "none",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  font: "inherit",
  fontSize: 13,
  fontWeight: 650,
  lineHeight: 1.1,
  letterSpacing: 0,
  padding: "0 0 0 14px",
  textAlign: "left",
};

const appSidebarSharedIconStyle: React.CSSProperties = {
  width: 20,
  height: 20,
  display: "grid",
  placeItems: "center",
  color: "#8b5cf6",
};

const appSidebarSharedDisclosureStyle: React.CSSProperties = {
  width: 30,
  height: 32,
  display: "grid",
  placeItems: "center",
  border: "none",
  background: "transparent",
  color: "rgba(15, 23, 42, 0.62)",
  cursor: "pointer",
  padding: 0,
};

const appSidebarEllipsisStyle: React.CSSProperties = {
  display: "block",
  transform: "translateY(-2px)",
  fontSize: 11,
  fontWeight: 900,
  letterSpacing: -1,
};

const appSidebarSharedMetaStyle: React.CSSProperties = {
  color: "rgba(15, 23, 42, 0.52)",
  fontSize: 10,
  fontWeight: 700,
};

const appSidebarSharedLabelStackStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 1,
};

const appSidebarSharedRowsStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  alignContent: "start",
  gap: 0,
  padding: "1px 0 5px",
};

const appSidebarSharedErrorStyle: React.CSSProperties = {
  padding: "3px 6px 2px 8px",
  color: "#8b123f",
  fontSize: 10,
  fontWeight: 700,
  lineHeight: 1.25,
};

const appSidebarExplorerSuccessStyle: React.CSSProperties = {
  position: "sticky",
  top: 4,
  zIndex: 6,
  margin: "0 5px 6px",
  padding: "6px 8px",
  border: "1px solid rgba(34, 197, 94, 0.36)",
  borderRadius: 7,
  background: "linear-gradient(135deg, rgba(220, 252, 231, 0.96), rgba(187, 247, 208, 0.9))",
  color: "#166534",
  fontSize: 10,
  fontWeight: 800,
  lineHeight: 1.25,
  boxShadow: "0 5px 12px rgba(22, 101, 52, 0.12)",
};

function appSidebarSharedFolderRowStyle(depth: number, active: boolean, dropPlacement: SharedInboxDropPlacement | null, hovered = false): React.CSSProperties {
  const framed = active || hovered || dropPlacement === "inside";
  const frameBackground = active
    ? "linear-gradient(135deg, rgba(255, 255, 255, 0.94), rgba(238, 250, 255, 0.74) 44%, rgba(247, 241, 255, 0.76))"
    : "linear-gradient(135deg, rgba(255, 255, 255, 0.86), rgba(236, 251, 255, 0.58) 45%, rgba(247, 240, 255, 0.62))";
  return {
    width: "calc(100% - 4px)",
    minHeight: 25,
    display: "grid",
    gridTemplateColumns: "18px 17px minmax(0, 1fr)",
    alignItems: "center",
    gap: 4,
    margin: "0 2px",
    border: `1px solid ${framed ? "transparent" : "transparent"}`,
    borderRadius: 9,
    background: framed ? `${frameBackground} padding-box, ${SIDEBAR_EDGE_FRAME_GRADIENT} border-box` : "transparent",
    color: "#334155",
    cursor: "pointer",
    font: "inherit",
    fontSize: 11,
    fontWeight: active ? 700 : 600,
    padding: `1px 5px 1px ${5 + depth * 13}px`,
    textAlign: "left",
    minWidth: 0,
    transition: "background 120ms ease, border-color 120ms ease, box-shadow 140ms ease",
    boxShadow: dropPlacement === "before"
      ? "inset 0 2px 0 rgba(100, 116, 139, 0.66)"
      : dropPlacement === "after"
        ? "inset 0 -2px 0 rgba(100, 116, 139, 0.66)"
        : framed
          ? "0 0 0 1px rgba(120, 224, 255, 0.12), 0 0 12px rgba(183, 124, 255, 0.18), inset 1px 1px 0 rgba(255, 255, 255, 0.82)"
          : undefined,
  };
}

const appSidebarSharedFolderIconStyle: React.CSSProperties = {
  width: 17,
  height: 17,
  display: "grid",
  placeItems: "center",
  color: "#111111",
};

const appSidebarSharedRenameInputStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  height: 22,
  border: "1px solid #334155",
  borderRadius: 4,
  background: "#ffffff",
  color: "#111827",
  font: "inherit",
  fontSize: 11,
  fontWeight: 700,
  padding: "0 6px",
  outline: "none",
};

const appSidebarContextMenuButtonStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 31,
  border: "none",
  background: "transparent",
  color: "#111827",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 600,
  textAlign: "left",
  padding: "0 12px",
};

const appSidebarPriorityMenuTitleStyle: React.CSSProperties = {
  padding: "7px 12px 1px",
  color: "#111827",
  fontSize: 11,
  fontWeight: 800,
};

const appSidebarPriorityMenuTargetStyle: React.CSSProperties = {
  maxWidth: 220,
  padding: "0 12px 6px",
  color: "rgba(15, 23, 42, 0.58)",
  fontSize: 11,
  fontWeight: 650,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const appSidebarPriorityMenuButtonStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 30,
  border: "none",
  background: "transparent",
  color: "#111827",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 700,
  textAlign: "left",
  padding: "0 12px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const appSidebarExplorerFallbackStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  background: "transparent",
};

const appSidebarVersionStyle: React.CSSProperties = {
  position: "sticky",
  bottom: 0,
  alignSelf: "flex-end",
  marginTop: "auto",
  padding: "2px 4px 0",
  color: "rgba(15, 23, 42, 0.46)",
  background: "linear-gradient(180deg, rgba(242, 244, 248, 0), rgba(242, 244, 248, 0.92) 42%, rgba(242, 244, 248, 0.98))",
  fontSize: 10,
  fontWeight: 700,
  lineHeight: 1.2,
  letterSpacing: 0,
  pointerEvents: "none",
};

const sharedInboxEmailModalBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1,
  display: "grid",
  placeItems: "center",
  background: "radial-gradient(circle at 50% 38%, rgba(219, 234, 254, 0.24), transparent 36%), rgba(15, 23, 42, 0.38)",
  padding: 20,
  backdropFilter: "blur(8px) saturate(1.08)",
  WebkitBackdropFilter: "blur(8px) saturate(1.08)",
};

const sharedInboxEmailModalStyle: React.CSSProperties = {
  width: "min(420px, 100%)",
  display: "grid",
  gap: 12,
  border: "1px solid transparent",
  borderRadius: 14,
  background: `${SIDEBAR_NEUMORPHIC_SURFACE} padding-box, ${SIDEBAR_EDGE_FRAME_GRADIENT} border-box`,
  color: "#0f172a",
  padding: 18,
  boxShadow: `${SIDEBAR_NEUMORPHIC_RAISED_SHADOW}, ${SIDEBAR_EDGE_FRAME_SHADOW}`,
  backdropFilter: "blur(18px) saturate(1.1)",
  WebkitBackdropFilter: "blur(18px) saturate(1.1)",
};

const sharedInboxEmailModalAccentStyle: React.CSSProperties = {
  width: 56,
  height: 4,
  borderRadius: 999,
  background: "linear-gradient(90deg, #22d3ee 0%, #60a5fa 46%, #a78bfa 100%)",
  boxShadow: "0 5px 14px rgba(96, 165, 250, 0.22), 0 0 12px rgba(167, 139, 250, 0.18), inset 1px 1px 0 rgba(255, 255, 255, 0.52)",
};

const sharedInboxEmailModalTitleStyle: React.CSSProperties = {
  color: "#0f172a",
  fontSize: 15,
  fontWeight: 800,
  letterSpacing: "-0.01em",
};

const sharedInboxEmailModalDetailStyle: React.CSSProperties = {
  color: "#475569",
  fontSize: 12,
  fontWeight: 520,
  lineHeight: 1.45,
};

const sharedInboxEmailModalLabelStyle: React.CSSProperties = {
  display: "grid",
  gap: 7,
  minWidth: 0,
  color: "#334155",
  fontSize: 11,
  fontWeight: 760,
};

const sharedInboxEmailModalInputStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  height: 40,
  border: "1px solid rgba(255, 255, 255, 0.82)",
  borderRadius: 9,
  background: SIDEBAR_NEUMORPHIC_SURFACE,
  color: "#0f172a",
  padding: "0 12px",
  font: "inherit",
  fontSize: 13,
  fontWeight: 540,
  boxSizing: "border-box",
  outline: "none",
  boxShadow: "inset 3px 3px 7px rgba(174, 174, 192, 0.22), inset -3px -3px 7px rgba(255, 255, 255, 0.92), 0 0 0 1px rgba(100, 116, 139, 0.08)",
};

const sharedInboxEmailModalErrorStyle: React.CSSProperties = {
  border: "1px solid rgba(244, 63, 94, 0.18)",
  borderRadius: 8,
  background: "linear-gradient(135deg, rgba(255, 241, 242, 0.94), rgba(253, 242, 248, 0.9))",
  color: "#8b123f",
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1.4,
  padding: "8px 10px",
};

const sharedInboxEmailModalActionsStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 10,
  marginTop: 2,
};

const sharedInboxEmailModalSecondaryButtonStyle: React.CSSProperties = {
  minHeight: 38,
  border: `1px solid ${SIDEBAR_SOFT_BORDER}`,
  borderRadius: 9,
  background: SIDEBAR_NEUMORPHIC_SURFACE,
  color: "#334155",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 760,
  padding: "0 12px",
  boxShadow: SIDEBAR_NEUMORPHIC_SHADOW,
};

const sharedInboxEmailModalPrimaryButtonStyle: React.CSSProperties = {
  ...sharedInboxEmailModalSecondaryButtonStyle,
  border: "1px solid transparent",
  background: `${SIDEBAR_NEUMORPHIC_ACTIVE_SURFACE} padding-box, ${SIDEBAR_EDGE_FRAME_GRADIENT} border-box`,
  color: "#0f172a",
  boxShadow: `${SIDEBAR_NEUMORPHIC_RAISED_SHADOW}, ${SIDEBAR_EDGE_FRAME_SHADOW}`,
};

const nodeEditorPopupBackdropStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  zIndex: 1,
  display: "block",
  background: "rgba(15, 23, 42, 0.18)",
  padding: 0,
};

const nodeEditorPopupStyle: React.CSSProperties = {
  position: "absolute",
  width: "min(1180px, calc(100vw - 44px))",
  height: "calc(100dvh - 16px)",
  minWidth: "min(420px, calc(100vw - 44px))",
  minHeight: "min(320px, calc(100dvh - 16px))",
  maxWidth: "calc(100vw - 44px)",
  maxHeight: "calc(100dvh - 16px)",
  boxSizing: "border-box",
  border: "1px solid rgba(100, 116, 139, 0.54)",
  borderRadius: 16,
  background: "#ffffff",
  boxShadow: "0 18px 42px rgba(15, 23, 42, 0.22), inset 0 0 0 1px rgba(255, 255, 255, 0.72)",
  overflow: "hidden",
  cursor: "default",
};

const nodeEditorPopupFullscreenStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  maxWidth: `calc(100vw - ${NODE_EDITOR_FULLSCREEN_HORIZONTAL_INSET_PX * 2}px)`,
  maxHeight: `calc(100vh - ${NODE_EDITOR_FULLSCREEN_VERTICAL_INSET_PX * 2}px)`,
  borderRadius: 14,
};

const nodeEditorPopupSidebarFillStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  maxWidth: "none",
  maxHeight: "none",
  borderRadius: 0,
};

const nodeEditorPopupCloseButtonStyle: React.CSSProperties = {
  position: "absolute",
  top: 7,
  right: 8,
  zIndex: 80,
  width: 24,
  height: 24,
  border: "1px solid #334155",
  borderRadius: 4,
  background: "#475569",
  color: "#ffffff",
  fontSize: 16,
  fontWeight: 600,
  lineHeight: "20px",
  cursor: "pointer",
};

const nodeEditorPopupCollapseButtonStyle: React.CSSProperties = {
  position: "absolute",
  top: 7,
  right: 38,
  zIndex: 80,
  width: 24,
  height: 24,
  display: "grid",
  placeItems: "center",
  border: "1px solid rgba(100, 116, 139, 0.56)",
  borderRadius: 4,
  background: "#ffffff",
  color: "#334155",
  padding: 0,
  cursor: "pointer",
};
