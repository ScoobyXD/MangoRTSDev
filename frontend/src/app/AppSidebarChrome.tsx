import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getActiveCompanyID } from "../auth/currentCompany";
import FrameRightClickMenu from "./framerightclickmenu";
import { HeaderLogicGateArenaIcon, HeaderMapIcon, HeaderPersonIcon } from "./HeaderIcons";
import { MangoWordmark } from "./MangoLogo";
import { UI_THEME } from "./frameLayoutTypes";
import { preloadDefaultDashboardModules } from "./preloadDashboardModules";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../modules/company-explorer/CompanyExplorerIcons";
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
import { fetchNotifications, markNotificationRead, type NotificationItem, type NotificationRaciRole, type NotificationSummary, type NotificationSurface } from "../modules/notifications/notificationsApi";
import { emitDashboardEvent, EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED } from "../modules/node-map/eventbus";
import {
  buildSharedInboxRows,
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
  }>,
})));

const fullPageFallback = <div aria-busy="true" style={{ width: "100%", height: "100%", background: "#ffffff" }} />;
const PAGE_SURFACE_RADIUS = 16;
export const SIDEBAR_EXPLORER_WIDGET_ID = "app-sidebar-explorer";
const SIDEBAR_LOGIC_GATES_BY_FUNCTION_WIDGET_ID = "app-sidebar-logic-gates-by-function";
const SIDEBAR_LOGIC_GATES_BY_PERSON_WIDGET_ID = "app-sidebar-logic-gates-by-person";
const SHARED_TRIAGE_FOLDER_DRAG_MIME = "application/x-mangorts-shared-triage-folder";
const SIDEBAR_SECTION_OPEN_KEY_PREFIX = "mangorts.app-sidebar-section-open.v1";
const APP_SIDEBAR_PIN_DRAG_MIME = "application/x-mangorts-sidebar-pin";
const NODE_EDITOR_POPUP_MIN_WIDTH = 420;
const NODE_EDITOR_POPUP_MIN_HEIGHT = 320;
const NODE_EDITOR_POPUP_VIEWPORT_WIDTH_INSET = 44;
const NODE_EDITOR_POPUP_VIEWPORT_HEIGHT_INSET = 64;
const NODE_EDITOR_POPUP_SIZE_STORAGE_KEY_PREFIX = "app-node-editor-popup-size-v1";
const SIDEBAR_ELEVATED_RADIUS = 10;
const SIDEBAR_CYAN_ACCENT = "rgb(0, 233, 255)";
const SIDEBAR_CYAN_ACTIVE_BG = "rgba(0, 233, 255, 0.13)";
const SIDEBAR_CYAN_OPEN_BG = "rgba(0, 233, 255, 0.09)";
const SIDEBAR_CYAN_DROP_BG = "rgba(0, 233, 255, 0.12)";
const SIDEBAR_CYAN_ACTIVE_BORDER = "rgba(0, 233, 255, 0.68)";
const SIDEBAR_CYAN_OPEN_BORDER = "rgba(0, 233, 255, 0.52)";
const SIDEBAR_ACTIVE_TEXT = "#111111";

type SidebarSectionID = "shared-triage" | "logic-gates-by-function" | "logic-gates-by-person" | "explorer";

export type HomeSidebarView = "my-triage" | "shared-root" | "aci-inbox" | "r-inbox" | `shared:${string}`;
export type { SidebarPin, SidebarPinKind } from "./sidebarPins";

type AppSidebarPrimaryPage = "map" | "home" | "logic-gate-arena";

type AppSidebarProps = {
  accountChrome?: React.ReactNode;
  activePage: AppSidebarPrimaryPage | null;
  activeHomeView: HomeSidebarView;
  pins: SidebarPin[];
  pinDropActive: boolean;
  explorerSelectionTargetFrameIDs: string[];
  onHomeViewSelect: (view: HomeSidebarView) => void;
  onPageSelect: (page: AppSidebarPrimaryPage) => void;
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
  x: number;
  y: number;
  loading: boolean;
  error: string;
  items: NotificationItem[];
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

function promptEmailProviderForConnection(): EmailProvider | "" {
  const raw = window.prompt("Connect with provider: google or microsoft", "google")?.trim().toLowerCase() ?? "";
  if (raw === "google" || raw === "gmail") return "google";
  if (raw === "microsoft" || raw === "outlook" || raw === "office365") return "microsoft";
  if (raw) window.alert("Enter google or microsoft.");
  return "";
}

function isSharedInboxEmailConnectionError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("shared_inbox_email_account_not_connected");
}

