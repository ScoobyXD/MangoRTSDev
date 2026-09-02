import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StaggeredGroupingIcon } from "../../icons/NavigationIcons.js";
import { createSavedViewID } from "../../pages/home/savedViewsApi.js";
import { ActionItemRow } from "../action-items/ActionItemRow.js";
import type { CompanyUser } from "../communications/communicationsApi.js";
import {
  EVENT_EDITOR_ENTITY_REFERENCE_PRESENTATION,
  editorEntityLinkAnchorBounds,
  openEditorEntityLink,
  type EditorEntityReferencePresentation,
} from "../editor/editorEntityLinks.js";
import { EditorCalendarDateInput } from "../editor/EditorFieldControls.js";
import { formatNodeDueDateForEditor, normalizeNodeDueDateDraft } from "../editor/editorDates.js";
import { UniversalGroupingControls } from "../grouping/UniversalGroupingControls.js";
import { buildUniversalNestedGroups } from "../grouping/universalGrouping.js";
import { getUniversalStatusGroupValue } from "../grouping/universalStatusGrouping.js";
import { ActionItemInlineFieldSettingsSection } from "../my-work/ActionItemInlineFieldSettingsPopover.js";
import { ActionItemOrderingEditor } from "../my-work/ActionItemOrderingEditor.js";
import {
  flattenMyWorkGroupedDisplayEntries,
  flattenMyWorkUngroupedDisplayEntries,
} from "../my-work/myWorkWindowing.js";
import {
  DEFAULT_HUDDLE_ACTION_ITEM_DISPLAYED_FIELDS,
  DEFAULT_HUDDLE_ACTION_ITEM_GROUPINGS,
  DEFAULT_HUDDLE_ACTION_ITEM_ORDERINGS,
  HUDDLE_ACTION_ITEM_ARRANGE_FIELDS,
  HUDDLE_ACTION_ITEM_DISPLAY_FIELDS,
  actionItemFieldString,
  fetchHuddleActionItemSavedView,
  filterHuddleNodeDueActionItems,
  huddleActionItemGroupingValues,
  huddleActionItemOrderingsForView,
  listHuddleActionItems,
  normalizeHuddleActionItemDisplayedFields,
  normalizeHuddleActionItemGroupings,
  normalizeHuddleActionItemOrderings,
  normalizeHuddleActionItemPreferences,
  saveHuddleActionItemSavedView,
  sortHuddleActionItems,
  toHuddleActionItemPresentation,
  type HuddleActionItem,
  type HuddleActionItemArrangeField,
  type HuddleActionItemDisplayFieldID,
  type HuddleActionItemGrouping,
  type HuddleActionItemOrdering,
  type HuddleActionItemPreferences,
  type HuddleActionItemScope,
  type HuddleActionItemView,
} from "./huddleActionItems.js";
import { HUDDLE_CALENDAR_THEME } from "./huddleCalendarTheme.js";

type RequestJSON = <T>(path: string, init?: RequestInit & { json?: unknown }) => Promise<T>;

