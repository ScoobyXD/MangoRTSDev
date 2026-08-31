import React, { useEffect, useState } from "react";
import { EditorCalendarDateInput } from "../editor/EditorFieldControls.js";
import { normalizeNodeDueDateDraft } from "../editor/editorDates.js";
import { HUDDLE_CALENDAR_THEME } from "./huddleCalendarTheme.js";

export function HuddleNodeDateControl(props: {
  date: string;
  saving: boolean;
  onCommit: (value: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => huddleDateInputValue(props.date));
  useEffect(() => { setDraft(huddleDateInputValue(props.date)); }, [props.date]);

  const commit = async (value: string) => {
    const normalized = normalizeNodeDueDateDraft(value);
    if (!normalized) {
      setDraft(huddleDateInputValue(props.date));
      return;
    }
    setDraft(huddleDateInputValue(normalized));
    try {
      await props.onCommit(normalized);
    } catch {
      setDraft(huddleDateInputValue(props.date));
    }
  };

  return (
    <div data-huddle-node-date-control="true" style={containerStyle}>
      <EditorCalendarDateInput
        value={draft}
        ariaLabel="Huddle Node date"
        disabled={!props.date || props.saving}
        accent={HUDDLE_CALENDAR_THEME.accent}
        theme={HUDDLE_CALENDAR_THEME}
        allowClear={false}
        onChange={setDraft}
        onCommit={(value) => void commit(value)}
        containerStyle={controlStyle}
        inputStyle={inputStyle}
        buttonStyle={{ width: 28, height: 28 }}
      />
    </div>
  );
}

function huddleDateInputValue(value: string): string {
  const normalized = normalizeNodeDueDateDraft(value);
  const match = normalized?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${Number(match[2])}/${Number(match[3])}/${match[1]}` : "";
}

const containerStyle: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 43,
  minHeight: 38,
  display: "flex",
  alignItems: "flex-start",
  paddingBottom: 7,
};
const controlStyle: React.CSSProperties = {
  width: 142,
  minHeight: 30,
  gridTemplateColumns: "minmax(0,1fr) 28px",
  border: "1px solid rgba(234,132,229,.32)",
  borderRadius: 9,
  background: "linear-gradient(145deg,rgba(255,255,255,.92),rgba(243,232,255,.72))",
  color: "#5b21b6",
  paddingLeft: 9,
  boxShadow: "2px 2px 7px rgba(124,58,237,.10), -2px -2px 7px rgba(255,255,255,.88)",
};
const inputStyle: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: "#5b21b6" };
