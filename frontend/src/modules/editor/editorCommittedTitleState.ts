import type { CompanyExplorerSearchResult } from "../company-explorer/companyExplorerLazyApi.js";
import type { LogicGateRecord } from "../logic-gate-map/shared.js";

export function applyCommittedLogicGateTitleToRecords(
  records: LogicGateRecord[],
  resourceID: string,
  title: string,
): LogicGateRecord[] {
  let changed = false;
  const next = records.map((record) => {
    if (record.logic_gate_id !== resourceID || record.header === title) return record;
    changed = true;
    return { ...record, header: title };
  });
  return changed ? next : records;
}

export function applyCommittedLogicGateTitleToSearchResults(
  results: CompanyExplorerSearchResult[],
  resourceID: string,
  title: string,
): CompanyExplorerSearchResult[] {
  let changed = false;
  const next = results.map((result) => {
    const resultID = (result.resource_id || result.entity_id).trim();
    const displayName = result.resource_type === "logic_gate" && resultID === resourceID
      ? title
      : result.display_name;
    let pathChanged = false;
    const locationPath = result.location_path.map((segment) => {
      const segmentID = (segment.resource_id || segment.entity_id).trim();
      if (segment.entity_type !== "logic_gate" || segmentID !== resourceID || segment.name === title) return segment;
      pathChanged = true;
      return { ...segment, name: title };
    });
    if (displayName === result.display_name && !pathChanged) return result;
    changed = true;
    return {
      ...result,
      display_name: displayName,
      location_path: locationPath,
    };
  });
  return changed ? next : results;
}

export function resolveCommittedLastAssignedLogicGateLabel(
  lastAssignedLogicGateID: string,
  currentLabel: string,
  resourceID: string,
  title: string,
): string {
  return lastAssignedLogicGateID.trim() === resourceID ? title : currentLabel;
}
