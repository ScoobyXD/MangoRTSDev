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
type FillerCell = Readonly<{
  position: CellPosition;
  borderRadius: string;
}>;
type LetterLayout = Readonly<{
  columns: number;
  rows: number;
  positions: readonly CellPosition[];
  fillers: readonly FillerCell[];
  roundedDays: Readonly<Record<number, string>>;
}>;

const DAY_NUMBERS = Array.from({ length: 31 }, (_, index) => index + 1);
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const Q_LAYOUT: LetterLayout = {
  columns: 6,
  rows: 7,
  positions: [
    [1, 2], [1, 3], [1, 4], [1, 5],
    [2, 1], [2, 2], [2, 3], [2, 4], [2, 5], [2, 6],
    [3, 1], [3, 2], [3, 5], [3, 6],
    [4, 1], [4, 2], [4, 5], [4, 6],
    [5, 1], [5, 2], [5, 3], [5, 5], [5, 6],
    [6, 2], [6, 3], [6, 4], [6, 5],
    [7, 3], [7, 4], [7, 5], [7, 6],
  ],
  fillers: [
    { position: [6, 1], borderRadius: "3px 3px 3px 12px" },
    { position: [6, 6], borderRadius: "3px 3px 12px 3px" },
  ],
  roundedDays: {
    1: "12px 3px 3px 3px",
    4: "3px 12px 3px 3px",
    5: "12px 3px 3px 3px",
    10: "3px 12px 3px 3px",
    28: "3px 3px 3px 12px",
    31: "3px 3px 12px 3px",
  },
};

const C_LAYOUT: LetterLayout = {
  columns: 7,
  rows: 8,
  positions: [
    [1, 2], [1, 3], [1, 4], [1, 5], [1, 6],
    [2, 1], [2, 2], [2, 3], [2, 4], [2, 5], [2, 6], [2, 7],
    [3, 1], [3, 2],
    [4, 1], [4, 2],
    [5, 1], [5, 2],
    [6, 1], [6, 2],
    [7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6], [7, 7],
    [8, 2], [8, 3], [8, 4], [8, 5],
  ],
  fillers: [
    { position: [8, 6], borderRadius: "3px 3px 12px 3px" },
  ],
  roundedDays: {
    1: "12px 3px 3px 3px",
    5: "3px 12px 3px 3px",
    6: "12px 3px 3px 3px",
    12: "3px 12px 3px 3px",
    21: "3px 3px 3px 12px",
    27: "3px 3px 12px 3px",
    28: "3px 3px 3px 12px",
  },
};

