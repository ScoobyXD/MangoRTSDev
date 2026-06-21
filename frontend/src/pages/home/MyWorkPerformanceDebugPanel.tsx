import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  MY_WORK_DEBUG_STORAGE_KEY,
  clearRestoredHomeViewStorage,
  disableMyWorkDebugAndReload,
  getMyWorkDebugSnapshot,
  readMyWorkBrowserDebugContext,
  subscribeMyWorkDebugSnapshot,
  type MyWorkBrowserDebugContext,
  type MyWorkDebugCacheSummary,
  type MyWorkDebugCellTiming,
  type MyWorkDebugGroupStats,
  type MyWorkDebugTimings,
  type MyWorkDebugTreeStats,
  type MyWorkPerformanceDebugSnapshot,
} from "./myWorkPerformanceDebug";

export default function MyWorkPerformanceDebugPanel() {
  const [snapshot, setSnapshot] = useState<MyWorkPerformanceDebugSnapshot>(() => getMyWorkDebugSnapshot());
  const [browserContext, setBrowserContext] = useState<MyWorkBrowserDebugContext>(() => readMyWorkBrowserDebugContext());
  const [copyStatus, setCopyStatus] = useState("");
  const refresh = useCallback(() => {
    setSnapshot(getMyWorkDebugSnapshot());
    setBrowserContext(readMyWorkBrowserDebugContext());
  }, []);

  useEffect(() => {
    refresh();
    const unsubscribe = subscribeMyWorkDebugSnapshot(refresh);
    const timer = window.setInterval(refresh, 1500);
    window.addEventListener("popstate", refresh);
    window.addEventListener("hashchange", refresh);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
      window.removeEventListener("popstate", refresh);
      window.removeEventListener("hashchange", refresh);
    };
  }, [refresh]);

  const copyPayload = useMemo(() => ({
    snapshot,
    browser: browserContext,
  }), [browserContext, snapshot]);

  const copySnapshot = useCallback(async () => {
    const text = JSON.stringify(copyPayload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Copy failed");
    }
    window.setTimeout(() => setCopyStatus(""), 1600);
  }, [copyPayload]);

  const clearRestoredHomeView = useCallback(() => {
    const removed = clearRestoredHomeViewStorage();
    setBrowserContext(readMyWorkBrowserDebugContext());
    setCopyStatus(removed === 1 ? "Cleared 1 key" : "Cleared " + removed + " keys");
    window.setTimeout(() => setCopyStatus(""), 1600);
  }, []);

  return (
    <aside style={panelStyle} aria-label="My Work performance diagnostics">
      <div style={panelHeaderStyle}>
        <div>
          <div style={panelTitleStyle}>My Work Diagnostics</div>
          <div style={panelSubtitleStyle}>{snapshot.enabled ? "debug enabled" : "debug disabled"} - {snapshot.updatedAt}</div>
        </div>
        <button type="button" style={buttonStyle("danger")} onClick={disableMyWorkDebugAndReload}>Disable debug</button>
      </div>

      <div style={buttonRowStyle}>
        <button type="button" style={buttonStyle("default")} onClick={copySnapshot}>Copy snapshot</button>
        <button type="button" style={buttonStyle("default")} onClick={clearRestoredHomeView}>Clear restored Home view</button>
        {copyStatus && <span style={statusStyle}>{copyStatus}</span>}
      </div>

      <PanelSection title="Context">
        <KeyValue label="flag" value={MY_WORK_DEBUG_STORAGE_KEY} />
        <KeyValue label="active Home view" value={snapshot.activeHomeView ?? "unknown"} />
        <KeyValue label="company" value={shortID(snapshot.companyID)} />
        <KeyValue label="user" value={shortID(snapshot.currentUserID)} />
        <KeyValue label="scope" value={scopeLabel(snapshot)} />
        <KeyValue label="target users" value={String(snapshot.targetUserCount ?? 0)} />
        <KeyValue label="path" value={browserContext.route.pathname || "-"} />
        <KeyValue label="search" value={browserContext.route.search || "-"} />
        <KeyValue label="hash" value={browserContext.route.hash || "-"} />
      </PanelSection>

      <PanelSection title="Restored Home View">
        {browserContext.homeViewStorage.length === 0 ? (
          <div style={emptyStyle}>No mangorts.app.home-view.v1 keys</div>
        ) : browserContext.homeViewStorage.map((entry) => (
          <KeyValue key={entry.key} label={entry.key} value={entry.value || "(empty)"} />
        ))}
      </PanelSection>

      <PanelSection title="Cache">
        <CacheSummary cache={snapshot.cache} />
      </PanelSection>

      <PanelSection title="Payload And Rows">
        <TreeStats title="matrix" stats={snapshot.matrixPayloadStats} />
        <TreeStats title="rows" stats={snapshot.rowStats} />
        <GroupStats title="groups" stats={snapshot.topLevelGroupStats} />
      </PanelSection>

      <PanelSection title="Timings">
        <TimingSummary timings={snapshot.timings} />
      </PanelSection>

      <PanelSection title="Slow Cells">
        {snapshot.matrixRender?.slowestCells?.length ? snapshot.matrixRender.slowestCells.map((cell) => (
          <CellTiming key={String(cell.priority) + ":" + cell.role} cell={cell} />
        )) : <div style={emptyStyle}>No cell timing yet</div>}
      </PanelSection>

      <PanelSection title="Recent Causes">
        {snapshot.recentRefreshCauses.length === 0 ? (
          <div style={emptyStyle}>No refresh causes yet</div>
        ) : snapshot.recentRefreshCauses.map((cause) => (
          <div key={cause.at + cause.cause} style={causeRowStyle}>
            <span>{cause.cause}</span>
            <span>{cause.at}</span>
          </div>
        ))}
      </PanelSection>

      <PanelSection title="Memory">
        {browserContext.memory ? (
          <>
            <KeyValue label="used" value={formatBytes(browserContext.memory.usedJSHeapSize)} />
            <KeyValue label="total" value={formatBytes(browserContext.memory.totalJSHeapSize)} />
            <KeyValue label="limit" value={formatBytes(browserContext.memory.jsHeapSizeLimit)} />
          </>
        ) : <div style={emptyStyle}>performance.memory unavailable</div>}
      </PanelSection>
    </aside>
  );
}

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={sectionStyle}>
      <div style={sectionTitleStyle}>{title}</div>
      {children}
    </section>
  );
}

