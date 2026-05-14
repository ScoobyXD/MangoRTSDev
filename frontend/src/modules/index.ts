import React from "react";

type ModuleProps = {
  accent: string;
  widgetId?: string;
  hideTopControls?: boolean;
  theme?: "mango" | "teal" | "light" | "dark";
};

type ModuleComponent = React.FC<ModuleProps>;
type ModuleLoader = () => Promise<{ default: ModuleComponent }>;

export interface ModuleTemplate {
  kind: string;
  label: string;
  defaultW: number;
  defaultH: number;
  render: ModuleComponent;
}

function createLazyModule(loader: ModuleLoader): { render: ModuleComponent; preload: () => void } {
  let promise: Promise<{ default: ModuleComponent }> | null = null;
  const load = () => {
    promise ??= loader();
    return promise;
  };
  const Lazy = React.lazy(load);
  const fallback = React.createElement("div", {
    "aria-busy": "true",
    style: { width: "100%", height: "100%", background: "transparent" },
  });
  return {
    render: (props) => React.createElement(React.Suspense, { fallback }, React.createElement(Lazy, props)),
    preload: () => { void load(); },
  };
}

const mapModule = createLazyModule(() => import("./map/MapContent").then((module) => ({ default: module.MapContent as ModuleComponent })));
const logicMapModule = createLazyModule(() => import("./map/MapContent").then((module) => ({
  default: ((props: ModuleProps) => React.createElement(module.MapContent, { ...props, initialMode: "logic_gate" })) as ModuleComponent,
})));
const editorModule = createLazyModule(() => import("./editor/EditorContent").then((module) => ({ default: module.EditorContent as ModuleComponent })));
const companyExplorerModule = createLazyModule(() => import("./company-explorer/CompanyExplorerContent").then((module) => ({ default: module.CompanyExplorerContent as ModuleComponent })));
const kanbanModule = createLazyModule(() => import("./kanban/KanbanContent").then((module) => ({ default: module.KanbanContent as ModuleComponent })));
const homeModule = createLazyModule(() => import("../pages/home/HomePage").then((module) => ({ default: module.HomeFrameContent as ModuleComponent })));

const moduleEntries = [
  { kind: "company-explorer", label: "Explorer", defaultW: 18, defaultH: 14, ...companyExplorerModule },
  { kind: "editor", label: "Editor", defaultW: 16, defaultH: 14, ...editorModule },
  { kind: "kanban", label: "Kanban board", defaultW: 18, defaultH: 7, ...kanbanModule },
  { kind: "home", label: "Home", defaultW: 24, defaultH: 16, ...homeModule },
  { kind: "map", label: "Map", defaultW: 16, defaultH: 14, ...mapModule },
];

// Master module library used by add-module flow and module-picker context menu.
export const MODULE_LIBRARY: ModuleTemplate[] = moduleEntries.map(({ preload, ...entry }) => entry);

// Fast lookup map consumed by frame rendering paths in AppLayout.
export const MODULE_CONTENT_MAP: Record<string, ModuleComponent> = Object.fromEntries(
  MODULE_LIBRARY.map((module) => [module.kind, module.render])
);

// Legacy aliases maintained so older persisted layouts still open correctly.
MODULE_CONTENT_MAP.nodes = mapModule.render;
MODULE_CONTENT_MAP["nodes-map"] = mapModule.render;
MODULE_CONTENT_MAP["logic-map"] = logicMapModule.render;
MODULE_CONTENT_MAP["node-doc"] = editorModule.render;
MODULE_CONTENT_MAP.communications = homeModule.render;

const MODULE_PRELOADERS: Record<string, () => void> = Object.fromEntries(moduleEntries.map((entry) => [entry.kind, entry.preload]));
MODULE_PRELOADERS.nodes = mapModule.preload;
MODULE_PRELOADERS["nodes-map"] = mapModule.preload;
MODULE_PRELOADERS["logic-map"] = logicMapModule.preload;
MODULE_PRELOADERS["node-doc"] = editorModule.preload;
MODULE_PRELOADERS.communications = homeModule.preload;

export function preloadModuleKind(kind: string): void {
  MODULE_PRELOADERS[kind]?.();
}

export function preloadModuleKinds(kinds: Iterable<string>): void {
  const seen = new Set<string>();
  for (const kind of kinds) {
    if (seen.has(kind)) continue;
    seen.add(kind);
    preloadModuleKind(kind);
  }
}

export function preloadModulesForFrames(frames: Iterable<{ kind: string }>): void {
  preloadModuleKinds(Array.from(frames, (frame) => frame.kind));
}
