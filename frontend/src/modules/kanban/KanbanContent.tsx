
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchCurrentUser } from "../../auth/cognitoAuth";
import { getActiveCompanyID } from "../../auth/currentCompany";
import { AppModalPortal } from "../../app/AppModalPortal";
import { ConfirmActionMenu } from "../../app/ConfirmActionMenu";
import { requestAppDockTab } from "../../app/appDockTabs";
import { buildLogicGateRoute } from "../../app/deepLinkRoutes";
import { openAppPathInNewTab } from "../../app/resourceLinks";
import { requestJSON, isAbortError, APIHTTPError } from "../api/requestJSON";
import { convertTriageMessagesToExplorerTarget, listCompanyUsers, transferEmailNodeToNode } from "../communications/communicationsApi";
import { dispatchTriageConversionApplied } from "../triage/triageEvents";
import { hasTriageMessageDrag, readTriageMessageDrag } from "../triage/triageDragDrop";
import { invalidateNodeRecordStoreCaches } from "../nodes/nodeRecordStore";
import { removeNodeRelationshipGraphNode, upsertNodeRelationshipGraphNode } from "../nodes/nodeRelationshipGraph";
import { subscribeCommittedEntityTitleUpdates } from "../realtime/committedEntityTitleUpdates";
import { createCoalescedCanonicalRefresh } from "../realtime/coalescedCanonicalRefresh";
import { subscribeRealtimeScope } from "../realtime/realtimeWebSocket";
import { publishLiveSelection, readLiveSelectionForFrame, subscribeLiveSelection } from "../selectionCoordinator";
import { fetchSavedViews, saveSavedView, type SavedView, type SavedViewGrouping } from "../../pages/home/savedViewsApi";
import { buildUniversalNestedGroups, type UniversalNestedGroup, type UniversalGroupValue } from "../grouping/universalGrouping";
import { assignNodeToLogicGateStatus, changeProcessNodeState, createProcessNode, createProcessStep, deleteProcessStep, deleteProcessStepRelationship, dispatchLogicGateWorkUpdated, clearProcessWorkCache, getCachedProcessWork, getProcessWorkSingleFlight, invalidateLogicGateArenaViewCache, PROCESS_WORK_UPDATED_EVENT, updateProcessStep, type ProcessNodeStatePatch } from "./kanbanApi";
import { orderedProcessSteps, PROCESS_STATUSES, PROCESS_WORK_VIEWS, processNodeMovePlan, processStatusColor, processWorkCounts, processWorkView, type ProcessStep, type ProcessWorkNode, type ProcessWorkSnapshot, type ProcessWorkView } from "./processWork";
import { readFrameLinksFromStorage, readFrameRegistryFromStorage, resolveConnectedFrameTargets } from "../linkingGraph";
import { shouldResetNodeEditorOverlayViewMode } from "./nodeEditorOverlayViewMode";
import { KanbanGroupingControls } from "./KanbanGroupingControls";
import { KanbanNodeEditorOverlay } from "./KanbanOverlays";
import { getNodeEditorOverlayMinLeftPx, type NodeEditorOverlayRatio, clampNodeEditorOverlayRatio, DEFAULT_NODE_EDITOR_OVERLAY_RATIO, readNodeEditorOverlayRatio, storeNodeEditorOverlayRatio, type KanbanContentProps, type NodeEditorOverlayState, type OverlayResizeState, type CompanyUser } from "./KanbanContentModel";
import { EXPLORER_ENTITY_DRAG_MIME, parseExplorerEntityDragItems, getKanbanPriorityGroupLabel } from "./shared";
import { ProcessNodeCard } from "./ProcessNodeCard";
import { PROCESS_NODE_DRAG } from "./processWork";
import "./processWork.css";

type WorkDialog = { kind: "step" | "node" | "start"; name: string; stepID: string; nodeIDs: string[]; afterID?: string; status?: string };
type Group = UniversalNestedGroup<ProcessWorkNode, string>;
const defaultGroupings: SavedViewGrouping[] = [{ field: "priority", direction: "asc" }];

