import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ExplorerRowIcon } from "../icons/index.js";
import { EXPLORER_DRAG_MIME, readExplorerDragPayload } from "../modules/company-explorer/companyExplorerDragDrop";
import { getExplorerDropPayloadItems } from "../modules/company-explorer/treePresentation";
import { EXPLORER_ENTITY_DRAG_MIME, parseExplorerEntityDragItems } from "../modules/kanban/shared";
import FrameRightClickMenu from "./framerightclickmenu";
import {
  APP_TIMELINE_STEP_MINUTES,
  alignTimelineMinute,
  clampTimelineEnd,
  clampTimelineStart,
  deleteTimelineItem,
  formatTimelineDate,
  formatTimelineTime,
  formatTimelineTimeRange,
  setTimelineRange,
  timeInputFromTimelineMinute,
  timelineMinuteFromTimeInput,
  updateTimelineItemCompleted,
  updateTimelineItemTiming,
  upsertTimelineDropsAt,
  type AppTimelineDay,
  type AppTimelineDropInput,
  type AppTimelineEntityKind,
  type AppTimelineItem,
  type AppTimelineState,
} from "./timelineState";

type AppTimelineProps = {
  state: AppTimelineState;
  expanded: boolean;
  onChange: (next: AppTimelineState) => void;
  onOpenEntity: (target: { kind: AppTimelineEntityKind; id: string; label: string }) => void;
};

type TimelineInteraction = {
  itemID: string;
  mode: "move" | "start" | "end";
  startX: number;
  startMinute: number;
  endMinute: number;
  pxPerMinute: number;
  ownerDocument: Document;
  previousCursor: string;
  previousUserSelect: string;
};

type TimelineMetrics = {
  rangeMinutes: number;
  contentWidth: number;
  pxPerMinute: number;
  ticks: TimelineTick[];
};

type TimelineTick = {
  minute: number;
  left: number;
  major: boolean;
  label: string;
  labelAlign: "after" | "before";
};

const PIXELS_PER_QUARTER_HOUR = 31;
const TIMELINE_VISUAL_STEP_MINUTES = 15;
const COMPACT_HEADER_HEIGHT = 22;
const EXPANDED_TRACK_HEIGHT = 88;
const EXPANDED_LANE_TOP = COMPACT_HEADER_HEIGHT;
const TIMELINE_NODE_ACCENT = "#19a8ff";
const TIMELINE_NODE_ACCENT_TOP = "#33ddd5";
const TIMELINE_LOGIC_GATE_ACCENT = "#19f07a";
const TIMELINE_LOGIC_GATE_ACCENT_TOP = "#7cff9b";
const TIMELINE_LOGIC_GATE_ACCENT_BOTTOM = "#00c86f";
const TIMELINE_ITEM_BORDER_WIDTH = 1.5;
const TIMELINE_ITEM_EDGE_WIDTH = 4;
const TIMELINE_ITEM_CHECKBOX_WIDTH = 24;
const TIMELINE_EDGE_FRAME = "linear-gradient(135deg, rgba(92, 238, 255, 0.92) 0%, rgba(128, 216, 255, 0.82) 34%, rgba(183, 124, 255, 0.88) 72%, rgba(255, 255, 255, 0.86) 100%)";
const TIMELINE_SURFACE = "linear-gradient(145deg, rgba(255,255,255,0.96) 0%, rgba(246,247,251,0.94) 100%)";
const TIMELINE_ACTIVE_SURFACE = "linear-gradient(135deg, rgba(255,255,255,0.94), rgba(230,252,255,0.58) 46%, rgba(247,239,255,0.66))";
const TIMELINE_PANEL_SHADOW = "6px 6px 16px rgba(174, 174, 192, 0.20), -6px -6px 16px rgba(255, 255, 255, 0.88), inset 1px 1px 0 rgba(255, 255, 255, 0.86)";

