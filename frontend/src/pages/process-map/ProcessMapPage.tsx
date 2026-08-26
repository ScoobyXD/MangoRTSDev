import { useCallback, useMemo, useState } from "react";
import { createRequestJSON } from "../../modules/api/requestJSON.js";
import { EXPLORER_DRAG_MIME } from "../../modules/company-explorer/companyExplorerDragDrop.js";
import {
  UniversalEntityPicker,
  type UniversalEntityPickerAnchor,
  type UniversalEntityPickerEntity,
} from "../../modules/editor/UniversalEntityPicker.js";
import { UniversalLinkerControls } from "../../modules/editor/UniversalLinkerControls.js";
import { ProcessMapSurface } from "../../modules/process-map/ProcessMapSurface.js";

const PROCESS_MAP_LINK_TARGET_TYPES = ["logic_gate"] as const;

export type ProcessMapPageProps = {
  apiBase: string;
  companyID: string;
  onOpenLogicGate: (logicGateID: string, label: string) => void;
};

export function ProcessMapPage({ apiBase, companyID, onOpenLogicGate }: ProcessMapPageProps) {
  const [pickerAnchor, setPickerAnchor] = useState<UniversalEntityPickerAnchor | null>(null);
  const [hoverModeEnabled, setHoverModeEnabled] = useState(false);
  const requestJSON = useMemo(() => createRequestJSON(apiBase), [apiBase]);
  const togglePicker = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    if (pickerAnchor) {
      setPickerAnchor(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setPickerAnchor({ left: rect.right - 460, top: rect.bottom + 6 });
  }, [pickerAnchor]);
  const startProcessDrag = useCallback((event: React.DragEvent<HTMLButtonElement>, entity: UniversalEntityPickerEntity) => {
    if (entity.entityType !== "logic_gate") {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(EXPLORER_DRAG_MIME, JSON.stringify({
      kind: "logic_gate",
      label: entity.label,
      itemID: entity.entityID,
      itemType: "logic_gate",
    }));
  }, []);

  return (
    <main className="process-map-page" aria-label="Process Map">
      <header className="process-map-page__header">
        <h1>Process Map</h1>
        <label className="process-map-page__hover-mode">
          <input type="checkbox" checked={hoverModeEnabled} onChange={(event) => setHoverModeEnabled(event.currentTarget.checked)} />
          <span>Hover mode</span>
        </label>
        <div className="process-map-page__actions">
          <UniversalLinkerControls
            busy={false}
            pickerOpen={pickerAnchor !== null}
            showCreateFloatingNode={false}
            openPickerAriaLabel="Search Processes to place on this map"
            onTogglePicker={togglePicker}
          />
          {pickerAnchor && <UniversalEntityPicker
            companyID={companyID}
            requestJSON={requestJSON}
            sourceLabel="Process Map"
            linkTargetTypes={PROCESS_MAP_LINK_TARGET_TYPES}
            initialMode="link"
            initialCategory="logic_gate"
            lockMode
            anchor={pickerAnchor}
            onEntityDragStart={startProcessDrag}
            onCancel={() => setPickerAnchor(null)}
          />}
        </div>
      </header>
      <div className="process-map-page__canvas">
        <ProcessMapSurface
          apiBase={apiBase}
          companyID={companyID}
          hoverModeEnabled={hoverModeEnabled}
          onOpenLogicGate={onOpenLogicGate}
        />
      </div>
    </main>
  );
}
