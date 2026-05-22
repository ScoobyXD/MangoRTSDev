import React, { useEffect, useRef, useState } from "react";
import { ExplorerRowIcon } from "../modules/company-explorer/CompanyExplorerIcons";
import { EXPLORER_DRAG_MIME } from "../modules/company-explorer/companyExplorerDragDrop";
import type { AppDockTab } from "./appDockTabs";
import { AppTimeline } from "./AppTimeline";
import type { AppTimelineState } from "./timelineState";

type AppTaskbarProps = {
  tabs: AppDockTab[];
  activeTabID: string | null;
  timelineState: AppTimelineState;
  expanded: boolean;
  leftInset: number;
  timelineCenterX: number;
  viewportWidth: number;
  onExpandedChange: (expanded: boolean) => void;
  onOpenTab: (tab: AppDockTab) => void;
  onReorderTab: (movingTabID: string, targetTabID: string) => void;
  onTabContextMenu: (event: React.MouseEvent, tab: AppDockTab) => void;
  onTimelineChange: (next: AppTimelineState) => void;
  onOpenTimelineEntity: (target: { kind: "node" | "logic_gate"; id: string; label: string }) => void;
};

const TASKBAR_COLLAPSED_TOP_LOCK_HEIGHT = 96;
const TASKBAR_COLLAPSED_HEIGHT = 88;
const TASKBAR_EXPANDED_HEIGHT = 330;
const TASKBAR_MINIMIZED_HEIGHT = 8;
const TASKBAR_MINIMIZED_WIDTH = 300;
const TASKBAR_FLOATING_GAP = 18;
const TASKBAR_TIMELINE_MIN_WIDTH = 520;
const TASKBAR_DOCK_BUTTON_WIDTH = 68;
const TASKBAR_DOCK_BUTTON_GAP = 10;
const TASKBAR_CYAN_SOFT = "rgba(0, 233, 255, 0.16)";
const TASKBAR_CYAN_MEDIUM = "rgba(0, 233, 255, 0.28)";
const TASKBAR_CYAN_BORDER = "rgba(0, 233, 255, 0.72)";

type TaskbarLayout = {
  left: number;
  width: number;
  dockWidth: number;
  timelineWidth: number;
};

