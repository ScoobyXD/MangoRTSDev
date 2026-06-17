import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getActiveCompanyID } from "../auth/currentCompany";
import { readAuthConfig } from "../auth/cognitoAuth";
import { WORKTREE_VERSION } from "./worktreeVersion";
import FrameRightClickMenu from "./framerightclickmenu";
import { HeaderAccountManagerIcon, HeaderMapIcon, HeaderProjectManagementIcon } from "./HeaderIcons";
import { MangoWordmark } from "./MangoLogo";
import { NotificationPopover } from "./NotificationPopover";
import { UI_THEME } from "./frameLayoutTypes";
import { preloadAccountManagerSurface, preloadDefaultDashboardModules, preloadProjectManagementSurface } from "./preloadDashboardModules";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../modules/company-explorer/CompanyExplorerIcons";
import type { CompanyExplorerTriageMessageDropHandler } from "../modules/company-explorer/CompanyExplorerContentModel";
import { resolveExplorerClickSelection } from "../modules/company-explorer/treePresentation";
import type { SidebarPin } from "./sidebarPins";
import { MinimizeToLineIcon, NODE_EDITOR_POPUP_RESIZE_HANDLES, type NodeEditorPopupResizeHandle } from "./nodeEditorPopupControls";
import {
  createCommunicationsSharedInbox,
  deleteCommunicationsSharedInbox,
  EVENT_COMMUNICATIONS_SHARED_INBOXES_UPDATED,
  fetchCommunicationsAuthURL,
  fetchCommunicationsStatus,
  listCommunicationsSharedInboxes,
  updateCommunicationsSharedInbox,
  type CommunicationsSharedInbox,
  type EmailProvider,
} from "../modules/communications/communicationsApi";
import { useNotificationSummary } from "../modules/notifications/useNotificationSummary";
import { deleteNotification, deleteNotifications, EVENT_NOTIFICATIONS_UPDATED, fetchNotifications, type NotificationItem, type NotificationRaciRole, type NotificationSummary, type NotificationSurface } from "../modules/notifications/notificationsApi";
import { emitDashboardEvent, EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED } from "../modules/node-map/eventbus";
import { INBOX_PRIORITIES, RACI_INBOX_SECTIONS } from "../pages/home/homeConstants";
import { convertMessagesToLogicGateCommand } from "../pages/home/homeCommands";
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
  }>,
})));

const fullPageFallback = <div aria-busy="true" style={{ width: "100%", height: "100%", background: "#ffffff" }} />;
const PAGE_SURFACE_RADIUS = 16;
export const SIDEBAR_EXPLORER_WIDGET_ID = "app-sidebar-explorer";
const SHARED_TRIAGE_FOLDER_DRAG_MIME = "application/x-mangorts-shared-triage-folder";
const SIDEBAR_SECTION_OPEN_KEY_PREFIX = "mangorts.app-sidebar-section-open.v2";
const APP_SIDEBAR_PIN_DRAG_MIME = "application/x-mangorts-sidebar-pin";
const NODE_EDITOR_POPUP_MIN_WIDTH = 420;
const NODE_EDITOR_POPUP_MIN_HEIGHT = 320;
const NODE_EDITOR_POPUP_VIEWPORT_WIDTH_INSET = 44;
const NODE_EDITOR_POPUP_VIEWPORT_HEIGHT_INSET = 64;
const NODE_EDITOR_POPUP_SIDEBAR_BUFFER = 14;
const NODE_EDITOR_POPUP_SIZE_STORAGE_KEY_PREFIX = "app-node-editor-popup-size-v1";
const NODE_EDITOR_POPUP_NOTIFICATION_Z_INDEX = 160;
const NODE_EDITOR_POPUP_Z_INDEX = 130;
const SIDEBAR_ELEVATED_RADIUS = 11;
const SIDEBAR_SCROLL_ACCENT = "rgba(203, 213, 225, 0.82)";
const SIDEBAR_PROJECT_ICON_COLOR = "#f97316";
const SIDEBAR_ACCOUNT_ICON_COLOR = "#14b8a6";
const SIDEBAR_MAP_ICON_COLOR = "#19a8ff";
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

type SidebarSectionID = "shared-triage" | "views";

export type HomeSidebarView = "my-triage" | "shared-root" | "aci-inbox" | "r-inbox" | "a-inbox" | "c-inbox" | "i-inbox" | "o-inbox" | "custom-matrix" | "my-work" | `shared:${string}`;
export type { SidebarPin, SidebarPinKind } from "./sidebarPins";

type RaciHomeSidebarView = Extract<HomeSidebarView, "r-inbox" | "a-inbox" | "c-inbox" | "i-inbox" | "o-inbox">;

const APP_SIDEBAR_RACI_VIEWS = RACI_INBOX_SECTIONS.map((section) => {
  const label = section.role === "other" ? "Others" : section.label;
  return {
    viewID: section.viewID,
    role: section.role,
    label,
    notificationTitle: `${label} notifications`,
    surface: section.role === "responsible" ? "r_inbox" : "aci_inbox",
  };
}) satisfies ReadonlyArray<{
  viewID: RaciHomeSidebarView;
  role: NotificationRaciRole;
  label: string;
  notificationTitle: string;
  surface: NotificationSurface;
}>;

type AppSidebarPrimaryPage = "map" | "home" | "logic-gate-arena" | "project-management" | "account-manager";

type AppSidebarProps = {
  accountChrome?: React.ReactNode;
  activePage: AppSidebarPrimaryPage | null;
  activeHomeView: HomeSidebarView;
  pins: SidebarPin[];
  pinDropActive: boolean;
  explorerSelectionTargetFrameIDs: string[];
  onHomeViewSelect: (view: HomeSidebarView) => void;
  onPageSelect: (page: AppSidebarPrimaryPage) => void;
  onNotificationNodeOpen: (node: { nodeID: string; nodeTitle: string; focusInformationID?: string }) => void;
  onPinOpen: (pin: SidebarPin) => void;
  onPinRemove: (pin: SidebarPin) => void;
  onPinReorder: (moving: SidebarPin, target: SidebarPin | null, placement: "before" | "after") => void;
  onPinDragEnter: () => void;
  onPinDragLeave: () => void;
  onPinDragOver: (event: React.DragEvent<HTMLElement>) => void;
  onPinDrop: (event: React.DragEvent<HTMLElement>) => void;
};

type SidebarNotificationMenuFilter = {
  title: string;
  type?: string;
  surface?: NotificationSurface;
  role?: NotificationRaciRole;
};

type SidebarNotificationMenuState = SidebarNotificationMenuFilter & {
  requestID: number;
  anchorTop: number;
  loading: boolean;
  error: string;
  items: NotificationItem[];
  seenNotificationIDs: string[];
};

type SidebarExplorerTriagePriorityMenuState = {
  x: number;
  y: number;
  target: Parameters<CompanyExplorerTriageMessageDropHandler>[0];
  messageIDs: string[];
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
  title: string;
  detail: string;
  label: string;
  confirmLabel: string;
  subtreeIDs: Set<string>;
};

function readSharedTriageFolderDrag(dataTransfer: DataTransfer): string {
  return dataTransfer.getData(SHARED_TRIAGE_FOLDER_DRAG_MIME).trim();
}

