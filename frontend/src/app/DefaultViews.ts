import type { FrameDataModel } from "../types";
import { createFrameId } from "./frameLayoutTypes.js";

const WHITE_FRAME = { theme: "light" as const, color: "#ffffff", accent: "#111111" };

export const LEGACY_DEFAULT_NODE_VIEW_FRAME_IDS = {
  map: "w-node-map",
  explorer: "w-company-explorer",
  editor: "w-editor",
} as const;

export function createDefaultNodeViewFrames(): FrameDataModel[] {
  const mapID = createFrameId();
  const explorerID = createFrameId();
  const editorID = createFrameId();

  return [
    {
      id: mapID,
      kind: "map",
      x: 1,
      y: 1,
      w: 42,
      h: 30,
      title: "Default Map View",
      ...WHITE_FRAME,
    },
    {
      id: explorerID,
      kind: "company-explorer",
      parentId: mapID,
      x: 1.5,
      y: 1.5,
      w: 11,
      h: 27,
      title: "Company Explorer",
      ...WHITE_FRAME,
    },
    {
      id: editorID,
      kind: "editor",
      parentId: mapID,
      x: 29.5,
      y: 1.5,
      w: 11,
      h: 27,
      title: "Editor",
      ...WHITE_FRAME,
    },
  ];
}
