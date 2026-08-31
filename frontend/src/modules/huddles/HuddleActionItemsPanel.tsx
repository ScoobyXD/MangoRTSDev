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
import { UniversalGroupingControls } from "../grouping/UniversalGroupingControls.js";
import { buildUniversalNestedGroups } from "../grouping/universalGrouping.js";
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
  fetchHuddleActionItemSavedView,
  huddleActionItemGroupingValues,
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
} from "./huddleActionItems.js";

type RequestJSON = <T>(path: string, init?: RequestInit & { json?: unknown }) => Promise<T>;

export function HuddleActionItemsPanel({
  companyID,
  currentUserID,
  scope,
  companyUsers,
  requestJSON,
  refreshToken,
}: {
  companyID: string;
  currentUserID: string;
  scope: HuddleActionItemScope;
  companyUsers: CompanyUser[];
  requestJSON: RequestJSON;
  refreshToken: number;
}) {
  const [items, setItems] = useState<HuddleActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [preferenceError, setPreferenceError] = useState("");
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [groupings, setGroupings] = useState<HuddleActionItemGrouping[]>(() => cloneDefaults(DEFAULT_HUDDLE_ACTION_ITEM_GROUPINGS));
  const [orderings, setOrderings] = useState<HuddleActionItemOrdering[]>(() => cloneDefaults(DEFAULT_HUDDLE_ACTION_ITEM_ORDERINGS));
  const [displayedFields, setDisplayedFields] = useState<HuddleActionItemDisplayFieldID[]>(() => [
    ...DEFAULT_HUDDLE_ACTION_ITEM_DISPLAYED_FIELDS,
  ]);
  const itemsRef = useRef<HuddleActionItem[]>([]);
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
    try {
      const nextItems = await listHuddleActionItems(requestJSON, {
        companyID,
        scope: { resourceType: scopeResourceType, resourceID: scopeResourceID },
      });
      if (loadRequestIDRef.current !== requestID) return;
      itemsRef.current = nextItems;
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
  }, [companyID, requestJSON, scopeResourceID, scopeResourceType]);

  useEffect(() => {
    observedRefreshTokenRef.current = latestRefreshTokenRef.current;
    hasLoadedRef.current = false;
    itemsRef.current = [];
    setItems([]);
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
      if (!itemsRef.current.some((item) => item.entity_id === presentation.entityID)) return;
      void load();
    };
    window.addEventListener(EVENT_EDITOR_ENTITY_REFERENCE_PRESENTATION, refreshEditedActionItem);
    return () => window.removeEventListener(EVENT_EDITOR_ENTITY_REFERENCE_PRESENTATION, refreshEditedActionItem);
  }, [load]);

  useEffect(() => {
    const context = `${companyID.trim()}:${currentUserID.trim()}:${scopeResourceType}`;
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
    void fetchHuddleActionItemSavedView(requestJSON, companyID, scopeResourceType).then((savedView) => {
      if (preferenceLoadIDRef.current !== loadID || preferenceContextRef.current !== context) return;
      const next = normalizeHuddleActionItemPreferences(savedView);
      preferenceSavedViewIDRef.current = savedView?.saved_view_id?.trim() || preferenceSavedViewIDRef.current;
      setGroupings(next.groupings);
      setOrderings(next.orderings);
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
  }, [companyID, currentUserID, requestJSON, scopeResourceType]);

  const persistPreferences = useCallback((next: HuddleActionItemPreferences) => {
    const context = `${companyID.trim()}:${currentUserID.trim()}:${scopeResourceType}`;
    const savedViewID = preferenceSavedViewIDRef.current;
    const save = preferenceSaveQueueRef.current.catch(() => undefined).then(async () => {
      await saveHuddleActionItemSavedView(requestJSON, {
        companyID,
        userID: currentUserID,
        scopeType: scopeResourceType,
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
  }, [companyID, currentUserID, requestJSON, scopeResourceType]);

  const changeGroupings = (next: HuddleActionItemGrouping[]) => {
    const normalized = normalizeHuddleActionItemGroupings(next, new Set(orderings.map((item) => item.field)));
    setGroupings(normalized);
    persistPreferences({ groupings: normalized, orderings, displayedFields });
  };
  const changeOrderings = (next: HuddleActionItemOrdering[]) => {
    const normalized = normalizeHuddleActionItemOrderings(next, new Set(groupings.map((item) => item.field)));
    setOrderings(normalized);
    persistPreferences({ groupings, orderings: normalized, displayedFields });
  };
  const changeDisplayedFields = (next: HuddleActionItemDisplayFieldID[]) => {
    const normalized = normalizeHuddleActionItemDisplayedFields(next);
    setDisplayedFields(normalized);
    persistPreferences({ groupings, orderings, displayedFields: normalized });
  };

  const presentationItems = useMemo(
    () => items.map((item) => toHuddleActionItemPresentation(item, companyUsers)),
    [companyUsers, items],
  );
  const groups = useMemo(() => buildUniversalNestedGroups(presentationItems, groupings, {
    rootID: `huddle-action-items:${scopeResourceType}:${scopeResourceID}`,
    rowKey: (item) => item.entity_id,
    getValues: huddleActionItemGroupingValues,
    sortRows: (rows) => sortHuddleActionItems(rows, orderings),
  }), [groupings, orderings, presentationItems, scopeResourceID, scopeResourceType]);
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
  const scopeLabel = scopeResourceType === "huddle_node" ? "Huddle Node" : "Huddle Process";

  return (
    <section aria-label="Live Action Items" data-huddle-action-items="live" style={panelStyle}>
      <header style={headerStyle}>
        <strong>Action Items</strong>
        <div style={headerActionsStyle}>
          {preferenceError ? <span role="alert" title={preferenceError} style={preferenceErrorStyle}>!</span> : null}
          {refreshing && <span aria-live="polite" style={refreshingLabelStyle}>Refreshing</span>}
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
                sectionID={scopeResourceType}
                accent="#EA84E5"
                gridArea="1 / 2 / 3 / 3"
              />
            )}
          />
          <button type="button" aria-label="Refresh Action Items" title="Refresh Action Items" onClick={() => void load()} style={refreshButtonStyle}>↻</button>
        </div>
      </header>

      {error ? <div role="alert" style={errorStyle}>{error}</div> : <div aria-hidden="true" />}
      <div style={listStyle}>
        {loading && <div style={emptyStyle}>Loading Action Items</div>}
        {!loading && items.length === 0 && <div style={emptyStyle}>No Action Items yet.</div>}
        {!loading && items.length > 0 && entries.map((entry, index) => (
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
