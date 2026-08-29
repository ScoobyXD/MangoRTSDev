import React, { useRef } from "react";
import { createPortal } from "react-dom";
import { useAppFloatingMenuDismissal, useAppOverlayPortalTarget } from "../../app/AppModalPortal.js";
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

export type FloatingLayerPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
};

/** Keeps editor menus attached to their trigger while escaping clipped editor surfaces. */
export function useFloatingLayerPosition(
  anchorRef: React.RefObject<HTMLElement | null>,
  open: boolean,
  options: { width: number; maxHeight: number; gutter?: number },
): FloatingLayerPosition | null {
  const [position, setPosition] = React.useState<FloatingLayerPosition | null>(null);
  const gutter = options.gutter ?? 8;

  React.useLayoutEffect(() => {
    if (!open || typeof window === "undefined") {
      setPosition(null);
      return undefined;
    }

    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const viewportWidth = window.innerWidth || 1;
      const viewportHeight = window.innerHeight || 1;
      const width = Math.max(180, Math.min(options.width, viewportWidth - gutter * 2));
      const maxHeight = Math.max(120, Math.min(options.maxHeight, viewportHeight - gutter * 2));
      const belowSpace = viewportHeight - rect.bottom - gutter;
      const aboveSpace = rect.top - gutter;
      const openAbove = belowSpace < Math.min(170, maxHeight) && aboveSpace > belowSpace;
      const belowMaxHeight = Math.min(maxHeight, Math.max(120, belowSpace));
      const aboveMaxHeight = Math.min(maxHeight, Math.max(120, aboveSpace));
      const top = openAbove
        ? Math.max(gutter, rect.top - aboveMaxHeight - 6)
        : Math.max(gutter, Math.min(rect.bottom + 6, viewportHeight - gutter - belowMaxHeight));
      const availableHeight = openAbove ? Math.max(120, rect.top - top - 6) : Math.max(120, viewportHeight - top - gutter);
      const left = Math.max(gutter, Math.min(rect.left, viewportWidth - width - gutter));

      setPosition({
        left,
        top,
        width,
        maxHeight: Math.min(maxHeight, availableHeight),
      });
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, gutter, open, options.maxHeight, options.width]);

  return position;
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
  resultsPortalTarget?: Element | DocumentFragment | null;
  resultsContainerRef?: React.Ref<HTMLDivElement>;
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
  resultsPortalTarget,
  resultsContainerRef,
}, ref) {
  const resultsList = showResults ? (
    <div
      ref={resultsContainerRef}
      id={`${id}-options`}
      role="listbox"
      aria-label={resultsAriaLabel}
      style={{ minHeight: 0, overflowY: "auto", display: "grid", alignContent: "start", gap: 3, paddingTop: 6, ...listStyle }}
    >
      {hasResults ? children : <div style={{ padding: "8px 10px", color: "#64748b", fontSize: 11, fontWeight: 500 }}>{emptyMessage}</div>}
    </div>
  ) : null;
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
      {resultsList && (resultsPortalTarget ? createPortal(resultsList, resultsPortalTarget) : resultsList)}
    </div>
  );
});

function editorDateFromDateInput(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  return `${Number(match[2])}/${Number(match[3])}/${match[1]}`;
}

function calendarMonthForValue(value: string): Date {
  const iso = normalizeNodeDueDateDraft(value);
  const match = iso?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match
    ? new Date(Number(match[1]), Number(match[2]) - 1, 1)
    : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
}

function calendarDateKey(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function calendarMonthDays(month: Date): Array<{ date: Date; key: string; inMonth: boolean }> {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const firstVisible = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstVisible.getFullYear(), firstVisible.getMonth(), firstVisible.getDate() + index);
    return { date, key: calendarDateKey(date), inMonth: date.getMonth() === month.getMonth() };
  });
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
  floatingPortalTarget?: Element | DocumentFragment | null;
};

