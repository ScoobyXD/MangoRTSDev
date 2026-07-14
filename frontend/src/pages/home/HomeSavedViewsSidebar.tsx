import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import FrameRightClickMenu from "../../app/framerightclickmenu";
import {
  DEFAULT_MY_WORK_GROUPINGS,
  MY_WORK_GROUPING_FIELDS,
  normalizeMyWorkGroupingStack,
} from "./myWorkGrouping";
import {
  createSavedViewID,
  deleteSavedView as deleteSavedViewRequest,
  fetchSavedViews,
  saveSavedView,
  type SavedView,
  type SavedViewGrouping,
  type SavedViewPrincipal,
  type SavedViewSurface,
} from "./savedViewsApi";
import { DEFAULT_UPDATE_GROUPINGS, UPDATE_GROUPING_FIELDS, normalizeUpdateGroupingStack } from "./updatesGrouping";

export const EVENT_HOME_SAVED_VIEWS_CHANGED = "mangorts:home-saved-views-changed";

export function selectBuiltInHomeSavedView(surface: HomeSavedViewsSurface, companyID: string, userID: string): void {
  const storageUserID = userID.trim() || "local";
  clearSelectedSavedViewID(surface, companyID, storageUserID);
  emitHomeSavedViewsChanged(surface, "");
}

type HomeSavedViewsSurface = Extract<SavedViewSurface, "my_work" | "updates">;

type HomeSavedGroupingSetting = {
  setting_id: string;
  company_id: string;
  user_id: string;
  surface: HomeSavedViewsSurface;
  principal: SavedViewPrincipal;
  principal_id: string;
  name: string;
  groupings: SavedViewGrouping[];
  position: number;
  created_timestamp: string;
  updated_timestamp: string;
};

type HomeSavedViewsSidebarSectionProps = {
  apiBase: string;
  companyID: string;
  currentUserID: string;
  surface: HomeSavedViewsSurface;
  active: boolean;
  onSelectSurface: () => void;
};

const MY_WORK_SELECTED_VIEW_STORAGE_KEY = "mangorts.myWork.selectedView.v1";
const UPDATES_SELECTED_VIEW_STORAGE_KEY = "mangorts.updates.selectedView.v1";
const HOME_SAVED_VIEW_DRAG_MIME = "application/x-mangorts-home-saved-view";
const HOME_SAVED_VIEW_GROUPING_DRAG_MIME = "application/x-mangorts-home-saved-view-grouping";
const HOME_SAVED_VIEW_EDITOR_WIDTH = 318;

type SavedViewDropPlacement = "before" | "after";

