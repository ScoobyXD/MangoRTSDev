export const EVENT_PROJECT_VIEW_SETTINGS_REQUESTED = "mangorts:project-view-settings-requested";

export type ProjectViewSettingsRequestDetail = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export function requestProjectViewSettings(anchor: DOMRect): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ProjectViewSettingsRequestDetail>(EVENT_PROJECT_VIEW_SETTINGS_REQUESTED, {
    detail: {
      left: anchor.left,
      top: anchor.top,
      right: anchor.right,
      bottom: anchor.bottom,
    },
  }));
}
