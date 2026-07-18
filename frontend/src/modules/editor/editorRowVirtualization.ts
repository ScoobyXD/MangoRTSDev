import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";

export const EDITOR_ROW_OVERSCAN = 2;
export const EDITOR_ROW_FALLBACK_VIEWPORT_HEIGHT = 900;

export type BoundedEditorRowWindow = {
  startIndex: number;
  endIndex: number;
};

export type BoundedEditorRowEntry =
  | { kind: "spacer"; key: string; height: number }
  | { kind: "row"; key: string; index: number };

type ComputeBoundedEditorRowWindowInput = {
  itemCount: number;
  rowHeight: number;
  rowGap: number;
  scrollTop: number;
  viewportHeight: number;
  listOffset: number;
  overscan?: number;
  targetIndex?: number | null;
};

function clampIndex(value: number, itemCount: number): number {
  if (itemCount <= 0) return 0;
  return Math.max(0, Math.min(itemCount - 1, Math.trunc(value)));
}

function normalizedRowSlotHeight(rowHeight: number, rowGap: number): number {
  return Math.max(1, Math.round(rowHeight) + Math.max(0, Math.round(rowGap)));
}

export function computeBoundedEditorRowWindow({
  itemCount,
  rowHeight,
  rowGap,
  scrollTop,
  viewportHeight,
  listOffset,
  overscan = EDITOR_ROW_OVERSCAN,
  targetIndex,
}: ComputeBoundedEditorRowWindowInput): BoundedEditorRowWindow {
  const count = Math.max(0, Math.trunc(itemCount));
  if (count === 0) return { startIndex: 0, endIndex: -1 };

  const slotHeight = normalizedRowSlotHeight(rowHeight, rowGap);
  const safeViewportHeight = Math.max(1, Math.round(viewportHeight) || EDITOR_ROW_FALLBACK_VIEWPORT_HEIGHT);
  const safeOverscan = Math.max(0, Math.trunc(overscan));
  const visibleCapacity = Math.max(1, Math.ceil(safeViewportHeight / slotHeight));
  const windowCapacity = Math.min(count, visibleCapacity + safeOverscan * 2);

  if (targetIndex !== undefined && targetIndex !== null && Number.isFinite(targetIndex)) {
    const target = clampIndex(targetIndex, count);
    const startIndex = Math.max(0, Math.min(count - windowCapacity, target - Math.floor(windowCapacity / 2)));
    return { startIndex, endIndex: startIndex + windowCapacity - 1 };
  }

  const localTop = Math.max(0, (Number.isFinite(scrollTop) ? scrollTop : 0) - (Number.isFinite(listOffset) ? listOffset : 0));
  const localBottom = Math.max(localTop + 1, localTop + safeViewportHeight);
  const visibleStart = clampIndex(Math.floor(localTop / slotHeight), count);
  const visibleEnd = clampIndex(Math.floor((localBottom - 1) / slotHeight), count);
  const startIndex = Math.max(0, visibleStart - safeOverscan);
  const endIndex = Math.min(count - 1, Math.max(startIndex, visibleEnd + safeOverscan));
  return { startIndex, endIndex };
}

export function buildBoundedEditorRowEntries(
  itemCount: number,
  rowHeight: number,
  rowGap: number,
  window: BoundedEditorRowWindow,
  pinnedIndices: readonly number[] = [],
): BoundedEditorRowEntry[] {
  const count = Math.max(0, Math.trunc(itemCount));
  if (count === 0) return [];
  const slotHeight = normalizedRowSlotHeight(rowHeight, rowGap);
  const mountedIndices = new Set<number>();
  const start = clampIndex(window.startIndex, count);
  const end = window.endIndex < 0 ? -1 : clampIndex(window.endIndex, count);
  if (end >= start) {
    for (let index = start; index <= end; index += 1) mountedIndices.add(index);
  }
  for (const rawIndex of pinnedIndices) {
    if (!Number.isFinite(rawIndex)) continue;
    const index = Math.trunc(rawIndex);
    if (index >= 0 && index < count) mountedIndices.add(index);
  }

  const sortedIndices = Array.from(mountedIndices).sort((left, right) => left - right);
  const entries: BoundedEditorRowEntry[] = [];
  let cursor = 0;
  for (const index of sortedIndices) {
    if (index > cursor) {
      entries.push({ kind: "spacer", key: `spacer:${cursor}:${index}`, height: (index - cursor) * slotHeight });
    }
    entries.push({ kind: "row", key: `row:${index}`, index });
    cursor = index + 1;
  }
  if (cursor < count) entries.push({ kind: "spacer", key: `spacer:${cursor}:${count}`, height: (count - cursor) * slotHeight });
  return entries;
}

export function countMountedEditorRows(entries: readonly BoundedEditorRowEntry[]): number {
  return entries.reduce((count, entry) => count + (entry.kind === "row" ? 1 : 0), 0);
}

type UseBoundedEditorRowVirtualizationInput = {
  itemCount: number;
  rowHeight: number;
  rowGap: number;
  scrollElementRef: RefObject<HTMLElement | null>;
  overscan?: number;
  targetIndex?: number | null;
  targetRequestKey?: string | number;
  pinnedIndices?: readonly number[];
};

function measureListOffset(scrollElement: HTMLElement, listElement: HTMLElement): number {
  const scrollRect = scrollElement.getBoundingClientRect();
  const listRect = listElement.getBoundingClientRect();
  return Math.max(0, listRect.top - scrollRect.top + scrollElement.scrollTop);
}