export function HomeSavedViewsSidebarSection({
  apiBase,
  companyID,
  currentUserID,
  surface,
  active,
  onSelectSurface,
}: HomeSavedViewsSidebarSectionProps) {
  const storageUserID = currentUserID.trim() || "local";
  const fallbackSetting = useMemo(
    () => createDefaultSavedView(surface, companyID, currentUserID),
    [companyID, currentUserID, surface],
  );
  const [settings, setSettings] = useState<HomeSavedGroupingSetting[]>(() => []);
  const [selectedSettingID, setSelectedSettingID] = useState("");
  const [contextMenu, setContextMenu] = useState<{ settingID: string; x: number; y: number } | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorPosition, setEditorPosition] = useState({ left: 320, top: 92 });
  const [nameDraft, setNameDraft] = useState(fallbackSetting.name);
  const [savedViewDropTarget, setSavedViewDropTarget] = useState<{ settingID: string; placement: SavedViewDropPlacement } | null>(null);
  const [groupingDropTarget, setGroupingDropTarget] = useState<{ index: number; placement: SavedViewDropPlacement } | null>(null);
  const [addGroupingMenuOpen, setAddGroupingMenuOpen] = useState(false);
  const [addGroupingMenuPosition, setAddGroupingMenuPosition] = useState({ left: 0, top: 0, width: 208 });
  const [addButtonRaised, setAddButtonRaised] = useState(false);
  const [error, setError] = useState("");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const addGroupingButtonRef = useRef<HTMLButtonElement | null>(null);
  const addGroupingMenuRef = useRef<HTMLDivElement | null>(null);
  const commitNameDraftRef = useRef<() => void>(() => {});
  const selectedSetting = settings.find((setting) => setting.setting_id === selectedSettingID) ?? settings[0] ?? fallbackSetting;
  const contextSetting = contextMenu ? settings.find((setting) => setting.setting_id === contextMenu.settingID) ?? null : null;
  const groupingFields = homeSavedViewGroupingFields(surface);
  const activeFieldSet = new Set(selectedSetting.groupings.map((grouping) => grouping.field));
  const addableFields = groupingFields.filter((field) => !activeFieldSet.has(field.value));

  const updateEditorPosition = useCallback(() => {
    if (typeof window === "undefined") return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = HOME_SAVED_VIEW_EDITOR_WIDTH;
    const inset = 10;
    const left = Math.max(inset, Math.min(rect.right + 12, window.innerWidth - width - inset));
    const top = Math.max(inset, Math.min(rect.top, window.innerHeight - 180));
    setEditorPosition((current) => (current.left === left && current.top === top ? current : { left, top }));
  }, []);

  const updateAddGroupingMenuPosition = useCallback(() => {
    if (typeof window === "undefined") return;
    const rect = addGroupingButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(218, Math.max(188, rect.width));
    const inset = 8;
    const left = Math.max(inset, Math.min(rect.left, window.innerWidth - width - inset));
    const top = Math.max(inset, Math.min(rect.bottom + 6, window.innerHeight - inset));
    setAddGroupingMenuPosition((current) => (
      current.left === left && current.top === top && current.width === width
        ? current
        : { left, top, width }
    ));
  }, []);

  useEffect(() => {
    setNameDraft(selectedSetting.name);
    setAddGroupingMenuOpen(false);
    setGroupingDropTarget(null);
  }, [selectedSetting.name, selectedSetting.setting_id]);

  useEffect(() => {
    if (!editorOpen) {
      setAddGroupingMenuOpen(false);
      setGroupingDropTarget(null);
    }
  }, [editorOpen]);

  useEffect(() => {
    if (!apiBase || !companyID.trim()) {
      setSettings([]);
      setSelectedSettingID("");
      return undefined;
    }
    let cancelled = false;
    setError("");
    void fetchSavedViews({ apiBase, companyID, surface }).then((savedViews) => {
      if (cancelled) return;
      const loaded = savedViews
        .filter((view) => view.surface === surface)
        .sort((left, right) => left.position - right.position
          || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" })
          || left.saved_view_id.localeCompare(right.saved_view_id))
        .map((view) => savedViewToSetting(view, fallbackSetting, surface, currentUserID));
      const nextSettings = loaded;
      const preferredSettingID = readSelectedSavedViewID(surface, companyID, storageUserID);
      const nextSelectedSettingID = nextSettings.find((setting) => setting.setting_id === preferredSettingID)?.setting_id
        ?? nextSettings[0]?.setting_id
        ?? "";
      setSettings(nextSettings);
      setSelectedSettingID(nextSelectedSettingID);
      if (nextSelectedSettingID) storeSelectedSavedViewID(surface, companyID, storageUserID, nextSelectedSettingID);
      else clearSelectedSavedViewID(surface, companyID, storageUserID);
    }).catch((loadError) => {
      if (cancelled) return;
      setSettings([]);
      setSelectedSettingID("");
      clearSelectedSavedViewID(surface, companyID, storageUserID);
      setError(savedViewErrorMessage(loadError, "Failed to load saved views"));
    });
    return () => { cancelled = true; };
  }, [apiBase, companyID, currentUserID, fallbackSetting, storageUserID, surface]);

  useEffect(() => {
    if (!editorOpen) return undefined;
    updateEditorPosition();
    const timer = window.setTimeout(updateEditorPosition, 0);
    window.addEventListener("resize", updateEditorPosition);
    window.addEventListener("scroll", updateEditorPosition, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", updateEditorPosition);
      window.removeEventListener("scroll", updateEditorPosition, true);
    };
  }, [editorOpen, updateEditorPosition]);

  useEffect(() => {
    if (!editorOpen) return undefined;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (editorRef.current?.contains(target)) {
        if (addGroupingMenuOpen && !addGroupingMenuRef.current?.contains(target) && !addGroupingButtonRef.current?.contains(target)) {
          setAddGroupingMenuOpen(false);
        }
        return;
      }
      if (addGroupingMenuRef.current?.contains(target)) return;
      commitNameDraftRef.current();
      setEditorOpen(false);
      setAddGroupingMenuOpen(false);
    };
    const timer = window.setTimeout(() => window.addEventListener("mousedown", handler, true), 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousedown", handler, true);
    };
  }, [addGroupingMenuOpen, editorOpen]);

  useEffect(() => {
    if (!editorOpen || !addGroupingMenuOpen) return undefined;
    updateAddGroupingMenuPosition();
    const timer = window.setTimeout(updateAddGroupingMenuPosition, 0);
    window.addEventListener("resize", updateAddGroupingMenuPosition);
    window.addEventListener("scroll", updateAddGroupingMenuPosition, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", updateAddGroupingMenuPosition);
      window.removeEventListener("scroll", updateAddGroupingMenuPosition, true);
    };
  }, [addGroupingMenuOpen, editorOpen, updateAddGroupingMenuPosition]);

  const selectSetting = useCallback((settingID: string, navigate = false) => {
    const cleanSettingID = settingID.trim();
    if (!cleanSettingID) return;
    setSelectedSettingID(cleanSettingID);
    storeSelectedSavedViewID(surface, companyID, storageUserID, cleanSettingID);
    emitHomeSavedViewsChanged(surface, cleanSettingID);
    if (navigate) onSelectSurface();
  }, [companyID, onSelectSurface, storageUserID, surface]);

  const persistSetting = useCallback((setting: HomeSavedGroupingSetting, emitChange = true) => {
    if (!apiBase || !companyID.trim() || !currentUserID.trim()) {
      setError("Sign in required to save views");
      return;
    }
    setError("");
    void saveSavedView({
      apiBase,
      savedView: settingToSavedViewInput(setting, companyID, currentUserID),
    }).then((savedView) => {
      const normalized = savedViewToSetting(savedView, setting, surface, currentUserID);
      setSettings((current) => current.map((item) => (item.setting_id === setting.setting_id ? normalized : item)));
      if (emitChange) emitHomeSavedViewsChanged(surface, normalized.setting_id);
    }).catch((saveError) => {
      setError(savedViewErrorMessage(saveError, "Failed to save view"));
    });
  }, [apiBase, companyID, currentUserID, surface]);

  const updateSelectedSetting = useCallback((updater: (setting: HomeSavedGroupingSetting) => HomeSavedGroupingSetting) => {
    const updated = updater(selectedSetting);
    const next = {
      ...updated,
      groupings: normalizeHomeSavedGroupingStack(surface, updated.groupings),
      updated_timestamp: new Date().toISOString(),
    };
    setSettings((current) => current.map((setting) => (setting.setting_id === selectedSetting.setting_id ? next : setting)));
    persistSetting(next);
  }, [persistSetting, selectedSetting, surface]);

  const addSavedView = useCallback(() => {
    const now = new Date().toISOString();
    const setting: HomeSavedGroupingSetting = {
      ...selectedSetting,
      setting_id: createSavedViewID(),
      principal: "user",
      principal_id: currentUserID.trim(),
      name: `View ${settings.length + 1}`,
      position: nextSavedViewPosition(settings),
      created_timestamp: now,
      updated_timestamp: now,
    };
    setContextMenu(null);
    setSettings((current) => [...current, setting]);
    setSelectedSettingID(setting.setting_id);
    storeSelectedSavedViewID(surface, companyID, storageUserID, setting.setting_id);
    setEditorOpen(true);
    persistSetting(setting, false);
  }, [companyID, currentUserID, persistSetting, selectedSetting, settings, storageUserID, surface]);

  const renameSavedView = useCallback((settingID: string) => {
    const setting = settings.find((item) => item.setting_id === settingID);
    if (!setting) return;
    const nextName = window.prompt("Rename view", setting.name)?.trim();
    if (!nextName || nextName === setting.name) return;
    const next = { ...setting, name: nextName, updated_timestamp: new Date().toISOString() };
    setSettings((current) => current.map((item) => (item.setting_id === settingID ? next : item)));
    persistSetting(next);
  }, [persistSetting, settings]);

  const commitNameDraft = useCallback(() => {
    const nextName = nameDraft.trim();
    if (!nextName || nextName === selectedSetting.name) {
      setNameDraft(selectedSetting.name);
      return;
    }
    updateSelectedSetting((setting) => ({ ...setting, name: nextName }));
  }, [nameDraft, selectedSetting.name, updateSelectedSetting]);
  commitNameDraftRef.current = commitNameDraft;

  const deleteSavedView = useCallback((settingID: string) => {
    const setting = settings.find((item) => item.setting_id === settingID);
    if (!setting) return;
    const nextSettings = settings.filter((item) => item.setting_id !== settingID);
    const nextSelectedSettingID = selectedSettingID === settingID
      ? nextSettings[0]?.setting_id ?? ""
      : selectedSettingID;
    setSettings(nextSettings);
    setContextMenu(null);
    if (setting.setting_id === selectedSetting.setting_id) setEditorOpen(false);
    if (nextSelectedSettingID) {
      setSelectedSettingID(nextSelectedSettingID);
      storeSelectedSavedViewID(surface, companyID, storageUserID, nextSelectedSettingID);
      emitHomeSavedViewsChanged(surface, nextSelectedSettingID);
    } else {
      setSelectedSettingID("");
      clearSelectedSavedViewID(surface, companyID, storageUserID);
      emitHomeSavedViewsChanged(surface, "");
    }
    if (apiBase && companyID.trim()) {
      void deleteSavedViewRequest({ apiBase, companyID, savedViewID: setting.setting_id }).catch((deleteError) => {
        setError(savedViewErrorMessage(deleteError, "Failed to delete view"));
      });
    }
  }, [apiBase, companyID, selectedSetting.setting_id, selectedSettingID, settings, storageUserID, surface]);

  const reorderSavedView = useCallback((sourceSettingID: string, targetSettingID: string | null, placement: SavedViewDropPlacement) => {
    const moving = settings.find((item) => item.setting_id === sourceSettingID);
    if (!moving) return;
    const withoutMoving = settings.filter((item) => item.setting_id !== sourceSettingID);
    const targetIndex = targetSettingID ? withoutMoving.findIndex((item) => item.setting_id === targetSettingID) : withoutMoving.length;
    if (targetIndex < 0) return;
    const insertIndex = targetSettingID ? targetIndex + (placement === "after" ? 1 : 0) : withoutMoving.length;
    const reordered = [...withoutMoving];
    reordered.splice(insertIndex, 0, moving);
    if (reordered.every((setting, index) => setting.setting_id === settings[index]?.setting_id)) return;
    const now = new Date().toISOString();
    const nextSettings = reordered.map((setting, index) => {
      const previous = settings.find((item) => item.setting_id === setting.setting_id);
      const position = (index + 1) * 1000;
      return previous?.position === position ? setting : { ...setting, position, updated_timestamp: now };
    });
    setSettings(nextSettings);
    emitHomeSavedViewsChanged(surface, selectedSettingID);
    for (const setting of nextSettings) {
      const previous = settings.find((item) => item.setting_id === setting.setting_id);
      if (previous?.position !== setting.position) persistSetting(setting);
    }
  }, [persistSetting, selectedSettingID, settings, surface]);

  const reorderSelectedGrouping = useCallback((sourceIndex: number, targetIndex: number, placement: SavedViewDropPlacement) => {
    updateSelectedSetting((setting) => {
      const moving = setting.groupings[sourceIndex];
      if (sourceIndex === targetIndex) return setting;
      if (!moving || !setting.groupings[targetIndex]) return setting;
      const withoutMoving = setting.groupings.filter((_, index) => index !== sourceIndex);
      const adjustedTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
      const insertIndex = adjustedTargetIndex + (placement === "after" ? 1 : 0);
      const groupings = [...withoutMoving];
      groupings.splice(insertIndex, 0, moving);
      if (groupings.every((grouping, index) => grouping === setting.groupings[index])) return setting;
      return { ...setting, groupings };
    });
  }, [updateSelectedSetting]);

  const readDraggedSavedViewID = useCallback((dataTransfer: DataTransfer): string => {
    try {
      const parsed = JSON.parse(dataTransfer.getData(HOME_SAVED_VIEW_DRAG_MIME)) as { settingID?: unknown; surface?: unknown };
      if (parsed.surface !== surface) return "";
      return typeof parsed.settingID === "string" ? parsed.settingID.trim() : "";
    } catch {
      return "";
    }
  }, [surface]);

  const readDraggedGroupingIndex = useCallback((dataTransfer: DataTransfer): number => {
    try {
      const parsed = JSON.parse(dataTransfer.getData(HOME_SAVED_VIEW_GROUPING_DRAG_MIME)) as { settingID?: unknown; index?: unknown };
      if (parsed.settingID !== selectedSetting.setting_id || typeof parsed.index !== "number") return -1;
      return Number.isInteger(parsed.index) ? parsed.index : -1;
    } catch {
      return -1;
    }
  }, [selectedSetting.setting_id]);

  const hasSavedViewDrag = useCallback((dataTransfer: DataTransfer): boolean => (
    Array.from(dataTransfer.types).includes(HOME_SAVED_VIEW_DRAG_MIME)
  ), []);

  const hasGroupingDrag = useCallback((dataTransfer: DataTransfer): boolean => (
    Array.from(dataTransfer.types).includes(HOME_SAVED_VIEW_GROUPING_DRAG_MIME)
  ), []);

  const getDropPlacement = useCallback((event: React.DragEvent<HTMLElement>): SavedViewDropPlacement => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY > bounds.top + bounds.height / 2 ? "after" : "before";
  }, []);

  const editor = editorOpen && typeof document !== "undefined" ? createPortal(
    <div ref={editorRef} style={savedViewEditorStyle(editorPosition)}>
      <div style={savedViewEditorHeaderStyle}>
        <input
          value={nameDraft}
          onChange={(event) => setNameDraft(event.target.value)}
          onBlur={commitNameDraft}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitNameDraft();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setNameDraft(selectedSetting.name);
            }
          }}
          style={savedViewNameInputStyle}
        />
        <button type="button" title="Close editor" style={savedViewEditorCloseStyle} onClick={() => { commitNameDraft(); setEditorOpen(false); }}>x</button>
      </div>
      <div style={savedViewGroupingStackStyle}>
        {selectedSetting.groupings.map((grouping, index) => {
          const dropPlacement = groupingDropTarget?.index === index ? groupingDropTarget.placement : null;
          return (
          <div
            key={`${grouping.field}:${index}`}
            draggable
            style={savedViewGroupingRowStyle(index, dropPlacement)}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData(HOME_SAVED_VIEW_GROUPING_DRAG_MIME, JSON.stringify({ settingID: selectedSetting.setting_id, index }));
              event.dataTransfer.setData("text/plain", grouping.field);
              setGroupingDropTarget(null);
              setAddGroupingMenuOpen(false);
            }}
            onDragEnd={() => setGroupingDropTarget(null)}
            onDragLeave={(event) => {
              const related = event.relatedTarget instanceof Node ? event.relatedTarget : null;
              if (related && event.currentTarget.contains(related)) return;
              setGroupingDropTarget((current) => current?.index === index ? null : current);
            }}
            onDragOver={(event) => {
              if (!hasGroupingDrag(event.dataTransfer)) return;
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = "move";
              setGroupingDropTarget({ index, placement: getDropPlacement(event) });
            }}
            onDrop={(event) => {
              const sourceIndex = readDraggedGroupingIndex(event.dataTransfer);
              if (sourceIndex < 0) return;
              event.preventDefault();
              event.stopPropagation();
              reorderSelectedGrouping(sourceIndex, index, getDropPlacement(event));
              setGroupingDropTarget(null);
            }}
          >
            <select
              value={grouping.field}
              style={savedViewFieldSelectStyle}
              onChange={(event) => {
                const field = event.target.value;
                updateSelectedSetting((setting) => ({
                  ...setting,
                  groupings: setting.groupings.map((item, itemIndex) => itemIndex === index ? { ...item, field } : item),
                }));
              }}
            >
              {groupingFields
                .filter((field) => field.value === grouping.field || !selectedSetting.groupings.some((item, itemIndex) => itemIndex !== index && item.field === field.value))
                .map((field) => (
                  <option key={field.value} value={field.value}>{field.label}</option>
                ))}
            </select>
            <button
              type="button"
              style={savedViewDirectionButtonStyle}
              onClick={() => updateSelectedSetting((setting) => ({
                ...setting,
                groupings: setting.groupings.map((item, itemIndex) => itemIndex === index ? { ...item, direction: item.direction === "asc" ? "desc" : "asc" } : item),
              }))}
            >
              {grouping.direction === "asc" ? "Asc" : "Desc"}
            </button>
            <button
              type="button"
              title="Remove grouping"
              style={savedViewRemoveButtonStyle}
              onClick={() => updateSelectedSetting((setting) => ({
                ...setting,
                groupings: setting.groupings.filter((_, itemIndex) => itemIndex !== index),
              }))}
            >
              x
            </button>
          </div>
          );
        })}
        <div style={savedViewAddGroupingShellStyle}>
          <button
            ref={addGroupingButtonRef}
            type="button"
            style={savedViewAddGroupingButtonStyle(surface, addableFields.length === 0)}
            disabled={addableFields.length === 0}
            onClick={() => {
              updateAddGroupingMenuPosition();
              setAddGroupingMenuOpen(true);
            }}
          >
            + Add grouping
          </button>
        </div>
      </div>
    </div>,
    document.body,
  ) : null;

  const addGroupingMenu = editorOpen && addGroupingMenuOpen && addableFields.length > 0 && typeof document !== "undefined" ? createPortal(
    <div ref={addGroupingMenuRef} style={savedViewAddGroupingMenuStyle(addGroupingMenuPosition)}>
      {addableFields.map((field) => (
        <button
          key={field.value}
          type="button"
          style={savedViewAddGroupingMenuOptionStyle}
          onClick={() => {
            updateSelectedSetting((setting) => ({ ...setting, groupings: [...setting.groupings, { field: field.value, direction: "asc" }] }));
            setAddGroupingMenuOpen(false);
          }}
        >
          {field.label}
        </button>
      ))}
    </div>,
    document.body,
  ) : null;

  return (
    <div ref={panelRef} style={savedViewPanelStyle(active)}>
      <div style={savedViewListStyle}>
        {settings.map((item) => {
          const dropPlacement = savedViewDropTarget?.settingID === item.setting_id ? savedViewDropTarget.placement : null;
          return (
          <div
            key={item.setting_id}
            draggable
            style={savedViewRowShellStyle(item.setting_id === selectedSetting.setting_id, dropPlacement)}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData(HOME_SAVED_VIEW_DRAG_MIME, JSON.stringify({ surface, settingID: item.setting_id }));
              event.dataTransfer.setData("text/plain", item.name);
              setSavedViewDropTarget(null);
              setContextMenu(null);
            }}
            onDragEnd={() => setSavedViewDropTarget(null)}
            onDragLeave={(event) => {
              const related = event.relatedTarget instanceof Node ? event.relatedTarget : null;
              if (related && event.currentTarget.contains(related)) return;
              setSavedViewDropTarget((current) => current?.settingID === item.setting_id ? null : current);
            }}
            onDragOver={(event) => {
              if (!hasSavedViewDrag(event.dataTransfer)) return;
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = "move";
              setSavedViewDropTarget({ settingID: item.setting_id, placement: getDropPlacement(event) });
            }}
            onDrop={(event) => {
              const sourceSettingID = readDraggedSavedViewID(event.dataTransfer);
              if (!sourceSettingID) return;
              event.preventDefault();
              event.stopPropagation();
              reorderSavedView(sourceSettingID, item.setting_id, getDropPlacement(event));
              setSavedViewDropTarget(null);
            }}
          >
            <button
              type="button"
              style={savedViewRowButtonStyle}
              onClick={() => selectSetting(item.setting_id, true)}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setContextMenu({ settingID: item.setting_id, x: event.clientX, y: event.clientY });
              }}
            >
              <span style={savedViewNameStyle}>{item.name}</span>
            </button>
            <button
              type="button"
              title="View settings"
              aria-label={`${item.name} settings`}
              style={savedViewSettingsButtonStyle}
              onClick={(event) => {
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                setContextMenu({ settingID: item.setting_id, x: rect.right, y: rect.bottom + 4 });
              }}
            >
              ...
            </button>
          </div>
          );
        })}
      </div>
      <button
        type="button"
        style={savedViewAddButtonStyle(surface, addButtonRaised)}
        onPointerEnter={() => setAddButtonRaised(true)}
        onPointerLeave={() => setAddButtonRaised(false)}
        onFocus={() => setAddButtonRaised(true)}
        onBlur={() => setAddButtonRaised(false)}
        onClick={addSavedView}
      >
        + Add new
      </button>
      {error && <div style={savedViewErrorStyle}>{error}</div>}
      {contextMenu && contextSetting && (
        <FrameRightClickMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)} width={118} minWidth={118} maxWidth={118}>
          <button type="button" style={savedViewContextMenuButtonStyle} onClick={() => { selectSetting(contextSetting.setting_id); setContextMenu(null); setEditorOpen(true); }}>
            Edit
          </button>
          <button type="button" style={savedViewContextMenuButtonStyle} onClick={() => { renameSavedView(contextSetting.setting_id); setContextMenu(null); }}>
            Rename
          </button>
          <button
            type="button"
            style={{ ...savedViewContextMenuButtonStyle, color: "#dc2626" }}
            onClick={() => deleteSavedView(contextSetting.setting_id)}
          >
            Delete
          </button>
        </FrameRightClickMenu>
      )}
      {editor}
      {addGroupingMenu}
    </div>
  );
}

