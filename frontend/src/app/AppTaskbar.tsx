import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  onReorderTab: (movingTabID: string, targetTabID: string, placement: "before" | "after") => void;
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
const TASKBAR_DOCK_BUTTON_WIDTH = 176;
const TASKBAR_DOCK_BUTTON_GAP = 0;
const APP_TASKBAR_DOCK_TAB_DRAG_MIME = "application/x-mangorts-app-taskbar-dock-tab";
const TASKBAR_EDGE_FRAME = "linear-gradient(135deg, rgba(92, 238, 255, 0.92) 0%, rgba(128, 216, 255, 0.82) 34%, rgba(183, 124, 255, 0.88) 72%, rgba(255, 255, 255, 0.86) 100%)";
const TASKBAR_SURFACE = "linear-gradient(145deg, rgba(255,255,255,0.96) 0%, rgba(246,247,251,0.94) 100%)";
const TASKBAR_ACTIVE_SURFACE = "linear-gradient(135deg, rgba(255,255,255,0.94), rgba(230,252,255,0.58) 46%, rgba(247,239,255,0.66))";
const TASKBAR_SHADOW = "12px 12px 28px rgba(174, 174, 192, 0.28), -10px -10px 24px rgba(255, 255, 255, 0.92), inset 1px 1px 0 rgba(255, 255, 255, 0.9)";
const TASKBAR_RAISED_SHADOW = "0 14px 32px rgba(15, 23, 42, 0.15), 0 0 16px rgba(183, 124, 255, 0.18), inset 1px 1px 0 rgba(255, 255, 255, 0.88)";
const TASKBAR_SOFT_BORDER = "rgba(255, 255, 255, 0.76)";

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
  const railRef = useRef<HTMLDivElement | null>(null);
  const dockButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const previousDockRectsRef = useRef<Map<string, DOMRect>>(new Map());
  const suppressNextClickRef = useRef(false);
  const previousTabCountRef = useRef(tabs.length);
  const [movingTabID, setMovingTabID] = useState("");
  const [hoveredDockTabID, setHoveredDockTabID] = useState("");
  const [timelineVisible, setTimelineVisible] = useState(false);
  const [leftDockOpen, setLeftDockOpen] = useState(false);
  const hasDockTabs = tabs.length > 0;
  const dockVisible = hasDockTabs && leftDockOpen;
  const layout = taskbarLayout(expanded, 0, leftInset, timelineCenterX, viewportWidth, timelineVisible);

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

  useLayoutEffect(() => {
    const nextRects = new Map<string, DOMRect>();
    for (const tab of tabs) {
      const element = dockButtonRefs.current.get(tab.id);
      if (!element) continue;
      const nextRect = element.getBoundingClientRect();
      const previousRect = previousDockRectsRef.current.get(tab.id);
      if (previousRect) {
        const deltaX = previousRect.left - nextRect.left;
        const deltaY = previousRect.top - nextRect.top;
        if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
          element.animate(
            [
              { transform: `translate(${deltaX}px, ${deltaY}px)` },
              { transform: "translate(0, 0)" },
            ],
            { duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" },
          );
        }
      }
      nextRects.set(tab.id, nextRect);
    }
    previousDockRectsRef.current = nextRects;
  }, [tabs]);

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
    onExpandedChange(false);
  };

  const reorderDockTabFromDrag = (event: React.DragEvent<HTMLElement>, targetTabID: string, placement: "before" | "after") => {
    if (!movingTabID || movingTabID === targetTabID) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    onReorderTab(movingTabID, targetTabID, placement);
  };

  const reorderDockTabFromRailDrag = (event: React.DragEvent<HTMLDivElement>) => {
    if (!movingTabID) return;
    const elements = Array.from(railRef.current?.querySelectorAll<HTMLButtonElement>("[data-taskbar-tab-id]") ?? []);
    if (elements.length === 0) return;
    let target = elements[elements.length - 1];
    let placement: "before" | "after" = "after";
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      if (event.clientX < rect.left + rect.width / 2) {
        target = element;
        placement = "before";
        break;
      }
    }
    const targetID = target.dataset.taskbarTabId ?? "";
    if (!targetID || targetID === movingTabID) return;
    reorderDockTabFromDrag(event, targetID, placement);
  };

  const dockTabStrip = dockVisible ? (
    <section style={minimizedDockStripStyle(leftInset, viewportWidth)} aria-label="Minimized project, node, and Logic Gate tabs">
        <div ref={railRef} className="mango-home-scroll" style={dockScrollerStyle}>
          <div style={dockRailStyle} onDragOver={reorderDockTabFromRailDrag}>
            {tabs.map((tab) => {
              const active = activeTabID === tab.id;
              const shortLabel = shortTaskbarLabel(tab.label);
              const iconKind = dockTabIconKind(tab);
              return (
                <button
                  ref={(element) => {
                    if (element) dockButtonRefs.current.set(tab.id, element);
                    else dockButtonRefs.current.delete(tab.id);
                  }}
                  key={tab.id}
                  type="button"
                  data-taskbar-tab-id={tab.id}
                  title={tab.label}
                  aria-label={tab.label}
                  aria-pressed={active}
                  draggable={!!tab.entityID}
                  onDragStart={(event) => {
                    const payload = dockTabTimelineDragPayload(tab);
                    suppressNextClickRef.current = true;
                    setMovingTabID(tab.id);
                    event.dataTransfer.effectAllowed = "copyMove";
                    event.dataTransfer.setData(APP_TASKBAR_DOCK_TAB_DRAG_MIME, tab.id);
                    if (payload) event.dataTransfer.setData(EXPLORER_DRAG_MIME, JSON.stringify(payload));
                    event.dataTransfer.setData("text/plain", tab.label);
                    attachDottedDockDragPreview(event.dataTransfer, iconKind);
                  }}
                  onDragEnd={() => {
                    setMovingTabID("");
                  }}
                  onMouseEnter={() => setHoveredDockTabID(tab.id)}
                  onMouseLeave={() => setHoveredDockTabID((current) => (current === tab.id ? "" : current))}
                  onDragEnter={(event) => {
                    const bounds = event.currentTarget.getBoundingClientRect();
                    reorderDockTabFromDrag(event, tab.id, event.clientX > bounds.left + bounds.width / 2 ? "after" : "before");
                  }}
                  onDragOver={(event) => {
                    const bounds = event.currentTarget.getBoundingClientRect();
                    reorderDockTabFromDrag(event, tab.id, event.clientX > bounds.left + bounds.width / 2 ? "after" : "before");
                  }}
                  onDrop={(event) => {
                    if (!movingTabID) return;
                    event.preventDefault();
                    setMovingTabID("");
                  }}
                  onClick={() => {
                    if (suppressNextClickRef.current) {
                      suppressNextClickRef.current = false;
                      return;
                    }
                    onOpenTab(tab);
                  }}
                  onContextMenu={(event) => onTabContextMenu(event, tab)}
                  style={dockButtonStyle(active, movingTabID === tab.id, hoveredDockTabID === tab.id)}
                >
                  <span style={dockIconStyle(active, hoveredDockTabID === tab.id)}>
                    <ExplorerRowIcon kind={iconKind} />
                  </span>
                  <span style={dockLabelStyle(active, hoveredDockTabID === tab.id)}>{shortLabel}</span>
                  {tab.pinned && <span style={dockPinnedStyle}><PinIndicator /></span>}
                </button>
              );
            })}
          </div>
        </div>
      </section>
  ) : null;

  return (
    <>
      {dockTabStrip}
      <footer style={taskbarShellStyle(expanded, layout, timelineVisible, false)} aria-label="Taskbar">
      <div aria-hidden="true" style={taskbarCenterDividerStyle(layout.dockWidth, false, timelineVisible)} />
      <section style={taskbarTimelinePaneStyle(expanded, timelineVisible, false)} aria-label="Timeline">
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
        title={dockVisible ? "Hide minimized tabs" : "Show minimized tabs"}
        aria-label={dockVisible ? "Hide minimized tabs" : "Show minimized tabs"}
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
    </>
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
  const fallback = label.trim().replace(/\s+/g, " ") || "Item";
  return fallback.length > 30 ? `${fallback.slice(0, 27)}...` : fallback;
}

