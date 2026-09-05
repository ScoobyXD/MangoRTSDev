import { useEffect, useRef, useState } from "react";
import { APIHTTPError, isAbortError } from "../../modules/api/requestJSON.js";
import { ProcessStepMap, type ProcessStepMapEditorProps } from "../../modules/kanban/ProcessStepMap.js";
import { clearProcessWorkCache, getCachedProcessWork, getProcessWorkSingleFlight, invalidateLogicGateArenaViewCache, PROCESS_WORK_UPDATED_EVENT } from "../../modules/kanban/kanbanApi.js";
import type { ProcessWorkSnapshot } from "../../modules/kanban/processWork.js";
import { createCoalescedCanonicalRefresh } from "../../modules/realtime/coalescedCanonicalRefresh.js";
import { subscribeRealtimeScope } from "../../modules/realtime/realtimeWebSocket.js";

export type ProcessMapSavedProcessProps = {
  apiBase: string;
  companyID: string;
  processID: string;
  onBusyChange?: (busy: boolean) => void;
  isDark?: boolean;
  hoverModeEnabled?: boolean;
  renderActions?: ProcessStepMapEditorProps["renderActions"];
};

export function ProcessMapSavedProcess(props: ProcessMapSavedProcessProps) {
  return <SavedProcess key={`${props.apiBase}:${props.companyID}:${props.processID}`} {...props} />;
}

function SavedProcess({ apiBase, companyID, processID, onBusyChange, isDark, hoverModeEnabled, renderActions }: ProcessMapSavedProcessProps) {
  const [snapshot, setSnapshot] = useState<ProcessWorkSnapshot | null>(() => getCachedProcessWork(apiBase, companyID, processID)?.contents ?? null);
  const [loading, setLoading] = useState(true);
  const [mapBusy, setMapBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const refreshRef = useRef<() => void>(() => undefined);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;

  useEffect(() => { onBusyChange?.(loading || mapBusy); }, [onBusyChange, loading, mapBusy]);
  useEffect(() => () => busyCallback.current?.(false), []);
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const refresh = createCoalescedCanonicalRefresh(async () => {
      const next = await getProcessWorkSingleFlight(apiBase, companyID, processID, controller.signal);
      if (!live) return;
      setSnapshot(next);
      setError("");
      setLoading(false);
    }, (cause) => {
      if (!live || isAbortError(cause)) return;
      if (cause instanceof APIHTTPError && [401, 403, 404].includes(cause.status)) {
        clearProcessWorkCache(apiBase, companyID, processID);
        setSnapshot(null);
      }
      setError(cause instanceof Error ? cause.message : "Could not load this Process.");
      setLoading(false);
    });
    refreshRef.current = refresh.request;
    const requestRefresh = () => {
      if (!live) return;
      invalidateLogicGateArenaViewCache(apiBase, companyID, processID);
      refresh.request();
    };
    const localUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ companyID: string; logicGateID: string }>).detail;
      if (detail?.companyID === companyID && detail.logicGateID === processID) requestRefresh();
    };
    const unsubscribe = subscribeRealtimeScope(apiBase, companyID, `process:${processID}`, {
      onAccepted: requestRefresh,
      onProcessWorkChanged: requestRefresh,
      onRejected: () => {
        if (!live) return;
        live = false;
        controller.abort();
        refresh.dispose();
        clearProcessWorkCache(apiBase, companyID, processID);
        setSnapshot(null);
        setError("This Process is unavailable.");
        setLoading(false);
      },
    });
    window.addEventListener(PROCESS_WORK_UPDATED_EVENT, localUpdate);
    requestRefresh();
    return () => {
      live = false;
      controller.abort();
      refresh.dispose();
      unsubscribe();
      window.removeEventListener(PROCESS_WORK_UPDATED_EVENT, localUpdate);
    };
  }, [apiBase, companyID, processID, retry]);

  return <section aria-label="Saved Process map" className="process-map-saved-process">
    {loading && <div role="status" className="process-map-authoring-notice">Loading Process…</div>}
    {error && <div role="alert" className="process-map-authoring-error">{error} <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></div>}
    {!snapshot && renderActions?.({ createStep: () => {}, disabled: true, busy: loading })}
    {snapshot && <ProcessStepMap apiBase={apiBase} companyID={companyID} processID={processID}
      steps={snapshot.steps} relationships={snapshot.relationships} canEdit={!loading && !error && snapshot.permissions.can_edit} processName={snapshot.logic_gate.header}
      onChanged={() => refreshRef.current()} onBusyChange={setMapBusy} isDark={isDark} presentation="canvas" hoverModeEnabled={hoverModeEnabled} renderActions={renderActions} />}
  </section>;
}
