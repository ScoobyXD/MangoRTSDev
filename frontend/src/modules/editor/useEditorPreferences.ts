import { useEffect, useState } from "react";
import {
  DEFAULT_EDITOR_OUTLINE_STYLE,
  isEditorOutlineStyleID,
  type EditorOutlineStyleID,
} from "./plainTextEditing.js";

export const EDITOR_OUTLINE_STYLE_ITEMS: ReadonlyArray<{ id: EditorOutlineStyleID; label: string }> = [
  { id: "automatic-outline-numbering", label: "Automatic Numbering" },
  { id: "indent-guides", label: "Indent Guides" },
];

export const EDITOR_DOCUMENT_FONT_SIZE_PX = 15;
export const EDITOR_DOCUMENT_MIN_FONT_SIZE_PX = 10;
export const EDITOR_DOCUMENT_MAX_FONT_SIZE_PX = 28;
export const EDITOR_DOCUMENT_LINE_HEIGHT = 1.55;
export const EDITOR_DOCUMENT_TOP_PX = 86;
export const EDITOR_DOCUMENT_PROPORTIONAL_FONT_FAMILY = "var(--mango-font-family)";
export const EDITOR_DOCUMENT_MONOSPACE_FONT_FAMILY = "var(--mango-font-family)";

export function getEditorDocumentFontFamily(outlineStyle: EditorOutlineStyleID): string {
  return outlineStyle === "indent-guides"
    ? EDITOR_DOCUMENT_MONOSPACE_FONT_FAMILY
    : EDITOR_DOCUMENT_PROPORTIONAL_FONT_FAMILY;
}

function readStoredOutlineStyle(storageKey: string): EditorOutlineStyleID {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(storageKey);
    return raw && isEditorOutlineStyleID(raw) ? raw : DEFAULT_EDITOR_OUTLINE_STYLE;
  } catch {
    return DEFAULT_EDITOR_OUTLINE_STYLE;
  }
}

export function useEditorPreferences(outlineStyleStorageKey: string) {
  const [outlineStyle, setOutlineStyle] = useState<EditorOutlineStyleID>(() => readStoredOutlineStyle(outlineStyleStorageKey));

  useEffect(() => {
    try {
      localStorage.setItem(outlineStyleStorageKey, outlineStyle);
    } catch {
      // Local persistence is a convenience only. The document API stays usable
      // for headless agents even if browser storage is blocked.
    }
  }, [outlineStyle, outlineStyleStorageKey]);

  return {
    outlineStyle,
    setOutlineStyle,
  };
}
