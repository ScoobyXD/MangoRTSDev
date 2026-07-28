import type { MangoTiptapResourceType } from "./mangoTiptapSync.js";

export function normalizeMangoTiptapCollaborationURL(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function shouldUseMangoTiptapCollaboration(
  resourceType: MangoTiptapResourceType,
  collaborationURL: string,
): boolean {
  return (resourceType === "project" || resourceType === "logic_gate")
    && Boolean(normalizeMangoTiptapCollaborationURL(collaborationURL));
}
