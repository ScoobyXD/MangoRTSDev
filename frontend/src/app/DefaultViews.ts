import type { FrameDataModel } from "../types";

const WHITE_FRAME = { theme: "light" as const, color: "#ffffff", accent: "#111111" };

export function createDefaultNodeViewFrames(): FrameDataModel[] {
  return [
    {
      id: "w-node-map",
      kind: "nodes-map",
      x: 1,
      y: 1,
      w: 42,
      h: 30,
      title: "Default Node View",
      ...WHITE_FRAME,
    },
    {
      id: "w-company-explorer",
      kind: "company-explorer",
      parentId: "w-node-map",
      x: 1.5,
      y: 1.5,
      w: 11,
      h: 27,
      title: "Company Explorer",
      ...WHITE_FRAME,
    },
    {
      id: "w-editor",
      kind: "editor",
      parentId: "w-node-map",
      x: 29.5,
      y: 1.5,
      w: 11,
      h: 27,
      title: "Editor",
      ...WHITE_FRAME,
    },
  ];
}
