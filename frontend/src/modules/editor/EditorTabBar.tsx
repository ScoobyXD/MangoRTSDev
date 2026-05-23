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
  reserveHeaderOffset = true,
}) => {
  const [outlineMenuOpen, setOutlineMenuOpen] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [hoveredOutlineStyle, setHoveredOutlineStyle] = useState<EditorOutlineStyleID | null>(null);
  const [fontSizeDraft, setFontSizeDraft] = useState(String(documentFontSize));
  const outlineMenuRef = useRef<HTMLDivElement | null>(null);
  const createMenuRef = useRef<HTMLDivElement | null>(null);
  const outlineHoverBackground = colorWithAlpha(outlineMenuAccent, 0.14);
  const outlineSelectedBackground = colorWithAlpha(outlineMenuAccent, 0.2);

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

  const currentOutlineStyleLabel = EDITOR_OUTLINE_STYLE_ITEMS.find((item) => item.id === outlineStyle)?.label ?? "Outline Styles";

  return (
    <div style={{ position: "relative", zIndex: 4, display: "flex", alignItems: "center", gap: 6, paddingLeft: reserveHeaderOffset ? 106 : 0, overflow: "visible", scrollbarWidth: "none", pointerEvents: "auto" }}>
      {EDITOR_TAB_ITEMS.map((tab) => {
        const selected = activeTab === tab.id;
        const tabStyle: React.CSSProperties = {
          flex: "0 0 auto",
          whiteSpace: "nowrap",
          border: `1px solid ${selected ? accent : strokeColor}`,
          background: selected ? tabSelectedBackground : tabBackground,
          color: surfaceText,
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: 0,
          padding: "4px 10px",
          borderRadius: 4,
          cursor: "pointer",
        };

        if (tab.id === "format") {
          return (
            <div
              key={tab.id}
              aria-label="Font size"
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
            <div key={tab.id} ref={outlineMenuRef} style={{ position: "relative", flex: "0 0 auto" }}>
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
                    padding: 5,
                    border: `1px solid ${colorWithAlpha(outlineMenuAccent, 0.45)}`,
                    borderRadius: 6,
                    background: tabSelectedBackground,
                    boxShadow: `0 12px 28px ${colorWithAlpha("#0f172a", 0.18)}`,
                    display: "grid",
                    gap: 3,
                  }}
                >
                  {EDITOR_OUTLINE_STYLE_ITEMS.map((item) => {
                    const itemSelected = item.id === outlineStyle;
                    const itemHovered = item.id === hoveredOutlineStyle;
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
                          minHeight: 28,
                          border: 0,
                          borderRadius: 4,
                          background: itemHovered ? outlineHoverBackground : itemSelected ? outlineSelectedBackground : "transparent",
                          color: surfaceText,
                          display: "grid",
                          gridTemplateColumns: "1fr 18px",
                          alignItems: "center",
                          gap: 10,
                          padding: "5px 7px 5px 9px",
                          cursor: "pointer",
                          textAlign: "left",
                          fontSize: 11,
                          fontWeight: itemSelected ? 800 : 700,
                        }}
                      >
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
          <button key={tab.id} type="button" onClick={() => onSelectTab(tab.id)} style={tabStyle}>
            {tab.label}
          </button>
        );
      })}
      {onCreateRelatedNode && (
        <div ref={createMenuRef} style={{ position: "relative", flex: "0 0 auto" }}>
          <button
            type="button"
            aria-label="Create related node"
            aria-haspopup="menu"
            aria-expanded={createMenuOpen}
            title="Create related node"
            onClick={() => setCreateMenuOpen((open) => !open)}
            style={{
              width: 26,
              height: 24,
              border: `1px solid ${createMenuOpen ? accent : strokeColor}`,
              borderRadius: 4,
              background: createMenuOpen ? tabSelectedBackground : tabBackground,
              color: accent,
              cursor: "pointer",
              fontSize: 17,
              fontWeight: 500,
              lineHeight: 1,
              display: "grid",
              placeItems: "center",
              padding: 0,
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
