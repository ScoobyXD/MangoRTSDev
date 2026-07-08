import {
  clearResourceMissing,
  markResourceMissing,
  TerminalResourceNotFoundError,
  throwIfResourceMarkedMissing,
} from "../api/missingResources.js";
import { isHTTPNotFoundError } from "../api/requestJSON.js";
import { getLogicGateArenaView } from "./kanbanApi.js";
import type { KanbanCard, KanbanColumn } from "./shared.js";
import { logicGateIDFromKanbanBoardID } from "./shared.js";

export type KanbanBoardContents = {
  columns: KanbanColumn[];
  cards: KanbanCard[];
  projectionSequence?: number;
};

const contentCache = new Map<string, KanbanBoardContents>();
const contentInflight = new Map<string, Promise<KanbanBoardContents>>();
const contentVersions = new Map<string, number>();

function key(apiBase: string, companyID: string, boardID: string): string {
  return `${apiBase}:${companyID}:${boardID}`;
}

function cloneContents(contents: KanbanBoardContents): KanbanBoardContents {
  return {
    columns: contents.columns.map((column) => ({ ...column })),
    cards: contents.cards.map((card) => ({ ...card })),
    projectionSequence: contents.projectionSequence,
  };
}

function contentVersion(cacheKey: string): number {
  return contentVersions.get(cacheKey) ?? 0;
}

function bumpContentVersion(cacheKey: string): number {
  const next = contentVersion(cacheKey) + 1;
  contentVersions.set(cacheKey, next);
  return next;
}

export function hasKanbanBoardContentsCache(apiBase: string, companyID: string, boardID: string): boolean {
  return contentCache.has(key(apiBase, companyID, boardID));
}

export function primeKanbanBoardContentsCache(apiBase: string, companyID: string, boardID: string, contents: KanbanBoardContents): void {
  const cacheKey = key(apiBase, companyID, boardID);
  clearResourceMissing({ apiBase, companyID, resourceType: "kanban_board", resourceID: boardID });
  bumpContentVersion(cacheKey);
  contentInflight.delete(cacheKey);
  contentCache.set(cacheKey, cloneContents(contents));
}

export function invalidateKanbanBoardContentsCache(apiBase: string, companyID: string, boardID: string): void {
  const cacheKey = key(apiBase, companyID, boardID);
  bumpContentVersion(cacheKey);
  contentCache.delete(cacheKey);
  contentInflight.delete(cacheKey);
}

export async function getKanbanBoardContentsSingleFlight(apiBase: string, companyID: string, boardID: string, cardLimit = 500): Promise<KanbanBoardContents> {
  const cacheKey = key(apiBase, companyID, boardID);
  throwIfResourceMarkedMissing({ apiBase, companyID, resourceType: "kanban_board", resourceID: boardID });
  const cached = contentCache.get(cacheKey);
  if (cached) return cloneContents(cached);
  const inflight = contentInflight.get(cacheKey);
  if (inflight) return inflight.then(cloneContents);

  const version = contentVersion(cacheKey);
  const logicGateID = logicGateIDFromKanbanBoardID(boardID);
  const promise = (logicGateID
    ? getLogicGateArenaView(apiBase, companyID, logicGateID).then((view) => {
      const projectionSequence = view.projection_sequence;
      return {
        columns: view.columns ?? [],
        cards: (view.cards ?? []).slice(0, cardLimit),
        projectionSequence: typeof projectionSequence === "number" && Number.isSafeInteger(projectionSequence) && projectionSequence > 0 ? projectionSequence : undefined,
      };
    })
    : Promise.resolve({ columns: [], cards: [], projectionSequence: undefined })
  ).then((contents) => {
    clearResourceMissing({ apiBase, companyID, resourceType: "kanban_board", resourceID: boardID });
    if (contentVersion(cacheKey) === version) contentCache.set(cacheKey, cloneContents(contents));
    return contents;
  }).catch((cause) => {
    if (isHTTPNotFoundError(cause)) {
      markResourceMissing({ apiBase, companyID, resourceType: "kanban_board", resourceID: boardID });
      invalidateKanbanBoardContentsCache(apiBase, companyID, boardID);
      throw new TerminalResourceNotFoundError("kanban_board", boardID);
    }
    throw cause;
  }).finally(() => {
    if (contentInflight.get(cacheKey) === promise) contentInflight.delete(cacheKey);
  });

  contentInflight.set(cacheKey, promise);
  return promise.then(cloneContents);
}
