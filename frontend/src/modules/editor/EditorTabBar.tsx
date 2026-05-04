import type React from "react";
import { EDITOR_TAB_ITEMS, type EditorTabID } from "./editorTabs";
import type { EditorOutlineStyleID } from "./plainTextEditing";
import { EDITOR_OUTLINE_STYLE_ITEMS } from "./useEditorPreferences";

const EditorDisclosureIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" style={{ display: "block" }}>
    <path d="M3.25 4.55 6 7.3l2.75-2.75" fill="none" stroke={color} strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

type EditorTabBarProps = {
  activeTab: EditorTabID;
  outlineStyle: EditorOutlineStyleID;
  accent: string;
  strokeColor: string;
  surfaceText: string;
  tabBackground: string;
  tabSelectedBackground: string;
  onSelectTab: (tab: EditorTabID) => void;
  onOutlineStyleFocus: () => void;
  onOutlineStyleChange: (outlineStyle: EditorOutlineStyleID) => void;
};

export const EditorTabBar: React.FC<EditorTabBarProps> = ({
  activeTab,
  outlineStyle,
  accent,
  strokeColor,
  surfaceText,
  tabBackground,
  tabSelectedBackground,
  onSelectTab,
  onOutlineStyleFocus,
  onOutlineStyleChange,
}) => (
  <div style={{ position: "relative", zIndex: 4, display: "flex", alignItems: "center", gap: 6, paddingLeft: 106, overflowX: "auto", scrollbarWidth: "none", pointerEvents: "auto" }}>
    {EDITOR_TAB_ITEMS.map((tab) => {
      const selected = activeTab === tab.id;
      const tabStyle: React.CSSProperties = {
        flex: "0 0 auto",
        whiteSpace: "nowrap",
        border: `1px solid ${selected ? accent : strokeColor}`,
        background: selected ? tabSelectedBackground : tabBackground,
        color: surfaceText,
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        padding: "4px 10px",
        borderRadius: 4,
        cursor: "pointer",
      };
      if (tab.id === "outline-styles") {
        return (
          <label key={tab.id} style={{ ...tabStyle, position: "relative", display: "inline-flex", alignItems: "center", gap: 6, paddingRight: 24 }}>
            <select
              aria-label="Outline styles"
              value={outlineStyle}
              onFocus={onOutlineStyleFocus}
              onChange={(event) => onOutlineStyleChange(event.currentTarget.value as EditorOutlineStyleID)}
              style={{
                position: "absolute",
                inset: 0,
                opacity: 0,
                cursor: "pointer",
              }}
            >
              {EDITOR_OUTLINE_STYLE_ITEMS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
            <span>{tab.label}</span>
            <span style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
              <EditorDisclosureIcon color={surfaceText} />
            </span>
          </label>
        );
      }
      return (
        <button key={tab.id} type="button" onClick={() => onSelectTab(tab.id)} style={tabStyle}>
          {tab.label}
        </button>
      );
    })}
  </div>
);
