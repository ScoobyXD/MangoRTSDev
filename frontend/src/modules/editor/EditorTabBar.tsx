import React, { useEffect, useRef, useState } from "react";
import { EDITOR_TAB_ITEMS, type EditorRelatedNodeCreationKind, type EditorTabID } from "./editorTabs";
import type { EditorOutlineStyleID } from "./plainTextEditing";
import { EDITOR_DOCUMENT_MAX_FONT_SIZE_PX, EDITOR_DOCUMENT_MIN_FONT_SIZE_PX, EDITOR_OUTLINE_STYLE_ITEMS } from "./useEditorPreferences";

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
        <path d="M8 5h7M8 9h7M8 13h7" fill="none" stroke={color} strokeWidth="1.45" strokeLinecap="round" />
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
  onOutlineStyleFocus: () => void;
  onOutlineStyleChange: (outlineStyle: EditorOutlineStyleID) => void;
  onCreateRelatedNode?: (kind: EditorRelatedNodeCreationKind) => void;
  onInsertTable?: () => void;
  onRelationshipTabAnchorChange?: (anchor: { left: number; width: number } | null) => void;
  reserveHeaderOffset?: boolean;
};

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
  onOutlineStyleFocus,
  onOutlineStyleChange,
  onCreateRelatedNode,
  onInsertTable,
  onRelationshipTabAnchorChange,
  reserveHeaderOffset = true,
}) => {
  const [outlineMenuOpen, setOutlineMenuOpen] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [hoveredTabID, setHoveredTabID] = useState<EditorTabID | "create" | null>(null);
  const [hoveredOutlineStyle, setHoveredOutlineStyle] = useState<EditorOutlineStyleID | null>(null);
  const [fontSizeDraft, setFontSizeDraft] = useState(String(documentFontSize));
  const outlineMenuRef = useRef<HTMLDivElement | null>(null);
  const createMenuRef = useRef<HTMLDivElement | null>(null);
  const relationshipTabRef = useRef<HTMLButtonElement | null>(null);
  const outlineMenuSurface = "linear-gradient(145deg, rgba(248, 251, 255, 0.98), rgba(230, 236, 246, 0.96))";
  const outlineRowSurface = "linear-gradient(145deg, rgba(250, 253, 255, 0.96), rgba(232, 238, 248, 0.9))";
  const outlineRowHoverSurface = "linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(237, 244, 252, 0.94))";
  const outlineRowSelectedSurface = `linear-gradient(145deg, ${colorWithAlpha(outlineMenuAccent, 0.17)}, rgba(255, 255, 255, 0.84))`;
  const tabFrameBackground = "linear-gradient(135deg, rgba(92, 238, 255, 0.92) 0%, rgba(128, 216, 255, 0.82) 34%, rgba(183, 124, 255, 0.88) 72%, rgba(255, 255, 255, 0.86) 100%)";
  const tabHoverBackground = "linear-gradient(135deg, rgba(255,255,255,0.92), rgba(230,252,255,0.58) 46%, rgba(247,239,255,0.66))";
  const tabHoverShadow = "0 8px 20px rgba(15, 23, 42, 0.12), 0 0 14px rgba(183, 124, 255, 0.18), inset 1px 1px 0 rgba(255,255,255,0.86)";

  useEffect(() => {
    setFontSizeDraft(String(documentFontSize));
  }, [documentFontSize]);

  const commitFontSizeDraft = () => {
    const parsed = Number.parseInt(fontSizeDraft, 10);
    if (!Number.isFinite(parsed)) {
      setFontSizeDraft(String(documentFontSize));
      return;
    }
    onSetSelectionFontSize(Math.max(EDITOR_DOCUMENT_MIN_FONT_SIZE_PX, Math.min(EDITOR_DOCUMENT_MAX_FONT_SIZE_PX, parsed)));
  };

  useEffect(() => {
    if (!outlineMenuOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (outlineMenuRef.current?.contains(event.target as Node)) return;
      setOutlineMenuOpen(false);
    };
    window.addEventListener("pointerdown", closeOnPointerDown);
    return () => window.removeEventListener("pointerdown", closeOnPointerDown);
  }, [outlineMenuOpen]);

  useEffect(() => {
    if (!createMenuOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (createMenuRef.current?.contains(event.target as Node)) return;
      setCreateMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCreateMenuOpen(false);
    };
    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [createMenuOpen]);

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
      ? `${tabSelectedBackground} padding-box, ${tabFrameBackground} border-box`
      : hovered
        ? `${tabHoverBackground} padding-box, ${tabFrameBackground} border-box`
        : tabBackground,
    color: surfaceText,
    fontSize: 10,
    fontWeight: selected ? 650 : 500,
    letterSpacing: 0,
    padding: "4px 10px",
    borderRadius: 8,
    cursor: "pointer",
    boxShadow: selected || hovered ? tabHoverShadow : "none",
    transform: hovered && !selected ? "translateY(-1px)" : "translateY(0)",
    transition: "background 140ms ease, border-color 140ms ease, box-shadow 160ms ease, transform 160ms ease, color 140ms ease",
  });

  return (
    <div style={{ position: "relative", zIndex: 4, display: "flex", alignItems: "center", gap: 6, paddingLeft: reserveHeaderOffset ? 106 : 0, overflow: "visible", scrollbarWidth: "none", pointerEvents: "auto" }}>
      {EDITOR_TAB_ITEMS.map((tab) => {
        const selected = activeTab === tab.id;
        const hovered = hoveredTabID === tab.id;
        const tabStyle = tabStyleFor(selected, hovered);

        if (tab.id === "format") {
          return (
            <div
              key={tab.id}
              aria-label="Font size"
              onMouseEnter={() => setHoveredTabID(tab.id)}
              onMouseLeave={() => setHoveredTabID((current) => (current === tab.id ? null : current))}
              style={{ ...tabStyle, display: "inline-flex", alignItems: "center", gap: 0, padding: 0, overflow: "hidden" }}
            >
              <button
                type="button"
                aria-label="Decrease font size"
                title="Decrease font size"
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  event.stopPropagation();
                  onAdjustSelectionFontSize(-1);
                }}
                style={{ width: 30, height: 24, border: 0, borderRight: `1px solid ${strokeColor}`, background: "transparent", color: surfaceText, display: "grid", placeItems: "center", cursor: "pointer", fontSize: 17, lineHeight: 1 }}
              >
                -
              </button>
              <input
                aria-label="Font size value"
                value={fontSizeDraft}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.currentTarget.select()}
                onChange={(event) => setFontSizeDraft(event.target.value.replace(/[^\d]/g, "").slice(0, 2))}
                onBlur={commitFontSizeDraft}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    setFontSizeDraft(String(documentFontSize));
                    event.currentTarget.blur();
                  }
                }}
                style={{ width: 34, height: 24, border: 0, borderRight: `1px solid ${strokeColor}`, background: "transparent", color: surfaceText, textAlign: "center", outline: "none", font: "inherit", fontSize: 10, fontWeight: 500, padding: 0 }}
              />
              <button
                type="button"
                aria-label="Increase font size"
                title="Increase font size"
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  event.stopPropagation();
                  onAdjustSelectionFontSize(1);
                }}
                style={{ width: 30, height: 24, border: 0, background: "transparent", color: surfaceText, display: "grid", placeItems: "center", cursor: "pointer", fontSize: 17, lineHeight: 1 }}
              >
                +
              </button>
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
                onClick={() => {
                  onOutlineStyleFocus();
                  setOutlineMenuOpen((open) => !open);
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
                    const itemIconColor = item.id === "bullet-list" ? "#000000" : itemSelected ? outlineMenuAccent : surfaceText;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={itemSelected}
                        onMouseEnter={() => setHoveredOutlineStyle(item.id)}
                        onMouseLeave={() => setHoveredOutlineStyle(null)}
                        onClick={() => {
                          onOutlineStyleChange(item.id);
                          setOutlineMenuOpen(false);
                        }}
                        style={{
                          width: "100%",
                          minHeight: 32,
                          border: `1px solid ${itemSelected ? colorWithAlpha(outlineMenuAccent, 0.26) : "rgba(255, 255, 255, 0.58)"}`,
                          borderRadius: 8,
                          background: itemSelected ? outlineRowSelectedSurface : itemHovered ? outlineRowHoverSurface : outlineRowSurface,
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
                            background: itemSelected ? "rgba(255, 255, 255, 0.58)" : "rgba(246, 249, 253, 0.78)",
                            boxShadow: itemSelected
                              ? `inset 2px 2px 4px ${colorWithAlpha("#64748b", 0.16)}, inset -2px -2px 4px rgba(255, 255, 255, 0.82)`
                              : `2px 2px 5px ${colorWithAlpha("#64748b", 0.18)}, -2px -2px 5px rgba(255, 255, 255, 0.9)`,
                          }}
                        >
                          <EditorOutlineStyleIcon id={item.id} color={itemIconColor} accent={outlineMenuAccent} />
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
            ref={tab.id === "relationships" ? relationshipTabRef : undefined}
            type="button"
            onMouseEnter={() => setHoveredTabID(tab.id)}
            onMouseLeave={() => setHoveredTabID((current) => (current === tab.id ? null : current))}
            onClick={() => onSelectTab(tab.id)}
            style={tabStyle}
          >
            {tab.label}
          </button>
        );
      })}
      {onInsertTable && (
        <button
          type="button"
          aria-label="Insert table"
          title="Insert table"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onInsertTable}
          style={{ ...tabStyleFor(false, false), width: 30, height: 26, display: "grid", placeItems: "center", padding: 0 }}
        >
          <EditorTableIcon color={surfaceText} />
        </button>
      )}
      {onCreateRelatedNode && (
        <div ref={createMenuRef} style={{ position: "relative", flex: "0 0 auto" }}>
          <button
            type="button"
            aria-label="Create related node"
            aria-haspopup="menu"
            aria-expanded={createMenuOpen}
            title="Create related node"
            onMouseEnter={() => setHoveredTabID("create")}
            onMouseLeave={() => setHoveredTabID((current) => (current === "create" ? null : current))}
            onClick={() => setCreateMenuOpen((open) => !open)}
            style={{
              width: 26,
              height: 24,
              border: `1px solid ${createMenuOpen || hoveredTabID === "create" ? "transparent" : strokeColor}`,
              borderRadius: 8,
              background: createMenuOpen
                ? `${tabSelectedBackground} padding-box, ${tabFrameBackground} border-box`
                : hoveredTabID === "create"
                  ? `${tabHoverBackground} padding-box, ${tabFrameBackground} border-box`
                  : tabBackground,
              color: accent,
              cursor: "pointer",
              fontSize: 17,
              fontWeight: 500,
              lineHeight: 1,
              display: "grid",
              placeItems: "center",
              padding: 0,
              boxShadow: createMenuOpen || hoveredTabID === "create" ? tabHoverShadow : "none",
              transform: hoveredTabID === "create" && !createMenuOpen ? "translateY(-1px)" : "translateY(0)",
              transition: "background 140ms ease, border-color 140ms ease, box-shadow 160ms ease, transform 160ms ease",
            }}
          >
            +
          </button>
          {createMenuOpen && (
            <div
              role="menu"
              aria-label="Create related node"
              style={{
                position: "absolute",
                top: "calc(100% + 5px)",
                left: 0,
                width: 178,
                padding: 5,
                border: `1px solid ${strokeColor}`,
                borderRadius: 6,
                background: tabSelectedBackground,
                boxShadow: `0 12px 28px ${colorWithAlpha("#0f172a", 0.18)}`,
                display: "grid",
                gap: 3,
              }}
            >
              {[
                ["parent", "Create parent node"],
                ["peer", "Create peer node"],
                ["child", "Create child node"],
              ].map(([kind, label]) => (
                <button
                  key={kind}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setCreateMenuOpen(false);
                    onCreateRelatedNode(kind as EditorRelatedNodeCreationKind);
                  }}
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
            </div>
          )}
        </div>
      )}
    </div>
  );
};
