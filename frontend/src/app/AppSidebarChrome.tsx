import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getActiveCompanyID } from "../auth/currentCompany";
import FrameRightClickMenu from "./framerightclickmenu";
import { HeaderLogicGateArenaIcon, HeaderMapIcon } from "./HeaderIcons";
import { MangoWordmark } from "./MangoLogo";
import { COLORWAYS, UI_THEME } from "./frameLayoutTypes";
import { preloadDefaultDashboardModules, preloadLogicGateArenaSurface } from "./preloadDashboardModules";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../modules/company-explorer/CompanyExplorerIcons";
import {
  createCommunicationsSharedInbox,
  deleteCommunicationsSharedInbox,
  EVENT_COMMUNICATIONS_SHARED_INBOXES_UPDATED,
  listCommunicationsSharedInboxes,
  updateCommunicationsSharedInbox,
  type CommunicationsSharedInbox,
} from "../modules/communications/communicationsApi";
import {
  buildSharedInboxRows,
  collectSharedInboxSubtreeIDs,
  filterSharedInboxesForUser,
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

type SidebarSectionID = "shared-triage" | "logic-gates-by-function" | "logic-gates-by-person" | "explorer";

export type HomeSidebarView = "my-triage" | "shared-root" | "aci-inbox" | "r-inbox" | `shared:${string}`;
export type SidebarPinKind = "node" | "logic_gate";
export type SidebarPin = {
  id: string;
  kind: SidebarPinKind;
  label: string;
  addedAt: number;
};

type AppSidebarPrimaryPage = "map" | "home" | "logic-gate-arena";

type AppSidebarProps = {
  accountChrome?: React.ReactNode;
  activePage: AppSidebarPrimaryPage | null;
  activeHomeView: HomeSidebarView;
  currentUserHasFullSharedInboxAccess?: boolean;
  currentUserID?: string;
  pins: SidebarPin[];
  pinDropActive: boolean;
  explorerSelectionTargetFrameIDs: string[];
  onHomeViewSelect: (view: HomeSidebarView) => void;
  onPageSelect: (page: AppSidebarPrimaryPage) => void;
  onPinOpen: (pin: SidebarPin) => void;
  onPinRemove: (pin: SidebarPin) => void;
  onPinDragEnter: () => void;
  onPinDragLeave: () => void;
  onPinDragOver: (event: React.DragEvent<HTMLElement>) => void;
  onPinDrop: (event: React.DragEvent<HTMLElement>) => void;
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
  currentUserHasFullSharedInboxAccess = false,
  currentUserID = "",
  pins,
  pinDropActive,
  explorerSelectionTargetFrameIDs,
  onHomeViewSelect,
  onPageSelect,
  onPinOpen,
  onPinRemove,
  onPinDragEnter,
  onPinDragLeave,
  onPinDragOver,
  onPinDrop,
}: AppSidebarProps): React.ReactElement {
  const homeActive = activePage === "home";
  const companyID = getActiveCompanyID();
  const [sharedTriageOpen, setSharedTriageOpen] = usePersistedSidebarSectionOpen("shared-triage", true);
  const [logicGatesByFunctionOpen, setLogicGatesByFunctionOpen] = usePersistedSidebarSectionOpen("logic-gates-by-function", false);
  const [logicGatesByPersonOpen, setLogicGatesByPersonOpen] = usePersistedSidebarSectionOpen("logic-gates-by-person", false);
  const [explorerOpen, setExplorerOpen] = usePersistedSidebarSectionOpen("explorer", true);
  const [sharedInboxes, setSharedInboxes] = useState<CommunicationsSharedInbox[]>([]);
  const [loadingSharedInboxes, setLoadingSharedInboxes] = useState(false);
  const [sharedBusy, setSharedBusy] = useState(false);
  const [expandedSharedFolderIDs, setExpandedSharedFolderIDs] = useState<Set<string>>(new Set());
  const [renamingSharedFolderID, setRenamingSharedFolderID] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [draggingSharedFolderID, setDraggingSharedFolderID] = useState("");
  const [dropTarget, setDropTarget] = useState<{ folderID: string; placement: SharedInboxDropPlacement } | null>(null);
  const [sharedContextMenu, setSharedContextMenu] = useState<{ x: number; y: number; folder: CommunicationsSharedInbox | null } | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const skipRenameBlurRef = useRef(false);
  const sharedRows = useMemo(
    () => sharedTriageOpen ? buildSharedInboxRows(filterSharedInboxesForUser(sharedInboxes, currentUserID, currentUserHasFullSharedInboxAccess), expandedSharedFolderIDs) : [],
    [currentUserHasFullSharedInboxAccess, currentUserID, expandedSharedFolderIDs, sharedInboxes, sharedTriageOpen],
  );
  const sharedTriageActive = homeActive && (activeHomeView === "shared-root" || activeHomeView.startsWith("shared:"));

  useEffect(() => {
    if (!companyID) {
      setSharedInboxes([]);
      return;
    }
    let cancelled = false;
    setLoadingSharedInboxes(true);
    listCommunicationsSharedInboxes(companyID)
      .then((folders) => {
        if (!cancelled) setSharedInboxes(folders);
      })
      .catch((error) => {
        if (!cancelled) console.error("Failed to load shared triage folders", error);
      })
      .finally(() => {
        if (!cancelled) setLoadingSharedInboxes(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyID]);

  useEffect(() => {
    if (!companyID) return undefined;
    const onSharedInboxesUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ companyID?: string }>).detail;
      if (detail?.companyID && detail.companyID !== companyID) return;
      setLoadingSharedInboxes(true);
      listCommunicationsSharedInboxes(companyID)
        .then(setSharedInboxes)
        .catch((error) => console.error("Failed to refresh shared triage folders", error))
        .finally(() => setLoadingSharedInboxes(false));
    };
    window.addEventListener(EVENT_COMMUNICATIONS_SHARED_INBOXES_UPDATED, onSharedInboxesUpdated);
    return () => window.removeEventListener(EVENT_COMMUNICATIONS_SHARED_INBOXES_UPDATED, onSharedInboxesUpdated);
  }, [companyID]);

  useEffect(() => {
    setExpandedSharedFolderIDs((previous) => {
      const visibleSharedInboxes = filterSharedInboxesForUser(sharedInboxes, currentUserID, currentUserHasFullSharedInboxAccess);
      if (previous.size > 0 || visibleSharedInboxes.length === 0) return previous;
      return new Set(visibleSharedInboxes.filter((folder) => !folder.parent_folder_id).map((folder) => folder.folder_id));
    });
  }, [currentUserHasFullSharedInboxAccess, currentUserID, sharedInboxes]);

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

  const openSharedContextMenu = useCallback((event: React.MouseEvent, folder: CommunicationsSharedInbox | null) => {
    event.preventDefault();
    event.stopPropagation();
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

  const createSharedFolder = useCallback(async (parentFolderID: string) => {
    if (!companyID || sharedBusy) return;
    setSharedContextMenu(null);
    setSharedBusy(true);
    try {
      const folder = await createCommunicationsSharedInbox({ companyID, parentFolderID, name: "New Folder" });
      setSharedInboxes((previous) => [...previous.filter((item) => item.folder_id !== folder.folder_id), folder]);
      if (parentFolderID) setExpandedSharedFolderIDs((previous) => new Set(previous).add(parentFolderID));
      setSharedTriageOpen(true);
      setRenamingSharedFolderID(folder.folder_id);
      setRenameDraft(folder.name);
      onHomeViewSelect(`shared:${folder.folder_id}`);
    } catch (error) {
      console.error("Failed to create shared triage folder", error);
    } finally {
      setSharedBusy(false);
    }
  }, [companyID, onHomeViewSelect, sharedBusy]);

  const commitSharedRename = useCallback(async () => {
    const folderID = renamingSharedFolderID.trim();
    const name = renameDraft.trim();
    if (!folderID) return;
    const current = sharedInboxes.find((folder) => folder.folder_id === folderID);
    setRenamingSharedFolderID("");
    setRenameDraft("");
    if (!companyID || !name || name === current?.name) return;
    setSharedBusy(true);
    try {
      const updated = await updateCommunicationsSharedInbox({ companyID, folderID, name });
      replaceSharedFolder(updated);
    } catch (error) {
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
    try {
      const updated = await updateCommunicationsSharedInbox({ companyID, folderID: sourceFolderID, parentFolderID, position });
      replaceSharedFolder(updated);
    } catch (error) {
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
    try {
      await deleteCommunicationsSharedInbox(companyID, folder.folder_id);
      setSharedInboxes((previous) => previous.filter((item) => !subtreeIDs.has(item.folder_id)));
      const activeFolderID = activeHomeView.startsWith("shared:") ? activeHomeView.slice("shared:".length) : "";
      if (activeFolderID && subtreeIDs.has(activeFolderID)) onHomeViewSelect("shared-root");
    } catch (error) {
      console.error("Failed to delete shared triage folder", error);
    } finally {
      setSharedBusy(false);
    }
  }, [activeHomeView, companyID, onHomeViewSelect, sharedBusy, sharedInboxes]);

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
    const isRenaming = renamingSharedFolderID === folder.folder_id;
    const rowDropPlacement = dropTarget?.folderID === folder.folder_id ? dropTarget.placement : null;
    const treeID = row.treeID as HomeSidebarView;
    return (
      <div
        key={folder.folder_id}
        role="button"
        tabIndex={0}
        draggable={!isRenaming && !sharedBusy}
        style={appSidebarSharedFolderRowStyle(row.depth, homeActive && activeHomeView === treeID, rowDropPlacement)}
        onClick={() => onHomeViewSelect(treeID)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
          event.preventDefault();
          onHomeViewSelect(treeID);
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
        <span style={appSidebarSharedFolderIconStyle}><ExplorerRowIcon kind="folder" /></span>
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
          <span style={appSidebarTextStyle}>{folder.name}</span>
        )}
      </div>
    );
  };

  return (
    <aside style={appSidebarStyle}>
      <div style={appSidebarBrandStyle} aria-label="MangoRTS">
        <MangoWordmark size={22} weight={600} />
        {accountChrome && <div style={appSidebarAccountChromeStyle}>{accountChrome}</div>}
      </div>

      <section style={appSidebarSectionStyle} aria-label="Home inboxes">
        <AppSidebarButton
          label="My Triage"
          active={homeActive && activeHomeView === "my-triage"}
          onClick={() => onHomeViewSelect("my-triage")}
        />
        <div style={appSidebarSharedRootBlockStyle}>
          <div
            style={appSidebarSharedTriageRowStyle(sharedTriageActive, dropTarget?.folderID === "")}
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
              {loadingSharedInboxes && <span style={appSidebarSharedMetaStyle}>Loading</span>}
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
            <div style={appSidebarSharedRowsStyle}>
              {sharedRows.map(renderSharedFolderRow)}
            </div>
          )}
        </div>
        <AppSidebarButton
          label="ACI Inbox"
          active={homeActive && activeHomeView === "aci-inbox"}
          onClick={() => onHomeViewSelect("aci-inbox")}
        />
        <AppSidebarButton
          label="R Inbox"
          active={homeActive && activeHomeView === "r-inbox"}
          onClick={() => onHomeViewSelect("r-inbox")}
        />
      </section>

      <section
        style={appSidebarPinnedSectionStyle(pinDropActive)}
        aria-label="Pinned"
        onDragEnter={onPinDragEnter}
        onDragOver={onPinDragOver}
        onDragLeave={(event) => {
          const related = event.relatedTarget instanceof Node ? event.relatedTarget : null;
          if (related && event.currentTarget.contains(related)) return;
          onPinDragLeave();
        }}
        onDrop={onPinDrop}
      >
        <div style={appSidebarSectionTitleStyle}>Pinned</div>
        <div style={appSidebarPinListStyle}>
          {pins.length === 0 ? (
            <div style={appSidebarEmptyStyle}>No pins</div>
          ) : pins.map((pin) => (
            <div key={`${pin.kind}:${pin.id}`} style={appSidebarPinRowStyle}>
              <button type="button" style={appSidebarPinButtonStyle} onClick={() => onPinOpen(pin)}>
                <span style={appSidebarPinIconStyle}><ExplorerRowIcon kind={pin.kind} /></span>
                <span style={appSidebarTextStyle}>{pin.label}</span>
              </button>
              <button type="button" aria-label={`Remove ${pin.label}`} style={appSidebarPinRemoveStyle} onClick={() => onPinRemove(pin)}>
                X
              </button>
            </div>
          ))}
        </div>
      </section>

      <section style={appSidebarSectionStyle} aria-label="Primary pages">
        <AppSidebarScopedExplorerSection
          label="Logic Gates by Function"
          open={logicGatesByFunctionOpen}
          widgetId={SIDEBAR_LOGIC_GATES_BY_FUNCTION_WIDGET_ID}
          selectionTargetFrameIDs={explorerSelectionTargetFrameIDs}
          onToggle={() => setLogicGatesByFunctionOpen((open) => !open)}
        />
        <AppSidebarScopedExplorerSection
          label="Logic Gates by Person"
          open={logicGatesByPersonOpen}
          widgetId={SIDEBAR_LOGIC_GATES_BY_PERSON_WIDGET_ID}
          selectionTargetFrameIDs={explorerSelectionTargetFrameIDs}
          onToggle={() => setLogicGatesByPersonOpen((open) => !open)}
        />
        <AppSidebarButton
          label="Logic Gate Arena"
          active={activePage === "logic-gate-arena"}
          icon={<HeaderLogicGateArenaIcon />}
          onPointerEnter={preloadLogicGateArenaSurface}
          onFocus={preloadLogicGateArenaSurface}
          onPointerDown={preloadLogicGateArenaSurface}
          onClick={() => onPageSelect("logic-gate-arena")}
        />
        <AppSidebarButton
          label="Map"
          active={activePage === "map"}
          icon={<HeaderMapIcon />}
          onPointerEnter={preloadDefaultDashboardModules}
          onFocus={preloadDefaultDashboardModules}
          onPointerDown={preloadDefaultDashboardModules}
          onClick={() => onPageSelect("map")}
        />
      </section>

      <section style={appSidebarExplorerSectionStyle(explorerOpen)} aria-label="Explorer tree">
        <div style={appSidebarExplorerHeaderStyle(explorerOpen)}>
          <button
            type="button"
            style={appSidebarExplorerHeaderButtonStyle}
            onClick={() => setExplorerOpen((open) => !open)}
          >
            <span style={appSidebarTextStyle}>Explorer</span>
          </button>
          <button
            type="button"
            title={explorerOpen ? "Collapse Explorer" : "Expand Explorer"}
            aria-label={explorerOpen ? "Collapse Explorer" : "Expand Explorer"}
            style={appSidebarSharedDisclosureStyle}
            onClick={(event) => {
              event.stopPropagation();
              setExplorerOpen((open) => !open);
            }}
          >
            <ExplorerDisclosureIcon open={explorerOpen} color="rgba(36, 18, 10, 0.68)" />
          </button>
        </div>
        {explorerOpen && (
          <div style={appSidebarExplorerFrameStyle}>
            <React.Suspense fallback={<div aria-busy="true" style={appSidebarExplorerFallbackStyle} />}>
              <SidebarCompanyExplorerContent
                accent={COLORWAYS.light.accent}
                widgetId={SIDEBAR_EXPLORER_WIDGET_ID}
                theme="light"
                selectionTargetFrameIDs={explorerSelectionTargetFrameIDs}
              />
            </React.Suspense>
          </div>
        )}
      </section>
      {sharedContextMenu && (
        <FrameRightClickMenu x={sharedContextMenu.x} y={sharedContextMenu.y} onClose={() => setSharedContextMenu(null)}>
          <button
            type="button"
            style={appSidebarContextMenuButtonStyle}
            disabled={sharedBusy}
            onClick={() => void createSharedFolder(sharedContextMenu.folder?.folder_id ?? "")}
          >
            {sharedContextMenu.folder ? "New Child Folder" : "New Folder"}
          </button>
          {sharedContextMenu.folder && (
            <>
              <button
                type="button"
                style={appSidebarContextMenuButtonStyle}
                onClick={() => startSharedRename(sharedContextMenu.folder!)}
              >
                Rename
              </button>
              <button
                type="button"
                style={{ ...appSidebarContextMenuButtonStyle, color: "#8b123f" }}
                disabled={sharedBusy}
                onClick={() => void requestDeleteSharedFolder(sharedContextMenu.folder!)}
              >
                Delete
              </button>
            </>
          )}
        </FrameRightClickMenu>
      )}
    </aside>
  );
}

