export const EVENT_TRIAGE_CONVERSION_APPLIED = "mangorts:home-triage-conversion-applied";

export type TriageConversionAppliedDetail = {
  companyID?: string;
  messageIDs?: string[];
  sharedInboxID?: string;
  accountEmail?: string;
  logicGateID?: string;
  nodeIDs?: string[];
  boardIDs?: string[];
  cardIDs?: string[];
  unstarredMessageIDs?: string[];
};

export function dispatchTriageConversionApplied(detail: TriageConversionAppliedDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<TriageConversionAppliedDetail>(EVENT_TRIAGE_CONVERSION_APPLIED, { detail }));
}
