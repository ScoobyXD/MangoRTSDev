import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_EDITOR_OUTLINE_STYLE,
  isEditorOutlineStyleID,
  type EditorOutlineStyleID,
} from "./plainTextEditing";

export const EDITOR_OUTLINE_STYLE_ITEMS: ReadonlyArray<{ id: EditorOutlineStyleID; label: string }> = [
  { id: "automatic-outline-numbering", label: "Automatic Numbering" },
  { id: "indent-guides", label: "Indent Guides" },
];

export const EDITOR_DOCUMENT_FONT_SIZE_PX = 15;
export const EDITOR_DOCUMENT_MIN_FONT_SIZE_PX = 10;
export const EDITOR_DOCUMENT_MAX_FONT_SIZE_PX = 28;
export const EDITOR_DOCUMENT_LINE_HEIGHT = 1.55;
export const EDITOR_DOCUMENT_TOP_PX = 86;

function readStoredOutlineStyle(storageKey: string): EditorOutlineStyleID {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(storageKey);
    return raw && isEditorOutlineStyleID(raw) ? raw : DEFAULT_EDITOR_OUTLINE_STYLE;
  } catch {
    return DEFAULT_EDITOR_OUTLINE_STYLE;
  }
}

function readStoredDocumentFontSize(storageKey: string): number {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(storageKey);
    const parsed = raw ? Number(raw) : EDITOR_DOCUMENT_FONT_SIZE_PX;
    return Number.isFinite(parsed)
      ? Math.max(EDITOR_DOCUMENT_MIN_FONT_SIZE_PX, Math.min(EDITOR_DOCUMENT_MAX_FONT_SIZE_PX, Math.round(parsed)))
      : EDITOR_DOCUMENT_FONT_SIZE_PX;
  } catch {
    return EDITOR_DOCUMENT_FONT_SIZE_PX;
  }
}

export function useEditorPreferences(outlineStyleStorageKey: string, documentFontSizeStorageKey: string) {
  const [outlineStyle, setOutlineStyle] = useState<EditorOutlineStyleID>(() => readStoredOutlineStyle(outlineStyleStorageKey));
  const [documentFontSize, setDocumentFontSize] = useState(() => readStoredDocumentFontSize(documentFontSizeStorageKey));

  useEffect(() => {
    try {
      localStorage.setItem(outlineStyleStorageKey, outlineStyle);
    } catch {
      // Local persistence is a convenience only. The document API stays usable
      // for headless agents even if browser storage is blocked.
    }
  }, [outlineStyle, outlineStyleStorageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(documentFontSizeStorageKey, String(documentFontSize));
    } catch {
      // Font size is a local view preference; document text persistence does
      // not depend on browser storage for users or future headless agents.
    }
  }, [documentFontSize, documentFontSizeStorageKey]);

  const adjustDocumentFontSize = useCallback((delta: number) => {
    setDocumentFontSize((current) => Math.max(EDITOR_DOCUMENT_MIN_FONT_SIZE_PX, Math.min(EDITOR_DOCUMENT_MAX_FONT_SIZE_PX, current + delta)));
  }, []);

  return {
    outlineStyle,
    setOutlineStyle,
    documentFontSize,
    setDocumentFontSize,
    adjustDocumentFontSize,
  };
}
