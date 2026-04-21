export interface FrameDataModel {
  id: string;
  kind: string;
  theme?: "teal" | "orange" | "white" | "black";
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

export interface ResizeEdges {
  top?: boolean;
  bottom?: boolean;
  left?: boolean;
  right?: boolean;
}

export interface DragState {
  id: string;
  mode: "drag" | "resize";
  edges: ResizeEdges;
  startMouseX: number;
  startMouseY: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
}
