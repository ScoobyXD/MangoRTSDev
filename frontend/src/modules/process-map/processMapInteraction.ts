import type { ProcessMapResourceRef } from "./processMapApi.js";
import {
  processMapBoundsContain,
  processMapPlacementBounds,
  type ProcessMapBounds,
  type ProcessMapGridPoint,
  type ProcessMapPlacementGeometry,
} from "./processMapGeometry.js";

export type ProcessMapInteractionState = {
  isDragging?: boolean;
  isPanning?: boolean;
  isZooming?: boolean;
  inTransition?: boolean;
};

export type ProcessMapRefinementTile = {
  index: { x: number; y: number; z: number };
  isSelected: boolean;
  isVisible: boolean;
  isLoaded: boolean;
  content?: unknown | null;
  parent: ProcessMapRefinementTile | null;
};

export function processMapResourceNodeID(resource: ProcessMapResourceRef): string {
  return `${resource.resource_type}:${resource.resource_id}`;
}

export function processMapDragSelectionBounds(start: ProcessMapGridPoint, end: ProcessMapGridPoint): ProcessMapBounds {
  return {
    min_x: Math.min(start.x, end.x),
    min_y: Math.min(start.y, end.y),
    max_x: Math.max(start.x, end.x),
    max_y: Math.max(start.y, end.y),
  };
}

export function processMapPlacementsInsideBounds<T extends ProcessMapPlacementGeometry & ProcessMapResourceRef>(
  placements: Iterable<T>,
  bounds: ProcessMapBounds,
): Set<string> {
  const selected = new Set<string>();
  for (const placement of placements) {
    if (processMapBoundsContain(bounds, processMapPlacementBounds(placement))) {
      selected.add(processMapResourceNodeID(placement));
    }
  }
  return selected;
}

export function isValidProcessMapConnection(connection: {
  source?: string | null;
  target?: string | null;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}): boolean {
  return Boolean(
    connection.source
    && connection.target
    && connection.source !== connection.target
    && connection.sourceHandle === "output"
    && connection.targetHandle === "input"
  );
}

export function shouldApplyProcessMapCommit(currentRevision: number, savedRevision: number): boolean {
  return Number.isSafeInteger(savedRevision) && savedRevision >= currentRevision;
}

export function shouldApplyProcessMapMutationAck(
  requestCanonicalGeneration: number,
  currentCanonicalGeneration: number,
  operationGeneration: number,
  currentOperationGeneration: number,
): boolean {
  return requestCanonicalGeneration === currentCanonicalGeneration
    && operationGeneration === currentOperationGeneration;
}

function interactionActive(state: ProcessMapInteractionState): boolean {
  return Boolean(state.isDragging || state.isPanning || state.isZooming || state.inTransition);
}

export function createProcessMapSettlementGate(options: {
  delayMs: number;
  onSettle: () => void;
  now?: () => number;
}): {
  onViewStateChange: () => void;
  onInteractionStateChange: (state: ProcessMapInteractionState) => void;
  dispose: () => void;
} {
  const now = options.now ?? Date.now;
  const delayMs = Math.max(0, options.delayMs);
  let state: ProcessMapInteractionState = {};
  let lastViewChange = Number.NEGATIVE_INFINITY;
  let lastSettledViewChange = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const clearTimer = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };
  const settleIfReady = () => {
    timer = null;
    if (disposed || interactionActive(state) || lastSettledViewChange === lastViewChange) return;
    const remaining = delayMs - (now() - lastViewChange);
    if (remaining > 0) {
      timer = setTimeout(settleIfReady, remaining);
      return;
    }
    lastSettledViewChange = lastViewChange;
    options.onSettle();
  };
  const arm = () => {
    clearTimer();
    if (disposed || interactionActive(state)) return;
    const remaining = Math.max(0, delayMs - (now() - lastViewChange));
    timer = setTimeout(settleIfReady, remaining);
  };

  return {
    onViewStateChange: () => {
      if (disposed) return;
      lastViewChange = now();
      arm();
    },
    onInteractionStateChange: (nextState) => {
      if (disposed) return;
      state = { ...nextState };
      if (interactionActive(state)) {
        clearTimer();
        return;
      }
      arm();
    },
    dispose: () => {
      disposed = true;
      clearTimer();
    },
  };
}

export function transparentVectorRefinementStrategy(tiles: ProcessMapRefinementTile[]): void {
  // Tileset2D already marks only selected tiles visible and maintains each
  // header's nearest cached parent. Complete coverage needs no refinement.
  let missingCoverage = false;
  for (const tile of tiles) {
    if (!tile.isSelected || tile.content != null) continue;
    missingCoverage = true;
    tile.isVisible = false;
    let ancestor = tile.parent;
    while (ancestor && ancestor.content == null) ancestor = ancestor.parent;
    if (ancestor) ancestor.isVisible = true;
  }
  if (!missingCoverage) return;

  // One covering level must draw each region: translucent ancestors must not
  // overlap either another substitute ancestor or a ready selected child.
  for (const tile of tiles) {
    if (!tile.isVisible) continue;
    let ancestor = tile.parent;
    while (ancestor && !ancestor.isVisible) ancestor = ancestor.parent;
    if (ancestor) tile.isVisible = false;
  }
}
