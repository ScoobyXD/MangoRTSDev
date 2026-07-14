import React, { useEffect, useRef, useState } from "react";
import { useAppFloatingMenuDismissal } from "../../app/AppModalPortal";
import { EDITOR_OVERFLOW_HEADER_TAB_IDS, EDITOR_PRIMARY_HEADER_TAB_IDS, EDITOR_TAB_ITEMS, type EditorRelatedNodeCreationKind, type EditorTabID } from "./editorTabs";
import type { EditorOutlineStyleID } from "./plainTextEditing";
import { EDITOR_HIGHLIGHT_COLOR_ITEMS, normalizeEditorHighlightColor, type EditorHighlightColor } from "./richTextEditing";
import { EDITOR_DOCUMENT_MAX_FONT_SIZE_PX, EDITOR_DOCUMENT_MIN_FONT_SIZE_PX, EDITOR_OUTLINE_STYLE_ITEMS } from "./useEditorPreferences";
import type { EditorTextAlignment } from "./useEditorDocumentSurfaceHandlers";

const EditorDisclosureIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" style={{ display: "block" }}>
    <path d="M3.25 4.55 6 7.3l2.75-2.75" fill="none" stroke={color} strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const EditorCheckIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="13" height="13" viewBox="0 0 13 13" style={{ display: "block" }}>
    <path d="m3.1 6.55 2.05 2.05 4.75-4.75" fill="none" stroke={color} strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const EditorTableIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="13" height="13" viewBox="0 0 18 18" style={{ display: "block" }}>
    <rect x="3" y="4" width="12" height="10" rx="1.3" fill="none" stroke={color} strokeWidth="1.45" />
    <path d="M3 7.4h12M7 4v10M11 4v10" fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const EditorAlignmentIcon: React.FC<{ alignment: EditorTextAlignment; color: string }> = ({ alignment, color }) => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ display: "block" }}>
    {[3, 6, 9, 12].map((y, index) => {
      const width = index % 2 === 0 ? 11 : 8;
      const x = alignment === "center" ? (16 - width) / 2 : alignment === "right" ? 14 - width : 2;
      return <path key={y} d={`M${x} ${y}h${width}`} fill="none" stroke={color} strokeWidth="1.35" strokeLinecap="round" />;
    })}
  </svg>
);

