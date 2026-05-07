import { listKanbanCards, listKanbanColumns } from "./kanbanApi";
import type { KanbanCard, KanbanColumn } from "./shared";

export type KanbanBoardContents = {
  columns: KanbanColumn[];
  cards: KanbanCard[];
};

const contentCache = new Map<string, KanbanBoardContents>();
const contentInflight = new Map<string, Promise<KanbanBoardContents>>();

function key(apiBase: string, companyID: string, boardID: string): string {
  return `${apiBase}:${companyID}:${boardID}`;
}

function cloneContents(contents: KanbanBoardContents): KanbanBoardContents {
  return {
    columns: contents.columns.map((column) => ({ ...column })),
    cards: contents.cards.map((card) => ({ ...card })),
  };
}

export function hasKanbanBoardContentsCache(apiBase: string, companyID: string, boardID: string): boolean {
  return contentCache.has(key(apiBase, companyID, boardID));
}

export function primeKanbanBoardContentsCache(apiBase: string, companyID: string, boardID: string, contents: KanbanBoardContents): void {
  contentCache.set(key(apiBase, companyID, boardID), cloneContents(contents));
}

export function invalidateKanbanBoardContentsCache(apiBase: string, companyID: string, boardID: string): void {
  const cacheKey = key(apiBase, companyID, boardID);
  contentCache.delete(cacheKey);
  contentInflight.delete(cacheKey);
}

export async function getKanbanBoardContentsSingleFlight(apiBase: string, companyID: string, boardID: string, cardLimit = 500): Promise<KanbanBoardContents> {
  const cacheKey = key(apiBase, companyID, boardID);
  const cached = contentCache.get(cacheKey);
  if (cached) return cloneContents(cached);
  const inflight = contentInflight.get(cacheKey);
  if (inflight) return inflight.then(cloneContents);

  const promise = Promise.all([
    listKanbanColumns(apiBase, companyID, boardID),
    listKanbanCards(apiBase, companyID, boardID, "", cardLimit),
  ]).then(([columns, cards]) => {
    const contents = { columns, cards };
    contentCache.set(cacheKey, cloneContents(contents));
    contentInflight.delete(cacheKey);
    return contents;
  }).catch((error) => {
    contentInflight.delete(cacheKey);
    throw error;
  });

  contentInflight.set(cacheKey, promise);
  return promise.then(cloneContents);
}
