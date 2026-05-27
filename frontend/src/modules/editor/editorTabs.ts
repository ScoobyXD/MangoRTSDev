export type EditorTabID = "editor" | "format" | "outline-styles" | "metadata" | "history" | "relationships" | "permissions";
export type EditorRelatedNodeCreationKind = "parent" | "peer" | "child";

export const EDITOR_TAB_ITEMS: ReadonlyArray<{ id: EditorTabID; label: string }> = [
  { id: "editor", label: "Editor" },
  { id: "permissions", label: "Permissions" },
  { id: "relationships", label: "Relationships" },
  { id: "format", label: "Format" },
  { id: "outline-styles", label: "Outline Styles" },
  { id: "metadata", label: "Metadata" },
  { id: "history", label: "History" },
];

export type EditorDocumentIsolationState = {
  ariaHidden: boolean;
  pointerEvents: "auto" | "none";
  tabIndex: 0 | -1;
  visibility: "visible" | "hidden";
};

export function getEditorDocumentIsolationState(activeTab: EditorTabID): EditorDocumentIsolationState {
  const editorIsActive = activeTab === "editor" || activeTab === "format" || activeTab === "outline-styles";

  // Keep the editable document mounted so draft text and autosave refs stay intact, but
  // make it invisible and unreachable when metadata/history own the frame.
  return {
    ariaHidden: !editorIsActive,
    pointerEvents: editorIsActive ? "auto" : "none",
    tabIndex: editorIsActive ? 0 : -1,
    visibility: editorIsActive ? "visible" : "hidden",
  };
}
