import type { MangoTiptapResourceType } from "./mangoTiptapSync.js";

export function normalizeMangoTiptapCollaborationURL(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function shouldUseMangoTiptapCollaboration(
  resourceType: MangoTiptapResourceType,
  _collaborationURL: string,
): boolean {
  // Project and Logic Gate JSON documents are collaboration-only. A missing
  // endpoint must fail closed in the provider instead of falling back to
  // whole-document REST commits, which the API intentionally rejects.
  return resourceType === "project" || resourceType === "logic_gate";
}
