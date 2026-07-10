export const UNIFIED_RICH_EDITOR_BEHAVIOR_SOURCE = "useEditorDocumentSurfaceHandlers";
export const UNIFIED_RICH_EDITOR_TOOLBAR_SOURCE = "EditorTabBar";

export type UnifiedRichEditorSurfaceID =
  | "logic-gate-editor"
  | "node-text-block"
  | "project-text-block"
  | "my-triage-compose"
  | "shared-triage-compose"
  | "attached-email-reply";

export type UnifiedRichEditorPersistenceBoundary =
  | "logic-gate-information-projection"
  | "node-information-projection"
  | "project-information-projection"
  | "personal-mailbox"
  | "shared-mailbox";

export type UnifiedRichEditorSurfaceContract = {
  id: UnifiedRichEditorSurfaceID;
  persistenceBoundary: UnifiedRichEditorPersistenceBoundary;
  chatSurface: false;
};

export type UnifiedRichEditorControlID =
  | "font-size"
  | "bold"
  | "underline"
  | "outline-style";

export const UNIFIED_RICH_EDITOR_SURFACE_CONTRACTS: readonly UnifiedRichEditorSurfaceContract[] = [
  { id: "logic-gate-editor", persistenceBoundary: "logic-gate-information-projection", chatSurface: false },
  { id: "node-text-block", persistenceBoundary: "node-information-projection", chatSurface: false },
  { id: "project-text-block", persistenceBoundary: "project-information-projection", chatSurface: false },
  { id: "my-triage-compose", persistenceBoundary: "personal-mailbox", chatSurface: false },
  { id: "shared-triage-compose", persistenceBoundary: "shared-mailbox", chatSurface: false },
  { id: "attached-email-reply", persistenceBoundary: "personal-mailbox", chatSurface: false },
] as const;

export const UNIFIED_RICH_EDITOR_MAIL_CONTROL_IDS: readonly UnifiedRichEditorControlID[] = [
  "font-size",
  "bold",
  "underline",
  "outline-style",
] as const;