function sameNodeEditorOverlayRatio(a: NodeEditorOverlayRatio, b: NodeEditorOverlayRatio): boolean {
  return Math.abs(a.left - b.left) < .0001 && Math.abs(a.top - b.top) < .0001 && Math.abs(a.width - b.width) < .0001 && Math.abs(a.height - b.height) < .0001;
}
function nodeEditorOverlayRatioForBoardLeftResize(startRatio: NodeEditorOverlayRatio, startBoardWidthPx: number, appliedDeltaX: number, nextBoardWidthPx: number, minLeftPx: number): NodeEditorOverlayRatio {
  const startWidth = Math.max(1, startBoardWidthPx), nextWidth = Math.max(1, nextBoardWidthPx);
  return clampNodeEditorOverlayRatio({ ...startRatio, left: startRatio.left * startWidth / nextWidth, width: (startRatio.width * startWidth - appliedDeltaX) / nextWidth }, { minLeft: minLeftPx / nextWidth });
}
export const KanbanContent: React.FC<KanbanContentProps> = ({ accent, widgetId, theme = "mango", forcedLogicGateID = "", forcedLogicGateLabel = "", forcedOpenNodeID = "", forcedHighlightedNodeID = "", controlForcedOpenNode = false, arenaBoardLeftResizeRequest = null, onCollapseArenaToTab, onNodeEditorOverlayOpen, onNodeEditorOverlayClose, onNodeEditorOverlayLeftResizeStart, onNodeEditorOverlayLeftResize, onNodeEditorOverlayLeftResizeEnd }) => {
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || "http://localhost:8080";
  const companyID = getActiveCompanyID();
  const isDark = theme === "dark";
  const frameID = widgetId || "process-work";
  const [processID, setProcessID] = useState(forcedLogicGateID);
  const [snapshot, setSnapshot] = useState<ProcessWorkSnapshot | null>(null);
  const [view, setView] = useState<ProcessWorkView>("Steps");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectionAnchor = useRef("");
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [userID, setUserID] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<WorkDialog | null>(null);
  const [deletion, setDeletion] = useState<{ nodeIDs?: string[]; step?: ProcessStep } | null>(null);
  const [overlay, setOverlay] = useState<NodeEditorOverlayState | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;
  const [ratio, setRatio] = useState(() => readNodeEditorOverlayRatio(companyID, frameID));
  const ratioRef = useRef(ratio);
  ratioRef.current = ratio;
  const arenaResizeBaseline = useRef<{ sessionID: number; ratio: NodeEditorOverlayRatio; startKanbanWidthPx: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<OverlayResizeState | null>(null);
  const [groupings, setGroupings] = useState<SavedViewGrouping[]>(defaultGroupings);
  const [dateSort, setDateSort] = useState(true);
  const [dateDirection, setDateDirection] = useState<"asc" | "desc">("desc");
  const [groupOpen, setGroupOpen] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);
  const savedViewRef = useRef<SavedView | null>(null);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [groupSaving, setGroupSaving] = useState(false);
  const lastSavedGrouping = useRef("");
  const saveGroupingQueue = useRef(Promise.resolve());
  const snapshotRef = useRef(snapshot);
  const pendingMutations = useRef(0);
  const refreshRef = useRef<() => void>(() => undefined);
  const processRef = useRef(processID);
  snapshotRef.current = snapshot;
  processRef.current = processID;

  useEffect(() => { if (forcedLogicGateID) setProcessID(forcedLogicGateID); }, [forcedLogicGateID]);
  useEffect(() => {
    if (forcedLogicGateID) return;
    const apply = (selection: ReturnType<typeof readLiveSelectionForFrame>) => {
      if (selection?.entityKind === "logic_gate") setProcessID(selection.entityID);
      if (selection?.entityKind === "node") setSelected(new Set(selection.selectedEntityIDs ?? [selection.entityID]));
    };
    apply(readLiveSelectionForFrame(companyID, frameID));
    return subscribeLiveSelection(frameID, apply);
  }, [companyID, forcedLogicGateID, frameID]);
  useEffect(() => {
    let live = true;
    void Promise.allSettled([fetchCurrentUser(), listCompanyUsers(companyID)]).then(([me, people]) => {
      if (!live) return;
      if (me.status === "fulfilled") setUserID(me.value.user.user_id);
      if (people.status === "fulfilled") setUsers(people.value);
    });
    return () => { live = false; };
  }, [companyID]);
  useEffect(() => {
    if (!processID || !companyID) { setSnapshot(null); return; }
    let live = true;
    const controller = new AbortController();
    setSelected(new Set()); setView("Steps"); setError(""); setBusy(false); setDialog(null); setDeletion(null); setOverlay(null); setFullscreen(false); if (overlay) onNodeEditorOverlayClose?.();
    const cached = getCachedProcessWork(apiBase, companyID, processID);
    setSnapshot(cached?.contents ?? null); setLoading(!cached);
    const refresh = createCoalescedCanonicalRefresh(async () => {
      if (!live || pendingMutations.current > 0) return;
      const next = await getProcessWorkSingleFlight(apiBase, companyID, processID, controller.signal);
      if (!live || pendingMutations.current > 0) return;
      setSnapshot(next); setLoading(false);
      setSelected((current) => new Set([...current].filter((id) => next.nodes.some((node) => node.node_id === id))));
    }, (cause) => { if (live && !isAbortError(cause)) { if (cause instanceof APIHTTPError && (cause.status === 403 || cause.status === 404)) { clearProcessWorkCache(apiBase, companyID, processID); setSnapshot(null); } setError(cause instanceof Error ? cause.message : "Could not load Process work."); setLoading(false); } });
    refreshRef.current = refresh.request;
    const requestRefresh = () => { invalidateLogicGateArenaViewCache(apiBase, companyID, processID); refresh.request(); };
    const localUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ companyID: string; logicGateID: string }>).detail;
      if (detail?.companyID === companyID && detail.logicGateID === processID) requestRefresh();
    };
    const unsubscribe = subscribeRealtimeScope(apiBase, companyID, `process:${processID}`, {
      onAccepted: requestRefresh,
      onProcessWorkChanged: requestRefresh,
      onRejected: () => { if (live) { live = false; controller.abort(); refresh.dispose(); clearProcessWorkCache(apiBase, companyID, processID); setSnapshot(null); setError("This Process is unavailable."); setLoading(false); } },
    });
    window.addEventListener(PROCESS_WORK_UPDATED_EVENT, localUpdate); refresh.request();
    return () => { live = false; controller.abort(); refresh.dispose(); unsubscribe(); window.removeEventListener(PROCESS_WORK_UPDATED_EVENT, localUpdate); };
  }, [apiBase, companyID, processID]);
  useEffect(() => subscribeCommittedEntityTitleUpdates((update) => {
    if (update.companyID !== companyID) return;
    setSnapshot((current) => !current ? current : { ...current,
      logic_gate: update.entityType === "logic_gate" && current.logic_gate.logic_gate_id === update.resourceID ? { ...current.logic_gate, header: update.title } : current.logic_gate,
      nodes: update.entityType === "node" ? current.nodes.map((node) => node.node_id === update.resourceID ? { ...node, node_title: update.title } : node) : current.nodes,
    });
    if (update.entityType === "node") setOverlay((current) => current?.nodeID === update.resourceID ? { ...current, nodeTitle: update.title } : current);
  }), [companyID]);

  useEffect(() => {
    if (!userID) return;
    let live = true; setGroupsLoaded(false);
    void fetchSavedViews({ apiBase, companyID, surface: "logic_gate_kanban" }).then((rows) => {
      if (!live) return;
      const saved = rows.find((row) => row.principal === "user" && row.principal_id === userID) ?? null;
      savedViewRef.current = saved;
      const nextGroups = saved?.groupings ?? defaultGroupings;
      const nextSort = saved?.settings.date_added_sort_enabled ?? true;
      const nextDirection = saved?.settings.date_added_sort_direction ?? "desc";
      setGroupings(nextGroups); setDateSort(nextSort); setDateDirection(nextDirection);
      lastSavedGrouping.current = JSON.stringify([nextGroups, nextSort, nextDirection]); setGroupsLoaded(true);
    }).catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : "Could not load grouping settings."); });
    return () => { live = false; };
  }, [apiBase, companyID, userID]);
  useEffect(() => {
    const signature = JSON.stringify([groupings, dateSort, dateDirection]);
    if (!groupsLoaded || !userID || signature === lastSavedGrouping.current) return;
    const timer = window.setTimeout(() => {
      lastSavedGrouping.current = signature; setGroupSaving(true);
      saveGroupingQueue.current = saveGroupingQueue.current.then(async () => {
        savedViewRef.current = await saveSavedView({ apiBase, savedView: { company_id: companyID, saved_view_id: savedViewRef.current?.saved_view_id, surface: "logic_gate_kanban", principal: "user", principal_id: userID, name: "Process work", groupings, settings: { date_added_sort_enabled: dateSort, date_added_sort_direction: dateDirection } } });
      }).catch((cause) => { lastSavedGrouping.current = ""; setError(cause instanceof Error ? cause.message : "Could not save grouping settings."); }).finally(() => setGroupSaving(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [apiBase, companyID, userID, groupings, dateSort, dateDirection, groupsLoaded]);
  useEffect(() => {
    if (!groupOpen) return;
    const close = (event: PointerEvent) => { if (!groupRef.current?.contains(event.target as Node)) setGroupOpen(false); };
    window.addEventListener("pointerdown", close); return () => window.removeEventListener("pointerdown", close);
  }, [groupOpen]);
  const closeOverlay = useCallback(() => { setOverlay(null); setFullscreen(false); onNodeEditorOverlayClose?.(); }, [onNodeEditorOverlayClose]);
  const openNode = useCallback((nodeID: string, name: string) => { if (shouldResetNodeEditorOverlayViewMode(overlayRef.current, nodeID)) setFullscreen(false); setOverlay({ nodeID, nodeTitle: name }); onNodeEditorOverlayOpen?.(nodeID); }, [onNodeEditorOverlayOpen]);
  useEffect(() => {
    if (forcedOpenNodeID) {
      if (shouldResetNodeEditorOverlayViewMode(overlayRef.current, forcedOpenNodeID)) setFullscreen(false);
      const node = snapshot?.nodes.find((item) => item.node_id === forcedOpenNodeID);
      setOverlay((current) => current?.nodeID === forcedOpenNodeID && (!node || current.nodeTitle === node.node_title) ? current : { nodeID: forcedOpenNodeID, nodeTitle: node?.node_title || "Node" });
    } else if (controlForcedOpenNode) setOverlay(null);
  }, [forcedOpenNodeID, controlForcedOpenNode, snapshot]);
  useEffect(() => {
    const move = (event: MouseEvent) => {
      const state = resizeRef.current; if (!state) return;
      event.preventDefault();
      const dx = event.clientX - state.startX, dy = event.clientY - state.startY;
      const linked = state.linkedLeftResize && state.edges.left ? onNodeEditorOverlayLeftResize?.(dx) : null;
      const width = Math.max(1, linked?.kanbanWidthPx ?? state.boardWidth), applied = linked?.appliedDeltaX ?? dx;
      const next = clampNodeEditorOverlayRatio({
        left: (state.startLeft + (state.edges.left && !linked ? dx : 0)) / width,
        top: (state.startTop + (state.edges.top ? dy : 0)) / state.boardHeight,
        width: (state.startWidth + (state.edges.right ? dx : 0) - (state.edges.left ? applied : 0)) / width,
        height: (state.startHeight + (state.edges.bottom ? dy : 0) - (state.edges.top ? dy : 0)) / state.boardHeight,
      }, { minLeft: state.minLeft / width });
      setRatio(next); storeNodeEditorOverlayRatio(companyID, frameID, next);
    };
    const end = () => { if (resizeRef.current?.linkedLeftResize) onNodeEditorOverlayLeftResizeEnd?.(); resizeRef.current = null; };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", end);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", end); };
  }, [companyID, frameID, onNodeEditorOverlayLeftResize, onNodeEditorOverlayLeftResizeEnd]);
  useEffect(() => {
    if (!overlay || !arenaBoardLeftResizeRequest) return;
    const request = arenaBoardLeftResizeRequest;
    const baseline = arenaResizeBaseline.current?.sessionID === request.sessionID
      ? arenaResizeBaseline.current
      : { sessionID: request.sessionID, ratio: ratioRef.current, startKanbanWidthPx: request.startKanbanWidthPx };
    arenaResizeBaseline.current = baseline;
    const next = nodeEditorOverlayRatioForBoardLeftResize(baseline.ratio, baseline.startKanbanWidthPx, request.appliedDeltaX, request.kanbanWidthPx, getNodeEditorOverlayMinLeftPx(rootRef.current, false));
    ratioRef.current = next;
    setRatio((current) => sameNodeEditorOverlayRatio(current, next) ? current : next);
    storeNodeEditorOverlayRatio(companyID, frameID, next);
  }, [arenaBoardLeftResizeRequest, companyID, frameID, overlay]);
  const mutate = useCallback(async (action: () => Promise<unknown>) => {
    if (pendingMutations.current > 0) return;
    pendingMutations.current += 1; setBusy(true); setError("");
    const targetProcess = processID;
    try { await action(); }
    catch (cause) { if (processRef.current === targetProcess) setError(cause instanceof Error ? cause.message : "The change could not be saved."); }
    finally {
      pendingMutations.current -= 1;
      if (processRef.current === targetProcess) setBusy(false);
      invalidateLogicGateArenaViewCache(apiBase, companyID, targetProcess); refreshRef.current();
    }
  }, [apiBase, companyID, processID]);
  const changeNodes = (ids: string[], patch: ProcessNodeStatePatch) => mutate(async () => {
    for (const id of ids) {
      const result = await changeProcessNodeState(apiBase, companyID, processID, id, patch);
      invalidateNodeRecordStoreCaches(apiBase, companyID, id); upsertNodeRelationshipGraphNode(apiBase, companyID, result.node);
    }
  });
  const steps = useMemo(() => orderedProcessSteps(snapshot?.steps ?? []), [snapshot?.steps]);
  const counts = useMemo(() => processWorkCounts(snapshot?.nodes ?? []), [snapshot?.nodes]);
  const stepByID = useMemo(() => new Map(steps.map((step) => [step.process_step_id, step])), [steps]);
  const userName = (id?: string) => users.find((person) => person.user_id === id)?.display_name || users.find((person) => person.user_id === id)?.email || "";
  const canEdit = snapshot?.permissions.can_edit === true;
  const selectedIDs = [...selected];
  const visible = useMemo(() => (snapshot?.nodes ?? []).filter((node) => processWorkView(node) === view), [snapshot?.nodes, view]);
  const sortNodes = (nodes: ProcessWorkNode[]) => [...nodes].sort((a, b) => dateSort ? (dateDirection === "asc" ? 1 : -1) * (Date.parse(a.created_timestamp) - Date.parse(b.created_timestamp)) || a.position - b.position : a.position - b.position);
  const groupingValues = (node: ProcessWorkNode, field: string): UniversalGroupValue[] => {
    if (field === "priority") return [{ key: `priority:${node.priority ?? 0}`, label: getKanbanPriorityGroupLabel(node.priority ?? 0), sortValue: node.priority ?? 6 }];
    if (field === "person") return [{ key: node.placed_by_user_id || "none", label: userName(node.placed_by_user_id) || "No person", sortValue: userName(node.placed_by_user_id) }];
    if (field === "account") return node.accounts?.length ? node.accounts.map((account) => ({ key: account.account_id, label: account.name, sortValue: account.name })) : [{ key: "none", label: "No account", sortValue: "", sortLast: true }];
    return [{ key: node.due_date || "none", label: node.due_date || "No due date", sortValue: node.due_date || "", sortLast: !node.due_date }];
  };
  const groupedNodes = (nodes: ProcessWorkNode[], rootID: string) => buildUniversalNestedGroups(nodes, groupings, { rootID, rowKey: (node) => node.node_id, getValues: groupingValues, sortRows: sortNodes });
  const renderedOrder = (nodes: ProcessWorkNode[]): ProcessWorkNode[] => {
    const flatten = (groups: Group[]): ProcessWorkNode[] => groups.flatMap((group) => group.groups.length ? flatten(group.groups) : group.rows);
    const ordered = groupings.length ? flatten(groupedNodes(nodes, "selection")) : sortNodes(nodes);
    return [...new Map(ordered.map((node) => [node.node_id, node])).values()];
  };
  const orderedVisible = steps.flatMap((step) => renderedOrder(visible.filter((node) => node.process_step_id === step.process_step_id))).concat(renderedOrder(visible.filter((node) => !node.process_step_id)));
  const updateSelection = (node: ProcessWorkNode, next: Set<string>) => {
    setSelected(next);
    try {
      publishLiveSelection({ companyID, entityKind: "node", entityID: node.node_id, label: node.node_title, sourceFrameID: frameID, sourceModule: "kanban",
        targetFrameIDs: resolveConnectedFrameTargets({ sourceFrameID: frameID, edges: readFrameLinksFromStorage(), registry: readFrameRegistryFromStorage() }),
        selectedTreeID: `node-${node.node_id}`, selectedTreeIDs: [...next].map((id) => `node-${id}`), selectedEntityIDs: [...next],
      });
    } catch { /* Local selection remains available when frame-link storage is unavailable. */ }
  };
  const selectNode = (node: ProcessWorkNode, event: React.MouseEvent) => {
    if (event.shiftKey && selectionAnchor.current) {
      const order = view === "Steps" ? orderedVisible : renderedOrder(visible);
      const anchor = order.findIndex((item) => item.node_id === selectionAnchor.current), index = order.findIndex((item) => item.node_id === node.node_id);
      if (anchor >= 0 && index >= 0) { updateSelection(node, new Set(order.slice(Math.min(anchor, index), Math.max(anchor, index) + 1).map((item) => item.node_id))); return; }
    }
    selectionAnchor.current = node.node_id;
    const next = event.ctrlKey || event.metaKey ? new Set(selected) : new Set<string>();
    if (next.has(node.node_id)) next.delete(node.node_id); else next.add(node.node_id);
    updateSelection(node, next);
  };
  const startWork = (nodes: ProcessWorkNode[]) => setDialog({ kind: "start", name: "", nodeIDs: nodes.map((node) => node.node_id), stepID: nodes.length === 1 ? nodes[0].process_step_id ?? steps[0]?.process_step_id ?? "" : steps[0]?.process_step_id ?? "" });
  const submitDialog = () => {
    if (!dialog) return; const draft = dialog;
    void mutate(async () => {
      if (draft.kind === "step") {
        if (draft.stepID) await updateProcessStep(apiBase, companyID, processID, draft.stepID, { name: draft.name.trim() });
        else await createProcessStep(apiBase, companyID, processID, draft.name.trim(), draft.afterID);
      } else if (draft.kind === "start") {
        for (const id of draft.nodeIDs) { const result = await changeProcessNodeState(apiBase, companyID, processID, id, { status: "In Progress", process_step_id: draft.stepID }); invalidateNodeRecordStoreCaches(apiBase, companyID, id); upsertNodeRelationshipGraphNode(apiBase, companyID, result.node); }
      } else {
        const result = await createProcessNode(apiBase, companyID, processID, draft.name.trim(), { status: draft.status, process_step_id: draft.stepID || null });
        upsertNodeRelationshipGraphNode(apiBase, companyID, result.node); openNode(result.node.node_id, result.node.name);
      }
      setDialog(null);
    });
  };
  const drop = (event: React.DragEvent, stepID: string | null, beforeNodeID?: string, priority?: number) => {
    event.preventDefault(); event.stopPropagation(); if (!canEdit || busy) return;
    const raw = event.dataTransfer.getData(PROCESS_NODE_DRAG);
    if (raw) {
      let data: { companyID: string; logicGateID: string; nodeIDs: string[] };
      try { data = JSON.parse(raw); } catch { return; }
      if (data.companyID !== companyID || data.logicGateID !== processID || !Array.isArray(data.nodeIDs)) return;
      const ids = data.nodeIDs.filter((id) => snapshotRef.current?.nodes.some((node) => node.node_id === id));
      const source = snapshotRef.current?.nodes.find((node) => node.node_id === ids[0]);
      const rect = event.currentTarget.getBoundingClientRect();
      const middleDrop = beforeNodeID && event.clientY > rect.top + rect.height * .25 && event.clientY < rect.bottom - rect.height * .25;
      void mutate(async () => {
        if (middleDrop && ids.length === 1 && source?.created_from_email && ids[0] !== beforeNodeID) {
          await transferEmailNodeToNode({ companyID, sourceNodeID: ids[0], targetNodeID: beforeNodeID! });
          invalidateNodeRecordStoreCaches(apiBase, companyID, beforeNodeID!); removeNodeRelationshipGraphNode(apiBase, companyID, ids[0]);
        } else if (view !== "Steps") {
          for (const id of ids) await changeProcessNodeState(apiBase, companyID, processID, id, { status: view === "Backlog" ? "Backlogs" : view, ...(priority !== undefined && priority >= 1 && priority <= 5 ? { priority } : {}) });
        } else {
          const plan = processNodeMovePlan(snapshotRef.current?.nodes ?? [], ids, stepID, beforeNodeID, { dateAddedSort: dateSort, priority });
          for (const change of plan) await changeProcessNodeState(apiBase, companyID, processID, change.node_id, { process_step_id: change.process_step_id, ...(change.position !== undefined ? { position: change.position } : {}), ...(change.priority !== undefined ? { priority: change.priority } : {}) });
        }
      });
      return;
    }
    const triage = readTriageMessageDrag(event.dataTransfer);
    if (triage.messageIDs.length) {
      if (triage.companyID && triage.companyID !== companyID) return;
      void mutate(async () => {
        const result = await convertTriageMessagesToExplorerTarget({ companyID, sharedInboxID: triage.sharedInboxID, accountEmail: triage.accountEmail, target: { mode: "existing_logic_gate", logicGateID: processID }, messageIDs: triage.messageIDs, status: view === "Steps" ? "In Progress" : view === "Backlog" ? "Backlogs" : view, processStepID: stepID, priority });
        dispatchTriageConversionApplied({ companyID, logicGateID: processID, messageIDs: triage.messageIDs, accountEmail: triage.accountEmail, sharedInboxID: triage.sharedInboxID, nodeIDs: result.nodes.map((node) => node.node_id), unstarredMessageIDs: result.unstarred_message_ids });
        if (result.nodes[0]) openNode(result.nodes[0].node_id, result.nodes[0].name);
      });
      return;
    }
    const items = parseExplorerEntityDragItems(event.dataTransfer.getData(EXPLORER_ENTITY_DRAG_MIME));
    if (items.length) void mutate(async () => { for (const item of items) await assignNodeToLogicGateStatus({ apiBase, companyID, logicGateID: processID, nodeID: item.nodeID, status: view === "Steps" ? "In Progress" : view === "Backlog" ? "Backlogs" : view, processStepID: stepID, priority, mutationOrigin: "kanban" }); });
  };
  const allowDrop = (event: React.DragEvent) => { if (canEdit && (event.dataTransfer.types.includes(PROCESS_NODE_DRAG) || event.dataTransfer.types.includes(EXPLORER_ENTITY_DRAG_MIME) || hasTriageMessageDrag(event.dataTransfer))) event.preventDefault(); };
  const renderNode = (node: ProcessWorkNode) => <ProcessNodeCard key={node.node_id} node={node} steps={steps} selected={selected.has(node.node_id) || forcedHighlightedNodeID === node.node_id} active={view === "Steps"} canEdit={canEdit} busy={busy} personName={userName(node.placed_by_user_id)}
    canAccept={canEdit && snapshot?.permissions.can_resolve_requests === true && node.requested_by_user_id !== userID} canCancel={canEdit && node.requested_by_user_id === userID}
    onSelect={(event) => selectNode(node, event)}
    onOpen={() => { updateSelection(node, new Set([node.node_id])); openNode(node.node_id, node.node_title); }} onChange={(patch) => void changeNodes([node.node_id], patch)} onStart={() => startWork([node])}
    onDragStart={(event) => { const nodeIDs = selected.has(node.node_id) ? selectedIDs : [node.node_id]; event.dataTransfer.setData(PROCESS_NODE_DRAG, JSON.stringify({ companyID, logicGateID: processID, nodeIDs })); event.dataTransfer.setData("text/plain", node.node_title); event.dataTransfer.effectAllowed = "move"; }} onDragOver={allowDrop} onDrop={(event) => drop(event, node.process_step_id, node.node_id)} />;
  const renderGroups = (groups: Group[], stepID: string | null): React.ReactNode => groups.map((group) => <section className="process-work__group" key={group.id}><div className="process-work__group-label" onDragOver={group.field === "priority" && Number(group.key.split(":")[1]) >= 1 && Number(group.key.split(":")[1]) <= 5 ? allowDrop : undefined} onDrop={group.field === "priority" && Number(group.key.split(":")[1]) >= 1 && Number(group.key.split(":")[1]) <= 5 ? (event) => drop(event, stepID, undefined, Number(group.key.split(":")[1])) : undefined}>{group.label}<span>{group.rows.length}</span></div>{group.groups.length ? renderGroups(group.groups, stepID) : group.rows.map(renderNode)}</section>);
  const renderNodes = (nodes: ProcessWorkNode[], stepID: string | null) => groupings.length ? renderGroups(groupedNodes(nodes, stepID || view), stepID) : sortNodes(nodes).map(renderNode);
  const newNode = (stepID: string | null) => setDialog({ kind: "node", name: "", stepID: stepID ?? "", nodeIDs: [], status: view === "Steps" ? "In Progress" : view === "Backlog" ? "Backlogs" : view });
  const moveStep = (step: ProcessStep, direction: number) => {
    const index = steps.findIndex((item) => item.process_step_id === step.process_step_id), target = steps[index + direction]; if (!target) return;
    void mutate(async () => { await updateProcessStep(apiBase, companyID, processID, step.process_step_id, { position: target.position }); await updateProcessStep(apiBase, companyID, processID, target.process_step_id, { position: step.position }); });
  };
  const renderStep = (step: ProcessStep | null, index: number) => {
    const id = step?.process_step_id ?? null, nodes = visible.filter((node) => node.process_step_id === id);
    const outgoing = snapshot?.relationships.filter((edge) => edge.source.resource_id === id) ?? [];
    return <section key={id ?? "unassigned"} data-process-step={id ?? "unassigned"} className={`process-work__step${step ? "" : " process-work__unassigned"}`} onDragOver={allowDrop} onDrop={(event) => drop(event, id)}>
      <header><div><h3>{step?.name ?? "No step assigned"}</h3><span className="process-work__count">{nodes.length}</span></div>{canEdit && <div className="process-work__step-controls">
        <button type="button" className="process-work__icon-button" aria-label={`New Node in ${step?.name ?? "No step assigned"}`} title="New Node" disabled={busy} onClick={() => newNode(id)}>+</button>
        {step && <details><summary className="process-work__icon-button" aria-label={`Options for ${step.name}`}>⋯</summary><div className="process-work__step-menu">
        <button type="button" disabled={busy} onClick={() => setDialog({ kind: "step", name: step.name, stepID: id!, nodeIDs: [] })}>Rename</button>
        <button type="button" disabled={busy || index === 0} onClick={() => moveStep(step, -1)}>Move left</button><button type="button" disabled={busy || index === steps.length - 1} onClick={() => moveStep(step, 1)}>Move right</button>
        <button type="button" disabled={busy} onClick={() => setDialog({ kind: "step", name: "", stepID: "", afterID: id!, nodeIDs: [] })}>Add next step</button><button type="button" disabled={busy} className="process-work__danger" onClick={() => setDeletion({ step })}>Delete column</button>
      </div></details>}</div>}</header>
      {outgoing.length > 0 && <div className="process-work__connections">{outgoing.map((edge) => <span key={edge.resource_operational_relationship_id}>→ {stepByID.get(edge.target.resource_id)?.name}{canEdit && <button type="button" title="Remove connection" disabled={busy} onClick={() => void mutate(() => deleteProcessStepRelationship(apiBase, companyID, processID, edge.resource_operational_relationship_id))}>×</button>}</span>)}</div>}
      <div className="process-work__step-nodes">{renderNodes(nodes, id)}{nodes.length === 0 && <p className="process-work__empty-lane">{step ? "No active work" : "Active work without a step appears here."}</p>}</div>
    </section>;
  };
  if (!processID) return <div className="process-work process-work__empty">Open a Process to see its steps and work.</div>;
  return <div ref={rootRef} className={`process-work${isDark ? " process-work--dark" : ""}`} aria-label="Process work" style={{ "--process-accent": accent } as React.CSSProperties}>
    <div className="process-work__toolbar"><strong>{snapshot?.logic_gate.header || forcedLogicGateLabel || "Process"}</strong>{onCollapseArenaToTab && <button type="button" title="Minimize Process" onClick={onCollapseArenaToTab}>−</button>}</div>
    <div className="process-work__controls">
      <div className="process-work__views" role="tablist" aria-label="Process work views">{PROCESS_WORK_VIEWS.map((tab) => <button key={tab} id={`${frameID}-${tab}`} type="button" role="tab" aria-selected={view === tab} aria-controls={`${frameID}-work-panel`} className={view === tab ? "is-active" : ""} style={{ "--view-color": tab === "Steps" ? accent : processStatusColor(tab === "Backlog" ? "Backlogs" : tab) } as React.CSSProperties} onClick={() => { setView(tab); setSelected(new Set()); }}><span>{tab}</span><span className="process-work__count">{counts[tab]}</span></button>)}</div>
      <KanbanGroupingControls controlsRef={groupRef} open={groupOpen} groupings={groupings} loading={!groupsLoaded} saving={groupSaving} error="" isDark={isDark} line={isDark ? "#3b4659" : "#dbe1e8"} cardBackground={isDark ? "#252e3d" : "#f8fafc"} text={isDark ? "#e4eaf3" : "#172033"} subtext={isDark ? "#a5b3c9" : "#64748b"} accent={accent} dateAddedSortEnabled={dateSort} dateAddedSortDirection={dateDirection} onToggleOpen={() => setGroupOpen(!groupOpen)} onAddGrouping={(field) => setGroupings([...groupings, { field, direction: "asc" }])} onUpdateGrouping={(index, grouping) => setGroupings(groupings.map((item, i) => i === index ? grouping : item))} onRemoveGrouping={(index) => setGroupings(groupings.filter((_, i) => i !== index))} onToggleDateAddedSortEnabled={() => setDateSort(!dateSort)} onToggleDateAddedSortDirection={() => setDateDirection(dateDirection === "asc" ? "desc" : "asc")} />
    </div>
    {selected.size > 0 && canEdit && <div className="process-work__selection"><span>{selected.size} selected</span>
      <select aria-label="Set selected Nodes status" value="" disabled={busy} onChange={(event) => { const status = event.target.value; if (!status) return; if (status === "In Progress") startWork((snapshot?.nodes ?? []).filter((node) => selected.has(node.node_id))); else void changeNodes(selectedIDs, { status }); }}><option value="">Set status…</option>{PROCESS_STATUSES.map((status) => <option key={status} value={status}>{status === "Backlogs" ? "Backlog" : status}</option>)}</select>
      <select aria-label="Assign selected Nodes to step" value="" disabled={busy} onChange={(event) => { if (event.target.value) void changeNodes(selectedIDs, { process_step_id: event.target.value === "none" ? null : event.target.value }); }}><option value="">Assign step…</option><option value="none">No step assigned</option>{steps.map((step) => <option key={step.process_step_id} value={step.process_step_id}>{step.name}</option>)}</select>
      <button type="button" disabled={busy} onClick={() => setDeletion({ nodeIDs: selectedIDs })}>Delete Nodes</button><button type="button" onClick={() => setSelected(new Set())}>Clear</button>
    </div>}
    {error && <div role="alert" className="process-work__error">{error}<button type="button" onClick={() => { setError(""); refreshRef.current(); }}>Retry</button></div>}
    {loading && <p role="status">Loading Process work…</p>}
    <div id={`${frameID}-work-panel`} role="tabpanel" aria-labelledby={`${frameID}-${view}`} className="process-work__panel">
      {view === "Steps" ? <div className="process-work__steps">{steps.map(renderStep)}{renderStep(null, steps.length)}{canEdit && <button type="button" className="process-work__add-step" disabled={busy} onClick={() => setDialog({ kind: "step", name: "", stepID: "", afterID: steps[steps.length - 1]?.process_step_id, nodeIDs: [] })}>+ Add {steps.length ? "next " : ""}step</button>}</div> :
        <section className="process-work__list" onDragOver={allowDrop} onDrop={(event) => drop(event, null)}><header><h3>{view}</h3>{canEdit && <button type="button" className="process-work__icon-button" aria-label={`New Node in ${view}`} title="New Node" disabled={busy} onClick={() => newNode(null)}>+</button>}</header>{visible.length ? renderNodes(visible, null) : <p className="process-work__empty-lane">No {view.toLowerCase()} work.</p>}</section>}
    </div>
    {dialog && <AppModalPortal onRequestClose={busy ? undefined : () => setDialog(null)}><div className="process-work__modal-backdrop"><form className={`process-work__dialog${isDark ? " process-work--dark" : ""}`} role="dialog" aria-modal="true" aria-label={dialog.kind === "start" ? "Start work" : dialog.kind === "step" ? "Process step" : "Node"} onSubmit={(event) => { event.preventDefault(); submitDialog(); }}>
      <h3>{dialog.kind === "start" ? "Start work" : dialog.kind === "step" ? dialog.stepID ? "Rename step" : "Add step" : "New Node"}</h3>
      {dialog.kind === "start" ? <label>Choose a step<select autoFocus value={dialog.stepID} onChange={(event) => setDialog({ ...dialog, stepID: event.target.value })}><option value="" disabled>Choose a step</option>{steps.map((step) => <option key={step.process_step_id} value={step.process_step_id}>{step.name}</option>)}</select></label> : <label>Name<input autoFocus required maxLength={dialog.kind === "step" ? 200 : 240} value={dialog.name} onChange={(event) => setDialog({ ...dialog, name: event.target.value })} /></label>}
      {dialog.kind === "start" && <p>The selected work will become In Progress in this step.</p>}
      <div><button type="button" disabled={busy} onClick={() => setDialog(null)}>Cancel</button><button type="submit" disabled={busy || (dialog.kind === "start" ? !dialog.stepID : !dialog.name.trim())}>{busy ? "Saving…" : dialog.kind === "start" ? "Start work" : "Save"}</button></div>
    </form></div></AppModalPortal>}
    {deletion && <ConfirmActionMenu title={deletion.step ? `Delete column “${deletion.step.name}”?` : `Delete ${deletion.nodeIDs?.length === 1 ? "this Node" : "these Nodes"}?`} detail={deletion.step ? "Its Nodes keep their Process and status. Active Nodes move to No step assigned." : "The Nodes move to the Recycle Bin."} requireDisplayNameConfirmation={!deletion.step} confirmDisabled={busy} onCancel={() => setDeletion(null)} onConfirm={(confirmationDisplayName) => {
      const pending = deletion;
      void mutate(async () => {
        if (pending.step) await deleteProcessStep(apiBase, companyID, processID, pending.step.process_step_id);
        else {
          await requestJSON(apiBase, "/v1/company-explorer/delete-targets", { method: "POST", json: { company_id: companyID, targets: pending.nodeIDs!.map((id) => ({ kind: "node", id })), confirmation_display_name: confirmationDisplayName } });
          for (const id of pending.nodeIDs!) { removeNodeRelationshipGraphNode(apiBase, companyID, id); invalidateNodeRecordStoreCaches(apiBase, companyID, id); }
          if (pending.nodeIDs!.includes(overlay?.nodeID ?? "")) closeOverlay();
        }
        setDeletion(null); setSelected(new Set()); dispatchLogicGateWorkUpdated(companyID, processID);
      });
    }} />}
    {overlay && <KanbanNodeEditorOverlay overlay={overlay} ratio={ratio ?? DEFAULT_NODE_EDITOR_OVERLAY_RATIO} boardRootRef={rootRef} resizeRef={resizeRef} frameID={frameID} accent={accent} theme={theme} fullscreen={fullscreen} onToggleFullscreen={() => setFullscreen(!fullscreen)} onResizeStart={() => setFullscreen(false)} onLinkedLeftResizeStart={onNodeEditorOverlayLeftResizeStart} onClose={closeOverlay} onCollapseToTab={() => { requestAppDockTab({ kind: "node", entityID: overlay.nodeID, label: overlay.nodeTitle }); closeOverlay(); }} onOpenInNewTab={() => openAppPathInNewTab(buildLogicGateRoute(processID, overlay.nodeID))} onRequestDelete={(nodeID) => setDeletion({ nodeIDs: [nodeID] })} />}
  </div>;
};
