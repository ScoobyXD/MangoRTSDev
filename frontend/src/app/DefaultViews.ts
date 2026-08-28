import type { FrameDataModel } from "../types.js";
import { MANGO_ACCENT_HEX } from "../theme.js";
import { createFrameId } from "./frameLayoutTypes.js";

const WHITE_FRAME = { theme: "light" as const, color: "#ffffff", accent: MANGO_ACCENT_HEX };

export function createLogicGateArenaFrames(): FrameDataModel[] {
  const editorID = createFrameId();
  const kanbanID = createFrameId();

  return [
    {
      id: editorID,
      kind: "editor",
      x: 1,
      y: 1,
      w: 16,
      h: 30,
      title: "Editor",
      ...WHITE_FRAME,
    },
    {
      id: kanbanID,
      kind: "kanban",
      x: 18,
      y: 1,
      w: 34,
      h: 30,
      title: "Process Kanban",
      ...WHITE_FRAME,
    },
  ];
}

export function createProjectManagementFrames(): FrameDataModel[] {
  return [
    {
      id: createFrameId(),
      kind: "project-management",
      x: 1,
      y: 1,
      w: 42,
      h: 30,
      title: "Projects",
      ...WHITE_FRAME,
    },
  ];
}

export function createAccountManagerFrames(): FrameDataModel[] {
  return [
    {
      id: createFrameId(),
      kind: "account-manager",
      x: 1,
      y: 1,
      w: 42,
      h: 30,
      title: "Accounts",
      ...WHITE_FRAME,
    },
  ];
}

export function createTeamsFrames(): FrameDataModel[] {
  return [
    {
      id: createFrameId(),
      kind: "teams",
      x: 1,
      y: 1,
      w: 42,
      h: 30,
      title: "Teams",
      ...WHITE_FRAME,
    },
  ];
}

export function createHomeViewFrames(): FrameDataModel[] {
  const homeID = createFrameId();

  return [
    {
      id: homeID,
      kind: "home",
      x: 1,
      y: 1,
      w: 42,
      h: 30,
      title: "Home",
      ...WHITE_FRAME,
    },
  ];
}
