import { useEffect } from "react";
import type React from "react";
import type { DragState, FrameDataModel } from "../types";
import {
  CHILD_EDGE_GAP,
  CHILD_GRID_DIVISOR,
  MIN_H,
  MIN_W,
  clamp,
  clampToRangeWithInset,
  framesOverlap,
  getPointer,
} from "./frameLayoutTypes";

interface UseFrameDragResizeArgs {
  dragRef: React.MutableRefObject<DragState | null>;
  gridCols: number;
  gridRows: number;
  stepX: number;
  stepY: number;
  updateActiveFrames: (updater: (prev: FrameDataModel[]) => FrameDataModel[]) => void;
  setDraggingId: React.Dispatch<React.SetStateAction<string | null>>;
}

export function useFrameDragResize({
  dragRef,
  gridCols,
  gridRows,
  stepX,
  stepY,
  updateActiveFrames,
  setDraggingId,
}: UseFrameDragResizeArgs) {
  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      const d = dragRef.current;
      if (!d) return;
      e.preventDefault();
      const { px, py } = getPointer(e);
      const stepFactor = d.parentId ? CHILD_GRID_DIVISOR : 1;
      const dCols = Math.round((px - d.startMouseX) / (stepX / stepFactor)) / stepFactor;
      const dRows = Math.round((py - d.startMouseY) / (stepY / stepFactor)) / stepFactor;

      updateActiveFrames((prev) => prev.map((w) => {
        if (w.id !== d.id) return w;
        const parent = d.parentId ? prev.find((candidate) => candidate.id === d.parentId) : null;
        const maxCols = parent ? parent.w : gridCols;
        const maxRows = parent ? parent.h : gridRows;
        const edgeInset = parent ? CHILD_EDGE_GAP : 0;
        if (d.mode === "drag") {
          const maxX = Math.max(0, maxCols - w.w);
          const maxY = Math.max(0, maxRows - w.h);
          return {
            ...w,
            x: clampToRangeWithInset(d.origX + dCols, 0, maxX, edgeInset),
            y: clampToRangeWithInset(d.origY + dRows, 0, maxY, edgeInset),
          };
        }
        let x = d.origX, y = d.origY, nw = d.origW, nh = d.origH;
        if (d.edges.right) nw = clamp(d.origW + dCols, MIN_W, maxCols - d.origX - edgeInset);
        if (d.edges.bottom) nh = clamp(d.origH + dRows, MIN_H, maxRows - d.origY - edgeInset);
        if (d.edges.left) {
          const shift = clamp(dCols, -(d.origX - edgeInset), d.origW - MIN_W);
          x = d.origX + shift;
          nw = d.origW - shift;
        }
        if (d.edges.top) {
          const shift = clamp(dRows, -(d.origY - edgeInset), d.origH - MIN_H);
          y = d.origY + shift;
          nh = d.origH - shift;
        }
        x = clampToRangeWithInset(x, 0, Math.max(0, maxCols - nw), edgeInset);
        y = clampToRangeWithInset(y, 0, Math.max(0, maxRows - nh), edgeInset);
        return { ...w, x, y, w: nw, h: nh };
      }));
    };
    const onEnd = () => {
      const d = dragRef.current;
      if (d) {
        updateActiveFrames((prev) => {
          const target = prev.find((frame) => frame.id === d.id);
          if (!target) return prev;

          let next = prev.map((w) => {
            if (w.id !== d.id) return w;
            if (d.mode === "drag" && !d.parentId) return w;
            const siblingOverlaps = prev.some((candidate) => {
              if (candidate.id === w.id) return false;
              const sameParent = (candidate.parentId ?? "") === (w.parentId ?? "");
              return sameParent && framesOverlap(w, candidate);
            });
            if (!siblingOverlaps) return w;
            return d.mode === "drag"
              ? { ...w, x: d.origX, y: d.origY }
              : { ...w, x: d.origX, y: d.origY, w: d.origW, h: d.origH };
          });

          if (d.mode !== "drag" || d.parentId) return next;
          const moved = next.find((frame) => frame.id === d.id);
          if (!moved) return next;
          const host = next
            .filter((frame) => !frame.parentId && frame.id !== moved.id)
            .find((frame) => framesOverlap(frame, moved));
          if (!host) return next;
          const childX = clampToRangeWithInset(moved.x - host.x, 0, Math.max(0, host.w - moved.w), CHILD_EDGE_GAP);
          const childY = clampToRangeWithInset(moved.y - host.y, 0, Math.max(0, host.h - moved.h), CHILD_EDGE_GAP);
          next = next.map((frame) => (frame.id === moved.id ? { ...frame, parentId: host.id, x: childX, y: childY } : frame));
          return next;
        });
      }
      dragRef.current = null;
      setDraggingId(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
  }, [dragRef, gridCols, gridRows, stepX, stepY, updateActiveFrames, setDraggingId]);
}
