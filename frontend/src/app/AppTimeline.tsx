import React, { useEffect, useMemo, useRef, useState } from "react";
import { ExplorerRowIcon } from "../modules/company-explorer/CompanyExplorerIcons";
import { EXPLORER_DRAG_MIME, readExplorerDragPayload } from "../modules/company-explorer/companyExplorerDragDrop";
import { getExplorerDropPayloadItems } from "../modules/company-explorer/treePresentation";
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
  ticks: Array<{ minute: number; left: number; major: boolean; label: string }>;
};

const MIN_TIMELINE_CONTENT_WIDTH = 460;
const PIXELS_PER_QUARTER_HOUR = 31;
const COMPACT_TRACK_HEIGHT = 76;
const EXPANDED_TRACK_HEIGHT = 108;

export const AppTimeline: React.FC<AppTimelineProps> = ({
  state,
  expanded,
  onChange,
  onOpenEntity,
}) => {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<TimelineInteraction | null>(null);
  const stateRef = useRef(state);
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
  const metrics = useTimelineMetrics(state, compact);

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
            className="mango-home-scroll"
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
              <TimelineTicks ticks={metrics.ticks} />
              <div style={timelineLaneStyle(compact)}>
                {state.items.map((item) => {
                  const selected = selectedItemID === item.id;
                  const left = (item.startMinute - state.startMinute) * metrics.pxPerMinute;
                  const width = Math.max(compact ? 112 : 88, (item.endMinute - item.startMinute) * metrics.pxPerMinute - 2);
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
                        style={timelineItemHandleStyle("left")}
                        onPointerDown={(event) => startInteraction(event, item, "start")}
                      />
                      <TimelineItemMain item={item} compact={compact} />
                      <label
                        title={item.completed ? "Mark incomplete" : "Mark complete"}
                        aria-label={item.completed ? "Mark incomplete" : "Mark complete"}
                        style={timelineCheckboxWrapStyle}
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
                        style={timelineItemHandleStyle("right")}
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
          <TimelineHistoryDay key={day.date} day={day} onOpenEntity={onOpenEntity} />
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
            Delete timeline item
          </button>
        </FrameRightClickMenu>
      )}
    </section>
  );
};