function CacheSummary({ cache }: { cache?: MyWorkDebugCacheSummary }) {
  if (!cache) return <div style={emptyStyle}>No cache state yet</div>;
  return (
    <>
      <KeyValue label="key" value={cache.cacheKey || "-"} />
      <KeyValue label="hit" value={cache.hit || "unknown"} />
      <KeyValue label="state" value={"loading=" + cache.loading + " stale=" + cache.stale + " hasValue=" + cache.hasValue} />
      <KeyValue label="age" value={cache.ageMs === null ? "-" : formatMs(cache.ageMs)} />
      <KeyValue label="cells" value={String(cache.cellCount)} />
      <KeyValue label="failures" value={String(cache.failureCount)} />
      <KeyValue label="targets" value={String(cache.targetUserCount)} />
    </>
  );
}

function TreeStats({ title, stats }: { title: string; stats?: MyWorkDebugTreeStats }) {
  if (!stats) return <KeyValue label={title} value="pending" />;
  return <KeyValue label={title} value={"top=" + stats.topLevel + " total=" + stats.total + " p/lg/n=" + stats.projects + "/" + stats.logicGates + "/" + stats.nodes + " depth=" + stats.maxDepth} />;
}

function GroupStats({ title, stats }: { title: string; stats?: MyWorkDebugGroupStats }) {
  if (!stats) return <KeyValue label={title} value="pending" />;
  return <KeyValue label={title} value={"top=" + stats.topLevel + " total=" + stats.total + " depth=" + stats.maxDepth} />;
}

function TimingSummary({ timings }: { timings?: MyWorkDebugTimings }) {
  if (!timings) return <div style={emptyStyle}>No timings yet</div>;
  return (
    <>
      <KeyValue label="fetch/cache" value={formatOptionalMs(timings.matrixFetchCacheLoadMs)} />
      <KeyValue label="cells -> rows" value={formatOptionalMs(timings.rowsFromMatrixMs)} />
      <KeyValue label="top grouping" value={formatOptionalMs(timings.topLevelGroupingMs)} />
      <KeyValue label="signature" value={formatOptionalMs(timings.groupingSignatureMs)} />
      <KeyValue label="default expand" value={formatOptionalMs(timings.defaultExpansionMs)} />
      <KeyValue label="render commit" value={formatOptionalMs(timings.matrixRenderCommitMs)} />
      <KeyValue label="cell filter/sort/group" value={formatOptionalMs(timings.perCellFilterMs) + " / " + formatOptionalMs(timings.perCellSortMs) + " / " + formatOptionalMs(timings.perCellGroupingMs)} />
    </>
  );
}

