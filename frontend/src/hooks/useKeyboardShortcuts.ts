import { useEffect } from "react";
import { resolveGlobalKeyboardShortcut } from "./keyboardShortcutRouting";

interface KeyboardActions {
  deleteSelection: () => void;
  copySelection: () => boolean;
  pasteSelection: () => boolean;
  undo: () => void;
  redo: () => void;
}

function hasNativeTextSelection(): boolean {
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().length > 0);
}

// Global keyboard command router for frame editing workflows (delete/copy/paste/undo/redo).
export function useKeyboardShortcuts(actions: KeyboardActions, enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      const selection = window.getSelection();
      const command = resolveGlobalKeyboardShortcut({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        defaultPrevented: e.defaultPrevented,
        target: e.target,
        activeElement: document.activeElement,
        selectionAnchorNode: selection?.anchorNode ?? null,
      });
      if (!command) return;

      if (command === "copy") {
        if (hasNativeTextSelection()) return;
        if (actions.copySelection()) e.preventDefault();
      } else if (command === "paste") {
        if (actions.pasteSelection()) e.preventDefault();
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
  }, [actions, enabled]);
}
