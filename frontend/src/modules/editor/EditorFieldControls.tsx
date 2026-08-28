import React, { useRef } from "react";
import { normalizeNodeDueDateDraft } from "./editorDates.js";

export type EditorCompanyUser = {
  user_id: string;
  email?: string;
  display_name?: string;
};

export function editorCompanyUserLabel(user: EditorCompanyUser): string {
  const name = (user.display_name ?? "").trim();
  const email = (user.email ?? "").trim();
  if (name && email) return `${name} <${email}>`;
  return name || email || user.user_id;
}

export function editorCompanyUserMatches(user: EditorCompanyUser, query: string): boolean {
  const cleanQuery = query.trim().toLocaleLowerCase();
  if (!cleanQuery) return true;
  return `${user.display_name ?? ""} ${user.email ?? ""} ${user.user_id}`.toLocaleLowerCase().includes(cleanQuery);
}

type CompanyUserSearchInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  accent?: string;
};

/** The shared text-search control used by RACI and Entity person assignment. */
export const CompanyUserSearchInput = React.forwardRef<HTMLInputElement, CompanyUserSearchInputProps>(function CompanyUserSearchInput(
  { accent = "#0f766e", style, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type="text"
      autoComplete="new-password"
      autoCorrect="off"
      autoCapitalize="none"
      spellCheck={false}
      {...props}
      style={{
        minWidth: 0,
        minHeight: 30,
        boxSizing: "border-box",
        border: `1px solid ${accent}`,
        borderRadius: 8,
        background: "#ffffff",
        color: "#111827",
        font: "inherit",
        fontSize: 11.5,
        fontWeight: 750,
        padding: "5px 8px",
        outline: "none",
        boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.86)",
        ...style,
      }}
    />
  );
});

type CompanyUserSearchPickerProps = {
  id: string;
  inputAriaLabel: string;
  resultsAriaLabel: string;
  query: string;
  placeholder: string;
  accent?: string;
  autoFocus?: boolean;
  showResults: boolean;
  hasResults: boolean;
  emptyMessage: React.ReactNode;
  children: React.ReactNode;
  onQueryChange: (query: string) => void;
  onInputFocus?: React.FocusEventHandler<HTMLInputElement>;
  onInputKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  onBlur?: React.FocusEventHandler<HTMLDivElement>;
  style?: React.CSSProperties;
  inputStyle?: React.CSSProperties;
  listStyle?: React.CSSProperties;
};

/** The full searchable company-user input and results list shared with RACI assignment. */
export const CompanyUserSearchPicker = React.forwardRef<HTMLDivElement, CompanyUserSearchPickerProps>(function CompanyUserSearchPicker({
  id,
  inputAriaLabel,
  resultsAriaLabel,
  query,
  placeholder,
  accent,
  autoFocus,
  showResults,
  hasResults,
  emptyMessage,
  children,
  onQueryChange,
  onInputFocus,
  onInputKeyDown,
  onBlur,
  style,
  inputStyle,
  listStyle,
}, ref) {
  return (
    <div ref={ref} role="dialog" aria-label={resultsAriaLabel} onBlur={onBlur} style={style}>
      <CompanyUserSearchInput
        id={id}
        value={query}
        autoFocus={autoFocus}
        placeholder={placeholder}
        accent={accent}
        aria-label={inputAriaLabel}
        role="combobox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={showResults}
        aria-controls={`${id}-options`}
        onFocus={onInputFocus}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
        onKeyDown={onInputKeyDown}
        style={inputStyle}
      />
      {showResults && (
        <div
          id={`${id}-options`}
          role="listbox"
          aria-label={resultsAriaLabel}
          style={{ minHeight: 0, overflowY: "auto", display: "grid", alignContent: "start", gap: 3, paddingTop: 6, ...listStyle }}
        >
          {hasResults ? children : <div style={{ padding: "8px 10px", color: "#64748b", fontSize: 11, fontWeight: 500 }}>{emptyMessage}</div>}
        </div>
      )}
    </div>
  );
});

function editorDateFromDateInput(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  return `${Number(match[2])}/${Number(match[3])}/${match[1]}`;
}

const CalendarIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" style={{ display: "block" }}>
    <path d="M3 2.75h10v10.5H3zM3 5.5h10M5.25 1.5v2.4M10.75 1.5v2.4" fill="none" stroke={color} strokeWidth="1.25" strokeLinecap="round" />
  </svg>
);

type EditorCalendarDateInputProps = {
  id?: string;
  value: string;
  ariaLabel: string;
  disabled?: boolean;
  accent?: string;
  ruleColor?: string;
  panelBackground?: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;
  containerStyle?: React.CSSProperties;
  inputStyle?: React.CSSProperties;
  buttonStyle?: React.CSSProperties;
};

/** Node's visible date text plus its native calendar picker, shared by Action Items. */
export function EditorCalendarDateInput({
  id,
  value,
  ariaLabel,
  disabled = false,
  accent = "#0f766e",
  ruleColor = "rgba(148,163,184,.32)",
  panelBackground = "#ffffff",
  placeholder = "mm/dd/yyyy",
  onChange,
  onCommit,
  containerStyle,
  inputStyle,
  buttonStyle,
}: EditorCalendarDateInputProps) {
  const pickerRef = useRef<HTMLInputElement | null>(null);
  const commit = (next: string) => onCommit?.(next);
  const pickerLabel = ariaLabel.replace(/^Value for\s+/i, "");
  return (
    <span style={{ position: "relative", display: "inline-grid", gridTemplateColumns: "minmax(0, 1fr) 24px", alignItems: "center", width: "100%", ...containerStyle }}>
      <input
        id={id}
        value={value}
        disabled={disabled}
        readOnly={disabled}
        inputMode="numeric"
        pattern="(?:0?[1-9]|1[0-2])/(?:0?[1-9]|[12][0-9]|3[01])/\d{4}"
        onChange={(event) => { if (!disabled) onChange(event.currentTarget.value); }}
        onBlur={(event) => { if (!disabled) commit(event.currentTarget.value); }}
        onKeyDown={(event) => {
          if (disabled) {
            event.preventDefault();
            return;
          }
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        style={{ width: "100%", minWidth: 0, border: "1px solid transparent", borderRight: "none", background: "transparent", color: "inherit", font: "inherit", padding: 0, outline: "none", caretColor: disabled ? "transparent" : "auto", cursor: disabled ? "default" : "text", ...inputStyle }}
      />
      <button
        type="button"
        title={`Choose ${pickerLabel.toLocaleLowerCase()}`}
        aria-label={`Choose ${pickerLabel.toLocaleLowerCase()}`}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (disabled) return;
          const picker = pickerRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
          if (!picker) return;
          if (picker.showPicker) picker.showPicker();
          else picker.click();
        }}
        style={{ width: 24, height: 24, border: `1px solid ${ruleColor}`, borderRadius: 5, background: panelBackground, color: accent, display: "grid", placeItems: "center", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.46 : 1, padding: 0, ...buttonStyle }}
      >
        <CalendarIcon color={accent} />
      </button>
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        disabled={disabled}
        value={normalizeNodeDueDateDraft(value) ?? ""}
        onChange={(event) => {
          if (disabled) return;
          const next = editorDateFromDateInput(event.currentTarget.value);
          onChange(next);
          commit(next);
        }}
        aria-hidden="true"
        data-editor-calendar-picker={ariaLabel}
        style={{ position: "absolute", right: 0, bottom: 0, width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
      />
    </span>
  );
}