function TimelineHistoryDay({
  day,
  onOpenEntity,
}: {
  day: AppTimelineDay;
  onOpenEntity: (target: { kind: AppTimelineEntityKind; id: string; label: string }) => void;
}) {
  const metrics = useTimelineMetrics(day, false);
  return (
    <div style={timelineDayPanelStyle(true)}>
      <div style={timelineDayTitleStyle}>
        <span>{formatTimelineDate(day.date)}</span>
        <span>{day.items.length} item{day.items.length === 1 ? "" : "s"}</span>
      </div>
      <div className="mango-home-scroll" style={timelineScrollerStyle(false, false)}>
        <div style={timelineContentStyle(metrics.contentWidth, false)}>
          <TimelineTicks ticks={metrics.ticks} />
          <div style={timelineLaneStyle(false)}>
            {day.items.map((item) => {
              const left = (item.startMinute - day.startMinute) * metrics.pxPerMinute;
              const width = Math.max(88, (item.endMinute - item.startMinute) * metrics.pxPerMinute - 2);
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
                  <TimelineItemMain item={item} compact={false} />
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

function TimelineItemMain({ item, compact }: { item: AppTimelineItem; compact: boolean }) {
  return (
    <span style={timelineItemMainStyle(compact)}>
      <span style={timelineItemTopRowStyle}>
        <span style={timelineItemIconStyle(compact)}><ExplorerRowIcon kind={item.kind === "node" ? "node" : "logic_gate"} /></span>
        <span style={timelineItemTextStyle(compact, item.completed)}>{item.label}</span>
      </span>
      <span style={timelineItemBottomRowStyle(compact, item.completed)}>
        {formatTimelineTimeRange(item.startMinute, item.endMinute)}
      </span>
    </span>
  );
}

function TimelineTicks({ ticks }: { ticks: TimelineMetrics["ticks"] }) {
  return (
    <>
      {ticks.map((tick) => (
        <div
          key={`${tick.minute}:${tick.left}`}
          style={timelineTickStyle(tick.left, tick.major)}
        >
          {tick.label && <span style={timelineTickLabelStyle}>{tick.label}</span>}
        </div>
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

function useTimelineMetrics(range: Pick<AppTimelineDay, "startMinute" | "endMinute">, compact: boolean): TimelineMetrics {
  const rangeMinutes = Math.max(APP_TIMELINE_STEP_MINUTES, range.endMinute - range.startMinute);
  const intervalCount = Math.max(1, rangeMinutes / APP_TIMELINE_STEP_MINUTES);
  const contentWidth = Math.max(compact ? MIN_TIMELINE_CONTENT_WIDTH : 680, intervalCount * PIXELS_PER_QUARTER_HOUR);
  const pxPerMinute = contentWidth / rangeMinutes;
  const ticks = useMemo(() => buildTimelineTicks(range.startMinute, range.endMinute, contentWidth), [contentWidth, range.endMinute, range.startMinute]);
  return { rangeMinutes, contentWidth, pxPerMinute, ticks };
}

function hasExplorerTimelineDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(EXPLORER_DRAG_MIME);
}

function timelineDropsFromDataTransfer(dataTransfer: DataTransfer): AppTimelineDropInput[] {
  const payload = readExplorerDragPayload(dataTransfer);
  if (!payload) return [];
  const droppedText = dataTransfer.getData("text/plain").trim();

  if (payload.kind === "node" && payload.itemID) {
    return [{ kind: "node", entityID: payload.itemID, label: droppedText || payload.itemID }];
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
    label: singleLabel || (item.itemType === "node" ? "Node" : "Logic Gate"),
  }));
}

function buildTimelineTicks(startMinute: number, endMinute: number, contentWidth: number): Array<{ minute: number; left: number; major: boolean; label: string }> {
  const range = Math.max(APP_TIMELINE_STEP_MINUTES, endMinute - startMinute);
  const ticks: Array<{ minute: number; left: number; major: boolean; label: string }> = [];
  for (let minute = startMinute; minute <= endMinute; minute += APP_TIMELINE_STEP_MINUTES) {
    const left = ((minute - startMinute) / range) * contentWidth;
    const major = minute === startMinute || minute === endMinute || minute % 60 === 0;
    ticks.push({
      minute,
      left,
      major,
      label: major ? formatTimelineTime(minute).replace(":00", "") : "",
    });
  }
  return ticks;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function timelineShellStyle(expanded: boolean): React.CSSProperties {
  return {
    width: "100%",
    height: "100%",
    minWidth: 0,
    display: "grid",
    gridTemplateRows: expanded ? "34px minmax(0, 1fr)" : "minmax(0, 1fr)",
    gap: expanded ? 8 : 0,
    color: "#0f172a",
    fontFamily: "var(--mango-font-family)",
  };
}

const timelineHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  minWidth: 0,
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
  display: "flex",
  alignItems: "center",
  justifyContent: "end",
  gap: 8,
  minWidth: 0,
  flexWrap: "wrap",
};

const timeFieldStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  color: "#475569",
  fontSize: 11,
  fontWeight: 800,
};

const timeInputStyle: React.CSSProperties = {
  width: 92,
  height: 27,
  border: "1px solid rgba(100, 116, 139, 0.32)",
  borderRadius: 6,
  background: "#ffffff",
  color: "#0f172a",
  font: "inherit",
  fontSize: 12,
  fontWeight: 800,
  padding: "0 6px",
  letterSpacing: 0,
  outline: "none",
};

function timelineDaysScrollerStyle(expanded: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    minHeight: 0,
    height: "100%",
    display: "grid",
    alignContent: "start",
    gap: expanded ? 10 : 0,
    overflowX: "hidden",
    overflowY: expanded ? "auto" : "hidden",
    paddingRight: expanded ? 3 : 0,
    boxSizing: "border-box",
    scrollbarWidth: "thin",
  };
}

function timelineDayPanelStyle(expanded: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    display: "grid",
    gap: expanded ? 6 : 0,
  };
}

const timelineDayTitleStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  color: "#475569",
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: 0,
};

function timelineScrollerStyle(active: boolean, compact: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    height: compact ? COMPACT_TRACK_HEIGHT : EXPANDED_TRACK_HEIGHT,
    overflowX: "auto",
    overflowY: "hidden",
    border: `1px solid ${active ? "rgba(20, 184, 166, 0.58)" : "rgba(100, 116, 139, 0.22)"}`,
    borderRadius: 8,
    background: active ? "linear-gradient(180deg, #ecfeff 0%, #ffffff 100%)" : "linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)",
    boxShadow: active ? "0 0 0 2px rgba(20, 184, 166, 0.13) inset" : "inset 0 1px 0 rgba(255, 255, 255, 0.82)",
    scrollbarWidth: "thin",
  };
}

function timelineContentStyle(width: number, compact: boolean): React.CSSProperties {
  return {
    position: "relative",
    width,
    minWidth: width,
    height: (compact ? COMPACT_TRACK_HEIGHT : EXPANDED_TRACK_HEIGHT) - 2,
  };
}

function timelineTickStyle(left: number, major: boolean): React.CSSProperties {
  return {
    position: "absolute",
    left,
    top: 0,
    bottom: 0,
    width: 1,
    background: major ? "rgba(15, 23, 42, 0.18)" : "rgba(15, 23, 42, 0.08)",
    transform: "translateX(-0.5px)",
  };
}

const timelineTickLabelStyle: React.CSSProperties = {
  position: "absolute",
  top: 5,
  left: 5,
  color: "#64748b",
  fontSize: 10,
  fontWeight: 800,
  whiteSpace: "nowrap",
  pointerEvents: "none",
};

function timelineLaneStyle(compact: boolean): React.CSSProperties {
  return {
    position: "absolute",
    left: 0,
    right: 0,
    top: compact ? 23 : 37,
    height: compact ? 46 : 56,
    borderTop: "1px solid rgba(100, 116, 139, 0.18)",
    borderBottom: "1px solid rgba(100, 116, 139, 0.14)",
    background: "rgba(226, 232, 240, 0.24)",
  };
}

function timelineItemStyle(
  kind: AppTimelineEntityKind,
  selected: boolean,
  completed: boolean,
  left: number,
  width: number,
  compact: boolean,
  readOnly: boolean,
): React.CSSProperties {
  const accent = completed ? "#16a34a" : kind === "logic_gate" ? "#0f9f68" : "#2563eb";
  const nodeBackground = completed
    ? "linear-gradient(180deg, #f0fdf4 0%, #dcfce7 100%)"
    : kind === "logic_gate"
      ? "linear-gradient(180deg, #f0fdf4 0%, #dcfce7 100%)"
      : "linear-gradient(180deg, #eff6ff 0%, #dbeafe 100%)";
  return {
    position: "absolute",
    left,
    top: compact ? 4 : 5,
    width,
    height: compact ? 38 : 46,
    minWidth: compact ? 112 : 88,
    display: "grid",
    gridTemplateColumns: readOnly ? "minmax(0, 1fr) 24px" : "7px minmax(0, 1fr) 24px 7px",
    border: `1px solid ${selected || completed ? accent : "rgba(100, 116, 139, 0.28)"}`,
    borderRadius: 7,
    background: nodeBackground,
    color: "#0f172a",
    boxShadow: completed
      ? "0 6px 14px rgba(22, 163, 74, 0.22), inset 0 0 0 1px rgba(22, 163, 74, 0.18)"
      : selected
        ? `0 0 0 2px ${kind === "logic_gate" ? "rgba(15, 159, 104, 0.16)" : "rgba(37, 99, 235, 0.16)"}`
        : "0 4px 10px rgba(15, 23, 42, 0.10)",
    cursor: readOnly ? "default" : "grab",
    overflow: "hidden",
    userSelect: "none",
    touchAction: "none",
    opacity: completed ? 0.92 : 1,
  };
}

function timelineItemHandleStyle(side: "left" | "right"): React.CSSProperties {
  return {
    width: 7,
    height: "100%",
    cursor: "ew-resize",
    background: side === "left"
      ? "linear-gradient(90deg, rgba(15, 23, 42, 0.15), transparent)"
      : "linear-gradient(270deg, rgba(15, 23, 42, 0.15), transparent)",
  };
}

function timelineItemMainStyle(compact: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    display: "grid",
    gridTemplateRows: compact ? "minmax(0, 1fr) 10px" : "minmax(0, 1fr) 14px",
    gap: 1,
    padding: compact ? "4px 3px 3px" : "5px 4px 3px",
    boxSizing: "border-box",
  };
}

const timelineItemTopRowStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 4,
};

