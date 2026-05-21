import React, { useEffect, useMemo, useRef, useState } from "react";
import { ExplorerRowIcon } from "../modules/company-explorer/CompanyExplorerIcons";
import { EXPLORER_DRAG_MIME, readExplorerDragPayload } from "../modules/company-explorer/companyExplorerDragDrop";
import { getExplorerDropPayloadItems } from "../modules/company-explorer/treePresentation";
import FrameRightClickMenu from "./framerightclickmenu";
import { APP_TAB_BAR_HEIGHT } from "./AppTabBar";
import {
  APP_TIMELINE_STEP_MINUTES,
  alignTimelineMinute,
  clampTimelineEnd,
  clampTimelineStart,
  deleteTimelineItem,
  formatTimelineTime,
  setTimelineRange,
  shortTimelineLabel,
  timeInputFromTimelineMinute,
  timelineMinuteFromTimeInput,
  updateTimelineItemTiming,
  upsertTimelineDropsAt,
  type AppTimelineDropInput,
  type AppTimelineEntityKind,
  type AppTimelineItem,
  type AppTimelineState,
} from "./timelineState";

type AppTimelineProps = {
  state: AppTimelineState;
  leftInset: number;
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

const APP_TIMELINE_HEIGHT = 158;
const APP_TIMELINE_TRACK_HEIGHT = 104;
const MIN_TIMELINE_CONTENT_WIDTH = 760;
const PIXELS_PER_QUARTER_HOUR = 42;

export const AppTimeline: React.FC<AppTimelineProps> = ({
  state,
  leftInset,
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

  const rangeMinutes = Math.max(APP_TIMELINE_STEP_MINUTES, state.endMinute - state.startMinute);
  const intervalCount = Math.max(1, rangeMinutes / APP_TIMELINE_STEP_MINUTES);
  const contentWidth = Math.max(MIN_TIMELINE_CONTENT_WIDTH, intervalCount * PIXELS_PER_QUARTER_HOUR);
  const pxPerMinute = contentWidth / rangeMinutes;
  const ticks = useMemo(() => buildTimelineTicks(state.startMinute, state.endMinute, contentWidth), [contentWidth, state.endMinute, state.startMinute]);

  const dropMinuteFromEvent = (event: React.DragEvent<HTMLElement>): number => {
    const content = contentRef.current;
    if (!content) return state.startMinute;
    const bounds = content.getBoundingClientRect();
    const x = Math.max(0, Math.min(contentWidth, event.clientX - bounds.left));
    return clampTimelineStart(state.startMinute + (x / contentWidth) * rangeMinutes, state);
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
      pxPerMinute,
      ownerDocument,
      previousCursor: ownerDocument.body.style.cursor,
      previousUserSelect: ownerDocument.body.style.userSelect,
    };
    ownerDocument.body.style.cursor = mode === "move" ? "grabbing" : "ew-resize";
    ownerDocument.body.style.userSelect = "none";
  };

  return (
    <section
      aria-label="Day timeline"
      style={timelineShellStyle(leftInset)}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) setSelectedItemID("");
      }}
    >
      <div style={timelineHeaderStyle}>
        <div style={timelineTitleStyle}>
          <span style={timelineTitleDotStyle} />
          <span>Day timeline</span>
          <span style={timelineMetaStyle}>{state.items.length} item{state.items.length === 1 ? "" : "s"}</span>
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

      <div
        className="mango-home-scroll"
        style={timelineScrollerStyle(dropActive)}
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
        <div ref={contentRef} style={timelineContentStyle(contentWidth)}>
          {ticks.map((tick) => (
            <div
              key={`${tick.minute}:${tick.left}`}
              style={timelineTickStyle(tick.left, tick.major)}
            >
              {tick.label && <span style={timelineTickLabelStyle}>{tick.label}</span>}
            </div>
          ))}
          <div style={timelineLaneStyle}>
            {state.items.map((item) => {
              const selected = selectedItemID === item.id;
              const left = (item.startMinute - state.startMinute) * pxPerMinute;
              const width = Math.max(34, (item.endMinute - item.startMinute) * pxPerMinute - 2);
              return (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  title={`${item.label}: ${formatTimelineTime(item.startMinute)} - ${formatTimelineTime(item.endMinute)}`}
                  aria-label={`${item.label}, ${formatTimelineTime(item.startMinute)} to ${formatTimelineTime(item.endMinute)}`}
                  aria-pressed={selected}
                  style={timelineItemStyle(item.kind, selected, left, width)}
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
                  <span style={timelineItemMainStyle}>
                    <span style={timelineItemTopRowStyle}>
                      <span style={timelineItemIconStyle}><ExplorerRowIcon kind={item.kind === "node" ? "node" : "logic_gate"} /></span>
                      <span style={timelineItemTextStyle}>{item.label}</span>
                    </span>
                    <span style={timelineItemBottomRowStyle}>
                      <span>{shortTimelineLabel(item.label)}</span>
                      <span>{formatTimelineTime(item.startMinute)}</span>
                    </span>
                  </span>
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

function timelineShellStyle(leftInset: number): React.CSSProperties {
  return {
    position: "fixed",
    left: leftInset + 12,
    right: 18,
    bottom: APP_TAB_BAR_HEIGHT + 18,
    height: APP_TIMELINE_HEIGHT,
    display: "grid",
    gridTemplateRows: "42px minmax(0, 1fr)",
    minWidth: 0,
    padding: "9px 10px 10px",
    boxSizing: "border-box",
    border: "1px solid rgba(36, 18, 10, 0.12)",
    borderRadius: 8,
    background: "rgba(255, 255, 255, 0.96)",
    boxShadow: "0 12px 28px rgba(36, 18, 10, 0.18), inset 0 0 0 1px rgba(255, 255, 255, 0.72)",
    zIndex: 112,
    pointerEvents: "auto",
    color: "#24120a",
    fontFamily: "var(--mango-font-family)",
  };
}

const timelineHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "start",
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

const timelineTitleDotStyle: React.CSSProperties = {
  width: 9,
  height: 9,
  borderRadius: 999,
  background: "#ff8820",
  boxShadow: "0 0 0 4px rgba(255, 136, 32, 0.14)",
  flex: "0 0 auto",
};

const timelineMetaStyle: React.CSSProperties = {
  color: "rgba(36, 18, 10, 0.58)",
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
  color: "rgba(36, 18, 10, 0.68)",
  fontSize: 11,
  fontWeight: 800,
};

const timeInputStyle: React.CSSProperties = {
  width: 92,
  height: 27,
  border: "1px solid rgba(255, 136, 32, 0.28)",
  borderRadius: 6,
  background: "#fffaf4",
  color: "#24120a",
  font: "inherit",
  fontSize: 12,
  fontWeight: 800,
  padding: "0 6px",
  letterSpacing: 0,
  outline: "none",
};

function timelineScrollerStyle(active: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    height: APP_TIMELINE_TRACK_HEIGHT,
    overflowX: "auto",
    overflowY: "hidden",
    border: `1px solid ${active ? "rgba(0, 174, 190, 0.48)" : "rgba(36, 18, 10, 0.11)"}`,
    borderRadius: 7,
    background: active ? "linear-gradient(180deg, #f2feff 0%, #ffffff 100%)" : "linear-gradient(180deg, #fffdf9 0%, #ffffff 100%)",
    boxShadow: active ? "0 0 0 2px rgba(0, 174, 190, 0.13) inset" : "inset 0 1px 0 rgba(255, 255, 255, 0.82)",
    scrollbarWidth: "thin",
  };
}

function timelineContentStyle(width: number): React.CSSProperties {
  return {
    position: "relative",
    width,
    minWidth: width,
    height: APP_TIMELINE_TRACK_HEIGHT - 2,
  };
}

function timelineTickStyle(left: number, major: boolean): React.CSSProperties {
  return {
    position: "absolute",
    left,
    top: 0,
    bottom: 0,
    width: 1,
    background: major ? "rgba(36, 18, 10, 0.22)" : "rgba(36, 18, 10, 0.10)",
    transform: "translateX(-0.5px)",
  };
}

const timelineTickLabelStyle: React.CSSProperties = {
  position: "absolute",
  top: 5,
  left: 5,
  color: "rgba(36, 18, 10, 0.58)",
  fontSize: 10,
  fontWeight: 800,
  whiteSpace: "nowrap",
  pointerEvents: "none",
};

const timelineLaneStyle: React.CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  top: 37,
  height: 56,
  borderTop: "1px solid rgba(255, 136, 32, 0.22)",
  borderBottom: "1px solid rgba(255, 136, 32, 0.16)",
  background: "rgba(255, 136, 32, 0.045)",
};

function timelineItemStyle(kind: AppTimelineEntityKind, selected: boolean, left: number, width: number): React.CSSProperties {
  const accent = kind === "logic_gate" ? "#0c8f47" : "#ff8820";
  return {
    position: "absolute",
    left,
    top: 5,
    width,
    height: 46,
    minWidth: 34,
    display: "grid",
    gridTemplateColumns: "7px minmax(0, 1fr) 7px",
    border: `1px solid ${selected ? accent : "rgba(36, 18, 10, 0.16)"}`,
    borderRadius: 7,
    background: kind === "logic_gate"
      ? "linear-gradient(180deg, #f0fff5 0%, #dff9e8 100%)"
      : "linear-gradient(180deg, #fff9f1 0%, #ffe0bc 100%)",
    color: "#24120a",
    boxShadow: selected ? `0 0 0 2px ${kind === "logic_gate" ? "rgba(12, 143, 71, 0.16)" : "rgba(255, 136, 32, 0.18)"}` : "0 4px 10px rgba(36, 18, 10, 0.12)",
    cursor: "grab",
    overflow: "hidden",
    userSelect: "none",
    touchAction: "none",
  };
}

function timelineItemHandleStyle(side: "left" | "right"): React.CSSProperties {
  return {
    width: 7,
    height: "100%",
    cursor: "ew-resize",
    background: side === "left"
      ? "linear-gradient(90deg, rgba(36, 18, 10, 0.18), transparent)"
      : "linear-gradient(270deg, rgba(36, 18, 10, 0.18), transparent)",
  };
}

const timelineItemMainStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gridTemplateRows: "minmax(0, 1fr) 14px",
  gap: 1,
  padding: "5px 4px 3px",
  boxSizing: "border-box",
};

const timelineItemTopRowStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 4,
};

const timelineItemIconStyle: React.CSSProperties = {
  width: 17,
  height: 17,
  display: "grid",
  placeItems: "center",
  flex: "0 0 auto",
};

const timelineItemTextStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 11,
  fontWeight: 900,
};

const timelineItemBottomRowStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 5,
  color: "rgba(36, 18, 10, 0.64)",
  fontSize: 9,
  fontWeight: 900,
  whiteSpace: "nowrap",
  overflow: "hidden",
};

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
