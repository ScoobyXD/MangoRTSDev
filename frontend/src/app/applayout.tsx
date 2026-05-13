import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { HeaderCommunicationsIcon, HeaderLogicGateArenaIcon, HeaderMapIcon } from "./HeaderIcons";
import type { CurrentUserResponse } from "../auth/cognitoAuth";
import FrameCanvas from "./framecanvas";
import FrameRightClickMenu from "./framerightclickmenu";
import { MangoWordmark } from "./MangoLogo";
import ModulePickerMenu from "./menus/ModulePickerMenu";
import { MODULE_LIBRARY as FRAME_MODULE_LIBRARY, preloadModuleKind } from "../modules";
import type { FrameDataModel, DragState } from "../types";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { emitDashboardEvent, EVENT_FRAME_LINK_GRAPH_UPDATED } from "../modules/node-map/eventbus";
import { buildLinkModulesLabel, buildLinkPool, computeLinkPlan, delinkForPool, mergeLinkPlan, type FrameLinkEdge } from "./frameLinking";
import { createCommunicationsViewFrames, createDefaultNodeViewFrames, createLogicGateArenaFrames } from "./DefaultViews";
import { FrameCard, GridCrosses, PlacementSplash } from "./FrameChrome";
import {
  CELL_SIZE,
  CHILD_EDGE_GAP,
  COLORWAYS,
  COLORWAY_ORDER,
  DEFAULT_COLORWAY,
  HEADER_H,
  UI_THEME,
  clamp,
  clampToRangeWithInset,
  createFrameId,
  createTabId,
  getPointer,
  hoverHandlers,
  menuBtnBase,
  type ColorwayKey,
  type DashboardSnapshot,
  type ViewTab,
} from "./frameLayoutTypes";
import { loadFrameLinks, loadSettings, loadViews, persistFrameLinks, persistFrameRegistry, saveSettings, saveViews } from "./useFramePersistence";
import { preloadCommunicationsSurface, preloadDefaultDashboardModules, preloadLogicGateArenaSurface, preloadVisibleFrameModules } from "./preloadDashboardModules";
import { LazyCommunicationsPage, LazyLogicGateArenaPage } from "../pages/lazyPages";
import { useFrameDragResize } from "./useFrameDragResize";

const DEFAULT_FRAME_KIND = FRAME_MODULE_LIBRARY[0]?.kind ?? "editor";
const fullPageFallback = <div aria-busy="true" style={{ width: "100%", height: "100%", background: "#ffffff" }} />;
const PAGE_EDGE_GAP = 10;
const PAGE_SURFACE_RADIUS = 16;

type PrimaryPage = "map" | "communications" | "logic-gate-arena";

function pageForTab(tab: ViewTab): PrimaryPage | null {
  if (tab.page === "communications") return "communications";
  if (tab.page === "logic-gate-arena") return "logic-gate-arena";
  if (!tab.page && /^(map|default node view|default map view)$/i.test(tab.name.trim())) return "map";
  return null;
}

function labelForTab(tab: ViewTab): string {
  const page = pageForTab(tab);
  if (page === "communications") return "Home";
  if (page === "logic-gate-arena") return "Logic Gate Arena";
  if (page === "map") return "Map";
  return tab.name;
}

function iconForTab(tab: ViewTab): React.ReactNode {
  const page = pageForTab(tab);
  if (page === "communications") return <HeaderCommunicationsIcon />;
  if (page === "logic-gate-arena") return <HeaderLogicGateArenaIcon />;
  if (page === "map") return <HeaderMapIcon />;
  return null;
}

function routeForPage(page: PrimaryPage): string {
  if (page === "communications") return "/home";
  if (page === "logic-gate-arena") return "/logic-gate-arena";
  return "/";
}

type AppProps = {
  accountChrome?: React.ReactNode;
  initialPage?: "map" | "communications" | "logic-gate-arena";
  me?: CurrentUserResponse;
  onNavigate?: (path: string) => void;
  overrideContent?: React.ReactNode;
};

