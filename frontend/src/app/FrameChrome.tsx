import React, { useEffect, useMemo, useRef, useState } from "react";
import Frame from "./frame";
import { MODULE_CONTENT_MAP as CONTENT_MAP } from "../modules";
import type { FrameDataModel, ResizeEdges } from "../types";
import { isFrameInteractiveTarget } from "./framePointerRouting";
import {
  COLORWAYS,
  CORNER_SIZE,
  CROSS_ARM,
  DEFAULT_COLORWAY,
  FRAME_SELECTION_COLOR,
  HANDLE,
  clamp,
  isFrameHeaderSectionPointer,
} from "./frameLayoutTypes";

// SVG grid marker renderer (plus intersections) for visual snapping guidance.
export const GridCrosses: React.FC<{ cols: number; rows: number; stepX: number; stepY: number; width: number; height: number; color: string }> = React.memo(
  ({ cols, rows, stepX, stepY, width, height, color }) => {
    const path = useMemo(() => {
      const a = CROSS_ARM;
      const parts: string[] = [];
      for (let r = 0; r <= rows; r++) {
        for (let c = 0; c <= cols; c++) {
          const x = c * stepX;
          const y = r * stepY;
          parts.push(`M${x} ${y - a}v${a * 2}M${x - a} ${y}h${a * 2}`);
        }
      }
      for (let r = 0; r <= rows; r++) parts.push(`M${width} ${r * stepY - a}v${a * 2}`);
      for (let c = 0; c <= cols; c++) parts.push(`M${c * stepX - a} ${height}h${a * 2}`);
      parts.push(`M${width - a} ${height}h${a * 2}M${width} ${height - a}v${a * 2}`);
      return parts.join("");
    }, [cols, rows, stepX, stepY, width, height]);

    return <svg style={{ position: "absolute", top: 0, left: 0, overflow: "visible", pointerEvents: "none" }} width={width} height={height}><path d={path} stroke={color} strokeWidth="0.55" fill="none" opacity="0.28" /></svg>;
  }
);

