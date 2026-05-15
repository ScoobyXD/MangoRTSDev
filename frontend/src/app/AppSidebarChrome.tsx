import React, { useEffect } from "react";
import { HeaderLogicGateArenaIcon, HeaderMapIcon } from "./HeaderIcons";
import { MangoWordmark } from "./MangoLogo";
import { COLORWAYS, UI_THEME } from "./frameLayoutTypes";
import { preloadDefaultDashboardModules, preloadLogicGateArenaSurface } from "./preloadDashboardModules";
import { ExplorerRowIcon } from "../modules/company-explorer/CompanyExplorerIcons";

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
const SIDEBAR_EXPLORER_WIDGET_ID = "app-sidebar-explorer";

export type HomeSidebarView = "my-triage" | "shared-root" | "aci-inbox" | "r-inbox";
export type SidebarPinKind = "node" | "logic_gate";
export type SidebarPin = {
  id: string;
  kind: SidebarPinKind;
  label: string;
  addedAt: number;
};

type AppSidebarPrimaryPage = "map" | "home" | "logic-gate-arena";

const HOME_NAV_ITEMS: Array<{ view: HomeSidebarView; label: string }> = [
  { view: "my-triage", label: "My Triage" },
  { view: "shared-root", label: "Shared Triage" },
  { view: "aci-inbox", label: "ACI Inbox" },
  { view: "r-inbox", label: "R Inbox" },
];

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
  onPinDragEnter: () => void;
  onPinDragLeave: () => void;
  onPinDragOver: (event: React.DragEvent<HTMLElement>) => void;
  onPinDrop: (event: React.DragEvent<HTMLElement>) => void;
};

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
  onPinDragEnter,
  onPinDragLeave,
  onPinDragOver,
  onPinDrop,
}: AppSidebarProps): React.ReactElement {
  const homeActive = activePage === "home";
  return (
    <aside style={appSidebarStyle}>
      <div style={appSidebarBrandStyle} aria-label="MangoRTS">
        <MangoWordmark size={22} weight={600} />
        {accountChrome && <div style={appSidebarAccountChromeStyle}>{accountChrome}</div>}
      </div>

      <section style={appSidebarSectionStyle} aria-label="Home inboxes">
        {HOME_NAV_ITEMS.map((item) => (
          <AppSidebarButton
            key={item.view}
            label={item.label}
            active={homeActive && activeHomeView === item.view}
            onClick={() => onHomeViewSelect(item.view)}
          />
        ))}
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

      <section style={appSidebarExplorerSectionStyle} aria-label="Explorer tree">
        <React.Suspense fallback={<div aria-busy="true" style={appSidebarExplorerFallbackStyle} />}>
          <SidebarCompanyExplorerContent
            accent={COLORWAYS.light.accent}
            widgetId={SIDEBAR_EXPLORER_WIDGET_ID}
            theme="light"
            selectionTargetFrameIDs={explorerSelectionTargetFrameIDs}
          />
        </React.Suspense>
      </section>
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

const appSidebarExplorerSectionStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  overflow: "hidden",
  borderRadius: 6,
  border: "1px solid rgba(255, 136, 32, 0.16)",
  background: "#ffffff",
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
