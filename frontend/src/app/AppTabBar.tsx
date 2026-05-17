import React, { useEffect, useRef, useState } from "react";
import { ExplorerRowIcon } from "../modules/company-explorer/CompanyExplorerIcons";
import type { AppDockTab } from "./appDockTabs";

type AppTabBarProps = {
  tabs: AppDockTab[];
  activeTabID: string | null;
  onOpenTab: (tab: AppDockTab) => void;
  onReorderTab: (movingTabID: string, targetTabID: string) => void;
  onContextMenu: (event: React.MouseEvent, tab: AppDockTab) => void;
};

const TAB_BAR_H = 52;

export const APP_TAB_BAR_HEIGHT = TAB_BAR_H;

export const AppTabBar: React.FC<AppTabBarProps> = ({
  tabs,
  activeTabID,
  onOpenTab,
  onReorderTab,
  onContextMenu,
}) => {
  const dragRef = useRef<{ id: string; startX: number; startY: number } | null>(null);
  const suppressNextClickRef = useRef(false);
  const [movingTabID, setMovingTabID] = useState("");
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const moved = Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY);
      if (moved <= 4) return;
      suppressNextClickRef.current = true;
      setDragging(true);
    };
    const onPointerUp = () => {
      dragRef.current = null;
      setMovingTabID("");
      setDragging(false);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);

  return (
    <footer style={appTabBarStyle} aria-label="Collapsed app tabs">
      <div style={appTabRailStyle}>
        {tabs.map((tab) => {
          const active = activeTabID === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              title={tab.label}
              aria-label={tab.label}
              aria-pressed={active}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                dragRef.current = { id: tab.id, startX: event.clientX, startY: event.clientY };
                setMovingTabID(tab.id);
              }}
              onPointerEnter={() => {
                if (!dragging || !movingTabID || movingTabID === tab.id) return;
                onReorderTab(movingTabID, tab.id);
              }}
              onClick={() => {
                if (suppressNextClickRef.current) {
                  suppressNextClickRef.current = false;
                  return;
                }
                onOpenTab(tab);
              }}
              onContextMenu={(event) => onContextMenu(event, tab)}
              style={appTabButtonStyle(active, movingTabID === tab.id)}
            >
              <span style={appTabIconStyle}>
                <ExplorerRowIcon kind={tab.kind === "node" ? "node" : "logic_gate"} />
              </span>
              <span style={appTabLabelStyle}>{tab.label}</span>
              {tab.pinned && <PinIndicator />}
            </button>
          );
        })}
      </div>
    </footer>
  );
};

const PinIndicator: React.FC = () => (
  <svg aria-hidden="true" width="11" height="11" viewBox="0 0 16 16" style={{ display: "block", flex: "0 0 auto" }}>
    <path d="M5.6 1.9h4.8l-.7 3 2.45 2.45v1.4H8.8L8.05 14H6.8l.75-5.25H3.85v-1.4L6.3 4.9z" fill="currentColor" />
  </svg>
);

const appTabBarStyle: React.CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  height: TAB_BAR_H,
  display: "flex",
  alignItems: "center",
  minWidth: 0,
  padding: "7px 10px 9px",
  boxSizing: "border-box",
  background: "rgba(255, 255, 255, 0.92)",
  borderTop: "1px solid rgba(255, 136, 32, 0.22)",
  boxShadow: "0 -8px 20px rgba(36, 18, 10, 0.12)",
  zIndex: 70,
};

const appTabRailStyle: React.CSSProperties = {
  minWidth: 0,
  width: "100%",
  height: 36,
  display: "flex",
  alignItems: "center",
  gap: 6,
  overflowX: "auto",
  overflowY: "hidden",
  scrollbarWidth: "thin",
};

function appTabButtonStyle(active: boolean, moving: boolean): React.CSSProperties {
  return {
    flex: "0 0 auto",
    width: 188,
    maxWidth: "38vw",
    height: 32,
    display: "grid",
    gridTemplateColumns: "18px minmax(0, 1fr) auto",
    alignItems: "center",
    gap: 7,
    border: `1px solid ${active ? "rgba(255, 136, 32, 0.76)" : "rgba(36, 18, 10, 0.18)"}`,
    borderRadius: 6,
    background: active ? "rgba(255, 136, 32, 0.14)" : "#ffffff",
    color: active ? "#ff8820" : "#33241a",
    cursor: "pointer",
    font: "inherit",
    fontSize: 12,
    fontWeight: active ? 700 : 600,
    letterSpacing: 0,
    padding: "0 8px",
    textAlign: "left",
    opacity: moving ? 0.78 : 1,
    transform: moving ? "translateY(-1px)" : "none",
    transition: "background 120ms ease, border-color 120ms ease, transform 120ms ease, opacity 120ms ease",
  };
}

const appTabIconStyle: React.CSSProperties = {
  width: 18,
  display: "grid",
  placeItems: "center",
};

const appTabLabelStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
