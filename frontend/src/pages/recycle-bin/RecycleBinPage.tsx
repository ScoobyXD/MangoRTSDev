import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmActionMenu, confirmMenuPositionFromElement, type ConfirmActionMenuPosition } from "../../app/ConfirmActionMenu.js";
import { getActiveCompanyID } from "../../auth/currentCompany.js";
import { ExplorerRowIcon } from "../../modules/company-explorer/CompanyExplorerIcons.js";
import { resolveExplorerClickSelection } from "../../modules/company-explorer/treePresentation.js";
import {
  listRecycleBinItems,
  permanentlyDeleteRecycleBinItems,
  restoreRecycleBinItems,
  type RecycleBinItem,
  type RecycleBinObjectKind,
} from "../../modules/recycle-bin/recycleBinApi.js";

type RecycleBinPageProps = {
  embedded?: boolean;
};

type DragSelectState = {
  active: boolean;
  anchorID: string;
  baseSelectedIDs: Set<string>;
};

const EMPTY_DRAG_STATE: DragSelectState = {
  active: false,
  anchorID: "",
  baseSelectedIDs: new Set(),
};

export function RecycleBinPage({ embedded = false }: RecycleBinPageProps): React.ReactElement {
  const companyID = getActiveCompanyID();
  const [items, setItems] = useState<RecycleBinItem[]>([]);
  const [selectedIDs, setSelectedIDs] = useState<Set<string>>(new Set());
  const [selectionAnchorID, setSelectionAnchorID] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ itemIDs: string[]; position?: ConfirmActionMenuPosition | null } | null>(null);
  const dragSelectRef = useRef<DragSelectState>(EMPTY_DRAG_STATE);
  const orderedIDs = useMemo(() => items.map((item) => item.recycle_bin_item_id), [items]);
  const selectedItemIDs = useMemo(() => orderedIDs.filter((id) => selectedIDs.has(id)), [orderedIDs, selectedIDs]);
  const allItemsSelected = orderedIDs.length > 0 && selectedItemIDs.length === orderedIDs.length;

  const loadItems = useCallback(() => {
    if (!companyID) return;
    setLoading(true);
    setError("");
    listRecycleBinItems(companyID)
      .then((nextItems) => {
        setItems(nextItems);
        setSelectedIDs((current) => {
          const available = new Set(nextItems.map((item) => item.recycle_bin_item_id));
          const next = new Set<string>();
          for (const id of current) {
            if (available.has(id)) next.add(id);
          }
          return next;
        });
      })
      .catch((err) => setError(err instanceof Error ? err.message : "failed_to_load_recycle_bin"))
      .finally(() => setLoading(false));
  }, [companyID]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    const stopDragSelect = () => {
      dragSelectRef.current = EMPTY_DRAG_STATE;
    };
    window.addEventListener("pointerup", stopDragSelect);
    return () => window.removeEventListener("pointerup", stopDragSelect);
  }, []);

  const selectRow = useCallback((itemID: string, event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const selected = resolveExplorerClickSelection({
      orderedIDs,
      previousSelectedIDs: selectedIDs,
      anchorID: selectionAnchorID,
      clickedID: itemID,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey || event.metaKey,
    });
    setSelectedIDs(selected.selectedIDs);
    setSelectionAnchorID(selected.anchorID);
    dragSelectRef.current = {
      active: true,
      anchorID: selected.anchorID,
      baseSelectedIDs: new Set(selected.selectedIDs),
    };
  }, [orderedIDs, selectedIDs, selectionAnchorID]);

  const extendDragSelection = useCallback((itemID: string, event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragSelectRef.current;
    if (!dragState.active || (event.buttons & 1) !== 1 || !dragState.anchorID) return;
    const anchorIndex = orderedIDs.indexOf(dragState.anchorID);
    const targetIndex = orderedIDs.indexOf(itemID);
    if (anchorIndex < 0 || targetIndex < 0) return;
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    const next = new Set(dragState.baseSelectedIDs);
    for (const id of orderedIDs.slice(start, end + 1)) next.add(id);
    setSelectedIDs(next);
  }, [orderedIDs]);

  const toggleSelectAll = useCallback(() => {
    if (busy || orderedIDs.length === 0) return;
    if (allItemsSelected) {
      setSelectedIDs(new Set());
      setSelectionAnchorID("");
      return;
    }
    setSelectedIDs(new Set(orderedIDs));
    setSelectionAnchorID(orderedIDs[0] ?? "");
  }, [allItemsSelected, busy, orderedIDs]);

  const restoreSelected = useCallback(async () => {
    if (!companyID || selectedItemIDs.length === 0 || busy) return;
    setBusy(true);
    setError("");
    try {
      await restoreRecycleBinItems(companyID, selectedItemIDs);
      setSelectedIDs(new Set());
      setSelectionAnchorID("");
      await listRecycleBinItems(companyID).then(setItems);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_restore_recycle_bin_items");
    } finally {
      setBusy(false);
    }
  }, [busy, companyID, selectedItemIDs]);

  const requestDeleteSelected = useCallback((position?: ConfirmActionMenuPosition) => {
    if (!companyID || selectedItemIDs.length === 0 || busy) return;
    setDeleteConfirmation({ itemIDs: selectedItemIDs, position: position ?? null });
  }, [busy, companyID, selectedItemIDs]);

  const deleteSelected = useCallback(async (itemIDs: string[]) => {
    if (!companyID || itemIDs.length === 0 || busy) return;
    setDeleteConfirmation(null);
    setBusy(true);
    setError("");
    try {
      await permanentlyDeleteRecycleBinItems(companyID, itemIDs);
      setSelectedIDs(new Set());
      setSelectionAnchorID("");
      await listRecycleBinItems(companyID).then(setItems);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_delete_recycle_bin_items");
    } finally {
      setBusy(false);
    }
  }, [busy, companyID]);

  return (
    <main data-frame-interactive="true" style={recyclePageStyle(embedded)}>
      <div style={recycleHeaderStyle}>
        <div style={recycleTitleGroupStyle}>
          <RecycleIcon />
          <h1 style={recycleTitleStyle}>Recycle Bin</h1>
          <span style={recycleCountStyle}>{items.length}</span>
        </div>
        <div style={recycleToolbarStyle}>
          <button type="button" disabled={busy || orderedIDs.length === 0} onClick={toggleSelectAll} style={toolbarButtonStyle("primary", busy || orderedIDs.length === 0)}>
            {allItemsSelected ? "Clear selection" : "Select all"}
          </button>
          <button type="button" disabled={busy || selectedItemIDs.length === 0} onClick={restoreSelected} style={toolbarButtonStyle("primary", busy || selectedItemIDs.length === 0)}>
            Restore
          </button>
          <button type="button" disabled={busy || selectedItemIDs.length === 0} onClick={(event) => requestDeleteSelected(confirmMenuPositionFromElement(event.currentTarget))} style={toolbarButtonStyle("danger", busy || selectedItemIDs.length === 0)}>
            Permanently delete
          </button>
        </div>
      </div>
      {deleteConfirmation && (
        <ConfirmActionMenu
          title={`Permanently delete ${deleteConfirmation.itemIDs.length} recycle bin item${deleteConfirmation.itemIDs.length === 1 ? "" : "s"}?`}
          detail="This cannot be undone."
          position={deleteConfirmation.position}
          confirmLabel={busy ? "Deleting" : "Yes"}
          cancelLabel="No"
          confirmDisabled={busy}
          onConfirm={() => void deleteSelected(deleteConfirmation.itemIDs)}
          onCancel={() => setDeleteConfirmation(null)}
        />
      )}
      {error && <div role="alert" style={recycleErrorStyle}>{error}</div>}
      <section style={recycleTableShellStyle}>
        <div role="row" style={recycleTableHeaderStyle}>
          <span>Object</span>
          <span>Type</span>
          <span>Deleted</span>
        </div>
        <div role="listbox" aria-label="Deleted objects" aria-multiselectable="true" style={recycleRowsStyle}>
          {loading ? (
            <div style={recycleEmptyStyle}>Loading</div>
          ) : items.length === 0 ? (
            <div style={recycleEmptyStyle}>No deleted objects</div>
          ) : items.map((item) => {
            const selected = selectedIDs.has(item.recycle_bin_item_id);
            const containedSummary = formatContainedItems(item.contained_items ?? []);
            return (
              <div
                key={item.recycle_bin_item_id}
                role="option"
                aria-selected={selected}
                tabIndex={0}
                onPointerDown={(event) => selectRow(item.recycle_bin_item_id, event)}
                onPointerEnter={(event) => extendDragSelection(item.recycle_bin_item_id, event)}
                onKeyDown={(event) => {
                  if (event.key !== " " && event.key !== "Enter") return;
                  event.preventDefault();
                  const selected = resolveExplorerClickSelection({
                    orderedIDs,
                    previousSelectedIDs: selectedIDs,
                    anchorID: selectionAnchorID,
                    clickedID: item.recycle_bin_item_id,
                    shiftKey: event.shiftKey,
                    ctrlKey: event.ctrlKey || event.metaKey,
                  });
                  setSelectedIDs(selected.selectedIDs);
                  setSelectionAnchorID(selected.anchorID);
                }}
                style={recycleRowStyle(selected)}
              >
                <span style={recycleObjectCellStyle}>
                  <ObjectKindIcon kind={item.object_kind} />
                  <span style={recycleObjectStackStyle}>
                    <span style={recycleObjectTextStyle}>{item.object_label}</span>
                    {containedSummary && <span style={recycleContainedTextStyle}>{containedSummary}</span>}
                  </span>
                </span>
                <span style={recycleMutedCellStyle}>{formatObjectKind(item.object_kind, item.object_folder_kind)}</span>
                <span style={recycleMutedCellStyle}>{formatDeletedTimestamp(item.deleted_timestamp)}</span>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function formatObjectKind(kind: RecycleBinObjectKind, folderKind?: string): string {
  if (kind === "logic_gate") return "Logic Gate";
  if (kind === "folder") return folderKind ? `${formatObjectKind(folderKind as RecycleBinObjectKind)} folder` : "Folder";
  if (kind === "kanban") return "Kanban";
  return kind.slice(0, 1).toUpperCase() + kind.slice(1);
}

function formatContainedItems(items: NonNullable<RecycleBinItem["contained_items"]>): string {
  if (items.length === 0) return "";
  const visibleItems = items.slice(0, 5).map((item) => `${formatObjectKind(item.kind, item.folder_kind)}: ${item.label}`);
  const suffix = items.length > visibleItems.length ? `, +${items.length - visibleItems.length} more` : "";
  return `Contains ${items.length} item${items.length === 1 ? "" : "s"}: ${visibleItems.join(", ")}${suffix}`;
}

function formatDeletedTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function RecycleIcon(): React.ReactElement {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" style={{ display: "block" }}>
      <path d="M6.3 2.2h5.4l.55 1.55h2.25" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.7 5h10.6l-.65 10.1a1.4 1.4 0 0 1-1.4 1.3h-6.5a1.4 1.4 0 0 1-1.4-1.3Z" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
      <path d="M7 8.1v5.1M11 8.1v5.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M6.6 3.75h4.8" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}

function ObjectKindIcon({ kind }: { kind: RecycleBinObjectKind }): React.ReactElement {
  return (
    <span aria-hidden="true" style={recycleObjectIconStyle}>
      <ExplorerRowIcon kind={kind} />
    </span>
  );
}

function recyclePageStyle(embedded: boolean): React.CSSProperties {
  return {
    width: "100%",
    height: "100%",
    minHeight: embedded ? "100%" : "100vh",
    display: "grid",
    gridTemplateRows: "auto auto minmax(0, 1fr)",
    gap: 12,
    padding: 18,
    boxSizing: "border-box",
    background: "#f8fafc",
    color: "#111827",
    overflow: "hidden",
  };
}

const recycleHeaderStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const recycleTitleGroupStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 9,
  color: "#111827",
};

const recycleTitleStyle: React.CSSProperties = {
  margin: 0,
  color: "#111827",
  fontSize: 20,
  fontWeight: 760,
  lineHeight: 1.1,
  letterSpacing: 0,
};

const recycleCountStyle: React.CSSProperties = {
  minWidth: 24,
  height: 22,
  display: "grid",
  placeItems: "center",
  border: "1px solid rgba(100, 116, 139, 0.24)",
  borderRadius: 6,
  background: "#ffffff",
  color: "#475569",
  fontSize: 11,
  fontWeight: 760,
};

const recycleToolbarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
  justifyContent: "flex-end",
};

function toolbarButtonStyle(tone: "primary" | "danger", disabled: boolean): React.CSSProperties {
  return {
    minHeight: 32,
    border: `1px solid ${tone === "danger" ? "rgba(185, 28, 28, 0.32)" : "rgba(71, 85, 105, 0.34)"}`,
    borderRadius: 6,
    background: tone === "danger" ? "#fff1f2" : "#ffffff",
    color: tone === "danger" ? "#991b1b" : "#111827",
    cursor: disabled ? "default" : "pointer",
    font: "inherit",
    fontSize: 12,
    fontWeight: 760,
    padding: "0 12px",
    opacity: disabled ? 0.45 : 1,
  };
}

const recycleErrorStyle: React.CSSProperties = {
  minHeight: 30,
  display: "flex",
  alignItems: "center",
  border: "1px solid rgba(185, 28, 28, 0.26)",
  borderRadius: 6,
  background: "#fff1f2",
  color: "#991b1b",
  padding: "0 10px",
  fontSize: 12,
  fontWeight: 700,
};

const recycleTableShellStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "34px minmax(0, 1fr)",
  border: "1px solid rgba(100, 116, 139, 0.18)",
  borderRadius: 8,
  background: "#ffffff",
  overflow: "hidden",
};

const recycleTableHeaderStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(180px, 1fr) minmax(110px, 150px) minmax(150px, 210px)",
  alignItems: "center",
  gap: 10,
  borderBottom: "1px solid rgba(100, 116, 139, 0.18)",
  background: "#f1f5f9",
  color: "#475569",
  padding: "0 12px",
  fontSize: 11,
  fontWeight: 800,
};

const recycleRowsStyle: React.CSSProperties = {
  minHeight: 0,
  overflow: "auto",
};

function recycleRowStyle(selected: boolean): React.CSSProperties {
  return {
    minHeight: 44,
    display: "grid",
    gridTemplateColumns: "minmax(180px, 1fr) minmax(110px, 150px) minmax(150px, 210px)",
    alignItems: "center",
    gap: 10,
    borderBottom: "1px solid rgba(100, 116, 139, 0.10)",
    background: selected ? "#e0f2fe" : "#ffffff",
    color: "#111827",
    cursor: "default",
    padding: "6px 12px",
    fontSize: 12,
    userSelect: "none",
  };
}

const recycleObjectCellStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const recycleObjectStackStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 2,
};

const recycleObjectIconStyle: React.CSSProperties = {
  width: 18,
  height: 18,
  display: "grid",
  placeItems: "center",
  flex: "0 0 auto",
};

const recycleObjectTextStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontWeight: 720,
};

const recycleContainedTextStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#64748b",
  fontSize: 11,
  fontWeight: 650,
};

const recycleMutedCellStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#475569",
  fontWeight: 620,
};

const recycleEmptyStyle: React.CSSProperties = {
  minHeight: 76,
  display: "grid",
  placeItems: "center",
  color: "#64748b",
  fontSize: 12,
  fontWeight: 700,
};