type DockIconKind = "node" | "logic_gate" | "project";

function dockTabIconKind(tab: AppDockTab): DockIconKind {
  if (tab.kind === "node") return "node";
  if (tab.kind === "project") return "project";
  return "logic_gate";
}

function dockTabTimelineDragPayload(tab: AppDockTab): { kind: "node" | "logic_gate"; itemID: string; itemType: "node" | "logic_gate"; sourceTreeID: string } | null {
  const itemID = tab.entityID.trim();
  if (!itemID) return null;
  if (tab.kind === "project") return null;
  const kind = tab.kind === "node" ? "node" : "logic_gate";
  return {
    kind,
    itemID,
    itemType: kind,
    sourceTreeID: tab.id,
  };
}

function attachDottedDockDragPreview(dataTransfer: DataTransfer, kind: DockIconKind): void {
  if (typeof document === "undefined") return;
  const preview = document.createElement("div");
  preview.style.position = "fixed";
  preview.style.left = "-1000px";
  preview.style.top = "-1000px";
  preview.style.width = "34px";
  preview.style.height = "34px";
  preview.style.display = "grid";
  preview.style.placeItems = "center";
  preview.style.border = "2px dotted rgba(51, 65, 85, 0.72)";
  preview.style.borderRadius = "7px";
  preview.style.background = "rgba(248, 250, 252, 0.8)";
  preview.style.color = kind === "logic_gate" ? "rgba(51, 65, 85, 0.8)" : "rgba(51, 65, 85, 0.8)";
  preview.style.boxShadow = "0 7px 16px rgba(15, 23, 42, 0.18)";
  preview.style.pointerEvents = "none";
  preview.innerHTML = kind === "project"
    ? projectDockDragPreviewIcon()
    : kind === "logic_gate"
      ? logicGateDockDragPreviewIcon()
      : nodeDockDragPreviewIcon();
  document.body.appendChild(preview);
  dataTransfer.setDragImage(preview, 17, 17);
  window.setTimeout(() => preview.remove(), 0);
}