function timelineItemIconStyle(compact: boolean): React.CSSProperties {
  return {
    width: compact ? 15 : 17,
    height: compact ? 15 : 17,
    display: "grid",
    placeItems: "center",
    flex: "0 0 auto",
  };
}

function timelineItemTextStyle(compact: boolean, completed: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: compact ? 9 : 11,
    fontWeight: 900,
    textDecoration: completed ? "line-through" : "none",
    color: completed ? "#166534" : "#0f172a",
  };
}

function timelineItemBottomRowStyle(compact: boolean, completed: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    display: "block",
    color: completed ? "#166534" : "#475569",
    fontSize: compact ? 8 : 9,
    fontWeight: 900,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
}

const timelineCheckboxWrapStyle: React.CSSProperties = {
  display: "grid",
  placeItems: "center",
  minWidth: 0,
  cursor: "pointer",
};

const timelineCheckboxStyle: React.CSSProperties = {
  width: 15,
  height: 15,
  margin: 0,
  accentColor: "#16a34a",
  cursor: "pointer",
};

function timelineHistoryCheckStyle(completed: boolean): React.CSSProperties {
  return {
    display: "grid",
    placeItems: "center",
    color: completed ? "#16a34a" : "transparent",
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
  color: "#c62828",
  cursor: "pointer",
  fontFamily: "var(--mango-font-family)",
  fontSize: 12,
  fontWeight: 800,
  textAlign: "left",
};
