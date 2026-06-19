import type { CompanyExplorerFolderScopeType } from "../folders/companyExplorerFolders.js";

function cleanID(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export function shouldIncludeGVICCustomRootFolder(input: {
  rootScopeType?: CompanyExplorerFolderScopeType;
  rootScopeID?: string | null;
  ownerUserIDs: Iterable<string>;
  requestedOwnerUserIDs?: Iterable<string>;
}): boolean {
  const requestedOwnerIDs = input.requestedOwnerUserIDs
    ? new Set(Array.from(input.requestedOwnerUserIDs, cleanID).filter(Boolean))
    : null;
  if (!requestedOwnerIDs) return true;

  const rootScopeID = cleanID(input.rootScopeID);
  if (input.rootScopeType === "user" && rootScopeID) return requestedOwnerIDs.has(rootScopeID);
  if (input.rootScopeType === "team" && rootScopeID) return false;

  const ownerIDs = new Set(Array.from(input.ownerUserIDs, cleanID).filter(Boolean));
  if (ownerIDs.size === 0) return true;
  return Array.from(ownerIDs).some((ownerID) => requestedOwnerIDs.has(ownerID));
}

export function shouldShowGVICCompanyScopedFolderShell(scopeType?: CompanyExplorerFolderScopeType): boolean {
  return !scopeType || scopeType === "company";
}