function AppSidebarButton({
  label,
  active,
  icon,
  onClick,
  onPointerEnter,
  onFocus,
  onPointerDown,
}: {
  label: string;
  active: boolean;
  icon?: React.ReactNode;
  onClick: () => void;
  onPointerEnter?: () => void;
  onFocus?: () => void;
  onPointerDown?: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      style={appSidebarButtonStyle(active, !!icon)}
      onPointerEnter={onPointerEnter}
      onFocus={onFocus}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      {icon && <span style={appSidebarButtonIconStyle}>{icon}</span>}
      <span style={appSidebarTextStyle}>{label}</span>
    </button>
  );
}

function AppSidebarScopedExplorerSection({
  label,
  open,
  widgetId,
  selectionTargetFrameIDs,
  onToggle,
}: {
  label: string;
  open: boolean;
  widgetId: string;
  selectionTargetFrameIDs: string[];
  onToggle: () => void;
}): React.ReactElement {
  return (
    <div style={appSidebarMiniExplorerBlockStyle}>
      <div style={appSidebarMiniExplorerRowStyle(open)}>
        <button
          type="button"
          style={appSidebarMiniExplorerLabelButtonStyle}
          onClick={onToggle}
        >
          <span style={appSidebarMiniExplorerIconStyle}><ExplorerRowIcon kind="folder" /></span>
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
        <div style={appSidebarMiniExplorerFrameStyle}>
          <React.Suspense fallback={<div aria-busy="true" style={appSidebarExplorerFallbackStyle} />}>
            <SidebarCompanyExplorerContent
              accent={COLORWAYS.light.accent}
              widgetId={widgetId}
              theme="light"
              hideTopControls
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

export function AppNodeEditorPopup({ nodeID, nodeTitle, onClose }: {
  nodeID: string;
  nodeTitle: string;
  onClose: () => void;
}): React.ReactElement {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

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
        style={nodeEditorPopupStyle}
        onMouseDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
      >
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
  gridTemplateRows: "auto auto minmax(88px, auto) auto minmax(0, 1fr)",
  gap: 10,
  padding: 10,
  borderRadius: PAGE_SURFACE_RADIUS,
  background: "#ffffff",
  color: UI_THEME.text,
  boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.58), 0 10px 24px rgba(132, 51, 0, 0.18)",
  overflow: "hidden",
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
  gap: 4,
  minWidth: 0,
  paddingBottom: 10,
  borderBottom: "1px solid rgba(255, 136, 32, 0.2)",
};

function appSidebarPinnedSectionStyle(active: boolean): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateRows: "auto minmax(44px, auto)",
    gap: 5,
    minWidth: 0,
    padding: "0 0 10px",
    borderBottom: "1px solid rgba(255, 136, 32, 0.2)",
    outline: active ? "2px solid rgba(255, 136, 32, 0.32)" : "2px solid transparent",
    outlineOffset: 2,
    borderRadius: 6,
  };
}

