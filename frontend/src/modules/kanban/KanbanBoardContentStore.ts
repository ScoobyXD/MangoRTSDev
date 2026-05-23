import { listKanbanCards, listKanbanColumns } from "./kanbanApi";
import type { KanbanCard, KanbanColumn } from "./shared";

export type KanbanBoardContents = {
  columns: KanbanColumn[];
  cards: KanbanCard[];
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
  const cached = contentCache.get(cacheKey);
  if (cached) return cloneContents(cached);
  const inflight = contentInflight.get(cacheKey);
  if (inflight) return inflight.then(cloneContents);

  const version = contentVersion(cacheKey);
  const promise = Promise.all([
    listKanbanColumns(apiBase, companyID, boardID),
    listKanbanCards(apiBase, companyID, boardID, "", cardLimit),
  ]).then(([columns, cards]) => {
    const contents = { columns, cards };
    if (contentVersion(cacheKey) === version) contentCache.set(cacheKey, cloneContents(contents));
    return contents;
  }).finally(() => {
    if (contentInflight.get(cacheKey) === promise) contentInflight.delete(cacheKey);
  });

  contentInflight.set(cacheKey, promise);
  return promise.then(cloneContents);
}