const D_LAYOUT: LetterLayout = {
  columns: 6,
  rows: 7,
  positions: [
    [1, 1], [1, 2], [1, 3], [1, 4], [1, 5],
    [2, 1], [2, 2], [2, 3], [2, 4], [2, 5],
    [3, 1], [3, 2], [3, 5], [3, 6],
    [4, 1], [4, 2], [4, 5], [4, 6],
    [5, 1], [5, 2], [5, 5], [5, 6],
    [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
    [7, 1], [7, 2], [7, 3], [7, 4],
  ],
  fillers: [
    { position: [2, 6], borderRadius: "3px 12px 3px 3px" },
    { position: [6, 6], borderRadius: "3px 3px 12px 3px" },
    { position: [7, 5], borderRadius: "3px 3px 12px 3px" },
  ],
  roundedDays: {
    1: "12px 3px 3px 3px",
    5: "3px 12px 3px 3px",
    28: "3px 3px 3px 12px",
  },
};

const METRIC_LABELS: Record<QDRatingMetric, string> = {
  quality: "Quality",
  cost: "Cost",
  delivery: "Delivery",
};

const COLORS: Record<QDRatingValue, string> = {
  green: "#68b84e",
  yellow: "#f2c14f",
  red: "#df5353",
};

function ratingForMetric(rating: QDRating | undefined, metric: QDRatingMetric): QDRatingValue | null {
  if (!rating) return null;
  if (metric === "quality") return rating.quality_rating;
  if (metric === "cost") return rating.cost_rating;
  return rating.delivery_rating;
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
  letter: "Q" | "C" | "D";
  metric: QDRatingMetric;
  layout: LetterLayout;
  businessDate: QDBusinessDate;
  ratingByDate: ReadonlyMap<string, QDRating>;
  canChooseToday: boolean;
  compact: boolean;
  busy: boolean;
  onChoose: (metric: QDRatingMetric) => void;
}) {
  const cellMaxSize = props.compact ? 21 : 24;
  const gridMaxSize = (cellMaxSize * props.layout.columns) + props.layout.columns - 1;
  return (
    <section aria-label={`${props.metric} ratings`} style={letterPanelStyle}>
      <div style={letterHeadingStyle}>
        <strong>{props.letter}</strong>
        <span>{METRIC_LABELS[props.metric]}</span>
      </div>
      <div
        role="group"
        aria-label={`${props.metric} daily ratings`}
        data-qd-letter={props.letter}
        style={{
          display: "grid",
          width: "100%",
          maxWidth: gridMaxSize,
          aspectRatio: `${props.layout.columns} / ${props.layout.rows}`,
          gridTemplateColumns: `repeat(${props.layout.columns}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${props.layout.rows}, minmax(0, 1fr))`,
          gap: 1,
        }}
      >
        {props.layout.fillers.map((filler, index) => (
          <span
            key={`filler-${index}`}
            aria-hidden="true"
            data-qd-filler={props.letter}
            style={{
              ...fillerCellStyle,
              gridRow: filler.position[0],
              gridColumn: filler.position[1],
              borderRadius: filler.borderRadius,
            }}
          />
        ))}
        {DAY_NUMBERS.map((day, index) => {
          const dateKey = dayDateKey(props.businessDate, day);
          const rating = props.ratingByDate.get(dateKey);
          const value = ratingForMetric(rating, props.metric);
          const isToday = day === props.businessDate.day;
          const editable = props.canChooseToday && isToday && !props.busy;
          const position = props.layout.positions[index];
          const label = value ?? "not rated";
          const rater = rating?.rated_by_display_name?.trim();
          return (
            <button
              key={day}
              type="button"
              disabled={!editable}
              aria-label={`${props.metric} day ${day}: ${label}${rater ? `, rated by ${rater}` : ""}`}
              title={`${METRIC_LABELS[props.metric]} · day ${day} · ${label}${rater ? ` · ${rater}` : ""}`}
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
                borderRadius: props.layout.roundedDays[day] ?? 3,
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

  useEffect(() => {
    if (!activeMetric) return undefined;
    const dismissChoices = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const currentDay = target?.closest<HTMLButtonElement>('button[data-qd-current="true"]');
      const clickedTrackerControl = Boolean(target && trackerRef.current?.contains(target) && (
        target.closest('[data-qd-picker-control="true"]')
        || (currentDay && !currentDay.disabled)
      ));
      if (!clickedTrackerControl) setActiveMetric(null);
    };
    document.addEventListener("pointerdown", dismissChoices, true);
    return () => document.removeEventListener("pointerdown", dismissChoices, true);
  }, [activeMetric, trackerRef]);

  const save = async (value: QDRatingValue | null) => {
    if (!activeMetric || !canChooseToday || savingMetric) return;
    const metric = activeMetric;
    setSaveError("");
    setSavingMetric(metric);
    try {
      await setQDRating({ apiBase, companyID, logicGateID, metric, rating: value, requestJSON });
      setActiveMetric(null);
    } catch (cause) {
      setSaveError(cause instanceof Error && cause.message.trim() ? cause.message : "Could not save QDC rating");
    } finally {
      setSavingMetric(null);
    }
  };

  return (
    <section
      ref={trackerRef}
      aria-label="Daily quality, cost, and delivery ratings"
      data-logic-gate-qd-tracker={variant}
      style={{ ...trackerStyle, padding: compact ? 8 : "10px 14px" }}
    >
      <header style={trackerHeaderStyle}>
        <div>
          <strong style={trackerTitleStyle}>Quality, Cost & Delivery</strong>
          <span style={monthLabelStyle}>{MONTH_NAMES[businessDate.month - 1]} {businessDate.year}</span>
        </div>
        <span style={attributionStyle}>
          {attribution?.rated_by_display_name
            ? `Last rated by ${attribution.rated_by_display_name}`
            : snapshot.loading && !snapshot.loaded ? "Loading ratings…" : "Not rated this month"}
        </span>
      </header>

      <div style={{ ...lettersStyle, gridTemplateColumns: "repeat(3, minmax(0,1fr))" }}>
        <QDLetter
          letter="Q"
          metric="quality"
          layout={Q_LAYOUT}
          businessDate={businessDate}
          ratingByDate={ratingByDate}
          canChooseToday={canChooseToday}
          compact={compact}
          busy={savingMetric !== null}
          onChoose={setActiveMetric}
        />
        <QDLetter
          letter="C"
          metric="cost"
          layout={C_LAYOUT}
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
          layout={D_LAYOUT}
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
          <span style={chooserLabelStyle}>{METRIC_LABELS[activeMetric]} today:</span>
          <button type="button" data-qd-picker-control="true" disabled={savingMetric !== null} onClick={() => void save(null)} style={{ ...choiceButtonStyle, background: "#e7ebf1", color: "#465468" }}>Blank</button>
          <button type="button" data-qd-picker-control="true" disabled={savingMetric !== null} onClick={() => void save("green")} style={{ ...choiceButtonStyle, background: COLORS.green }}>Green</button>
          <button type="button" data-qd-picker-control="true" disabled={savingMetric !== null} onClick={() => void save("yellow")} style={{ ...choiceButtonStyle, background: COLORS.yellow, color: "#5c4410" }}>Yellow</button>
          <button type="button" data-qd-picker-control="true" disabled={savingMetric !== null} onClick={() => void save("red")} style={{ ...choiceButtonStyle, background: COLORS.red }}>Red</button>
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
const fillerCellStyle: React.CSSProperties = { display: "block", width: "100%", height: "100%", minWidth: 0, minHeight: 0, boxSizing: "border-box", border: "1px solid rgba(255,255,255,.55)", background: "#c8cdd4", boxShadow: "inset 0 0 0 1px rgba(15,23,42,.03)" };
const chooserStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: "7px 8px", border: "1px solid rgba(37,134,215,.22)", borderRadius: 9, background: "rgba(255,255,255,.74)" };
const chooserLabelStyle: React.CSSProperties = { marginRight: 2, fontSize: 11, fontWeight: 850 };
const choiceButtonStyle: React.CSSProperties = { minWidth: 49, height: 27, border: "1px solid rgba(15,23,42,.12)", borderRadius: 7, color: "#fff", padding: "0 8px", cursor: "pointer", fontSize: 10, fontWeight: 850, fontFamily: "inherit" };
const errorStyle: React.CSSProperties = { color: "#b91c1c", fontSize: 10, fontWeight: 750 };