function nodeDockDragPreviewIcon(): string {
  return `<svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none">
    <path d="M7 3.5h7.25L18 7.25V20.5H7z" fill="rgba(255,255,255,0.62)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M14.25 3.5v4h4" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M9.8 12h4.8M9.8 15h4.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`;
}

function logicGateDockDragPreviewIcon(): string {
  return `<svg aria-hidden="true" width="21" height="19" viewBox="0 0 26 24" fill="none">
    <path d="M2.5 12h4.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
    <path d="M19.3 12h4.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
    <path d="M7 6h6.1a6 6 0 0 1 0 12H7z" fill="rgba(255,255,255,0.62)" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
  </svg>`;
}

function projectDockDragPreviewIcon(): string {
  return `<svg aria-hidden="true" width="20" height="19" viewBox="0 0 24 24" fill="none">
    <path d="M4 5h16v14H4z" fill="rgba(255,255,255,0.62)" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
    <path d="M7 9h5M7 12h8M7 15h5" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/>
    <path d="M17 8.8h1.8v1.8H17zM17 12.1h1.8v1.8H17zM17 15.4h1.8v1.8H17z" fill="currentColor"/>
  </svg>`;
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
    border: surfaceVisible ? "1px solid transparent" : "none",
    borderRadius: surfaceVisible ? 18 : 0,
    background: surfaceVisible ? `${TASKBAR_SURFACE} padding-box, ${TASKBAR_EDGE_FRAME} border-box` : "transparent",
    boxShadow: surfaceVisible ? TASKBAR_SHADOW : "none",
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
    background: "linear-gradient(180deg, rgba(92, 238, 255, 0.34), rgba(183, 124, 255, 0.28), rgba(255, 255, 255, 0.7))",
    transform: "translateX(-0.5px)",
    pointerEvents: "none",
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
      border: "1px solid transparent",
      borderRadius: 999,
      background: `${TASKBAR_SURFACE} padding-box, ${TASKBAR_EDGE_FRAME} border-box`,
      boxShadow: "4px 4px 12px rgba(174, 174, 192, 0.24), -4px -4px 12px rgba(255, 255, 255, 0.9)",
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

function minimizedDockStripStyle(leftInset: number, viewportWidth: number): React.CSSProperties {
  const left = taskbarLeft(leftInset);
  return {
    position: "fixed",
    left,
    bottom: TASKBAR_FLOATING_GAP,
    maxWidth: Math.max(240, viewportWidth - left - TASKBAR_FLOATING_GAP),
    minWidth: 0,
    height: 44,
    display: "flex",
    alignItems: "center",
    padding: "5px 6px",
    boxSizing: "border-box",
    border: "1px solid transparent",
    borderRadius: 8,
    background: `${TASKBAR_SURFACE} padding-box, ${TASKBAR_EDGE_FRAME} border-box`,
    boxShadow: "10px 10px 24px rgba(174, 174, 192, 0.26), -8px -8px 22px rgba(255, 255, 255, 0.88), inset 1px 1px 0 rgba(255,255,255,0.9)",
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    zIndex: 118,
    overflow: "hidden",
    color: "#0f172a",
    fontFamily: "var(--mango-font-family)",
  };
}

const dockScrollerStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: "100%",
  minWidth: 0,
  display: "flex",
  justifyContent: "start",
  overflowX: "auto",
  overflowY: "hidden",
  scrollbarWidth: "thin",
  padding: "0 0 3px",
  boxSizing: "border-box",
};