export const PlacementSplash: React.FC<{
  frame: FrameDataModel;
  frames: FrameDataModel[];
  cols: number;
  rows: number;
  stepX: number;
  stepY: number;
}> = React.memo(({ frame, frames, cols, rows, stepX, stepY }) => {
  const cells = useMemo(() => {
    let seed = frame.x * 73856093 + frame.y * 19349663;
    for (let i = 0; i < frame.id.length; i++) seed = (seed * 33 + frame.id.charCodeAt(i)) >>> 0;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const occupied = new Set<string>();
    for (const other of frames) {
      if (other.id === frame.id) continue;
      for (let y = other.y; y < other.y + other.h; y++) {
        for (let x = other.x; x < other.x + other.w; x++) {
          occupied.add(`${x},${y}`);
        }
      }
    }

    const sizeFactor = Math.min(1.5, Math.log2(Math.max(frame.w, frame.h) + 1) / 4);
    const edgeSpan = () => (rand() < 0.72 - sizeFactor * 0.08 ? 2 : 3);
    const armSpan = () => 1 + Math.floor(rand() * 3) + (rand() < 0.18 + sizeFactor * 0.08 ? 2 : 0);
    const radii = {
      left: edgeSpan(),
      right: edgeSpan(),
      top: edgeSpan(),
      bottom: edgeSpan(),
    };
    const left = clamp(frame.x - radii.left, 0, Math.max(0, cols - 1));
    const right = clamp(frame.x + frame.w - 1 + radii.right, 0, Math.max(0, cols - 1));
    const top = clamp(frame.y - radii.top, 0, Math.max(0, rows - 1));
    const bottom = clamp(frame.y + frame.h - 1 + radii.bottom, 0, Math.max(0, rows - 1));

    const result: { x: number; y: number; distance: number }[] = [];
    const seen = new Set<string>();
    const centerX = frame.x + frame.w / 2;
    const centerY = frame.y + frame.h / 2;
    const extraCells = new Set<string>();
    const addArm = (startX: number, startY: number, dx: number, dy: number, len: number) => {
      for (let i = 1; i <= len; i++) {
        const x = startX + dx * i;
        const y = startY + dy * i;
        if (x < 0 || y < 0 || x >= cols || y >= rows) break;
        extraCells.add(`${x},${y}`);
      }
    };

    addArm(frame.x + Math.floor(rand() * frame.w), top, 0, -1, armSpan());
    addArm(frame.x + Math.floor(rand() * frame.w), bottom, 0, 1, armSpan());
    addArm(left, frame.y + Math.floor(rand() * frame.h), -1, 0, armSpan());
    addArm(right, frame.y + Math.floor(rand() * frame.h), 1, 0, armSpan());

    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const insideFrame = x >= frame.x && x < frame.x + frame.w && y >= frame.y && y < frame.y + frame.h;
        const gapLeft = frame.x - (x + 1);
        const gapRight = x - (frame.x + frame.w) + 1;
        const gapTop = frame.y - (y + 1);
        const gapBottom = y - (frame.y + frame.h) + 1;
        const edgeDistance = Math.max(0, gapLeft, gapRight, gapTop, gapBottom);
        const coreThickness = Math.min(2.9, 1.75 + rand() * 0.7 + sizeFactor * 0.15);
        const withinCore = edgeDistance <= coreThickness;
        const splashNoise = rand() > 0.14;
        const inShape = withinCore && splashNoise;
        const isArm = extraCells.has(`${x},${y}`);
        if (insideFrame || occupied.has(`${x},${y}`) || (!inShape && !isArm)) continue;
        const dist = Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY);
        const key = `${x},${y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ x, y, distance: dist });
      }
    }

    for (const cell of extraCells) {
      const [xRaw, yRaw] = cell.split(",");
      const x = Number(xRaw);
      const y = Number(yRaw);
      if (occupied.has(cell)) continue;
      const insideFrame = x >= frame.x && x < frame.x + frame.w && y >= frame.y && y < frame.y + frame.h;
      if (insideFrame) continue;
      const dist = Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY);
      if (seen.has(cell)) continue;
      seen.add(cell);
      result.push({ x, y, distance: dist });
    }

    return result;
  }, [frame, frames, cols, rows]);

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 50 }}>
      {cells.map((cell) => {
        const opacity = clamp(0.34 - cell.distance * 0.03, 0.08, 0.34);
        return (
          <div
            key={`${cell.x}-${cell.y}`}
            style={{
              position: "absolute",
              left: cell.x * stepX + 1.5,
              top: cell.y * stepY + 1.5,
              width: Math.max(2, stepX - 3),
              height: Math.max(2, stepY - 3),
              border: "1px solid rgba(0, 188, 212, 0.72)",
              background: `rgba(0, 188, 212, ${opacity})`,
              boxShadow: "0 0 0 1px rgba(255,255,255,0.18) inset",
            }}
          />
        );
      })}
    </div>
  );
});

type HandleDef = { edges: ResizeEdges; cursor: string; style: React.CSSProperties };
const HANDLES: HandleDef[] = [
  { edges: { top: true, left: true }, cursor: "nwse-resize", style: { top: -HANDLE / 2, left: -HANDLE / 2, width: CORNER_SIZE, height: CORNER_SIZE, zIndex: 2 } },
  { edges: { top: true, right: true }, cursor: "nesw-resize", style: { top: -HANDLE / 2, right: -HANDLE / 2, width: CORNER_SIZE, height: CORNER_SIZE, zIndex: 2 } },
  { edges: { bottom: true, left: true }, cursor: "nesw-resize", style: { bottom: -HANDLE / 2, left: -HANDLE / 2, width: CORNER_SIZE, height: CORNER_SIZE, zIndex: 2 } },
  { edges: { bottom: true, right: true }, cursor: "nwse-resize", style: { bottom: -HANDLE / 2, right: -HANDLE / 2, width: CORNER_SIZE, height: CORNER_SIZE, zIndex: 2 } },
  { edges: { top: true }, cursor: "ns-resize", style: { top: -HANDLE / 2, left: CORNER_SIZE, right: CORNER_SIZE, height: HANDLE, zIndex: 1 } },
  { edges: { bottom: true }, cursor: "ns-resize", style: { bottom: -HANDLE / 2, left: CORNER_SIZE, right: CORNER_SIZE, height: HANDLE, zIndex: 1 } },
  { edges: { left: true }, cursor: "ew-resize", style: { left: -HANDLE / 2, top: CORNER_SIZE, bottom: CORNER_SIZE, width: HANDLE, zIndex: 1 } },
  { edges: { right: true }, cursor: "ew-resize", style: { right: -HANDLE / 2, top: CORNER_SIZE, bottom: CORNER_SIZE, width: HANDLE, zIndex: 1 } },
];

export interface FrameCardProps {
  frame: FrameDataModel;
  stepX: number;
  stepY: number;
  isChild?: boolean;
  nestedChildren?: React.ReactNode;
  isDragging: boolean;
  isSelected: boolean;
  editMode: boolean;
  onDragStart: (e: React.MouseEvent | React.TouchEvent, id: string) => void;
  onResizeStart: (e: React.MouseEvent | React.TouchEvent, id: string, edges: ResizeEdges) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  onModuleNameClick: (e: React.MouseEvent, id: string) => void;
  onSelect: (event: React.MouseEvent | React.TouchEvent, id: string) => void;
  isLinked: boolean;
  edgeHit?: { left: boolean; right: boolean; top: boolean; bottom: boolean };
}

export const FrameCard: React.FC<FrameCardProps> = ({ frame, stepX, stepY, isChild, nestedChildren, isDragging, isSelected, editMode, onDragStart, onResizeStart, onContextMenu, onModuleNameClick, onSelect, isLinked, edgeHit }) => {
  const Content = CONTENT_MAP[frame.kind];
  const theme = COLORWAYS[frame.theme ?? DEFAULT_COLORWAY];
  const isNodesFrame = frame.kind === "nodes" || frame.kind === "nodes-map" || frame.kind === "logic-map" || frame.kind === "editor" || frame.kind === "node-doc";
  const isEdgeToEdgeContentFrame = isNodesFrame || frame.kind === "company-explorer" || frame.kind === "kanban" || frame.kind === "home" || frame.kind === "communications";
  const left = frame.x * stepX;
  const top = frame.y * stepY;
  const nested = !!isChild;
  const shouldScaleContent = frame.w <= 7 || frame.h <= 7;
  const contentScale = shouldScaleContent ? clamp(Math.min((frame.w * stepX) / 320, (frame.h * stepY) / 220), 0.65, 1) : 1;
  const previousEdgeRef = useRef<{ left: boolean; right: boolean; top: boolean; bottom: boolean }>({ left: false, right: false, top: false, bottom: false });
  const timersRef = useRef<Partial<Record<"left" | "right" | "top" | "bottom", number>>>({});
  const suppressModuleHeaderClickRef = useRef(false);
  const suppressModuleHeaderClickTimerRef = useRef<number | null>(null);
  const [edgeBump, setEdgeBump] = useState<{ left: boolean; right: boolean; top: boolean; bottom: boolean }>({ left: false, right: false, top: false, bottom: false });

  useEffect(() => {
    if (nested || !edgeHit) return;
    const previous = previousEdgeRef.current;
    const sides: Array<"left" | "right" | "top" | "bottom"> = ["left", "right", "top", "bottom"];
    for (const side of sides) {
      if (!edgeHit[side] || previous[side]) continue;
      setEdgeBump((prev) => ({ ...prev, [side]: true }));
      if (timersRef.current[side]) window.clearTimeout(timersRef.current[side]);
      timersRef.current[side] = window.setTimeout(() => {
        setEdgeBump((prev) => ({ ...prev, [side]: false }));
      }, 220);
    }
    previousEdgeRef.current = { ...edgeHit };
  }, [nested, edgeHit]);

  useEffect(() => {
    return () => {
      for (const timer of Object.values(timersRef.current)) {
        if (timer) window.clearTimeout(timer);
      }
      if (suppressModuleHeaderClickTimerRef.current) window.clearTimeout(suppressModuleHeaderClickTimerRef.current);
    };
  }, []);

  const shouldIgnoreFramePointerTarget = (target: HTMLElement) => isFrameInteractiveTarget(target) || (!nested && !!target.closest('[data-child-frame="true"]'));
  const isResizeHandleTarget = (target: HTMLElement) => !!target.closest('[data-handle="true"]');
  const canStartHeaderSectionDrag = (event: React.MouseEvent | React.TouchEvent, target: HTMLElement, element: HTMLElement) => {
    if (shouldIgnoreFramePointerTarget(target) || isResizeHandleTarget(target)) return false;
    if (!isFrameHeaderSectionPointer(event, element)) return false;
    if (target.closest('[data-header-drag-handle="true"]')) return false;
    return true;
  };
  const suppressNextModuleHeaderClick = () => {
    suppressModuleHeaderClickRef.current = true;
    if (suppressModuleHeaderClickTimerRef.current) window.clearTimeout(suppressModuleHeaderClickTimerRef.current);
    suppressModuleHeaderClickTimerRef.current = window.setTimeout(() => {
      suppressModuleHeaderClickRef.current = false;
      suppressModuleHeaderClickTimerRef.current = null;
    }, 500);
  };
  const startHeaderSectionDragFromCapture = (event: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!canStartHeaderSectionDrag(event, target, event.currentTarget)) return;
    onDragStart(event, frame.id);
    suppressNextModuleHeaderClick();
    event.stopPropagation();
  };

  const edgeBumpBase = {
    position: "absolute",
    pointerEvents: "none",
    background: frame.accent,
    opacity: 0.7,
  } satisfies React.CSSProperties;

  return (
    <Frame
      data-child-frame={nested ? "true" : "false"}
      style={{
        position: "absolute",
        left,
        top,
        width: frame.w * stepX,
        height: frame.h * stepY,
        background: frame.color,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        cursor: isDragging ? "grabbing" : "default",
        userSelect: "none",
        zIndex: nested ? 200 : (isDragging ? 100 : 1),
        color: theme.text,
        boxShadow: isSelected
          ? `inset 0 0 0 1px ${FRAME_SELECTION_COLOR}, 0 0 0 2px ${FRAME_SELECTION_COLOR}, 0 8px 20px rgba(2,22,46,0.24)`
          : nested
            ? "0 3px 16px rgba(0,0,0,0.18)"
            : undefined,
        border: "none",
      }}
      onClickCapture={(e) => {
        if (!suppressModuleHeaderClickRef.current) return;
        suppressModuleHeaderClickRef.current = false;
        if (suppressModuleHeaderClickTimerRef.current) {
          window.clearTimeout(suppressModuleHeaderClickTimerRef.current);
          suppressModuleHeaderClickTimerRef.current = null;
        }
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
      onContextMenuCapture={(e) => {
        const target = e.target as HTMLElement;
        if (shouldIgnoreFramePointerTarget(target) || isResizeHandleTarget(target)) return;
        if (!isFrameHeaderSectionPointer(e, e.currentTarget)) return;
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e, frame.id);
      }}
      onMouseDownCapture={(e) => {
        const target = e.target as HTMLElement;
        if (shouldIgnoreFramePointerTarget(target)) return;
        if (e.button !== 0) return;
        onSelect(e, frame.id);
        startHeaderSectionDragFromCapture(e);
      }}
      onTouchStartCapture={(e) => {
        const target = e.target as HTMLElement;
        if (shouldIgnoreFramePointerTarget(target)) return;
        onSelect(e, frame.id);
        startHeaderSectionDragFromCapture(e);
      }}
      onMouseDown={(e) => {
        const target = e.target as HTMLElement;
        if (shouldIgnoreFramePointerTarget(target)) return;
        if (isResizeHandleTarget(target)) return;
        const isCompactHeaderHandle = !!target.closest('[data-header-drag-handle="true"]');
        if (!isCompactHeaderHandle && !isFrameHeaderSectionPointer(e, e.currentTarget)) return;
        onDragStart(e, frame.id);
      }}
      onTouchStart={(e) => {
        const target = e.target as HTMLElement;
        if (shouldIgnoreFramePointerTarget(target)) return;
        if (isResizeHandleTarget(target)) return;
        const isCompactHeaderHandle = !!target.closest('[data-header-drag-handle="true"]');
        if (!isCompactHeaderHandle && !isFrameHeaderSectionPointer(e, e.currentTarget)) return;
        onDragStart(e, frame.id);
      }}
    >
      <div
        data-header-drag-handle="true"
        onContextMenu={(e) => {
          const target = e.target as HTMLElement;
          if (!nested && target.closest('[data-child-frame="true"]')) return;
          e.preventDefault();
          e.stopPropagation();
          onContextMenu(e, frame.id);
        }}
        style={{
          position: "absolute",
          // Pin the compact header plate to frame edges so the tag looks flush (no dead corner gaps).
          top: 0,
          left: 0,
          zIndex: 5,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 8px",
          borderRight: "none",
          borderBottom: "none",
          background: frame.color,
          cursor: isDragging ? "grabbing" : "grab",
          fontFamily: "var(--mango-font-family)",
        }}
      >
          <span
            data-module-name-switcher="true"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onModuleNameClick(e, frame.id); }}
            style={{ fontSize: 12, fontWeight: 500, color: theme.tagText, textTransform: "none", letterSpacing: 0, background: theme.tagBg, padding: "3px 8px", cursor: "pointer", lineHeight: 1.1 }}
          >
            {frame.title}
          </span>
          {isLinked && (
            <svg aria-label="linked module" width="17" height="19" viewBox="0 0 17 19" style={{ display: "block" }}>
              <title>Linked</title>
              <polygon points="8.5,1.5 15.5,5.5 15.5,13.5 8.5,17.5 1.5,13.5 1.5,5.5" fill="none" stroke={frame.accent} strokeWidth="1.8" />
            </svg>
          )}
      </div>
      <div
        onContextMenu={(e) => e.stopPropagation()}
        style={{ flex: 1, minHeight: 0, padding: isEdgeToEdgeContentFrame ? 0 : "8px 10px", overflow: frame.kind === "company-explorer" || frame.kind === "kanban" || frame.kind === "home" || frame.kind === "communications" ? "hidden" : "auto", fontFamily: "var(--mango-font-family)" }}
      >
        <div style={{ width: `${100 / contentScale}%`, height: `${100 / contentScale}%`, transform: `scale(${contentScale})`, transformOrigin: "top left" }}>
          {Content ? <Content accent={frame.accent} widgetId={frame.id} hideTopControls={isNodesFrame} theme={frame.theme} /> : <div style={{ height: "100%", display: "grid", placeItems: "center", opacity: 0.3 }}><span style={{ fontSize: 13, color: frame.accent }}>{frame.title}</span></div>}
        </div>
      </div>
      {!nested && (
        <>
          {edgeBump.left && <div style={{ ...edgeBumpBase, left: 0, top: 0, bottom: 0, width: 10, animation: "frame-edge-bump-x 220ms ease-out forwards", transformOrigin: "left center" }} />}
          {edgeBump.right && <div style={{ ...edgeBumpBase, right: 0, top: 0, bottom: 0, width: 10, animation: "frame-edge-bump-x 220ms ease-out forwards", transformOrigin: "right center" }} />}
          {edgeBump.top && <div style={{ ...edgeBumpBase, top: 0, left: 0, right: 0, height: 10, animation: "frame-edge-bump-y 220ms ease-out forwards", transformOrigin: "center top" }} />}
          {edgeBump.bottom && <div style={{ ...edgeBumpBase, bottom: 0, left: 0, right: 0, height: 10, animation: "frame-edge-bump-y 220ms ease-out forwards", transformOrigin: "center bottom" }} />}
        </>
      )}
      {nestedChildren}
      {HANDLES.map((h, i) => <div key={i} data-handle="true" onMouseDown={(e) => { e.stopPropagation(); onResizeStart(e, frame.id, h.edges); }} onTouchStart={(e) => { e.stopPropagation(); onResizeStart(e, frame.id, h.edges); }} style={{ position: "absolute", cursor: h.cursor, opacity: editMode ? 0.45 : 0.2, ...h.style }} />)}
    </Frame>
  );
};
