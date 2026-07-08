export type MissingResourceType = "node" | "logic_gate" | "kanban_board" | "resource";

export type MissingResourceKeyParts = {
  apiBase: string;
  companyID: string;
  resourceType: MissingResourceType;
  resourceID: string;
};

const missingResources = new Set<string>();

export class TerminalResourceNotFoundError extends Error {
  readonly resourceType: MissingResourceType;
  readonly resourceID: string;

  constructor(resourceType: MissingResourceType, resourceID: string) {
    super(`${resourceType}_not_found`);
    this.name = "TerminalResourceNotFoundError";
    this.resourceType = resourceType;
    this.resourceID = resourceID;
  }
}

export function markResourceMissing(parts: MissingResourceKeyParts): void {
  const key = missingResourceKey(parts);
  if (key) missingResources.add(key);
}

export function clearResourceMissing(parts: MissingResourceKeyParts): void {
  const key = missingResourceKey(parts);
  if (key) missingResources.delete(key);
}

export function isResourceMarkedMissing(parts: MissingResourceKeyParts): boolean {
  const key = missingResourceKey(parts);
  return !!key && missingResources.has(key);
}

export function throwIfResourceMarkedMissing(parts: MissingResourceKeyParts): void {
  if (isResourceMarkedMissing(parts)) {
    throw new TerminalResourceNotFoundError(parts.resourceType, parts.resourceID);
  }
}

export function isTerminalResourceNotFoundError(cause: unknown): cause is TerminalResourceNotFoundError {
  return cause instanceof TerminalResourceNotFoundError
    || (cause instanceof Error && cause.name === "TerminalResourceNotFoundError");
}

function missingResourceKey(parts: MissingResourceKeyParts): string {
  const apiBase = parts.apiBase.trim();
  const companyID = parts.companyID.trim();
  const resourceID = parts.resourceID.trim();
  if (!apiBase || !companyID || !resourceID) return "";
  return `${apiBase}:${companyID}:${parts.resourceType}:${resourceID}`;
}
