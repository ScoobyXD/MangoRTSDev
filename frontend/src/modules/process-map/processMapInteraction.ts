import type { ProcessMapResourceRef } from "./processMapApi.js";

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
};

export function processMapResourceNodeID(resource: ProcessMapResourceRef): string {
  return `${resource.resource_type}:${resource.resource_id}`;
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

function tileCovers(ancestor: ProcessMapRefinementTile, descendant: ProcessMapRefinementTile): boolean {
  const zoomDelta = descendant.index.z - ancestor.index.z;
  if (zoomDelta <= 0) return false;
  const scale = 2 ** zoomDelta;
  return Math.floor(descendant.index.x / scale) === ancestor.index.x
    && Math.floor(descendant.index.y / scale) === ancestor.index.y;
}

export function transparentVectorRefinementStrategy(tiles: ProcessMapRefinementTile[]): void {
  for (const tile of tiles) tile.isVisible = false;
  const selected = tiles.filter((tile) => tile.isSelected);
  const loadedAncestors = tiles
    .filter((tile) => tile.content != null && !tile.isSelected)
    .sort((left, right) => right.index.z - left.index.z);
  const blockedAncestors = new Set<ProcessMapRefinementTile>();

  for (const tile of selected) {
    if (tile.content != null) continue;
    const ancestor = loadedAncestors.find((candidate) => tileCovers(candidate, tile));
    if (ancestor) blockedAncestors.add(ancestor);
  }

  for (const ancestor of blockedAncestors) ancestor.isVisible = true;
  for (const tile of selected) {
    if (tile.content == null) continue;
    const coveredByVisibleAncestor = [...blockedAncestors].some((ancestor) => tileCovers(ancestor, tile));
    if (!coveredByVisibleAncestor) tile.isVisible = true;
  }
}
