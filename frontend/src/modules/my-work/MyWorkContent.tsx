import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultRangeExtractor, useVirtualizer, type Range } from "@tanstack/react-virtual";
import {
  ActionItemIcon,
  ExplorerEntityIcon,
  HeaderMyWorkIcon,
  StaggeredGroupingIcon,
} from "../../icons/index.js";
import type { BoundRequestJSON } from "../api/requestJSON.js";
import {
  editorEntityLinkAnchorBounds,
  EVENT_EDITOR_ENTITY_REFERENCE_PRESENTATION,
  openEditorEntityLink,
  type EditorEntityReferencePresentation,
  type EditorEntityLinkAnchorBounds,
} from "../editor/editorEntityLinks.js";
import { EditorCalendarDateInput } from "../editor/EditorFieldControls.js";
import { formatNodeDueDateForEditor, normalizeNodeDueDateDraft } from "../editor/editorDates.js";
import { updateEntityField } from "../entities/entitiesApi.js";
import { UniversalGroupingControls } from "../grouping/UniversalGroupingControls.js";
import {
  buildUniversalNestedGroups,
} from "../grouping/universalGrouping.js";
import { logicGateRACIRolePresentation } from "../logic-gates/raciPresentation.js";
import { homeRACIRoleAccent } from "../../pages/home/homeStyles.js";
import type {
  MyWorkActionItem,
  MyWorkNode,
  MyWorkProcess,
  MyWorkProcessRole,
  MyWorkProject,
  MyWorkSection,
} from "./myWorkApi.js";
import {
  DEFAULT_MY_WORK_ACTION_ITEM_GROUPINGS,
  DEFAULT_MY_WORK_NODE_GROUPINGS,
  MY_WORK_ACTION_ITEM_GROUPING_FIELDS,
  MY_WORK_NODE_GROUPING_FIELDS,
  myWorkActionItemGroupingAdapter,
  myWorkNodeGroupingAdapter,
  normalizeMyWorkActionItemGroupings,
  normalizeMyWorkNodeGroupings,
  type MyWorkActionItemGrouping,
  type MyWorkNodeGrouping,
} from "./myWorkGrouping.js";
import {
  findAdjacentMyWorkRowEntryIndex,
  findMyWorkDisplayEntryIndex,
  flattenMyWorkGroupedDisplayEntries,
  flattenMyWorkUngroupedDisplayEntries,
  type MyWorkDisplayEntry,
} from "./myWorkWindowing.js";
import { useMyWorkData, type MyWorkSectionState } from "./useMyWorkData.js";

export type MyWorkContentProps = {
  companyID: string;
  subjectID: string;
  requestJSON: BoundRequestJSON;
};

const PROCESS_ROLE_OPTIONS: ReadonlyArray<{ role: MyWorkProcessRole; letter: string; label: string }> = [
  { role: "responsible", letter: "R", label: "Responsible" },
  { role: "accountable", letter: "A", label: "Accountable" },
  { role: "consulted", letter: "C", label: "Consulted" },
  { role: "informed", letter: "I", label: "Informed" },
];

type MyWorkColumnWeights = [number, number, number];
type MyWorkLayout = {
  columnWeights: MyWorkColumnWeights;
  actionItemsRatio: number;
};
type MyWorkResizeA11y = {
  minimum: number;
  maximum: number;
  current: number;
};

const MY_WORK_RESIZER_SIZE = 10;
const MY_WORK_LOAD_MORE_THRESHOLD = 160;
const MY_WORK_COLUMN_MIN_WIDTHS: MyWorkColumnWeights = [300, 240, 240];
const MY_WORK_SECTION_MIN_HEIGHT = 140;
const MY_WORK_WINDOW_THRESHOLD = 120;
const MY_WORK_WINDOW_OVERSCAN = 8;
const DEFAULT_MY_WORK_LAYOUT: MyWorkLayout = {
  columnWeights: normalizedColumnWeights([1.25, 0.9, 0.9]),
  actionItemsRatio: 0.5,
};