const App: React.FC<AppProps> = ({ accountChrome, initialPage, me, onNavigate, overrideContent }) => {
  const loaded = useMemo(() => loadViews(), []);
  const [tabs, setTabs] = useState<ViewTab[]>(loaded.tabs);
  const [activeTabId, setActiveTabId] = useState<string>(loaded.activeId);
  const [movingTabId, setMovingTabId] = useState<string | null>(null);
  const [isDraggingTab, setIsDraggingTab] = useState(false);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const [selectedFrameIds, setSelectedFrameIds] = useState<Set<string>>(new Set());
  const [editMode, setEditMode] = useState(false);
  const initialSettingsRef = useRef(loadSettings());
  const [bgColor, setBgColor] = useState(() => initialSettingsRef.current.bgColor || UI_THEME.surface);
  const [crossColor, setCrossColor] = useState(() => initialSettingsRef.current.crossColor || UI_THEME.panel);
  const [headerBgColor, setHeaderBgColor] = useState(() => initialSettingsRef.current.headerBgColor || UI_THEME.surface);
  const [headerTextColor, setHeaderTextColor] = useState(() => initialSettingsRef.current.headerTextColor || UI_THEME.text);
  const [tabBgColor, setTabBgColor] = useState(() => initialSettingsRef.current.tabBgColor || "#ffffff");
  const [tabTextColor, setTabTextColor] = useState(() => initialSettingsRef.current.tabTextColor || UI_THEME.text);
  const [frameLinks, setFrameLinks] = useState<FrameLinkEdge[]>(() => {
    const loadedFrameIDs = new Set(loaded.tabs.flatMap((tab) => tab.frames.map((frame) => frame.id)));
    return loadFrameLinks().filter((edge) => loadedFrameIDs.has(edge.a) && loadedFrameIDs.has(edge.b));
  });
  const [viewSize, setViewSize] = useState({ w: window.innerWidth, h: window.innerHeight });

  const [frameRightClickMenu, setFrameRightClickMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [frameDeleteConfirmation, setFrameDeleteConfirmation] = useState<{ frameIDs: string[] } | null>(null);
  const [moduleTypeMenu, setModuleTypeMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [canvasMenu, setCanvasMenu] = useState<{ x: number; y: number; gridX: number; gridY: number } | null>(null);
  const [headerMenu, setHeaderMenu] = useState<{ x: number; y: number } | null>(null);
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; id: string } | null>(null);

  const dragRef = useRef<DragState | null>(null);
  const tabDragRef = useRef<{ id: string; startX: number; startY: number } | null>(null);
  const copiedFrameRef = useRef<FrameDataModel | null>(null);
  const undoStackRef = useRef<DashboardSnapshot[]>([]);
  const redoStackRef = useRef<DashboardSnapshot[]>([]);
  const lastSnapshotRef = useRef<DashboardSnapshot | null>(null);
  const restoringRef = useRef(false);
  const appliedInitialPageRef = useRef<PrimaryPage | null>(null);
  const lastFrameRegistrySignatureRef = useRef("");
  const frameLinkRevisionRef = useRef(0);

  const activeTab = useMemo(() => tabs.find((t) => t.id === activeTabId) ?? tabs[0], [tabs, activeTabId]);
  const frames = activeTab?.frames ?? [];
  const isLogicGateArenaView = activeTab?.page === "logic-gate-arena";
  const isCommunicationsView = activeTab?.page === "communications";
  const isFullPageView = isLogicGateArenaView || isCommunicationsView;
  const rootFrames = useMemo(() => frames.filter((frame) => !frame.parentId), [frames]);

  useEffect(() => {
    if (!initialPage || overrideContent) {
      appliedInitialPageRef.current = null;
      return;
    }
    if (appliedInitialPageRef.current === initialPage) return;
    appliedInitialPageRef.current = initialPage;

    const existing = tabs.find((tab) => pageForTab(tab) === initialPage);
    if (existing) {
      if (existing.id !== activeTabId) setActiveTabId(existing.id);
      return;
    }

    const id = createTabId();
    const nextTab: ViewTab = initialPage === "communications"
      ? { id, name: "Home", page: "communications", frames: createCommunicationsViewFrames() }
      : initialPage === "logic-gate-arena"
        ? { id, name: "Logic Gate Arena", page: "logic-gate-arena", frames: createLogicGateArenaFrames() }
        : { id, name: "Map", frames: createDefaultNodeViewFrames() };
    setTabs((previous) => [...previous, nextTab]);
    setActiveTabId(id);
  }, [activeTabId, initialPage, overrideContent, tabs]);
  useEffect(() => {
    if (isLogicGateArenaView) {
      preloadLogicGateArenaSurface();
      return;
    }
    if (isCommunicationsView) {
      preloadCommunicationsSurface();
      return;
    }
    preloadVisibleFrameModules(frames);
  }, [frames, isCommunicationsView, isLogicGateArenaView]);
  const childrenByParent = useMemo(() => {
    const grouped = new Map<string, FrameDataModel[]>();
    for (const frame of frames) {
      if (!frame.parentId) continue;
      const current = grouped.get(frame.parentId) ?? [];
      current.push(frame);
      grouped.set(frame.parentId, current);
    }
    return grouped;
  }, [frames]);

  useEffect(() => {
    if (!selectedFrameId) return;
    if (!frames.some((w) => w.id === selectedFrameId)) setSelectedFrameId(null);
  }, [frames, selectedFrameId]);
  useEffect(() => {
    const ids = new Set(frames.map((widget) => widget.id));
    setSelectedFrameIds((prev) => new Set(Array.from(prev).filter((id) => ids.has(id))));
  }, [frames]);

  const updateActiveFrames = useCallback((updater: (prev: FrameDataModel[]) => FrameDataModel[]) => {
    setTabs((prev) => prev.map((tab) => (tab.id === activeTabId ? { ...tab, frames: updater(tab.frames) } : tab)));
  }, [activeTabId]);
  useEffect(() => {
    const frameIDs = new Set(frames.map((frame) => frame.id));
    if (!frames.some((frame) => frame.parentId && !frameIDs.has(frame.parentId))) return;
    updateActiveFrames((previous) => previous.map((frame) => (frame.parentId && !frameIDs.has(frame.parentId) ? { ...frame, parentId: undefined } : frame)));
  }, [frames, updateActiveFrames]);

  const buildSnapshot = useCallback((): DashboardSnapshot => ({
    tabs,
    activeTabId,
    bgColor,
    crossColor,
    headerBgColor,
    headerTextColor,
    tabBgColor,
    tabTextColor,
  }), [tabs, activeTabId, bgColor, crossColor, headerBgColor, headerTextColor, tabBgColor, tabTextColor]);

  const applySnapshot = useCallback((snapshot: DashboardSnapshot) => {
    restoringRef.current = true;
    setTabs(snapshot.tabs);
    setActiveTabId(snapshot.activeTabId);
    setBgColor(snapshot.bgColor);
    setCrossColor(snapshot.crossColor);
    setHeaderBgColor(snapshot.headerBgColor);
    setHeaderTextColor(snapshot.headerTextColor);
    setTabBgColor(snapshot.tabBgColor);
    setTabTextColor(snapshot.tabTextColor);
    lastSnapshotRef.current = snapshot;
    setTimeout(() => { restoringRef.current = false; }, 0);
  }, []);

  useEffect(() => {
    const onResize = () => setViewSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => { saveViews(tabs, activeTabId); }, [tabs, activeTabId]);
  useEffect(() => { saveSettings({ bgColor, crossColor, headerBgColor, headerTextColor, tabBgColor, tabTextColor }); }, [bgColor, crossColor, headerBgColor, headerTextColor, tabBgColor, tabTextColor]);
  useEffect(() => {
    const snapshot = buildSnapshot();
    if (restoringRef.current) {
      lastSnapshotRef.current = snapshot;
      return;
    }
    const last = lastSnapshotRef.current;
    if (!last) {
      lastSnapshotRef.current = snapshot;
      return;
    }
    if (JSON.stringify(last) === JSON.stringify(snapshot)) return;
    undoStackRef.current.push(last);
    if (undoStackRef.current.length > 120) undoStackRef.current.shift();
    redoStackRef.current = [];
    lastSnapshotRef.current = snapshot;
  }, [buildSnapshot]);

  const canvasW = Math.max(1, viewSize.w - PAGE_EDGE_GAP * 2);
  const canvasH = Math.max(1, viewSize.h - HEADER_H - PAGE_EDGE_GAP);
  const gridCols = Math.max(1, Math.round(canvasW / CELL_SIZE));
  const gridRows = Math.max(1, Math.round(canvasH / CELL_SIZE));
  const stepX = canvasW / gridCols;
  const stepY = canvasH / gridRows;

  useEffect(() => {
    updateActiveFrames((previous) => {
      let changed = false;
      const byId = new Map(previous.map((frame) => [frame.id, frame]));
      const normalized = previous.map((frame) => {
        if (!frame.parentId) {
          const maxRootX = Math.max(0, gridCols - frame.w);
          const maxRootY = Math.max(0, gridRows - frame.h);
          const nextX = clamp(frame.x, 0, maxRootX);
          const nextY = clamp(frame.y, 0, maxRootY);
          if (nextX !== frame.x || nextY !== frame.y) {
            changed = true;
            return { ...frame, x: nextX, y: nextY };
          }
          return frame;
        }
        const parent = byId.get(frame.parentId);
        if (!parent) return frame;
        const maxChildX = Math.max(0, parent.w - frame.w);
        const maxChildY = Math.max(0, parent.h - frame.h);
        const nextX = clampToRangeWithInset(frame.x, 0, maxChildX, CHILD_EDGE_GAP);
        const nextY = clampToRangeWithInset(frame.y, 0, maxChildY, CHILD_EDGE_GAP);
        if (nextX !== frame.x || nextY !== frame.y) {
          changed = true;
          return { ...frame, x: nextX, y: nextY };
        }
        return frame;
      });
      return changed ? normalized : previous;
    });
  }, [gridCols, gridRows, updateActiveFrames]);

  const applyColorway = useCallback((frame: FrameDataModel, theme: ColorwayKey): FrameDataModel => {
    const swatch = COLORWAYS[theme];
    return { ...frame, theme, color: swatch.color, accent: swatch.accent };
  }, []);

  const addFrame = useCallback((kind = DEFAULT_FRAME_KIND, preferred?: { x: number; y: number }) => {
    preloadModuleKind(kind);
    const template = FRAME_MODULE_LIBRARY.find((item) => item.kind === kind) ?? FRAME_MODULE_LIBRARY[0];
    if (!template) return;
    const id = createFrameId();
    const theme = DEFAULT_COLORWAY;
    const nextX = preferred ? clamp(preferred.x, 0, Math.max(0, gridCols - template.defaultW)) : 1;
    const nextY = preferred ? clamp(preferred.y, 0, Math.max(0, gridRows - template.defaultH)) : 1;
    updateActiveFrames((prev) => [...prev, { id, kind, theme, x: nextX, y: nextY, w: template.defaultW, h: template.defaultH, title: template.label, color: COLORWAYS[theme].color, accent: COLORWAYS[theme].accent }]);
  }, [gridCols, gridRows, updateActiveFrames]);

  const duplicateFrame = useCallback((id: string) => {
    updateActiveFrames((prev) => {
      const src = prev.find((w) => w.id === id);
      if (!src) return prev;
      return [...prev, { ...src, id: createFrameId(), x: clamp(src.x + 2, 0, gridCols - src.w), y: clamp(src.y + 2, 0, gridRows - src.h) }];
    });
  }, [gridCols, gridRows, updateActiveFrames]);

  const closeMenus = useCallback(() => { setFrameRightClickMenu(null); setModuleTypeMenu(null); setCanvasMenu(null); setHeaderMenu(null); setTabMenu(null); }, []);

  const linkPool = useMemo(() => buildLinkPool({
    frames,
    selectedFrameIds,
    selectedFrameId,
    contextFrameId: frameRightClickMenu?.id ?? null,
  }), [frames, selectedFrameIds, selectedFrameId, frameRightClickMenu]);
  const linkPlan = useMemo(() => {
    return computeLinkPlan(linkPool);
  }, [linkPool]);

  const linkSelectedNodeModules = useCallback(() => {
    if (!linkPlan) return;
    setFrameLinks((previous) => mergeLinkPlan(previous, linkPlan));
  }, [linkPlan]);
  const delinkSelectedNodeModules = useCallback(() => {
    const result = delinkForPool(linkPool, frameLinks);
    if (!result.changed) return;
    setFrameLinks(result.nextEdges);
  }, [linkPool, frameLinks]);
  const linkModulesLabel = useMemo(() => {
    return buildLinkModulesLabel(linkPool, linkPlan);
  }, [linkPool, linkPlan]);
  const canDelinkModules = useMemo(() => delinkForPool(linkPool, frameLinks).changed, [linkPool, frameLinks]);
  const linkedFrameIDs = useMemo(() => {
    const ids = new Set<string>();
    const frameIDs = new Set(frames.map((frame) => frame.id));
    for (const edge of frameLinks) {
      if (!frameIDs.has(edge.a) || !frameIDs.has(edge.b)) continue;
      ids.add(edge.a);
      ids.add(edge.b);
    }
    return ids;
  }, [frameLinks, frames]);
  const frameInContextMenu = useMemo(() => {
    if (!frameRightClickMenu) return null;
    return frames.find((frame) => frame.id === frameRightClickMenu.id) ?? null;
  }, [frameRightClickMenu, frames]);
  const canAttachSelectedFrames = useMemo(() => {
    if (!frameInContextMenu || !selectedFrameIds.has(frameInContextMenu.id) || selectedFrameIds.size !== 2) return false;
    const otherID = Array.from(selectedFrameIds).find((id) => id !== frameInContextMenu.id);
    const parent = otherID ? frames.find((frame) => frame.id === otherID) : null;
    if (!parent || parent.parentId) return false;
    return !frames.some((frame) => frame.parentId === frameInContextMenu.id);
  }, [frameInContextMenu, frames, selectedFrameIds]);

  useEffect(() => {
    const frameIDs = new Set(tabs.flatMap((tab) => tab.frames.map((frame) => frame.id)));
    setFrameLinks((previous) => previous.filter((edge) => frameIDs.has(edge.a) && frameIDs.has(edge.b)));
  }, [tabs]);
  useEffect(() => {
    const groups: FrameDataModel[][] = [];
    for (const parent of frames.filter((frame) => !frame.parentId)) {
      const children = frames.filter((frame) => frame.parentId === parent.id);
      if (children.length === 0) continue;
      groups.push([parent, ...children]);
    }

    if (groups.length === 0) return;

    let nextLinks = frameLinks;
    let changed = false;

    for (const group of groups) {
      const merged = mergeLinkPlan(nextLinks, computeLinkPlan(group));
      if (merged.length !== nextLinks.length) changed = true;
      nextLinks = merged;
    }

    if (changed) setFrameLinks(nextLinks);
  }, [frames, frameLinks]);

  useEffect(() => {
    persistFrameLinks(frameLinks);
    frameLinkRevisionRef.current += 1;
    emitDashboardEvent(EVENT_FRAME_LINK_GRAPH_UPDATED, {
      revision: frameLinkRevisionRef.current,
      changedAt: Date.now(),
    });
  }, [frameLinks]);

  useEffect(() => {
    const registry = Object.fromEntries(frames.map((frame) => [frame.id, { kind: frame.kind }]));
    const signature = Object.entries(registry)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, item]) => `${id}:${item.kind}`)
      .join("|");
    if (signature === lastFrameRegistrySignatureRef.current) return;
    lastFrameRegistrySignatureRef.current = signature;
    persistFrameRegistry(registry);
    frameLinkRevisionRef.current += 1;
    emitDashboardEvent(EVENT_FRAME_LINK_GRAPH_UPDATED, {
      revision: frameLinkRevisionRef.current,
      changedAt: Date.now(),
    });
  }, [frames]);

  const confirmDeleteFrameSelection = useCallback((frameIDs: string[]) => {
    if (frameIDs.length === 0) return;
    // Keep IDs unique so the confirmation copy and delete result stay deterministic.
    const uniqueFrameIDs = Array.from(new Set(frameIDs));
    setFrameDeleteConfirmation({ frameIDs: uniqueFrameIDs });
  }, []);

  const attachSelectedFrames = useCallback(() => {
    if (!frameInContextMenu || !selectedFrameIds.has(frameInContextMenu.id) || selectedFrameIds.size !== 2) return;
    const childID = frameInContextMenu.id;
    const parentID = Array.from(selectedFrameIds).find((id) => id !== childID) ?? "";
    updateActiveFrames((previous) => {
      const child = previous.find((frame) => frame.id === childID);
      const parent = previous.find((frame) => frame.id === parentID);
      if (!child || !parent || parent.parentId) return previous;
      if (previous.some((frame) => frame.parentId === child.id)) return previous;
      const oldParent = child.parentId ? previous.find((frame) => frame.id === child.parentId) : null;
      const childAbsoluteX = oldParent ? oldParent.x + child.x : child.x;
      const childAbsoluteY = oldParent ? oldParent.y + child.y : child.y;
      const childX = clampToRangeWithInset(childAbsoluteX - parent.x, 0, Math.max(0, parent.w - child.w), CHILD_EDGE_GAP);
      const childY = clampToRangeWithInset(childAbsoluteY - parent.y, 0, Math.max(0, parent.h - child.h), CHILD_EDGE_GAP);
      return previous.map((frame) => (frame.id === childID ? { ...frame, parentId: parentID, x: childX, y: childY } : frame));
    });
    setSelectedFrameId(childID);
    setSelectedFrameIds(new Set([childID]));
  }, [frameInContextMenu, selectedFrameIds, updateActiveFrames]);

  const deleteSelectedFrame = useCallback(() => {
    const ids = selectedFrameIds.size > 0 ? selectedFrameIds : (selectedFrameId ? new Set([selectedFrameId]) : new Set<string>());
    if (ids.size === 0) return;
    confirmDeleteFrameSelection(Array.from(ids));
  }, [confirmDeleteFrameSelection, selectedFrameId, selectedFrameIds]);

  const applyConfirmedFrameDelete = useCallback((frameIDs: string[]) => {
    if (frameIDs.length === 0) return;
    const frameIDSet = new Set(frameIDs);
    updateActiveFrames((prev) => prev.filter((frame) => !frameIDSet.has(frame.id)));
    setSelectedFrameId(null);
    setSelectedFrameIds(new Set());
  }, [updateActiveFrames]);

  const copySelectedFrame = useCallback(() => {
    if (!selectedFrameId) return;
    const target = frames.find((w) => w.id === selectedFrameId);
    if (!target) return;
    copiedFrameRef.current = { ...target };
  }, [selectedFrameId, frames]);

  const pasteFrame = useCallback(() => {
    const copied = copiedFrameRef.current;
    if (!copied) return;
    const id = createFrameId();
    const pasted: FrameDataModel = {
      ...copied,
      id,
      x: clamp(copied.x + 2, 0, gridCols - copied.w),
      y: clamp(copied.y + 2, 0, gridRows - copied.h),
    };
    updateActiveFrames((prev) => [...prev, pasted]);
    setSelectedFrameId(id);
    setSelectedFrameIds(new Set([id]));
  }, [gridCols, gridRows, updateActiveFrames]);

  const undo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const current = buildSnapshot();
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    redoStackRef.current.push(current);
    applySnapshot(previous);
  }, [applySnapshot, buildSnapshot]);

  const redo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const current = buildSnapshot();
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push(current);
    applySnapshot(next);
  }, [applySnapshot, buildSnapshot]);

  useKeyboardShortcuts({
    deleteSelection: deleteSelectedFrame,
    copySelection: copySelectedFrame,
    pasteSelection: pasteFrame,
    undo,
    redo,
  });

  const addTab = useCallback(() => {
    const id = createTabId();
    const newTab: ViewTab = { id, name: `View ${tabs.length + 1}`, frames: [] };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(id);
    setEditMode(true);
  }, [tabs.length]);

  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState("");

  const startRenamingTab = useCallback((id: string) => {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    setRenamingTabId(id);
    setRenamingValue(tab.name);
  }, [tabs]);

  const commitRenameTab = useCallback(() => {
    if (!renamingTabId) return;
    const next = renamingValue.trim();
    if (next) {
      setTabs((prev) => prev.map((t) => (t.id === renamingTabId ? { ...t, name: next } : t)));
    }
    setRenamingTabId(null);
    setRenamingValue("");
  }, [renamingTabId, renamingValue]);

  const cancelRenameTab = useCallback(() => {
    setRenamingTabId(null);
    setRenamingValue("");
  }, []);

  const deleteTab = useCallback((id: string) => {
    if (tabs.length === 1) return;
    setTabs((prev) => {
      const filtered = prev.filter((t) => t.id !== id);
      if (activeTabId === id && filtered[0]) setActiveTabId(filtered[0].id);
      return filtered;
    });
  }, [tabs.length, activeTabId]);


  const openDefaultNodeView = useCallback((tabID: string) => {
    preloadDefaultDashboardModules();
    const framesForView = createDefaultNodeViewFrames();
    const replacedFrameIDs = new Set(tabs.find((tab) => tab.id === tabID)?.frames.map((frame) => frame.id) ?? []);
    setTabs((previous) => previous.map((tab) => (tab.id === tabID ? { ...tab, name: "Map", page: undefined, frames: framesForView } : tab)));
    setFrameLinks((previous) => mergeLinkPlan(previous.filter((edge) => !replacedFrameIDs.has(edge.a) && !replacedFrameIDs.has(edge.b)), computeLinkPlan(framesForView)));
    setActiveTabId(tabID);
    setEditMode(true);
  }, [tabs]);

  const openLogicGateArena = useCallback((tabID: string) => {
    preloadLogicGateArenaSurface();
    const framesForView = createLogicGateArenaFrames();
    const replacedFrameIDs = new Set(tabs.find((tab) => tab.id === tabID)?.frames.map((frame) => frame.id) ?? []);
    setTabs((previous) => previous.map((tab) => (tab.id === tabID ? { ...tab, name: "Logic Gate Arena", page: "logic-gate-arena", frames: framesForView } : tab)));
    setFrameLinks((previous) => mergeLinkPlan(previous.filter((edge) => !replacedFrameIDs.has(edge.a) && !replacedFrameIDs.has(edge.b)), computeLinkPlan(framesForView)));
    setActiveTabId(tabID);
    setEditMode(false);
  }, [tabs]);

  const openCommunicationsView = useCallback((tabID: string) => {
    preloadCommunicationsSurface();
    const framesForView = createCommunicationsViewFrames();
    const replacedFrameIDs = new Set(tabs.find((tab) => tab.id === tabID)?.frames.map((frame) => frame.id) ?? []);
    setTabs((previous) => previous.map((tab) => (tab.id === tabID ? { ...tab, name: "Home", page: "communications", frames: framesForView } : tab)));
    setFrameLinks((previous) => previous.filter((edge) => !replacedFrameIDs.has(edge.a) && !replacedFrameIDs.has(edge.b)));
    setActiveTabId(tabID);
    setEditMode(false);
  }, [tabs]);

  const saveCurrentAsTemplate = useCallback((tabID: string) => {
    const source = tabs.find((tab) => tab.id === tabID);
    if (!source) return;
    const id = createTabId();
    const frameIDMap = new Map(source.frames.map((frame) => [frame.id, createFrameId()]));
    const templateTab: ViewTab = {
      id,
      name: `${source.name} Template`,
      page: source.page,
      frames: source.frames.map((frame) => ({
        ...frame,
        id: frameIDMap.get(frame.id) ?? createFrameId(),
        parentId: frame.parentId ? frameIDMap.get(frame.parentId) : undefined,
      })),
    };
    setTabs((previous) => [...previous, templateTab]);
    setActiveTabId(id);
  }, [tabs]);



  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = tabDragRef.current;
      if (!drag || isDraggingTab) return;
      const moved = Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY);
      if (moved > 4) setIsDraggingTab(true);
    };
    const onUp = () => {
      tabDragRef.current = null;
      setMovingTabId(null);
      setIsDraggingTab(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isDraggingTab]);
  useFrameDragResize({
    dragRef,
    gridCols,
    gridRows,
    stepX,
    stepY,
    updateActiveFrames,
    setDraggingId,
  });

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: "var(--mango-gradient)" }}>
      <style>{`
        @keyframes frame-edge-bump-x {
          0% { opacity: 0.75; transform: scaleX(1); }
          100% { opacity: 0; transform: scaleX(0.18); }
        }
        @keyframes frame-edge-bump-y {
          0% { opacity: 0.75; transform: scaleY(1); }
          100% { opacity: 0; transform: scaleY(0.18); }
        }
      `}</style>
      <header
        style={{ height: HEADER_H, padding: "6px 14px", display: "flex", alignItems: "center", background: "transparent", borderBottom: "none", boxShadow: "none" }}
        onContextMenu={(e) => { e.preventDefault(); setHeaderMenu({ x: e.clientX, y: e.clientY }); setCanvasMenu(null); setFrameRightClickMenu(null); setModuleTypeMenu(null); }}
      >
        <div style={{ width: "100%", minWidth: 0, height: 36, display: "grid", gridTemplateColumns: "auto minmax(180px, 1fr) auto", alignItems: "center", gap: 12, padding: "0 12px", borderRadius: 999, background: headerBgColor || UI_THEME.surface, boxShadow: "0 8px 20px rgba(15, 23, 42, 0.10), inset 0 0 0 1px rgba(15, 23, 42, 0.08)" }}>
          <div style={{ display: "flex", alignItems: "center", minWidth: 0, height: "100%" }}>
            <h1 style={{ margin: 0, height: "100%", display: "flex", alignItems: "center", lineHeight: 0, fontSize: 0 }}><MangoWordmark size={20} weight={500} /></h1>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 4, justifySelf: "center", minWidth: 0, maxWidth: "100%", overflowX: "auto", padding: "2px 0", scrollbarWidth: "none" }}>
            {tabs.map((tab) => {
              const selected = activeTabId === tab.id;
              const tabIcon = iconForTab(tab);
              return (
                <button
                  key={tab.id}
                  onMouseDown={(e) => {
                    if (e.button !== 0) return;
                    if ((e.target as HTMLElement).tagName === "INPUT") return;
                    tabDragRef.current = { id: tab.id, startX: e.clientX, startY: e.clientY };
                    setMovingTabId(tab.id);
                    setActiveTabId(tab.id);
                    setEditMode(false);
                  }}
                  onMouseEnter={() => {
                    if (!isDraggingTab || !movingTabId || movingTabId === tab.id) return;
                    setTabs((prev) => {
                      const list = [...prev];
                      const from = list.findIndex((t) => t.id === movingTabId);
                      const to = list.findIndex((t) => t.id === tab.id);
                      if (from < 0 || to < 0) return prev;
                      const [item] = list.splice(from, 1);
                      list.splice(to, 0, item);
                      return list;
                    });
                  }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setTabMenu({ x: e.clientX, y: e.clientY, id: tab.id }); }}
                  onDoubleClick={() => startRenamingTab(tab.id)}
                  onClick={(e) => {
                    if (e.button !== 0 || isDraggingTab) return;
                    const nextPage = pageForTab(tab) ?? "map";
                    setActiveTabId(tab.id);
                    setEditMode(false);
                    if (onNavigate) {
                      saveViews(tabs, tab.id);
                      onNavigate(routeForPage(nextPage));
                    }
                  }}
                  style={{ height: 28, display: "inline-flex", alignItems: "center", gap: 6, padding: "0 12px", border: selected ? "1px solid rgba(255, 136, 32, 0.22)" : "1px solid transparent", background: selected ? "rgba(255, 136, 32, 0.13)" : "transparent", color: selected ? "#ff8820" : "#60646c", borderRadius: 999, fontSize: 12, fontWeight: 500, letterSpacing: 0, cursor: "pointer", whiteSpace: "nowrap", transition: "transform 120ms ease, opacity 120ms ease, background 120ms ease", opacity: movingTabId === tab.id ? 0.8 : 1, transform: movingTabId === tab.id ? "translateY(-1px)" : "translateY(0px)" }}
                >
                  {renamingTabId === tab.id ? (
                    <input
                      autoFocus
                      value={renamingValue}
                      onChange={(e) => setRenamingValue(e.target.value)}
                      onBlur={commitRenameTab}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRenameTab();
                        if (e.key === "Escape") cancelRenameTab();
                      }}
                      onClick={(e) => e.stopPropagation()}
                      style={{ width: 92, border: "1px solid rgba(255, 136, 32, 0.24)", background: "#fff", borderRadius: 999, padding: "2px 8px", fontSize: 11, fontWeight: 500 }}
                    />
                  ) : (
                    <>
                      {tabIcon}
                      <span>{labelForTab(tab)}</span>
                    </>
                  )}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", alignItems: "center", justifySelf: "end", minWidth: 0, overflow: "hidden" }}>
            {accountChrome}
          </div>
        </div>
      </header>

      {overrideContent ? (
        <main
          style={{
            position: "relative",
            width: canvasW,
            height: canvasH,
            margin: `0 ${PAGE_EDGE_GAP}px ${PAGE_EDGE_GAP}px`,
            overflow: "auto",
            background: "#ffffff",
            borderRadius: PAGE_SURFACE_RADIUS,
            boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.58), 0 10px 24px rgba(132, 51, 0, 0.18)",
          }}
        >
          {overrideContent}
        </main>
      ) : (
      <FrameCanvas
        style={{
          position: "relative",
          width: canvasW,
          height: canvasH,
          margin: `0 ${PAGE_EDGE_GAP}px ${PAGE_EDGE_GAP}px`,
          overflow: "hidden",
          background: bgColor || UI_THEME.surface,
          borderRadius: PAGE_SURFACE_RADIUS,
          boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.58), 0 10px 24px rgba(132, 51, 0, 0.18)",
        }}
        onClick={isFullPageView ? undefined : () => { setSelectedFrameId(null); setSelectedFrameIds(new Set()); }}
        onContextMenu={isFullPageView ? (e) => e.preventDefault() : (e) => {
          e.preventDefault();
          const bounds = e.currentTarget.getBoundingClientRect();
          setCanvasMenu({
            x: e.clientX,
            y: e.clientY,
            gridX: clamp(Math.floor((e.clientX - bounds.left) / stepX), 0, gridCols - 1),
            gridY: clamp(Math.floor((e.clientY - bounds.top) / stepY), 0, gridRows - 1),
          });
          setHeaderMenu(null);
          setFrameRightClickMenu(null);
          setModuleTypeMenu(null);
        }}
      >
        {isLogicGateArenaView ? (
          <React.Suspense fallback={fullPageFallback}><LazyLogicGateArenaPage frames={frames} updateFrames={updateActiveFrames} /></React.Suspense>
        ) : isCommunicationsView ? (
          <React.Suspense fallback={fullPageFallback}><LazyCommunicationsPage embedded me={me} onNavigate={onNavigate} /></React.Suspense>
        ) : (
          <>
        <GridCrosses cols={gridCols} rows={gridRows} stepX={stepX} stepY={stepY} width={canvasW} height={canvasH} color={crossColor} />
        {editMode && draggingId && (() => {
          const activeFrame = frames.find((w) => w.id === draggingId);
          if (!activeFrame || activeFrame.parentId) return null;
          return <PlacementSplash frame={activeFrame} frames={frames} cols={gridCols} rows={gridRows} stepX={stepX} stepY={stepY} />;
        })()}
        {rootFrames.map((w) => (
          <React.Fragment key={w.id}>
            <FrameCard
              frame={w}
              stepX={stepX}
              stepY={stepY}
              isDragging={draggingId === w.id}
              isSelected={selectedFrameIds.has(w.id)}
              isLinked={linkedFrameIDs.has(w.id) || !!childrenByParent.get(w.id)?.length}
              edgeHit={{ left: w.x <= 0, right: w.x + w.w >= gridCols, top: w.y <= 0, bottom: w.y + w.h >= gridRows }}
              editMode={editMode}
              onDragStart={(e, id) => {
                e.preventDefault();
                const { px, py } = getPointer(e);
                const widget = frames.find((ww) => ww.id === id);
                if (!widget) return;
                dragRef.current = { id, parentId: widget.parentId, mode: "drag", edges: {}, startMouseX: px, startMouseY: py, origX: widget.x, origY: widget.y, origW: widget.w, origH: widget.h };
                setDraggingId(id);
              }}
              onResizeStart={(e, id, edges) => {
                e.preventDefault();
                const { px, py } = getPointer(e);
                const widget = frames.find((ww) => ww.id === id);
                if (!widget) return;
                dragRef.current = { id, parentId: widget.parentId, mode: "resize", edges, startMouseX: px, startMouseY: py, origX: widget.x, origY: widget.y, origW: widget.w, origH: widget.h };
                setDraggingId(id);
              }}
              onContextMenu={(e, id) => {
                e.preventDefault();
                if (!selectedFrameIds.has(id)) {
                  setSelectedFrameIds(new Set([id]));
                  setSelectedFrameId(id);
                }
                setFrameRightClickMenu({ x: e.clientX, y: e.clientY, id });
                setModuleTypeMenu(null);
                setCanvasMenu(null);
              }}
              onModuleNameClick={(e, id) => {
                setFrameRightClickMenu(null);
                setHeaderMenu(null);
                setCanvasMenu(null);
                setSelectedFrameId(id);
                setSelectedFrameIds(new Set([id]));
                setModuleTypeMenu({ x: e.clientX, y: e.clientY, id });
              }}
              onSelect={(event, id) => {
                const additiveSelect = "ctrlKey" in event ? (!!event.ctrlKey || !!event.shiftKey) : false;
                if (!additiveSelect) {
                  setSelectedFrameId(id);
                  setSelectedFrameIds(new Set([id]));
                  return;
                }
                setSelectedFrameId(id);
                setSelectedFrameIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  if (next.size === 0) next.add(id);
                  return next;
                });
              }}
              nestedChildren={(childrenByParent.get(w.id) ?? []).map((child) => (
                <FrameCard
                  key={child.id}
                  frame={child}
                  isChild={true}
                  stepX={stepX}
                  stepY={stepY}
                  isDragging={draggingId === child.id}
                  isSelected={selectedFrameIds.has(child.id)}
                  isLinked={true}
                  editMode={editMode}
                  onDragStart={(e, id) => {
                    e.preventDefault();
                    const { px, py } = getPointer(e);
                    const widget = frames.find((ww) => ww.id === id);
                    if (!widget) return;
                    dragRef.current = { id, parentId: widget.parentId, mode: "drag", edges: {}, startMouseX: px, startMouseY: py, origX: widget.x, origY: widget.y, origW: widget.w, origH: widget.h };
                    setDraggingId(id);
                  }}
                  onResizeStart={(e, id, edges) => {
                    e.preventDefault();
                    const { px, py } = getPointer(e);
                    const widget = frames.find((ww) => ww.id === id);
                    if (!widget) return;
                    dragRef.current = { id, parentId: widget.parentId, mode: "resize", edges, startMouseX: px, startMouseY: py, origX: widget.x, origY: widget.y, origW: widget.w, origH: widget.h };
                    setDraggingId(id);
                  }}
                  onContextMenu={(e, id) => {
                    e.preventDefault();
                    if (!selectedFrameIds.has(id)) {
                      setSelectedFrameIds(new Set([id]));
                      setSelectedFrameId(id);
                    }
                    setFrameRightClickMenu({ x: e.clientX, y: e.clientY, id });
                    setModuleTypeMenu(null);
                    setCanvasMenu(null);
                      }}
                  onModuleNameClick={(e, id) => {
                    setFrameRightClickMenu(null);
                    setHeaderMenu(null);
                    setCanvasMenu(null);
                        setSelectedFrameId(id);
                    setSelectedFrameIds(new Set([id]));
                    setModuleTypeMenu({ x: e.clientX, y: e.clientY, id });
                  }}
                  onSelect={(event, id) => {
                    const additiveSelect = "ctrlKey" in event ? (!!event.ctrlKey || !!event.shiftKey) : false;
                    if (!additiveSelect) {
                      setSelectedFrameId(id);
                      setSelectedFrameIds(new Set([id]));
                      return;
                    }
                    setSelectedFrameId(id);
                    setSelectedFrameIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      if (next.size === 0) next.add(id);
                      return next;
                    });
                  }}
                />
              ))}
            />
          </React.Fragment>
        ))}
          </>
        )}
      </FrameCanvas>
      )}

      {tabMenu && (
        <FrameRightClickMenu x={tabMenu.x} y={tabMenu.y} onClose={closeMenus}>
          <button style={menuBtnBase} onClick={() => { startRenamingTab(tabMenu.id); closeMenus(); }} {...hoverHandlers}>Rename View</button>
          <button style={{ ...menuBtnBase, color: tabs.length > 1 ? "#c62828" : "#999" }} disabled={tabs.length === 1} onClick={() => { deleteTab(tabMenu.id); closeMenus(); }} {...hoverHandlers}>Delete View</button>
          <button style={menuBtnBase} onClick={() => { openDefaultNodeView(tabMenu.id); closeMenus(); }} {...hoverHandlers}>Map</button>
          <button style={menuBtnBase} onPointerEnter={preloadLogicGateArenaSurface} onFocus={preloadLogicGateArenaSurface} onPointerDown={preloadLogicGateArenaSurface} onClick={() => { openLogicGateArena(tabMenu.id); closeMenus(); }} {...hoverHandlers}>Logic Gate Arena</button>
          <button style={menuBtnBase} onPointerEnter={preloadCommunicationsSurface} onFocus={preloadCommunicationsSurface} onPointerDown={preloadCommunicationsSurface} onClick={() => { openCommunicationsView(tabMenu.id); closeMenus(); }} {...hoverHandlers}>Home</button>
          <button style={menuBtnBase} onClick={() => { saveCurrentAsTemplate(tabMenu.id); closeMenus(); }} {...hoverHandlers}>Save Current as Template</button>
        </FrameRightClickMenu>
      )}

      {frameRightClickMenu && (
        <FrameRightClickMenu x={frameRightClickMenu.x} y={frameRightClickMenu.y} onClose={closeMenus}>
          <button style={menuBtnBase} onClick={() => { duplicateFrame(frameRightClickMenu.id); closeMenus(); }} {...hoverHandlers}>Duplicate</button>
          {frameInContextMenu?.parentId && (
            <button
              style={menuBtnBase}
              onClick={() => {
                const parent = frames.find((frame) => frame.id === frameInContextMenu.parentId);
                updateActiveFrames((previous) => previous.map((frame) => {
                  if (frame.id !== frameInContextMenu.id || !parent) return frame;
                  return { ...frame, parentId: undefined, x: parent.x + frame.x, y: parent.y + frame.y };
                }));
                closeMenus();
              }}
              {...hoverHandlers}
            >
              Detach Child Frame
            </button>
          )}
          <button
            style={{ ...menuBtnBase, color: canAttachSelectedFrames ? "#111" : "#999" }}
            disabled={!canAttachSelectedFrames}
            onClick={() => { attachSelectedFrames(); closeMenus(); }}
            {...hoverHandlers}
          >
            Attach frames
          </button>
          <button
            style={{ ...menuBtnBase, color: linkPlan ? "#111" : "#999" }}
            disabled={!linkPlan}
            onClick={() => { linkSelectedNodeModules(); closeMenus(); }}
            {...hoverHandlers}
          >
            Link modules: {linkModulesLabel}
          </button>
          <button
            style={{ ...menuBtnBase, color: canDelinkModules ? "#111" : "#999" }}
            disabled={!canDelinkModules}
            onClick={() => { delinkSelectedNodeModules(); closeMenus(); }}
            {...hoverHandlers}
          >
            Delink modules
          </button>
          {COLORWAY_ORDER.map((theme) => (
            <button key={theme} style={menuBtnBase} onClick={() => {
              updateActiveFrames((prev) => prev.map((w) => (w.id === frameRightClickMenu.id ? applyColorway(w, theme) : w)));
              closeMenus();
            }} {...hoverHandlers}>
              <span style={{ width: 10, height: 10, border: "1px solid #333", background: COLORWAYS[theme].color, display: "inline-block" }} /> {theme.charAt(0).toUpperCase() + theme.slice(1)}
            </button>
          ))}
          <button style={{ ...menuBtnBase, color: "#c62828" }} onClick={() => { confirmDeleteFrameSelection([frameRightClickMenu.id]); closeMenus(); }} {...hoverHandlers}>Delete</button>
        </FrameRightClickMenu>
      )}

      {frameDeleteConfirmation && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.28)", zIndex: 120, display: "grid", placeItems: "center" }}>
          <div style={{ width: "min(420px, 90%)", borderRadius: 10, border: "1px solid rgba(255,136,32,0.45)", background: "rgba(255,255,255,0.95)", padding: 12, display: "grid", gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700 }}>
              Are you sure you want to delete {frameDeleteConfirmation.frameIDs.length} frame{frameDeleteConfirmation.frameIDs.length === 1 ? "" : "s"}?
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.35, color: "#2e2e2e" }}>
              This removes the selected frame from the active view immediately. Use Undo (Ctrl/Cmd + Z) if this was accidental.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button onClick={() => { applyConfirmedFrameDelete(frameDeleteConfirmation.frameIDs); setFrameDeleteConfirmation(null); }} style={{ border: "1px solid rgba(255,136,32,0.45)", background: "#fff", cursor: "pointer", fontWeight: 700 }}>Yes</button>
              <button onClick={() => setFrameDeleteConfirmation(null)} style={{ border: "1px solid #ff3d7f", boxShadow: "inset 0 0 0 1px rgba(255,130,170,0.25), 0 0 10px rgba(255,61,127,0.18)", color: "#8b123f", background: "#fff", cursor: "pointer", fontWeight: 700 }}>No</button>
            </div>
          </div>
        </div>
      )}

      {moduleTypeMenu && (
        <ModulePickerMenu
          x={moduleTypeMenu.x}
          y={moduleTypeMenu.y}
          moduleTypeMenuId={moduleTypeMenu.id}
          moduleLibrary={FRAME_MODULE_LIBRARY}
          menuBtnBase={menuBtnBase}
          hoverHandlers={hoverHandlers}
          onClose={closeMenus}
          onChangeModuleKind={(id, kind, label) => {
            preloadModuleKind(kind);
            updateActiveFrames((prev) => prev.map((w) => (w.id === id ? { ...w, kind, title: label } : w)));
          }}
        />
      )}

      {canvasMenu && (
        <FrameRightClickMenu x={canvasMenu.x} y={canvasMenu.y} onClose={closeMenus}>
          <button style={menuBtnBase} onClick={() => { addFrame(DEFAULT_FRAME_KIND, { x: canvasMenu.gridX, y: canvasMenu.gridY }); setEditMode(true); closeMenus(); }} {...hoverHandlers}>
            Create new frame
          </button>
          <button style={menuBtnBase} onClick={() => { setEditMode((v) => !v); closeMenus(); }} {...hoverHandlers}>
            Toggle Edit Mode (Now: {editMode ? "ON" : "OFF"})
          </button>
          <label style={{ ...menuBtnBase, cursor: "default", justifyContent: "space-between" }}>
            Canvas Color
            <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} />
          </label>
          <label style={{ ...menuBtnBase, cursor: "default", justifyContent: "space-between" }}>
            Plus Color
            <input type="color" value={crossColor} onChange={(e) => setCrossColor(e.target.value)} />
          </label>
        </FrameRightClickMenu>
      )}

      {headerMenu && (
        <FrameRightClickMenu x={headerMenu.x} y={headerMenu.y} onClose={closeMenus}>
          <button style={menuBtnBase} onClick={() => { addTab(); closeMenus(); }} {...hoverHandlers}>
            New view tab
          </button>
          <label style={{ ...menuBtnBase, cursor: "default", justifyContent: "space-between" }}>
            Taskbar Tint
            <input type="color" value={headerBgColor} onChange={(e) => setHeaderBgColor(e.target.value)} />
          </label>
          <label style={{ ...menuBtnBase, cursor: "default", justifyContent: "space-between" }}>
            Header Text
            <input type="color" value={headerTextColor} onChange={(e) => setHeaderTextColor(e.target.value)} />
          </label>
          <label style={{ ...menuBtnBase, cursor: "default", justifyContent: "space-between" }}>
            Tab Box
            <input type="color" value={tabBgColor} onChange={(e) => setTabBgColor(e.target.value)} />
          </label>
          <label style={{ ...menuBtnBase, cursor: "default", justifyContent: "space-between" }}>
            Tab Text
            <input type="color" value={tabTextColor} onChange={(e) => setTabTextColor(e.target.value)} />
          </label>
        </FrameRightClickMenu>
      )}
    </div>
  );
};

export default App;