const EditorOutlineStyleIcon: React.FC<{ id: EditorOutlineStyleID; color: string; accent: string }> = ({ id, color, accent }) => {
  if (id === "automatic-outline-numbering") {
    return (
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 18 18" style={{ display: "block" }}>
        <text x="2.1" y="6.1" fill={color} fontSize="5.8" fontWeight="800" fontFamily="Arial, sans-serif">1</text>
        <text x="2.1" y="13.7" fill={color} fontSize="5.8" fontWeight="800" fontFamily="Arial, sans-serif">2</text>
        <path d="M8 4.6h7M8 12.2h7" fill="none" stroke={accent} strokeWidth="1.45" strokeLinecap="round" />
      </svg>
    );
  }

  if (id === "indent-guides") {
    return (
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 18 18" style={{ display: "block" }}>
        <path d="M4.2 2.7v12.6M8.4 5.2v10.1" fill="none" stroke={accent} strokeWidth="1.25" strokeLinecap="round" opacity="0.74" />
        <path d="M11 5.2h4M11 9h4M11 12.8h4" fill="none" stroke={color} strokeWidth="1.45" strokeLinecap="round" />
      </svg>
    );
  }

  if (id === "bullet-list") {
    return (
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 18 18" style={{ display: "block" }}>
        <circle cx="4.2" cy="5" r="1.6" fill="#000000" />
        <circle cx="4.2" cy="9" r="1.6" fill="#000000" />
        <circle cx="4.2" cy="13" r="1.6" fill="#000000" />
        <path d="M8 5h7M8 9h7M8 13h7" fill="none" stroke={accent} strokeWidth="1.45" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 18 18" style={{ display: "block" }}>
      <rect x="2.4" y="3.3" width="4.2" height="4.2" rx="1" fill="none" stroke={accent} strokeWidth="1.35" />
      <rect x="2.4" y="10.5" width="4.2" height="4.2" rx="1" fill="none" stroke={accent} strokeWidth="1.35" />
      <path d="m3.2 5.3 1 1 2.1-2.3" fill="none" stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 5.4h6M9 12.6h6" fill="none" stroke={color} strokeWidth="1.45" strokeLinecap="round" />
    </svg>
  );
};

function outlineStyleIconPalette(id: EditorOutlineStyleID): { color: string; accent: string } {
  if (id === "automatic-outline-numbering") return { color: "#2563eb", accent: "#06b6d4" };
  if (id === "indent-guides") return { color: "#7c3aed", accent: "#14b8a6" };
  if (id === "bullet-list") return { color: "#000000", accent: "#f97316" };
  return { color: "#059669", accent: "#06b6d4" };
}


function colorWithAlpha(color: string, alpha: number): string {
  const rgbMatch = /^rgba?\(([^)]+)\)$/i.exec(color.trim());
  if (rgbMatch) {
    const [r, g, b] = rgbMatch[1].split(",").slice(0, 3).map((part) => Number.parseFloat(part.trim()));
    if ([r, g, b].every(Number.isFinite)) return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (hexMatch) {
    const raw = hexMatch[1];
    const expanded = raw.length === 3 ? raw.split("").map((char) => `${char}${char}`).join("") : raw;
    const r = Number.parseInt(expanded.slice(0, 2), 16);
    const g = Number.parseInt(expanded.slice(2, 4), 16);
    const b = Number.parseInt(expanded.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`;
}
type EditorHeaderOverflowAction = {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
};


type EditorTabBarProps = {
  activeTab: EditorTabID;
  outlineStyle: EditorOutlineStyleID;
  accent: string;
  outlineMenuAccent: string;
  strokeColor: string;
  surfaceText: string;
  tabBackground: string;
  tabSelectedBackground: string;
  onSelectTab: (tab: EditorTabID) => void;
  onAdjustSelectionFontSize: (delta: number) => void;
  documentFontSize: number;
  onSetSelectionFontSize: (fontSize: number) => void;
  boldActive: boolean;
  underlineActive: boolean;
  italicActive: boolean;
  strikethroughActive: boolean;
  highlightColor: EditorHighlightColor | null;
  textAlignment: EditorTextAlignment;
  onToggleBold: () => void;
  onToggleUnderline: () => void;
  onToggleItalic: () => void;
  onToggleStrikethrough: () => void;
  onSetSelectionHighlightColor: (color: EditorHighlightColor | null) => void;
  onSetTextAlignment: (alignment: EditorTextAlignment) => void;
  onOutlineStyleFocus: () => void;
  onOutlineStyleChange: (outlineStyle: EditorOutlineStyleID) => void;
  onCreateRelatedNode?: (kind: EditorRelatedNodeCreationKind) => void;
  onInsertTable?: () => void;
  onSaveCurrentVersion?: () => void;
  saveCurrentVersionDisabled?: boolean;
  saveCurrentVersionBusy?: boolean;
  onRelationshipTabAnchorChange?: (anchor: { left: number; width: number } | null) => void;
  secondaryActions?: readonly EditorHeaderOverflowAction[];
  reserveHeaderOffset?: boolean;
  visibleTabIDs?: readonly EditorTabID[];
  disabled?: boolean;
  formattingDisabled?: boolean;
  singleLine?: boolean;
};

type EditorFormatControlID =
  | "decrease-font"
  | "font-size"
  | "increase-font"
  | "bold"
  | "underline"
  | "italic"
  | "strikethrough"
  | "highlight"
  | "highlight-menu"
  | `align-${EditorTextAlignment}`
  | "table";

export const EditorTabBar: React.FC<EditorTabBarProps> = ({
  activeTab,
  outlineStyle,
  accent,
  outlineMenuAccent,
  strokeColor,
  surfaceText,
  tabBackground,
  tabSelectedBackground,
  onSelectTab,
  onAdjustSelectionFontSize,
  documentFontSize,
  onSetSelectionFontSize,
  boldActive,
  underlineActive,
  italicActive,
  strikethroughActive,
  highlightColor,
  textAlignment,
  onToggleBold,
  onToggleUnderline,
  onToggleItalic,
  onToggleStrikethrough,
  onSetSelectionHighlightColor,
  onSetTextAlignment,
  onOutlineStyleFocus,
  onOutlineStyleChange,
  onCreateRelatedNode,
  onInsertTable,
  onSaveCurrentVersion,
  saveCurrentVersionDisabled = false,
  saveCurrentVersionBusy = false,
  onRelationshipTabAnchorChange,
  secondaryActions = [],
  reserveHeaderOffset = true,
  visibleTabIDs,
  disabled = false,
  formattingDisabled = false,
  singleLine = false,
}) => {
  const [outlineMenuOpen, setOutlineMenuOpen] = useState(false);
  const [highlightMenuOpen, setHighlightMenuOpen] = useState(false);
  const [overflowMenuOpen, setOverflowMenuOpen] = useState(false);
  const [hoveredTabID, setHoveredTabID] = useState<EditorTabID | "overflow" | null>(null);
  const [hoveredFormatControl, setHoveredFormatControl] = useState<EditorFormatControlID | null>(null);
  const [hoveredOutlineStyle, setHoveredOutlineStyle] = useState<EditorOutlineStyleID | null>(null);
  const [fontSizeDraft, setFontSizeDraft] = useState(String(documentFontSize));
  const [customHighlightColor, setCustomHighlightColor] = useState<EditorHighlightColor>(highlightColor ?? EDITOR_HIGHLIGHT_COLOR_ITEMS[0].color);
  const cancelFontSizeCommitRef = useRef(false);
  const outlineMenuRef = useRef<HTMLDivElement | null>(null);
  const highlightMenuRef = useRef<HTMLDivElement | null>(null);
  const overflowMenuRef = useRef<HTMLDivElement | null>(null);
  const overflowTriggerRef = useRef<HTMLButtonElement | null>(null);
  const relationshipTabRef = useRef<HTMLButtonElement | null>(null);
  const tabFrameBackground = "linear-gradient(135deg, rgba(92, 238, 255, 0.92) 0%, rgba(128, 216, 255, 0.82) 34%, rgba(183, 124, 255, 0.88) 72%, rgba(255, 255, 255, 0.86) 100%)";
  const outlineMenuSurface = "linear-gradient(145deg, rgba(248, 251, 255, 0.98), rgba(230, 236, 246, 0.96))";
  const outlineRowSurface = "linear-gradient(145deg, rgba(250, 253, 255, 0.96), rgba(232, 238, 248, 0.9))";
  const toolbarActiveBackground = `linear-gradient(135deg, rgba(92,238,255,0.78) 0%, ${colorWithAlpha(outlineMenuAccent, 0.66)} 48%, rgba(183,124,255,0.70) 100%)`;
  const toolbarHoverBackground = "linear-gradient(135deg, rgba(255,255,255,0.94) 0%, rgba(92,238,255,0.40) 48%, rgba(183,124,255,0.34) 100%)";
  const outlineRowHoverSurface = toolbarHoverBackground;
  const outlineRowSelectedSurface = `linear-gradient(135deg, rgba(92,238,255,0.58), ${colorWithAlpha(outlineMenuAccent, 0.46)} 50%, rgba(183,124,255,0.52))`;
  const tabHoverBackground = toolbarHoverBackground;
  const tabSelectedBackgroundVibrant = toolbarActiveBackground;
  const tabHoverShadow = "0 8px 20px rgba(15, 23, 42, 0.14), 0 0 16px rgba(92, 238, 255, 0.26), 0 0 18px rgba(183, 124, 255, 0.24), inset 1px 1px 0 rgba(255,255,255,0.78)";
  const visibleTabs = visibleTabIDs ? EDITOR_TAB_ITEMS.filter((tab) => visibleTabIDs.includes(tab.id)) : EDITOR_TAB_ITEMS;
  const primaryTabs = visibleTabs.filter((tab) => EDITOR_PRIMARY_HEADER_TAB_IDS.includes(tab.id));
  const overflowTabs = visibleTabs.filter((tab) => EDITOR_OVERFLOW_HEADER_TAB_IDS.includes(tab.id));
  const hasOverflowActions = overflowTabs.length > 0 || secondaryActions.length > 0 || Boolean(onSaveCurrentVersion) || Boolean(onCreateRelatedNode);
  const formatControlsDisabled = disabled || formattingDisabled;

  useEffect(() => {
    setFontSizeDraft(String(documentFontSize));
  }, [documentFontSize]);

  useEffect(() => {
    if (formatControlsDisabled) setHighlightMenuOpen(false);
  }, [formatControlsDisabled]);

  useAppFloatingMenuDismissal(outlineMenuOpen, outlineMenuRef, () => setOutlineMenuOpen(false));
  useAppFloatingMenuDismissal(highlightMenuOpen, highlightMenuRef, () => setHighlightMenuOpen(false));
  useAppFloatingMenuDismissal(overflowMenuOpen, overflowMenuRef, () => setOverflowMenuOpen(false));

  const commitFontSizeDraft = () => {
    const parsed = Number.parseInt(fontSizeDraft, 10);
    if (!Number.isFinite(parsed)) {
      setFontSizeDraft(String(documentFontSize));
      return;
    }
    const nextFontSize = Math.max(EDITOR_DOCUMENT_MIN_FONT_SIZE_PX, Math.min(EDITOR_DOCUMENT_MAX_FONT_SIZE_PX, parsed));
    setFontSizeDraft(String(nextFontSize));
    onSetSelectionFontSize(nextFontSize);
  };

  useEffect(() => {
    if (!onRelationshipTabAnchorChange) return;
    const measure = () => {
      const element = relationshipTabRef.current;
      if (!element) {
        onRelationshipTabAnchorChange(null);
        return;
      }
      const rect = element.getBoundingClientRect();
      onRelationshipTabAnchorChange({ left: rect.left, width: rect.width });
    };
    measure();
    const element = relationshipTabRef.current;
    const observer = element && typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (element) observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [activeTab, onRelationshipTabAnchorChange]);

  const currentOutlineStyleLabel = EDITOR_OUTLINE_STYLE_ITEMS.find((item) => item.id === outlineStyle)?.label ?? "Outline Styles";
  const tabStyleFor = (selected: boolean, hovered: boolean): React.CSSProperties => ({
    flex: "0 0 auto",
    whiteSpace: "nowrap",
    border: `1px solid ${selected || hovered ? "transparent" : strokeColor}`,
    background: selected
      ? `${tabSelectedBackgroundVibrant} padding-box, ${tabFrameBackground} border-box`
      : hovered
        ? `${tabHoverBackground} padding-box, ${tabFrameBackground} border-box`
        : tabBackground,
    color: selected ? "#0f172a" : surfaceText,
    fontSize: 10,
    fontWeight: selected ? 800 : 500,
    letterSpacing: 0,
    padding: "4px 10px",
    borderRadius: 8,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.54 : 1,
    boxShadow: selected || hovered ? tabHoverShadow : "none",
    transform: hovered && !selected ? "translateY(-1px)" : "translateY(0)",
    transition: "background 140ms ease, border-color 140ms ease, box-shadow 160ms ease, transform 160ms ease, color 140ms ease",
  });
  const formatControlDivider = `1px solid ${colorWithAlpha(strokeColor, 0.92)}`;
  const formatControlHoverBackground = toolbarHoverBackground;
  const formatControlStyle = (id: EditorFormatControlID, options: { active?: boolean; withRightBorder?: boolean; width?: number; fontSize?: number } = {}): React.CSSProperties => {
    const active = options.active ?? false;
    const hovered = hoveredFormatControl === id && !formatControlsDisabled;
    return {
      width: options.width ?? 28,
      height: 24,
      border: 0,
      borderRight: options.withRightBorder === false ? 0 : formatControlDivider,
      background: active
        ? toolbarActiveBackground
        : hovered ? formatControlHoverBackground : "transparent",
      color: active ? "#0f172a" : surfaceText,
      display: "grid",
      placeItems: "center",
      cursor: formatControlsDisabled ? "default" : "pointer",
      opacity: formatControlsDisabled ? 0.54 : 1,
      fontSize: options.fontSize ?? 12,
      fontWeight: 900,
      lineHeight: 1,
      boxShadow: active
        ? `inset 0 0 0 1px ${colorWithAlpha(outlineMenuAccent, 0.78)}, 0 0 0 1px rgba(92,238,255,0.34), 0 0 12px rgba(183,124,255,0.32)`
        : hovered ? "inset 1px 1px 3px rgba(15,23,42,0.08), inset -1px -1px 3px rgba(255,255,255,0.74), 0 0 10px rgba(92,238,255,0.22)" : undefined,
      transition: "background 130ms ease, box-shadow 130ms ease, color 130ms ease",
    };
  };
  const formatControlHoverHandlers = (id: EditorFormatControlID) => ({
    onMouseEnter: () => setHoveredFormatControl(id),
    onMouseLeave: () => setHoveredFormatControl((current) => (current === id ? null : current)),
  });
  const inlineFormatButtonStyle = (id: EditorFormatControlID, active: boolean): React.CSSProperties => (
    formatControlStyle(id, { active })
  );
  const preserveEditorSelection: React.PointerEventHandler<HTMLElement> = (event) => event.preventDefault();
  const toggleHeaderMenu = (menu: "outline" | "highlight" | "overflow") => {
    const opening = menu === "outline" ? !outlineMenuOpen : menu === "highlight" ? !highlightMenuOpen : !overflowMenuOpen;
    setOutlineMenuOpen(menu === "outline" && opening);
    setHighlightMenuOpen(menu === "highlight" && opening);
    setOverflowMenuOpen(menu === "overflow" && opening);
    if (menu === "overflow" && opening) {
      window.requestAnimationFrame(() => overflowMenuRef.current?.querySelector<HTMLButtonElement>('[data-mango-editor-header-overflow-menu] button:not(:disabled)')?.focus({ preventScroll: true }));
    }
  };
  const runOverflowAction = (action: () => void) => {
    setOverflowMenuOpen(false);
    overflowTriggerRef.current?.focus({ preventScroll: true });
    action();
  };

  return (
    <div
      role="toolbar"
      aria-label="Editor header controls"
      data-mango-editor-header="true"
      data-mango-editor-header-primary={primaryTabs.map((tab) => tab.id).join(" ")}
      data-mango-unified-editor-toolbar="true"
      data-mango-unified-editor-toolbar-tabs={visibleTabs.map((tab) => tab.id).join(" ")}
      style={{ position: "relative", zIndex: 4, display: "flex", alignItems: "center", flexWrap: singleLine ? "nowrap" : "wrap", gap: 6, paddingLeft: reserveHeaderOffset ? 106 : 0, overflow: "visible", scrollbarWidth: "none", pointerEvents: "auto", minWidth: singleLine ? "max-content" : undefined }}
    >
      {primaryTabs.map((tab) => {
        const selected = activeTab === tab.id;
        const hovered = hoveredTabID === tab.id;
        const tabStyle = tabStyleFor(selected, hovered);

        if (tab.id === "format") {
          return (
            <div
              key={tab.id}
              ref={highlightMenuRef}
              role="group"
              aria-label="Format controls"
              data-mango-editor-format-group="true"
              style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 0, padding: 0, overflow: "visible", flex: "0 0 auto", border: `1px solid ${strokeColor}`, borderRadius: 8, background: tabBackground }}
            >
              <button
                type="button"
                aria-label="Decrease font size"
                title="Decrease font size"
                disabled={formatControlsDisabled}
                data-mango-editor-format-control="decrease-font"
                {...formatControlHoverHandlers("decrease-font")}
                onPointerDown={preserveEditorSelection}
                onClick={(event) => {
                  event.stopPropagation();
                  if (formatControlsDisabled) return;
                  onAdjustSelectionFontSize(-1);
                }}
                style={formatControlStyle("decrease-font", { width: 30, fontSize: 17 })}
              >
                -
              </button>
              <input
                aria-label="Font size value"
                value={fontSizeDraft}
                disabled={formatControlsDisabled}
                data-mango-editor-format-control="font-size"
                onMouseEnter={() => setHoveredFormatControl("font-size")}
                onMouseLeave={() => setHoveredFormatControl((current) => (current === "font-size" ? null : current))}
                onFocus={() => {
                  cancelFontSizeCommitRef.current = false;
                  setHoveredFormatControl("font-size");
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.currentTarget.select()}
                onChange={(event) => {
                  cancelFontSizeCommitRef.current = false;
                  setFontSizeDraft(event.target.value.replace(/[^\d]/g, "").slice(0, 2));
                }}
                onBlur={() => {
                  if (cancelFontSizeCommitRef.current) {
                    cancelFontSizeCommitRef.current = false;
                    setFontSizeDraft(String(documentFontSize));
                  } else {
                    commitFontSizeDraft();
                  }
                  setHoveredFormatControl((current) => (current === "font-size" ? null : current));
                }}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelFontSizeCommitRef.current = true;
                    setFontSizeDraft(String(documentFontSize));
                    event.currentTarget.select();
                  }
                }}
                style={{ ...formatControlStyle("font-size", { width: 34 }), cursor: formatControlsDisabled ? "default" : "text", textAlign: "center", font: "inherit", fontSize: 10, fontWeight: 500, padding: 0 }}
              />
              <button
                type="button"
                aria-label="Increase font size"
                title="Increase font size"
                disabled={formatControlsDisabled}
                data-mango-editor-format-control="increase-font"
                {...formatControlHoverHandlers("increase-font")}
                onPointerDown={preserveEditorSelection}
                onClick={(event) => {
                  event.stopPropagation();
                  if (formatControlsDisabled) return;
                  onAdjustSelectionFontSize(1);
                }}
                style={formatControlStyle("increase-font", { width: 30, fontSize: 17 })}
              >
                +
              </button>
              <button
                type="button"
                aria-label="Bold"
                title="Bold"
                aria-pressed={boldActive}
                disabled={formatControlsDisabled}
                data-mango-editor-format-control="bold"
                {...formatControlHoverHandlers("bold")}
                onPointerDown={preserveEditorSelection}
                onClick={(event) => {
                  event.stopPropagation();
                  if (formatControlsDisabled) return;
                  onToggleBold();
                }}
                style={inlineFormatButtonStyle("bold", boldActive)}
              >
                B
              </button>
              <button
                type="button"
                aria-label="Underline"
                title="Underline"
                aria-pressed={underlineActive}
                disabled={formatControlsDisabled}
                data-mango-editor-format-control="underline"
                {...formatControlHoverHandlers("underline")}
                onPointerDown={preserveEditorSelection}
                onClick={(event) => {
                  event.stopPropagation();
                  if (formatControlsDisabled) return;
                  onToggleUnderline();
                }}
                style={inlineFormatButtonStyle("underline", underlineActive)}
              >
                <span style={{ textDecoration: "underline", textUnderlineOffset: 2 }}>U</span>
              </button>
              <button
                type="button"
                aria-label="Italic"
                title="Italic"
                aria-pressed={italicActive}
                disabled={formatControlsDisabled}
                data-mango-editor-format-control="italic"
                {...formatControlHoverHandlers("italic")}
                onPointerDown={preserveEditorSelection}
                onClick={(event) => {
                  event.stopPropagation();
                  if (formatControlsDisabled) return;
                  onToggleItalic();
                }}
                style={inlineFormatButtonStyle("italic", italicActive)}
              >
                <span style={{ fontStyle: "italic" }}>I</span>
              </button>
              <button
                type="button"
                aria-label="Strikethrough"
                title="Strikethrough"
                aria-pressed={strikethroughActive}
                disabled={formatControlsDisabled}
                data-mango-editor-format-control="strikethrough"
                {...formatControlHoverHandlers("strikethrough")}
                onPointerDown={preserveEditorSelection}
                onClick={(event) => {
                  event.stopPropagation();
                  if (formatControlsDisabled) return;
                  onToggleStrikethrough();
                }}
                style={inlineFormatButtonStyle("strikethrough", strikethroughActive)}
              >
                <span aria-hidden="true" style={{ textDecoration: "line-through", textDecorationThickness: 2, textDecorationColor: "currentColor" }}>A</span>
              </button>
              <span role="group" aria-label="Text highlight" style={{ display: "inline-flex", alignItems: "stretch" }}>
                <button
                  type="button"
                  aria-label="Apply text highlight"
                  title="Apply text highlight"
                  aria-pressed={highlightColor === customHighlightColor}
                  disabled={formatControlsDisabled}
                  data-mango-editor-format-control="highlight"
                  {...formatControlHoverHandlers("highlight")}
                  onPointerDown={preserveEditorSelection}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!formatControlsDisabled) {
                      onSetSelectionHighlightColor(highlightColor === customHighlightColor ? null : customHighlightColor);
                    }
                  }}
                  style={{
                    ...formatControlStyle("highlight", { active: highlightColor === customHighlightColor, width: 29 }),
                    borderRight: 0,
                  }}
                >
                  <span aria-hidden="true" style={{ width: 13, height: 13, display: "grid", placeItems: "center", borderBottom: `4px solid ${customHighlightColor}`, fontSize: 10, lineHeight: 1 }}>A</span>
                </button>
                <button
                  type="button"
                  aria-label="Choose highlight color"
                  title="Choose highlight color"
                  aria-haspopup="menu"
                  aria-expanded={highlightMenuOpen}
                  disabled={formatControlsDisabled}
                  data-mango-editor-format-control="highlight-menu"
                  {...formatControlHoverHandlers("highlight-menu")}
                  onPointerDown={preserveEditorSelection}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!formatControlsDisabled) toggleHeaderMenu("highlight");
                  }}
                  style={{
                    ...formatControlStyle("highlight-menu", { active: highlightMenuOpen, width: 18 }),
                    borderLeft: `1px solid ${colorWithAlpha(strokeColor, 0.72)}`,
                  }}
                >
                  <EditorDisclosureIcon color={surfaceText} />
                </button>
              </span>
              {highlightMenuOpen && (
                <div
                  role="menu"
                  aria-label="Text highlight colors"
                  onPointerDown={(event) => event.stopPropagation()}
                  style={{
                    position: "absolute",
                    top: "calc(100% + 5px)",
                    right: 0,
                    zIndex: 40,
                    width: 214,
                    display: "grid",
                    gap: 8,
                    padding: 9,
                    border: `1px solid ${strokeColor}`,
                    borderRadius: 10,
                    background: outlineMenuSurface,
                    boxShadow: `9px 9px 22px ${colorWithAlpha("#64748b", 0.26)}, -7px -7px 18px rgba(255, 255, 255, 0.92)`,
                  }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 7 }}>
                    {EDITOR_HIGHLIGHT_COLOR_ITEMS.map((item) => {
                      const colorSelected = highlightColor === item.color;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          role="menuitemradio"
                          aria-label={`${item.label} highlight`}
                          aria-checked={colorSelected}
                          title={item.label}
                          onPointerDown={preserveEditorSelection}
                          onClick={() => {
                            onSetSelectionHighlightColor(item.color);
                            setCustomHighlightColor(item.color);
                            setHighlightMenuOpen(false);
                          }}
                          style={{
                            width: 40,
                            height: 28,
                            border: colorSelected ? `2px solid ${outlineMenuAccent}` : `1px solid ${strokeColor}`,
                            borderRadius: 7,
                            background: item.color,
                            cursor: "pointer",
                            boxShadow: colorSelected ? `0 0 0 2px ${colorWithAlpha(outlineMenuAccent, 0.16)}` : "inset 1px 1px 0 rgba(255,255,255,0.7)",
                          }}
                        />
                      );
                    })}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 7, alignItems: "center" }}>
                    <label style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 7, fontSize: 10, fontWeight: 750 }}>
                      <input
                        type="color"
                        aria-label="Custom highlight color"
                        value={customHighlightColor}
                        onChange={(event) => {
                          const color = normalizeEditorHighlightColor(event.currentTarget.value);
                          if (!color) return;
                          setCustomHighlightColor(color);
                          onSetSelectionHighlightColor(color);
                        }}
                        style={{ width: 32, height: 26, border: 0, padding: 0, background: "transparent", cursor: "pointer" }}
                      />
                      <span>Custom</span>
                    </label>
                    <button
                      type="button"
                      role="menuitem"
                      aria-label="No highlight"
                      title="No highlight"
                      onPointerDown={preserveEditorSelection}
                      onClick={() => {
                        onSetSelectionHighlightColor(null);
                        setHighlightMenuOpen(false);
                      }}
                      style={{ minHeight: 27, border: `1px solid ${strokeColor}`, borderRadius: 7, background: "rgba(255,255,255,0.78)", color: surfaceText, padding: "0 8px", cursor: "pointer", fontSize: 10, fontWeight: 800 }}
                    >
                      No highlight
                    </button>
                  </div>
                </div>
              )}
              {(["left", "center", "right"] as const).map((alignment) => {
                const controlID = `align-${alignment}` as const;
                const label = `Align ${alignment}`;
                const active = textAlignment === alignment;
                return (
                  <button
                    key={alignment}
                    type="button"
                    aria-label={label}
                    title={label}
                    aria-pressed={active}
                    disabled={formatControlsDisabled}
                    data-mango-editor-format-control={controlID}
                    {...formatControlHoverHandlers(controlID)}
                    onPointerDown={preserveEditorSelection}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!formatControlsDisabled) onSetTextAlignment(alignment);
                    }}
                    style={inlineFormatButtonStyle(controlID, active)}
                  >
                    <EditorAlignmentIcon alignment={alignment} color={active ? outlineMenuAccent : surfaceText} />
                  </button>
                );
              })}
              {onInsertTable && (
                <button
                  type="button"
                  aria-label="Insert table"
                  title="Insert table"
                  disabled={formatControlsDisabled}
                  data-mango-editor-format-control="table"
                  {...formatControlHoverHandlers("table")}
                  onPointerDown={preserveEditorSelection}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!formatControlsDisabled) onInsertTable();
                  }}
                  style={{ ...formatControlStyle("table", { withRightBorder: false }), borderRadius: "0 8px 8px 0" }}
                >
                  <EditorTableIcon color={surfaceText} />
                </button>
              )}
            </div>
          );
        }

        if (tab.id === "outline-styles") {
          return (
            <div
              key={tab.id}
              ref={outlineMenuRef}
              onMouseEnter={() => setHoveredTabID(tab.id)}
              onMouseLeave={() => setHoveredTabID((current) => (current === tab.id ? null : current))}
              style={{ position: "relative", flex: "0 0 auto" }}
            >
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={outlineMenuOpen}
                aria-label="Outline styles"
                disabled={disabled}
                onClick={() => {
                  if (disabled) return;
                  onOutlineStyleFocus();
                  toggleHeaderMenu("outline");
                }}
                style={{ ...tabStyle, display: "inline-flex", alignItems: "center", gap: 6, paddingRight: 7 }}
              >
                <span>{currentOutlineStyleLabel}</span>
                <EditorDisclosureIcon color={surfaceText} />
              </button>
              {outlineMenuOpen && (
                <div
                  role="menu"
                  aria-label="Outline styles"
                  style={{
                    position: "absolute",
                    top: "calc(100% + 5px)",
                    left: 0,
                    minWidth: 214,
                    padding: 8,
                    border: `1px solid rgba(255, 255, 255, 0.72)`,
                    borderRadius: 10,
                    background: outlineMenuSurface,
                    boxShadow: `9px 9px 22px ${colorWithAlpha("#64748b", 0.26)}, -7px -7px 18px rgba(255, 255, 255, 0.92), inset 1px 1px 0 rgba(255, 255, 255, 0.9), inset -1px -1px 0 ${colorWithAlpha("#64748b", 0.12)}`,
                    display: "grid",
                    gap: 6,
                  }}
                >
                  {EDITOR_OUTLINE_STYLE_ITEMS.map((item) => {
                    const itemSelected = item.id === outlineStyle;
                    const itemHovered = item.id === hoveredOutlineStyle;
                    const itemIconPalette = outlineStyleIconPalette(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={itemSelected}
                        disabled={disabled}
                        onMouseEnter={() => setHoveredOutlineStyle(item.id)}
                        onMouseLeave={() => setHoveredOutlineStyle(null)}
                        onClick={() => {
                          if (disabled) return;
                          onOutlineStyleChange(item.id);
                          setOutlineMenuOpen(false);
                        }}
                        style={{
                          width: "100%",
                          minHeight: 32,
                          border: `1px solid ${itemSelected || itemHovered ? "transparent" : "rgba(255, 255, 255, 0.58)"}`,
                          borderRadius: 8,
                          background: itemSelected
                            ? `${outlineRowSelectedSurface} padding-box, ${tabFrameBackground} border-box`
                            : itemHovered
                              ? `${outlineRowHoverSurface} padding-box, ${tabFrameBackground} border-box`
                              : outlineRowSurface,
                          boxShadow: itemSelected
                            ? `inset 3px 3px 7px ${colorWithAlpha("#64748b", 0.2)}, inset -3px -3px 7px rgba(255, 255, 255, 0.82)`
                            : itemHovered
                              ? `5px 5px 12px ${colorWithAlpha("#64748b", 0.2)}, -5px -5px 12px rgba(255, 255, 255, 0.9)`
                              : `2px 2px 6px ${colorWithAlpha("#64748b", 0.15)}, -2px -2px 6px rgba(255, 255, 255, 0.86)`,
                          color: surfaceText,
                          display: "grid",
                          gridTemplateColumns: "24px minmax(0, 1fr) 18px",
                          alignItems: "center",
                          gap: 9,
                          padding: "5px 7px 5px 7px",
                          cursor: "pointer",
                          textAlign: "left",
                          fontSize: 11,
                          fontWeight: itemSelected ? 800 : 700,
                          transition: "background 150ms ease, box-shadow 150ms ease, border-color 150ms ease, transform 150ms ease",
                          transform: itemHovered && !itemSelected ? "translateY(-1px)" : "translateY(0)",
                        }}
                      >
                        <span
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: 7,
                            display: "grid",
                            placeItems: "center",
                            background: itemSelected || itemHovered ? "rgba(255, 255, 255, 0.74)" : "rgba(246, 249, 253, 0.78)",
                            boxShadow: itemSelected
                              ? `inset 2px 2px 4px ${colorWithAlpha("#64748b", 0.16)}, inset -2px -2px 4px rgba(255, 255, 255, 0.82)`
                              : `2px 2px 5px ${colorWithAlpha("#64748b", 0.18)}, -2px -2px 5px rgba(255, 255, 255, 0.9)`,
                          }}
                        >
                          <EditorOutlineStyleIcon id={item.id} color={itemIconPalette.color} accent={itemIconPalette.accent} />
                        </span>
                        <span>{item.label}</span>
                        <span style={{ display: "grid", placeItems: "center", color: outlineMenuAccent }}>
                          {itemSelected ? <EditorCheckIcon color={outlineMenuAccent} /> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        }

        return (
          <button
            key={tab.id}
            type="button"
            onMouseEnter={() => setHoveredTabID(tab.id)}
            onMouseLeave={() => setHoveredTabID((current) => (current === tab.id ? null : current))}
            disabled={disabled}
            onClick={() => {
              if (!disabled) onSelectTab(tab.id);
            }}
            style={tabStyle}
          >
            {tab.label}
          </button>
        );
      })}
      {hasOverflowActions && (
        <div ref={overflowMenuRef} data-mango-editor-header-overflow="true" style={{ position: "relative", flex: "0 0 auto", marginLeft: singleLine ? 0 : "auto" }}>
          <button
            ref={(element) => {
              overflowTriggerRef.current = element;
              relationshipTabRef.current = overflowTabs.some((tab) => tab.id === "relationships") ? element : null;
            }}
            type="button"
            aria-label="More editor actions"
            aria-haspopup="menu"
            aria-expanded={overflowMenuOpen}
            title="More editor actions"
            data-mango-editor-header-overflow-trigger="true"
            onMouseEnter={() => setHoveredTabID("overflow")}
            onMouseLeave={() => setHoveredTabID((current) => (current === "overflow" ? null : current))}
            onClick={() => toggleHeaderMenu("overflow")}
            style={{
              minWidth: 58,
              height: 24,
              border: `1px solid ${overflowMenuOpen || hoveredTabID === "overflow" ? "transparent" : strokeColor}`,
              borderRadius: 8,
              background: overflowMenuOpen
                ? `${tabSelectedBackground} padding-box, ${tabFrameBackground} border-box`
                : hoveredTabID === "overflow"
                  ? `${tabHoverBackground} padding-box, ${tabFrameBackground} border-box`
                  : tabBackground,
              color: accent,
              cursor: "pointer",
              fontSize: 10,
              fontWeight: 750,
              lineHeight: 1,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
              padding: "0 8px",
              boxShadow: overflowMenuOpen || hoveredTabID === "overflow" ? tabHoverShadow : "none",
              transition: "background 140ms ease, border-color 140ms ease, box-shadow 160ms ease",
            }}
          >
            <span>More</span>
            <EditorDisclosureIcon color={surfaceText} />
          </button>
          {overflowMenuOpen && (
            <div
              role="menu"
              aria-label="More editor actions"
              data-mango-editor-header-overflow-menu="true"
              onKeyDown={(event) => {
                if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
                if (items.length === 0) return;
                const currentIndex = items.indexOf(event.target as HTMLButtonElement);
                const nextIndex = event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? items.length - 1
                    : event.key === "ArrowUp"
                      ? (currentIndex <= 0 ? items.length - 1 : currentIndex - 1)
                      : (currentIndex + 1) % items.length;
                items[nextIndex]?.focus();
              }}
              style={{
                position: "absolute",
                top: "calc(100% + 5px)",
                right: 0,
                width: 220,
                padding: 5,
                border: `1px solid ${strokeColor}`,
                borderRadius: 6,
                background: tabSelectedBackground,
                boxShadow: `0 12px 28px ${colorWithAlpha("#0f172a", 0.18)}`,
                display: "grid",
                gap: 3,
              }}
            >
              {overflowTabs.map((tab) => {
                const selected = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    disabled={disabled}
                    data-mango-editor-header-overflow-action={tab.id}
                    onClick={() => {
                      if (disabled) return;
                      runOverflowAction(() => onSelectTab(tab.id));
                    }}
                    style={{ width: "100%", minHeight: 30, border: 0, borderRadius: 5, background: selected ? colorWithAlpha(outlineMenuAccent, 0.14) : "transparent", color: surfaceText, cursor: disabled ? "default" : "pointer", textAlign: "left", padding: "6px 9px", fontSize: 11, fontWeight: selected ? 800 : 700 }}
                  >
                    {tab.label}
                  </button>
                );
              })}
              {secondaryActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  role="menuitem"
                  disabled={action.disabled}
                  data-mango-editor-header-overflow-action={action.id}
                  onClick={() => {
                    if (action.disabled) return;
                    runOverflowAction(action.onSelect);
                  }}
                  style={{ width: "100%", minHeight: 30, border: 0, borderRadius: 5, background: "transparent", color: action.disabled ? colorWithAlpha(surfaceText, 0.46) : surfaceText, cursor: action.disabled ? "default" : "pointer", textAlign: "left", padding: "6px 9px", fontSize: 11, fontWeight: 700 }}
                >
                  {action.label}
                </button>
              ))}
              {onSaveCurrentVersion && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={saveCurrentVersionDisabled || saveCurrentVersionBusy}
                  data-mango-editor-header-overflow-action="save-version"
                  onClick={() => runOverflowAction(onSaveCurrentVersion)}
                  style={{ width: "100%", minHeight: 30, border: 0, borderRadius: 5, background: "transparent", color: saveCurrentVersionDisabled || saveCurrentVersionBusy ? colorWithAlpha(surfaceText, 0.46) : accent, cursor: saveCurrentVersionDisabled || saveCurrentVersionBusy ? "default" : "pointer", textAlign: "left", padding: "6px 9px", fontSize: 11, fontWeight: 750 }}
                >
                  {saveCurrentVersionBusy ? "Saving version" : "Save version"}
                </button>
              )}
              {onCreateRelatedNode && (
                <>
                  {(overflowTabs.length > 0 || secondaryActions.length > 0 || onSaveCurrentVersion) && <div role="separator" style={{ height: 1, margin: "3px 5px", background: colorWithAlpha(strokeColor, 0.72) }} />}
              {[
                ["parent", "Create parent node"],
                ["peer", "Create peer node"],
                ["child", "Create child node"],
              ].map(([kind, label]) => (
                <button
                  key={kind}
                  type="button"
                  role="menuitem"
                  onClick={() => runOverflowAction(() => onCreateRelatedNode(kind as EditorRelatedNodeCreationKind))}
                  style={{
                    width: "100%",
                    minHeight: 28,
                    border: 0,
                    borderRadius: 4,
                    background: "transparent",
                    color: surfaceText,
                    cursor: "pointer",
                    textAlign: "left",
                    padding: "6px 8px",
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: 0,
                  }}
                >
                  {label}
                </button>
              ))}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