const dockRailStyle: React.CSSProperties = {
  minWidth: "max-content",
  display: "flex",
  alignItems: "center",
  justifyContent: "start",
  gap: TASKBAR_DOCK_BUTTON_GAP,
};

function dockButtonStyle(active: boolean, moving: boolean, hovered: boolean): React.CSSProperties {
  const lifted = active || hovered;
  return {
    flex: "0 0 auto",
    position: "relative",
    width: TASKBAR_DOCK_BUTTON_WIDTH,
    height: 32,
    display: "grid",
    gridTemplateColumns: "18px minmax(0, 1fr)",
    alignItems: "center",
    justifyItems: "start",
    gap: 7,
    border: lifted ? "1px solid transparent" : `1px solid ${TASKBAR_SOFT_BORDER}`,
    borderRadius: 6,
    background: lifted ? `${TASKBAR_ACTIVE_SURFACE} padding-box, ${TASKBAR_EDGE_FRAME} border-box` : TASKBAR_SURFACE,
    color: active || hovered ? "#0f172a" : "#334155",
    cursor: moving ? "grabbing" : "pointer",
    font: "inherit",
    letterSpacing: 0,
    padding: "0 12px 0 10px",
    opacity: moving ? 0.78 : 1,
    boxShadow: lifted ? TASKBAR_RAISED_SHADOW : "3px 3px 8px rgba(174, 174, 192, 0.18), -3px -3px 8px rgba(255, 255, 255, 0.86), inset 1px 1px 0 rgba(255,255,255,0.84)",
    transform: hovered && !moving ? "translateY(-1px)" : "none",
    transition: "background 140ms ease, border-color 140ms ease, box-shadow 160ms ease, opacity 120ms ease, transform 160ms ease, color 140ms ease",
  };
}

function dockIconStyle(active: boolean, hovered: boolean): React.CSSProperties {
  return {
    width: 18,
    height: 18,
    display: "grid",
    placeItems: "center",
    color: active || hovered ? "#19a8ff" : "#334155",
    transform: active || hovered ? "scale(1.12)" : "none",
    transition: "color 140ms ease, transform 160ms ease",
  };
}

function dockLabelStyle(active: boolean, hovered: boolean): React.CSSProperties {
  return {
    maxWidth: "100%",
    minWidth: 0,
    height: 18,
    overflow: "hidden",
    color: active || hovered ? "#111827" : "#475569",
    fontSize: 12,
    fontWeight: active || hovered ? 850 : 750,
    lineHeight: "18px",
    letterSpacing: 0,
    textAlign: "left",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    transition: "color 140ms ease, font-weight 140ms ease",
  };
}

const dockPinnedStyle: React.CSSProperties = {
  position: "absolute",
  right: 4,
  top: 4,
  display: "grid",
  placeItems: "center",
  color: "#475569",
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
    border: "1px solid transparent",
    borderRadius: 999,
    background: `${active ? TASKBAR_ACTIVE_SURFACE : TASKBAR_SURFACE} padding-box, ${TASKBAR_EDGE_FRAME} border-box`,
    color: active ? "#0f172a" : "#334155",
    boxShadow: active ? TASKBAR_RAISED_SHADOW : "4px 4px 12px rgba(174, 174, 192, 0.22), -4px -4px 12px rgba(255, 255, 255, 0.9)",
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
    border: "1px solid transparent",
    borderRadius: 999,
    background: `${TASKBAR_SURFACE} padding-box, ${TASKBAR_EDGE_FRAME} border-box`,
    color: "#334155",
    boxShadow: "4px 4px 12px rgba(174, 174, 192, 0.24), -4px -4px 12px rgba(255, 255, 255, 0.92), 0 0 12px rgba(183, 124, 255, 0.14)",
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