export function MyWorkContent({ companyID, subjectID, requestJSON }: MyWorkContentProps) {
  const {
    state,
    processRole,
    reloadSection,
    loadMore,
    selectProcessRole,
  } = useMyWorkData(companyID, subjectID, requestJSON);
  const [layout, setLayout] = useState<MyWorkLayout>(() => readMyWorkLayout(companyID));
  const [paneMeasurements, setPaneMeasurements] = useState({ columnAvailableWidth: 0, leftAvailableHeight: 0 });
  const layoutRef = useRef(layout);
  const columnsRef = useRef<HTMLDivElement>(null);
  const leftColumnRef = useRef<HTMLDivElement>(null);
  const actionItemsScrollRef = useRef<HTMLDivElement>(null);
  const nodesScrollRef = useRef<HTMLDivElement>(null);
  const processesScrollRef = useRef<HTMLDivElement>(null);
  const projectsScrollRef = useRef<HTMLDivElement>(null);
  const [actionItemGroupings, setActionItemGroupings] = useState<MyWorkActionItemGrouping[]>(() => (
    DEFAULT_MY_WORK_ACTION_ITEM_GROUPINGS.map((grouping) => ({ ...grouping }))
  ));
  const [nodeGroupings, setNodeGroupings] = useState<MyWorkNodeGrouping[]>(() => (
    DEFAULT_MY_WORK_NODE_GROUPINGS.map((grouping) => ({ ...grouping }))
  ));
  const [actionItemHistory, setActionItemHistory] = useState(false);
  const [nodeHistory, setNodeHistory] = useState(false);

  useEffect(() => {
    setActionItemGroupings(DEFAULT_MY_WORK_ACTION_ITEM_GROUPINGS.map((grouping) => ({ ...grouping })));
    setNodeGroupings(DEFAULT_MY_WORK_NODE_GROUPINGS.map((grouping) => ({ ...grouping })));
    setActionItemHistory(false);
    setNodeHistory(false);
  }, [companyID, subjectID]);

  useEffect(() => {
    const nextLayout = readMyWorkLayout(companyID);
    layoutRef.current = nextLayout;
    setLayout(nextLayout);
  }, [companyID]);

  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  useEffect(() => {
    const measure = () => {
      const columnContainer = columnsRef.current;
      const leftColumn = leftColumnRef.current;
      const next = {
        columnAvailableWidth: columnContainer
          ? Math.max(0, Math.max(columnContainer.clientWidth, columnContainer.scrollWidth) - (MY_WORK_RESIZER_SIZE * 2))
          : 0,
        leftAvailableHeight: leftColumn ? Math.max(0, leftColumn.clientHeight - MY_WORK_RESIZER_SIZE) : 0,
      };
      setPaneMeasurements((current) => (
        current.columnAvailableWidth === next.columnAvailableWidth && current.leftAvailableHeight === next.leftAvailableHeight
          ? current
          : next
      ));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (columnsRef.current) observer?.observe(columnsRef.current);
    if (leftColumnRef.current) observer?.observe(leftColumnRef.current);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const actionItemGroups = useMemo(() => buildUniversalNestedGroups(
    state.action_items.items,
    actionItemGroupings,
    myWorkActionItemGroupingAdapter,
  ), [actionItemGroupings, state.action_items.items]);
  const nodeGroups = useMemo(() => buildUniversalNestedGroups(
    state.nodes.items,
    nodeGroupings,
    myWorkNodeGroupingAdapter,
  ), [nodeGroupings, state.nodes.items]);
  const actionItemEntries = useMemo(() => !actionItemHistory && actionItemGroupings.length > 0
    ? flattenMyWorkGroupedDisplayEntries(actionItemGroups, (item) => item.entity_id, new Set(["completion_due_date"] as const))
    : flattenMyWorkUngroupedDisplayEntries(state.action_items.items, (item) => item.entity_id), [
    actionItemGroups,
    actionItemGroupings.length,
    actionItemHistory,
    state.action_items.items,
  ]);
  const nodeEntries = useMemo(() => !nodeHistory && nodeGroupings.length > 0
    ? flattenMyWorkGroupedDisplayEntries(nodeGroups, (item) => item.node_id, new Set(["due_date"] as const))
    : flattenMyWorkUngroupedDisplayEntries(state.nodes.items, (item) => item.node_id), [
    nodeGroups,
    nodeGroupings.length,
    nodeHistory,
    state.nodes.items,
  ]);
  const processEntries = useMemo(() => flattenMyWorkUngroupedDisplayEntries(
    state.processes.items,
    (process) => process.logic_gate_id,
  ), [state.processes.items]);
  const projectEntries = useMemo(() => flattenMyWorkUngroupedDisplayEntries(
    state.projects.items,
    (project) => project.project_id,
  ), [state.projects.items]);
  const saveActionItemDueDate = useCallback(async (item: MyWorkActionItem, dueDate: string | null) => {
    if (!item.completion_due_date_field_id.trim()) throw new Error("Completion due date is unavailable.");
    await updateEntityField({
      companyID,
      entityID: item.entity_id,
      entityFieldID: item.completion_due_date_field_id,
      value: dueDate,
    }, requestJSON);
    await reloadSection("action_items", actionItemHistory ? undefined : actionItemGroupings, false, actionItemHistory);
  }, [actionItemGroupings, actionItemHistory, companyID, reloadSection, requestJSON]);
  const saveNodeDueDate = useCallback(async (item: MyWorkNode, dueDate: string | null) => {
    await requestJSON(`/v1/nodes/${encodeURIComponent(item.node_id)}`, {
      method: "PUT",
      json: { company_id: companyID, due_date: dueDate },
    });
    await reloadSection("nodes", nodeHistory ? undefined : nodeGroupings, false, nodeHistory);
  }, [companyID, nodeGroupings, nodeHistory, reloadSection, requestJSON]);
  const renderActionItemRow = useCallback((item: MyWorkActionItem) => (
    <ActionItemRow item={item} onSaveDueDate={(dueDate) => saveActionItemDueDate(item, dueDate)} />
  ), [saveActionItemDueDate]);
  const renderNodeRow = useCallback((item: MyWorkNode) => (
    <NodeRow item={item} onSaveDueDate={(dueDate) => saveNodeDueDate(item, dueDate)} />
  ), [saveNodeDueDate]);
  const renderProcessRow = useCallback((process: MyWorkProcess) => <ProcessRow process={process} />, []);
  const renderProjectRow = useCallback((project: MyWorkProject) => <ProjectRow project={project} />, []);

  useEffect(() => {
    const refreshActionItems = (event: Event) => {
      const detail = (event as CustomEvent<EditorEntityReferencePresentation>).detail;
      if (!detail?.isActionItem) return;
      void reloadSection("action_items", actionItemHistory ? undefined : actionItemGroupings, false, actionItemHistory);
    };
    window.addEventListener(EVENT_EDITOR_ENTITY_REFERENCE_PRESENTATION, refreshActionItems);
    return () => window.removeEventListener(EVENT_EDITOR_ENTITY_REFERENCE_PRESENTATION, refreshActionItems);
  }, [actionItemGroupings, actionItemHistory, reloadSection]);

  const changeActionItemGroupings = (next: MyWorkActionItemGrouping[]) => {
    const normalized = normalizeMyWorkActionItemGroupings(next);
    setActionItemGroupings(normalized);
    void reloadSection("action_items", normalized, true);
  };
  const changeNodeGroupings = (next: MyWorkNodeGrouping[]) => {
    const normalized = normalizeMyWorkNodeGroupings(next);
    setNodeGroupings(normalized);
    void reloadSection("nodes", normalized, true);
  };
  const toggleActionItemHistory = () => {
    const next = !actionItemHistory;
    setActionItemHistory(next);
    if (actionItemsScrollRef.current) actionItemsScrollRef.current.scrollTop = 0;
    void reloadSection("action_items", next ? undefined : actionItemGroupings, true, next);
  };
  const toggleNodeHistory = () => {
    const next = !nodeHistory;
    setNodeHistory(next);
    if (nodesScrollRef.current) nodesScrollRef.current.scrollTop = 0;
    void reloadSection("nodes", next ? undefined : nodeGroupings, true, next);
  };

  const resizeColumnPair = (dividerIndex: 0 | 1, delta: number): number | undefined => {
    const containerWidth = Math.max(columnsRef.current?.clientWidth ?? 0, columnsRef.current?.scrollWidth ?? 0);
    const availableWidth = Math.max(0, containerWidth - (MY_WORK_RESIZER_SIZE * 2));
    if (availableWidth <= 0) return undefined;
    const current = layoutRef.current;
    const next = {
      ...current,
      columnWeights: resizedColumnWeights(current.columnWeights, dividerIndex, delta, availableWidth),
    };
    layoutRef.current = next;
    if (columnsRef.current) columnsRef.current.style.gridTemplateColumns = columnGridTemplate(next.columnWeights);
    return columnResizeA11y(next.columnWeights, dividerIndex, availableWidth).current;
  };
  const resizeLeftSections = (delta: number): number | undefined => {
    const availableHeight = Math.max(0, (leftColumnRef.current?.clientHeight ?? 0) - MY_WORK_RESIZER_SIZE);
    if (availableHeight <= 0) return undefined;
    const current = layoutRef.current;
    const next = {
      ...current,
      actionItemsRatio: resizedSplitRatio(current.actionItemsRatio, delta, availableHeight),
    };
    layoutRef.current = next;
    if (leftColumnRef.current) leftColumnRef.current.style.gridTemplateRows = leftColumnGridTemplate(next.actionItemsRatio);
    return splitResizeA11y(next.actionItemsRatio, availableHeight).current;
  };
  const saveLayout = () => {
    setLayout(layoutRef.current);
    writeMyWorkLayout(companyID, layoutRef.current);
  };
  const actionItemsResizeA11y = splitResizeA11y(layout.actionItemsRatio, paneMeasurements.leftAvailableHeight);
  const firstColumnResizeA11y = columnResizeA11y(layout.columnWeights, 0, paneMeasurements.columnAvailableWidth);
  const secondColumnResizeA11y = columnResizeA11y(layout.columnWeights, 1, paneMeasurements.columnAvailableWidth);

  return (
    <div data-my-work-page="true" style={pageStyle}>
      <header style={pageHeaderStyle}>
        <span style={pageHeaderIconStyle}><HeaderMyWorkIcon color="#2563eb" /></span>
        <h1 style={pageTitleStyle}>My Work</h1>
      </header>

      <div ref={columnsRef} data-my-work-columns="true" style={columnsStyle(layout.columnWeights)}>
        <div ref={leftColumnRef} data-my-work-left-column="true" style={leftColumnStyle(layout.actionItemsRatio)}>
          <SectionFrame
            section="action_items"
            title="Action Items"
            icon={<ActionItemIcon size={16} />}
            state={state.action_items}
            actions={(
              <div style={sectionActionsStyle}>
                <HistoryButton selected={actionItemHistory} disabled={state.action_items.loading} onClick={toggleActionItemHistory} />
                <UniversalGroupingControls
                  groupings={actionItemGroupings}
                  fieldOptions={MY_WORK_ACTION_ITEM_GROUPING_FIELDS}
                  onChange={changeActionItemGroupings}
                  buttonLabel="Group Action Items"
                  popoverLabel="Action Item grouping"
                  popoverAlign="end"
                  triggerIcon={<StaggeredGroupingIcon />}
                  iconOnly
                  disabled={state.action_items.loading || actionItemHistory}
                />
              </div>
            )}
            onRetry={() => void (state.action_items.items.length > 0
              ? loadMore("action_items", actionItemHistory ? undefined : actionItemGroupings, actionItemHistory)
              : reloadSection("action_items", actionItemHistory ? undefined : actionItemGroupings, false, actionItemHistory))}
            onLoadMore={() => void loadMore("action_items", actionItemHistory ? undefined : actionItemGroupings, actionItemHistory)}
            scrollBodyRef={actionItemsScrollRef}
          >
            <MyWorkWindowedRows
              section="action_items"
              entries={actionItemEntries}
              scrollBodyRef={actionItemsScrollRef}
              rowEstimate={52}
              emptyLabel={actionItemHistory ? "No completed Action Items." : "No Action Items assigned to you."}
              renderRow={renderActionItemRow}
            />
          </SectionFrame>

          <MyWorkResizeHandle
            orientation="horizontal"
            label="Resize Action Items and Nodes"
            controls="my-work-action-items-section my-work-nodes-section"
            valueMin={actionItemsResizeA11y.minimum}
            valueMax={actionItemsResizeA11y.maximum}
            valueNow={actionItemsResizeA11y.current}
            onDelta={resizeLeftSections}
            onCommit={saveLayout}
          />

          <SectionFrame
            section="nodes"
            title="Nodes"
            icon={<ExplorerEntityIcon kind="node" />}
            state={state.nodes}
            actions={(
              <div style={sectionActionsStyle}>
                <HistoryButton selected={nodeHistory} disabled={state.nodes.loading} onClick={toggleNodeHistory} />
                <UniversalGroupingControls
                  groupings={nodeGroupings}
                  fieldOptions={MY_WORK_NODE_GROUPING_FIELDS}
                  onChange={changeNodeGroupings}
                  buttonLabel="Group Nodes"
                  popoverLabel="Node grouping"
                  popoverAlign="end"
                  triggerIcon={<StaggeredGroupingIcon />}
                  iconOnly
                  disabled={state.nodes.loading || nodeHistory}
                />
              </div>
            )}
            onRetry={() => void (state.nodes.items.length > 0
              ? loadMore("nodes", nodeHistory ? undefined : nodeGroupings, nodeHistory)
              : reloadSection("nodes", nodeHistory ? undefined : nodeGroupings, false, nodeHistory))}
            onLoadMore={() => void loadMore("nodes", nodeHistory ? undefined : nodeGroupings, nodeHistory)}
            scrollBodyRef={nodesScrollRef}
          >
            <MyWorkWindowedRows
              section="nodes"
              entries={nodeEntries}
              scrollBodyRef={nodesScrollRef}
              rowEstimate={50}
              emptyLabel={nodeHistory ? "No completed Nodes." : "No responsible Nodes."}
              renderRow={renderNodeRow}
            />
          </SectionFrame>
        </div>

        <MyWorkResizeHandle
          orientation="vertical"
          label="Resize Action Items and Nodes column and Processes column"
          controls="my-work-action-items-section my-work-nodes-section my-work-processes-section"
          valueMin={firstColumnResizeA11y.minimum}
          valueMax={firstColumnResizeA11y.maximum}
          valueNow={firstColumnResizeA11y.current}
          onDelta={(delta) => resizeColumnPair(0, delta)}
          onCommit={saveLayout}
        />

        <SectionFrame
          section="processes"
          title="Processes"
          icon={<ExplorerEntityIcon kind="logic_gate" />}
          state={state.processes}
          actions={(
            <div role="radiogroup" aria-label="Process RACI role" style={roleSelectorStyle}>
              {PROCESS_ROLE_OPTIONS.map((option, index) => (
                <button
                  key={option.role}
                  type="button"
                  role="radio"
                  aria-checked={processRole === option.role}
                  aria-label={option.label}
                  title={option.label}
                  tabIndex={processRole === option.role ? 0 : -1}
                  style={roleButtonStyle(processRole === option.role, logicGateRACIRolePresentation(option.role).accent)}
                  onClick={() => void selectProcessRole(option.role)}
                  onKeyDown={(event) => {
                    const nextIndex = processRoleIndexForKey(event.key, index);
                    if (nextIndex === null) return;
                    event.preventDefault();
                    const nextOption = PROCESS_ROLE_OPTIONS[nextIndex];
                    event.currentTarget.parentElement
                      ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextIndex]
                      ?.focus();
                    void selectProcessRole(nextOption.role);
                  }}
                >
                  {option.letter}
                </button>
              ))}
            </div>
          )}
          onRetry={() => void (state.processes.items.length > 0 ? loadMore("processes") : reloadSection("processes"))}
          onLoadMore={() => void loadMore("processes")}
          scrollBodyRef={processesScrollRef}
        >
          <MyWorkWindowedRows
            section="processes"
            entries={processEntries}
            scrollBodyRef={processesScrollRef}
            rowEstimate={47}
            emptyLabel={`No ${PROCESS_ROLE_OPTIONS.find((option) => option.role === processRole)?.label ?? "matching"} Processes.`}
            renderRow={renderProcessRow}
          />
        </SectionFrame>

        <MyWorkResizeHandle
          orientation="vertical"
          label="Resize Processes and Projects columns"
          controls="my-work-processes-section my-work-projects-section"
          valueMin={secondColumnResizeA11y.minimum}
          valueMax={secondColumnResizeA11y.maximum}
          valueNow={secondColumnResizeA11y.current}
          onDelta={(delta) => resizeColumnPair(1, delta)}
          onCommit={saveLayout}
        />

        <SectionFrame
          section="projects"
          title="Projects"
          icon={<ExplorerEntityIcon kind="project" />}
          state={state.projects}
          onRetry={() => void (state.projects.items.length > 0 ? loadMore("projects") : reloadSection("projects"))}
          onLoadMore={() => void loadMore("projects")}
          scrollBodyRef={projectsScrollRef}
        >
          <MyWorkWindowedRows
            section="projects"
            entries={projectEntries}
            scrollBodyRef={projectsScrollRef}
            rowEstimate={47}
            emptyLabel="No visible Projects assigned to your Project Teams."
            renderRow={renderProjectRow}
          />
        </SectionFrame>
      </div>
    </div>
  );
}

export function processRoleIndexForKey(key: string, currentIndex: number): number | null {
  if (key === "Home") return 0;
  if (key === "End") return PROCESS_ROLE_OPTIONS.length - 1;
  if (key === "ArrowRight" || key === "ArrowDown") return (currentIndex + 1) % PROCESS_ROLE_OPTIONS.length;
  if (key === "ArrowLeft" || key === "ArrowUp") return (currentIndex - 1 + PROCESS_ROLE_OPTIONS.length) % PROCESS_ROLE_OPTIONS.length;
  return null;
}

export function resizedColumnWeights(
  weights: MyWorkColumnWeights,
  dividerIndex: 0 | 1,
  delta: number,
  availableWidth: number,
): MyWorkColumnWeights {
  if (!Number.isFinite(delta) || !Number.isFinite(availableWidth) || availableWidth <= 0) return weights;
  const normalized = normalizedColumnWeights(weights);
  const widths = normalized.map((weight) => weight * availableWidth) as MyWorkColumnWeights;
  const leftIndex = dividerIndex;
  const rightIndex = dividerIndex + 1;
  const pairWidth = widths[leftIndex] + widths[rightIndex];
  const leftMinimum = Math.min(MY_WORK_COLUMN_MIN_WIDTHS[leftIndex], pairWidth * 0.45);
  const rightMinimum = Math.min(MY_WORK_COLUMN_MIN_WIDTHS[rightIndex], pairWidth * 0.45);
  const nextLeft = clamp(widths[leftIndex] + delta, leftMinimum, pairWidth - rightMinimum);
  widths[leftIndex] = nextLeft;
  widths[rightIndex] = pairWidth - nextLeft;
  return normalizedColumnWeights(widths);
}

export function resizedSplitRatio(currentRatio: number, delta: number, availableHeight: number): number {
  if (!Number.isFinite(delta) || !Number.isFinite(availableHeight) || availableHeight <= 0) return currentRatio;
  const minimumRatio = Math.min(0.45, MY_WORK_SECTION_MIN_HEIGHT / availableHeight);
  return clamp(currentRatio + (delta / availableHeight), minimumRatio, 1 - minimumRatio);
}

export function scrollRemaining(element: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">): number {
  return element.scrollHeight - element.scrollTop - element.clientHeight;
}

export function columnResizeA11y(
  weights: MyWorkColumnWeights,
  dividerIndex: 0 | 1,
  availableWidth: number,
): MyWorkResizeA11y {
  const normalized = normalizedColumnWeights(weights);
  const pairWeight = normalized[dividerIndex] + normalized[dividerIndex + 1];
  const current = Math.round((normalized[dividerIndex] / pairWeight) * 100);
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return { minimum: 0, maximum: 100, current };
  const pairWidth = pairWeight * availableWidth;
  const leftMinimum = Math.min(MY_WORK_COLUMN_MIN_WIDTHS[dividerIndex], pairWidth * 0.45);
  const rightMinimum = Math.min(MY_WORK_COLUMN_MIN_WIDTHS[dividerIndex + 1], pairWidth * 0.45);
  const minimum = Math.round((leftMinimum / pairWidth) * 100);
  const maximum = Math.round(((pairWidth - rightMinimum) / pairWidth) * 100);
  return {
    minimum,
    maximum,
    current: clamp(current, minimum, maximum),
  };
}

export function splitResizeA11y(currentRatio: number, availableHeight: number): MyWorkResizeA11y {
  const minimumRatio = Number.isFinite(availableHeight) && availableHeight > 0
    ? Math.min(0.45, MY_WORK_SECTION_MIN_HEIGHT / availableHeight)
    : 0;
  const minimum = Math.round(minimumRatio * 100);
  const maximum = Math.round((1 - minimumRatio) * 100);
  return { minimum, maximum, current: clamp(Math.round(currentRatio * 100), minimum, maximum) };
}

function normalizedColumnWeights(value: unknown): MyWorkColumnWeights {
  if (!Array.isArray(value) || value.length !== 3) return [1.25 / 3.05, 0.9 / 3.05, 0.9 / 3.05];
  const weights = value.map((candidate) => Number(candidate));
  if (weights.some((candidate) => !Number.isFinite(candidate) || candidate <= 0)) return [1.25 / 3.05, 0.9 / 3.05, 0.9 / 3.05];
  const total = weights.reduce((sum, candidate) => sum + candidate, 0);
  return [weights[0] / total, weights[1] / total, weights[2] / total];
}

function readMyWorkLayout(companyID: string): MyWorkLayout {
  if (typeof window === "undefined") return DEFAULT_MY_WORK_LAYOUT;
  try {
    const stored = window.localStorage.getItem(myWorkLayoutStorageKey(companyID));
    if (!stored) return DEFAULT_MY_WORK_LAYOUT;
    const parsed = JSON.parse(stored) as Partial<MyWorkLayout>;
    const actionItemsRatio = Number(parsed.actionItemsRatio);
    return {
      columnWeights: normalizedColumnWeights(parsed.columnWeights),
      actionItemsRatio: Number.isFinite(actionItemsRatio) ? clamp(actionItemsRatio, 0.15, 0.85) : DEFAULT_MY_WORK_LAYOUT.actionItemsRatio,
    };
  } catch {
    return DEFAULT_MY_WORK_LAYOUT;
  }
}

function writeMyWorkLayout(companyID: string, layout: MyWorkLayout): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(myWorkLayoutStorageKey(companyID), JSON.stringify(layout));
  } catch {
    // Layout persistence is optional; resizing remains available for this session.
  }
}

