export type EditorTabID = "editor" | "metadata" | "history";

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