/** Shared editable date text plus the app's elevated calendar picker. */
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
  floatingPortalTarget,
}: EditorCalendarDateInputProps) {
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const [visibleMonth, setVisibleMonth] = React.useState(() => calendarMonthForValue(value));
  const popoverID = React.useId();
  const defaultPortalTarget = useAppOverlayPortalTarget(containerRef.current?.ownerDocument);
  const portalTarget = floatingPortalTarget ?? defaultPortalTarget;
  const position = useFloatingLayerPosition(containerRef, open, { width: 302, maxHeight: 382 });
  const selectedDate = normalizeNodeDueDateDraft(value) ?? "";
  const today = calendarDateKey(new Date());
  const days = React.useMemo(() => calendarMonthDays(visibleMonth), [visibleMonth]);
  const commit = (next: string) => onCommit?.(next);
  const pickerLabel = ariaLabel.replace(/^Value for\s+/i, "");
  React.useEffect(() => {
    if (!open) setVisibleMonth(calendarMonthForValue(value));
  }, [open, value]);
  useAppFloatingMenuDismissal(open, containerRef, () => setOpen(false), popoverRef);

  const chooseDate = (dateKey: string) => {
    const next = editorDateFromDateInput(dateKey);
    onChange(next);
    commit(next);
    setOpen(false);
  };
  return (
    <span ref={containerRef} style={{ position: "relative", display: "inline-grid", gridTemplateColumns: "minmax(0, 1fr) 24px", alignItems: "center", width: "100%", ...containerStyle }}>
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
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverID : undefined}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (disabled) return;
          setVisibleMonth(calendarMonthForValue(value));
          setOpen((current) => !current);
        }}
        style={{ width: 24, height: 24, border: `1px solid ${open ? `${accent}88` : ruleColor}`, borderRadius: 7, background: open ? `linear-gradient(145deg, #ffffff, ${accent}18)` : panelBackground, color: accent, display: "grid", placeItems: "center", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.46 : 1, padding: 0, boxShadow: open ? `3px 3px 8px ${accent}24, -2px -2px 7px rgba(255,255,255,.92), inset 1px 1px 0 rgba(255,255,255,.96)` : "2px 2px 6px rgba(148,163,184,.14), -2px -2px 6px rgba(255,255,255,.86), inset 1px 1px 0 rgba(255,255,255,.94)", ...buttonStyle }}
      >
        <CalendarIcon color={accent} />
      </button>
      {open && position && portalTarget && createPortal(
        <div
          ref={popoverRef}
          id={popoverID}
          role="dialog"
          aria-label={`Choose ${pickerLabel.toLocaleLowerCase()}`}
          data-editor-calendar-popover={ariaLabel}
          style={{ position: "fixed", zIndex: 12060, left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight, overflowY: "auto", pointerEvents: "auto", boxSizing: "border-box", display: "grid", gap: 10, padding: 12, border: "1px solid rgba(255,255,255,.92)", borderRadius: 16, background: "linear-gradient(145deg,rgba(255,255,255,.99),rgba(239,246,255,.96))", color: "#0f172a", boxShadow: "14px 16px 38px rgba(71,85,105,.22), -8px -8px 24px rgba(255,255,255,.94), inset 1px 1px 0 rgba(255,255,255,.98)" }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "32px minmax(0,1fr) 32px", alignItems: "center", gap: 8 }}>
            <button type="button" aria-label="Previous month" onClick={() => setVisibleMonth((month) => new Date(month.getFullYear(), month.getMonth() - 1, 1))} style={calendarNavigationButtonStyle}>‹</button>
            <strong aria-live="polite" style={{ textAlign: "center", color: "#1e3a5f", fontSize: 13, fontWeight: 900 }}>{visibleMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</strong>
            <button type="button" aria-label="Next month" onClick={() => setVisibleMonth((month) => new Date(month.getFullYear(), month.getMonth() + 1, 1))} style={calendarNavigationButtonStyle}>›</button>
          </div>
          <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4, color: "#64748b", fontSize: 10, fontWeight: 900, textAlign: "center" }}>
            {(["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const).map((day) => <span key={day}>{day}</span>)}
          </div>
          <div role="group" aria-label={`${visibleMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })} calendar`} style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
            {days.map((day) => {
              const selected = day.key === selectedDate;
              const isToday = day.key === today;
              return (
                <button
                  key={day.key}
                  type="button"
                  aria-label={day.date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
                  aria-pressed={selected}
                  aria-current={isToday ? "date" : undefined}
                  onClick={() => chooseDate(day.key)}
                  style={calendarDayButtonStyle(selected, isToday, day.inMonth, accent)}
                >
                  {day.date.getDate()}
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, paddingTop: 2 }}>
            <button type="button" onClick={() => { onChange(""); commit(""); setOpen(false); }} style={calendarFooterButtonStyle}>Clear</button>
            <button type="button" onClick={() => chooseDate(today)} style={{ ...calendarFooterButtonStyle, color: "#0369a1" }}>Today</button>
          </div>
        </div>,
        portalTarget,
      )}
    </span>
  );
}

const calendarNavigationButtonStyle: React.CSSProperties = {
  width: 32,
  height: 30,
  border: "1px solid rgba(125,211,252,.46)",
  borderRadius: 9,
  background: "linear-gradient(145deg,#ffffff,#e0f2fe)",
  color: "#0284c7",
  font: "inherit",
  fontSize: 20,
  fontWeight: 800,
  lineHeight: 1,
  cursor: "pointer",
  padding: 0,
  boxShadow: "3px 3px 8px rgba(100,116,139,.14), -2px -2px 7px rgba(255,255,255,.92), inset 1px 1px 0 rgba(255,255,255,.96)",
};

function calendarDayButtonStyle(selected: boolean, today: boolean, inMonth: boolean, accent: string): React.CSSProperties {
  return {
    minWidth: 0,
    height: 30,
    border: selected ? `1px solid ${accent}` : today ? `1px solid ${accent}88` : "1px solid transparent",
    borderRadius: 8,
    background: selected ? `linear-gradient(145deg,${accent},#38bdf8)` : inMonth ? "linear-gradient(145deg,#ffffff,#f1f5f9)" : "transparent",
    color: selected ? "#ffffff" : inMonth ? "#1e293b" : "#94a3b8",
    font: "inherit",
    fontSize: 11,
    fontWeight: selected || today ? 900 : 700,
    cursor: "pointer",
    padding: 0,
    boxShadow: selected ? `3px 4px 9px ${accent}38, inset 1px 1px 0 rgba(255,255,255,.46)` : inMonth ? "2px 2px 5px rgba(148,163,184,.11), -2px -2px 5px rgba(255,255,255,.80), inset 1px 1px 0 rgba(255,255,255,.92)" : "none",
  };
}

const calendarFooterButtonStyle: React.CSSProperties = {
  minHeight: 30,
  border: "1px solid rgba(148,163,184,.24)",
  borderRadius: 8,
  background: "linear-gradient(145deg,#ffffff,#f1f5f9)",
  color: "#475569",
  font: "inherit",
  fontSize: 11,
  fontWeight: 850,
  cursor: "pointer",
  padding: "0 12px",
  boxShadow: "2px 2px 6px rgba(148,163,184,.13), -2px -2px 6px rgba(255,255,255,.88), inset 1px 1px 0 rgba(255,255,255,.95)",
};