function myWorkLayoutStorageKey(companyID: string): string {
  return `mangorts.my-work.layout.v1:${companyID.trim()}`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function MyWorkResizeHandle({
  orientation,
  label,
  controls,
  valueMin,
  valueMax,
  valueNow,
  onDelta,
  onCommit,
}: {
  orientation: "horizontal" | "vertical";
  label: string;
  controls?: string;
  valueMin: number;
  valueMax: number;
  valueNow: number;
  onDelta: (delta: number) => number | undefined;
  onCommit: () => void;
}) {
  const positionRef = useRef<number | null>(null);
  const coordinate = (event: React.PointerEvent<HTMLButtonElement>) => orientation === "vertical" ? event.clientX : event.clientY;
  const finish = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (positionRef.current === null) return;
    positionRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId);
    onCommit();
  };
  return (
    <button
      type="button"
      role="separator"
      className="my-work-resizer"
      data-my-work-resizer={orientation}
      aria-label={label}
      aria-controls={controls}
      aria-orientation={orientation}
      aria-valuemin={valueMin}
      aria-valuemax={valueMax}
      aria-valuenow={valueNow}
      aria-valuetext={`${valueNow}%`}
      style={resizeHandleStyle(orientation)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        positionRef.current = coordinate(event);
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const previous = positionRef.current;
        if (previous === null) return;
        event.preventDefault();
        const next = coordinate(event);
        const nextValue = onDelta(next - previous);
        if (nextValue !== undefined) {
          event.currentTarget.setAttribute("aria-valuenow", String(nextValue));
          event.currentTarget.setAttribute("aria-valuetext", `${nextValue}%`);
        }
        positionRef.current = next;
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={(event) => {
        if (positionRef.current === null) return;
        positionRef.current = null;
        onCommit();
        event.currentTarget.blur();
      }}
      onKeyDown={(event) => {
        const delta = orientation === "vertical"
          ? event.key === "ArrowLeft" ? -24 : event.key === "ArrowRight" ? 24 : 0
          : event.key === "ArrowUp" ? -24 : event.key === "ArrowDown" ? 24 : 0;
        if (delta === 0) return;
        event.preventDefault();
        const nextValue = onDelta(delta);
        if (nextValue !== undefined) {
          event.currentTarget.setAttribute("aria-valuenow", String(nextValue));
          event.currentTarget.setAttribute("aria-valuetext", `${nextValue}%`);
        }
        onCommit();
      }}
    >
      <span className="my-work-resizer__grip" aria-hidden="true" style={resizeGripStyle(orientation)} />
    </button>
  );
}