function emitHomeSavedViewsChanged(surface: HomeSavedViewsSurface, settingID: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT_HOME_SAVED_VIEWS_CHANGED, {
    detail: { surface, settingID: settingID.trim() },
  }));
}

function savedViewStorageKey(surface: HomeSavedViewsSurface, companyID: string, userID: string): string {
  const prefix = surface === "my_work" ? MY_WORK_SELECTED_VIEW_STORAGE_KEY : UPDATES_SELECTED_VIEW_STORAGE_KEY;
  const cleanCompanyID = companyID.trim();
  const cleanUserID = userID.trim();
  return cleanCompanyID && cleanUserID ? `${prefix}:${cleanCompanyID}:${cleanUserID}` : prefix;
}

function readSelectedSavedViewID(surface: HomeSavedViewsSurface, companyID: string, userID: string): string {
  try {
    return localStorage.getItem(savedViewStorageKey(surface, companyID, userID))?.trim() ?? "";
  } catch {
    return "";
  }
}

function storeSelectedSavedViewID(surface: HomeSavedViewsSurface, companyID: string, userID: string, settingID: string): void {
  const cleanSettingID = settingID.trim();
  if (!cleanSettingID) return;
  try {
    localStorage.setItem(savedViewStorageKey(surface, companyID, userID), cleanSettingID);
  } catch {}
}

