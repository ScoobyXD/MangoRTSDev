export type CompanyExplorerEntityTitleUpdate = {
  companyID: string;
  entityType: "node" | "logic_gate";
  resourceID: string;
  title: string;
};

export const EVENT_COMPANY_EXPLORER_ENTITY_TITLE_UPDATED = "mangorts:company-explorer-entity-title-updated";

export function publishCompanyExplorerEntityTitleUpdate(
  update: CompanyExplorerEntityTitleUpdate,
  target: EventTarget = window,
): void {
  target.dispatchEvent(new CustomEvent<CompanyExplorerEntityTitleUpdate>(EVENT_COMPANY_EXPLORER_ENTITY_TITLE_UPDATED, {
    detail: update,
  }));
}

export function subscribeCompanyExplorerEntityTitleUpdates(
  listener: (update: CompanyExplorerEntityTitleUpdate) => void,
  target: EventTarget = window,
): () => void {
  const handleUpdate = (event: Event) => listener((event as CustomEvent<CompanyExplorerEntityTitleUpdate>).detail);
  target.addEventListener(EVENT_COMPANY_EXPLORER_ENTITY_TITLE_UPDATED, handleUpdate);
  return () => target.removeEventListener(EVENT_COMPANY_EXPLORER_ENTITY_TITLE_UPDATED, handleUpdate);
}