type SectionFrameProps<Item> = {
  section: MyWorkSection;
  title: string;
  icon: React.ReactNode;
  state: MyWorkSectionState<Item>;
  actions?: React.ReactNode;
  onRetry: () => void;
  onLoadMore: () => void;
  scrollBodyRef: React.RefObject<HTMLDivElement>;
  children: React.ReactNode;
};

function SectionFrame<Item>({
  section,
  title,
  icon,
  state,
  actions,
  onRetry,
  onLoadMore,
  scrollBodyRef,
  children,
}: SectionFrameProps<Item>) {
  const titleID = `my-work-${section}-title`;
  const sectionID = `my-work-${section.replace("_", "-")}-section`;

  useEffect(() => {
    const body = scrollBodyRef.current;
    if (!body || state.loading || state.error || !state.hasMore || !state.nextCursor) return undefined;
    const loadIfUnderfilled = () => {
      if (body.clientHeight <= 0) return;
      if (scrollRemaining(body) <= MY_WORK_LOAD_MORE_THRESHOLD) onLoadMore();
    };
    const frameID = typeof requestAnimationFrame === "undefined" ? null : requestAnimationFrame(loadIfUnderfilled);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(loadIfUnderfilled);
    observer?.observe(body);
    return () => {
      if (frameID !== null && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(frameID);
      observer?.disconnect();
    };
  }, [onLoadMore, state.error, state.hasMore, state.items.length, state.loading, state.nextCursor]);

  return (
    <section id={sectionID} aria-labelledby={titleID} aria-busy={state.loading} data-my-work-section={section} style={sectionStyle(Boolean(state.error))}>
      <header style={sectionHeaderStyle}>
        <h2 id={titleID} style={sectionTitleStyle}>
          <span data-my-work-section-icon={section} style={sectionTitleIconStyle}>{icon}</span>
          <span>{title}</span>
        </h2>
        {actions}
      </header>
      {state.error && (
        <div role="alert" style={errorStyle}>
          <span>{state.error}</span>
          <button type="button" style={smallButtonStyle} onClick={onRetry}>Retry</button>
        </div>
      )}
      <div
        ref={scrollBodyRef}
        data-my-work-scroll={section}
        style={sectionBodyStyle}
        onScroll={(event) => {
          if (state.loading || state.error || !state.hasMore || !state.nextCursor) return;
          if (scrollRemaining(event.currentTarget) <= MY_WORK_LOAD_MORE_THRESHOLD) onLoadMore();
        }}
      >
        {state.loading && state.items.length === 0 ? <LoadingRows /> : children}
        {state.loading && state.items.length > 0 && <div role="status" style={loadingMoreStyle}>Loading more…</div>}
        {!state.loading && state.hasMore && state.nextCursor && (
          <div
            tabIndex={0}
            role="status"
            aria-label={`More ${title} load automatically as you scroll`}
            style={loadMoreSentinelStyle}
            onFocus={onLoadMore}
          >
            Keep scrolling to load more
          </div>
        )}
      </div>
    </section>
  );
}

type MyWorkWindowedRowsProps<Item, Field extends string> = {
  section: MyWorkSection;
  entries: Array<MyWorkDisplayEntry<Item, Field>>;
  scrollBodyRef: React.RefObject<HTMLDivElement>;
  rowEstimate: number;
  emptyLabel: string;
  renderRow: (item: Item) => React.ReactNode;
};

function MyWorkWindowedRowsImpl<Item, Field extends string>({
  section,
  entries,
  scrollBodyRef,
  rowEstimate,
  emptyLabel,
  renderRow,
}: MyWorkWindowedRowsProps<Item, Field>) {
  const [focusedEntryID, setFocusedEntryID] = useState("");
  const focusedIndex = useMemo(
    () => focusedEntryID ? findMyWorkDisplayEntryIndex(entries, focusedEntryID) : -1,
    [entries, focusedEntryID],
  );
  const rangeExtractor = useCallback((range: Range) => {
    const indexes = new Set(defaultRangeExtractor(range));
    if (focusedIndex >= 0) {
      indexes.add(focusedIndex);
      const previous = findAdjacentMyWorkRowEntryIndex(entries, focusedIndex, "previous");
      const next = findAdjacentMyWorkRowEntryIndex(entries, focusedIndex, "next");
      if (previous !== null) indexes.add(previous);
      if (next !== null) indexes.add(next);
    }
    return [...indexes].sort((left, right) => left - right);
  }, [entries, focusedIndex]);
  const estimateSize = useCallback((index: number) => estimatedMyWorkEntrySize(entries[index], rowEstimate, index), [entries, rowEstimate]);
  const getItemKey = useCallback((index: number) => entries[index]?.entryID ?? index, [entries]);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: entries.length,
    enabled: entries.length > MY_WORK_WINDOW_THRESHOLD,
    estimateSize,
    getItemKey,
    getScrollElement: () => scrollBodyRef.current,
    initialRect: { width: 400, height: 600 },
    measureElement: measureMyWorkDisplayEntry,
    overscan: MY_WORK_WINDOW_OVERSCAN,
    rangeExtractor,
  });
  const onFocusCapture = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    const entryElement = (event.target as Element).closest<HTMLElement>("[data-my-work-entry-id]");
    if (entryElement?.dataset.myWorkEntryId) setFocusedEntryID(entryElement.dataset.myWorkEntryId);
  }, []);
  const onBlurCapture = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setFocusedEntryID("");
  }, []);

  if (entries.length === 0) return <EmptyState label={emptyLabel} />;
  if (entries.length <= MY_WORK_WINDOW_THRESHOLD) {
    return (
      <div data-my-work-windowed-list="false" onFocusCapture={onFocusCapture} onBlurCapture={onBlurCapture}>
        {entries.map((entry, index) => (
          <div
            key={entry.entryID}
            data-my-work-entry-id={entry.entryID}
            data-my-work-entry-kind={entry.kind}
            style={myWorkDisplayEntryStyle(entry, index)}
          >
            {renderMyWorkDisplayEntry(section, entry, renderRow)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      data-my-work-windowed-list="true"
      data-my-work-total-entries={entries.length}
      data-my-work-mounted-entries={virtualizer.getVirtualItems().length}
      onFocusCapture={onFocusCapture}
      onBlurCapture={onBlurCapture}
      style={{ height: virtualizer.getTotalSize(), minWidth: 0, position: "relative" }}
    >
      {virtualizer.getVirtualItems().map((virtualEntry) => {
        const entry = entries[virtualEntry.index];
        if (!entry) return null;
        const estimatedSize = estimatedMyWorkEntrySize(entry, rowEstimate, virtualEntry.index);
        return (
          <div
            key={virtualEntry.key}
            ref={virtualizer.measureElement}
            data-index={virtualEntry.index}
            data-my-work-entry-id={entry.entryID}
            data-my-work-entry-kind={entry.kind}
            data-my-work-estimated-size={estimatedSize}
            style={myWorkDisplayEntryStyle(entry, virtualEntry.index, virtualEntry.start)}
          >
            {renderMyWorkDisplayEntry(section, entry, renderRow)}
          </div>
        );
      })}
    </div>
  );
}

const MyWorkWindowedRows = React.memo(MyWorkWindowedRowsImpl) as typeof MyWorkWindowedRowsImpl;

function renderMyWorkDisplayEntry<Item, Field extends string>(
  section: MyWorkSection,
  entry: MyWorkDisplayEntry<Item, Field>,
  renderRow: (item: Item) => React.ReactNode,
): React.ReactNode {
  if (entry.kind === "row") return renderRow(entry.row);
  if (section !== "action_items" && section !== "nodes") return null;
  return (
    <div
      data-my-work-group={entry.groupID}
      data-my-work-group-field={entry.field}
      data-my-work-group-key={entry.groupKey}
      style={groupHeaderStyle(section, entry.field, entry.groupKey, entry.depth)}
    >
      <span>{entry.label}</span>
      <span aria-label={`${entry.rowCount} items`} style={groupCountStyle}>{entry.rowCount}</span>
    </div>
  );
}

function estimatedMyWorkEntrySize<Item, Field extends string>(
  entry: MyWorkDisplayEntry<Item, Field> | undefined,
  rowEstimate: number,
  index: number,
): number {
  if (entry?.kind !== "group-header") return rowEstimate;
  return 36 + (entry.depth === 0 && index > 0 ? 2 : 0);
}

function measureMyWorkDisplayEntry(element: HTMLDivElement): number {
  const measured = element.getBoundingClientRect().height;
  if (measured > 0) return measured;
  return Number(element.dataset.myWorkEstimatedSize) || 48;
}

function myWorkDisplayEntryStyle<Item, Field extends string>(
  entry: MyWorkDisplayEntry<Item, Field>,
  index: number,
  start?: number,
): React.CSSProperties {
  const indentation = entry.depth > 0 ? entry.depth * 25 + (entry.kind === "row" ? 1 : 0) : 0;
  return {
    minWidth: 0,
    width: "100%",
    boxSizing: "border-box",
    paddingTop: entry.kind === "group-header" && entry.depth === 0 && index > 0 ? 2 : 0,
    paddingBottom: 7,
    paddingLeft: indentation,
    ...(start === undefined ? {} : {
      position: "absolute",
      top: 0,
      left: 0,
      transform: `translateY(${start}px)`,
    }),
  };
}

function HistoryButton({ selected, disabled, onClick }: { selected: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={selected ? "Close History" : "Open History"}
      aria-pressed={selected}
      data-my-work-history-selected={selected ? "true" : "false"}
      disabled={disabled}
      onClick={onClick}
      style={historyButtonStyle(selected, disabled)}
    >
      <HistoryClockIcon />
      <span>History</span>
    </button>
  );
}

function HistoryClockIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none">
      <path d="M3.2 6.3V2.9m0 0H6.6m-3.4 0 2.3 2.3A7 7 0 1 1 3 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 5.8v4.5l3 1.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ActionItemRow({ item, onSaveDueDate }: { item: MyWorkActionItem; onSaveDueDate: (dueDate: string | null) => Promise<void> }) {
  const color = item.color?.trim().toLowerCase();
  const pulseClassName = color === "red" || color === "yellow" ? `mango-editor-action-item--${color}` : undefined;
  return (
    <div
      className="my-work-resource-row"
      data-my-work-row="action-item"
      data-my-work-action-item-color={color || "none"}
      style={actionItemRowStyle(color)}
    >
      <button
        type="button"
        data-my-work-target="action-item"
        data-my-work-action-item-color={color || "none"}
        style={actionItemPrimaryButtonStyle}
        onClick={(event) => openEditorEntityLink({
          entityType: "entity",
          entityID: item.entity_id,
          label: item.name,
          isActionItem: true,
        }, undefined, myWorkActionItemAnchor(event.currentTarget, event))}
      >
        <span aria-hidden="true" style={actionItemColorBarStyle(color)} />
        <span className={pulseClassName} style={actionItemIconStyle(color)}><ActionItemIcon className="mango-editor-action-item-icon" size={16} /></span>
        <span
          className={color === "red" || color === "yellow" ? `my-work-action-item-title--${color}` : undefined}
          data-my-work-action-item-title="true"
          style={actionItemNameStyle(color)}
        >
          {item.name}
        </span>
      </button>
      <InlineDueDateEditor value={item.completion_due_date} resourceLabel={item.name} onSave={onSaveDueDate} />
    </div>
  );
}

export function myWorkActionItemAnchor(
  row: Element,
  activation: Pick<React.MouseEvent<HTMLElement>, "clientX" | "clientY" | "detail">,
): EditorEntityLinkAnchorBounds | undefined {
  const rowBounds = editorEntityLinkAnchorBounds(row);
  if (!rowBounds) return undefined;
  const pointerActivation = activation.detail > 0
    && Number.isFinite(activation.clientX)
    && Number.isFinite(activation.clientY);
  const left = pointerActivation
    ? activation.clientX
    : Math.min(rowBounds.right, rowBounds.left + 42);
  const top = pointerActivation
    ? activation.clientY
    : rowBounds.top + (rowBounds.bottom - rowBounds.top) / 2;
  return {
    left,
    top,
    right: left,
    bottom: top,
    ...(rowBounds.portalTarget ? { portalTarget: rowBounds.portalTarget } : {}),
  };
}

function NodeRow({ item, onSaveDueDate }: { item: MyWorkNode; onSaveDueDate: (dueDate: string | null) => Promise<void> }) {
  return (
    <div className="my-work-resource-row" data-my-work-row="node" style={nodeRowStyle}>
      <button
        type="button"
        data-my-work-target="node"
        style={nodePrimaryButtonStyle}
        onClick={() => openEditorEntityLink({ entityType: "node", entityID: item.node_id, label: item.name })}
      >
        <span style={resourceIconSurfaceStyle("#19a8ff")}><ExplorerEntityIcon kind="node" /></span>
        <span style={resourceNameStyle}>{item.name}</span>
      </button>
      <div style={inlineContextStyle}>
        <InlineDueDateEditor value={item.due_date} resourceLabel={item.name} onSave={onSaveDueDate} />
        {item.process && (
          <button
            type="button"
            className="my-work-inline-context"
            data-my-work-target="process"
            style={inlineContextButtonStyle("#047857")}
            onClick={() => openEditorEntityLink({
              entityType: "logic_gate",
              entityID: item.process!.logic_gate_id,
              label: item.process!.name,
            })}
          >
            <span style={inlineContextIconStyle("#19c879")}><ExplorerEntityIcon kind="logic_gate" /></span>
            <span style={inlineContextLabelStyle}>{item.process.name}</span>
          </button>
        )}
        {item.project && (
          <button
            type="button"
            className="my-work-inline-context"
            data-my-work-target="project"
            style={inlineContextButtonStyle("#1d4ed8")}
            onClick={() => openEditorEntityLink({
              entityType: "project",
              entityID: item.project!.project_id,
              label: item.project!.name,
            })}
          >
            <span style={inlineContextIconStyle("#3b82f6")}><ExplorerEntityIcon kind="project" /></span>
            <span style={inlineContextLabelStyle}>{item.project.name}</span>
          </button>
        )}
      </div>
    </div>
  );
}

function InlineDueDateEditor({ value, resourceLabel, onSave }: {
  value: string | null | undefined;
  resourceLabel: string;
  onSave: (dueDate: string | null) => Promise<void>;
}) {
  const formatted = formatNodeDueDateForEditor(value);
  const [draft, setDraft] = useState(formatted);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveVersionRef = useRef(0);
  useEffect(() => setDraft(formatted), [formatted]);
  const commit = async (raw: string) => {
    const normalized = normalizeNodeDueDateDraft(raw);
    if (normalized === null) {
      setError("Use a valid month/day/year date.");
      setDraft(formatted);
      return;
    }
    if (normalized === (value?.trim() ?? "")) {
      setError("");
      setDraft(formatNodeDueDateForEditor(normalized));
      return;
    }
    const saveVersion = ++saveVersionRef.current;
    setSaving(true);
    setError("");
    const save = saveQueueRef.current
      .catch(() => undefined)
      .then(() => onSave(normalized || null));
    saveQueueRef.current = save;
    try {
      await save;
      if (saveVersion !== saveVersionRef.current) return;
      setDraft(formatNodeDueDateForEditor(normalized));
    } catch (cause) {
      if (saveVersion !== saveVersionRef.current) return;
      setError(cause instanceof Error && cause.message.trim() ? cause.message : "Could not change the due date.");
      setDraft(formatted);
    } finally {
      if (saveVersion === saveVersionRef.current) setSaving(false);
    }
  };
  return (
    <span data-my-work-due-date="true" style={inlineDueDateStyle(Boolean(error))} title={error || undefined}>
      <span style={inlineDueDateLabelStyle}>Due Date:</span>
      <EditorCalendarDateInput
        value={draft}
        ariaLabel={`Due Date for ${resourceLabel}`}
        disabled={saving}
        accent="#0284c7"
        placeholder="No date"
        onChange={(next) => { setDraft(next); setError(""); }}
        onCommit={(next) => void commit(next)}
        openOnInputClick
        containerStyle={{ width: 112, gridTemplateColumns: "minmax(0,1fr) 24px" }}
        inputStyle={{ color: error ? "#b91c1c" : "#075985", fontSize: 10.5, fontWeight: 850, cursor: saving ? "default" : "pointer" }}
        buttonStyle={{ width: 24, height: 24 }}
      />
    </span>
  );
}

function ProcessRow({ process }: { process: MyWorkProcess }) {
  return (
    <button
      type="button"
      className="my-work-resource-row"
      data-my-work-target="process"
      style={resourceButtonStyle}
      onClick={() => openEditorEntityLink({ entityType: "logic_gate", entityID: process.logic_gate_id, label: process.name })}
    >
      <span style={resourceIconSurfaceStyle("#19c879")}><ExplorerEntityIcon kind="logic_gate" /></span>
      <span style={resourceNameStyle}>{process.name}</span>
    </button>
  );
}

function ProjectRow({ project }: { project: MyWorkProject }) {
  return (
    <button
      type="button"
      className="my-work-resource-row"
      data-my-work-target="project"
      style={resourceButtonStyle}
      onClick={() => openEditorEntityLink({ entityType: "project", entityID: project.project_id, label: project.name })}
    >
      <span style={resourceIconSurfaceStyle("#3b82f6")}><ExplorerEntityIcon kind="project" /></span>
      <span style={resourceNameStyle}>{project.name}</span>
    </button>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div style={emptyStyle}>{label}</div>;
}

function LoadingRows() {
  return (
    <div aria-label="Loading My Work section" style={loadingStyle}>
      <span style={loadingLineStyle(82)} />
      <span style={loadingLineStyle(66)} />
      <span style={loadingLineStyle(74)} />
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  minWidth: 0,
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "52px minmax(0, 1fr)",
  overflow: "hidden",
  background: "linear-gradient(145deg, #f7f9fc 0%, #eef2f7 100%)",
  color: "#0f172a",
};

const pageHeaderStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 10,
  borderBottom: "1px solid rgba(255, 255, 255, 0.88)",
  background: "linear-gradient(145deg, rgba(255,255,255,0.98), rgba(246,249,253,0.94))",
  boxShadow: "0 6px 18px rgba(100,116,139,0.10), inset 0 -1px 0 rgba(148,163,184,0.12)",
  padding: "0 16px",
};

const pageHeaderIconStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  display: "grid",
  placeItems: "center",
  borderRadius: 8,
  border: "1px solid rgba(37,99,235,0.18)",
  background: "linear-gradient(145deg, #ffffff, #dbeafe)",
  boxShadow: "3px 3px 8px rgba(37,99,235,0.15), -2px -2px 6px rgba(255,255,255,0.92), inset 1px 1px 0 rgba(255,255,255,0.96)",
};

const pageTitleStyle: React.CSSProperties = { margin: 0, fontSize: 17, fontWeight: 900, letterSpacing: -0.2 };

function columnsStyle(weights: MyWorkColumnWeights): React.CSSProperties {
  return {
    width: "100%",
    minWidth: 0,
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: columnGridTemplate(weights),
    gap: 0,
    overflowX: "auto",
    overflowY: "hidden",
    padding: 12,
  };
}

function columnGridTemplate(weights: MyWorkColumnWeights): string {
  return `minmax(${MY_WORK_COLUMN_MIN_WIDTHS[0]}px, ${weights[0]}fr) ${MY_WORK_RESIZER_SIZE}px minmax(${MY_WORK_COLUMN_MIN_WIDTHS[1]}px, ${weights[1]}fr) ${MY_WORK_RESIZER_SIZE}px minmax(${MY_WORK_COLUMN_MIN_WIDTHS[2]}px, ${weights[2]}fr)`;
}

function leftColumnStyle(actionItemsRatio: number): React.CSSProperties {
  return {
    minWidth: 0,
    minHeight: 0,
    display: "grid",
    gridTemplateRows: leftColumnGridTemplate(actionItemsRatio),
    gap: 0,
  };
}

function leftColumnGridTemplate(actionItemsRatio: number): string {
  return `minmax(${MY_WORK_SECTION_MIN_HEIGHT}px, ${actionItemsRatio}fr) ${MY_WORK_RESIZER_SIZE}px minmax(${MY_WORK_SECTION_MIN_HEIGHT}px, ${1 - actionItemsRatio}fr)`;
}

function sectionStyle(hasError: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    minHeight: 0,
    display: "grid",
    gridTemplateRows: hasError ? "46px auto minmax(0, 1fr)" : "46px minmax(0, 1fr)",
    border: "1px solid transparent",
    borderRadius: 14,
    overflow: "hidden",
    background: "linear-gradient(145deg, rgba(255,255,255,0.98), rgba(247,250,253,0.96)) padding-box, linear-gradient(135deg, rgba(255,255,255,0.98), rgba(148,163,184,0.30)) border-box",
    boxShadow: "9px 9px 22px rgba(148,163,184,0.18), -7px -7px 20px rgba(255,255,255,0.88), inset 1px 1px 0 rgba(255,255,255,0.94)",
  };
}

const sectionHeaderStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  borderBottom: "1px solid rgba(148, 163, 184, 0.16)",
  background: "linear-gradient(145deg, rgba(255,255,255,0.92), rgba(241,245,249,0.72))",
  boxShadow: "0 5px 12px rgba(100,116,139,0.06), inset 0 -1px 0 rgba(255,255,255,0.84)",
  padding: "0 11px 0 12px",
};

const sectionTitleStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 8,
  margin: 0,
  fontSize: 13,
  fontWeight: 900,
};

const sectionTitleIconStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  display: "grid",
  placeItems: "center",
  flex: "0 0 auto",
  border: "1px solid rgba(148,163,184,0.20)",
  borderRadius: 9,
  background: "linear-gradient(145deg, #ffffff, #eef2f7)",
  boxShadow: "3px 3px 8px rgba(100,116,139,0.14), -3px -3px 8px rgba(255,255,255,0.94), inset 1px 1px 0 rgba(255,255,255,0.96)",
};

const sectionActionsStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 6,
};

function historyButtonStyle(selected: boolean, disabled: boolean): React.CSSProperties {
  return {
    minWidth: 78,
    height: 30,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    border: selected ? "1px solid rgba(37,99,235,.72)" : "1px solid rgba(148,163,184,.28)",
    borderRadius: 9,
    background: selected
      ? "linear-gradient(145deg,#2563eb,#1d4ed8)"
      : "linear-gradient(145deg,#ffffff,#eef2f7)",
    color: selected ? "#ffffff" : "#334155",
    boxShadow: selected
      ? "inset 2px 2px 5px rgba(15,23,42,.22), 0 0 0 2px rgba(147,197,253,.46), 3px 3px 8px rgba(37,99,235,.22)"
      : "3px 3px 8px rgba(100,116,139,.13), -2px -2px 7px rgba(255,255,255,.94), inset 1px 1px 0 rgba(255,255,255,.96)",
    font: "inherit",
    fontSize: 10.5,
    fontWeight: 900,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.55 : 1,
    padding: "0 8px",
  };
}

const sectionBodyStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  overflow: "auto",
  overflowAnchor: "none",
  padding: 10,
  scrollbarGutter: "stable",
};

const loadingMoreStyle: React.CSSProperties = {
  margin: "8px 2px 2px",
  color: "#64748b",
  fontSize: 10,
  fontWeight: 750,
  textAlign: "center",
};

const loadMoreSentinelStyle: React.CSSProperties = {
  minHeight: 24,
  display: "grid",
  placeItems: "center",
  marginTop: 6,
  borderRadius: 7,
  color: "#94a3b8",
  fontSize: 9.5,
  fontWeight: 700,
};

function resizeHandleStyle(orientation: "horizontal" | "vertical"): React.CSSProperties {
  return {
    width: orientation === "vertical" ? MY_WORK_RESIZER_SIZE : "100%",
    height: orientation === "horizontal" ? MY_WORK_RESIZER_SIZE : "100%",
    minWidth: 0,
    minHeight: 0,
    display: "grid",
    placeItems: "center",
    alignSelf: "stretch",
    border: "none",
    background: "transparent",
    cursor: orientation === "vertical" ? "col-resize" : "row-resize",
    touchAction: "none",
    padding: 0,
  };
}

function resizeGripStyle(orientation: "horizontal" | "vertical"): React.CSSProperties {
  return {
    width: orientation === "vertical" ? 3 : 48,
    height: orientation === "horizontal" ? 3 : 48,
    maxWidth: orientation === "horizontal" ? "72%" : undefined,
    maxHeight: orientation === "vertical" ? "72%" : undefined,
    borderRadius: 999,
    background: "linear-gradient(145deg, rgba(148,163,184,0.28), rgba(100,116,139,0.52))",
    boxShadow: "1px 1px 3px rgba(100,116,139,0.20), -1px -1px 2px rgba(255,255,255,0.90)",
    transition: "background 140ms ease, box-shadow 140ms ease, transform 140ms ease",
  };
}