function clearSelectedSavedViewID(surface: HomeSavedViewsSurface, companyID: string, userID: string): void {
  try {
    localStorage.removeItem(savedViewStorageKey(surface, companyID, userID));
  } catch {}
}

function homeSavedViewGroupingFields(surface: HomeSavedViewsSurface): ReadonlyArray<{ value: string; label: string }> {
  return surface === "my_work" ? MY_WORK_GROUPING_FIELDS : UPDATE_GROUPING_FIELDS;
}

function defaultGroupings(surface: HomeSavedViewsSurface): SavedViewGrouping[] {
  return surface === "my_work"
    ? DEFAULT_MY_WORK_GROUPINGS.map((item) => ({ field: item.field, direction: item.direction }))
    : DEFAULT_UPDATE_GROUPINGS.map((item) => ({ field: item.field, direction: item.direction }));
}

function normalizeHomeSavedGroupingStack(surface: HomeSavedViewsSurface, value: unknown): SavedViewGrouping[] {
  if (surface === "my_work") {
    return normalizeMyWorkGroupingStack(value).map((item) => ({ field: item.field, direction: item.direction }));
  }
  return normalizeUpdateGroupingStack(value).map((item) => ({ field: item.field, direction: item.direction }));
}

function createDefaultSavedView(surface: HomeSavedViewsSurface, companyID: string, currentUserID: string): HomeSavedGroupingSetting {
  const now = new Date().toISOString();
  return {
    setting_id: createSavedViewID(),
    company_id: companyID.trim(),
    user_id: currentUserID.trim(),
    surface,
    principal: "user",
    principal_id: currentUserID.trim(),
    name: surface === "my_work" ? "Project" : "Updates",
    groupings: defaultGroupings(surface),
    position: 1000,
    created_timestamp: now,
    updated_timestamp: now,
  };
}