function homeSidebarViewForRaciNotification(surface: NotificationSurface | undefined, role: NotificationRaciRole | "" | undefined): RaciHomeSidebarView {
  const roleView = APP_SIDEBAR_RACI_VIEWS.find((view) => view.role === role);
  if (roleView) return roleView.viewID;
  return surface === "r_inbox" ? "r-inbox" : "a-inbox";
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
    return `${fallback}: Shared Triage storage is not ready. Run the pending database migrations, then try again.`;
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
  pins,
  pinDropActive,
  explorerSelectionTargetFrameIDs,
  onHomeViewSelect,
  onPageSelect,
  onNotificationNodeOpen,
  onPinOpen,
  onPinRemove,
  onPinReorder,
  onPinDragEnter,
  onPinDragLeave,
  onPinDragOver,
  onPinDrop,
}: AppSidebarProps): React.ReactElement {
  const homeActive = activePage === "home";
  const companyID = getActiveCompanyID();
  const notificationSummary = useNotificationSummary(companyID);
  const [sharedTriageOpen, setSharedTriageOpen] = usePersistedSidebarSectionOpen("shared-triage", false);
  const [viewsOpen, setViewsOpen] = usePersistedSidebarSectionOpen("views", false);
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
  const [sharedEmailConnectionDialog, setSharedEmailConnectionDialog] = useState<{ accountEmail: string } | null>(null);
  const [pinContextMenu, setPinContextMenu] = useState<{ x: number; y: number; pin: SidebarPin } | null>(null);
  const [notificationMenu, setNotificationMenu] = useState<SidebarNotificationMenuState | null>(null);
  const [pinDropTarget, setPinDropTarget] = useState<{ key: string; placement: "before" | "after" } | null>(null);
  const [explorerTriagePriorityMenu, setExplorerTriagePriorityMenu] = useState<SidebarExplorerTriagePriorityMenuState | null>(null);
  const [explorerTriageBusy, setExplorerTriageBusy] = useState(false);
  const [mailUnreadCounts, setMailUnreadCounts] = useState({ myTriage: 0, sharedTriage: 0 });
  const [explorerSearchQuery, setExplorerSearchQuery] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const sharedCreateNameInputRef = useRef<HTMLInputElement | null>(null);
  const sharedEmailInputRef = useRef<HTMLInputElement | null>(null);
  const keyViewsSectionRef = useRef<HTMLElement | null>(null);
  const notificationMenuRequestRef = useRef(0);
  const skipRenameBlurRef = useRef(false);
  const cleanConnectedAccountEmail = connectedAccountEmail.trim().toLowerCase();
  const sharedRows = useMemo(
    () => sharedTriageOpen ? buildSharedInboxRows(sharedInboxes, expandedSharedFolderIDs) : [],
    [expandedSharedFolderIDs, sharedInboxes, sharedTriageOpen],
  );
  const sharedTriageActive = homeActive && (activeHomeView === "shared-root" || activeHomeView.startsWith("shared:"));
  const raciNotificationCounts = useMemo(
    () => APP_SIDEBAR_RACI_VIEWS.reduce<Partial<Record<NotificationRaciRole, number>>>((counts, view) => {
      counts[view.role] = notificationSummaryRoleCount(notificationSummary, view.surface, view.role);
      return counts;
    }, {}),
    [notificationSummary],
  );
  const myTriageNotificationCount = useMemo(
    () => mailUnreadCounts.myTriage,
    [mailUnreadCounts.myTriage],
  );
  const sharedTriageNotificationCount = useMemo(
    () => mailUnreadCounts.sharedTriage,
    [mailUnreadCounts.sharedTriage],
  );
  const [sharedTriageHovered, setSharedTriageHovered] = useState(false);
  const [sharedTriageFocused, setSharedTriageFocused] = useState(false);
  const [hoveredSharedFolderID, setHoveredSharedFolderID] = useState("");
  useEffect(() => {
    const onHomeUnreadCountsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ companyID?: string; viewID?: HomeSidebarView; unreadCount?: number }>).detail;
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

  const openMailBadgeView = useCallback((view: HomeSidebarView) => {
    onPageSelect("home");
    onHomeViewSelect(view);
  }, [onHomeViewSelect, onPageSelect]);

  const requestExplorerTriageMessageDrop = useCallback<CompanyExplorerTriageMessageDropHandler>((target, messageIDs, point) => {
    const ids = cleanIDList(messageIDs);
    if (ids.length === 0) return;
    setExplorerTriagePriorityMenu({ target, messageIDs: ids, x: point.x, y: point.y });
  }, []);

  const pickExplorerTriagePriority = useCallback(async (priority: number) => {
    const menu = explorerTriagePriorityMenu;
    const cleanCompanyID = companyID.trim();
    if (!menu || explorerTriageBusy || !cleanCompanyID) return;
    setExplorerTriagePriorityMenu(null);
    setExplorerTriageBusy(true);
    try {
      await convertMessagesToLogicGateCommand({
        apiBase: readAuthConfig().apiBase,
        companyID: cleanCompanyID,
        logicGateID: menu.target.logicGateID,
        nodeID: menu.target.kind === "node" ? menu.target.nodeID : undefined,
        messageIDs: menu.messageIDs,
        priority,
      });
    } catch (error) {
      console.error("Failed to assign triage email from sidebar Explorer", error);
      setSharedError(error instanceof Error ? error.message : "Failed to assign email.");
    } finally {
      setExplorerTriageBusy(false);
    }
  }, [companyID, explorerTriageBusy, explorerTriagePriorityMenu]);

  useEffect(() => {
    if (activeHomeView.startsWith("shared:")) return;
    setSelectedSharedTreeIDs((previous) => previous.size === 0 ? previous : new Set());
    setSharedSelectionAnchorTreeID("");
  }, [activeHomeView]);
  const loadNotificationMenuItems = useCallback((requestID: number, filter: SidebarNotificationMenuFilter) => {
    fetchNotifications({ companyID, type: filter.type, unreadOnly: true, limit: 100 })
      .then((items) => {
        const filtered = items.filter((item) => sidebarNotificationMatchesFilter(item, filter));
        setNotificationMenu((current) => (
          current?.requestID === requestID
            ? { ...current, loading: false, items: filtered }
            : current
        ));
      })
      .catch((error) => {
        setNotificationMenu((current) => (
          current?.requestID === requestID
            ? { ...current, loading: false, error: error instanceof Error ? error.message : "Failed to load notifications" }
            : current
        ));
      });
  }, [companyID]);

  const openNotificationMenu = useCallback((event: React.MouseEvent, filter: SidebarNotificationMenuFilter) => {
    event.preventDefault();
    event.stopPropagation();
    const requestID = notificationMenuRequestRef.current + 1;
    notificationMenuRequestRef.current = requestID;
    const sectionRect = keyViewsSectionRef.current?.getBoundingClientRect();
    const anchorRect = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : null;
    const anchorTop = sectionRect && anchorRect ? Math.max(0, anchorRect.bottom - sectionRect.top + 5) : 0;
    const nextMenu: SidebarNotificationMenuState = {
      ...filter,
      requestID,
      anchorTop,
      loading: true,
      error: "",
      items: [],
      seenNotificationIDs: [],
    };
    setNotificationMenu(nextMenu);
    loadNotificationMenuItems(requestID, filter);
  }, [loadNotificationMenuItems]);

  useEffect(() => {
    if (!notificationMenu) return undefined;
    const activeRequestID = notificationMenu.requestID;
    const filter: SidebarNotificationMenuFilter = {
      title: notificationMenu.title,
      type: notificationMenu.type,
      surface: notificationMenu.surface,
      role: notificationMenu.role,
    };
    const onNotificationsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ companyID?: string }>).detail;
      const eventCompanyID = detail?.companyID?.trim() ?? "";
      if (eventCompanyID && eventCompanyID !== companyID) return;
      const requestID = notificationMenuRequestRef.current + 1;
      notificationMenuRequestRef.current = requestID;
      setNotificationMenu((current) => (
        current?.requestID === activeRequestID
          ? { ...current, requestID, loading: true, error: "" }
          : current
      ));
      loadNotificationMenuItems(requestID, filter);
    };
    window.addEventListener(EVENT_NOTIFICATIONS_UPDATED, onNotificationsUpdated);
    return () => window.removeEventListener(EVENT_NOTIFICATIONS_UPDATED, onNotificationsUpdated);
  }, [companyID, loadNotificationMenuItems, notificationMenu]);

  const clearNotificationMenu = useCallback(() => {
    const menu = notificationMenu;
    if (!menu || menu.loading || menu.items.length === 0) return;
    setNotificationMenu(null);
    void deleteNotifications({
      companyID,
      type: menu.type,
      surface: menu.surface,
      role: menu.role,
    }).catch((error) => {
      console.error("Failed to clear notifications", error);
      setNotificationMenu({
        ...menu,
        loading: false,
        error: error instanceof Error ? error.message : "Failed to clear notifications",
      });
    });
  }, [companyID, notificationMenu]);

  const openNotificationTarget = useCallback((notification: NotificationItem) => {
    const notificationID = notification.notification_id.trim();
    if (notificationID) {
      setNotificationMenu((current) => {
        if (!current) return current;
        const seen = new Set(current.seenNotificationIDs);
        seen.add(notificationID);
        return {
          ...current,
          items: current.items.filter((item) => item.notification_id !== notificationID),
          seenNotificationIDs: Array.from(seen),
        };
      });
      void deleteNotification(notificationID, notification.company_id || companyID).catch((error) => console.error("Failed to delete notification", error));
    }

    const informationID = notification.information_id?.trim() ?? "";
    const nodeID = notification.node_id?.trim() || (notification.entity_type === "node" ? notification.entity_id.trim() : "");
    const logicGateID = notification.logic_gate_id?.trim() || (notification.entity_type === "logic_gate" ? notification.entity_id.trim() : "");
    if (notification.type === "mention.created" && notification.entity_type === "logic_gate" && logicGateID) {
      emitDashboardEvent(EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED, {
        companyID: notification.company_id || companyID,
        sourceFrameID: "app-sidebar-notifications",
        kind: "logic_gate",
        id: logicGateID,
        label: notification.title || logicGateID,
        nodeID: nodeID || undefined,
        informationID: informationID || undefined,
        selectedTreeID: `logic-gate-${logicGateID}`,
        changedAt: Date.now(),
      });
      return;
    }
    if (nodeID) {
      onNotificationNodeOpen({
        nodeID,
        nodeTitle: notification.title || nodeID,
        focusInformationID: informationID || undefined,
      });
      return;
    }
    if (logicGateID) {
      emitDashboardEvent(EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED, {
        companyID: notification.company_id || companyID,
        sourceFrameID: "app-sidebar-notifications",
        kind: "logic_gate",
        id: logicGateID,
        label: notification.title || logicGateID,
        selectedTreeID: `logic-gate-${logicGateID}`,
        informationID: informationID || undefined,
        changedAt: Date.now(),
      });
      return;
    }
    if (notification.surface === "aci_inbox" || notification.surface === "r_inbox") {
      onPageSelect("home");
      onHomeViewSelect(homeSidebarViewForRaciNotification(notification.surface, notification.role));
    } else if (notification.surface === "shared_triage") {
      onPageSelect("home");
      onHomeViewSelect("shared-root");
    } else {
      onPageSelect("home");
      onHomeViewSelect("my-triage");
    }
  }, [companyID, onHomeViewSelect, onNotificationNodeOpen, onPageSelect]);

  const readDraggedSidebarPin = useCallback((dataTransfer: DataTransfer): SidebarPin | null => {
    try {
      const parsed = JSON.parse(dataTransfer.getData(APP_SIDEBAR_PIN_DRAG_MIME)) as Partial<SidebarPin>;
      const kind = parsed.kind === "node" || parsed.kind === "logic_gate" ? parsed.kind : null;
      const id = typeof parsed.id === "string" ? parsed.id.trim() : "";
      if (!kind || !id) return null;
      return pins.find((pin) => pin.kind === kind && pin.id === id) ?? null;
    } catch {
      return null;
    }
  }, [pins]);

  const hasSidebarPinDrag = useCallback((dataTransfer: DataTransfer): boolean => (
    Array.from(dataTransfer.types).includes(APP_SIDEBAR_PIN_DRAG_MIME)
  ), []);

  const getPinDropPlacement = useCallback((event: React.DragEvent<HTMLElement>): "before" | "after" => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY > bounds.top + bounds.height / 2 ? "after" : "before";
  }, []);

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
          setSharedError(formatSidebarSharedInboxError(error, "Failed to load Shared Triage folders"));
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
          setSharedError(formatSidebarSharedInboxError(error, "Failed to refresh Shared Triage folders"));
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

  const requestSharedInboxEmailConnection = useCallback((connectionError: unknown, accountEmail: string): boolean => {
    const cleanAccountEmail = accountEmail.trim().toLowerCase();
    if (!cleanAccountEmail || !isSharedInboxEmailConnectionError(connectionError)) return false;
    setSharedEmailConnectionDialog({ accountEmail: cleanAccountEmail });
    return true;
  }, []);

  const startSharedInboxEmailConnection = useCallback(async (provider: EmailProvider) => {
    const accountEmail = sharedEmailConnectionDialog?.accountEmail.trim().toLowerCase() ?? "";
    if (!accountEmail || sharedBusy) return;
    setSharedBusy(true);
    setSharedError("");
    try {
      const authURL = await fetchCommunicationsAuthURL(provider, accountEmail);
      window.location.assign(authURL);
    } catch (error) {
      setSharedError(formatSidebarSharedInboxError(error, "Failed to start shared inbox email connection"));
      setSharedBusy(false);
    }
  }, [sharedBusy, sharedEmailConnectionDialog?.accountEmail]);

  const createSharedFolder = useCallback(async (parentFolderID: string, accountEmail = "", rawName = "") => {
    if (!companyID || sharedBusy) return;
    setSharedContextMenu(null);
    setSharedBusy(true);
    setSharedError("");
    try {
      const name = rawName.trim() || accountEmail.trim() || "New Folder";
      const folder = await createCommunicationsSharedInbox({ companyID, parentFolderID, name, accountEmail });
      setSharedInboxes((previous) => [...previous.filter((item) => item.folder_id !== folder.folder_id), folder]);
      if (parentFolderID) setExpandedSharedFolderIDs((previous) => new Set(previous).add(parentFolderID));
      setSharedTriageOpen(true);
      onHomeViewSelect(`shared:${folder.folder_id}`);
    } catch (error) {
      if (requestSharedInboxEmailConnection(error, accountEmail)) return;
      setSharedError(formatSidebarSharedInboxError(error, "Failed to create Shared Triage folder"));
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
      if (requestSharedInboxEmailConnection(error, accountEmail)) return;
      setSharedError(formatSidebarSharedInboxError(error, "Failed to update Shared Triage email"));
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
      setSharedError(formatSidebarSharedInboxError(error, "Failed to rename Shared Triage folder"));
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
      setSharedError(formatSidebarSharedInboxError(error, "Failed to move Shared Triage folder"));
      console.error("Failed to move shared triage folder", error);
    } finally {
      setSharedBusy(false);
    }
  }, [canDropSharedFolder, companyID, replaceSharedFolder, sharedBusy, sharedInboxes]);

  const requestDeleteSharedFolder = useCallback(async (folder: CommunicationsSharedInbox) => {
    if (!companyID || sharedBusy) return;
    setSharedContextMenu(null);
    const subtreeIDs = collectSharedInboxSubtreeIDs(sharedInboxes, folder.folder_id);
    const label = folder.name.trim() || "this folder";
    if (folder.entry_type === "shared_inbox") {
      if (subtreeIDs.size === 0) subtreeIDs.add(folder.folder_id);
      setSharedDeleteDialog({
        folder,
        title: "Delete email from Shared Triage",
        detail: "this email from Shared Triage",
        label,
        confirmLabel: "Delete email",
        subtreeIDs,
      });
      return;
    }
    const count = subtreeIDs.size || 1;
    const detail = count === 1 ? "this folder" : `this folder and ${count - 1} child folder${count === 2 ? "" : "s"}`;
    setSharedDeleteDialog({ folder, title: "Delete folder", detail, label, confirmLabel: "Delete", subtreeIDs });
  }, [companyID, sharedBusy, sharedInboxes]);

  const confirmDeleteSharedFolder = useCallback(async () => {
    const dialog = sharedDeleteDialog;
    if (!companyID || !dialog || sharedBusy) return;
    setSharedDeleteDialog(null);
    setSharedBusy(true);
    setSharedError("");
    try {
      await deleteCommunicationsSharedInbox(companyID, dialog.folder.folder_id);
      setSharedInboxes((previous) => previous.filter((item) => !dialog.subtreeIDs.has(item.folder_id)));
      const activeFolderID = activeHomeView.startsWith("shared:") ? activeHomeView.slice("shared:".length) : "";
      if (activeFolderID && dialog.subtreeIDs.has(activeFolderID)) onHomeViewSelect("shared-root");
    } catch (error) {
      setSharedError(formatSidebarSharedInboxError(error, "Failed to delete Shared Triage folder"));
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
    onHomeViewSelect(primaryTreeID as HomeSidebarView);
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
    const treeID = row.treeID as HomeSidebarView;
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
        onClick={(event) => selectSharedFolderRow(row, event)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
          event.preventDefault();
          selectSharedFolderRow(row);
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

  const viewsActive = homeActive && APP_SIDEBAR_RACI_VIEWS.some((view) => (
    activeHomeView === view.viewID || (activeHomeView === "aci-inbox" && view.viewID === "a-inbox")
  ));
  return (
    <aside className="company-explorer-scroll" data-app-sidebar="primary" style={appSidebarStyle}>
      <div style={appSidebarBrandStyle} aria-label="MangoRTS">
        <MangoWordmark size={22} weight={600} />
        {accountChrome && <div style={appSidebarAccountChromeStyle}>{accountChrome}</div>}
      </div>

      <div data-frame-interactive="true" style={appSidebarExplorerSearchContainerStyle}>
        <div style={appSidebarExplorerSearchShellStyle}>
          <input
            aria-label="Search Explorer"
            value={explorerSearchQuery}
            onChange={(event) => setExplorerSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setExplorerSearchQuery("");
                event.currentTarget.blur();
              }
            }}
            placeholder="Search Explorer"
            style={appSidebarExplorerSearchInputStyle}
          />
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={appSidebarExplorerSearchIconStyle}>
            <circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.2 10.2 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      </div>

      <section ref={keyViewsSectionRef} style={appSidebarKeyViewsSectionStyle} aria-label="Home inboxes">
        <AppSidebarButton
          label="My Triage"
          active={homeActive && activeHomeView === "my-triage"}
          elevated
          trailing={<SidebarNotificationBadges badges={[{
            key: "my-triage",
            count: myTriageNotificationCount,
            tone: "mail",
            title: "Open My Triage unread mail",
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
            onDragOver={handleSharedRootDragOver}
            onDragLeave={() => setDropTarget((current) => current?.folderID === "" ? null : current)}
            onDrop={handleSharedRootDrop}
          >
            <button
              type="button"
              style={appSidebarSharedTriageButtonStyle}
              onClick={() => onHomeViewSelect("shared-root")}
            >
              <span style={appSidebarTextStyle}>Shared Triage</span>
              <span style={appSidebarTrailingStyle}>
                {loadingSharedInboxes && <span style={appSidebarSharedMetaStyle}>Loading</span>}
                <SidebarNotificationBadges badges={[{
                  key: "shared-triage",
                  count: sharedTriageNotificationCount,
                  tone: "mail",
                  title: "Open Shared Triage unread mail",
                  onClick: () => openMailBadgeView("shared-root"),
                }]} />
              </span>
            </button>
            <button
              type="button"
              title={sharedTriageOpen ? "Collapse Shared Triage folders" : "Expand Shared Triage folders"}
              aria-label={sharedTriageOpen ? "Collapse Shared Triage folders" : "Expand Shared Triage folders"}
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
        <div style={appSidebarViewsBlockStyle(viewsActive, viewsOpen)}>
          <div style={appSidebarViewsRowStyle(viewsActive, viewsOpen)}>
            <button
              type="button"
              style={appSidebarViewsButtonStyle}
              onClick={() => setViewsOpen((open) => !open)}
            >
              <span style={appSidebarTextStyle}>Views</span>
            </button>
            <button
              type="button"
              title={viewsOpen ? "Collapse Views" : "Expand Views"}
              aria-label={viewsOpen ? "Collapse Views" : "Expand Views"}
              style={appSidebarSharedDisclosureStyle}
              onClick={(event) => {
                event.stopPropagation();
                setViewsOpen((open) => !open);
              }}
            >
              <ExplorerDisclosureIcon open={viewsOpen} color="rgba(15, 23, 42, 0.68)" />
            </button>
          </div>
          {viewsOpen && (
            <div className="app-sidebar-elevated-dropdown" style={appSidebarViewsNestedStyle}>
              {APP_SIDEBAR_RACI_VIEWS.map((view) => (
                <AppSidebarButton
                  key={view.viewID}
                  label={view.label}
                  active={homeActive && (activeHomeView === view.viewID || (activeHomeView === "aci-inbox" && view.viewID === "a-inbox"))}
                  trailing={<SidebarNotificationBadges badges={[{
                    key: view.role,
                    count: raciNotificationCounts[view.role] ?? 0,
                    tone: view.role,
                    title: view.notificationTitle,
                    onClick: (event) => openNotificationMenu(event, { title: view.notificationTitle, surface: view.surface, role: view.role }),
                  }]} />}
                  onClick={() => onHomeViewSelect(view.viewID)}
                />
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          title="Create custom view"
          aria-label="Create custom view"
          style={appSidebarCustomViewButtonStyle(homeActive && activeHomeView === "custom-matrix")}
          onClick={() => onHomeViewSelect("custom-matrix")}
        >
          <span style={appSidebarCustomViewPlusStyle}>+</span>
          <span style={appSidebarTextStyle}>Custom View</span>
        </button>
        <AppSidebarButton
          label="My Work"
          active={homeActive && activeHomeView === "my-work"}
          elevated
          onClick={() => onHomeViewSelect("my-work")}
        />
        {notificationMenu && (
          <div style={appSidebarNotificationPopoverOverlayStyle(notificationMenu.anchorTop)}>
            <NotificationPopover
              embedded
              title={notificationMenu.title}
              loading={notificationMenu.loading}
              error={notificationMenu.error}
              items={notificationMenu.items}
              seenNotificationIDs={new Set(notificationMenu.seenNotificationIDs)}
              onClose={() => setNotificationMenu(null)}
              onOpen={openNotificationTarget}
              onClear={clearNotificationMenu}
            />
          </div>
        )}
      </section>

      <section style={appSidebarPrimaryPagesSectionStyle} aria-label="Primary pages">
        <AppSidebarButton
          label="Project Management"
          active={activePage === "project-management"}
          icon={<HeaderProjectManagementIcon color={SIDEBAR_PROJECT_ICON_COLOR} />}
          elevated
          onPointerEnter={preloadProjectManagementSurface}
          onFocus={preloadProjectManagementSurface}
          onPointerDown={preloadProjectManagementSurface}
          onClick={() => onPageSelect("project-management")}
        />
        <AppSidebarButton
          label="Account Manager"
          active={activePage === "account-manager"}
          icon={<HeaderAccountManagerIcon color={SIDEBAR_ACCOUNT_ICON_COLOR} />}
          elevated
          onPointerEnter={preloadAccountManagerSurface}
          onFocus={preloadAccountManagerSurface}
          onPointerDown={preloadAccountManagerSurface}
          onClick={() => onPageSelect("account-manager")}
        />
        <AppSidebarButton
          label="Map"
          active={activePage === "map"}
          icon={<HeaderMapIcon color={SIDEBAR_MAP_ICON_COLOR} />}
          elevated
          onPointerEnter={preloadDefaultDashboardModules}
          onFocus={preloadDefaultDashboardModules}
          onPointerDown={preloadDefaultDashboardModules}
          onClick={() => onPageSelect("map")}
        />
      </section>

      <section
        style={appSidebarPinnedSectionStyle(pinDropActive || !!pinDropTarget)}
        aria-label="Pinned"
        onDragEnter={onPinDragEnter}
        onDragOver={(event) => {
          if (hasSidebarPinDrag(event.dataTransfer)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setPinDropTarget({ key: "__end__", placement: "after" });
            return;
          }
          onPinDragOver(event);
        }}
        onDragLeave={(event) => {
          const related = event.relatedTarget instanceof Node ? event.relatedTarget : null;
          if (related && event.currentTarget.contains(related)) return;
          setPinDropTarget(null);
          onPinDragLeave();
        }}
        onDrop={(event) => {
          const movingPin = readDraggedSidebarPin(event.dataTransfer);
          if (movingPin) {
            event.preventDefault();
            onPinReorder(movingPin, null, "after");
            setPinDropTarget(null);
            return;
          }
          onPinDrop(event);
        }}
      >
        <div style={appSidebarSectionTitleStyle}>Pinned</div>
        <div style={appSidebarPinListStyle}>
          {pins.length === 0 ? (
            <div style={appSidebarEmptyStyle}>No pins</div>
          ) : pins.map((pin) => {
            const pinKey = `${pin.kind}:${pin.id}`;
            const dropPlacement = pinDropTarget?.key === pinKey ? pinDropTarget.placement : null;
            return (
              <div
                key={pinKey}
                draggable
                style={appSidebarPinRowStyle(dropPlacement)}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData(APP_SIDEBAR_PIN_DRAG_MIME, JSON.stringify({ kind: pin.kind, id: pin.id }));
                  event.dataTransfer.setData("text/plain", pin.label);
                  setPinDropTarget(null);
                }}
                onDragEnd={() => setPinDropTarget(null)}
                onDragOver={(event) => {
                  if (!hasSidebarPinDrag(event.dataTransfer)) return;
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = "move";
                  setPinDropTarget({ key: pinKey, placement: getPinDropPlacement(event) });
                }}
                onDrop={(event) => {
                  const movingPin = readDraggedSidebarPin(event.dataTransfer);
                  if (!movingPin) return;
                  event.preventDefault();
                  event.stopPropagation();
                  onPinReorder(movingPin, pin, getPinDropPlacement(event));
                  setPinDropTarget(null);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setPinContextMenu({ x: event.clientX, y: event.clientY, pin });
                }}
              >
                <button type="button" style={appSidebarPinButtonStyle} onClick={() => onPinOpen(pin)}>
                  <span style={appSidebarPinIconStyle}><ExplorerRowIcon kind={pin.kind} /></span>
                  <span style={appSidebarTextStyle}>{pin.label}</span>
                </button>
                <button type="button" aria-label={`Remove ${pin.label}`} style={appSidebarPinRemoveStyle} onClick={() => onPinRemove(pin)}>
                  X
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <AppSidebarCompanyExplorerSection
        selectionTargetFrameIDs={explorerSelectionTargetFrameIDs}
        explorerSearchQuery={explorerSearchQuery}
        onExplorerSearchQueryChange={setExplorerSearchQuery}
        onTriageMessagesDrop={requestExplorerTriageMessageDrop}
      />

      {WORKTREE_VERSION && (
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
            {explorerTriagePriorityMenu.target.kind === "node" ? "Attach to" : "Create in"} {explorerTriagePriorityMenu.target.label}
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
                  <button
                    type="button"
                    style={appSidebarContextMenuButtonStyle}
                    disabled={sharedBusy}
                    onClick={() => openSharedEmailDialog(contextFolder)}
                  >
                    Change inbox email
                  </button>
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
                  style={{ ...appSidebarContextMenuButtonStyle, color: "#334155" }}
                  disabled={sharedBusy}
                  onClick={() => void requestDeleteSharedFolder(contextFolder)}
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
      {pinContextMenu && (
        <FrameRightClickMenu x={pinContextMenu.x} y={pinContextMenu.y} onClose={() => setPinContextMenu(null)}>
          <button
            type="button"
            style={appSidebarContextMenuButtonStyle}
            onClick={() => {
              onPinRemove(pinContextMenu.pin);
              setPinContextMenu(null);
            }}
          >
            De-pin {pinContextMenu.pin.kind === "logic_gate" ? "Logic Gate" : "Node"}
          </button>
        </FrameRightClickMenu>
      )}
    </aside>
  );
}

function AppSidebarCompanyExplorerSection({
  selectionTargetFrameIDs,
  explorerSearchQuery,
  onExplorerSearchQueryChange,
  onTriageMessagesDrop,
}: {
  selectionTargetFrameIDs: string[];
  explorerSearchQuery: string;
  onExplorerSearchQueryChange: React.Dispatch<React.SetStateAction<string>>;
  onTriageMessagesDrop: CompanyExplorerTriageMessageDropHandler;
}): React.ReactElement {
  return (
    <section style={appSidebarCompanyExplorerSectionStyle} aria-label="Company Explorer">
      <React.Suspense fallback={<div aria-busy="true" style={appSidebarExplorerFallbackStyle} />}>
        <SidebarCompanyExplorerContent
          accent={SIDEBAR_ACTIVE_TEXT}
          widgetId={SIDEBAR_EXPLORER_WIDGET_ID}
          theme="light"
          useParentScroll
          selectionTargetFrameIDs={selectionTargetFrameIDs}
          externalSearchQuery={explorerSearchQuery}
          onSearchResultSelect={() => {
            onExplorerSearchQueryChange("");
          }}
          onTriageMessagesDrop={onTriageMessagesDrop}
        />
      </React.Suspense>
    </section>
  );
}

type SidebarNotificationBadgeTone = NotificationRaciRole | "aci" | "mail";

type SidebarNotificationBadge = {
  key: string;
  count: number;
  tone: SidebarNotificationBadgeTone;
  title: string;
  showZero?: boolean;
  onClick?: (event: React.MouseEvent) => void;
};

function notificationSummaryRoleCount(summary: NotificationSummary, surface: NotificationSurface, role: NotificationRaciRole): number {
  return (summary.role_counts ?? []).reduce((count, item) => (
    item.surface === surface && item.role === role ? count + normalizeSidebarNotificationCount(item.count) : count
  ), 0);
}

function sidebarNotificationMatchesFilter(item: NotificationItem, filter: SidebarNotificationMenuFilter): boolean {
  if (filter.type && item.type !== filter.type) return false;
  if (filter.surface && item.surface !== filter.surface) return false;
  if (filter.role && item.role !== filter.role) return false;
  return true;
}

function normalizeSidebarNotificationCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function SidebarNotificationBadges({ badges }: { badges: SidebarNotificationBadge[] }): React.ReactElement | null {
  const visible = badges.filter((badge) => badge.showZero || normalizeSidebarNotificationCount(badge.count) > 0);
  if (visible.length === 0) return null;
  return (
    <span style={appSidebarBadgeStripStyle} aria-label="Notification counts">
      {visible.map((badge) => (
        <span
          key={badge.key}
          title={badge.title}
          aria-label={badge.title}
          style={appSidebarNotificationBadgeStyle(badge.tone)}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            badge.onClick?.(event);
          }}
        >
          {formatSidebarNotificationCount(badge.count)}
        </span>
      ))}
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
      style={appSidebarButtonStyle(active, !!icon, !!trailing, elevated, raised)}
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
      {icon && <span style={appSidebarButtonIconStyle}>{icon}</span>}
      <span style={appSidebarTextStyle}>{label}</span>
      {trailing && <span style={appSidebarTrailingStyle}>{trailing}</span>}
    </button>
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
    <div style={sharedInboxEmailModalBackdropStyle} onPointerDown={onCancel}>
      <form
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
            style={sharedInboxEmailModalInputStyle}
          />
        </label>
        {error && <div style={sharedInboxEmailModalErrorStyle}>{error}</div>}
        <div style={sharedInboxEmailModalActionsStyle}>
          <button type="button" disabled={busy} onClick={onCancel} style={sharedInboxEmailModalSecondaryButtonStyle}>Cancel</button>
          <button type="submit" disabled={busy} style={sharedInboxEmailModalPrimaryButtonStyle}>{busy ? "Saving" : "Save"}</button>
        </div>
      </form>
    </div>
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
    <div style={sharedInboxEmailModalBackdropStyle} onPointerDown={onCancel}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={isSharedInbox ? "Create shared inbox" : "Create Shared Triage folder"}
        style={sharedInboxEmailModalStyle}
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div style={sharedInboxEmailModalTitleStyle}>{isSharedInbox ? "Create shared inbox" : "Create folder"}</div>
        <div style={sharedInboxEmailModalDetailStyle}>{parentLabel ? `Inside ${parentLabel}` : "Shared Triage"}</div>
        <label style={sharedInboxEmailModalLabelStyle}>
          <span>Name</span>
          <input
            ref={nameInputRef}
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder={isSharedInbox ? "Support inbox" : "Finance"}
            disabled={busy}
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
              style={sharedInboxEmailModalInputStyle}
            />
          </label>
        )}
        {error && <div style={sharedInboxEmailModalErrorStyle}>{error}</div>}
        <div style={sharedInboxEmailModalActionsStyle}>
          <button type="button" disabled={busy} onClick={onCancel} style={sharedInboxEmailModalSecondaryButtonStyle}>Cancel</button>
          <button type="submit" disabled={busy} style={sharedInboxEmailModalPrimaryButtonStyle}>{busy ? "Creating" : "Create"}</button>
        </div>
      </form>
    </div>
  );
}

function SharedInboxDeleteDialog({ title, label, detail, confirmLabel, busy, onConfirm, onCancel }: {
  title: string;
  label: string;
  detail: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactElement {
  return (
    <div style={sharedInboxEmailModalBackdropStyle} onPointerDown={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Delete shared inbox"
        style={sharedInboxEmailModalStyle}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div style={sharedInboxEmailModalTitleStyle}>{title}</div>
        <div style={sharedInboxEmailModalDetailStyle}>Delete {detail}: {label}?</div>
        <div style={sharedInboxEmailModalActionsStyle}>
          <button type="button" disabled={busy} onClick={onCancel} style={sharedInboxEmailModalSecondaryButtonStyle}>Cancel</button>
          <button type="button" disabled={busy} onClick={onConfirm} style={{ ...sharedInboxEmailModalPrimaryButtonStyle, borderColor: "#be123c", background: "#be123c" }}>{busy ? "Deleting" : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function SharedInboxEmailConnectionDialog({ accountEmail, busy, onConnect, onCancel }: {
  accountEmail: string;
  busy: boolean;
  onConnect: (provider: EmailProvider) => void;
  onCancel: () => void;
}): React.ReactElement {
  return (
    <div style={sharedInboxEmailModalBackdropStyle} onPointerDown={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Connect shared inbox email"
        style={sharedInboxEmailModalStyle}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div style={sharedInboxEmailModalTitleStyle}>Connect shared inbox email</div>
        <div style={sharedInboxEmailModalDetailStyle}>{accountEmail} is not connected yet.</div>
        <div style={sharedInboxEmailModalActionsStyle}>
          <button type="button" disabled={busy} onClick={() => onConnect("google")} style={sharedInboxEmailModalPrimaryButtonStyle}>Google</button>
          <button type="button" disabled={busy} onClick={() => onConnect("microsoft")} style={sharedInboxEmailModalPrimaryButtonStyle}>Microsoft</button>
        </div>
        <button type="button" disabled={busy} onClick={onCancel} style={sharedInboxEmailModalSecondaryButtonStyle}>Cancel</button>
      </div>
    </div>
  );
}

function storeNodeEditorPopupSize(size: { width: number; height: number }) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(nodeEditorPopupSizeStorageKey(), JSON.stringify(clampNodeEditorPopupSize(size)));
}

function defaultNodeEditorPopupSize(): { width: number; height: number } {
  return readStoredNodeEditorPopupSize() ?? clampNodeEditorPopupSize({ width: 1180, height: 820 });
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

export function AppNodeEditorPopup({ nodeID, nodeTitle, focusInformationID, focusRequestID, onClose, onCollapseToTab }: {
  nodeID: string;
  nodeTitle: string;
  focusInformationID?: string;
  focusRequestID?: number;
  onClose: () => void;
  onCollapseToTab?: () => void;
}): React.ReactElement {
  const [popupRect, setPopupRect] = useState(defaultNodeEditorPopupRect);
  const popupRectRef = useRef(popupRect);

  useEffect(() => {
    popupRectRef.current = popupRect;
  }, [popupRect]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const onResize = () => setPopupRect((current) => clampNodeEditorPopupRect(current));
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
  }, []);

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

  return (
    <div
      style={nodeEditorPopupBackdropStyle}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${nodeTitle} node editor`}
        data-frame-interactive="true"
        style={{ ...nodeEditorPopupStyle, ...nodeEditorPopupDynamicBoundsStyle(popupRect.left), left: popupRect.left, top: popupRect.top, width: popupRect.width, height: popupRect.height }}
        onMouseDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
      >
        {NODE_EDITOR_POPUP_RESIZE_HANDLES.map((handle) => (
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
        {onCollapseToTab && (
          <button
            type="button"
            title="Collapse node editor to app tab"
            aria-label="Collapse node editor to app tab"
            data-frame-interactive="true"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onCollapseToTab}
            style={nodeEditorPopupCollapseButtonStyle}
          >
            <MinimizeToLineIcon />
          </button>
        )}
        <button
          type="button"
          title="Close node editor"
          aria-label="Close node editor"
          data-frame-interactive="true"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={onClose}
          style={nodeEditorPopupCloseButtonStyle}
        >
          X
        </button>
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
          />
        </React.Suspense>
      </div>
    </div>
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

const appSidebarExplorerSearchShellStyle: React.CSSProperties = {
  position: "relative",
  minWidth: 0,
  height: 32,
  border: "1px solid rgba(255, 255, 255, 0.78)",
  borderRadius: 9,
  background: "linear-gradient(145deg, rgba(255, 255, 255, 0.96) 0%, rgba(246, 247, 251, 0.92) 100%)",
  boxShadow: "5px 5px 12px rgba(174, 174, 192, 0.18), -5px -5px 12px rgba(255, 255, 255, 0.84), inset 1px 1px 0 rgba(255, 255, 255, 0.82)",
};

const appSidebarExplorerSearchInputStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  boxSizing: "border-box",
  border: "none",
  borderRadius: 9,
  background: "transparent",
  color: "#111827",
  fontFamily: "var(--mango-font-family)",
  fontSize: 11,
  fontWeight: 620,
  outline: "none",
  padding: "0 30px 0 10px",
};

const appSidebarExplorerSearchIconStyle: React.CSSProperties = {
  position: "absolute",
  right: 9,
  top: 9,
  color: "rgba(15, 23, 42, 0.72)",
  pointerEvents: "none",
};

const appSidebarKeyViewsSectionStyle: React.CSSProperties = {
  position: "relative",
  flex: "0 0 auto",
  display: "grid",
  gap: 8,
  minWidth: 0,
  padding: "2px 3px 14px",
  borderBottom: `1px solid ${SIDEBAR_DIVIDER}`,
};

function appSidebarViewsBlockStyle(active: boolean, open: boolean): React.CSSProperties {
  return {
    display: "grid",
    gap: 0,
    minWidth: 0,
    margin: 0,
    border: `1px solid ${active ? "transparent" : SIDEBAR_SOFT_BORDER}`,
    borderRadius: SIDEBAR_ELEVATED_RADIUS,
    background: active ? `${SIDEBAR_NEUMORPHIC_ACTIVE_SURFACE} padding-box, ${SIDEBAR_EDGE_FRAME_GRADIENT} border-box` : SIDEBAR_NEUMORPHIC_SURFACE,
    boxShadow: active ? `${SIDEBAR_NEUMORPHIC_ACTIVE_SHADOW}, ${SIDEBAR_EDGE_FRAME_SHADOW}` : SIDEBAR_NEUMORPHIC_SHADOW,
    overflow: open ? "hidden" : "visible",
  };
}

function appSidebarViewsRowStyle(active: boolean, open: boolean): React.CSSProperties {
  return {
    width: "100%",
    minHeight: 44,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 34px",
    alignItems: "center",
    border: "none",
    borderRadius: open ? `${SIDEBAR_ELEVATED_RADIUS - 1}px ${SIDEBAR_ELEVATED_RADIUS - 1}px 0 0` : SIDEBAR_ELEVATED_RADIUS - 1,
    background: active ? SIDEBAR_NEUMORPHIC_ACTIVE_SURFACE : "transparent",
    color: SIDEBAR_ACTIVE_TEXT,
    minWidth: 0,
  };
}

const appSidebarViewsButtonStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 42,
  display: "grid",
  alignItems: "center",
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

const appSidebarViewsNestedStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  alignContent: "start",
  gap: 4,
  padding: "4px 6px 7px",
};

function appSidebarNotificationPopoverOverlayStyle(top: number): React.CSSProperties {
  return {
    position: "absolute",
    top,
    left: 3,
    right: 3,
    zIndex: NODE_EDITOR_POPUP_NOTIFICATION_Z_INDEX,
    minWidth: 0,
    pointerEvents: "auto",
  };
}

const appSidebarPrimaryPagesSectionStyle: React.CSSProperties = {
  flex: "0 0 auto",
  display: "grid",
  gap: 8,
  minWidth: 0,
  padding: "0 3px 12px",
  borderBottom: `1px solid ${SIDEBAR_DIVIDER}`,
};

function appSidebarPinnedSectionStyle(active: boolean): React.CSSProperties {
  return {
    flex: "0 0 auto",
    display: "grid",
    gridTemplateRows: "auto minmax(44px, auto)",
    gap: 5,
    minWidth: 0,
    padding: "0 0 10px",
    borderBottom: `1px solid ${SIDEBAR_DIVIDER}`,
    outline: active ? "2px solid rgba(148, 163, 184, 0.24)" : "2px solid transparent",
    outlineOffset: 2,
    borderRadius: 6,
  };
}

const appSidebarCompanyExplorerSectionStyle: React.CSSProperties = {
  flex: "0 0 auto",
  minWidth: 0,
  display: "block",
  padding: "0 0 10px",
  borderBottom: `1px solid ${SIDEBAR_DIVIDER}`,
};

const appSidebarSectionTitleStyle: React.CSSProperties = {
  padding: "0 6px",
  color: "#111111",
  fontSize: 12,
  fontWeight: 650,
  letterSpacing: 0,
};

function appSidebarButtonStyle(active: boolean, hasIcon: boolean, hasTrailing: boolean, elevated: boolean, raised = false): React.CSSProperties {
  if (elevated) {
    const framed = active || raised;
    const surface = active ? SIDEBAR_NEUMORPHIC_ACTIVE_SURFACE : SIDEBAR_NEUMORPHIC_SURFACE;
    return {
      width: "100%",
      minHeight: 44,
      display: "grid",
      gridTemplateColumns: appSidebarButtonGridColumns(hasIcon, hasTrailing),
      alignItems: "center",
      gap: 8,
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
      padding: hasIcon ? "0 12px" : "0 12px 0 14px",
      textAlign: "left",
      minWidth: 0,
      transition: "background 140ms ease, border-color 140ms ease, box-shadow 160ms ease, transform 160ms ease",
    };
  }
  return {
    width: "100%",
    minHeight: 31,
    display: "grid",
    gridTemplateColumns: appSidebarButtonGridColumns(hasIcon, hasTrailing),
    alignItems: "center",
    gap: 7,
    border: `1px solid ${active ? SIDEBAR_STATE_ACTIVE_BORDER : "transparent"}`,
    borderRadius: 6,
    background: active ? SIDEBAR_STATE_ACTIVE_BG : "transparent",
    color: active ? SIDEBAR_ACTIVE_TEXT : "#334155",
    cursor: "pointer",
    font: "inherit",
    fontSize: 12,
    fontWeight: active ? 600 : 500,
    letterSpacing: 0,
    padding: "0 8px",
    textAlign: "left",
    minWidth: 0,
  };
}

function appSidebarCustomViewButtonStyle(active: boolean): React.CSSProperties {
  return {
    width: "100%",
    minHeight: 34,
    display: "grid",
    gridTemplateColumns: "28px minmax(0, 1fr)",
    alignItems: "center",
    gap: 8,
    margin: "2px 0 0",
    border: `1px solid ${active ? "transparent" : SIDEBAR_SOFT_BORDER}`,
    borderRadius: SIDEBAR_ELEVATED_RADIUS,
    background: active ? `${SIDEBAR_NEUMORPHIC_ACTIVE_SURFACE} padding-box, ${SIDEBAR_EDGE_FRAME_GRADIENT} border-box` : SIDEBAR_NEUMORPHIC_SURFACE,
    color: SIDEBAR_ACTIVE_TEXT,
    boxShadow: active ? `${SIDEBAR_NEUMORPHIC_ACTIVE_SHADOW}, ${SIDEBAR_EDGE_FRAME_SHADOW}` : SIDEBAR_NEUMORPHIC_SHADOW,
    cursor: "pointer",
    font: "inherit",
    fontSize: 12,
    fontWeight: active ? 700 : 600,
    letterSpacing: 0,
    padding: "4px 8px 4px 4px",
    textAlign: "left",
    minWidth: 0,
  };
}

const appSidebarCustomViewPlusStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  display: "grid",
  placeItems: "center",
  border: "1px solid rgba(100, 116, 139, 0.32)",
  borderRadius: 7,
  background: "#ffffff",
  color: "#334155",
  fontSize: 18,
  fontWeight: 800,
  lineHeight: 1,
};

const appSidebarButtonIconStyle: React.CSSProperties = {
  width: 16,
  display: "grid",
  placeItems: "center",
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

const appSidebarBadgeStripStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 3,
  overflow: "hidden",
};

function appSidebarNotificationBadgeStyle(tone: SidebarNotificationBadgeTone): React.CSSProperties {
  const colors = sidebarNotificationBadgeColors(tone);
  return {
    minWidth: 20,
    height: 20,
    display: "grid",
    placeItems: "center",
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

function sidebarNotificationBadgeColors(tone: SidebarNotificationBadgeTone): { background: string; border: string; color: string } {
  switch (tone) {
    case "responsible":
      return { background: "#fff7ed", border: "rgba(255, 136, 32, 0.36)", color: "#c2410c" };
    case "accountable":
      return { background: "#fff7ed", border: "rgba(255, 136, 32, 0.38)", color: "#c2410c" };
    case "consulted":
      return { background: "#fff7ed", border: "rgba(255, 136, 32, 0.34)", color: "#c2410c" };
    case "informed":
      return { background: "#fff7ed", border: "rgba(255, 136, 32, 0.32)", color: "#c2410c" };
    case "other":
      return { background: "#fffaf3", border: "rgba(255, 136, 32, 0.30)", color: "#c2410c" };
    case "aci":
      return { background: "#fff7ed", border: "rgba(255, 136, 32, 0.34)", color: "#c2410c" };
    case "mail":
    default:
      return { background: "#fff7ed", border: "rgba(255, 136, 32, 0.36)", color: "#c2410c" };
  }
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
  };
}

const appSidebarSharedTriageButtonStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 42,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
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

const appSidebarPinListStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  alignContent: "start",
  gap: 4,
  padding: "0 2px",
};

const appSidebarEmptyStyle: React.CSSProperties = {
  minHeight: 34,
  display: "flex",
  alignItems: "center",
  padding: "0 6px",
  color: "rgba(15, 23, 42, 0.48)",
  fontSize: 11,
  fontWeight: 600,
};

function appSidebarPinRowStyle(dropPlacement: "before" | "after" | null): React.CSSProperties {
  return {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 24px",
    alignItems: "center",
    gap: 4,
    cursor: "grab",
    boxShadow: dropPlacement === "before"
      ? "inset 0 2px 0 rgba(100, 116, 139, 0.58)"
      : dropPlacement === "after"
        ? "inset 0 -2px 0 rgba(100, 116, 139, 0.58)"
        : undefined,
  };
}

const appSidebarPinButtonStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 36,
  display: "grid",
  gridTemplateColumns: "24px minmax(0, 1fr)",
  alignItems: "center",
  gap: 7,
  border: "1px solid transparent",
  borderRadius: 6,
  background: `#ffffff padding-box, ${SIDEBAR_EDGE_FRAME_GRADIENT} border-box`,
  color: SIDEBAR_ACTIVE_TEXT,
  cursor: "pointer",
  font: "inherit",
  fontSize: 11.5,
  fontWeight: 600,
  padding: "0 8px",
  textAlign: "left",
  boxShadow: "0 0 0 1px rgba(120, 224, 255, 0.10), inset 1px 1px 0 rgba(255, 255, 255, 0.9)",
};

const appSidebarPinIconStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  display: "grid",
  placeItems: "center",
  color: SIDEBAR_ACTIVE_TEXT,
  transform: "scale(1.25)",
};

const appSidebarPinRemoveStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  display: "grid",
  placeItems: "center",
  border: "1px solid rgba(100, 116, 139, 0.28)",
  borderRadius: 5,
  background: "#ffffff",
  color: "rgba(15, 23, 42, 0.58)",
  cursor: "pointer",
  font: "inherit",
  fontSize: 10,
  fontWeight: 700,
  lineHeight: 1,
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
  zIndex: 190,
  display: "grid",
  placeItems: "center",
  background: "rgba(0,0,0,0.28)",
  padding: 16,
};

const sharedInboxEmailModalStyle: React.CSSProperties = {
  width: "min(420px, 100%)",
  display: "grid",
  gap: 10,
  border: "1px solid rgba(100,116,139,0.45)",
  borderRadius: 10,
  background: "#ffffff",
  color: "#111827",
  padding: 12,
  boxShadow: "0 18px 42px rgba(0,0,0,0.18)",
};

const sharedInboxEmailModalTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
};

const sharedInboxEmailModalDetailStyle: React.CSSProperties = {
  color: "rgba(15, 23, 42, 0.68)",
  fontSize: 11,
  lineHeight: 1.35,
};

const sharedInboxEmailModalLabelStyle: React.CSSProperties = {
  display: "grid",
  gap: 5,
  minWidth: 0,
  fontSize: 11,
  fontWeight: 700,
};

const sharedInboxEmailModalInputStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  height: 34,
  border: "1px solid rgba(100, 116, 139, 0.28)",
  borderRadius: 6,
  padding: "0 9px",
  font: "inherit",
  fontSize: 12,
  boxSizing: "border-box",
};

const sharedInboxEmailModalErrorStyle: React.CSSProperties = {
  color: "#8b123f",
  fontSize: 11,
  fontWeight: 700,
};

const sharedInboxEmailModalActionsStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 8,
};

const sharedInboxEmailModalSecondaryButtonStyle: React.CSSProperties = {
  minHeight: 32,
  border: "1px solid rgba(0,0,0,0.16)",
  borderRadius: 6,
  background: "#ffffff",
  color: "#111111",
  cursor: "pointer",
  font: "inherit",
  fontWeight: 700,
};

const sharedInboxEmailModalPrimaryButtonStyle: React.CSSProperties = {
  ...sharedInboxEmailModalSecondaryButtonStyle,
  border: "1px solid rgba(100,116,139,0.74)",
  background: "#64748b",
  color: "#111111",
};

const nodeEditorPopupBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: NODE_EDITOR_POPUP_Z_INDEX,
  display: "block",
  background: "rgba(15, 23, 42, 0.18)",
  padding: 0,
};

const nodeEditorPopupStyle: React.CSSProperties = {
  position: "absolute",
  width: "min(1180px, calc(100vw - 44px))",
  height: "min(820px, calc(100vh - 64px))",
  minWidth: "min(420px, calc(100vw - 44px))",
  minHeight: "min(320px, calc(100vh - 64px))",
  maxWidth: "calc(100vw - 44px)",
  maxHeight: "calc(100vh - 64px)",
  boxSizing: "border-box",
  border: "1px solid rgba(100, 116, 139, 0.54)",
  borderRadius: 16,
  background: "#ffffff",
  boxShadow: "0 18px 42px rgba(15, 23, 42, 0.22), inset 0 0 0 1px rgba(255, 255, 255, 0.72)",
  overflow: "hidden",
  cursor: "default",
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
