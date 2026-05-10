// Canonical frame/module geometry model shared by dashboard editing and persistence.
export type FrameTheme = "mango" | "teal" | "light" | "dark";

export interface FrameDataModel {
  id: string;
  kind: string;
  parentId?: string;
  theme?: FrameTheme;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  color: string;
  accent: string;
}

// Backward compatibility during migration.
export type Widget = FrameDataModel;

// Resize edge flags used by pointer-resize state machine in AppLayout.
export interface ResizeEdges {
  top?: boolean;
  bottom?: boolean;
  left?: boolean;
  right?: boolean;
}

// Drag/resize interaction snapshot used to calculate movement deltas safely.
export interface DragState {
  id: string;
  parentId?: string;
  mode: "drag" | "resize";
  edges: ResizeEdges;
  startMouseX: number;
  startMouseY: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
}