const appSidebarSectionTitleStyle: React.CSSProperties = {
  padding: "0 6px",
  color: "rgba(36, 18, 10, 0.62)",
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0,
};

function appSidebarButtonStyle(active: boolean, hasIcon: boolean): React.CSSProperties {
  return {
    width: "100%",
    minHeight: 31,
    display: "grid",
    gridTemplateColumns: hasIcon ? "auto minmax(0, 1fr)" : "minmax(0, 1fr)",
    alignItems: "center",
    gap: 7,
    border: `1px solid ${active ? "rgba(255, 136, 32, 0.68)" : "transparent"}`,
    borderRadius: 6,
    background: active ? "rgba(255, 136, 32, 0.13)" : "transparent",
    color: active ? "#ff8820" : "#3f332b",
    cursor: "pointer",
    font: "inherit",
    fontSize: 12,
    fontWeight: active ? 700 : 600,
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

const appSidebarSharedRootBlockStyle: React.CSSProperties = {
  display: "grid",
  gap: 3,
  minWidth: 0,
};

const appSidebarMiniExplorerBlockStyle: React.CSSProperties = {
  display: "grid",
  gap: 3,
  minWidth: 0,
};

function appSidebarMiniExplorerRowStyle(open: boolean): React.CSSProperties {
  return {
    width: "100%",
    minHeight: 31,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 22px",
    alignItems: "center",
    border: `1px solid ${open ? "rgba(255, 136, 32, 0.52)" : "transparent"}`,
    borderRadius: 6,
    background: open ? "rgba(255, 136, 32, 0.09)" : "transparent",
    color: open ? "#ff8820" : "#3f332b",
    minWidth: 0,
  };
}

const appSidebarMiniExplorerLabelButtonStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 29,
  display: "grid",
  gridTemplateColumns: "18px minmax(0, 1fr)",
  alignItems: "center",
  gap: 6,
  border: "none",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 0,
  padding: "0 0 0 8px",
  textAlign: "left",
};

const appSidebarMiniExplorerIconStyle: React.CSSProperties = {
  width: 18,
  height: 18,
  display: "grid",
  placeItems: "center",
  color: "#ff8820",
};

const appSidebarMiniExplorerFrameStyle: React.CSSProperties = {
  height: 174,
  minWidth: 0,
  overflow: "hidden",
  border: "1px solid rgba(255, 136, 32, 0.14)",
  borderRadius: 6,
  background: "#ffffff",
};

function appSidebarSharedTriageRowStyle(active: boolean, dropActive: boolean): React.CSSProperties {
  return {
    width: "100%",
    minHeight: 31,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 22px",
    alignItems: "center",
    gap: 0,
    border: `1px solid ${active ? "rgba(255, 136, 32, 0.68)" : dropActive ? "rgba(255, 136, 32, 0.52)" : "transparent"}`,
    borderRadius: 6,
    background: active ? "rgba(255, 136, 32, 0.13)" : dropActive ? "#fff7eb" : "transparent",
    color: active ? "#ff8820" : "#3f332b",
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
  fontWeight: 700,
  letterSpacing: 0,
  padding: "0 0 0 8px",
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

const appSidebarSharedRowsStyle: React.CSSProperties = {
  minWidth: 0,
  maxHeight: 220,
  overflowY: "auto",
  overflowX: "hidden",
  display: "grid",
  alignContent: "start",
  gap: 2,
  padding: "0 0 0 2px",
};

function appSidebarSharedFolderRowStyle(depth: number, active: boolean, dropPlacement: SharedInboxDropPlacement | null): React.CSSProperties {
  return {
    width: "100%",
    minHeight: 28,
    display: "grid",
    gridTemplateColumns: "18px 17px minmax(0, 1fr)",
    alignItems: "center",
    gap: 5,
    border: `1px solid ${active ? "rgba(255, 136, 32, 0.64)" : dropPlacement === "inside" ? "rgba(255, 136, 32, 0.52)" : "transparent"}`,
    borderRadius: 5,
    background: active ? "#fff2e0" : dropPlacement === "inside" ? "#fff7eb" : "transparent",
    color: "#3f332b",
    cursor: "grab",
    font: "inherit",
    fontSize: 11,
    fontWeight: active ? 700 : 600,
    padding: `2px 6px 2px ${6 + depth * 14}px`,
    textAlign: "left",
    minWidth: 0,
    boxShadow: dropPlacement === "before"
      ? "inset 0 2px 0 #ff8820"
      : dropPlacement === "after"
        ? "inset 0 -2px 0 #ff8820"
        : undefined,
  };
}

const appSidebarSharedFolderIconStyle: React.CSSProperties = {
  width: 17,
  height: 17,
  display: "grid",
  placeItems: "center",
  color: "#ff8820",
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

const appSidebarPinListStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  alignContent: "start",
  gap: 4,
  maxHeight: 180,
  overflowY: "auto",
  overflowX: "hidden",
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

const appSidebarPinRowStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 24px",
  alignItems: "center",
  gap: 4,
};

const appSidebarPinButtonStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 30,
  display: "grid",
  gridTemplateColumns: "18px minmax(0, 1fr)",
  alignItems: "center",
  gap: 6,
  border: "1px solid rgba(255, 136, 32, 0.15)",
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
  color: "#ff8820",
};

const appSidebarPinRemoveStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  display: "grid",
  placeItems: "center",
  border: "1px solid rgba(255, 136, 32, 0.18)",
  borderRadius: 5,
  background: "#ffffff",
  color: "rgba(36, 18, 10, 0.58)",
  cursor: "pointer",
  font: "inherit",
  fontSize: 10,
  fontWeight: 700,
  lineHeight: 1,
};

function appSidebarExplorerSectionStyle(open: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    minHeight: 0,
    display: "grid",
    gridTemplateRows: open ? "31px minmax(0, 1fr)" : "31px",
    alignContent: "start",
    overflow: "hidden",
    borderRadius: 6,
    border: "1px solid rgba(255, 136, 32, 0.16)",
    background: "#ffffff",
  };
}

function appSidebarExplorerHeaderStyle(open: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 22px",
    alignItems: "center",
    borderBottom: open ? "1px solid rgba(255, 136, 32, 0.14)" : "none",
    background: open ? "rgba(255, 136, 32, 0.06)" : "#ffffff",
    color: open ? "#ff8820" : "#3f332b",
  };
}

const appSidebarExplorerHeaderButtonStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 30,
  display: "grid",
  alignItems: "center",
  border: "none",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 0,
  padding: "0 0 0 8px",
  textAlign: "left",
};

const appSidebarExplorerFrameStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  overflow: "hidden",
};

const appSidebarExplorerFallbackStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  background: "#ffffff",
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
