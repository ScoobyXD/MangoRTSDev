export type EditorTabID = "editor" | "outline-styles" | "metadata" | "history";

export const EDITOR_TAB_ITEMS: ReadonlyArray<{ id: EditorTabID; label: string }> = [
  { id: "editor", label: "Editor" },
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
  const editorIsActive = activeTab === "editor";

  // Keep the textarea mounted so draft text and autosave refs stay intact, but
  // make it invisible and unreachable when another tab owns the frame.
  return {
    ariaHidden: !editorIsActive,
    pointerEvents: editorIsActive ? "auto" : "none",
    tabIndex: editorIsActive ? 0 : -1,
    visibility: editorIsActive ? "visible" : "hidden",
  };
}