async function offerNylasConnectionForSharedInboxEmail(error: unknown, accountEmail: string): Promise<boolean> {
  const cleanAccountEmail = accountEmail.trim().toLowerCase();
  if (!cleanAccountEmail || !isSharedInboxEmailConnectionError(error)) return false;
  if (!window.confirm(`${cleanAccountEmail} is not connected yet. Connect it through Nylas now?`)) return true;
  const provider = promptEmailProviderForConnection();
  if (!provider) return true;
  const authURL = await fetchCommunicationsAuthURL(provider, cleanAccountEmail);
  window.location.assign(authURL);
  return true;
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
  const [sharedTriageOpen, setSharedTriageOpen] = usePersistedSidebarSectionOpen("shared-triage", true);
  const [logicGatesByFunctionOpen, setLogicGatesByFunctionOpen] = usePersistedSidebarSectionOpen("logic-gates-by-function", false);
  const [logicGatesByPersonOpen, setLogicGatesByPersonOpen] = usePersistedSidebarSectionOpen("logic-gates-by-person", false);
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
  const [sharedEmailDialog, setSharedEmailDialog] = useState<{ folder: CommunicationsSharedInbox; draft: string; error: string } | null>(null);
  const [pinContextMenu, setPinContextMenu] = useState<{ x: number; y: number; pin: SidebarPin } | null>(null);
  const [notificationMenu, setNotificationMenu] = useState<SidebarNotificationMenuState | null>(null);
  const [pinDropTarget, setPinDropTarget] = useState<{ key: string; placement: "before" | "after" } | null>(null);
  const [mailUnreadCounts, setMailUnreadCounts] = useState({ myTriage: 0, sharedTriage: 0 });
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const sharedEmailInputRef = useRef<HTMLInputElement | null>(null);
  const skipRenameBlurRef = useRef(false);
  const cleanConnectedAccountEmail = connectedAccountEmail.trim().toLowerCase();
  const sharedRows = useMemo(
    () => sharedTriageOpen ? buildSharedInboxRows(sharedInboxes, expandedSharedFolderIDs) : [],
    [expandedSharedFolderIDs, sharedInboxes, sharedTriageOpen],
  );
  const sharedTriageActive = homeActive && (activeHomeView === "shared-root" || activeHomeView.startsWith("shared:"));
  const aciNotificationCount = useMemo(
    () => notificationSummaryRoleCount(notificationSummary, "aci_inbox", "accountable")
      + notificationSummaryRoleCount(notificationSummary, "aci_inbox", "consulted")
      + notificationSummaryRoleCount(notificationSummary, "aci_inbox", "informed")
      + notificationSummaryRoleCount(notificationSummary, "aci_inbox", "other"),
    [notificationSummary],
  );
  const responsibleNotificationCount = useMemo(
    () => notificationSummaryRoleCount(notificationSummary, "r_inbox", "responsible"),
    [notificationSummary],
  );
  const mentionNotificationCount = useMemo(
    () => notificationSummaryTypeCount(notificationSummary, "mention.created"),
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
  const sharedTriageRaised = sharedTriageOpen || sharedTriageHovered || sharedTriageFocused;
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
    setNotificationMenu(null);
    onPageSelect("home");
    onHomeViewSelect(view);
  }, [onHomeViewSelect, onPageSelect]);

  useEffect(() => {
    if (activeHomeView.startsWith("shared:")) return;
    setSelectedSharedTreeIDs((previous) => previous.size === 0 ? previous : new Set());
    setSharedSelectionAnchorTreeID("");
  }, [activeHomeView]);
  const openNotificationMenu = useCallback((event: React.MouseEvent, filter: SidebarNotificationMenuFilter) => {
    event.preventDefault();
    event.stopPropagation();
    const nextMenu: SidebarNotificationMenuState = {
      ...filter,
      x: event.clientX,
      y: event.clientY,
      loading: true,
      error: "",
      items: [],
    };
    setNotificationMenu(nextMenu);
    fetchNotifications({ companyID, type: filter.type, unreadOnly: true, limit: 100 })
      .then((items) => {
        const filtered = items.filter((item) => sidebarNotificationMatchesFilter(item, filter));
        setNotificationMenu((current) => (
          current?.x === nextMenu.x && current?.y === nextMenu.y
            ? { ...current, loading: false, items: filtered }
            : current
        ));
      })
      .catch((error) => {
        setNotificationMenu((current) => (
          current?.x === nextMenu.x && current?.y === nextMenu.y
            ? { ...current, loading: false, error: error instanceof Error ? error.message : "Failed to load notifications" }
            : current
        ));
      });
  }, [companyID]);

  const openNotificationTarget = useCallback((notification: NotificationItem) => {
    const notificationID = notification.notification_id.trim();
    if (notificationID) {
      setNotificationMenu((current) => current ? { ...current, items: current.items.filter((item) => item.notification_id !== notificationID) } : current);
      void markNotificationRead(notificationID, true).catch((error) => console.error("Failed to clear notification", error));
    }
    setNotificationMenu(null);

    const nodeID = notification.node_id?.trim() || (notification.entity_type === "node" ? notification.entity_id.trim() : "");
    const logicGateID = notification.logic_gate_id?.trim() || (notification.entity_type === "logic_gate" ? notification.entity_id.trim() : "");
    if (notification.type === "mention.created" && logicGateID) {
      emitDashboardEvent(EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED, {
        companyID: notification.company_id || companyID,
        sourceFrameID: "app-sidebar-notifications",
        kind: "logic_gate",
        id: logicGateID,
        label: notification.title || logicGateID,
        nodeID: nodeID || undefined,
        selectedTreeID: `logic-gate-${logicGateID}`,
        changedAt: Date.now(),
      });
      return;
    }
    if (nodeID) {
      emitDashboardEvent(EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED, {
        companyID: notification.company_id || companyID,
        sourceFrameID: "app-sidebar-notifications",
        kind: "node",
        id: nodeID,
        label: notification.title || nodeID,
        selectedTreeID: `node-${nodeID}`,
        changedAt: Date.now(),
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
        changedAt: Date.now(),
      });
      return;
    }
    if (notification.surface === "aci_inbox") openMailBadgeView("aci-inbox");
    else if (notification.surface === "r_inbox") openMailBadgeView("r-inbox");
    else if (notification.surface === "shared_triage") openMailBadgeView("shared-root");
    else openMailBadgeView("my-triage");
  }, [companyID, openMailBadgeView]);

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

  const createSharedFolder = useCallback(async (parentFolderID: string, accountEmail = "") => {
    if (!companyID || sharedBusy) return;
    setSharedContextMenu(null);
    setSharedBusy(true);
    setSharedError("");
    try {
      const name = accountEmail.trim() || "New Folder";
      const folder = await createCommunicationsSharedInbox({ companyID, parentFolderID, name, accountEmail });
      setSharedInboxes((previous) => [...previous.filter((item) => item.folder_id !== folder.folder_id), folder]);
      if (parentFolderID) setExpandedSharedFolderIDs((previous) => new Set(previous).add(parentFolderID));
      setSharedTriageOpen(true);
      if (!accountEmail.trim()) {
        setRenamingSharedFolderID(folder.folder_id);
        setRenameDraft(folder.name);
      }
      onHomeViewSelect(`shared:${folder.folder_id}`);
    } catch (error) {
      if (await offerNylasConnectionForSharedInboxEmail(error, accountEmail)) return;
      setSharedError(formatSidebarSharedInboxError(error, "Failed to create Shared Triage folder"));
      console.error("Failed to create shared triage folder", error);
    } finally {
      setSharedBusy(false);
    }
  }, [companyID, onHomeViewSelect, sharedBusy]);

  const setSharedFolderAccountEmail = useCallback(async (folderID: string, accountEmail: string) => {
    if (!companyID || sharedBusy) return;
    if (accountEmail.trim() && sharedInboxes.some((folder) => (folder.parent_folder_id ?? "").trim() === folderID.trim())) {
      setSharedContextMenu(null);
      setSharedError("Parent folders cannot have emails assigned.");
      return;
    }
    setSharedContextMenu(null);
    setSharedBusy(true);
    setSharedError("");
    try {
      const updated = await updateCommunicationsSharedInbox({ companyID, folderID, accountEmail });
      replaceSharedFolder(updated);
    } catch (error) {
      if (await offerNylasConnectionForSharedInboxEmail(error, accountEmail)) return;
      setSharedError(formatSidebarSharedInboxError(error, "Failed to update Shared Triage email"));
      console.error("Failed to update shared triage email account", error);
    } finally {
      setSharedBusy(false);
    }
  }, [companyID, replaceSharedFolder, sharedBusy, sharedInboxes]);

  const openSharedEmailDialog = useCallback((folder: CommunicationsSharedInbox) => {
    if (sharedInboxes.some((item) => (item.parent_folder_id ?? "").trim() === folder.folder_id)) {
      setSharedContextMenu(null);
      return;
    }
    setSharedContextMenu(null);
    setSharedEmailDialog({
      folder,
      draft: (folder.account_email ?? cleanConnectedAccountEmail).trim().toLowerCase(),
      error: "",
    });
  }, [cleanConnectedAccountEmail, sharedInboxes]);

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
    const count = subtreeIDs.size || 1;
    const label = folder.name.trim() || "this folder";
    const detail = count === 1 ? "this folder" : `this folder and ${count - 1} child folder${count === 2 ? "" : "s"}`;
    if (!window.confirm(`Delete ${detail}: ${label}?`)) return;
    setSharedBusy(true);
    setSharedError("");
    try {
      await deleteCommunicationsSharedInbox(companyID, folder.folder_id);
      setSharedInboxes((previous) => previous.filter((item) => !subtreeIDs.has(item.folder_id)));
      const activeFolderID = activeHomeView.startsWith("shared:") ? activeHomeView.slice("shared:".length) : "";
      if (activeFolderID && subtreeIDs.has(activeFolderID)) onHomeViewSelect("shared-root");
    } catch (error) {
      setSharedError(formatSidebarSharedInboxError(error, "Failed to delete Shared Triage folder"));
      console.error("Failed to delete shared triage folder", error);
    } finally {
      setSharedBusy(false);
    }
  }, [activeHomeView, companyID, onHomeViewSelect, sharedBusy, sharedInboxes]);

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
    const hasAssignedEmail = Boolean(folder.account_email?.trim());
    const isRenaming = renamingSharedFolderID === folder.folder_id;
    const rowDropPlacement = dropTarget?.folderID === folder.folder_id ? dropTarget.placement : null;
    const treeID = row.treeID as HomeSidebarView;
    return (
      <div
        key={folder.folder_id}
        role="button"
        tabIndex={0}
        draggable={!isRenaming && !sharedBusy}
        style={appSidebarSharedFolderRowStyle(row.depth, homeActive && (activeHomeView === treeID || selectedSharedTreeIDs.has(row.treeID)), rowDropPlacement)}
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
            <ExplorerDisclosureIcon open={expandedSharedFolderIDs.has(folder.folder_id)} color="rgba(36, 18, 10, 0.62)" />
          </button>
        ) : (
          <span style={{ width: 18, height: 20 }} />
        )}
        <span style={appSidebarSharedFolderIconStyle}>
          {hasAssignedEmail ? <SharedInboxAssignedEmailIcon /> : <ExplorerRowIcon kind="folder" />}
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

  return (
    <aside className="company-explorer-scroll" style={appSidebarStyle}>
      <div style={appSidebarBrandStyle} aria-label="MangoRTS">
        <MangoWordmark size={22} weight={600} />
        {accountChrome && <div style={appSidebarAccountChromeStyle}>{accountChrome}</div>}
      </div>

      <section style={appSidebarSectionStyle} aria-label="Home inboxes">
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
          style={appSidebarSharedRootBlockStyle(sharedTriageActive || dropTarget?.folderID === "", sharedTriageRaised)}
          onPointerEnter={() => setSharedTriageHovered(true)}
          onPointerLeave={() => setSharedTriageHovered(false)}
          onFocus={() => setSharedTriageFocused(true)}
          onBlur={(event) => {
            if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
            setSharedTriageFocused(false);
          }}
        >
          <div
            style={appSidebarSharedTriageRowStyle(sharedTriageActive, dropTarget?.folderID === "", true, sharedTriageOpen, sharedTriageRaised)}
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
              <ExplorerDisclosureIcon open={sharedTriageOpen} color="rgba(36, 18, 10, 0.68)" />
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
          label="ACIO Nodes"
          active={homeActive && activeHomeView === "aci-inbox"}
          elevated
          trailing={<SidebarNotificationBadges badges={[{
            key: "aci",
            count: aciNotificationCount,
            tone: "aci",
            title: "ACIO nodes with changes",
            onClick: (event) => openNotificationMenu(event, { title: "ACIO notifications", surface: "aci_inbox" }),
          }]} />}
          onClick={() => onHomeViewSelect("aci-inbox")}
        />
        <AppSidebarButton
          label="R Nodes"
          active={homeActive && activeHomeView === "r-inbox"}
          elevated
          trailing={<SidebarNotificationBadges badges={[{
            key: "responsible",
            count: responsibleNotificationCount,
            tone: "responsible",
            title: "Responsible notifications",
            onClick: (event) => openNotificationMenu(event, { title: "Responsible notifications", surface: "r_inbox", role: "responsible" }),
          }]} />}
          onClick={() => onHomeViewSelect("r-inbox")}
        />
        <AppSidebarButton
          label="@ Mentions"
          active={notificationMenu?.type === "mention.created"}
          trailing={<SidebarNotificationBadges badges={[{
            key: "mentions",
            count: mentionNotificationCount,
            tone: "mention",
            title: "Unread mention notifications",
            showZero: true,
            onClick: (event) => openNotificationMenu(event, { title: "@ Mentions", type: "mention.created" }),
          }]} />}
          onClick={(event) => openNotificationMenu(event, { title: "@ Mentions", type: "mention.created" })}
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

      <section style={appSidebarSectionStyle} aria-label="Primary pages">
        <AppSidebarScopedExplorerSection
          label="Logic Gates by Function"
          open={logicGatesByFunctionOpen}
          icon={<HeaderLogicGateArenaIcon />}
          widgetId={SIDEBAR_LOGIC_GATES_BY_FUNCTION_WIDGET_ID}
          floating
          selectionTargetFrameIDs={explorerSelectionTargetFrameIDs}
          onToggle={() => setLogicGatesByFunctionOpen((open) => !open)}
        />
        <AppSidebarScopedExplorerSection
          label="Logic Gates by Person"
          open={logicGatesByPersonOpen}
          icon={<HeaderPersonIcon />}
          widgetId={SIDEBAR_LOGIC_GATES_BY_PERSON_WIDGET_ID}
          floating
          selectionTargetFrameIDs={explorerSelectionTargetFrameIDs}
          onToggle={() => setLogicGatesByPersonOpen((open) => !open)}
        />
        <AppSidebarButton
          label="Map"
          active={activePage === "map"}
          icon={<HeaderMapIcon />}
          elevated
          onPointerEnter={preloadDefaultDashboardModules}
          onFocus={preloadDefaultDashboardModules}
          onPointerDown={preloadDefaultDashboardModules}
          onClick={() => onPageSelect("map")}
        />
      </section>

      <section style={appSidebarExplorerSectionStyle} aria-label="Explorer tree">
        <React.Suspense fallback={<div aria-busy="true" style={appSidebarExplorerFallbackStyle} />}>
          <SidebarCompanyExplorerContent
            accent={SIDEBAR_ACTIVE_TEXT}
            widgetId={SIDEBAR_EXPLORER_WIDGET_ID}
            theme="light"
            useParentScroll
            selectionTargetFrameIDs={explorerSelectionTargetFrameIDs}
          />
        </React.Suspense>
      </section>
      {sharedContextMenu && (() => {
        const contextFolder = sharedContextMenu.folder;
        const contextFolderHasChildren = !!contextFolder && sharedInboxes.some((folder) => (folder.parent_folder_id ?? "").trim() === contextFolder.folder_id);
        return (
          <FrameRightClickMenu x={sharedContextMenu.x} y={sharedContextMenu.y} onClose={() => setSharedContextMenu(null)}>
            <button
              type="button"
              style={appSidebarContextMenuButtonStyle}
              disabled={sharedBusy}
              onClick={() => void createSharedFolder(contextFolder?.folder_id ?? "")}
            >
              {contextFolder ? "New Child Folder" : "New Folder"}
            </button>
            {contextFolder && (
              <>
                {!contextFolderHasChildren && (
                  <button
                    type="button"
                    style={appSidebarContextMenuButtonStyle}
                    disabled={sharedBusy}
                    onClick={() => openSharedEmailDialog(contextFolder)}
                  >
                    Assign email to inbox
                  </button>
                )}
                {!contextFolderHasChildren && contextFolder.account_email && (
                  <button
                    type="button"
                    style={appSidebarContextMenuButtonStyle}
                    disabled={sharedBusy}
                    onClick={() => void setSharedFolderAccountEmail(contextFolder.folder_id, "")}
                  >
                    Detach Email
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
                  style={{ ...appSidebarContextMenuButtonStyle, color: "#8b123f" }}
                  disabled={sharedBusy}
                  onClick={() => void requestDeleteSharedFolder(contextFolder)}
                >
                  Delete
                </button>
              </>
            )}
          </FrameRightClickMenu>
        );
      })()}
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
      {notificationMenu && (
        <FrameRightClickMenu x={notificationMenu.x} y={notificationMenu.y} onClose={() => setNotificationMenu(null)}>
          <div style={appSidebarNotificationMenuStyle}>
            <div style={appSidebarNotificationMenuHeaderStyle}>{notificationMenu.title}</div>
            {notificationMenu.loading ? (
              <div style={appSidebarNotificationMenuEmptyStyle}>Loading</div>
            ) : notificationMenu.error ? (
              <div style={appSidebarNotificationMenuErrorStyle}>{notificationMenu.error}</div>
            ) : notificationMenu.items.length === 0 ? (
              <div style={appSidebarNotificationMenuEmptyStyle}>No unread notifications</div>
            ) : notificationMenu.items.map((notification) => (
              <button
                key={notification.notification_id}
                type="button"
                style={appSidebarNotificationMenuItemStyle}
                onClick={() => openNotificationTarget(notification)}
              >
                <span style={appSidebarNotificationMenuTitleStyle}>{notification.title}</span>
                {notification.body_preview && <span style={appSidebarNotificationMenuBodyStyle}>{notification.body_preview}</span>}
                <span style={appSidebarNotificationMenuMetaStyle}>{formatSidebarNotificationTimestamp(notification.created_timestamp)}</span>
              </button>
            ))}
          </div>
        </FrameRightClickMenu>
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

type SidebarNotificationBadgeTone = NotificationRaciRole | "aci" | "mail" | "mention";

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

function notificationSummaryTypeCount(summary: NotificationSummary, type: string): number {
  const cleanType = type.trim();
  if (!cleanType) return 0;
  return (summary.type_counts ?? []).reduce((count, item) => (
    item.type === cleanType ? count + normalizeSidebarNotificationCount(item.count) : count
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

function formatSidebarNotificationTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  const deltaMs = Date.now() - timestamp;
  if (deltaMs < 60_000) return "Now";
  if (deltaMs < 60 * 60_000) return `${Math.max(1, Math.floor(deltaMs / 60_000))}m`;
  if (deltaMs < 24 * 60 * 60_000) return `${Math.max(1, Math.floor(deltaMs / (60 * 60_000)))}h`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(timestamp));
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

function AppSidebarScopedExplorerSection({
  label,
  open,
  icon,
  widgetId,
  floating = false,
  selectionTargetFrameIDs,
  onToggle,
}: {
  label: string;
  open: boolean;
  icon: React.ReactNode;
  widgetId: string;
  floating?: boolean;
  selectionTargetFrameIDs: string[];
  onToggle: () => void;
}): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const raised = floating && (open || hovered || focused);
  return (
    <div
      style={appSidebarMiniExplorerBlockStyle(floating, raised)}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        setFocused(false);
      }}
    >
      <div style={appSidebarMiniExplorerRowStyle(open, floating, raised)}>
        <button
          type="button"
          style={appSidebarMiniExplorerLabelButtonStyle(floating)}
          onClick={onToggle}
        >
          <span style={appSidebarMiniExplorerIconStyle}>{icon}</span>
          <span style={appSidebarTextStyle}>{label}</span>
        </button>
        <button
          type="button"
          title={open ? `Collapse ${label}` : `Expand ${label}`}
          aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
          style={appSidebarSharedDisclosureStyle}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          <ExplorerDisclosureIcon open={open} color="rgba(36, 18, 10, 0.68)" />
        </button>
      </div>
      {open && (
        <div className={floating ? "app-sidebar-elevated-dropdown" : undefined} style={appSidebarMiniExplorerFrameStyle(floating)}>
          <React.Suspense fallback={<div aria-busy="true" style={appSidebarExplorerFallbackStyle} />}>
            <SidebarCompanyExplorerContent
              accent={SIDEBAR_ACTIVE_TEXT}
              widgetId={widgetId}
              theme="light"
              hideTopControls
              useParentScroll
              scopedRootFolderKind="logic_gate"
              scopedRootFolderName={label}
              selectionTargetFrameIDs={selectionTargetFrameIDs}
            />
          </React.Suspense>
        </div>
      )}
    </div>
  );
}

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

function storeNodeEditorPopupSize(size: { width: number; height: number }) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(nodeEditorPopupSizeStorageKey(), JSON.stringify(clampNodeEditorPopupSize(size)));
}

function defaultNodeEditorPopupSize(): { width: number; height: number } {
  return readStoredNodeEditorPopupSize() ?? clampNodeEditorPopupSize({ width: 1180, height: 820 });
}

export function AppNodeEditorPopup({ nodeID, nodeTitle, onClose, onCollapseToTab }: {
  nodeID: string;
  nodeTitle: string;
  onClose: () => void;
  onCollapseToTab?: () => void;
}): React.ReactElement {
  const [popupSize, setPopupSize] = useState(defaultNodeEditorPopupSize);
  const popupSizeRef = useRef(popupSize);

  useEffect(() => {
    popupSizeRef.current = popupSize;
  }, [popupSize]);

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
    const onResize = () => setPopupSize((current) => clampNodeEditorPopupSize(current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const startPopupResize = useCallback((event: React.PointerEvent<HTMLDivElement>, handle: NodeEditorPopupResizeHandle) => {
    event.preventDefault();
    event.stopPropagation();
    const ownerDocument = event.currentTarget.ownerDocument;
    const startX = event.clientX;
    const startY = event.clientY;
    const startSize = popupSizeRef.current;
    const previousCursor = ownerDocument.body.style.cursor;
    ownerDocument.body.style.cursor = handle.cursor;

    const onPointerMove = (pointerEvent: PointerEvent) => {
      const nextSize = clampNodeEditorPopupSize({
        width: startSize.width + (pointerEvent.clientX - startX) * handle.horizontal,
        height: startSize.height + (pointerEvent.clientY - startY) * handle.vertical,
      });
      popupSizeRef.current = nextSize;
      setPopupSize(nextSize);
    };
    const finish = () => {
      ownerDocument.body.style.cursor = previousCursor;
      ownerDocument.removeEventListener("pointermove", onPointerMove);
      ownerDocument.removeEventListener("pointerup", finish);
      ownerDocument.removeEventListener("pointercancel", finish);
      storeNodeEditorPopupSize(popupSizeRef.current);
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
        style={{ ...nodeEditorPopupStyle, width: popupSize.width, height: popupSize.height }}
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
            onClick={onCollapseToTab}
            style={nodeEditorPopupCollapseButtonStyle}
          >
            <MinimizeToLineIcon />
          </button>
        )}
        <button
          type="button"
          title="Close node editor"
          onClick={onClose}
          style={nodeEditorPopupCloseButtonStyle}
        >
          X
        </button>
        <React.Suspense fallback={fullPageFallback}>
          <AppNodeEditorContent
            accent="#ff8820"
            widgetId={`app-explorer-node-editor-popup:${nodeID}`}
            theme="mango"
            forcedEntityKind="node"
            forcedEntityID={nodeID}
            forcedLabel={nodeTitle}
          />
        </React.Suspense>
      </div>
    </div>
  );
}

const appSidebarStyle: React.CSSProperties = {
  minHeight: 0,
  height: "100%",
  display: "grid",
  gridTemplateRows: "auto auto auto auto auto",
  alignContent: "start",
  gap: 10,
  padding: 10,
  borderRadius: PAGE_SURFACE_RADIUS,
  background: "#ffffff",
  color: UI_THEME.text,
  boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.58), 0 10px 24px rgba(132, 51, 0, 0.18)",
  overflowY: "auto",
  overflowX: "hidden",
  scrollbarGutter: "stable",
  ["--company-explorer-scroll-accent" as string]: SIDEBAR_CYAN_ACCENT,
  ["--company-explorer-scroll-track" as string]: "rgba(0, 233, 255, 0.08)",
  ["--company-explorer-hover-bg" as string]: "rgba(0, 233, 255, 0.10)",
};

const appSidebarBrandStyle: React.CSSProperties = {
  minHeight: 38,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 8,
  padding: "2px 6px 4px",
  color: "#24120a",
  minWidth: 0,
};

const appSidebarAccountChromeStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  minWidth: 0,
};

const appSidebarSectionStyle: React.CSSProperties = {
  display: "grid",
  gap: 2,
  minWidth: 0,
  paddingBottom: 10,
  borderBottom: "1px solid rgba(17, 17, 17, 0.28)",
};

function appSidebarPinnedSectionStyle(active: boolean): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateRows: "auto minmax(44px, auto)",
    gap: 5,
    minWidth: 0,
    padding: "0 0 10px",
    borderBottom: "1px solid rgba(17, 17, 17, 0.28)",
    outline: active ? "2px solid rgba(0, 233, 255, 0.32)" : "2px solid transparent",
    outlineOffset: 2,
    borderRadius: 6,
  };
}

const appSidebarSectionTitleStyle: React.CSSProperties = {
  padding: "0 6px",
  color: "#111111",
  fontSize: 12,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: 0,
};

function appSidebarButtonStyle(active: boolean, hasIcon: boolean, hasTrailing: boolean, elevated: boolean, raised = false): React.CSSProperties {
  if (elevated) {
    return {
      width: "auto",
      minHeight: 31,
      display: "grid",
      gridTemplateColumns: appSidebarButtonGridColumns(hasIcon, hasTrailing),
      alignItems: "center",
      gap: 7,
      margin: "0 2px",
      border: `1px solid ${active ? SIDEBAR_CYAN_ACTIVE_BORDER : raised ? "rgba(148, 163, 184, 0.38)" : "transparent"}`,
      borderRadius: SIDEBAR_ELEVATED_RADIUS,
      background: active
        ? "linear-gradient(180deg, rgba(230, 253, 255, 0.98) 0%, rgba(209, 250, 255, 0.94) 100%)"
        : raised ? "linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 250, 252, 0.95) 100%)" : "transparent",
      color: SIDEBAR_ACTIVE_TEXT,
      boxShadow: raised
        ? active
          ? "0 16px 34px rgba(0, 188, 212, 0.16), 0 8px 18px rgba(15, 23, 42, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.92)"
          : "0 14px 32px rgba(15, 23, 42, 0.14), 0 6px 16px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.92)"
        : "none",
      transform: raised ? "translateY(-1px)" : "translateY(0)",
      backdropFilter: raised ? "blur(18px)" : "none",
      WebkitBackdropFilter: raised ? "blur(18px)" : "none",
      cursor: "pointer",
      font: "inherit",
      fontSize: 12,
      fontWeight: 500,
      letterSpacing: 0,
      padding: hasIcon ? "0 10px" : "0 10px 0 12px",
      textAlign: "left",
      minWidth: 0,
      transition: "background 120ms ease, border-color 120ms ease, box-shadow 140ms ease, transform 140ms ease, backdrop-filter 140ms ease",
    };
  }
  return {
    width: "100%",
    minHeight: 31,
    display: "grid",
    gridTemplateColumns: appSidebarButtonGridColumns(hasIcon, hasTrailing),
    alignItems: "center",
    gap: 7,
    border: `1px solid ${active ? SIDEBAR_CYAN_ACTIVE_BORDER : "transparent"}`,
    borderRadius: 6,
    background: active ? SIDEBAR_CYAN_ACTIVE_BG : "transparent",
    color: active ? SIDEBAR_ACTIVE_TEXT : "#3f332b",
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
    minWidth: 17,
    height: 17,
    display: "grid",
    placeItems: "center",
    border: `1px solid ${colors.border}`,
    borderRadius: 4,
    background: colors.background,
    color: colors.color,
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 9.5,
    fontWeight: 800,
    lineHeight: 1,
    padding: "0 4px",
    boxSizing: "border-box",
    flex: "0 0 auto",
  };
}

function sidebarNotificationBadgeColors(tone: SidebarNotificationBadgeTone): { background: string; border: string; color: string } {
  switch (tone) {
    case "responsible":
      return { background: "#fee2e2", border: "rgba(220, 38, 38, 0.36)", color: "#b91c1c" };
    case "accountable":
      return { background: "#fef3c7", border: "rgba(217, 119, 6, 0.38)", color: "#b45309" };
    case "consulted":
      return { background: "#dcfce7", border: "rgba(22, 163, 74, 0.34)", color: "#15803d" };
    case "informed":
      return { background: "#e0f2fe", border: "rgba(2, 132, 199, 0.32)", color: "#0369a1" };
    case "other":
      return { background: "#fff7ed", border: "rgba(255, 136, 32, 0.34)", color: "#c2410c" };
    case "aci":
      return { background: "#eef2ff", border: "rgba(79, 70, 229, 0.30)", color: "#3730a3" };
    case "mention":
      return { background: "#f5f3ff", border: "rgba(124, 58, 237, 0.32)", color: "#6d28d9" };
    case "mail":
    default:
      return { background: "#fff7ed", border: "rgba(255, 136, 32, 0.34)", color: "#c2410c" };
  }
}
function appSidebarSharedRootBlockStyle(active: boolean, raised: boolean): React.CSSProperties {
  return {
    display: "grid",
    gap: 0,
    minWidth: 0,
    margin: "0 2px",
    border: `1px solid ${active ? SIDEBAR_CYAN_ACTIVE_BORDER : raised ? "rgba(148, 163, 184, 0.38)" : "transparent"}`,
    borderRadius: SIDEBAR_ELEVATED_RADIUS,
    background: raised ? "linear-gradient(180deg, rgba(255, 255, 255, 0.97) 0%, rgba(248, 250, 252, 0.95) 100%)" : "transparent",
    boxShadow: raised
      ? active
        ? "0 16px 34px rgba(0, 188, 212, 0.16), 0 8px 18px rgba(15, 23, 42, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.92)"
        : "0 14px 32px rgba(15, 23, 42, 0.14), 0 6px 16px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.92)"
      : "none",
    transform: raised ? "translateY(-1px)" : "translateY(0)",
    backdropFilter: raised ? "blur(18px)" : "none",
    WebkitBackdropFilter: raised ? "blur(18px)" : "none",
    overflow: "hidden",
    transition: "background 120ms ease, border-color 120ms ease, box-shadow 140ms ease, transform 140ms ease, backdrop-filter 140ms ease",
  };
}

function appSidebarMiniExplorerBlockStyle(floating: boolean, raised = false): React.CSSProperties {
  return {
    display: "grid",
    gap: floating ? 0 : 3,
    minWidth: 0,
    margin: floating ? "0 2px" : 0,
    border: floating ? `1px solid ${raised ? "rgba(148, 163, 184, 0.38)" : "transparent"}` : undefined,
    borderRadius: floating ? SIDEBAR_ELEVATED_RADIUS : undefined,
    background: floating && raised ? "linear-gradient(180deg, rgba(255, 255, 255, 0.97) 0%, rgba(248, 250, 252, 0.95) 100%)" : undefined,
    boxShadow: floating && raised ? "0 18px 42px rgba(15, 23, 42, 0.18), 0 8px 18px rgba(15, 23, 42, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.92)" : undefined,
    transform: floating && raised ? "translateY(-1px)" : "translateY(0)",
    backdropFilter: floating && raised ? "blur(18px)" : undefined,
    WebkitBackdropFilter: floating && raised ? "blur(18px)" : undefined,
    overflow: floating ? "hidden" : "visible",
    transition: floating ? "background 120ms ease, border-color 120ms ease, box-shadow 140ms ease, transform 140ms ease, backdrop-filter 140ms ease" : undefined,
  };
}

function appSidebarMiniExplorerRowStyle(open: boolean, floating: boolean, raised = false): React.CSSProperties {
  if (floating) {
    return {
      width: "100%",
      minHeight: 31,
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr) 28px",
      alignItems: "center",
      border: "none",
      borderRadius: open ? `${SIDEBAR_ELEVATED_RADIUS - 1}px ${SIDEBAR_ELEVATED_RADIUS - 1}px 0 0` : SIDEBAR_ELEVATED_RADIUS - 1,
      background: raised ? "linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 250, 252, 0.95) 100%)" : "transparent",
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
    border: `1px solid ${open ? SIDEBAR_CYAN_OPEN_BORDER : "transparent"}`,
    borderRadius: 6,
    background: open ? SIDEBAR_CYAN_OPEN_BG : "transparent",
    color: open ? SIDEBAR_ACTIVE_TEXT : "#3f332b",
    minWidth: 0,
  };
}

function appSidebarMiniExplorerLabelButtonStyle(floating: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    minHeight: floating ? 29 : 29,
    display: "grid",
    gridTemplateColumns: "18px minmax(0, 1fr)",
    alignItems: "center",
    gap: floating ? 7 : 6,
    border: "none",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
    font: "inherit",
    fontSize: 12,
    fontWeight: 500,
    letterSpacing: 0,
    padding: floating ? "0 0 0 10px" : "0 0 0 8px",
    textAlign: "left",
  };
}

