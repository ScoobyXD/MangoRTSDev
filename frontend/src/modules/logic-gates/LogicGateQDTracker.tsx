import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  getQDBusinessDate,
  loadQDRatings,
  millisecondsUntilNextQDBusinessDay,
  qdRatingDateKey,
  readQDRatingsSnapshot,
  setQDRating,
  subscribeQDRatings,
  subscribeQDRatingsRealtime,
  type QDBusinessDate,
  type QDRating,
  type QDRatingMetric,
  type QDRatingsRequestJSON,
  type QDRatingValue,
} from "./qdRatingsApi.js";

export type LogicGateQDTrackerProps = {
  apiBase: string;
  companyID: string;
  logicGateID: string;
  canEdit: boolean;
  readOnly?: boolean;
  variant?: "full" | "card";
  requestJSON: QDRatingsRequestJSON;
};

type CellPosition = readonly [row: number, column: number];

const DAY_NUMBERS = Array.from({ length: 31 }, (_, index) => index + 1);
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const Q_CELL_POSITIONS: readonly CellPosition[] = [
  [1, 2], [1, 3], [1, 4], [1, 5], [1, 6],
  [2, 2], [2, 3], [2, 4], [2, 5], [2, 6],
  [3, 1], [3, 2], [3, 6], [3, 7],
  [4, 1], [4, 2], [4, 6], [4, 7],
  [5, 1], [5, 2], [5, 6], [5, 7],
  [6, 2], [6, 3], [6, 4], [6, 5], [6, 6],
  [7, 4], [7, 5], [7, 6], [7, 7],
];

const D_CELL_POSITIONS: readonly CellPosition[] = [
  [1, 1], [1, 2], [1, 3], [1, 4], [1, 5],
  [2, 1], [2, 2], [2, 3], [2, 4], [2, 5], [2, 6],
  [3, 1], [3, 2], [3, 6], [3, 7],
  [4, 1], [4, 2], [4, 6], [4, 7],
  [5, 1], [5, 2], [5, 6], [5, 7],
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [6, 6],
  [7, 1], [7, 2],
];

const COLORS: Record<QDRatingValue, string> = {
  green: "#68b84e",
  yellow: "#f2c14f",
  red: "#df5353",
};

function ratingForMetric(rating: QDRating | undefined, metric: QDRatingMetric): QDRatingValue | null {
  if (!rating) return null;
  return metric === "quality" ? rating.quality_rating : rating.delivery_rating;
}

function dayDateKey(date: QDBusinessDate, day: number): string {
  return `${date.monthKey}-${String(day).padStart(2, "0")}`;
}

function useQDBusinessDate(): QDBusinessDate {
  const [businessDate, setBusinessDate] = useState(() => getQDBusinessDate());
  useEffect(() => {
    let rolloverTimer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      setBusinessDate(getQDBusinessDate());
      if (rolloverTimer !== undefined) clearTimeout(rolloverTimer);
      rolloverTimer = setTimeout(sync, millisecondsUntilNextQDBusinessDay());
    };
    sync();
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      if (rolloverTimer !== undefined) clearTimeout(rolloverTimer);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);
  return businessDate;
}