export const AppTimeline: React.FC<AppTimelineProps> = ({
  state,
  expanded,
  onChange,
  onOpenEntity,
}) => {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<TimelineInteraction | null>(null);
  const stateRef = useRef(state);
  const [scrollerWidth, setScrollerWidth] = useState(0);
  const [selectedItemID, setSelectedItemID] = useState("");
  const [dropActive, setDropActive] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; itemID: string } | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!selectedItemID) return;
    if (!state.items.some((item) => item.id === selectedItemID)) setSelectedItemID("");
  }, [selectedItemID, state.items]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const interaction = interactionRef.current;
      if (!interaction) return;
      event.preventDefault();
      const current = stateRef.current;
      const deltaMinutes = alignTimelineMinute((event.clientX - interaction.startX) / interaction.pxPerMinute);
      const duration = interaction.endMinute - interaction.startMinute;
      if (interaction.mode === "move") {
        const maxStart = current.endMinute - duration;
        const nextStart = Math.min(maxStart, Math.max(current.startMinute, alignTimelineMinute(interaction.startMinute + deltaMinutes)));
        onChange(updateTimelineItemTiming(current, interaction.itemID, nextStart, nextStart + duration));
        return;
      }
      if (interaction.mode === "start") {
        onChange(updateTimelineItemTiming(current, interaction.itemID, clampTimelineStart(interaction.startMinute + deltaMinutes, current), interaction.endMinute));
        return;
      }
      onChange(updateTimelineItemTiming(current, interaction.itemID, interaction.startMinute, clampTimelineEnd(interaction.endMinute + deltaMinutes, current)));
    };
    const finishInteraction = () => {
      const interaction = interactionRef.current;
      if (!interaction) return;
      interactionRef.current = null;
      interaction.ownerDocument.body.style.cursor = interaction.previousCursor;
      interaction.ownerDocument.body.style.userSelect = interaction.previousUserSelect;
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finishInteraction);
    window.addEventListener("pointercancel", finishInteraction);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finishInteraction);
      window.removeEventListener("pointercancel", finishInteraction);
    };
  }, [onChange]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!selectedItemID || event.defaultPrevented || (event.key !== "Delete" && event.key !== "Backspace")) return;
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      onChange(deleteTimelineItem(stateRef.current, selectedItemID));
      setSelectedItemID("");
      setContextMenu(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onChange, selectedItemID]);

  const compact = !expanded;
  const metrics = useTimelineMetrics(state, compact, scrollerWidth);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;

    const updateScrollerWidth = () => {
      setScrollerWidth(Math.max(1, Math.floor(scroller.clientWidth)));
    };

    updateScrollerWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateScrollerWidth);
      return () => window.removeEventListener("resize", updateScrollerWidth);
    }

    const observer = new ResizeObserver(updateScrollerWidth);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  const dropMinuteFromEvent = (event: React.DragEvent<HTMLElement>): number => {
    const content = contentRef.current;
    if (!content) return state.startMinute;
    const bounds = content.getBoundingClientRect();
    const x = Math.max(0, Math.min(metrics.contentWidth, event.clientX - bounds.left));
    return clampTimelineStart(state.startMinute + (x / metrics.contentWidth) * metrics.rangeMinutes, state);
  };

  const startInteraction = (event: React.PointerEvent<HTMLElement>, item: AppTimelineItem, mode: TimelineInteraction["mode"]) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedItemID(item.id);
    setContextMenu(null);
    const ownerDocument = event.currentTarget.ownerDocument;
    interactionRef.current = {
      itemID: item.id,
      mode,
      startX: event.clientX,
      startMinute: item.startMinute,
      endMinute: item.endMinute,
      pxPerMinute: metrics.pxPerMinute,
      ownerDocument,
      previousCursor: ownerDocument.body.style.cursor,
      previousUserSelect: ownerDocument.body.style.userSelect,
    };
    ownerDocument.body.style.cursor = mode === "move" ? "grabbing" : "ew-resize";
    ownerDocument.body.style.userSelect = "none";
  };

  const visibleHistory = state.history.filter((day) => day.items.length > 0);

  return (
    <section
      aria-label="Taskbar timeline"
      style={timelineShellStyle(expanded)}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) setSelectedItemID("");
      }}
    >
      {expanded && (
        <div style={timelineHeaderStyle}>
          <div style={timelineTitleStyle}>
            <span>Timeline</span>
            <span style={timelineMetaStyle}>{state.items.length} current item{state.items.length === 1 ? "" : "s"}</span>
          </div>
          <div style={timelineControlGroupStyle}>
            <label style={timeFieldStyle}>
              <span>Start</span>
              <input
                type="time"
                step={APP_TIMELINE_STEP_MINUTES * 60}
                value={timeInputFromTimelineMinute(state.startMinute)}
                onChange={(event) => onChange(setTimelineRange(state, timelineMinuteFromTimeInput(event.target.value, state.startMinute), state.endMinute))}
                style={timeInputStyle}
              />
            </label>
            <label style={timeFieldStyle}>
              <span>End</span>
              <input
                type="time"
                step={APP_TIMELINE_STEP_MINUTES * 60}
                value={timeInputFromTimelineMinute(state.endMinute)}
                onChange={(event) => onChange(setTimelineRange(state, state.startMinute, timelineMinuteFromTimeInput(event.target.value, state.endMinute)))}
                style={timeInputStyle}
              />
            </label>
          </div>
        </div>
      )}

      <div className={expanded ? "mango-home-scroll" : undefined} style={timelineDaysScrollerStyle(expanded)}>
        <div style={timelineDayPanelStyle(expanded)}>
          {expanded && (
            <div style={timelineDayTitleStyle}>
              <span>Today</span>
              <span>{formatTimelineDate(state.currentDate)}</span>
            </div>
          )}
          <div
            ref={scrollerRef}
            style={timelineScrollerStyle(dropActive, compact)}
            onDragOver={(event) => {
              if (!hasExplorerTimelineDrag(event.dataTransfer)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setDropActive(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false);
            }}
            onDrop={(event) => {
              const drops = timelineDropsFromDataTransfer(event.dataTransfer);
              setDropActive(false);
              if (drops.length === 0) return;
              event.preventDefault();
              event.stopPropagation();
              onChange(upsertTimelineDropsAt(state, drops, dropMinuteFromEvent(event)));
            }}
          >
            <div ref={contentRef} style={timelineContentStyle(metrics.contentWidth, compact)}>
              <TimelineTicks ticks={metrics.ticks} compact={compact} />
              <div style={timelineLaneStyle(compact)}>
                {state.items.map((item) => {
                  const selected = selectedItemID === item.id;
                  const left = (item.startMinute - state.startMinute) * metrics.pxPerMinute;
                  const width = Math.max(APP_TIMELINE_STEP_MINUTES * metrics.pxPerMinute, (item.endMinute - item.startMinute) * metrics.pxPerMinute);
                  return (
                    <div
                      key={item.id}
                      role="button"
                      tabIndex={0}
                      title={`${item.label}: ${formatTimelineTimeRange(item.startMinute, item.endMinute)}`}
                      aria-label={`${item.label}, ${formatTimelineTimeRange(item.startMinute, item.endMinute)}`}
                      aria-pressed={selected}
                      style={timelineItemStyle(item.kind, selected, item.completed, left, width, compact, false)}
                      onPointerDown={(event) => startInteraction(event, item, "move")}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedItemID(item.id);
                      }}
                      onDoubleClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onOpenEntity({ kind: item.kind, id: item.entityID, label: item.label });
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setSelectedItemID(item.id);
                        setContextMenu({ x: event.clientX, y: event.clientY, itemID: item.id });
                      }}
                    >
                      <span
                        title="Adjust start time"
                        aria-hidden="true"
                        style={timelineItemHandleStyle("left", item.kind, item.completed)}
                        onPointerDown={(event) => startInteraction(event, item, "start")}
                      />
                      <TimelineItemMain item={item} compact={compact} width={width} />
                      <label
                        title={item.completed ? "Mark incomplete" : "Mark complete"}
                        aria-label={item.completed ? "Mark incomplete" : "Mark complete"}
                        style={timelineCheckboxWrapStyle(compact, width)}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={item.completed}
                          onChange={(event) => onChange(updateTimelineItemCompleted(state, item.id, event.currentTarget.checked))}
                          style={timelineCheckboxStyle}
                        />
                      </label>
                      <span
                        title="Adjust end time"
                        aria-hidden="true"
                        style={timelineItemHandleStyle("right", item.kind, item.completed)}
                        onPointerDown={(event) => startInteraction(event, item, "end")}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {expanded && visibleHistory.map((day) => (
          <TimelineHistoryDay key={day.date} day={day} availableWidth={scrollerWidth} onOpenEntity={onOpenEntity} />
        ))}
      </div>

      {contextMenu && (
        <FrameRightClickMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
          <button
            type="button"
            style={timelineMenuButtonStyle}
            onClick={() => {
              onChange(deleteTimelineItem(state, contextMenu.itemID));
              setSelectedItemID("");
              setContextMenu(null);
            }}
          >
            Remove from Timeline
          </button>
        </FrameRightClickMenu>
      )}
    </section>
  );
};