export const AppTaskbar: React.FC<AppTaskbarProps> = ({
  tabs,
  activeTabID,
  timelineState,
  expanded,
  leftInset,
  timelineCenterX,
  viewportWidth,
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
  const previousTabCountRef = useRef(tabs.length);
  const [movingTabID, setMovingTabID] = useState("");
  const [dragging, setDragging] = useState(false);
  const [timelineVisible, setTimelineVisible] = useState(true);
  const [leftDockOpen, setLeftDockOpen] = useState(() => tabs.length > 0);
  const hasDockTabs = tabs.length > 0;
  const dockVisible = hasDockTabs && leftDockOpen;
  const layout = taskbarLayout(expanded, dockVisible ? tabs.length : 0, leftInset, timelineCenterX, viewportWidth, timelineVisible);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollLeft = rail.scrollWidth;
  }, [tabs.length]);

  useEffect(() => {
    if (tabs.length > previousTabCountRef.current) setLeftDockOpen(true);
    if (tabs.length === 0) setLeftDockOpen(false);
    previousTabCountRef.current = tabs.length;
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

  const toggleExpanded = () => {
    if (!timelineVisible) {
      setTimelineVisible(true);
      onExpandedChange(false);
      return;
    }
    onExpandedChange(!expanded);
  };

  const hideTimeline = () => {
    setTimelineVisible(false);
    setLeftDockOpen(false);
    onExpandedChange(false);
  };

  return (
    <footer style={taskbarShellStyle(expanded, layout, timelineVisible, dockVisible)} aria-label="Taskbar">
      <div aria-hidden="true" style={taskbarCenterDividerStyle(layout.dockWidth, dockVisible, timelineVisible)} />
      <section style={taskbarDockPaneStyle(expanded, dockVisible, !timelineVisible)} aria-label="Collapsed nodes and Logic Gates">
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
                  draggable={!!tab.entityID}
                  onDragStart={(event) => {
                    const payload = dockTabTimelineDragPayload(tab);
                    if (!payload) {
                      event.preventDefault();
                      return;
                    }
                    suppressNextClickRef.current = true;
                    setDragging(true);
                    setMovingTabID(tab.id);
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData(EXPLORER_DRAG_MIME, JSON.stringify(payload));
                    event.dataTransfer.setData("text/plain", tab.label);
                  }}
                  onDragEnd={() => {
                    dragRef.current = null;
                    setMovingTabID("");
                    setDragging(false);
                  }}
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
                  <span style={dockIconStyle}>
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
      <section style={taskbarTimelinePaneStyle(expanded, timelineVisible, dockVisible)} aria-label="Timeline">
        {timelineVisible && (
          <AppTimeline
            state={timelineState}
            expanded={expanded}
            onChange={onTimelineChange}
            onOpenEntity={onOpenTimelineEntity}
          />
        )}
      </section>
      <button
        type="button"
        title={dockVisible ? "Hide collapsed nodes and Logic Gates" : "Show collapsed nodes and Logic Gates"}
        aria-label={dockVisible ? "Hide collapsed nodes and Logic Gates" : "Show collapsed nodes and Logic Gates"}
        aria-pressed={dockVisible}
        onClick={() => setLeftDockOpen((current) => !current)}
        style={taskbarSideToggleStyle(layout, "left", timelineVisible, dockVisible)}
      >
        <ArrowIcon direction={dockVisible ? "right" : "left"} />
      </button>
      <button
        type="button"
        title="Right taskbar section"
        aria-label="Right taskbar section"
        aria-disabled="true"
        onClick={(event) => event.preventDefault()}
        style={taskbarSideToggleStyle(layout, "right", timelineVisible, false)}
      >
        <ArrowIcon direction="right" />
      </button>
      <div style={taskbarCenterToggleStyle(layout, timelineVisible, timelineVisible && !expanded)} aria-label="Taskbar timeline controls">
        {timelineVisible && expanded ? (
          <button
            type="button"
            title="Collapse expanded taskbar"
            aria-label="Collapse expanded taskbar"
            aria-pressed={expanded}
            onClick={toggleExpanded}
            style={taskbarCenterSingleButtonStyle}
          >
            <ArrowIcon direction="down" />
          </button>
        ) : (
          <>
            <button
              type="button"
              title={!timelineVisible ? "Show taskbar" : "Expand taskbar"}
              aria-label={!timelineVisible ? "Show taskbar" : "Expand taskbar"}
              aria-pressed={expanded}
              onClick={toggleExpanded}
              style={timelineVisible ? taskbarCenterHalfButtonStyle("top") : taskbarCenterSingleButtonStyle}
            >
              <ChevronIcon open={false} />
            </button>
            {timelineVisible && (
              <button
                type="button"
                title="Hide taskbar"
                aria-label="Hide taskbar"
                onClick={hideTimeline}
                style={taskbarCenterHalfButtonStyle("bottom")}
              >
                <ArrowIcon direction="down" />
              </button>
            )}
          </>
        )}
      </div>
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

function ArrowIcon({ direction }: { direction: "left" | "right" | "down" }) {
  const transform = direction === "right"
    ? "rotate(90deg)"
    : direction === "left"
      ? "rotate(-90deg)"
      : "rotate(180deg)";
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" style={{ display: "block", transform }}>
      <path d="M4 10 8 6l4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function shortTaskbarLabel(label: string): string {
  const words = label.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  const fallback = words.length > 0 ? words.slice(0, 2).join(" ") : "Item";
  return fallback.length > 18 ? `${fallback.slice(0, 15)}...` : fallback;
}

function dockTabTimelineDragPayload(tab: AppDockTab): { kind: "node" | "logic_gate"; itemID: string; itemType: "node" | "logic_gate"; sourceTreeID: string } | null {
  const itemID = tab.entityID.trim();
  if (!itemID) return null;
  const kind = tab.kind === "node" ? "node" : "logic_gate";
  return {
    kind,
    itemID,
    itemType: kind,
    sourceTreeID: tab.id,
  };
}

function taskbarLeft(leftInset: number): number {
  return Math.max(TASKBAR_FLOATING_GAP, leftInset + TASKBAR_FLOATING_GAP);
}

function taskbarDockHorizontalPadding(expanded: boolean): number {
  return expanded ? 34 : 32;
}

function taskbarPreferredDockWidth(expanded: boolean, tabCount: number): number {
  if (tabCount <= 0) return 0;
  return (
    taskbarDockHorizontalPadding(expanded)
    + tabCount * TASKBAR_DOCK_BUTTON_WIDTH
    + Math.max(0, tabCount - 1) * TASKBAR_DOCK_BUTTON_GAP
  );
}

function taskbarLayout(expanded: boolean, tabCount: number, leftInset: number, timelineCenterX: number, viewportWidth: number, timelineVisible: boolean): TaskbarLayout {
  const minLeft = taskbarLeft(leftInset);
  const maxRight = Math.max(TASKBAR_FLOATING_GAP, viewportWidth - TASKBAR_FLOATING_GAP);
  const centeredMaxWidth = Math.max(
    1,
    Math.min(timelineCenterX - minLeft, maxRight - timelineCenterX) * 2,
  );
  const preferredTimelineWidth = timelineVisible
    ? Math.max(TASKBAR_TIMELINE_MIN_WIDTH, timelineCenterX - TASKBAR_FLOATING_GAP)
    : TASKBAR_MINIMIZED_WIDTH;
  const timelineWidth = Math.max(1, Math.min(preferredTimelineWidth, centeredMaxWidth));
  const timelineLeft = Math.round(timelineCenterX - timelineWidth / 2);
  const maxDockWidth = Math.max(0, timelineLeft - minLeft);
  const dockWidth = Math.round(Math.min(taskbarPreferredDockWidth(expanded, tabCount), maxDockWidth));
  const left = timelineLeft - dockWidth;

  return {
    left,
    width: dockWidth + timelineWidth,
    dockWidth,
    timelineWidth,
  };
}

function taskbarShellStyle(expanded: boolean, layout: TaskbarLayout, timelineVisible: boolean, dockVisible: boolean): React.CSSProperties {
  const surfaceVisible = timelineVisible;
  const collapsedBottomRise = TASKBAR_COLLAPSED_TOP_LOCK_HEIGHT - TASKBAR_COLLAPSED_HEIGHT;
  return {
    position: "fixed",
    left: layout.left,
    width: layout.width,
    bottom: TASKBAR_FLOATING_GAP + (timelineVisible && !expanded ? collapsedBottomRise : 0),
    height: timelineVisible
      ? expanded ? TASKBAR_EXPANDED_HEIGHT : TASKBAR_COLLAPSED_HEIGHT
      : dockVisible ? TASKBAR_COLLAPSED_HEIGHT : TASKBAR_MINIMIZED_HEIGHT,
    display: "grid",
    gridTemplateColumns: `${layout.dockWidth}px ${layout.timelineWidth}px`,
    gap: 0,
    padding: 0,
    boxSizing: "border-box",
    border: surfaceVisible ? "1px solid rgba(148, 163, 184, 0.38)" : "none",
    borderRadius: surfaceVisible ? 16 : 0,
    background: surfaceVisible ? "linear-gradient(180deg, rgba(255, 255, 255, 0.96) 0%, rgba(255, 255, 255, 0.94) 100%)" : "transparent",
    boxShadow: surfaceVisible ? "0 28px 64px rgba(15, 23, 42, 0.26), 0 10px 22px rgba(15, 23, 42, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.92)" : "none",
    backdropFilter: surfaceVisible ? "blur(18px)" : "none",
    WebkitBackdropFilter: surfaceVisible ? "blur(18px)" : "none",
    zIndex: 116,
    pointerEvents: "auto",
    color: "#0f172a",
    fontFamily: "var(--mango-font-family)",
    overflow: "visible",
  };
}

function taskbarCenterDividerStyle(dockWidth: number, visible: boolean, timelineVisible: boolean): React.CSSProperties {
  return {
    position: "absolute",
    display: visible && timelineVisible ? "block" : "none",
    left: dockWidth,
    top: 0,
    bottom: 0,
    width: 1,
    background: "rgba(100, 116, 139, 0.25)",
    transform: "translateX(-0.5px)",
    pointerEvents: "none",
  };
}

function taskbarDockPaneStyle(expanded: boolean, visible: boolean, detached: boolean): React.CSSProperties {
  return {
    gridColumn: 1,
    alignSelf: detached ? "end" : "stretch",
    minWidth: 0,
    minHeight: 0,
    height: detached ? TASKBAR_COLLAPSED_HEIGHT : "auto",
    display: "flex",
    alignItems: expanded ? "end" : "center",
    justifyContent: "end",
    padding: expanded ? "14px 18px 14px 16px" : "10px 18px 10px 14px",
    boxSizing: "border-box",
    overflow: "hidden",
    visibility: visible ? "visible" : "hidden",
    pointerEvents: visible ? "auto" : "none",
    border: detached ? "1px solid rgba(148, 163, 184, 0.38)" : "none",
    borderRadius: detached ? 16 : 0,
    background: detached ? "linear-gradient(180deg, rgba(255, 255, 255, 0.96) 0%, rgba(255, 255, 255, 0.94) 100%)" : "transparent",
    boxShadow: detached ? "0 18px 42px rgba(15, 23, 42, 0.20), 0 8px 18px rgba(15, 23, 42, 0.12)" : "none",
    backdropFilter: detached ? "blur(18px)" : "none",
    WebkitBackdropFilter: detached ? "blur(18px)" : "none",
  };
}

function taskbarTimelinePaneStyle(expanded: boolean, timelineVisible: boolean, dockVisible: boolean): React.CSSProperties {
  if (!timelineVisible) {
    return {
      gridColumn: 2,
      alignSelf: "end",
      minWidth: 0,
      minHeight: 0,
      height: TASKBAR_MINIMIZED_HEIGHT,
      boxSizing: "border-box",
      display: "block",
      overflow: "visible",
      border: "1px solid rgba(100, 116, 139, 0.34)",
      borderRadius: 999,
      background: "#ffffff",
      boxShadow: "0 8px 18px rgba(15, 23, 42, 0.14)",
    };
  }
  return {
    gridColumn: 2,
    minWidth: 0,
    minHeight: 0,
    height: "100%",
    paddingLeft: 0,
    boxSizing: "border-box",
    display: "grid",
    alignItems: "stretch",
    overflow: "hidden",
    opacity: expanded ? 1 : 0.98,
    borderRadius: dockVisible ? "0 15px 15px 0" : 15,
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
  gap: TASKBAR_DOCK_BUTTON_GAP,
  marginLeft: "auto",
};

function dockButtonStyle(active: boolean, moving: boolean): React.CSSProperties {
  return {
    flex: "0 0 auto",
    position: "relative",
    width: TASKBAR_DOCK_BUTTON_WIDTH,
    height: 64,
    display: "grid",
    gridTemplateRows: "34px 20px",
    placeItems: "center",
    border: `1px solid ${active ? TASKBAR_CYAN_BORDER : TASKBAR_CYAN_MEDIUM}`,
    borderRadius: 7,
    background: active ? TASKBAR_CYAN_SOFT : "#ffffff",
    color: "#24120a",
    cursor: "pointer",
    font: "inherit",
    letterSpacing: 0,
    padding: "6px 5px 4px",
    opacity: moving ? 0.78 : 1,
    boxShadow: active ? `0 0 0 2px ${TASKBAR_CYAN_SOFT}` : "none",
    transform: moving ? "translateY(-2px)" : "none",
    transition: "background 120ms ease, border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease, opacity 120ms ease",
  };
}

const dockIconStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  display: "grid",
  placeItems: "center",
  color: "#24120a",
  transform: "scale(1.5)",
};

function dockLabelStyle(active: boolean): React.CSSProperties {
  return {
    maxWidth: "100%",
    minWidth: 0,
    height: 20,
    overflow: "hidden",
    color: "#24120a",
    fontSize: 10,
    fontWeight: active ? 800 : 700,
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
  color: "#0891b2",
};

function taskbarSideToggleStyle(layout: TaskbarLayout, side: "left" | "right", timelineVisible: boolean, active: boolean): React.CSSProperties {
  const timelineCenter = layout.dockWidth + layout.timelineWidth / 2;
  const visibleLeft = side === "left"
    ? active ? 0 : layout.dockWidth
    : layout.dockWidth + layout.timelineWidth;
  const hiddenLeft = side === "left" && active
    ? 0
    : timelineCenter + (side === "left" ? -48 : 48);
  return {
    position: "absolute",
    left: timelineVisible ? visibleLeft : hiddenLeft,
    top: timelineVisible ? "50%" : undefined,
    bottom: timelineVisible ? undefined : -8,
    width: 28,
    height: 28,
    display: "grid",
    placeItems: "center",
    transform: timelineVisible ? "translate(-50%, -50%)" : "translateX(-50%)",
    border: "1px solid rgba(100, 116, 139, 0.3)",
    borderRadius: 999,
    background: active ? "#f8fafc" : "#ffffff",
    color: active ? "#0f172a" : "#334155",
    boxShadow: "none",
    cursor: "pointer",
    padding: 0,
    zIndex: 2,
  };
}

function taskbarCenterToggleStyle(layout: TaskbarLayout, timelineVisible: boolean, split: boolean): React.CSSProperties {
  return {
    position: "absolute",
    left: layout.dockWidth + layout.timelineWidth / 2,
    top: timelineVisible ? -16 : -24,
    width: 32,
    height: split ? 34 : 30,
    display: "grid",
    gridTemplateRows: split ? "1fr 1fr" : "1fr",
    overflow: "hidden",
    transform: "translateX(-50%)",
    border: "1px solid rgba(100, 116, 139, 0.3)",
    borderRadius: 999,
    background: "#ffffff",
    color: "#334155",
    boxShadow: "none",
    zIndex: 3,
  };
}

function taskbarCenterHalfButtonStyle(half: "top" | "bottom"): React.CSSProperties {
  return {
    minWidth: 0,
    minHeight: 0,
    display: "grid",
    placeItems: "center",
    border: "none",
    borderBottom: half === "top" ? "1px solid rgba(100, 116, 139, 0.22)" : "none",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
    padding: 0,
  };
}

const taskbarCenterSingleButtonStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  display: "grid",
  placeItems: "center",
  border: "none",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  padding: 0,
};
