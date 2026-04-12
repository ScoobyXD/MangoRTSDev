export interface Widget {
  id: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  color: string;
  accent: string;
}

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
