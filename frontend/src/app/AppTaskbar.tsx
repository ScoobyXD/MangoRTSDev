import React, { useEffect, useRef, useState } from "react";
import { ExplorerRowIcon } from "../modules/company-explorer/CompanyExplorerIcons";
import type { AppDockTab } from "./appDockTabs";
import { AppTimeline } from "./AppTimeline";
import type { AppTimelineState } from "./timelineState";

type AppTaskbarProps = {
  tabs: AppDockTab[];
  activeTabID: string | null;
  timelineState: AppTimelineState;
  expanded: boolean;
  leftInset: number;
  onExpandedChange: (expanded: boolean) => void;
  onOpenTab: (tab: AppDockTab) => void;
  onReorderTab: (movingTabID: string, targetTabID: string) => void;
  onTabContextMenu: (event: React.MouseEvent, tab: AppDockTab) => void;
  onTimelineChange: (next: AppTimelineState) => void;
  onOpenTimelineEntity: (target: { kind: "node" | "logic_gate"; id: string; label: string }) => void;
};

const TASKBAR_COLLAPSED_HEIGHT = 96;
const TASKBAR_EXPANDED_HEIGHT = 330;
const TASKBAR_FLOATING_GAP = 18;

export const AppTaskbar: React.FC<AppTaskbarProps> = ({
  tabs,
  activeTabID,
  timelineState,
  expanded,
  leftInset,
  onExpandedChange,
  onOpenTab,
  onReorderTab,
  onTabContextMenu,
  onTimelineChange,
  onOpenTimelineEntity,
}) => {
  const dragRef = useRef<{ id: string; startX: number; startY: number } | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const suppressNextClickRef = useRef(false);
  const [movingTabID, setMovingTabID] = useState("");
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollLeft = rail.scrollWidth;
  }, [tabs.length]);

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
    <footer style={taskbarShellStyle(expanded, leftInset)} aria-label="Taskbar">
      <div aria-hidden="true" style={taskbarCenterDividerStyle} />
      <section style={taskbarDockPaneStyle(expanded)} aria-label="Collapsed nodes and Logic Gates">
        <div ref={railRef} className="mango-home-scroll" style={dockScrollerStyle}>
          <div style={dockRailStyle}>
            {tabs.map((tab) => {
              const active = activeTabID === tab.id;
              const shortLabel = shortTaskbarLabel(tab.label);
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
                  onContextMenu={(event) => onTabContextMenu(event, tab)}
                  style={dockButtonStyle(active, movingTabID === tab.id)}
                >
                  <span style={dockIconStyle(active)}>
                    <ExplorerRowIcon kind={tab.kind === "node" ? "node" : "logic_gate"} />
                  </span>
                  <span style={dockLabelStyle(active)}>{shortLabel}</span>
                  {tab.pinned && <span style={dockPinnedStyle}><PinIndicator /></span>}
                </button>
              );
            })}
          </div>
        </div>
      </section>
      <section style={taskbarTimelinePaneStyle(expanded)} aria-label="Timeline">
        <AppTimeline
          state={timelineState}
          expanded={expanded}
          onChange={onTimelineChange}
          onOpenEntity={onOpenTimelineEntity}
        />
      </section>
      <button
        type="button"
        title={expanded ? "Minimize taskbar" : "Expand taskbar"}
        aria-label={expanded ? "Minimize taskbar" : "Expand taskbar"}
        aria-pressed={expanded}
        onClick={() => onExpandedChange(!expanded)}
        style={taskbarToggleStyle}
      >
        <ChevronIcon open={expanded} />
      </button>
    </footer>
  );
};

const PinIndicator: React.FC = () => (
  <svg aria-hidden="true" width="11" height="11" viewBox="0 0 16 16" style={{ display: "block", flex: "0 0 auto" }}>
    <path d="M5.6 1.9h4.8l-.7 3 2.45 2.45v1.4H8.8L8.05 14H6.8l.75-5.25H3.85v-1.4L6.3 4.9z" fill="currentColor" />
  </svg>
);

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" style={{ display: "block", transform: open ? "rotate(180deg)" : "none", transition: "transform 140ms ease" }}>
      <path d="M4 10 8 6l4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function shortTaskbarLabel(label: string): string {
  const words = label.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  const fallback = words.length > 0 ? words.slice(0, 2).join(" ") : "Item";
  return fallback.length > 18 ? `${fallback.slice(0, 15)}...` : fallback;
}