function CellTiming({ cell }: { cell: MyWorkDebugCellTiming }) {
  return (
    <div style={cellTimingStyle}>
      <span>{cell.role} P{cell.priority}</span>
      <span>{formatMs(cell.totalMs)}</span>
      <span>{cell.rows}/{cell.totalRows} rows</span>
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div style={kvRowStyle}>
      <span style={kvLabelStyle}>{label}</span>
      <span style={kvValueStyle} title={value}>{value}</span>
    </div>
  );
}

function scopeLabel(snapshot: MyWorkPerformanceDebugSnapshot): string {
  if (snapshot.selectedScopeLabel) return snapshot.selectedScopeLabel;
  if (!snapshot.selectedScope) return "unknown";
  try { return JSON.stringify(snapshot.selectedScope); } catch { return "unknown"; }
}

function shortID(value?: string): string {
  const clean = value?.trim() ?? "";
  if (!clean) return "-";
  return clean.length <= 14 ? clean : clean.slice(0, 6) + "..." + clean.slice(-6);
}

function formatOptionalMs(value?: number): string {
  return typeof value === "number" ? formatMs(value) : "-";
}

function formatMs(value: number): string {
  return Math.round(value * 10) / 10 + " ms";
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let scaled = value;
  let unitIndex = 0;
  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }
  return (unitIndex === 0 ? Math.round(scaled) : Math.round(scaled * 10) / 10) + " " + units[unitIndex];
}

const panelStyle: React.CSSProperties = {
  position: "fixed",
  right: 16,
  bottom: 16,
  zIndex: 80,
  width: "min(520px, calc(100vw - 32px))",
  maxHeight: "min(760px, calc(100vh - 32px))",
  overflow: "auto",
  padding: 12,
  border: "1px solid rgba(34, 47, 62, 0.22)",
  borderRadius: 8,
  background: "rgba(251, 252, 254, 0.98)",
  boxShadow: "0 18px 48px rgba(15, 23, 42, 0.22)",
  color: "#16202f",
  fontSize: 12,
  lineHeight: 1.35,
};

const panelHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "flex-start",
};

const panelTitleStyle: React.CSSProperties = { fontSize: 14, fontWeight: 800 };
const panelSubtitleStyle: React.CSSProperties = { color: "#637083", marginTop: 2 };

const buttonRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  alignItems: "center",
  marginTop: 10,
};

function buttonStyle(kind: "default" | "danger"): React.CSSProperties {
  return {
    border: kind === "danger" ? "1px solid rgba(176, 46, 46, 0.38)" : "1px solid rgba(44, 62, 80, 0.22)",
    background: kind === "danger" ? "#fff4f2" : "#ffffff",
    color: kind === "danger" ? "#9f2f26" : "#1d2b3a",
    borderRadius: 6,
    padding: "5px 8px",
    font: "inherit",
    fontWeight: 700,
    cursor: "pointer",
  };
}

const statusStyle: React.CSSProperties = { color: "#56657a", fontWeight: 700 };

const sectionStyle: React.CSSProperties = {
  borderTop: "1px solid rgba(44, 62, 80, 0.14)",
  paddingTop: 9,
  marginTop: 9,
};

const sectionTitleStyle: React.CSSProperties = {
  fontWeight: 800,
  color: "#36465c",
  marginBottom: 6,
  textTransform: "uppercase",
  fontSize: 11,
  letterSpacing: 0,
};

const kvRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "132px minmax(0, 1fr)",
  gap: 8,
  alignItems: "baseline",
  minHeight: 20,
};

const kvLabelStyle: React.CSSProperties = { color: "#647084", fontWeight: 700 };
const kvValueStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace" };
const emptyStyle: React.CSSProperties = { color: "#7a8697" };

const cellTimingStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 74px 86px",
  gap: 8,
  minHeight: 20,
  fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
};

const causeRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 174px",
  gap: 8,
  minHeight: 20,
};