const appSidebarMiniExplorerIconStyle: React.CSSProperties = {
  width: 18,
  height: 18,
  display: "grid",
  placeItems: "center",
  color: SIDEBAR_CYAN_ACCENT,
};

function appSidebarMiniExplorerFrameStyle(floating: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    overflow: "visible",
    border: floating ? "none" : "1px solid rgba(17, 17, 17, 0.22)",
    borderTop: floating ? "none" : undefined,
    borderRadius: floating ? 0 : 6,
    background: floating ? "transparent" : "#ffffff",
  };
}

function appSidebarSharedTriageRowStyle(active: boolean, dropActive: boolean, elevated = false, open = false, raised = false): React.CSSProperties {
  if (elevated) {
    return {
      width: "100%",
      minHeight: 31,
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr) 28px",
      alignItems: "center",
      gap: 0,
      border: "none",
      borderRadius: open ? `${SIDEBAR_ELEVATED_RADIUS - 1}px ${SIDEBAR_ELEVATED_RADIUS - 1}px 0 0` : SIDEBAR_ELEVATED_RADIUS - 1,
      background: active || dropActive
        ? "linear-gradient(180deg, rgba(230, 253, 255, 0.98) 0%, rgba(209, 250, 255, 0.94) 100%)"
        : raised ? "linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 250, 252, 0.95) 100%)" : "transparent",
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
    border: `1px solid ${active ? SIDEBAR_CYAN_ACTIVE_BORDER : dropActive ? SIDEBAR_CYAN_OPEN_BORDER : "transparent"}`,
    borderRadius: 6,
    background: active ? SIDEBAR_CYAN_ACTIVE_BG : dropActive ? SIDEBAR_CYAN_DROP_BG : "transparent",
    color: active ? SIDEBAR_ACTIVE_TEXT : "#3f332b",
    minWidth: 0,
  };
}

const appSidebarSharedTriageButtonStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 29,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 6,
  border: "none",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 500,
  letterSpacing: 0,
  padding: "0 0 0 12px",
  textAlign: "left",
};

const appSidebarSharedDisclosureStyle: React.CSSProperties = {
  width: 22,
  height: 24,
  display: "grid",
  placeItems: "center",
  border: "none",
  background: "transparent",
  color: "rgba(36, 18, 10, 0.62)",
  cursor: "pointer",
  padding: 0,
};

const appSidebarSharedMetaStyle: React.CSSProperties = {
  color: "rgba(36, 18, 10, 0.52)",
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
  gap: 1,
  padding: "2px 0 7px",
};

const appSidebarSharedErrorStyle: React.CSSProperties = {
  padding: "3px 6px 2px 8px",
  color: "#8b123f",
  fontSize: 10,
  fontWeight: 700,
  lineHeight: 1.25,
};

function appSidebarSharedFolderRowStyle(depth: number, active: boolean, dropPlacement: SharedInboxDropPlacement | null): React.CSSProperties {
  return {
    width: "100%",
    minHeight: 28,
    display: "grid",
    gridTemplateColumns: "18px 17px minmax(0, 1fr)",
    alignItems: "center",
    gap: 5,
    border: `1px solid ${active ? "rgba(0, 233, 255, 0.64)" : dropPlacement === "inside" ? SIDEBAR_CYAN_OPEN_BORDER : "transparent"}`,
    borderRadius: 5,
    background: active ? "rgba(0, 233, 255, 0.16)" : dropPlacement === "inside" ? SIDEBAR_CYAN_DROP_BG : "transparent",
    color: "#3f332b",
    cursor: "grab",
    font: "inherit",
    fontSize: 11,
    fontWeight: active ? 700 : 600,
    padding: `2px 6px 2px ${6 + depth * 14}px`,
    textAlign: "left",
    minWidth: 0,
    boxShadow: dropPlacement === "before"
      ? `inset 0 2px 0 ${SIDEBAR_CYAN_ACCENT}`
      : dropPlacement === "after"
        ? `inset 0 -2px 0 ${SIDEBAR_CYAN_ACCENT}`
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
  border: "1px solid #ff8820",
  borderRadius: 4,
  background: "#ffffff",
  color: "#24120a",
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
  color: "#24120a",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 600,
  textAlign: "left",
  padding: "0 12px",
};

const appSidebarNotificationMenuStyle: React.CSSProperties = {
  width: 280,
  maxHeight: 360,
  display: "grid",
  alignContent: "start",
  overflowY: "auto",
  padding: "6px 0",
};

const appSidebarNotificationMenuHeaderStyle: React.CSSProperties = {
  padding: "5px 12px 8px",
  color: "rgba(36, 18, 10, 0.68)",
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: 0,
};

const appSidebarNotificationMenuItemStyle: React.CSSProperties = {
  width: "100%",
  display: "grid",
  gap: 3,
  border: "none",
  background: "transparent",
  color: "#24120a",
  cursor: "pointer",
  font: "inherit",
  textAlign: "left",
  padding: "8px 12px",
};

const appSidebarNotificationMenuTitleStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 12,
  fontWeight: 750,
};

const appSidebarNotificationMenuBodyStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "rgba(36, 18, 10, 0.62)",
  fontSize: 11,
  fontWeight: 500,
};

const appSidebarNotificationMenuMetaStyle: React.CSSProperties = {
  color: "rgba(36, 18, 10, 0.45)",
  fontSize: 10,
  fontWeight: 700,
};

const appSidebarNotificationMenuEmptyStyle: React.CSSProperties = {
  padding: "10px 12px",
  color: "rgba(36, 18, 10, 0.55)",
  fontSize: 12,
  fontWeight: 600,
};

const appSidebarNotificationMenuErrorStyle: React.CSSProperties = {
  ...appSidebarNotificationMenuEmptyStyle,
  color: "#8b123f",
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
  color: "rgba(36, 18, 10, 0.48)",
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
  minHeight: 30,
  display: "grid",
  gridTemplateColumns: "18px minmax(0, 1fr)",
  alignItems: "center",
  gap: 6,
  border: "1px solid rgba(100, 116, 139, 0.28)",
  borderRadius: 6,
  background: "#ffffff",
  color: "#3f332b",
  cursor: "pointer",
  font: "inherit",
  fontSize: 11,
  fontWeight: 600,
  padding: "0 7px",
  textAlign: "left",
};

const appSidebarPinIconStyle: React.CSSProperties = {
  width: 18,
  display: "grid",
  placeItems: "center",
  color: "#334155",
};

const appSidebarPinRemoveStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  display: "grid",
  placeItems: "center",
  border: "1px solid rgba(100, 116, 139, 0.28)",
  borderRadius: 5,
  background: "#ffffff",
  color: "rgba(36, 18, 10, 0.58)",
  cursor: "pointer",
  font: "inherit",
  fontSize: 10,
  fontWeight: 700,
  lineHeight: 1,
};

const appSidebarExplorerSectionStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  overflow: "visible",
  borderRadius: 6,
  border: "1px solid rgba(17, 17, 17, 0.22)",
  background: "#ffffff",
};

const appSidebarExplorerFallbackStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  background: "#ffffff",
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
  border: "1px solid rgba(255,136,32,0.45)",
  borderRadius: 10,
  background: "#ffffff",
  color: "#24120a",
  padding: 12,
  boxShadow: "0 18px 42px rgba(0,0,0,0.18)",
};

const sharedInboxEmailModalTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
};

const sharedInboxEmailModalDetailStyle: React.CSSProperties = {
  color: "rgba(36, 18, 10, 0.68)",
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
  border: "1px solid rgba(255, 136, 32, 0.28)",
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
  border: "1px solid rgba(255,136,32,0.74)",
  background: "#ff8a00",
  color: "#111111",
};

const nodeEditorPopupBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 130,
  display: "grid",
  placeItems: "center",
  background: "rgba(36, 18, 10, 0.18)",
  padding: 22,
};

