import { useCallback, useEffect, useMemo, useState } from "react";
import { buildProcessMapRoute } from "../../app/deepLinkRoutes.js";
import { createRequestJSON } from "../../modules/api/requestJSON.js";
import { EXPLORER_DRAG_MIME } from "../../modules/company-explorer/companyExplorerDragDrop.js";
import {
  UniversalEntityPicker,
  type UniversalEntityPickerAnchor,
  type UniversalEntityPickerEntity,
} from "../../modules/editor/UniversalEntityPicker.js";
import { UniversalLinkerControls } from "../../modules/editor/UniversalLinkerControls.js";
import { ProcessMapSurface } from "../../modules/process-map/ProcessMapSurface.js";
import type { ProcessMapLayerResponse } from "../../modules/process-map/processMapApi.js";

const PROCESS_MAP_LINK_TARGET_TYPES = ["logic_gate"] as const;

export type ProcessMapPageProps = {
  apiBase: string;
  companyID: string;
  folderID?: string;
  onNavigate?: (path: string) => void;
};

export function ProcessMapPage({ apiBase, companyID, folderID, onNavigate }: ProcessMapPageProps) {
  const [layer, setLayer] = useState<ProcessMapLayerResponse["layer"] | null>(null);
  const [pickerAnchor, setPickerAnchor] = useState<UniversalEntityPickerAnchor | null>(null);
  const [hoverModeEnabled, setHoverModeEnabled] = useState(false);
  const pickerOpen = pickerAnchor !== null;
  const requestJSON = useMemo(() => createRequestJSON(apiBase), [apiBase]);
  const activeFolderLayer = layer?.kind === "folder" && layer.folder_id === folderID ? layer : null;
  useEffect(() => setPickerAnchor(null), [folderID]);
  const openFolder = useCallback((nextFolderID: string) => {
    onNavigate?.(buildProcessMapRoute(nextFolderID));
  }, [onNavigate]);
  const togglePicker = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    if (pickerOpen) {
      setPickerAnchor(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setPickerAnchor({ left: rect.right - 460, top: rect.bottom + 6 });
  }, [pickerOpen]);
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
        <div className="process-map-page__path">
          <button
            type="button"
            className="process-map-page__root"
            aria-current={!folderID ? "page" : undefined}
            onClick={() => onNavigate?.(buildProcessMapRoute())}
          >
            Process Map
          </button>
          {layer?.kind === "folder" && (
            <nav className="process-map-page__breadcrumbs" aria-label="Process Map folder path">
              {layer.ancestors.map((ancestor) => (
                <span className="process-map-page__breadcrumb" key={ancestor.folder_id}>
                  <span className="process-map-page__separator" aria-hidden="true">/</span>
                  <button
                    type="button"
                    className="process-map-page__ancestor"
                    onClick={() => onNavigate?.(buildProcessMapRoute(ancestor.folder_id))}
                  >
                    {ancestor.name}
                  </button>
                </span>
              ))}
              <span className="process-map-page__breadcrumb">
                <span className="process-map-page__separator" aria-hidden="true">/</span>
                <span className="process-map-page__layer-name" aria-current="page">{layer.name}</span>
              </span>
            </nav>
          )}
        </div>
        <label className="process-map-page__hover-mode">
          <input
            type="checkbox"
            checked={hoverModeEnabled}
            onChange={(event) => setHoverModeEnabled(event.currentTarget.checked)}
          />
          <span>Hover mode</span>
        </label>
        {activeFolderLayer && (
          <div className="process-map-page__actions">
            <UniversalLinkerControls
              busy={false}
              pickerOpen={pickerOpen}
              showCreateFloatingNode={false}
              openPickerAriaLabel="Search Processes to place on this map"
              onTogglePicker={togglePicker}
            />
            {pickerAnchor && (
              <UniversalEntityPicker
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
              />
            )}
          </div>
        )}
      </header>
      <div className="process-map-page__canvas">
        <ProcessMapSurface
          apiBase={apiBase}
          companyID={companyID}
          folderID={folderID}
          hoverModeEnabled={hoverModeEnabled}
          onOpenFolder={openFolder}
          onLayerChange={setLayer}
        />
      </div>
    </main>
  );
}