export function useBoundedEditorRowVirtualization({
  itemCount,
  rowHeight,
  rowGap,
  scrollElementRef,
  overscan = EDITOR_ROW_OVERSCAN,
  targetIndex,
  targetRequestKey = "",
  pinnedIndices = [],
}: UseBoundedEditorRowVirtualizationInput) {
  const listElementRef = useRef<HTMLDivElement | null>(null);
  const [listReady, setListReady] = useState(false);
  const listRef = useCallback((element: HTMLDivElement | null) => {
    listElementRef.current = element;
    if (element) setListReady(true);
  }, []);
  const listOffsetRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const handledTargetRequestRef = useRef("");
  const [rowWindow, setRowWindow] = useState<BoundedEditorRowWindow>(() => computeBoundedEditorRowWindow({
    itemCount,
    rowHeight,
    rowGap,
    scrollTop: 0,
    viewportHeight: EDITOR_ROW_FALLBACK_VIEWPORT_HEIGHT,
    listOffset: 0,
    overscan,
    targetIndex,
  }));

  const recalculateWindow = useCallback((preferredTargetIndex?: number | null) => {
    const scrollElement = scrollElementRef.current;
    const nextWindow = computeBoundedEditorRowWindow({
      itemCount,
      rowHeight,
      rowGap,
      scrollTop: scrollElement?.scrollTop ?? 0,
      viewportHeight: scrollElement?.clientHeight || EDITOR_ROW_FALLBACK_VIEWPORT_HEIGHT,
      listOffset: listOffsetRef.current,
      overscan,
      targetIndex: preferredTargetIndex,
    });
    setRowWindow((current) => (
      current.startIndex === nextWindow.startIndex && current.endIndex === nextWindow.endIndex ? current : nextWindow
    ));
  }, [itemCount, overscan, rowGap, rowHeight, scrollElementRef]);

  const measureAndRecalculateWindow = useCallback((preferredTargetIndex?: number | null) => {
    const scrollElement = scrollElementRef.current;
    const listElement = listElementRef.current;
    if (scrollElement && listElement) listOffsetRef.current = measureListOffset(scrollElement, listElement);
    recalculateWindow(preferredTargetIndex);
  }, [recalculateWindow, scrollElementRef]);

  const scheduleRecalculateWindow = useCallback(() => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      recalculateWindow();
    });
  }, [recalculateWindow]);

  const mountAndScrollToIndex = useCallback((rawIndex: number, align: "start" | "center" = "center") => {
    if (itemCount <= 0 || !Number.isFinite(rawIndex)) return;
    const index = clampIndex(rawIndex, itemCount);
    recalculateWindow(index);
    window.requestAnimationFrame(() => {
      const scrollElement = scrollElementRef.current;
      const listElement = listElementRef.current;
      if (!scrollElement || !listElement) return;
      listOffsetRef.current = measureListOffset(scrollElement, listElement);
      const slotHeight = normalizedRowSlotHeight(rowHeight, rowGap);
      const rowTop = listOffsetRef.current + index * slotHeight;
      const nextScrollTop = align === "start"
        ? rowTop
        : rowTop - Math.max(0, (scrollElement.clientHeight - rowHeight) / 2);
      scrollElement.scrollTop = Math.max(0, Math.round(nextScrollTop));
      recalculateWindow();
    });
  }, [itemCount, recalculateWindow, rowGap, rowHeight, scrollElementRef]);

  useLayoutEffect(() => {
    const scrollElement = scrollElementRef.current;
    if (!scrollElement) {
      recalculateWindow();
      return undefined;
    }
    const onScroll = () => scheduleRecalculateWindow();
    scrollElement.addEventListener("scroll", onScroll, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measureAndRecalculateWindow());
    observer?.observe(scrollElement);
    measureAndRecalculateWindow();
    return () => {
      scrollElement.removeEventListener("scroll", onScroll);
      observer?.disconnect();
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [measureAndRecalculateWindow, recalculateWindow, scheduleRecalculateWindow, scrollElementRef]);

  useLayoutEffect(() => {
    const cleanTargetIndex = targetIndex !== undefined && targetIndex !== null && Number.isFinite(targetIndex)
      ? clampIndex(targetIndex, itemCount)
      : null;
    if (cleanTargetIndex === null) {
      recalculateWindow();
      return;
    }
    if (!listReady) {
      recalculateWindow(cleanTargetIndex);
      return;
    }
    const requestSignature = `${String(targetRequestKey)}:${cleanTargetIndex}`;
    if (handledTargetRequestRef.current === requestSignature) {
      recalculateWindow();
      return;
    }
    handledTargetRequestRef.current = requestSignature;
    mountAndScrollToIndex(cleanTargetIndex, "center");
  }, [itemCount, listReady, mountAndScrollToIndex, recalculateWindow, targetIndex, targetRequestKey]);

  const entries = useMemo(() => buildBoundedEditorRowEntries(
    itemCount,
    rowHeight,
    rowGap,
    rowWindow,
    pinnedIndices,
  ), [itemCount, pinnedIndices, rowGap, rowHeight, rowWindow]);

  return {
    entries,
    listRef,
    mountedRowCount: countMountedEditorRows(entries),
    mountAndScrollToIndex,
    window: rowWindow,
  };
}