const nodeEditorPopupStyle: React.CSSProperties = {
  position: "relative",
  width: "min(1180px, calc(100vw - 44px))",
  height: "min(820px, calc(100vh - 64px))",
  minWidth: "min(420px, calc(100vw - 44px))",
  minHeight: "min(320px, calc(100vh - 64px))",
  maxWidth: "calc(100vw - 44px)",
  maxHeight: "calc(100vh - 64px)",
  boxSizing: "border-box",
  border: "1px solid rgba(255, 136, 32, 0.54)",
  borderRadius: 16,
  background: "#ffffff",
  boxShadow: "0 18px 42px rgba(36, 18, 10, 0.22), inset 0 0 0 1px rgba(255, 255, 255, 0.72)",
  overflow: "hidden",
  cursor: "default",
};

const nodeEditorPopupCloseButtonStyle: React.CSSProperties = {
  position: "absolute",
  top: 7,
  right: 8,
  zIndex: 8,
  width: 24,
  height: 24,
  border: "1px solid #8b0000",
  borderRadius: 4,
  background: "#ff1f1f",
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
  zIndex: 8,
  width: 24,
  height: 24,
  display: "grid",
  placeItems: "center",
  border: "1px solid rgba(255, 136, 32, 0.56)",
  borderRadius: 4,
  background: "#ffffff",
  color: "#ff8820",
  padding: 0,
  cursor: "pointer",
};
