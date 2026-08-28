import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CompanyUser } from "../communications/communicationsApi.js";
import { listHuddleNodeActionItems, type Entity } from "../entities/entitiesApi.js";
import {
  EVENT_EDITOR_ENTITY_REFERENCE_PRESENTATION,
  openEditorEntityLink,
  type EditorEntityReferencePresentation,
} from "../editor/editorEntityLinks.js";
import { UniversalGroupingControls } from "../grouping/UniversalGroupingControls.js";
import { buildUniversalNestedGroups, type UniversalNestedGroup } from "../grouping/universalGrouping.js";
import {
  ACTION_ITEM_GROUPING_FIELDS,
  DEFAULT_ACTION_ITEM_GROUPINGS,
  actionItemColor,
  actionItemColorHex,
  actionItemFieldOptionLabel,
  actionItemFieldString,
  actionItemGroupingStorageKey,
  actionItemGroupingValues,
  actionItemPersonLabel,
  formatActionItemDate,
  normalizeActionItemGroupings,
  sortActionItems,
  type ActionItemGrouping,
  type ActionItemGroupingField,
} from "./huddleActionItems.js";

type RequestJSON = <T>(path: string, init?: RequestInit & { json?: unknown }) => Promise<T>;

export function HuddleActionItemsPanel({
  companyID,
  currentUserID,
  huddleNodeID,
  companyUsers,
  requestJSON,
  refreshToken,
}: {
  companyID: string;
  currentUserID: string;
  huddleNodeID: string;
  companyUsers: CompanyUser[];
  requestJSON: RequestJSON;
  refreshToken: number;
}) {
  const [items, setItems] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [groupings, setGroupings] = useState<ActionItemGrouping[]>(() => readGroupings(companyID, currentUserID));
  const itemsRef = useRef<Entity[]>([]);
  const loadRequestIDRef = useRef(0);

  const load = useCallback(async () => {
    const requestID = loadRequestIDRef.current + 1;
    loadRequestIDRef.current = requestID;
    setLoading(true);
    setError("");
    try {
      const nextItems = await listHuddleNodeActionItems(requestJSON, { companyID, huddleNodeID });
      if (loadRequestIDRef.current !== requestID) return;
      itemsRef.current = nextItems;
      setItems(nextItems);
    } catch (cause) {
      if (loadRequestIDRef.current !== requestID) return;
      setError(cause instanceof Error ? cause.message : "Could not load Action Items");
    } finally {
      if (loadRequestIDRef.current === requestID) setLoading(false);
    }
  }, [companyID, huddleNodeID, requestJSON]);

  useEffect(() => {
    void load();
    return () => { loadRequestIDRef.current += 1; };
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
    setGroupings(readGroupings(companyID, currentUserID));
  }, [companyID, currentUserID]);

  const updateGroupings = (next: ActionItemGrouping[]) => {
    const normalized = normalizeActionItemGroupings(next);
    setGroupings(normalized);
    if (typeof window === "undefined") return;
    window.localStorage.setItem(actionItemGroupingStorageKey(companyID, currentUserID), JSON.stringify(normalized));
  };

  const groups = useMemo(() => buildUniversalNestedGroups(items, groupings, {
    rootID: `huddle-action-items:${huddleNodeID}`,
    rowKey: (item) => item.entity_id,
    getValues: (item, field) => actionItemGroupingValues(item, field, companyUsers),
    sortRows: sortActionItems,
  }), [companyUsers, groupings, huddleNodeID, items]);

  const openItem = (item: Entity) => openEditorEntityLink({
    entityType: "entity",
    entityID: item.entity_id,
    label: item.name,
  });

  const renderRow = (item: Entity, key: string) => {
    const color = actionItemColor(item);
    const colorHex = actionItemColorHex(item);
    const status = actionItemFieldOptionLabel(item, "status") || "In progress";
    const dueDate = actionItemFieldString(item, "completion_due_date");
    return (
      <button key={key} type="button" data-huddle-action-item={item.entity_id} onClick={() => openItem(item)} style={itemButtonStyle(color)}>
        <span aria-hidden="true" style={colorBarStyle(colorHex)} />
        <span style={itemBodyStyle}>
          <strong style={itemNameStyle}>{item.name}</strong>
          <span style={itemMetaStyle}>
            <span>{actionItemPersonLabel(item, companyUsers)}</span>
            <span>{formatActionItemDate(item.created_timestamp)}</span>
            <span>{dueDate ? `Due ${formatActionItemDate(dueDate)}` : "No completion due date"}</span>
            <span>{status}</span>
          </span>
        </span>
      </button>
    );
  };

  const renderGroups = (nestedGroups: Array<UniversalNestedGroup<Entity, ActionItemGroupingField>>): React.ReactNode => nestedGroups.map((group) => (
    <section key={group.id} data-huddle-action-item-group={group.field} style={groupSectionStyle(group.depth)}>
      <div style={groupHeaderStyle}>
        <span style={groupAxisStyle}>{groupingFieldLabel(group.field)}</span>
        <strong style={groupLabelStyle}>{group.label}</strong>
        <span style={groupCountStyle}>{collectRows(group).length}</span>
      </div>
      <div style={groupContentsStyle}>
        {group.groups.length > 0
          ? renderGroups(group.groups)
          : group.rows.map((item) => renderRow(item, `${group.id}:${item.entity_id}`))}
      </div>
    </section>
  ));

  return (
    <section aria-label="Live Action Items" data-huddle-action-items="live" style={panelStyle}>
      <header style={headerStyle}>
        <strong>Action Items</strong>
        <div style={headerActionsStyle}>
          <UniversalGroupingControls<ActionItemGroupingField>
            groupings={groupings}
            fieldOptions={ACTION_ITEM_GROUPING_FIELDS}
            onChange={updateGroupings}
            buttonLabel="Group"
            popoverLabel="Action Item grouping"
            accent="#f59e0b"
          />
          <button type="button" aria-label="Refresh Action Items" title="Refresh Action Items" onClick={() => void load()} style={refreshButtonStyle}>↻</button>
        </div>
      </header>

      {error && <div role="alert" style={errorStyle}>{error}</div>}
      <div style={listStyle}>
        {loading && <div style={emptyStyle}>Loading Action Items</div>}
        {!loading && items.length === 0 && <div style={emptyStyle}>No Action Items yet.</div>}
        {!loading && items.length > 0 && (groupings.length > 0
          ? renderGroups(groups)
          : sortActionItems(items).map((item) => renderRow(item, item.entity_id)))}
      </div>
    </section>
  );
}