export function HuddleActionItemsPanel({
  companyID,
  currentUserID,
  scope,
  companyUsers,
  requestJSON,
  refreshToken,
  view,
  title = "Action Items",
  emptyLabel = "No Action Items yet.",
  viewingDate = "",
  referenceDate = "",
  onViewingDateChange,
  excludedItemIDs = new Set<string>(),
  onItemIDsChange,
}: {
  companyID: string;
  currentUserID: string;
  scope: HuddleActionItemScope;
  companyUsers: CompanyUser[];
  requestJSON: RequestJSON;
  refreshToken: number;
  view: HuddleActionItemView;
  title?: string;
  emptyLabel?: string;
  viewingDate?: string;
  referenceDate?: string;
  onViewingDateChange?: (value: string) => void;
  excludedItemIDs?: ReadonlySet<string>;
  onItemIDsChange?: (itemIDs: ReadonlySet<string>) => void;
}) {
  const [items, setItems] = useState<HuddleActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [preferenceError, setPreferenceError] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [groupings, setGroupings] = useState<HuddleActionItemGrouping[]>(() => cloneDefaults(DEFAULT_HUDDLE_ACTION_ITEM_GROUPINGS));
  const [orderings, setOrderings] = useState<HuddleActionItemOrdering[]>(() => cloneDefaults(DEFAULT_HUDDLE_ACTION_ITEM_ORDERINGS));
  const [displayedFields, setDisplayedFields] = useState<HuddleActionItemDisplayFieldID[]>(() => [
    ...DEFAULT_HUDDLE_ACTION_ITEM_DISPLAYED_FIELDS,
  ]);
  const hasLoadedRef = useRef(false);
  const loadRequestIDRef = useRef(0);
  const preferenceLoadIDRef = useRef(0);
  const preferenceSavedViewIDRef = useRef(createSavedViewID());
  const preferenceSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const preferenceContextRef = useRef("");
  const latestRefreshTokenRef = useRef(refreshToken);
  const observedRefreshTokenRef = useRef(refreshToken);
  latestRefreshTokenRef.current = refreshToken;
  const scopeResourceType = scope.resourceType;
  const scopeResourceID = scope.resourceID;

  const load = useCallback(async () => {
    const requestID = loadRequestIDRef.current + 1;
    loadRequestIDRef.current = requestID;
    if (hasLoadedRef.current) setRefreshing(true);
    else setLoading(true);
    setError("");
    if (view === "huddle_node_due" && !normalizeNodeDueDateDraft(viewingDate)) {
      setItems([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const nextItems = await listHuddleActionItems(requestJSON, {
        companyID,
        scope: { resourceType: scopeResourceType, resourceID: scopeResourceID },
        view,
        viewingDate,
      });
      if (loadRequestIDRef.current !== requestID) return;
      setItems(nextItems);
      hasLoadedRef.current = true;
    } catch (cause) {
      if (loadRequestIDRef.current !== requestID) return;
      setError(errorMessage(cause, "Could not load Action Items"));
    } finally {
      if (loadRequestIDRef.current === requestID) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [companyID, requestJSON, scopeResourceID, scopeResourceType, view, viewingDate]);

  useEffect(() => {
    observedRefreshTokenRef.current = latestRefreshTokenRef.current;
    hasLoadedRef.current = false;
    setItems([]);
    setShowCompleted(false);
    setRefreshing(false);
    void load();
    return () => { loadRequestIDRef.current += 1; };
  }, [load]);

  useEffect(() => {
    if (observedRefreshTokenRef.current === refreshToken) return;
    observedRefreshTokenRef.current = refreshToken;
    void load();
  }, [load, refreshToken]);

  useEffect(() => {
    const refreshEditedActionItem = (event: Event) => {
      const presentation = (event as CustomEvent<EditorEntityReferencePresentation>).detail;
      if (!presentation?.isActionItem) return;
      void load();
    };
    window.addEventListener(EVENT_EDITOR_ENTITY_REFERENCE_PRESENTATION, refreshEditedActionItem);
    return () => window.removeEventListener(EVENT_EDITOR_ENTITY_REFERENCE_PRESENTATION, refreshEditedActionItem);
  }, [load]);

  useEffect(() => {
    const refreshVisiblePage = () => void load();
    const refreshVisibleDocument = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refreshVisiblePage);
    document.addEventListener("visibilitychange", refreshVisibleDocument);
    return () => {
      window.removeEventListener("focus", refreshVisiblePage);
      document.removeEventListener("visibilitychange", refreshVisibleDocument);
    };
  }, [load]);

  useEffect(() => {
    const context = `${companyID.trim()}:${currentUserID.trim()}:${view}`;
    const loadID = preferenceLoadIDRef.current + 1;
    preferenceLoadIDRef.current = loadID;
    preferenceContextRef.current = context;
    preferenceSavedViewIDRef.current = createSavedViewID();
    preferenceSaveQueueRef.current = Promise.resolve();
    setGroupings(cloneDefaults(DEFAULT_HUDDLE_ACTION_ITEM_GROUPINGS));
    setOrderings(cloneDefaults(DEFAULT_HUDDLE_ACTION_ITEM_ORDERINGS));
    setDisplayedFields([...DEFAULT_HUDDLE_ACTION_ITEM_DISPLAYED_FIELDS]);
    setPreferenceError("");
    setPreferencesReady(false);
    void fetchHuddleActionItemSavedView(requestJSON, companyID, view).then((savedView) => {
      if (preferenceLoadIDRef.current !== loadID || preferenceContextRef.current !== context) return;
      const next = normalizeHuddleActionItemPreferences(savedView);
      const nextOrderings = huddleActionItemOrderingsForView(view, next.orderings);
      preferenceSavedViewIDRef.current = savedView?.saved_view_id?.trim() || preferenceSavedViewIDRef.current;
      setGroupings(normalizeHuddleActionItemGroupings(
        next.groupings,
        new Set(nextOrderings.map((ordering) => ordering.field)),
      ));
      setOrderings(nextOrderings);
      setDisplayedFields(next.displayedFields);
      setPreferencesReady(true);
    }).catch((cause) => {
      if (preferenceLoadIDRef.current !== loadID || preferenceContextRef.current !== context) return;
      setPreferenceError(errorMessage(cause, "Action Item display settings could not be loaded."));
      setPreferencesReady(true);
    });
    return () => {
      if (preferenceLoadIDRef.current === loadID) preferenceLoadIDRef.current += 1;
    };
  }, [companyID, currentUserID, requestJSON, view]);

  const persistPreferences = useCallback((next: HuddleActionItemPreferences) => {
    const context = `${companyID.trim()}:${currentUserID.trim()}:${view}`;
    const savedViewID = preferenceSavedViewIDRef.current;
    const save = preferenceSaveQueueRef.current.catch(() => undefined).then(async () => {
      await saveHuddleActionItemSavedView(requestJSON, {
        companyID,
        userID: currentUserID,
        view,
        savedViewID,
        groupings: next.groupings,
        orderings: next.orderings,
        displayedFields: next.displayedFields,
      });
      if (preferenceContextRef.current === context && preferenceSavedViewIDRef.current === savedViewID) {
        setPreferenceError("");
      }
    }).catch((cause) => {
      if (preferenceContextRef.current !== context || preferenceSavedViewIDRef.current !== savedViewID) return;
      setPreferenceError(errorMessage(cause, "Action Item display settings could not be saved."));
    });
    preferenceSaveQueueRef.current = save;
  }, [companyID, currentUserID, requestJSON, view]);

  const changeGroupings = (next: HuddleActionItemGrouping[]) => {
    const normalized = normalizeHuddleActionItemGroupings(next, new Set(orderings.map((item) => item.field)));
    setGroupings(normalized);
    persistPreferences({ groupings: normalized, orderings, displayedFields });
  };
  const changeOrderings = (next: HuddleActionItemOrdering[]) => {
    const normalizedOrderings = normalizeHuddleActionItemOrderings(next, new Set(groupings.map((item) => item.field)));
    const normalized = huddleActionItemOrderingsForView(view, normalizedOrderings);
    setOrderings(normalized);
    persistPreferences({ groupings, orderings: normalized, displayedFields });
  };
  const changeDisplayedFields = (next: HuddleActionItemDisplayFieldID[]) => {
    const normalized = normalizeHuddleActionItemDisplayedFields(next);
    setDisplayedFields(normalized);
    persistPreferences({ groupings, orderings, displayedFields: normalized });
  };

  const visibleItems = useMemo(
    () => view === "huddle_node_due"
      ? filterHuddleNodeDueActionItems(items, viewingDate, excludedItemIDs)
      : items.filter((item) => !excludedItemIDs.has(item.entity_id)
        && (view !== "huddle_logic_gate" || (getUniversalStatusGroupValue(actionItemFieldString(item, "status")).key === "done") === showCompleted)),
    [excludedItemIDs, items, showCompleted, view, viewingDate],
  );
  const visibleItemIDSignature = useMemo(
    () => visibleItems.map((item) => item.entity_id).sort().join("\n"),
    [visibleItems],
  );
  useEffect(() => {
    if (!onItemIDsChange) return undefined;
    onItemIDsChange(new Set(visibleItemIDSignature ? visibleItemIDSignature.split("\n") : []));
    return () => onItemIDsChange(new Set());
  }, [onItemIDsChange, visibleItemIDSignature]);
  const presentationItems = useMemo(
    () => visibleItems.map((item) => toHuddleActionItemPresentation(item, companyUsers)),
    [companyUsers, visibleItems],
  );
  const groups = useMemo(() => buildUniversalNestedGroups(presentationItems, groupings, {
    rootID: `huddle-action-items:${view}:${scopeResourceID}`,
    rowKey: (item) => item.entity_id,
    getValues: huddleActionItemGroupingValues,
    sortRows: (rows) => sortHuddleActionItems(rows, orderings),
  }), [groupings, orderings, presentationItems, scopeResourceID, view]);
  const entries = useMemo(() => groupings.length > 0
    ? flattenMyWorkGroupedDisplayEntries(
      groups,
      (item) => item.entity_id,
      new Set<HuddleActionItemArrangeField>(),
      false,
      groupings[groupings.length - 1]?.field,
    )
    : flattenMyWorkUngroupedDisplayEntries(sortHuddleActionItems(presentationItems, orderings), (item) => item.entity_id),
  [groupings.length, groups, orderings, presentationItems]);

  const openItem = (item: { entity_id: string; name: string }, target: HTMLButtonElement) => openEditorEntityLink(
    { entityType: "entity", entityID: item.entity_id, label: item.name, isActionItem: true },
    undefined,
    editorEntityLinkAnchorBounds(target),
  );
  const scopeLabel = view === "huddle_logic_gate"
    ? "Huddle Board"
    : view === "huddle_node_created"
      ? "Created in this Huddle Node"
      : "Due or Overdue";

  return (
    <section aria-label={title} data-huddle-action-items="live" data-huddle-action-item-view={view} style={panelStyle}>
      <header style={headerStyle}>
        <strong>{title}</strong>
        <div style={headerActionsStyle}>
          {preferenceError ? <span role="alert" title={preferenceError} style={preferenceErrorStyle}>!</span> : null}
          {refreshing && <span aria-live="polite" style={refreshingLabelStyle}>Refreshing</span>}
          {view === "huddle_node_due" && onViewingDateChange ? (
            <span data-huddle-viewing-date-control="true" style={viewingDateControlStyle}>
              <EditorCalendarDateInput
                value={viewingDate}
                ariaLabel="Due or Overdue viewing date"
                accent={HUDDLE_CALENDAR_THEME.accent}
                theme={HUDDLE_CALENDAR_THEME}
                referenceDate={referenceDate}
                referenceLabel="Huddle Node date"
                iconOnly
                allowClear={false}
                onChange={(next) => {
                  const normalized = normalizeNodeDueDateDraft(next);
                  if (normalized) onViewingDateChange(normalized);
                }}
                buttonStyle={{ width: 28, height: 28 }}
              />
              <span
                data-huddle-viewing-date-label="true"
                role="status"
                aria-label={`Active viewing date ${formatNodeDueDateForEditor(viewingDate)}`}
                aria-live="polite"
                style={viewingDateLabelStyle}
              >
                {formatNodeDueDateForEditor(viewingDate)}
              </span>
            </span>
          ) : null}
          {view === "huddle_logic_gate" ? (
            <label style={showCompletedStyle}>
              <input type="checkbox" checked={showCompleted} onChange={(event) => setShowCompleted(event.currentTarget.checked)} />
              Show completed
            </label>
          ) : null}
          <UniversalGroupingControls<HuddleActionItemArrangeField>
            groupings={groupings}
            fieldOptions={HUDDLE_ACTION_ITEM_ARRANGE_FIELDS.filter(
              (option) => !orderings.some((ordering) => ordering.field === option.value),
            )}
            onChange={changeGroupings}
            buttonLabel="Group, order, and choose Action Item row fields"
            triggerTitle={preferenceError || "Group, order, and choose Action Item row fields"}
            popoverLabel={`${scopeLabel} Action Item view`}
            groupingTitle="Group by"
            popoverAlign="end"
            triggerIcon={<StaggeredGroupingIcon color="#EA84E5" />}
            iconOnly
            accent="#EA84E5"
            layout="quadrants"
            popoverWidth={790}
            popoverEstimatedHeight={590}
            disabled={!preferencesReady}
            additionalContent={(
              <ActionItemOrderingEditor<HuddleActionItemArrangeField>
                orderings={orderings}
                fieldOptions={HUDDLE_ACTION_ITEM_ARRANGE_FIELDS.filter(
                  (option) => !groupings.some((grouping) => grouping.field === option.value),
                )}
                onChange={changeOrderings}
                accent="#EA84E5"
              />
            )}
            sideContent={(
              <ActionItemInlineFieldSettingsSection<HuddleActionItemDisplayFieldID>
                fields={HUDDLE_ACTION_ITEM_DISPLAY_FIELDS}
                fieldIDs={displayedFields}
                onFieldIDsChange={changeDisplayedFields}
                label={scopeLabel}
                sectionID={view}
                accent="#EA84E5"
                gridArea="1 / 2 / 3 / 3"
              />
            )}
          />
          {view === "huddle_logic_gate" ? (
            <button type="button" aria-label="Refresh Action Items" title="Refresh Action Items" onClick={() => void load()} style={refreshButtonStyle}>↻</button>
          ) : null}
        </div>
      </header>

      {error ? <div role="alert" style={errorStyle}>{error}</div> : <div aria-hidden="true" />}
      <div style={listStyle}>
        {loading && <div style={emptyStyle}>Loading Action Items</div>}
        {!loading && visibleItems.length === 0 && <div style={emptyStyle}>{view === "huddle_logic_gate"
          ? showCompleted ? "No completed Action Items." : "No incomplete Action Items."
          : emptyLabel}</div>}
        {!loading && visibleItems.length > 0 && entries.map((entry, index) => (
          <div
            key={entry.entryID}
            className={entry.surface ? "my-work-huddle-surface-segment" : undefined}
            data-huddle-action-item-entry={entry.entryID}
            data-huddle-action-item-entry-kind={entry.kind}
            data-my-work-huddle-surface-id={entry.surface?.id}
            data-my-work-huddle-surface-key={entry.surface?.key}
            data-my-work-huddle-surface-edge={entry.surface?.edge}
            style={entryStyle(entry.depth, entry.kind, index, entry.surface?.depth)}
          >
            {entry.kind === "group-header" ? (
              <div
                data-huddle-action-item-group={entry.groupID}
                data-huddle-action-item-group-field={entry.field}
                data-huddle-action-item-group-key={entry.groupKey}
                style={groupHeaderStyle(entry.field, entry.groupKey, entry.depth)}
              >
                <span>{entry.label}</span>
                <span aria-label={`${entry.rowCount} items`} style={groupCountStyle}>{entry.rowCount}</span>
              </div>
            ) : (
              <div data-huddle-action-item={entry.row.entity_id}>
                <ActionItemRow
                  item={entry.row}
                  displayedFields={displayedFields}
                  onOpen={(item, target) => openItem(item, target)}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function HuddleNodeActionItemsColumn(props: {
  companyID: string;
  currentUserID: string;
  huddleNodeID: string;
  companyUsers: CompanyUser[];
  requestJSON: RequestJSON;
  refreshToken: number;
  huddleNodeDate: string;
  viewingDate: string;
  onViewingDateChange: (value: string) => void;
}) {
  const [createdItemIDs, setCreatedItemIDs] = useState<ReadonlySet<string>>(() => new Set());
  return (
    <div aria-label="Huddle Node Action Items" data-huddle-node-action-item-sections="true" style={nodeSectionsStyle}>
      <HuddleActionItemsPanel
        companyID={props.companyID}
        currentUserID={props.currentUserID}
        scope={{ resourceType: "huddle_node", resourceID: props.huddleNodeID }}
        view="huddle_node_created"
        title="Created in this Huddle Node"
        emptyLabel="No Action Items were created in this Huddle Node."
        companyUsers={props.companyUsers}
        requestJSON={props.requestJSON}
        refreshToken={props.refreshToken}
        onItemIDsChange={setCreatedItemIDs}
      />
      <HuddleActionItemsPanel
        companyID={props.companyID}
        currentUserID={props.currentUserID}
        scope={{ resourceType: "huddle_node", resourceID: props.huddleNodeID }}
        view="huddle_node_due"
        title="Due or Overdue"
        emptyLabel="No incomplete Action Items are due by this date."
        companyUsers={props.companyUsers}
        requestJSON={props.requestJSON}
        refreshToken={props.refreshToken}
        viewingDate={props.viewingDate}
        referenceDate={props.huddleNodeDate}
        onViewingDateChange={props.onViewingDateChange}
        excludedItemIDs={createdItemIDs}
      />
    </div>
  );
}

function cloneDefaults<Field extends string>(
  defaults: ReadonlyArray<{ field: Field; direction: "asc" | "desc" }>,
): Array<{ field: Field; direction: "asc" | "desc" }> {
  return defaults.map((item) => ({ ...item }));
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim() ? cause.message : fallback;
}

const panelStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "40px auto minmax(0,1fr)",
  overflow: "hidden",
  padding: 9,
  border: "1px solid rgba(255,255,255,.84)",
  borderRadius: 12,
  background: "rgba(248,250,252,.88)",
  boxShadow: "4px 4px 12px rgba(148,163,184,.18), -4px -4px 12px rgba(255,255,255,.82)",
};
const headerStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "0 3px 6px", color: "#243047", fontSize: 14 };
const headerActionsStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 5 };
const showCompletedStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 4, color: "#475569", fontSize: 11, whiteSpace: "nowrap", cursor: "pointer" };
const viewingDateControlStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5 };
const viewingDateLabelStyle: React.CSSProperties = { minHeight: 28, display: "inline-flex", alignItems: "center", boxSizing: "border-box", border: "1px solid rgba(234,132,229,.32)", borderRadius: 7, background: "rgba(255,255,255,.92)", color: "#5b21b6", padding: "0 8px", fontSize: 10.5, fontWeight: 850, whiteSpace: "nowrap", boxShadow: "2px 2px 6px rgba(124,58,237,.10), -2px -2px 6px rgba(255,255,255,.86)" };
const refreshingLabelStyle: React.CSSProperties = { color: "#64748b", fontSize: 9, fontWeight: 700 };
const preferenceErrorStyle: React.CSSProperties = { color: "#b91c1c", fontSize: 12, fontWeight: 900 };
const refreshButtonStyle: React.CSSProperties = { width: 28, height: 28, border: "1px solid rgba(100,116,139,.25)", borderRadius: 7, background: "#fff", color: "#334155", cursor: "pointer", fontSize: 17 };
const errorStyle: React.CSSProperties = { marginBottom: 6, padding: "6px 8px", borderRadius: 7, background: "#fee2e2", color: "#b91c1c", fontSize: 11, fontWeight: 700 };
const listStyle: React.CSSProperties = { minHeight: 0, overflowY: "auto", display: "grid", alignContent: "start", gap: 0, padding: "2px" };
const emptyStyle: React.CSSProperties = { padding: "12px 8px", color: "#64748b", fontSize: 12, fontWeight: 650 };

function entryStyle(
  depth: number,
  kind: "group-header" | "row",
  index: number,
  surfaceDepth?: number,
): React.CSSProperties {
  const style: React.CSSProperties & { "--my-work-huddle-surface-indent"?: string } = {
    minWidth: 0,
    position: surfaceDepth === undefined ? undefined : "relative",
    paddingTop: kind === "group-header" && depth === 0 && index > 0 ? 2 : 0,
    paddingBottom: 7,
    paddingLeft: depth > 0 ? depth * 25 + (kind === "row" ? 1 : 0) : 0,
  };
  if (surfaceDepth !== undefined) style["--my-work-huddle-surface-indent"] = `${surfaceDepth * 25}px`;
  return style;
}

function groupHeaderStyle(field: HuddleActionItemArrangeField, key: string, depth: number): React.CSSProperties {
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
  if (field !== "color" || (key !== "red" && key !== "yellow")) return base;
  return key === "red"
    ? { ...base, border: "1px solid rgba(239,68,68,.36)", background: "linear-gradient(145deg,rgba(255,255,255,.94),rgba(239,68,68,.22))", color: "#991b1b" }
    : { ...base, border: "1px solid rgba(250,204,21,.40)", background: "linear-gradient(145deg,rgba(255,255,255,.94),rgba(250,204,21,.24))", color: "#854d0e" };
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

const nodeSectionsStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "minmax(0,1fr) minmax(0,1fr)",
  gap: 8,
  overflow: "hidden",
};
