import { useEffect } from "react";

interface KeyboardActions {
  deleteSelection: () => void;
  copySelection: () => void;
  pasteSelection: () => void;
  undo: () => void;
  redo: () => void;
}

export function useKeyboardShortcuts(actions: KeyboardActions) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }

      const mod = e.ctrlKey || e.metaKey;
      if (!mod && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        actions.deleteSelection();
        return;
      }

      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "c") {
        e.preventDefault();
        actions.copySelection();
      } else if (key === "v") {
        e.preventDefault();
        actions.pasteSelection();
      } else if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        actions.undo();
      } else if (key === "y" || (key === "z" && e.shiftKey)) {
        e.preventDefault();
        actions.redo();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actions]);
}
