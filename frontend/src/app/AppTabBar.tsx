import React, { useEffect, useRef, useState } from "react";
import { ExplorerRowIcon } from "../modules/company-explorer/CompanyExplorerIcons";
import type { AppDockTab } from "./appDockTabs";

type AppTabBarProps = {
  tabs: AppDockTab[];
  activeTabID: string | null;
  leftOffset: number;
  onOpenTab: (tab: AppDockTab) => void;
  onReorderTab: (movingTabID: string, targetTabID: string) => void;
  onContextMenu: (event: React.MouseEvent, tab: AppDockTab) => void;
};

const TAB_BAR_H = 58;

export const APP_TAB_BAR_HEIGHT = TAB_BAR_H;

export const AppTabBar: React.FC<AppTabBarProps> = ({
  tabs,
  activeTabID,
  leftOffset,
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
    <footer style={appTabBarStyle(leftOffset)} aria-label="Collapsed app tabs">
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
              <span style={appTabIconStyle(active)}>
                <ExplorerRowIcon kind={tab.kind === "node" ? "node" : "logic_gate"} />
              </span>
              {tab.pinned && <span style={appTabPinnedStyle}><PinIndicator /></span>}
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

function appTabBarStyle(leftOffset: number): React.CSSProperties {
  return {
    position: "absolute",
    left: leftOffset,
    right: 10,
    bottom: 0,
    height: TAB_BAR_H,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 0,
    padding: "6px 10px 8px",
    boxSizing: "border-box",
    background: "transparent",
    pointerEvents: "none",
    zIndex: 70,
  };
}
const appTabRailStyle: React.CSSProperties = {
  minWidth: 0,
  maxWidth: "100%",
  height: 44,
  display: "flex",
  alignItems: "center",
  gap: 8,
  overflowX: "auto",
  overflowY: "hidden",
  scrollbarWidth: "thin",
  padding: "4px 12px",
  boxSizing: "border-box",
  border: "1px solid rgba(255, 136, 32, 0.24)",
  borderRadius: 999,
  background: "rgba(255, 255, 255, 0.96)",
  boxShadow: "0 10px 22px rgba(36, 18, 10, 0.16), inset 0 0 0 1px rgba(255, 255, 255, 0.72)",
  pointerEvents: "auto",
};
function appTabButtonStyle(active: boolean, moving: boolean): React.CSSProperties {
  return {
    flex: "0 0 auto",
    position: "relative",
    width: 36,
    height: 36,
    display: "grid",
    placeItems: "center",
    border: `1px solid ${active ? "rgba(255, 136, 32, 0.78)" : "rgba(36, 18, 10, 0.12)"}`,
    borderRadius: 9,
    background: active ? "linear-gradient(180deg, #fff7ee 0%, #ffe0bc 100%)" : "linear-gradient(180deg, #ffffff 0%, #fff8f0 100%)",
    color: active ? "#ff8820" : "#33241a",
    cursor: "pointer",
    font: "inherit",
    letterSpacing: 0,
    padding: 0,
    opacity: moving ? 0.78 : 1,
    boxShadow: active ? "0 5px 12px rgba(255, 136, 32, 0.22)" : "0 4px 10px rgba(36, 18, 10, 0.09)",
    transform: moving ? "translateY(-2px)" : "none",
    transition: "background 120ms ease, border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease, opacity 120ms ease",
  };
}
function appTabIconStyle(active: boolean): React.CSSProperties {
  return {
    width: 22,
    height: 22,
    display: "grid",
    placeItems: "center",
    color: active ? "#ff8820" : "rgba(36, 18, 10, 0.72)",
  };
}

const appTabPinnedStyle: React.CSSProperties = {
  position: "absolute",
  right: 3,
  top: 3,
  display: "grid",
  placeItems: "center",
  color: "#ff8820",
};
