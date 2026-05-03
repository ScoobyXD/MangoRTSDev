import { useEffect } from "react";
import { resolveGlobalKeyboardShortcut } from "./keyboardShortcutRouting";

interface KeyboardActions {
  deleteSelection: () => void;
  copySelection: () => void;
  pasteSelection: () => void;
  undo: () => void;
  redo: () => void;
}

function hasNativeTextSelection(): boolean {
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().length > 0);
}

// Global keyboard command router for frame editing workflows (delete/copy/paste/undo/redo).
export function useKeyboardShortcuts(actions: KeyboardActions) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const command = resolveGlobalKeyboardShortcut(e);
      if (!command) return;

      if (command === "copy") {
        if (hasNativeTextSelection()) return;
        e.preventDefault();
        actions.copySelection();
      } else if (command === "paste") {
        e.preventDefault();
        actions.pasteSelection();
      } else if (command === "undo") {
        e.preventDefault();
        actions.undo();
      } else if (command === "redo") {
        e.preventDefault();
        actions.redo();
      } else if (command === "delete") {
        e.preventDefault();
        actions.deleteSelection();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actions]);
}