function readGroupings(companyID: string, userID: string): ActionItemGrouping[] {
  if (typeof window === "undefined") return DEFAULT_ACTION_ITEM_GROUPINGS.map((item) => ({ ...item }));
  const stored = window.localStorage.getItem(actionItemGroupingStorageKey(companyID, userID));
  if (stored === null) return DEFAULT_ACTION_ITEM_GROUPINGS.map((item) => ({ ...item }));
  try {
    return normalizeActionItemGroupings(JSON.parse(stored));
  } catch {
    return DEFAULT_ACTION_ITEM_GROUPINGS.map((item) => ({ ...item }));
  }
}

function groupingFieldLabel(field: ActionItemGroupingField): string {
  return ACTION_ITEM_GROUPING_FIELDS.find((option) => option.value === field)?.label ?? field;
}

function collectRows(group: UniversalNestedGroup<Entity, ActionItemGroupingField>): Entity[] {
  if (group.rows.length > 0) return group.rows;
  const byID = new Map<string, Entity>();
  for (const child of group.groups) for (const item of collectRows(child)) byID.set(item.entity_id, item);
  return [...byID.values()];
}

const panelStyle: React.CSSProperties = { minWidth: 0, minHeight: 0, display: "grid", gridTemplateRows: "40px auto minmax(0,1fr)", overflow: "hidden", padding: 9, border: "1px solid rgba(255,255,255,.84)", borderRadius: 12, background: "rgba(248,250,252,.88)", boxShadow: "4px 4px 12px rgba(148,163,184,.18), -4px -4px 12px rgba(255,255,255,.82)" };
const headerStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "0 3px 6px", color: "#243047", fontSize: 14 };
const headerActionsStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 5 };
const refreshButtonStyle: React.CSSProperties = { width: 28, height: 28, border: "1px solid rgba(100,116,139,.25)", borderRadius: 7, background: "#fff", color: "#334155", cursor: "pointer", fontSize: 17 };
const errorStyle: React.CSSProperties = { marginBottom: 6, padding: "6px 8px", borderRadius: 7, background: "#fee2e2", color: "#b91c1c", fontSize: 11, fontWeight: 700 };
const listStyle: React.CSSProperties = { minHeight: 0, overflowY: "auto", display: "grid", alignContent: "start", gap: 7, padding: "2px" };
const emptyStyle: React.CSSProperties = { padding: "12px 8px", color: "#64748b", fontSize: 12, fontWeight: 650 };
const groupSectionStyle = (depth: number): React.CSSProperties => ({ display: "grid", gap: 5, marginLeft: depth > 0 ? 9 : 0, paddingLeft: depth > 0 ? 7 : 0, borderLeft: depth > 0 ? "2px solid rgba(148,163,184,.22)" : 0 });
const groupHeaderStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, minHeight: 24, color: "#475569", fontSize: 10 };
const groupAxisStyle: React.CSSProperties = { fontWeight: 750, textTransform: "uppercase", letterSpacing: ".04em" };
const groupLabelStyle: React.CSSProperties = { color: "#1e293b", fontSize: 11 };
const groupCountStyle: React.CSSProperties = { marginLeft: "auto", minWidth: 20, padding: "1px 5px", borderRadius: 999, background: "rgba(148,163,184,.14)", textAlign: "center" };
const groupContentsStyle: React.CSSProperties = { display: "grid", gap: 6 };
const itemButtonStyle = (color: string): React.CSSProperties => ({ width: "100%", minWidth: 0, display: "grid", gridTemplateColumns: "5px minmax(0,1fr)", gap: 8, border: "1px solid rgba(148,163,184,.24)", borderRadius: 9, background: color === "yellow" ? "rgba(254,249,195,.86)" : color === "red" ? "rgba(254,226,226,.86)" : "#fff", color: "#111827", padding: "7px 8px 7px 5px", textAlign: "left", cursor: "pointer" });
const colorBarStyle = (color: string): React.CSSProperties => ({ width: 5, height: "100%", minHeight: 34, borderRadius: 999, background: color });
const itemBodyStyle: React.CSSProperties = { minWidth: 0, display: "grid", gap: 4 };
const itemNameStyle: React.CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 };
const itemMetaStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: "3px 7px", color: "#64748b", fontSize: 9, textTransform: "capitalize" };
