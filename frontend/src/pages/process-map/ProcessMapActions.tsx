import type { ReactNode } from "react";

export type ProcessMapActionsProps = {
  onCreateFolder: () => void;
  onCreateProcess: () => void;
  onCreateStep: () => void;
  disabled?: boolean;
  stepDisabled?: boolean;
  hoverModeEnabled: boolean;
  onHoverModeChange: (enabled: boolean) => void;
  children?: ReactNode;
};

export function ProcessMapActions({ onCreateFolder, onCreateProcess, onCreateStep, disabled, stepDisabled, hoverModeEnabled, onHoverModeChange, children }: ProcessMapActionsProps) {
  return <aside className="process-map-page__actions" aria-label="Create on Process Map">
    <button type="button" disabled={disabled} onClick={onCreateFolder}>+ Create Folder</button>
    <button type="button" disabled={disabled} onClick={onCreateProcess}>+ Create Process</button>
    <button type="button" disabled={disabled || stepDisabled} onClick={onCreateStep}>+ Create Step</button>
    <label className="process-map-page__hover-mode">
      <input type="checkbox" checked={hoverModeEnabled} onChange={(event) => onHoverModeChange(event.currentTarget.checked)} />
      <span>Hover mode</span>
    </label>
    {children && <div className="process-map-page__action-details">{children}</div>}
  </aside>;
}