function taskbarShellStyle(expanded: boolean, leftInset: number): React.CSSProperties {
  return {
    position: "fixed",
    left: Math.max(TASKBAR_FLOATING_GAP, leftInset + TASKBAR_FLOATING_GAP),
    right: TASKBAR_FLOATING_GAP,
    bottom: TASKBAR_FLOATING_GAP,
    height: expanded ? TASKBAR_EXPANDED_HEIGHT : TASKBAR_COLLAPSED_HEIGHT,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
    gap: 0,
    padding: expanded ? "14px 16px 14px" : "10px 14px",
    boxSizing: "border-box",
    border: "1px solid rgba(148, 163, 184, 0.38)",
    borderRadius: 16,
    background: "linear-gradient(180deg, rgba(255, 255, 255, 0.96) 0%, rgba(248, 250, 252, 0.92) 100%)",
    boxShadow: "0 28px 64px rgba(15, 23, 42, 0.26), 0 10px 22px rgba(15, 23, 42, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.92)",
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    zIndex: 116,
    pointerEvents: "auto",
    color: "#0f172a",
    fontFamily: "var(--mango-font-family)",
    overflow: "visible",
  };
}

const taskbarCenterDividerStyle: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  top: 10,
  bottom: 10,
  width: 1,
  background: "rgba(100, 116, 139, 0.25)",
  transform: "translateX(-0.5px)",
  pointerEvents: "none",
};

function taskbarDockPaneStyle(expanded: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    alignItems: expanded ? "end" : "center",
    justifyContent: "end",
    paddingRight: 18,
    boxSizing: "border-box",
    overflow: "hidden",
  };
}

function taskbarTimelinePaneStyle(expanded: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    minHeight: 0,
    height: "100%",
    paddingLeft: 0,
    boxSizing: "border-box",
    display: "grid",
    alignItems: "stretch",
    overflow: "hidden",
    opacity: expanded ? 1 : 0.98,
  };
}

const dockScrollerStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: "100%",
  minWidth: 0,
  display: "flex",
  justifyContent: "end",
  overflowX: "auto",
  overflowY: "hidden",
  scrollbarWidth: "thin",
  padding: "4px 0",
  boxSizing: "border-box",
};

const dockRailStyle: React.CSSProperties = {
  minWidth: "max-content",
  display: "flex",
  alignItems: "center",
  justifyContent: "end",
  gap: 10,
  marginLeft: "auto",
};

function dockButtonStyle(active: boolean, moving: boolean): React.CSSProperties {
  return {
    flex: "0 0 auto",
    position: "relative",
    width: 68,
    height: 64,
    display: "grid",
    gridTemplateRows: "36px 20px",
    placeItems: "center",
    border: `1px solid ${active ? "rgba(37, 99, 235, 0.62)" : "rgba(100, 116, 139, 0.26)"}`,
    borderRadius: 8,
    background: active ? "linear-gradient(180deg, #eff6ff 0%, #dbeafe 100%)" : "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
    color: active ? "#1d4ed8" : "#334155",
    cursor: "pointer",
    font: "inherit",
    letterSpacing: 0,
    padding: "5px 5px 4px",
    opacity: moving ? 0.78 : 1,
    boxShadow: active ? "0 6px 14px rgba(37, 99, 235, 0.16)" : "0 4px 10px rgba(15, 23, 42, 0.08)",
    transform: moving ? "translateY(-2px)" : "none",
    transition: "background 120ms ease, border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease, opacity 120ms ease",
  };
}

function dockIconStyle(active: boolean): React.CSSProperties {
  return {
    width: 36,
    height: 34,
    display: "grid",
    placeItems: "center",
    color: active ? "#1d4ed8" : "#334155",
    transform: "scale(1.45)",
  };
}

function dockLabelStyle(active: boolean): React.CSSProperties {
  return {
    maxWidth: "100%",
    minWidth: 0,
    height: 20,
    overflow: "hidden",
    color: active ? "#1e3a8a" : "#475569",
    fontSize: 9,
    fontWeight: 800,
    lineHeight: "10px",
    letterSpacing: 0,
    textAlign: "center",
    whiteSpace: "normal",
    wordBreak: "break-word",
  };
}

const dockPinnedStyle: React.CSSProperties = {
  position: "absolute",
  right: 4,
  top: 4,
  display: "grid",
  placeItems: "center",
  color: "#2563eb",
};

const taskbarToggleStyle: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  top: -13,
  width: 30,
  height: 26,
  display: "grid",
  placeItems: "center",
  transform: "translateX(-50%)",
  border: "1px solid rgba(100, 116, 139, 0.3)",
  borderRadius: 999,
  background: "#ffffff",
  color: "#334155",
  boxShadow: "0 8px 18px rgba(15, 23, 42, 0.14)",
  cursor: "pointer",
  padding: 0,
};