function savedViewToSetting(
  view: SavedView,
  fallback: HomeSavedGroupingSetting,
  surface: HomeSavedViewsSurface,
  currentUserID: string,
): HomeSavedGroupingSetting {
  return {
    setting_id: view.saved_view_id.trim() || fallback.setting_id,
    company_id: view.company_id.trim() || fallback.company_id,
    user_id: currentUserID.trim(),
    surface,
    principal: view.principal === "group" ? "group" : "user",
    principal_id: view.principal_id.trim() || fallback.principal_id,
    name: view.name.trim() || fallback.name,
    groupings: normalizeHomeSavedGroupingStack(surface, view.groupings),
    position: Number.isFinite(view.position) ? view.position : fallback.position,
    created_timestamp: view.created_timestamp || fallback.created_timestamp,
    updated_timestamp: view.updated_timestamp || fallback.updated_timestamp,
  };
}

function settingToSavedViewInput(setting: HomeSavedGroupingSetting, companyID: string, currentUserID: string) {
  return {
    company_id: companyID.trim(),
    saved_view_id: setting.setting_id,
    surface: setting.surface,
    principal: setting.principal,
    principal_id: (setting.principal === "group" ? setting.principal_id : currentUserID).trim(),
    name: setting.name,
    groupings: normalizeHomeSavedGroupingStack(setting.surface, setting.groupings),
    position: setting.position,
  };
}