function TimelineHistoryDay({
  day,
  availableWidth,
  onOpenEntity,
}: {
  day: AppTimelineDay;
  availableWidth: number;
  onOpenEntity: (target: { kind: AppTimelineEntityKind; id: string; label: string }) => void;
}) {
  const metrics = useTimelineMetrics(day, false, availableWidth);
  return (
    <div style={timelineDayPanelStyle(true)}>
      <div style={timelineDayTitleStyle}>
        <span>{formatTimelineDate(day.date)}</span>
        <span>{day.items.length} item{day.items.length === 1 ? "" : "s"}</span>
      </div>
      <div style={timelineScrollerStyle(false, false)}>
        <div style={timelineContentStyle(metrics.contentWidth, false)}>
          <TimelineTicks ticks={metrics.ticks} compact={false} />
          <div style={timelineLaneStyle(false)}>
            {day.items.map((item) => {
              const left = (item.startMinute - day.startMinute) * metrics.pxPerMinute;
              const width = Math.max(APP_TIMELINE_STEP_MINUTES * metrics.pxPerMinute, (item.endMinute - item.startMinute) * metrics.pxPerMinute);
              return (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  title={`${item.label}: ${formatTimelineTimeRange(item.startMinute, item.endMinute)}`}
                  aria-label={`${item.label}, ${formatTimelineTimeRange(item.startMinute, item.endMinute)}`}
                  style={timelineItemStyle(item.kind, false, item.completed, left, width, false, true)}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onOpenEntity({ kind: item.kind, id: item.entityID, label: item.label });
                  }}
                >
                  <TimelineItemMain item={item} compact={false} width={width} />
                  <HistoryCompletedIcon completed={item.completed} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function TimelineItemMain({ item, compact, width }: { item: AppTimelineItem; compact: boolean; width: number }) {
  return (
    <span style={timelineItemMainStyle(compact, width)}>
      <span style={timelineItemTopRowStyle(width)}>
        <span style={timelineItemIconStyle(width)}><ExplorerRowIcon kind={item.kind === "node" ? "node" : "logic_gate"} /></span>
        <span style={timelineItemTextStyle(width, item.completed)}>{item.label}</span>
      </span>
      <span style={timelineItemBottomRowStyle(width, item.completed)}>
        {formatTimelineAdaptiveTimeRange(item.startMinute, item.endMinute, width)}
      </span>
    </span>
  );
}

function TimelineTicks({ ticks, compact }: { ticks: TimelineMetrics["ticks"]; compact: boolean }) {
  return (
    <>
      {ticks.map((tick) => (
        <React.Fragment key={`${tick.minute}:${tick.left}`}>
          <div style={timelineTickStyle(tick.left, tick.major, compact)} />
          {tick.label && <span style={timelineTickLabelStyle(tick.left, tick.labelAlign)}>{tick.label}</span>}
        </React.Fragment>
      ))}
    </>
  );
}

function HistoryCompletedIcon({ completed }: { completed: boolean }) {
  return (
    <span style={timelineHistoryCheckStyle(completed)}>
      {completed && (
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ display: "block" }}>
          <path d="M3.2 8.3 6.4 11.4 12.8 4.7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

function useTimelineMetrics(range: Pick<AppTimelineDay, "startMinute" | "endMinute">, _compact: boolean, availableWidth = 0): TimelineMetrics {
  const rangeMinutes = Math.max(APP_TIMELINE_STEP_MINUTES, range.endMinute - range.startMinute);
  const intervalCount = Math.max(1, rangeMinutes / TIMELINE_VISUAL_STEP_MINUTES);
  const expandedContentWidth = Math.max(680, intervalCount * PIXELS_PER_QUARTER_HOUR);
  const contentWidth = Math.max(1, availableWidth || expandedContentWidth);
  const pxPerMinute = contentWidth / rangeMinutes;
  const ticks = useMemo(() => buildTimelineTicks(range.startMinute, range.endMinute, contentWidth), [contentWidth, range.endMinute, range.startMinute]);
  return { rangeMinutes, contentWidth, pxPerMinute, ticks };
}

function hasExplorerTimelineDrag(dataTransfer: DataTransfer): boolean {
  const types = Array.from(dataTransfer.types);
  return types.includes(EXPLORER_DRAG_MIME) || types.includes(EXPLORER_ENTITY_DRAG_MIME);
}

function timelineDropsFromDataTransfer(dataTransfer: DataTransfer): AppTimelineDropInput[] {
  const nodeItems = parseExplorerEntityDragItems(dataTransfer.getData(EXPLORER_ENTITY_DRAG_MIME));
  const nodeLabelByID = new Map(nodeItems.map((item) => [item.nodeID, item.label]));
  const payload = readExplorerDragPayload(dataTransfer);
  if (!payload) {
    return nodeItems.map((item) => ({ kind: "node", entityID: item.nodeID, label: item.label }));
  }
  const droppedText = dataTransfer.getData("text/plain").trim();

  if (payload.kind === "node" && payload.itemID) {
    return [{ kind: "node", entityID: payload.itemID, label: nodeLabelByID.get(payload.itemID) || droppedText || payload.itemID }];
  }
  if (payload.kind === "logic_gate" && payload.itemID) {
    return [{ kind: "logic_gate", entityID: payload.itemID, label: droppedText || payload.itemID }];
  }
  if (payload.kind !== "batch") return [];

  const items = getExplorerDropPayloadItems(payload).filter((item) => item.itemType === "node" || item.itemType === "logic_gate");
  const singleLabel = items.length === 1 ? droppedText : "";
  return items.map((item) => ({
    kind: item.itemType === "node" ? "node" : "logic_gate",
    entityID: item.itemID,
    label: item.itemType === "node" ? (nodeLabelByID.get(item.itemID) || singleLabel || "Node") : (singleLabel || "Process"),
  }));
}

function buildTimelineTicks(startMinute: number, endMinute: number, contentWidth: number): TimelineTick[] {
  const range = Math.max(APP_TIMELINE_STEP_MINUTES, endMinute - startMinute);
  const ticks: TimelineTick[] = [];
  const tickStep = TIMELINE_VISUAL_STEP_MINUTES;
  const firstTick = Math.ceil(startMinute / tickStep) * tickStep;
  const tickMinutes = [
    startMinute,
    ...Array.from({ length: Math.max(0, Math.floor((endMinute - firstTick) / tickStep) + 1) }, (_, index) => firstTick + index * tickStep),
    endMinute,
  ].filter((minute, index, values) => minute >= startMinute && minute <= endMinute && values.indexOf(minute) === index);
  for (const minute of tickMinutes) {
    const left = ((minute - startMinute) / range) * contentWidth;
    const major = minute === startMinute || minute === endMinute || minute % 60 === 0;
    ticks.push({
      minute,
      left,
      major,
      label: major ? formatTimelineTime(minute).replace(":00", "") : "",
      labelAlign: minute === endMinute ? "before" : "after",
    });
  }
  return ticks;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function formatTimelineAdaptiveTimeRange(startMinute: number, endMinute: number, width: number): string {
  if (width >= 118) return formatTimelineTimeRange(startMinute, endMinute);
  const start = timelineTimeParts(startMinute);
  const end = timelineTimeParts(endMinute);
  const startClock = `${start.hour}:${String(start.minute).padStart(2, "0")}`;
  const endClock = `${end.hour}:${String(end.minute).padStart(2, "0")}`;
  if (width >= 76) return start.suffix === end.suffix ? `${startClock}-${endClock} ${end.suffix}` : `${startClock}${start.suffix}-${endClock}${end.suffix}`;
  if (width >= 44) return `${startClock}-${endClock}`;
  return `${start.hour}-${end.hour}`;
}

function timelineTimeParts(minute: number): { hour: number; minute: number; suffix: "AM" | "PM" } {
  const clean = Math.max(0, Math.min(23 * 60 + 45, Math.round(minute)));
  const hours24 = Math.floor(clean / 60);
  return {
    hour: hours24 % 12 || 12,
    minute: clean % 60,
    suffix: hours24 >= 12 ? "PM" : "AM",
  };
}

function timelineKindAccent(kind: AppTimelineEntityKind): string {
  return kind === "logic_gate" ? TIMELINE_LOGIC_GATE_ACCENT : TIMELINE_NODE_ACCENT;
}

function timelineKindFrame(kind: AppTimelineEntityKind): string {
  return kind === "logic_gate"
    ? `linear-gradient(180deg, ${TIMELINE_LOGIC_GATE_ACCENT_TOP} 0%, ${TIMELINE_LOGIC_GATE_ACCENT} 58%, ${TIMELINE_LOGIC_GATE_ACCENT_BOTTOM} 100%)`
    : `linear-gradient(180deg, ${TIMELINE_NODE_ACCENT_TOP} 0%, ${TIMELINE_NODE_ACCENT} 100%)`;
}

function rgbaFromTimelineAccent(hex: string, alpha: number): string {
  const clean = hex.trim().replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(clean)) return `rgba(25,168,255,${alpha})`;
  const value = Number.parseInt(clean, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red},${green},${blue},${alpha})`;
}

function timelineShellStyle(expanded: boolean): React.CSSProperties {
  return {
    width: "100%",
    height: "100%",
    minWidth: 0,
    minHeight: 0,
    display: "grid",
    gridTemplateRows: expanded ? "44px minmax(0, 1fr)" : "minmax(0, 1fr)",
    gap: expanded ? 8 : 0,
    color: "#0f172a",
    fontFamily: "var(--mango-font-family)",
    overflow: "hidden",
  };
}

const timelineHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  minWidth: 0,
  minHeight: 0,
  padding: "4px 8px 0 0",
  boxSizing: "border-box",
};

const timelineTitleStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minWidth: 0,
  fontSize: 12,
  fontWeight: 800,
  lineHeight: 1.2,
};

const timelineMetaStyle: React.CSSProperties = {
  color: "#64748b",
  fontSize: 11,
  fontWeight: 700,
};

const timelineControlGroupStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(114px, auto))",
  alignItems: "center",
  justifyContent: "end",
  gap: 7,
  minWidth: 0,
  padding: 4,
  border: "1px solid transparent",
  borderRadius: 13,
  background: `${TIMELINE_SURFACE} padding-box, ${TIMELINE_EDGE_FRAME} border-box`,
  boxShadow: "3px 3px 10px rgba(174, 174, 192, 0.18), -3px -3px 10px rgba(255, 255, 255, 0.86)",
};

const timeFieldStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr)",
  alignItems: "center",
  gap: 6,
  color: "#475569",
  fontSize: 10,
  fontWeight: 750,
  minWidth: 0,
  minHeight: 30,
  padding: "3px 5px 3px 8px",
  border: "1px solid rgba(255, 255, 255, 0.74)",
  borderRadius: 10,
  background: "linear-gradient(145deg, rgba(255,255,255,0.92), rgba(248,250,252,0.72))",
  boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.86), 2px 2px 8px rgba(174,174,192,0.12)",
};

const timeInputStyle: React.CSSProperties = {
  width: 94,
  height: 24,
  border: "1px solid rgba(100, 116, 139, 0.18)",
  borderRadius: 8,
  background: "linear-gradient(145deg, rgba(255,255,255,0.98), rgba(247,249,252,0.86))",
  color: "#0f172a",
  font: "inherit",
  fontSize: 12,
  fontWeight: 750,
  padding: "0 6px",
  letterSpacing: 0,
  outline: "none",
  textAlign: "center",
  boxShadow: "inset 2px 2px 6px rgba(174,174,192,0.14), inset -2px -2px 6px rgba(255,255,255,0.86)",
};

function timelineDaysScrollerStyle(expanded: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    minHeight: 0,
    height: "100%",
    maxHeight: "100%",
    display: "grid",
    alignContent: expanded ? "start" : "stretch",
    gap: expanded ? 10 : 0,
    overflowX: "hidden",
    overflowY: expanded ? "auto" : "hidden",
    overscrollBehavior: "contain",
    padding: expanded ? "2px 6px 8px 2px" : 0,
    boxSizing: "border-box",
    scrollbarWidth: "thin",
    ["--mango-home-scroll-accent" as string]: "rgb(71, 85, 105)",
    ["--mango-home-scroll-track" as string]: "rgba(100, 116, 139, 0.08)",
  };
}

function timelineDayPanelStyle(expanded: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    minHeight: 0,
    height: expanded ? undefined : "100%",
    display: "grid",
    gridTemplateRows: expanded ? undefined : "minmax(0, 1fr)",
    gap: expanded ? 6 : 0,
    padding: expanded ? 7 : 0,
    border: expanded ? "1px solid rgba(255, 255, 255, 0.76)" : "none",
    borderRadius: expanded ? 13 : 0,
    background: expanded ? "linear-gradient(145deg, rgba(255,255,255,0.82), rgba(246,247,251,0.56))" : "transparent",
    boxShadow: expanded ? "inset 1px 1px 0 rgba(255,255,255,0.74), 3px 3px 10px rgba(174,174,192,0.12)" : "none",
    boxSizing: "border-box",
  };
}

const timelineDayTitleStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  color: "#475569",
  fontSize: 10.5,
  fontWeight: 750,
  letterSpacing: 0,
};

function timelineScrollerStyle(active: boolean, compact: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    minHeight: 0,
    height: compact ? "100%" : EXPANDED_TRACK_HEIGHT,
    overflowX: "hidden",
    overflowY: "hidden",
    border: compact ? 0 : "1px solid transparent",
    borderRadius: compact ? "0 17px 17px 0" : 10,
    background: compact ? "linear-gradient(145deg, rgba(255,255,255,0.96), rgba(246,247,251,0.78))" : `${active ? TIMELINE_ACTIVE_SURFACE : TIMELINE_SURFACE} padding-box, ${TIMELINE_EDGE_FRAME} border-box`,
    boxShadow: active ? `0 0 0 2px rgba(25, 168, 255, 0.16) inset, ${TIMELINE_PANEL_SHADOW}` : TIMELINE_PANEL_SHADOW,
    scrollbarWidth: "none",
  };
}

function timelineContentStyle(width: number, compact: boolean): React.CSSProperties {
  return {
    position: "relative",
    width,
    minWidth: width,
    height: compact ? "100%" : EXPANDED_TRACK_HEIGHT - 2,
  };
}

function timelineTickStyle(left: number, major: boolean, compact: boolean): React.CSSProperties {
  const laneTop = compact ? COMPACT_HEADER_HEIGHT : EXPANDED_LANE_TOP;
  const majorHeaderRise = COMPACT_HEADER_HEIGHT / 2;
  return {
    position: "absolute",
    left,
    top: major ? Math.max(0, laneTop - majorHeaderRise) : laneTop,
    bottom: 0,
    width: 1,
    background: major ? "rgba(15, 23, 42, 0.18)" : "rgba(15, 23, 42, 0.08)",
    transform: "translateX(-0.5px)",
  };
}

function timelineTickLabelStyle(left: number, align: TimelineTick["labelAlign"]): React.CSSProperties {
  return {
    position: "absolute",
    top: 5,
    left: align === "before" ? Math.max(0, left - 5) : left + 5,
    transform: align === "before" ? "translateX(-100%)" : "none",
    color: "#64748b",
    fontSize: 10,
    fontWeight: 800,
    lineHeight: "12px",
    whiteSpace: "nowrap",
    pointerEvents: "none",
  };
}

function timelineLaneStyle(compact: boolean): React.CSSProperties {
  return {
    position: "absolute",
    left: 0,
    right: 0,
    top: compact ? COMPACT_HEADER_HEIGHT : EXPANDED_LANE_TOP,
    bottom: 0,
    height: undefined,
    borderTop: "1px solid rgba(100, 116, 139, 0.16)",
    borderBottom: "1px solid rgba(100, 116, 139, 0.12)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.92), rgba(248,250,252,0.74))",
  };
}

function timelineItemStyle(
  kind: AppTimelineEntityKind,
  selected: boolean,
  completed: boolean,
  left: number,
  width: number,
  _compact: boolean,
  readOnly: boolean,
): React.CSSProperties {
  const accent = timelineKindAccent(kind);
  const selectionShadow = kind === "logic_gate" ? "rgba(25, 240, 122, 0.32)" : "rgba(25, 168, 255, 0.32)";
  const itemFrame = timelineKindFrame(kind);
  const itemShadow = selected
    ? `0 0 0 1px ${selectionShadow}, 0 0 13px ${selectionShadow}, inset 1px 1px 0 rgba(255,255,255,0.92)`
    : `4px 4px 11px rgba(174, 174, 192, 0.16), -3px -3px 10px rgba(255, 255, 255, 0.78), 0 6px 14px ${rgbaFromTimelineAccent(accent, 0.10)}, inset 1px 1px 0 rgba(255,255,255,0.92)`;
  return {
    position: "absolute",
    left,
    top: 0,
    width,
    height: "100%",
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    border: `${TIMELINE_ITEM_BORDER_WIDTH}px solid transparent`,
    borderRadius: 8,
    background: `#ffffff padding-box, ${itemFrame} border-box`,
    color: "#0f172a",
    boxShadow: itemShadow,
    cursor: readOnly ? "default" : "grab",
    overflow: "hidden",
    userSelect: "none",
    touchAction: "none",
    opacity: completed ? 0.92 : 1,
  };
}

function timelineItemHandleStyle(side: "left" | "right", kind: AppTimelineEntityKind, _completed: boolean): React.CSSProperties {
  const accent = timelineKindAccent(kind);
  const handleFrame = kind === "logic_gate"
    ? `linear-gradient(180deg, ${TIMELINE_LOGIC_GATE_ACCENT_TOP}, ${TIMELINE_LOGIC_GATE_ACCENT}, ${TIMELINE_LOGIC_GATE_ACCENT_BOTTOM})`
    : `linear-gradient(180deg, ${TIMELINE_NODE_ACCENT_TOP}, ${TIMELINE_NODE_ACCENT})`;
  return {
    position: "absolute",
    top: 0,
    bottom: 0,
    [side]: 0,
    zIndex: 2,
    width: TIMELINE_ITEM_EDGE_WIDTH,
    cursor: "ew-resize",
    background: handleFrame,
    borderRadius: side === "left" ? "8px 0 0 8px" : "0 8px 8px 0",
    boxShadow: `0 0 10px ${rgbaFromTimelineAccent(accent, 0.22)}`,
  };
}

function timelineItemMainStyle(_compact: boolean, width: number): React.CSSProperties {
  const { left, right } = timelineItemContentInsets(width);
  return {
    minWidth: 0,
    position: "relative",
    display: "block",
    width: "100%",
    height: "100%",
    padding: `2px ${right}px 3px ${left}px`,
    boxSizing: "border-box",
  };
}

function timelineItemTopRowStyle(width: number): React.CSSProperties {
  return {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: width >= 70 ? 5 : 3,
  };
}

function timelineItemIconStyle(width: number): React.CSSProperties {
  const size = width >= 74 ? 22 : width >= 46 ? 16 : 0;
  return {
    display: size > 0 ? "grid" : "none",
    width: size,
    height: size,
    placeItems: "center",
    flex: "0 0 auto",
  };
}

function timelineItemTextStyle(width: number, completed: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: width >= 74 ? 12 : width >= 46 ? 10.5 : 9,
    fontWeight: 900,
    lineHeight: width >= 56 ? "22px" : "18px",
    textDecoration: completed ? "line-through" : "none",
    color: completed ? "#334155" : "#0f172a",
  };
}

function timelineItemBottomRowStyle(width: number, completed: boolean): React.CSSProperties {
  const { left, right } = timelineItemContentInsets(width);
  return {
    position: "absolute",
    left,
    right,
    bottom: width >= 46 ? 4 : 3,
    minWidth: 0,
    display: "block",
    color: completed ? "#334155" : "#475569",
    fontSize: width >= 74 ? 9.5 : width >= 46 ? 8.5 : 7.5,
    fontWeight: 900,
    lineHeight: width >= 46 ? "11px" : "10px",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
}

function timelineItemContentInsets(width: number): { left: number; right: number } {
  return {
    left: TIMELINE_ITEM_EDGE_WIDTH + (width >= 56 ? 5 : 3),
    right: width >= 82 ? TIMELINE_ITEM_CHECKBOX_WIDTH - 2 : width >= 54 ? 12 : 3,
  };
}

function timelineCheckboxWrapStyle(compact: boolean, width: number): React.CSSProperties {
  const visible = !compact || width >= 42;
  const small = width < 66;
  return {
    position: "absolute",
    right: TIMELINE_ITEM_EDGE_WIDTH + 3,
    top: "50%",
    transform: `translateY(-50%) scale(${small ? 0.82 : 1})`,
    transformOrigin: "center",
    zIndex: 3,
    display: visible ? "grid" : "none",
    placeItems: "center",
    minWidth: 0,
    width: TIMELINE_ITEM_CHECKBOX_WIDTH,
    height: TIMELINE_ITEM_CHECKBOX_WIDTH,
    boxSizing: "border-box",
    cursor: "pointer",
  };
}

const timelineCheckboxStyle: React.CSSProperties = {
  width: 15,
  height: 15,
  margin: 0,
  accentColor: "#19a8ff",
  cursor: "pointer",
};

function timelineHistoryCheckStyle(completed: boolean): React.CSSProperties {
  return {
    position: "absolute",
    right: 5,
    top: "50%",
    transform: "translateY(-50%)",
    display: "grid",
    placeItems: "center",
    color: completed ? "#475569" : "transparent",
    fontSize: 14,
    fontWeight: 900,
  };
}

const timelineMenuButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  width: "100%",
  padding: "9px 14px",
  border: "none",
  background: "transparent",
  color: "#334155",
  cursor: "pointer",
  fontFamily: "var(--mango-font-family)",
  fontSize: 12,
  fontWeight: 800,
  textAlign: "left",
};