const roleSelectorStyle: React.CSSProperties = {
  display: "inline-flex",
  gap: 4,
  border: "1px solid rgba(148, 163, 184, 0.20)",
  borderRadius: 9,
  background: "linear-gradient(145deg, rgba(255,255,255,0.94), rgba(241,245,249,0.82))",
  boxShadow: "inset 2px 2px 5px rgba(148,163,184,0.12), inset -2px -2px 5px rgba(255,255,255,0.92)",
  padding: 3,
};

function roleButtonStyle(active: boolean, accent: string): React.CSSProperties {
  return {
    width: 27,
    height: 26,
    border: `1px solid ${hexWithAlpha(accent, active ? 0.82 : 0.32)}`,
    borderRadius: 7,
    background: active
      ? `linear-gradient(145deg, ${hexWithAlpha(accent, 0.98)}, ${hexWithAlpha(accent, 0.78)})`
      : `linear-gradient(145deg, rgba(255,255,255,0.96), ${hexWithAlpha(accent, 0.12)})`,
    color: active ? "#ffffff" : accent,
    boxShadow: active
      ? `3px 3px 8px ${hexWithAlpha(accent, 0.26)}, -2px -2px 6px rgba(255,255,255,0.94), inset 1px 1px 0 rgba(255,255,255,0.50)`
      : "2px 2px 5px rgba(100,116,139,0.10), -2px -2px 5px rgba(255,255,255,0.88), inset 1px 1px 0 rgba(255,255,255,0.92)",
    font: "inherit",
    fontSize: 10.5,
    fontWeight: 900,
    cursor: "pointer",
    padding: 0,
    transition: "transform 140ms ease, box-shadow 140ms ease, background 140ms ease",
  };
}

function groupHeaderStyle(section: "action_items" | "nodes", field: string, key: string, depth: number): React.CSSProperties {
  const base: React.CSSProperties = {
    minWidth: 0,
    minHeight: 29,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    border: "1px solid rgba(148,163,184,0.16)",
    borderRadius: 8,
    background: depth === 0
      ? "linear-gradient(145deg, rgba(255,255,255,0.94), rgba(226,232,240,0.72))"
      : "linear-gradient(145deg, rgba(255,255,255,0.96), rgba(241,245,249,0.78))",
    color: "#475569",
    fontSize: 11.5,
    fontWeight: 850,
    padding: "0 9px",
    boxShadow: "3px 3px 8px rgba(100,116,139,0.09), -2px -2px 6px rgba(255,255,255,0.88), inset 1px 1px 0 rgba(255,255,255,0.90)",
  };
  if (section === "action_items" && field === "color" && (key === "red" || key === "yellow")) {
    const accent = key === "red" ? "#ef4444" : "#facc15";
    return {
      ...base,
      border: `1px solid ${hexWithAlpha(accent, 0.36)}`,
      background: `linear-gradient(145deg, rgba(255,255,255,0.94), ${hexWithAlpha(accent, 0.22)})`,
      color: key === "red" ? "#991b1b" : "#854d0e",
      boxShadow: `4px 4px 10px ${hexWithAlpha(accent, 0.12)}, -3px -3px 8px rgba(255,255,255,0.90), inset 1px 1px 0 rgba(255,255,255,0.90)`,
    };
  }
  if (section === "nodes" && field === "priority" && /^\d+$/.test(key)) {
    const accent = homeRACIRoleAccent(Number(key));
    return {
      ...base,
      border: `1px solid ${hexWithAlpha(accent, 0.34)}`,
      background: `linear-gradient(145deg, rgba(255,255,255,0.96), ${hexWithAlpha(accent, 0.15)})`,
      color: accent,
      boxShadow: `4px 4px 10px ${hexWithAlpha(accent, 0.10)}, -3px -3px 8px rgba(255,255,255,0.90), inset 1px 1px 0 rgba(255,255,255,0.92)`,
    };
  }
  return base;
}

const groupCountStyle: React.CSSProperties = {
  minWidth: 22,
  borderRadius: 999,
  background: "rgba(255,255,255,0.58)",
  color: "inherit",
  fontSize: 10.5,
  fontWeight: 900,
  textAlign: "center",
  padding: "1px 5px",
  opacity: 0.72,
};

const resourceButtonStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  minHeight: 40,
  display: "flex",
  alignItems: "center",
  gap: 8,
  border: "1px solid rgba(255,255,255,0.92)",
  borderRadius: 10,
  background: "linear-gradient(145deg, rgba(255,255,255,0.98), rgba(244,247,251,0.94))",
  color: "#1e293b",
  boxShadow: "4px 4px 10px rgba(100,116,139,0.13), -3px -3px 9px rgba(255,255,255,0.92), inset 1px 1px 0 rgba(255,255,255,0.96)",
  font: "inherit",
  cursor: "pointer",
  textAlign: "left",
  padding: "6px 9px",
};

const resourceNameStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 13,
  fontWeight: 800,
};

function actionItemRowStyle(color: string | undefined): React.CSSProperties {
  return {
    ...resourceButtonStyle,
    display: "grid",
    gridTemplateColumns: "minmax(0,1fr) auto",
    alignItems: "center",
    gap: 6,
    border: color === "red"
      ? "1px solid rgba(239,68,68,0.24)"
      : color === "yellow"
        ? "1px solid rgba(202,138,4,0.26)"
        : resourceButtonStyle.border,
    background: color === "red"
      ? "linear-gradient(145deg, rgba(255,255,255,0.96), rgba(254,226,226,0.84))"
      : color === "yellow"
        ? "linear-gradient(145deg, rgba(255,255,255,0.96), rgba(254,249,195,0.86))"
        : resourceButtonStyle.background,
    cursor: "default",
    padding: "5px 7px 5px 5px",
  };
}

const actionItemPrimaryButtonStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 34,
  display: "grid",
  gridTemplateColumns: "5px 29px minmax(0,1fr)",
  alignItems: "center",
  gap: 9,
  border: 0,
  borderRadius: 7,
  background: "transparent",
  color: "inherit",
  font: "inherit",
  cursor: "pointer",
  textAlign: "left",
  padding: "2px 3px 2px 1px",
};

function actionItemColorBarStyle(color: string | undefined): React.CSSProperties {
  return {
    width: 5,
    height: "100%",
    minHeight: 34,
    borderRadius: 999,
    background: color === "red" ? "#ef4444" : color === "yellow" ? "#facc15" : "#cbd5e1",
    boxShadow: color === "red"
      ? "0 0 9px rgba(239,68,68,0.28)"
      : color === "yellow"
        ? "0 0 9px rgba(250,204,21,0.30)"
        : "none",
  };
}

function actionItemIconStyle(color: string | undefined): React.CSSProperties {
  const colored = color === "red" || color === "yellow";
  return {
    width: 29,
    height: 29,
    display: "grid",
    placeItems: "center",
    border: colored ? "1px solid var(--mango-entity-chip-border)" : "1px solid rgba(100,116,139,0.24)",
    borderRadius: 9,
    background: colored ? "var(--mango-entity-chip-background)" : "linear-gradient(145deg, #ffffff, #e2e8f0)",
    color: colored ? "#111827" : "#64748b",
    boxShadow: colored
      ? "inset 1px 1px 0 rgba(255,255,255,0.84), 0 2px 7px var(--mango-entity-chip-shadow)"
      : "3px 3px 7px rgba(100,116,139,0.14), -2px -2px 6px rgba(255,255,255,0.92)",
    flex: "0 0 auto",
  };
}

function actionItemNameStyle(color: string | undefined): React.CSSProperties {
  return {
    ...resourceNameStyle,
    width: "fit-content",
    maxWidth: "100%",
    color: color === "red" ? "#991b1b" : color === "yellow" ? "#713f12" : "#1e293b",
    padding: "4px 0",
  };
}

const nodeRowStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 5,
  border: "1px solid rgba(255,255,255,0.92)",
  borderRadius: 10,
  background: "linear-gradient(145deg, rgba(255,255,255,0.98), rgba(244,247,251,0.94))",
  boxShadow: "4px 4px 10px rgba(100,116,139,0.13), -3px -3px 9px rgba(255,255,255,0.92), inset 1px 1px 0 rgba(255,255,255,0.96)",
  padding: 5,
};

const nodePrimaryButtonStyle: React.CSSProperties = {
  minWidth: 96,
  flex: "1 1 110px",
  minHeight: 28,
  display: "flex",
  alignItems: "center",
  gap: 7,
  border: "none",
  borderRadius: 6,
  background: "transparent",
  color: "#1e293b",
  font: "inherit",
  cursor: "pointer",
  textAlign: "left",
  padding: "3px 5px",
};

const inlineContextStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 6,
  overflow: "hidden",
};

function inlineDueDateStyle(error: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    flex: "0 0 auto",
    minHeight: 31,
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    border: `1px solid ${error ? "rgba(239,68,68,.42)" : "rgba(2,132,199,.26)"}`,
    borderRadius: 9,
    background: error
      ? "linear-gradient(145deg,#ffffff,#fef2f2)"
      : "linear-gradient(145deg,#ffffff,rgba(224,242,254,.72))",
    boxShadow: "3px 3px 8px rgba(2,132,199,.10), -2px -2px 7px rgba(255,255,255,.92), inset 1px 1px 0 rgba(255,255,255,.94)",
    padding: "2px 3px 2px 7px",
  };
}

const inlineDueDateLabelStyle: React.CSSProperties = {
  color: "#475569",
  fontSize: 10,
  fontWeight: 900,
  whiteSpace: "nowrap",
};

function inlineContextButtonStyle(color: string): React.CSSProperties {
  return {
    minWidth: 0,
    maxWidth: 148,
    minHeight: 31,
    display: "flex",
    alignItems: "center",
    gap: 4,
    border: `1px solid ${hexWithAlpha(color, 0.28)}`,
    borderRadius: 9,
    background: `linear-gradient(145deg, rgba(255,255,255,0.96), ${hexWithAlpha(color, 0.12)})`,
    color,
    boxShadow: `3px 3px 8px ${hexWithAlpha(color, 0.12)}, -2px -2px 7px rgba(255,255,255,0.92), inset 1px 1px 0 rgba(255,255,255,0.94)`,
    font: "inherit",
    cursor: "pointer",
    padding: "3px 7px 3px 4px",
  };
}

function resourceIconSurfaceStyle(color: string): React.CSSProperties {
  return {
    width: 27,
    height: 27,
    display: "grid",
    placeItems: "center",
    flex: "0 0 auto",
    border: `1px solid ${hexWithAlpha(color, 0.24)}`,
    borderRadius: 8,
    background: `linear-gradient(145deg, rgba(255,255,255,0.98), ${hexWithAlpha(color, 0.12)})`,
    boxShadow: `3px 3px 7px ${hexWithAlpha(color, 0.12)}, -2px -2px 6px rgba(255,255,255,0.94), inset 1px 1px 0 rgba(255,255,255,0.96)`,
  };
}

function inlineContextIconStyle(color: string): React.CSSProperties {
  return {
    width: 23,
    height: 23,
    display: "grid",
    placeItems: "center",
    flex: "0 0 auto",
    borderRadius: 7,
    background: `linear-gradient(145deg, rgba(255,255,255,0.92), ${hexWithAlpha(color, 0.16)})`,
    boxShadow: `inset 1px 1px 0 rgba(255,255,255,0.94), 2px 2px 5px ${hexWithAlpha(color, 0.12)}`,
  };
}

const inlineContextLabelStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 10.75,
  fontWeight: 800,
};

function hexWithAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return color;
  const value = match[1];
  return `rgba(${Number.parseInt(value.slice(0, 2), 16)}, ${Number.parseInt(value.slice(2, 4), 16)}, ${Number.parseInt(value.slice(4, 6), 16)}, ${alpha})`;
}

const emptyStyle: React.CSSProperties = {
  minHeight: 74,
  display: "grid",
  placeItems: "center",
  color: "#94a3b8",
  fontSize: 11,
  fontWeight: 750,
  textAlign: "center",
  padding: 12,
};

const loadingStyle: React.CSSProperties = { display: "grid", gap: 8, padding: 4 };

function loadingLineStyle(width: number): React.CSSProperties {
  return { width: `${width}%`, height: 30, borderRadius: 7, background: "#f1f5f9" };
}

const errorStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  borderBottom: "1px solid #fecaca",
  background: "#fef2f2",
  color: "#b91c1c",
  fontSize: 10.5,
  fontWeight: 750,
  padding: "5px 8px",
};

const smallButtonStyle: React.CSSProperties = {
  height: 24,
  border: "1px solid #fecaca",
  borderRadius: 5,
  background: "#ffffff",
  color: "#b91c1c",
  font: "inherit",
  fontSize: 10,
  fontWeight: 850,
  cursor: "pointer",
  padding: "0 7px",
};