function useExactVisibility(): [React.RefObject<HTMLElement>, boolean] {
  const elementRef = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const element = elementRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { rootMargin: "0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [elementRef, visible];
}

function QDLetter(props: {
  letter: "Q" | "D";
  metric: QDRatingMetric;
  positions: readonly CellPosition[];
  businessDate: QDBusinessDate;
  ratingByDate: ReadonlyMap<string, QDRating>;
  canChooseToday: boolean;
  compact: boolean;
  busy: boolean;
  onChoose: (metric: QDRatingMetric) => void;
}) {
  const gridMaxSize = props.compact ? 154 : 168;
  return (
    <section aria-label={`${props.metric} ratings`} style={letterPanelStyle}>
      <div style={letterHeadingStyle}>
        <strong>{props.letter}</strong>
        <span>{props.metric === "quality" ? "Quality" : "Delivery"}</span>
      </div>
      <div
        role="group"
        aria-label={`${props.metric} daily ratings`}
        data-qd-letter={props.letter}
        style={{
          display: "grid",
          width: "100%",
          maxWidth: gridMaxSize,
          aspectRatio: "1",
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          gridTemplateRows: "repeat(7, minmax(0, 1fr))",
          gap: 1,
        }}
      >
        {DAY_NUMBERS.map((day, index) => {
          const dateKey = dayDateKey(props.businessDate, day);
          const rating = props.ratingByDate.get(dateKey);
          const value = ratingForMetric(rating, props.metric);
          const isToday = day === props.businessDate.day;
          const editable = props.canChooseToday && isToday && !props.busy;
          const position = props.positions[index];
          const label = value ?? "not rated";
          const rater = rating?.rated_by_display_name?.trim();
          return (
            <button
              key={day}
              type="button"
              disabled={!editable}
              aria-label={`${props.metric} day ${day}: ${label}${rater ? `, rated by ${rater}` : ""}`}
              title={`${props.metric === "quality" ? "Quality" : "Delivery"} · day ${day} · ${label}${rater ? ` · ${rater}` : ""}`}
              data-qd-day={day}
              data-qd-metric={props.metric}
              data-qd-rating={value ?? "blank"}
              data-qd-current={isToday ? "true" : undefined}
              onClick={() => props.onChoose(props.metric)}
              style={{
                ...dayCellStyle,
                gridRow: position[0],
                gridColumn: position[1],
                width: "100%",
                height: "100%",
                minWidth: 0,
                minHeight: 0,
                fontSize: props.compact ? 9 : 10,
                color: value === "yellow" ? "#5c4410" : value ? "#fff" : "#526074",
                background: value ? COLORS[value] : "#e7ebf1",
                outline: isToday ? "2px solid #2586d7" : "none",
                outlineOffset: isToday ? 1 : 0,
                cursor: editable ? "pointer" : "default",
              }}
            >
              {day}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export const LogicGateQDTracker: React.FC<LogicGateQDTrackerProps> = ({
  apiBase,
  companyID,
  logicGateID,
  canEdit,
  readOnly = false,
  variant = "full",
  requestJSON,
}) => {
  const businessDate = useQDBusinessDate();
  const [trackerRef, visible] = useExactVisibility();
  const [activeMetric, setActiveMetric] = useState<QDRatingMetric | null>(null);
  const [savingMetric, setSavingMetric] = useState<QDRatingMetric | null>(null);
  const [saveError, setSaveError] = useState("");
  const subscribe = useCallback(
    (listener: () => void) => visible
      ? subscribeQDRatings(apiBase, companyID, logicGateID, businessDate.monthKey, listener)
      : () => undefined,
    [apiBase, businessDate.monthKey, companyID, logicGateID, visible],
  );
  const getSnapshot = useCallback(
    () => readQDRatingsSnapshot(apiBase, companyID, logicGateID, businessDate.monthKey),
    [apiBase, businessDate.monthKey, companyID, logicGateID],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!visible) return;
    setActiveMetric(null);
    setSaveError("");
    void loadQDRatings({ apiBase, companyID, logicGateID, month: businessDate.monthKey, requestJSON });
  }, [apiBase, businessDate.monthKey, companyID, logicGateID, requestJSON, visible]);

  useEffect(() => visible
    ? subscribeQDRatingsRealtime({ apiBase, companyID, logicGateID, requestJSON })
    : undefined, [apiBase, companyID, logicGateID, requestJSON, visible]);

  const ratingByDate = useMemo(() => new Map(snapshot.ratings.map((rating) => [qdRatingDateKey(rating), rating])), [snapshot.ratings]);
  const todayRating = ratingByDate.get(businessDate.dateKey);
  const latestRating = snapshot.ratings[snapshot.ratings.length - 1];
  const attribution = todayRating ?? latestRating;
  const canChooseToday = canEdit && !readOnly && visible;
  const compact = variant === "card";

  const save = async (value: QDRatingValue | null) => {
    if (!activeMetric || !canChooseToday || savingMetric) return;
    const metric = activeMetric;
    setSaveError("");
    setSavingMetric(metric);
    try {
      await setQDRating({ apiBase, companyID, logicGateID, metric, rating: value, requestJSON });
      setActiveMetric(null);
    } catch (cause) {
      setSaveError(cause instanceof Error && cause.message.trim() ? cause.message : "Could not save Q/D rating");
    } finally {
      setSavingMetric(null);
    }
  };

  return (
    <section
      ref={trackerRef}
      aria-label="Daily quality and delivery ratings"
      data-logic-gate-qd-tracker={variant}
      style={{ ...trackerStyle, padding: compact ? 8 : "10px 14px" }}
    >
      <header style={trackerHeaderStyle}>
        <div>
          <strong style={trackerTitleStyle}>Quality & Delivery</strong>
          <span style={monthLabelStyle}>{MONTH_NAMES[businessDate.month - 1]} {businessDate.year}</span>
        </div>
        <span style={attributionStyle}>
          {attribution?.rated_by_display_name
            ? `Last rated by ${attribution.rated_by_display_name}`
            : snapshot.loading && !snapshot.loaded ? "Loading ratings…" : "Not rated this month"}
        </span>
      </header>

      <div style={{ ...lettersStyle, gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
        <QDLetter
          letter="Q"
          metric="quality"
          positions={Q_CELL_POSITIONS}
          businessDate={businessDate}
          ratingByDate={ratingByDate}
          canChooseToday={canChooseToday}
          compact={compact}
          busy={savingMetric !== null}
          onChoose={setActiveMetric}
        />
        <QDLetter
          letter="D"
          metric="delivery"
          positions={D_CELL_POSITIONS}
          businessDate={businessDate}
          ratingByDate={ratingByDate}
          canChooseToday={canChooseToday}
          compact={compact}
          busy={savingMetric !== null}
          onChoose={setActiveMetric}
        />
      </div>

      {activeMetric && canChooseToday && (
        <div role="group" aria-label={`Set ${activeMetric} rating for today`} style={chooserStyle}>
          <span style={chooserLabelStyle}>{activeMetric === "quality" ? "Quality" : "Delivery"} today:</span>
          <button type="button" disabled={savingMetric !== null} onClick={() => void save(null)} style={{ ...choiceButtonStyle, background: "#e7ebf1", color: "#465468" }}>Blank</button>
          <button type="button" disabled={savingMetric !== null} onClick={() => void save("green")} style={{ ...choiceButtonStyle, background: COLORS.green }}>Green</button>
          <button type="button" disabled={savingMetric !== null} onClick={() => void save("yellow")} style={{ ...choiceButtonStyle, background: COLORS.yellow, color: "#5c4410" }}>Yellow</button>
          <button type="button" disabled={savingMetric !== null} onClick={() => void save("red")} style={{ ...choiceButtonStyle, background: COLORS.red }}>Red</button>
          <button type="button" aria-label="Close rating choices" disabled={savingMetric !== null} onClick={() => setActiveMetric(null)} style={closeButtonStyle}>×</button>
        </div>
      )}

      {(saveError || snapshot.error) && <span role="alert" style={errorStyle}>{saveError || snapshot.error}</span>}
    </section>
  );
};

const trackerStyle: React.CSSProperties = {
  pointerEvents: "auto",
  minWidth: 0,
  display: "grid",
  gap: 8,
  border: "1px solid rgba(148,163,184,.32)",
  borderRadius: 13,
  background: "linear-gradient(145deg,rgba(248,250,252,.96),rgba(237,242,247,.94))",
  boxShadow: "3px 4px 11px rgba(148,163,184,.18), -3px -3px 9px rgba(255,255,255,.82)",
  color: "#172033",
};
const trackerHeaderStyle: React.CSSProperties = { minWidth: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 };
const trackerTitleStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 900 };
const monthLabelStyle: React.CSSProperties = { display: "block", color: "#64748b", fontSize: 10, fontWeight: 700 };
const attributionStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#64748b", fontSize: 10, fontWeight: 700 };
const lettersStyle: React.CSSProperties = { minWidth: 0, display: "grid", alignItems: "start", gap: 6 };
const letterPanelStyle: React.CSSProperties = { width: "100%", minWidth: 0, display: "grid", alignContent: "start", justifyItems: "center", gap: 5, padding: 2 };
const letterHeadingStyle: React.CSSProperties = { display: "flex", alignItems: "baseline", justifyContent: "center", gap: 5, fontSize: 10, fontWeight: 800 };
const dayCellStyle: React.CSSProperties = { display: "grid", placeItems: "center", boxSizing: "border-box", border: "1px solid rgba(255,255,255,.76)", borderRadius: 3, padding: 0, lineHeight: 1, fontWeight: 850, fontFamily: "inherit", boxShadow: "inset 0 0 0 1px rgba(15,23,42,.04)" };
const chooserStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: "7px 8px", border: "1px solid rgba(37,134,215,.22)", borderRadius: 9, background: "rgba(255,255,255,.74)" };
const chooserLabelStyle: React.CSSProperties = { marginRight: 2, fontSize: 11, fontWeight: 850 };
const choiceButtonStyle: React.CSSProperties = { minWidth: 49, height: 27, border: "1px solid rgba(15,23,42,.12)", borderRadius: 7, color: "#fff", padding: "0 8px", cursor: "pointer", fontSize: 10, fontWeight: 850, fontFamily: "inherit" };
const closeButtonStyle: React.CSSProperties = { width: 27, height: 27, display: "grid", placeItems: "center", border: "1px solid transparent", borderRadius: 7, background: "linear-gradient(135deg,#ff5a6b,#ef334e)", color: "#fff", padding: 0, cursor: "pointer", fontSize: 17, fontWeight: 700, lineHeight: 1, boxShadow: "0 8px 18px rgba(239,51,78,.26), inset 1px 1px 0 rgba(255,255,255,.38)" };
const errorStyle: React.CSSProperties = { color: "#b91c1c", fontSize: 10, fontWeight: 750 };