function nextSavedViewPosition(settings: HomeSavedGroupingSetting[]): number {
  return Math.max(0, ...settings.map((setting) => Number.isFinite(setting.position) ? setting.position : 0)) + 1000;
}

function savedViewErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message.trim() : fallback;
}

const savedViewPanelStyle = (active: boolean): React.CSSProperties => ({
  minWidth: 0,
  display: "grid",
  alignContent: "start",
  gap: 4,
  padding: "0 8px 3px 28px",
  opacity: active ? 1 : 0.94,
});

const savedViewListStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  alignContent: "start",
  gap: 5,
};

function savedViewRowShellStyle(active: boolean, dropPlacement: SavedViewDropPlacement | null): React.CSSProperties {
  const surface = active
    ? "linear-gradient(145deg, #ffffff 0%, #f8fbff 100%)"
    : "linear-gradient(145deg, #ffffff 0%, #f7f8fb 100%)";
  const dropShadow = dropPlacement === "before"
    ? "inset 0 2px 0 #00a3ff"
    : dropPlacement === "after"
      ? "inset 0 -2px 0 #00a3ff"
      : "";
  return {
    minWidth: 0,
    minHeight: 27,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 28px",
    alignItems: "center",
    border: active ? "1px solid transparent" : "1px solid rgba(255, 255, 255, 0.78)",
    borderRadius: 8,
    background: active
      ? `${surface} padding-box, linear-gradient(135deg, rgba(56, 189, 248, 0.92), rgba(139, 92, 246, 0.78), rgba(20, 184, 166, 0.84)) border-box`
      : surface,
    boxShadow: [
      active
        ? "7px 7px 16px rgba(174, 174, 192, 0.30), -6px -6px 14px rgba(255, 255, 255, 0.92), inset 1px 1px 0 rgba(255, 255, 255, 0.92)"
        : "4px 4px 10px rgba(174, 174, 192, 0.22), -4px -4px 10px rgba(255, 255, 255, 0.88), inset 1px 1px 0 rgba(255, 255, 255, 0.90)",
      dropShadow,
    ].filter(Boolean).join(", "),
    cursor: "grab",
    overflow: "hidden",
  };
}

const savedViewRowButtonStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 25,
  border: "none",
  background: "transparent",
  color: "#111827",
  cursor: "pointer",
  font: "inherit",
  padding: "0 7px",
  textAlign: "left",
};

const savedViewNameStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  display: "block",
  fontSize: 11,
  fontWeight: 760,
};

const savedViewSettingsButtonStyle: React.CSSProperties = {
  width: 28,
  height: 25,
  border: "none",
  borderLeft: "1px solid rgba(148, 163, 184, 0.16)",
  background: "rgba(255, 255, 255, 0.72)",
  color: "#475569",
  cursor: "pointer",
  font: "inherit",
  fontSize: 11,
  fontWeight: 900,
  padding: 0,
};

function savedViewAddButtonStyle(surface: HomeSavedViewsSurface, raised: boolean): React.CSSProperties {
  const accent = savedViewSurfaceAccent(surface);
  return {
    width: "100%",
    minHeight: 26,
    border: `1px solid ${raised ? "transparent" : colorWithAlpha(accent.strong, 0.20)}`,
    borderRadius: 8,
    background: raised
      ? `linear-gradient(145deg, rgba(255, 255, 255, 0.96), ${accent.soft}) padding-box, ${accent.frame} border-box`
      : `linear-gradient(145deg, #ffffff 0%, ${accent.faint} 100%)`,
    color: accent.text,
    cursor: "pointer",
    font: "inherit",
    fontSize: 11,
    fontWeight: 840,
    padding: "0 8px",
    boxShadow: raised
      ? `${accent.glow}, 6px 6px 14px rgba(174, 174, 192, 0.24), -5px -5px 13px rgba(255, 255, 255, 0.90), inset 1px 1px 0 rgba(255, 255, 255, 0.92)`
      : "4px 4px 10px rgba(174, 174, 192, 0.20), -4px -4px 10px rgba(255, 255, 255, 0.88), inset 1px 1px 0 rgba(255, 255, 255, 0.9)",
    transition: "background 140ms ease, border-color 140ms ease, box-shadow 160ms ease, color 140ms ease",
  };
}

const savedViewErrorStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#dc2626",
  fontSize: 10,
  fontWeight: 700,
};

function savedViewEditorStyle(position: { left: number; top: number }): React.CSSProperties {
  return {
    position: "fixed",
    zIndex: 130,
    top: position.top,
    left: position.left,
    width: `min(${HOME_SAVED_VIEW_EDITOR_WIDTH}px, calc(100vw - 96px))`,
    maxHeight: "none",
    overflow: "visible",
    display: "grid",
    gap: 10,
    minWidth: 0,
    border: "1px solid rgba(255, 255, 255, 0.74)",
    borderRadius: 12,
    background: "linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.94))",
    boxShadow: "14px 14px 32px rgba(148, 163, 184, 0.24), -9px -9px 24px rgba(255, 255, 255, 0.88), inset 1px 1px 0 rgba(255, 255, 255, 0.94)",
    backdropFilter: "blur(18px) saturate(1.14)",
    padding: 10,
  };
}

const savedViewEditorHeaderStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 26px",
  alignItems: "center",
  gap: 8,
};

const savedViewNameInputStyle: React.CSSProperties = {
  minWidth: 0,
  height: 28,
  border: "1px solid rgba(148, 163, 184, 0.18)",
  borderRadius: 8,
  background: "#ffffff",
  color: "#0f172a",
  font: "inherit",
  fontSize: 12,
  fontWeight: 850,
  padding: "0 8px",
  boxShadow: "inset 2px 2px 5px rgba(174, 174, 192, 0.16), inset -2px -2px 5px rgba(255, 255, 255, 0.94)",
};

const savedViewEditorCloseStyle: React.CSSProperties = {
  width: 26,
  height: 24,
  border: "1px solid rgba(148, 163, 184, 0.18)",
  borderRadius: 7,
  background: "#ffffff",
  color: "#64748b",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 900,
  padding: 0,
};

const savedViewGroupingStackStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: "100%",
  minWidth: 0,
  display: "grid",
  alignContent: "start",
  gap: 6,
};

