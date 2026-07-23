import type { UpdateFeedFilter } from "./notificationsApi.js";

export const EVENT_UPDATES_FILTER_REQUESTED = "mangorts:updates-filter-requested";

type UpdatesFilterRequestDetail = {
  companyID?: string;
  filter?: UpdateFeedFilter;
};

const requestedUpdatesFilters = new Map<string, UpdateFeedFilter>();

export function requestUpdatesFilter(companyID: string, filter: UpdateFeedFilter): void {
  const cleanCompanyID = companyID.trim();
  if (!cleanCompanyID) return;
  requestedUpdatesFilters.set(cleanCompanyID, filter);
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<UpdatesFilterRequestDetail>(EVENT_UPDATES_FILTER_REQUESTED, {
    detail: { companyID: cleanCompanyID, filter },
  }));
}

export function consumeRequestedUpdatesFilter(companyID: string): UpdateFeedFilter | null {
  const cleanCompanyID = companyID.trim();
  if (!cleanCompanyID) return null;
  const filter = requestedUpdatesFilters.get(cleanCompanyID) ?? null;
  requestedUpdatesFilters.delete(cleanCompanyID);
  return filter;
}

export function updatesFilterFromRequestEvent(event: Event, activeCompanyID: string): UpdateFeedFilter | null {
  const detail = (event as CustomEvent<UpdatesFilterRequestDetail>).detail;
  if (detail?.companyID?.trim() !== activeCompanyID.trim()) return null;
  return isUpdateFeedFilter(detail.filter) ? detail.filter : null;
}

function isUpdateFeedFilter(value: unknown): value is UpdateFeedFilter {
  return value === "all" || value === "urgent" || value === "mention" || value === "update";
}