function savedViewGroupingRowStyle(index: number, dropPlacement: SavedViewDropPlacement | null): React.CSSProperties {
  const accent = ["#00a3ff", "#ff8a00", "#8b5cf6", "#14b8a6", "#f43f5e"][index % 5] ?? "#475569";
  const indent = Math.min(index * 12, 30);
  const dropShadow = dropPlacement === "before"
    ? "inset 0 2px 0 #00a3ff"
    : dropPlacement === "after"
      ? "inset 0 -2px 0 #00a3ff"
      : "";
  return {
    position: "relative",
    width: `calc(100% - ${indent}px)`,
    minWidth: 0,
    minHeight: 30,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 50px 22px",
    alignItems: "center",
    gap: 5,
    marginLeft: indent,
    border: `1px solid ${colorWithAlpha(accent, 0.44)}`,
    borderRadius: 8,
    background: `linear-gradient(145deg, rgba(255,255,255,0.98), ${colorWithAlpha(accent, 0.18)})`,
    boxShadow: [
      `4px 4px 12px rgba(148, 163, 184, 0.14), -3px -3px 10px rgba(255, 255, 255, 0.78), 0 0 0 1px ${colorWithAlpha(accent, 0.08)}, inset 1px 1px 0 rgba(255, 255, 255, 0.90)`,
      dropShadow,
    ].filter(Boolean).join(", "),
    cursor: "grab",
    padding: "0 4px 0 7px",
    boxSizing: "border-box",
  };
}

const savedViewFieldSelectStyle: React.CSSProperties = {
  minWidth: 0,
  height: 24,
  border: "none",
  borderRadius: 4,
  background: "transparent",
  color: "#111827",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 800,
  padding: "0 4px",
};

const savedViewDirectionButtonStyle: React.CSSProperties = {
  height: 22,
  border: "1px solid rgba(37, 99, 235, 0.30)",
  borderRadius: 6,
  background: "linear-gradient(145deg, #ffffff, #eff6ff)",
  color: "#1d4ed8",
  cursor: "pointer",
  font: "inherit",
  fontSize: 10,
  fontWeight: 820,
  padding: 0,
};

const savedViewRemoveButtonStyle: React.CSSProperties = {
  height: 22,
  border: "none",
  background: "transparent",
  color: "#64748b",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 900,
  padding: 0,
};

const savedViewAddGroupingShellStyle: React.CSSProperties = {
  position: "relative",
  width: "100%",
  minWidth: 0,
};

function savedViewAddGroupingButtonStyle(surface: HomeSavedViewsSurface, disabled: boolean): React.CSSProperties {
  const accent = savedViewSurfaceAccent(surface);
  return {
    width: "100%",
    minHeight: 28,
    border: `1px solid ${disabled ? "rgba(148, 163, 184, 0.30)" : colorWithAlpha(accent.strong, 0.52)}`,
    borderRadius: 8,
    background: disabled ? "rgba(226, 232, 240, 0.46)" : `linear-gradient(145deg, #ffffff, ${accent.soft})`,
    color: disabled ? "#94a3b8" : accent.text,
    cursor: disabled ? "default" : "pointer",
    font: "inherit",
    fontSize: 11,
    fontWeight: 820,
    padding: "0 8px",
    boxShadow: disabled ? "none" : `${accent.glow}, 4px 4px 10px rgba(148, 163, 184, 0.14), -3px -3px 10px rgba(255, 255, 255, 0.80)`,
  };
}

function savedViewAddGroupingMenuStyle(position: { left: number; top: number; width: number }): React.CSSProperties {
  return {
    position: "fixed",
    left: position.left,
    top: position.top,
    zIndex: 132,
    width: position.width,
    display: "grid",
    gap: 3,
    padding: 6,
    border: "1px solid rgba(0, 163, 255, 0.26)",
    borderRadius: 9,
    background: "linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(240, 249, 255, 0.96))",
    boxShadow: "0 14px 30px rgba(15, 23, 42, 0.16), inset 1px 1px 0 rgba(255, 255, 255, 0.92)",
  };
}

const savedViewAddGroupingMenuOptionStyle: React.CSSProperties = {
  minHeight: 29,
  border: "none",
  borderRadius: 7,
  background: "transparent",
  color: "#0f172a",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 760,
  textAlign: "left",
  padding: "0 8px",
};

const savedViewContextMenuButtonStyle: React.CSSProperties = {
  minHeight: 30,
  border: "none",
  background: "transparent",
  color: "#111827",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 720,
  textAlign: "left",
  padding: "0 9px",
};

function savedViewSurfaceAccent(surface: HomeSavedViewsSurface): {
  strong: string;
  faint: string;
  soft: string;
  frame: string;
  text: string;
  glow: string;
} {
  if (surface === "updates") {
    return {
      strong: "#f59e0b",
      faint: "#fff7ed",
      soft: "rgba(255, 237, 213, 0.82)",
      frame: "linear-gradient(135deg, rgba(251, 146, 60, 0.96), rgba(251, 191, 36, 0.82), rgba(255, 255, 255, 0.90))",
      text: "#b45309",
      glow: "0 0 0 1px rgba(245, 158, 11, 0.18), 0 8px 20px rgba(245, 158, 11, 0.16)",
    };
  }
  return {
    strong: "#10b981",
    faint: "#ecfdf5",
    soft: "rgba(209, 250, 229, 0.82)",
    frame: "linear-gradient(135deg, rgba(16, 185, 129, 0.94), rgba(45, 212, 191, 0.78), rgba(255, 255, 255, 0.90))",
    text: "#047857",
    glow: "0 0 0 1px rgba(16, 185, 129, 0.18), 0 8px 20px rgba(16, 185, 129, 0.15)",
  };
}

function colorWithAlpha(color: string, alpha: number): string {
  const normalized = color.trim();
  if (!/^#[0-9a-f]{6}$/i.test(normalized)) return normalized;
  const red = parseInt(normalized.slice(1, 3), 16);
  const green = parseInt(normalized.slice(3, 5), 16);
  const blue = parseInt(normalized.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
